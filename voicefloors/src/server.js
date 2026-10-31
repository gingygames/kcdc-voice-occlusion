// voicefloors: stops proximity voice carrying between floors on a Kingdoms Connected server.
//
// Server-only. For pairs of players in voice range with a height difference, the server asks both players' clients
// to trace head to head (World.raycastAll runs on the chosen player's machine). A horizontal, non-terrain,
// non-stairs surface on every ray means a floor or ceiling is between them, and the pair is muted both ways with
// Voice.setLocalMute. If either client reports a floor, the pair is muted: a modified client can mute itself but
// cannot unmute an eavesdropping pair on its own. Binary by design: KCDC exposes no per-talker volume to scripts.
// See README.md.

const CFG = Object.assign(
  { enabled: true, minHeightDiff: 1.8, intervalMs: 500, maxChecksPerTick: 24, rays: 3, sideOffset: 0.5, headHeight: 1.6, floorNormalZ: 0.7, confirmTicks: 2, moveThreshold: 0.3, admins: [] },
  globalThis.VOICEFLOORS_CONFIG ?? {},
);
const RESOURCE = "voicefloors";

const pairs = new Map(); // "lowId:highId" -> { a, b, muted, verdict, streak, checking, lastCheck, posA, posB }
const ours = new Set();  // "listenerId>talkerId" mutes this resource set
let debugTo = null;      // player id receiving debug lines
let timer = null;

const key = (a, b) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
const v3 = (p) => ({ x: p.x, y: p.y, z: p.z });
const moved = (from, now) => !from || Math.hypot(now.x - from.x, now.y - from.y, now.z - from.z) > CFG.moveThreshold;
const say = (p, text) => Chat.sendToPlayer(p, text, { author: RESOURCE });

function debug(text) {
  if (debugTo == null) return;
  const p = Player.all().find((x) => x.id === debugTo);
  if (p) say(p, text);
  else debugTo = null;
}

function setMute(listener, talker, muted) {
  const k = `${listener.id}>${talker.id}`;
  if (muted) {
    if (ours.has(k) || Voice.isLocallyMuted(listener, talker)) return; // someone else's mute: leave it alone
    Voice.setLocalMute(listener, talker, true);
    ours.add(k);
  } else if (ours.has(k)) {
    Voice.setLocalMute(listener, talker, false);
    ours.delete(k);
  }
}

function applyPair(s, muted) {
  if (s.muted === muted) return;
  s.muted = muted;
  setMute(s.a, s.b, muted);
  setMute(s.b, s.a, muted);
  debug(`${muted ? "muted" : "unmuted"}: ${s.a.nickname} <-> ${s.b.nickname}`);
}

function releasePair(k) {
  const s = pairs.get(k);
  if (!s) return;
  applyPair(s, false);
  pairs.delete(k);
}

/** Head-to-head rays from `from` to `to`, the side rays offset perpendicular to the line in the horizontal plane. */
function rays(from, to) {
  const h = CFG.headHeight;
  const A = { x: from.x, y: from.y, z: from.z + h };
  const B = { x: to.x, y: to.y, z: to.z + h };
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy);
  const sx = len > 0.01 ? -dy / len : 1, sy = len > 0.01 ? dx / len : 0;
  const out = [[A, B]];
  for (let i = 1; i < CFG.rays; i++) {
    const o = CFG.sideOffset * Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    out.push([{ x: A.x + sx * o, y: A.y + sy * o, z: A.z }, { x: B.x + sx * o, y: B.y + sy * o, z: B.z }]);
  }
  return out;
}

/** Floor or ceiling: near-horizontal, not terrain (a hill crest is not a floor), not stairs. */
const isFloor = (hit) =>
  hit.kind !== "terrain" && Math.abs(hit.normal.z) >= CFG.floorNormalZ && !String(hit.surface).startsWith("mat_stairs");

/** One client's verdict: true = a floor on every ray, false = some ray got through, null = no answer. */
async function clientVerdict(asker, from, to) {
  const results = await Promise.all(rays(from, to).map(([f, t]) => World.raycastAll(asker, f, t, { mode: "cover", maxHits: 8 })));
  if (results.some((r) => !r.answered)) return null;
  return results.every((r) => r.hits.some(isFloor));
}

async function check(s) {
  s.checking = true;
  s.lastCheck = Date.now();
  const pa = v3(s.a.position), pb = v3(s.b.position);
  try {
    const [va, vb] = await Promise.all([clientVerdict(s.a, pa, pb), clientVerdict(s.b, pb, pa)]);
    if (!pairs.has(key(s.a, s.b))) return; // released meanwhile
    if (va === null && vb === null) return; // nobody answered: keep the current state
    const blocked = va === true || vb === true;
    s.streak = blocked === s.verdict ? s.streak + 1 : 1;
    s.verdict = blocked;
    s.posA = pa;
    s.posB = pb;
    if (s.streak >= CFG.confirmTicks) applyPair(s, blocked);
  } catch (e) {
    console.log(`[${RESOURCE}] check failed: ${e?.message ?? e}`);
  } finally {
    s.checking = false;
  }
}

function tick() {
  if (!CFG.enabled) return;
  const players = Player.all().filter((p) => p.ready !== false);
  const seen = new Set();
  const due = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      if (a.virtualWorld !== b.virtualWorld) continue;
      const pa = a.position, pb = b.position;
      if (Math.abs(pa.z - pb.z) < CFG.minHeightDiff) continue;
      const range = Math.max(Voice.getPlayerRange(a), Voice.getPlayerRange(b));
      if (pa.distance(pb) > range + 2) continue;
      const k = key(a, b);
      seen.add(k);
      let s = pairs.get(k);
      if (!s) pairs.set(k, (s = { a, b, muted: false, verdict: null, streak: 0, checking: false, lastCheck: 0, posA: null, posB: null }));
      s.a = a;
      s.b = b;
      if (s.checking) continue;
      const settled = s.streak >= CFG.confirmTicks && s.muted === s.verdict;
      if (settled && !moved(s.posA, pa) && !moved(s.posB, pb)) continue;
      due.push(s);
    }
  }
  for (const k of [...pairs.keys()]) if (!seen.has(k)) releasePair(k); // same floor, out of range or gone
  due.sort((x, y) => x.lastCheck - y.lastCheck);
  for (const s of due.slice(0, CFG.maxChecksPerTick)) void check(s);
}

function releaseAll() {
  for (const k of [...pairs.keys()]) releasePair(k);
}

function start() {
  if (!timer) timer = setInterval(tick, CFG.intervalMs);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  releaseAll();
}

Events.on("playerCommand", (p, cmd, args) => {
  if (cmd !== RESOURCE) return;
  const sub = (args[0] ?? "status").toLowerCase();
  const muted = [...pairs.values()].filter((s) => s.muted).length;
  if (sub === "status") return say(p, `voicefloors ${CFG.enabled ? "on" : "off"}: ${pairs.size} pairs watched, ${muted} muted across floors.`);
  if (!CFG.admins.includes(p.steamId)) return say(p, "Only admins listed in voicefloors config.js can do that.");
  if (sub === "on") return (CFG.enabled = true), start(), say(p, "voicefloors on.");
  if (sub === "off") return (CFG.enabled = false), stop(), say(p, "voicefloors off, all its mutes released.");
  if (sub === "debug") return (debugTo = debugTo === p.id ? null : p.id), say(p, `debug ${debugTo === p.id ? "on" : "off"}.`);
  say(p, "Usage: /voicefloors status|on|off|debug");
});

Events.on("playerDisconnect", (p) => {
  for (const [k, s] of [...pairs]) if (s.a.id === p.id || s.b.id === p.id) pairs.delete(k);
  for (const k of [...ours]) if (k.startsWith(`${p.id}>`) || k.endsWith(`>${p.id}`)) ours.delete(k);
});

Events.on("resourceStop", (name) => {
  if (name === RESOURCE) stop();
});

if (CFG.enabled) start();

// for tests
globalThis.__voicefloors = { tick, pairs, ours, CFG, isFloor, rays };
