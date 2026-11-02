// quietactions (client): silences the never-culled "player" game sounds (dice, washing, cooking) on the bodies of
// OTHER players, and plays a positioned dice sound instead when the server deals a roll. Never touches the local
// player's own body. Configuration and the list of nearby players come from the server. See README.md.

const RESOURCE = "quietactions";
const EV = { hello: `${RESOURCE}:hello`, config: `${RESOURCE}:config`, near: `${RESOURCE}:near`, dice: `${RESOURCE}:dice`, stats: `${RESOURCE}:stats` };

const obj = (x) => (typeof x === "string" ? JSON.parse(x) : x ?? {});
let cfg = { enabled: false, pollIntervalMs: 200, pollTriggers: [], diceTriggers: [], diceRollSound: "" };
let near = []; // ids of other players within the server's radius
let timer = null;
const stats = { stopped: 0, rolls: 0, reported: 0 };

/** Engine entity of another player, or 0 when it is the local player, not spawned here, or unknown. */
function bodyOf(id) {
  try {
    const p = new Player(id);
    const ent = p.entityId;
    if (!ent || (LocalPlayer && ent === LocalPlayer.entityId)) return 0;
    return ent;
  } catch (e) {
    return 0;
  }
}

function silence(ids, triggers) {
  let n = 0;
  for (const id of ids) {
    const ent = bodyOf(id);
    if (!ent) continue;
    for (const t of triggers) {
      try { if (Audio.stopOnEntity(t, ent)) n++; } catch (e) { /* entity vanished between the two calls */ }
    }
  }
  return n;
}

function poll() {
  if (!cfg.enabled || !near.length || !cfg.pollTriggers.length) return;
  stats.stopped += silence(near, cfg.pollTriggers);
  if (stats.stopped - stats.reported >= 500) report();
}

function report() {
  stats.reported = stats.stopped;
  Events.emitServer(EV.stats, { stopped: stats.stopped, rolls: stats.rolls });
}

function restart() {
  if (timer) clearInterval(timer);
  timer = cfg.enabled ? setInterval(poll, cfg.pollIntervalMs) : null;
}

Events.on(EV.config, (payload) => {
  cfg = Object.assign(cfg, obj(payload));
  restart();
});

Events.on(EV.near, (payload) => {
  near = (obj(payload).ids ?? []).map(Number);
});

// A dice event on a table near us: cut the first-person dice sounds on both bodies; on a roll play the table sound
// positioned on the acting player's body, so the dice are heard at the table and nowhere else.
Events.on(EV.dice, (payload) => {
  if (!cfg.enabled) return;
  const m = obj(payload);
  stats.stopped += silence(m.ids ?? [], cfg.diceTriggers);
  if (m.play) {
    const ent = bodyOf(m.acting);
    if (ent) {
      try { if (Audio.playOnEntity(m.play, ent)) stats.rolls++; } catch (e) { /* body gone */ }
    }
  }
});

Events.emitServer(EV.hello, {});

// for tests
globalThis.__quietactionsClient = { poll, stats, get cfg() { return cfg; }, get near() { return near; } };
