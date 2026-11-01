// voicefloors: stops proximity voice carrying between floors on a Kingdoms Connected server.
//
// Server-only. For pairs of players in voice range with a height difference, the server asks the players' clients
// to trace head to head (World.raycastAll runs on the chosen player's machine). A horizontal, non-terrain,
// non-stairs surface at the height of the upper player's floor on every ray means a floor or ceiling is between
// them, and the pair is muted both ways with Voice.setLocalMute. If either client reports a floor, the pair is muted:
// a modified client can mute itself but cannot unmute an eavesdropping pair on its own. Binary by design: KCDC
// exposes no per-talker volume to scripts. In `storeys` mode each player is sampled once (Navigation.floorAt plus one
// ray up to the roof) and pairs are decided from that, O(N) instead of O(N²). See README.md.

const DEFAULTS = {
  enabled: true,
  mode: "pairs",
  minHeightDiff: 1.8,
  minHeightDiffRelease: 1.4,
  intervalMs: 500,
  maxChecksPerTick: 24,
  rays: 3,
  sideOffset: 0.5,
  headHeight: 1.6,
  headHeightCrouched: 1.1,
  floorNormalZ: 0.7,
  floorBelow: 0.6,
  floorAbove: 0.3,
  confirmTicks: 2,
  moveThreshold: 0.3,
  storeyIntervalMs: 1000,
  roofRayLength: 6,
  storeyFloorDiff: 2.0,
  storeyAmbiguousDiff: 2.5,
  admins: [],
  isAdmin: null,
};
const CFG = Object.assign({}, DEFAULTS, globalThis.VOICEFLOORS_CONFIG ?? {});
const RESOURCE = "voicefloors";

const pairs = new Map();   // "lowId:highId" -> { a, b, muted, verdict, streak, checking, lastCheck, posA, posB, turn, hot }
const ours = new Set();    // "listenerId>talkerId" mutes this resource set
const storeys = new Map(); // player id -> { floor, roof, at, checking, known } (storeys mode)
const recent = [];         // { t, ms, answered } per ray, for /voicefloors stats
let debugTo = null;        // player id receiving debug lines
let timer = null;

const key = (a, b) => (a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
const v3 = (p) => ({ x: p.x, y: p.y, z: p.z });
const moved = (from, now) => !from || Math.hypot(now.x - from.x, now.y - from.y, now.z - from.z) > CFG.moveThreshold;
const say = (p, text) => Chat.sendToPlayer(p, text, { author: RESOURCE });
const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : String(n));
const headOf = (p) => (p.crouched ? CFG.headHeightCrouched : CFG.headHeight);

function debug(text) {
  if (debugTo == null) return;
  const p = Player.all().find((x) => x.id === debugTo);
  if (p) say(p, text);
  else debugTo = null;
}

function isAdmin(p) {
  if (typeof CFG.isAdmin === "function") {
    try { return CFG.isAdmin(p) === true; } catch (e) { console.log(`[${RESOURCE}] isAdmin failed: ${e?.message ?? e}`); return false; }
  }
  return CFG.admins.includes(p.steamId);
}

function talking(p) {
  try { return typeof Voice.isPlayerTalking === "function" && Voice.isPlayerTalking(p) === true; } catch { return false; }
}

/** Navigation.floorAt at a point, or null when the API, the mesh or the floor is missing. Synchronous on the server. */
function floorAtSafe(pos) {
  const nav = globalThis.Navigation;
  if (!nav || typeof nav.floorAt !== "function") return null;
  try {
    const z = nav.floorAt(pos, { searchRadius: 1.5, searchHeight: 2 });
    return typeof z === "number" && Number.isFinite(z) ? z : null;
  } catch { return null; }
}

function setMute(listener, talker, muted) {
  const k = `${listener.id}>${talker.id}`;
  try {
    if (muted) {
      if (ours.has(k) || Voice.isLocallyMuted(listener, talker)) return; // someone else's mute: leave it alone
      Voice.setLocalMute(listener, talker, true);
      ours.add(k);
    } else if (ours.has(k)) {
      Voice.setLocalMute(listener, talker, false);
      ours.delete(k);
    }
  } catch (e) { // a player who just left has no valid handle; the server drops their mutes itself
    ours.delete(k);
    console.log(`[${RESOURCE}] setLocalMute ${k} failed: ${e?.message ?? e}`);
  }
}

function applyPair(s, muted) {
  if (s.muted === muted) return;
  s.muted = muted;
  setMute(s.a, s.b, muted);
  setMute(s.b, s.a, muted);
  try { debug(`${muted ? "muted" : "unmuted"}: ${s.a.nickname} <-> ${s.b.nickname}`); } catch {}
}

function releasePair(k) {
  const s = pairs.get(k);
  if (!s) return;
  applyPair(s, false);
  pairs.delete(k);
}

/** One more verdict for the pair; applied once `confirmTicks` identical verdicts are in. */
function settle(s, blocked) {
  s.streak = blocked === s.verdict ? s.streak + 1 : 1;
  s.verdict = blocked;
  if (s.streak >= CFG.confirmTicks) applyPair(s, blocked);
}

/** Head-to-head rays from `from` to `to`, the side rays offset perpendicular to the line in the horizontal plane. */
function rays(from, to, hFrom = CFG.headHeight, hTo = hFrom) {
  const A = { x: from.x, y: from.y, z: from.z + hFrom };
  const B = { x: to.x, y: to.y, z: to.z + hTo };
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

const isHorizontal = (hit) => hit.kind !== "terrain" && hit.terrain !== true && Math.abs(hit.normal?.z ?? 0) >= CFG.floorNormalZ;

/**
 * Why a hit is not a floor or ceiling, or null when it is: near-horizontal, not terrain (a hill crest is not a floor),
 * not stairs, and at the height of the upper player's floor (`refZ`, so a table top by the lower player's head is not).
 */
function hitReason(hit, refZ) {
  if (hit.kind === "terrain" || hit.terrain === true) return "terrain";
  if (String(hit.surface).startsWith("mat_stairs")) return "stairs";
  if (Math.abs(hit.normal?.z ?? 0) < CFG.floorNormalZ) return "not horizontal";
  const z = hit.position?.z;
  if (refZ != null && !(z >= refZ - CFG.floorBelow && z <= refZ + CFG.floorAbove)) {
    return `z outside floor window ${fmt(refZ - CFG.floorBelow)}..${fmt(refZ + CFG.floorAbove)}`;
  }
  return null;
}
const isFloor = (hit, refZ = null) => hitReason(hit, refZ) === null;

/** The upper player's floor height: Navigation.floorAt when the mesh knows it, else their position. */
function floorRef(a, b) {
  const upper = a.position.z >= b.position.z ? a : b;
  const nav = floorAtSafe(v3(upper.position));
  return { refZ: nav ?? upper.position.z, source: nav != null ? "floorAt" : "position", upper };
}

/** One World.raycastAll, timed for /voicefloors stats. */
async function trace(asker, from, to) {
  const t0 = Date.now();
  const r = await World.raycastAll(asker, from, to, { mode: "cover", maxHits: 8 });
  recent.push({ t: t0, ms: Date.now() - t0, answered: r?.answered === true });
  if (recent.length > 4000) recent.splice(0, recent.length - 2000);
  return r;
}

/** One client's view: per ray its hits with reasons, and `floor`: true = floor on every ray, false = some ray got through, null = no answer. */
async function clientTrace(asker, from, to, hFrom, hTo, refZ) {
  const results = await Promise.all(rays(from, to, hFrom, hTo).map(([f, t]) => trace(asker, f, t)));
  const answered = results.every((r) => r?.answered === true);
  const perRay = results.map((r) => {
    const hits = (r?.hits ?? []).map((hit) => ({ hit, reason: hitReason(hit, refZ) }));
    return { hits, floor: hits.some((h) => h.reason === null) };
  });
  return { answered, rays: perRay, floor: answered ? perRay.every((r) => r.floor) : null };
}

async function check(s) {
  s.checking = true;
  s.lastCheck = Date.now();
  const pa = v3(s.a.position), pb = v3(s.b.position);
  try {
    const { refZ } = floorRef(s.a, s.b);
    const ha = headOf(s.a), hb = headOf(s.b);
    const ask = async (p) => (p === s.a ? await clientTrace(s.a, pa, pb, ha, hb, refZ) : await clientTrace(s.b, pb, pa, hb, ha, refZ)).floor;
    let verdicts;
    if (s.verdict === true) {
      // Last time a floor was there: ask one client (alternating), and the other only if it says open.
      s.turn ^= 1;
      const [first, second] = s.turn ? [s.b, s.a] : [s.a, s.b];
      const v1 = await ask(first);
      verdicts = v1 === true ? [v1] : [v1, await ask(second)];
    } else {
      verdicts = await Promise.all([ask(s.a), ask(s.b)]);
    }
    if (!pairs.has(key(s.a, s.b))) return; // released meanwhile
    if (verdicts.every((v) => v === null)) return; // nobody answered: keep the current state
    settle(s, verdicts.some((v) => v === true));
    s.posA = pa;
    s.posB = pb;
  } catch (e) {
    console.log(`[${RESOURCE}] check failed: ${e?.message ?? e}`);
  } finally {
    s.checking = false;
  }
}

/** storeys mode: once per storeyIntervalMs per player, their floor height (server) and whether a roof is over their head (one ray on their client). */
async function refreshStorey(p, now) {
  let e = storeys.get(p.id);
  if (!e) storeys.set(p.id, (e = { floor: null, roof: null, at: 0, checking: false, known: false }));
  if (e.checking || now - e.at < CFG.storeyIntervalMs) return;
  e.checking = true;
  e.at = now;
  try {
    const pos = v3(p.position);
    e.floor = floorAtSafe(pos);
    const h = headOf(p);
    const r = await trace(p, { x: pos.x, y: pos.y, z: pos.z + h }, { x: pos.x, y: pos.y, z: pos.z + h + CFG.roofRayLength });
    e.roof = r?.answered === true ? r.hits.some(isHorizontal) : null;
  } catch (err) {
    e.roof = null;
    console.log(`[${RESOURCE}] storey sample failed: ${err?.message ?? err}`);
  } finally {
    e.checking = false;
    e.known = true;
  }
}

/** storeys mode verdict for a pair: true/false, "rays" to fall back to head-to-head rays, "pending" before the first samples. */
function storeyVerdict(a, b, dz) {
  const ea = storeys.get(a.id), eb = storeys.get(b.id);
  if (!ea?.known || !eb?.known) return "pending";
  if (ea.floor == null || eb.floor == null || ea.roof == null || eb.roof == null || dz < CFG.storeyAmbiguousDiff) return "rays";
  return ea.roof && eb.roof && Math.abs(ea.floor - eb.floor) > CFG.storeyFloorDiff;
}

function tick() {
  if (!CFG.enabled) return;
  const now = Date.now();
  const players = Player.all().filter((p) => p.ready !== false);
  const storeysOn = CFG.mode === "storeys";
  if (storeysOn) {
    const ids = new Set(players.map((p) => p.id));
    for (const id of [...storeys.keys()]) if (!ids.has(id)) storeys.delete(id);
    for (const p of players) void refreshStorey(p, now);
  }
  const seen = new Set();
  const due = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      if (a.virtualWorld !== b.virtualWorld) continue;
      const pa = a.position, pb = b.position;
      const k = key(a, b);
      let s = pairs.get(k);
      const dz = Math.abs(pa.z - pb.z);
      if (dz < (s ? CFG.minHeightDiffRelease : CFG.minHeightDiff)) continue; // hysteresis against flicker on stairs
      const range = Math.max(Voice.getPlayerRange(a), Voice.getPlayerRange(b));
      if (pa.distance(pb) > range + 2) continue;
      seen.add(k);
      if (!s) pairs.set(k, (s = { a, b, muted: false, verdict: null, streak: 0, checking: false, lastCheck: 0, posA: null, posB: null, turn: 0, hot: false }));
      s.a = a;
      s.b = b;
      if (storeysOn) {
        const v = storeyVerdict(a, b, dz);
        if (v === "pending") continue;
        if (v !== "rays") { settle(s, v); continue; }
      }
      if (s.checking) continue;
      const settled = s.streak >= CFG.confirmTicks && s.muted === s.verdict;
      if (settled && !moved(s.posA, pa) && !moved(s.posB, pb)) continue;
      s.hot = talking(a) || talking(b);
      due.push(s);
    }
  }
  for (const k of [...pairs.keys()]) if (!seen.has(k)) releasePair(k); // same floor, out of range or gone
  due.sort((x, y) => (y.hot - x.hot) || (x.lastCheck - y.lastCheck)); // pairs with someone talking first
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

function findPlayer(who) {
  const all = Player.all();
  const id = Number(who);
  if (who !== "" && Number.isInteger(id)) {
    const byId = all.find((p) => p.id === id);
    if (byId) return byId;
  }
  const low = who.toLowerCase();
  return all.find((p) => String(p.nickname).toLowerCase() === low) ?? all.find((p) => String(p.nickname).toLowerCase().startsWith(low)) ?? null;
}

const mutedCount = () => [...pairs.values()].filter((s) => s.muted).length;

function statusLine() {
  return `voicefloors ${CFG.enabled ? "on" : "off"} (mode ${CFG.mode}): ${pairs.size} pairs watched, ${mutedCount()} muted across floors.`;
}

function statsLine() {
  const cutoff = Date.now() - 60_000;
  const r = recent.filter((x) => x.t >= cutoff);
  const answered = r.filter((x) => x.answered);
  const avg = answered.length ? Math.round(answered.reduce((sum, x) => sum + x.ms, 0) / answered.length) : 0;
  const unanswered = r.length ? Math.round((100 * (r.length - answered.length)) / r.length) : 0;
  return `voicefloors stats: ${r.length} rays in the last 60 s, avg client reply ${avg} ms, ${unanswered}% unanswered, pairs watched ${pairs.size}, muted ${mutedCount()}, mode ${CFG.mode}.`;
}

/** /voicefloors why: trace the pair now and list every hit on every ray from both clients. Diagnostic only, changes no mute. */
async function explain(a, b) {
  const pa = v3(a.position), pb = v3(b.position);
  const dz = Math.abs(pa.z - pb.z);
  const dist = a.position.distance(b.position);
  const range = Math.max(Voice.getPlayerRange(a), Voice.getPlayerRange(b));
  const { refZ, source, upper } = floorRef(a, b);
  const s = pairs.get(key(a, b));
  const state = s ? `${s.muted ? "muted" : "watched"}, last verdict ${s.verdict === null ? "none" : s.verdict ? "floor" : "open"}` : "not watched";
  const skip = dz < CFG.minHeightDiff ? ` (dz below minHeightDiff ${CFG.minHeightDiff})` : dist > range + 2 ? " (out of voice range)" : "";
  const lines = [
    `why ${a.nickname} <-> ${b.nickname}: dz ${fmt(dz)} m, distance ${fmt(dist)} m, mode ${CFG.mode}, pair ${state}${skip}.`,
    `floor window ${fmt(refZ - CFG.floorBelow)}..${fmt(refZ + CFG.floorAbove)} m from ${upper.nickname} (${source} z ${fmt(refZ)}); heads ${fmt(headOf(a))} / ${fmt(headOf(b))} m.`,
  ];
  if (CFG.mode === "storeys") {
    for (const p of [a, b]) {
      const e = storeys.get(p.id);
      lines.push(`storey ${p.nickname}: floor ${e?.floor == null ? "unknown" : fmt(e.floor)}, roof ${!e || e.roof === null ? "unknown" : e.roof ? "yes" : "no"}.`);
    }
  }
  const ha = headOf(a), hb = headOf(b);
  const [ra, rb] = await Promise.all([clientTrace(a, pa, pb, ha, hb, refZ), clientTrace(b, pb, pa, hb, ha, refZ)]);
  for (const [p, r] of [[a, ra], [b, rb]]) {
    lines.push(`client ${p.nickname}: ${r.floor === null ? "NO ANSWER" : r.floor ? "FLOOR on every ray" : "OPEN"}`);
    r.rays.forEach((ray, i) => {
      if (!ray.hits.length) lines.push(`  ray ${i + 1}: no hits -> open`);
      for (const h of ray.hits) {
        lines.push(`  ray ${i + 1}: ${h.hit.surface} ${h.hit.kind} nz ${fmt(h.hit.normal?.z)} z ${fmt(h.hit.position?.z)} -> ${h.reason === null ? "floor" : `not floor: ${h.reason}`}`);
      }
    });
  }
  const blocked = ra.floor === true || rb.floor === true;
  lines.push(`verdict: ${ra.floor === null && rb.floor === null ? "no answer, state kept" : blocked ? "floor between -> mute" : "open -> audible"}.`);
  return lines;
}

async function why(p, who) {
  if (!who) return say(p, "Usage: /voicefloors why <nick or id>");
  const target = findPlayer(who);
  if (!target) return say(p, `No player "${who}".`);
  if (target.id === p.id) return say(p, "Pick another player.");
  try {
    for (const line of await explain(p, target)) say(p, line);
  } catch (e) {
    say(p, `why failed: ${e?.message ?? e}`);
  }
}

/** /voicefloors set: runtime change of a number, boolean or `mode` key; not persisted. */
function setKey(p, k, v) {
  if (!k || v === undefined) return say(p, "Usage: /voicefloors set <key> <value>");
  if (!(k in DEFAULTS) || k === "admins" || k === "isAdmin") return say(p, `Unknown setting "${k}".`);
  const old = CFG[k];
  let next;
  if (k === "mode") {
    if (v !== "pairs" && v !== "storeys") return say(p, "mode must be pairs or storeys.");
    next = v;
  } else if (typeof old === "boolean") {
    const l = String(v).toLowerCase();
    if (!["true", "false", "on", "off", "1", "0"].includes(l)) return say(p, `${k} needs true or false.`);
    next = l === "true" || l === "on" || l === "1";
  } else if (typeof old === "number") {
    next = Number(v);
    if (!Number.isFinite(next)) return say(p, `${k} needs a number.`);
  } else {
    return say(p, `"${k}" cannot be set at runtime.`);
  }
  CFG[k] = next;
  if (k === "enabled") next ? start() : stop();
  if (k === "intervalMs" && timer) { clearInterval(timer); timer = null; start(); }
  say(p, `${k}: ${old} -> ${next} (until the resource restarts).`);
}

Events.on("playerCommand", (p, cmd, args) => {
  if (cmd !== RESOURCE) return;
  const sub = (args[0] ?? "status").toLowerCase();
  if (sub === "status") return say(p, statusLine());
  if (!isAdmin(p)) return say(p, "Only voicefloors admins can do that (admins or isAdmin in config.js).");
  if (sub === "on") return (CFG.enabled = true), start(), say(p, "voicefloors on.");
  if (sub === "off") return (CFG.enabled = false), stop(), say(p, "voicefloors off, all its mutes released.");
  if (sub === "debug") return (debugTo = debugTo === p.id ? null : p.id), say(p, `debug ${debugTo === p.id ? "on" : "off"}.`);
  if (sub === "stats") return say(p, statsLine());
  if (sub === "set") return setKey(p, args[1], args[2]);
  if (sub === "why") return void why(p, args.slice(1).join(" ").trim());
  say(p, "Usage: /voicefloors status|on|off|debug|stats|why <nick or id>|set <key> <value>");
});

Events.on("playerDisconnect", (p) => {
  for (const [k, s] of [...pairs]) if (s.a.id === p.id || s.b.id === p.id) releasePair(k); // the other player hears again
  for (const k of [...ours]) if (k.startsWith(`${p.id}>`) || k.endsWith(`>${p.id}`)) ours.delete(k);
  storeys.delete(p.id);
  if (debugTo === p.id) debugTo = null;
});

Events.on("resourceStop", (name) => {
  if (name === RESOURCE) stop();
});

if (CFG.enabled) start();

// for tests
globalThis.__voicefloors = { tick, pairs, ours, storeys, recent, CFG, isFloor, hitReason, rays, explain };
