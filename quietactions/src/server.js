// quietactions (server): keeps other players' "first-person" game sounds (dice, washing, cooking) from being heard
// at any distance on a Kingdoms Connected server. See README.md and ../PLAYER-ONLY-SOUNDS.md.
//
// The server only knows two things the client cannot: who is near whom (clients cannot list players) and when the
// dice minigame does what (diceMatchStart/diceRoll/...). It sends both to the clients; the silencing itself happens on
// each client with Audio.stopOnEntity on the other players' bodies.

const DEFAULTS = {
  enabled: true,
  radius: 80,
  pollIntervalMs: 200,
  nearIntervalMs: 1000,
  pollTriggers: ["special_player_washing", "special_player_cooking", "special_washing_laundry"],
  diceTriggers: ["dice_shake_player", "dice_wood1_player", "dice_bowl_put_player"],
  diceRollSound: "dice_table_short",
  admins: [],
  isAdmin: null,
};
const CFG = Object.assign({}, DEFAULTS, globalThis.QUIETACTIONS_CONFIG ?? {});
const RESOURCE = "quietactions";
const EV = { hello: `${RESOURCE}:hello`, config: `${RESOURCE}:config`, near: `${RESOURCE}:near`, dice: `${RESOURCE}:dice`, stats: `${RESOURCE}:stats` };

const matches = new Map();  // match id -> [firstId, secondId]
const lastNear = new Map(); // player id -> "id,id,..." last sent
const clientStats = new Map(); // player id -> { stopped, rolls }
let timer = null;

const say = (p, text) => Chat.sendToPlayer(p, text, { author: RESOURCE });
const obj = (x) => (typeof x === "string" ? JSON.parse(x) : x ?? {});
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function isAdmin(p) {
  if (typeof CFG.isAdmin === "function") {
    try { return CFG.isAdmin(p) === true; } catch (e) { return false; }
  }
  return CFG.admins.includes(p.steamId);
}

function clientConfig() {
  return { enabled: CFG.enabled, pollIntervalMs: CFG.pollIntervalMs, pollTriggers: CFG.pollTriggers, diceTriggers: CFG.diceTriggers, diceRollSound: CFG.diceRollSound };
}

function sendConfig(p) {
  p.emit(EV.config, JSON.stringify(clientConfig()));
}

function sendConfigToAll() {
  for (const p of Player.all()) sendConfig(p);
}

/** Every nearIntervalMs: tell each client which other players are within radius (only when the list changed). */
function tickNear() {
  if (!CFG.enabled) return;
  const players = Player.all().filter((p) => p.ready !== false);
  for (const p of players) {
    const ids = players
      .filter((o) => o.id !== p.id && o.virtualWorld === p.virtualWorld && dist(o.position, p.position) <= CFG.radius)
      .map((o) => o.id)
      .sort((a, b) => a - b);
    const key = ids.join(",");
    if (lastNear.get(p.id) === key) continue;
    lastNear.set(p.id, key);
    p.emit(EV.near, JSON.stringify({ ids }));
  }
}

/** Tell the clients near a dice table to silence the player-only dice sounds on both bodies, and what to play instead. */
function diceEvent(match, actingId, play) {
  if (!CFG.enabled) return;
  const pair = matches.get(match);
  const ids = pair ? pair.slice() : [actingId];
  if (!ids.includes(actingId)) ids.push(actingId);
  const all = Player.all();
  const acting = all.find((p) => p.id === actingId) ?? all.find((p) => p.id === ids[0]);
  if (!acting) return;
  const payload = JSON.stringify({ ids, acting: actingId, play: play || "" });
  for (const p of all) {
    if (p.virtualWorld !== acting.virtualWorld || dist(p.position, acting.position) > CFG.radius) continue;
    p.emit(EV.dice, payload);
  }
}

Events.on("diceMatchStart", (match, first, second) => {
  matches.set(match, [first.id, second.id]);
});
Events.on("diceMatchEnd", (match) => {
  const pair = matches.get(match);
  if (pair) diceEvent(match, pair[0], "");
  matches.delete(match);
});
Events.on("diceTurnStart", (e) => diceEvent(e.match, e.player, ""));
Events.on("diceRoll", (e) => diceEvent(e.match, e.player, CFG.diceRollSound));
Events.on("diceMove", (e) => diceEvent(e.match, e.player, ""));
Events.on("diceTurnEnd", (e) => diceEvent(e.match, e.player, ""));

Events.onClient(EV.hello, (sender) => {
  sendConfig(sender);
  lastNear.delete(sender.id); // resend the neighbour list on the next tick
});
Events.onClient(EV.stats, (sender, payload) => {
  const m = obj(payload);
  clientStats.set(sender.id, { stopped: Number(m.stopped) || 0, rolls: Number(m.rolls) || 0 });
});

function start() {
  if (!timer) timer = setInterval(tickNear, CFG.nearIntervalMs);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  lastNear.clear();
}

Events.on("playerCommand", (p, cmd, args) => {
  if (cmd !== RESOURCE) return;
  const sub = (args[0] ?? "status").toLowerCase();
  if (sub === "status") return say(p, `quietactions ${CFG.enabled ? "on" : "off"}: ${CFG.pollTriggers.length} polled triggers every ${CFG.pollIntervalMs} ms within ${CFG.radius} m, ${matches.size} dice match(es) watched.`);
  if (!isAdmin(p)) return say(p, "Only quietactions admins can do that (admins or isAdmin in config.js).");
  if (sub === "on") { CFG.enabled = true; start(); sendConfigToAll(); return say(p, "quietactions on."); }
  if (sub === "off") { CFG.enabled = false; stop(); sendConfigToAll(); return say(p, "quietactions off."); }
  if (sub === "stats") {
    const rows = [...clientStats].map(([id, s]) => `${Player.all().find((x) => x.id === id)?.nickname ?? id}: ${s.stopped} silenced, ${s.rolls} dice rolls replaced`);
    return say(p, rows.length ? `quietactions stats (per client, since they joined):\n${rows.join("\n")}` : "quietactions stats: nothing reported yet.");
  }
  say(p, "Usage: /quietactions status|on|off|stats");
});

Events.on("playerDisconnect", (p) => {
  lastNear.delete(p.id);
  clientStats.delete(p.id);
  for (const [k, pair] of [...matches]) if (pair.includes(p.id)) matches.delete(k);
});

Events.on("resourceStop", (name) => {
  if (name === RESOURCE) stop();
});

if (CFG.enabled) start();

// for tests
globalThis.__quietactions = { tickNear, diceEvent, matches, lastNear, CFG, clientConfig };
