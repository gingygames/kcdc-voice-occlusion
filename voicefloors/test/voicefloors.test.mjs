// node voicefloors/test/voicefloors.test.mjs — runs the resource against a fake KCDC server API.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

class V3 {
  constructor(x, y, z) { Object.assign(this, { x, y, z }); }
  distance(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); }
}

function setup({ admins = [], config = {}, talkingApi = true } = {}) {
  const handlers = {};
  const mutes = new Set(); // "listener>talker"
  const chat = [];
  const players = [];
  const talking = new Set(); // player ids Voice.isPlayerTalking reports
  const traces = []; // { asker, from, to }
  // world(askerId, from, to) -> { answered, hits }
  let world = () => ({ answered: true, hits: [] });
  // floorAt(point) -> number | null (Navigation.floorAt)
  let floorAt = () => null;
  // muteFails(listener, talker) -> true makes Voice.setLocalMute throw, like a handle of a player who left
  let muteFails = () => false;
  const ctx = {
    console: { log() {} },
    setInterval: () => 1,
    clearInterval: () => {},
    Promise, Math, Object, String, Date, Set, Map, Number,
    Events: { on: (n, f) => ((handlers[n] ??= []).push(f)) },
    Chat: { sendToPlayer: (p, t) => chat.push([p.id, t]) },
    Player: { all: () => players.slice() },
    Voice: {
      getPlayerRange: () => 25,
      isLocallyMuted: (l, t) => mutes.has(`${l.id}>${t.id}`),
      setLocalMute: (l, t, m) => {
        if (muteFails(l, t)) throw new Error("invalid entity");
        return m ? mutes.add(`${l.id}>${t.id}`) : mutes.delete(`${l.id}>${t.id}`);
      },
    },
    World: {
      raycastAll: async (asker, from, to) => (traces.push({ asker: asker.id, from, to }), world(asker.id, from, to)),
    },
    Navigation: { floorAt: (p) => floorAt(p) },
  };
  if (talkingApi) ctx.Voice.isPlayerTalking = (p) => talking.has(p.id);
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(src, "config.js"), "utf8"), ctx);
  ctx.VOICEFLOORS_CONFIG.admins = admins;
  Object.assign(ctx.VOICEFLOORS_CONFIG, config);
  vm.runInContext(readFileSync(join(src, "server.js"), "utf8"), ctx);
  const vf = ctx.__voicefloors;
  const add = (id, x, y, z, extra = {}) => {
    const p = { id, nickname: "p" + id, steamId: "s" + id, virtualWorld: 0, ready: true, crouched: false, position: new V3(x, y, z), ...extra };
    players.push(p);
    return p;
  };
  const flush = () => new Promise((r) => setImmediate(r));
  const ticks = async (n) => { for (let i = 0; i < n; i++) { vf.tick(); await flush(); await flush(); await flush(); } };
  const emit = (n, ...a) => (handlers[n] ?? []).forEach((f) => f(...a));
  const cmd = (p, ...args) => emit("playerCommand", p, "voicefloors", args);
  return {
    vf, mutes, chat, players, traces, talking, add, ticks, flush, emit, cmd,
    setWorld: (f) => (world = f),
    setFloorAt: (f) => (floorAt = f),
    setMuteFails: (f) => (muteFails = f),
  };
}

const floorHit = { kind: "brush", surface: "mat_wood", normal: { x: 0, y: 0, z: 1 }, position: { x: 0, y: 0, z: 3 } };
const wallHit = { kind: "brush", surface: "mat_plaster", normal: { x: 1, y: 0, z: 0 }, position: { x: 0, y: 0, z: 2 } };
const terrainHit = { kind: "terrain", surface: "mat_soil", normal: { x: 0, y: 0, z: 1 }, position: { x: 0, y: 0, z: 2 } };
const stairsHit = { kind: "brush", surface: "mat_stairs_wood", normal: { x: 0, y: 0, z: 0.9 }, position: { x: 0, y: 0, z: 2 } };
const hitAt = (z, extra = {}) => ({ ...floorHit, position: { x: 0, y: 0, z }, ...extra });
const answer = (hits) => ({ answered: true, hits });
const isRoofRay = (from, to) => from.x === to.x && from.y === to.y && to.z > from.z;

const tests = {
  async "floor between two storeys: muted both ways after confirmTicks"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setWorld(() => answer([floorHit]));
    await t.ticks(1);
    assert.equal(t.mutes.size, 0, "not muted after the first verdict");
    await t.ticks(1);
    assert.deepEqual([...t.mutes].sort(), ["1>2", "2>1"]);
  },
  async "walking down to the same floor unmutes"() {
    const t = setup();
    const [, b] = [t.add(1, 0, 0, 0), t.add(2, 2, 0, 3.2)];
    t.setWorld(() => answer([floorHit]));
    await t.ticks(2);
    b.position = new V3(2, 0, 0.3);
    await t.ticks(1);
    assert.equal(t.mutes.size, 0);
  },
  async "gallery: one ray gets through, stays audible"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 4, 0, 3.2);
    let n = 0;
    t.setWorld(() => answer(n++ % 3 === 1 ? [] : [floorHit]));
    await t.ticks(3);
    assert.equal(t.mutes.size, 0);
  },
  async "either client reporting a floor mutes (a lying client cannot eavesdrop)"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setWorld((asker) => answer(asker === 2 ? [] : [floorHit]));
    await t.ticks(2);
    assert.equal(t.mutes.size, 2);
  },
  async "walls, terrain and stairs are not floors"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setWorld(() => answer([wallHit, terrainHit, stairsHit]));
    await t.ticks(3);
    assert.equal(t.mutes.size, 0);
  },
  async "same floor or out of range: no traces at all"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 3, 0, 1.0); t.add(3, 60, 0, 5);
    await t.ticks(3);
    assert.equal(t.traces.length, 0);
  },
  async "unanswered traces keep the current state"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setWorld(() => answer([floorHit]));
    await t.ticks(2);
    t.setWorld(() => ({ answered: false, hits: [] }));
    t.players[1].position = new V3(2.5, 0, 3.2); // moved, so it is re-checked
    await t.ticks(2);
    assert.equal(t.mutes.size, 2);
  },
  async "a mute someone else set is never touched"() {
    const t = setup();
    const [a, b] = [t.add(1, 0, 0, 0), t.add(2, 2, 0, 3.2)];
    t.mutes.add("1>2"); // e.g. the player muted them
    t.setWorld(() => answer([floorHit]));
    await t.ticks(2);
    b.position = new V3(2, 0, 0);
    await t.ticks(1);
    assert.deepEqual([...t.mutes], ["1>2"]);
    assert.ok(a);
  },
  async "settled pairs are not re-traced while nobody moves"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setWorld(() => answer([floorHit]));
    await t.ticks(2);
    const n = t.traces.length;
    await t.ticks(5);
    assert.equal(t.traces.length, n);
  },
  async "different virtual worlds are ignored"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2, { virtualWorld: 7 });
    await t.ticks(2);
    assert.equal(t.traces.length, 0);
  },
  async "resource stop releases every mute it set"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setWorld(() => answer([floorHit]));
    await t.ticks(2);
    t.emit("resourceStop", "voicefloors");
    assert.equal(t.mutes.size, 0);
  },
  async "admin commands need a listed Steam ID; status is open"() {
    const t = setup({ admins: ["s1"] });
    const [a, b] = [t.add(1, 0, 0, 0), t.add(2, 2, 0, 0)];
    t.emit("playerCommand", b, "voicefloors", ["off"]);
    assert.equal(t.vf.CFG.enabled, true);
    t.emit("playerCommand", a, "voicefloors", ["off"]);
    assert.equal(t.vf.CFG.enabled, false);
    t.emit("playerCommand", b, "voicefloors", []);
    assert.match(t.chat.at(-1)[1], /voicefloors off/);
  },
  async "three rays: centre plus one each side"() {
    const t = setup();
    const r = t.vf.rays({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 3 });
    assert.equal(r.length, 3);
    assert.deepEqual(Array.from(r, ([f]) => f.y), [0, 0.5, -0.5]);
    assert.equal(r[0][0].z, 1.6);
  },

  // --- 0.2.0 ---

  async "floor window: a table top by the lower head is not a floor, the slab at the upper feet is"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setWorld(() => answer([hitAt(1.0)])); // horizontal wood at 1.0 m: a table, not in [2.6, 3.5]
    await t.ticks(3);
    assert.equal(t.mutes.size, 0, "table top muted the pair");
    t.setWorld(() => answer([hitAt(1.0), hitAt(2.9)])); // plus the ceiling slab under the upper floor
    t.players[1].position = new V3(2.5, 0, 3.2);
    await t.ticks(2);
    assert.equal(t.mutes.size, 2);
    assert.equal(t.vf.hitReason(hitAt(1.0), 3.2), "z outside floor window 2.60..3.50");
    assert.equal(t.vf.hitReason(hitAt(2.9), 3.2), null);
  },
  async "floor window uses Navigation.floorAt for the upper player when it answers"() {
    const t = setup();
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.9); // mid-jump: position 3.9, floor 3.2
    t.setFloorAt((p) => (p.z > 3 ? 3.2 : 0));
    t.setWorld(() => answer([hitAt(2.9)])); // in [2.6, 3.5] from floorAt; outside [3.3, 4.2] from the position
    await t.ticks(2);
    assert.equal(t.mutes.size, 2);
  },
  async "hysteresis: a watched pair on the stairs is released only below minHeightDiffRelease"() {
    const t = setup();
    const [, b] = [t.add(1, 0, 0, 0), t.add(2, 2, 0, 1.9)];
    t.setWorld(() => answer([hitAt(1.7)]));
    await t.ticks(2);
    assert.equal(t.mutes.size, 2, "muted at dz 1.9");
    b.position = new V3(2.5, 0, 1.6); // dz 1.6: below minHeightDiff, above the release threshold
    await t.ticks(2);
    assert.equal(t.vf.pairs.size, 1, "still watched at dz 1.6");
    assert.equal(t.mutes.size, 2);
    b.position = new V3(3, 0, 1.3); // dz 1.3: released
    await t.ticks(1);
    assert.equal(t.vf.pairs.size, 0);
    assert.equal(t.mutes.size, 0);
    const t2 = setup();
    t2.add(1, 0, 0, 0); t2.add(2, 2, 0, 1.6); // a new pair at dz 1.6 is not watched
    await t2.ticks(2);
    assert.equal(t2.vf.pairs.size, 0);
  },
  async "crouching lowers that player's end of the rays"() {
    const t = setup();
    t.add(1, 0, 0, 0, { crouched: true }); t.add(2, 2, 0, 3.2);
    t.setWorld(() => answer([]));
    await t.ticks(1);
    const fromA = t.traces.find((x) => x.asker === 1);
    const fromB = t.traces.find((x) => x.asker === 2);
    assert.equal(fromA.from.z, 1.1, "crouched player's head");
    assert.equal(fromA.to.z, 3.2 + 1.6, "standing player's head");
    assert.equal(fromB.from.z, 3.2 + 1.6);
    assert.equal(fromB.to.z, 1.1);
  },
  async "pairs with someone talking are checked first"() {
    const t = setup({ config: { maxChecksPerTick: 1 } });
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2); t.add(3, -2, 0, 3.2); // 1:2 and 1:3 due, 2:3 same floor
    t.talking.add(3);
    await t.ticks(1);
    assert.ok(t.traces.some((x) => x.asker === 3), "the talking pair was traced");
    assert.ok(!t.traces.some((x) => x.asker === 2), "the silent pair waited");
  },
  async "no Voice.isPlayerTalking in the API: nobody is talking, nothing breaks"() {
    const t = setup({ talkingApi: false });
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setWorld(() => answer([floorHit]));
    await t.ticks(2);
    assert.equal(t.mutes.size, 2);
  },
  async "shortcut: after a floor verdict one client is asked (alternating), the other only when it says open"() {
    const t = setup();
    const [, b] = [t.add(1, 0, 0, 0), t.add(2, 2, 0, 3.2)];
    t.setWorld(() => answer([floorHit]));
    await t.ticks(2);
    assert.equal(t.mutes.size, 2);
    assert.equal(t.traces.length, 9, "tick 1 asks both clients (6 rays), tick 2 already has a floor verdict and asks one (3)");
    const first = new Set(t.traces.slice(6).map((x) => x.asker));
    assert.equal(first.size, 1);
    const [x] = [...first];
    const y = x === 1 ? 2 : 1;
    b.position = new V3(2.5, 0, 3.2);
    await t.ticks(1);
    assert.equal(t.traces.length, 12);
    assert.deepEqual([...new Set(t.traces.slice(9).map((h) => h.asker))], [y], "the other client this time");
    t.setWorld((asker) => answer(asker === x ? [] : [floorHit])); // x now says open, y still sees the floor
    b.position = new V3(3, 0, 3.2);
    await t.ticks(1);
    assert.equal(t.traces.length, 18, "x asked first, then y");
    assert.deepEqual(t.traces.slice(12, 15).map((h) => h.asker), [x, x, x]);
    assert.deepEqual(t.traces.slice(15).map((h) => h.asker), [y, y, y]);
    assert.equal(t.mutes.size, 2, "one client reporting a floor still mutes");
    t.setWorld(() => answer([]));
    b.position = new V3(3.5, 0, 3.2);
    await t.ticks(2);
    assert.equal(t.mutes.size, 0);
    assert.equal(t.traces.length, 18 + 6 + 6, "first tick: one then the other; second tick (open verdict): both at once");
    b.position = new V3(4, 0, 3.2);
    await t.ticks(1);
    assert.equal(t.traces.length, 36, "after an open verdict both clients are asked at once");
  },
  async "disconnect releases the mute of the player who stayed, even if the gone handle throws"() {
    const t = setup();
    const [, b] = [t.add(1, 0, 0, 0), t.add(2, 2, 0, 3.2)];
    t.setWorld(() => answer([floorHit]));
    await t.ticks(2);
    assert.equal(t.mutes.size, 2);
    t.players.splice(1, 1);
    t.setMuteFails((l) => l.id === 2);
    t.emit("playerDisconnect", b);
    assert.ok(!t.mutes.has("1>2"), "player 1 hears again");
    assert.equal(t.vf.pairs.size, 0);
    assert.equal(t.vf.ours.size, 0);
  },
  async "isAdmin hook replaces the admins list"() {
    const t = setup({ admins: ["s1"], config: { isAdmin: (p) => p.id === 2 } });
    const [a, b] = [t.add(1, 0, 0, 0), t.add(2, 2, 0, 0)];
    t.cmd(a, "off");
    assert.equal(t.vf.CFG.enabled, true, "listed Steam ID is ignored when isAdmin is set");
    t.cmd(b, "off");
    assert.equal(t.vf.CFG.enabled, false);
  },
  async "/voicefloors why traces the pair now and explains every hit"() {
    const t = setup({ admins: ["s1"] });
    const [a] = [t.add(1, 0, 0, 0), t.add(2, 2, 0, 3.2)];
    t.setWorld((asker) => answer(asker === 1 ? [hitAt(1.0), floorHit] : [wallHit]));
    t.cmd(a, "why", "p2");
    await t.flush(); await t.flush(); await t.flush();
    const lines = t.chat.filter(([id]) => id === 1).map(([, l]) => l);
    assert.match(lines[0], /^why p1 <-> p2: dz 3\.20 m, distance 3\.77 m, mode pairs, pair not watched\./);
    assert.match(lines[1], /floor window 2\.60\.\.3\.50 m from p2 \(position z 3\.20\)/);
    assert.ok(lines.includes("client p1: FLOOR on every ray"), lines.join("\n"));
    assert.ok(lines.includes("  ray 1: mat_wood brush nz 1.00 z 1.00 -> not floor: z outside floor window 2.60..3.50"));
    assert.ok(lines.includes("  ray 1: mat_wood brush nz 1.00 z 3.00 -> floor"));
    assert.ok(lines.includes("client p2: OPEN"));
    assert.ok(lines.includes("  ray 3: mat_plaster brush nz 0.00 z 2.00 -> not floor: not horizontal"));
    assert.equal(lines.at(-1), "verdict: floor between -> mute.");
    assert.equal(t.mutes.size, 0, "why changes no mute");
    t.cmd(a, "why", "nobody");
    assert.equal(t.chat.at(-1)[1], 'No player "nobody".');
    t.cmd(a, "why", "2"); // by id too
    await t.flush(); await t.flush(); await t.flush();
    assert.match(t.chat.at(-1)[1], /^verdict:/);
  },
  async "/voicefloors stats reports rays, reply time, unanswered share and pairs"() {
    const t = setup({ admins: ["s1"] });
    const [a] = [t.add(1, 0, 0, 0), t.add(2, 2, 0, 3.2)];
    let n = 0;
    t.setWorld(() => (n++ % 6 === 0 ? { answered: false, hits: [] } : answer([floorHit])));
    await t.ticks(2); // tick 1: client 1 unanswered, client 2 floor; tick 2: client 2 unanswered, then client 1 floor
    t.cmd(a, "stats");
    const line = t.chat.at(-1)[1];
    assert.match(line, /^voicefloors stats: 12 rays in the last 60 s, avg client reply \d+ ms, 17% unanswered, pairs watched 1, muted 1, mode pairs\.$/);
    t.cmd(t.players[1], "stats");
    assert.match(t.chat.at(-1)[1], /^Only voicefloors admins/);
  },
  async "/voicefloors set changes number, boolean and mode keys at runtime, rejects the rest"() {
    const t = setup({ admins: ["s1"] });
    const [a] = [t.add(1, 0, 0, 0)];
    t.cmd(a, "set", "intervalMs", "250");
    assert.equal(t.chat.at(-1)[1], "intervalMs: 500 -> 250 (until the resource restarts).");
    assert.equal(t.vf.CFG.intervalMs, 250);
    t.cmd(a, "set", "enabled", "false");
    assert.equal(t.vf.CFG.enabled, false);
    assert.match(t.chat.at(-1)[1], /^enabled: true -> false/);
    t.cmd(a, "set", "mode", "storeys");
    assert.equal(t.vf.CFG.mode, "storeys");
    t.cmd(a, "set", "mode", "sideways");
    assert.equal(t.chat.at(-1)[1], "mode must be pairs or storeys.");
    t.cmd(a, "set", "intervalMs", "fast");
    assert.equal(t.chat.at(-1)[1], "intervalMs needs a number.");
    assert.equal(t.vf.CFG.intervalMs, 250);
    t.cmd(a, "set", "nosuch", "1");
    assert.equal(t.chat.at(-1)[1], 'Unknown setting "nosuch".');
    t.cmd(a, "set", "admins", "x");
    assert.equal(t.chat.at(-1)[1], 'Unknown setting "admins".');
    t.cmd(a, "set", "intervalMs");
    assert.equal(t.chat.at(-1)[1], "Usage: /voicefloors set <key> <value>");
    t.cmd(a, "status");
    assert.equal(t.chat.at(-1)[1], "voicefloors off (mode storeys): 0 pairs watched, 0 muted across floors.");
  },
  async "storeys: both under a roof on different floors are muted from one roof ray per player"() {
    const t = setup({ config: { mode: "storeys" } });
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setFloorAt((p) => p.z);
    t.setWorld((asker, from, to) => answer(isRoofRay(from, to) ? [hitAt(from.z + 2, { normal: { x: 0, y: 0, z: -1 } })] : []));
    await t.ticks(3);
    assert.equal(t.mutes.size, 2);
    assert.equal(t.traces.length, 2, "one ray per player, nothing head to head");
    assert.ok(t.traces.every((x) => isRoofRay(x.from, x.to)));
    assert.equal(t.traces[0].to.z - t.traces[0].from.z, 6, "roofRayLength");
    assert.equal(t.vf.storeys.get(2).floor, 3.2);
  },
  async "storeys: nobody under a roof, or only one, stays audible without head-to-head rays"() {
    const t = setup({ config: { mode: "storeys" } });
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setFloorAt((p) => p.z);
    t.setWorld((asker, from, to) => answer(isRoofRay(from, to) && asker === 2 ? [hitAt(from.z + 2)] : []));
    await t.ticks(3);
    assert.equal(t.mutes.size, 0);
    assert.equal(t.traces.length, 2);
  },
  async "storeys: same storey under one roof (a sloping floor) is not muted"() {
    const t = setup({ config: { mode: "storeys" } });
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 2.6);
    t.setFloorAt((p) => (p.z > 1 ? 1.5 : 0)); // the mesh says 1.5 m apart, within storeyFloorDiff
    t.setWorld((asker, from, to) => answer(isRoofRay(from, to) ? [hitAt(from.z + 2)] : [floorHit]));
    await t.ticks(3);
    assert.equal(t.mutes.size, 0);
    assert.equal(t.traces.length, 2);
  },
  async "storeys: ambiguous height (gallery) or unknown floor falls back to head-to-head rays"() {
    const t = setup({ config: { mode: "storeys" } });
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 2.0); // dz 2.0: in the band minHeightDiffRelease..storeyAmbiguousDiff
    t.setFloorAt((p) => p.z);
    t.setWorld((asker, from, to) => answer(isRoofRay(from, to) ? [hitAt(from.z + 2)] : [hitAt(1.8)]));
    await t.ticks(3);
    assert.equal(t.mutes.size, 2, "rays decided it");
    assert.ok(t.traces.some((x) => !isRoofRay(x.from, x.to)), "head-to-head rays were used");
    const t2 = setup({ config: { mode: "storeys" } });
    t2.add(1, 0, 0, 0); t2.add(2, 2, 0, 3.2);
    t2.setFloorAt(() => null); // no navmesh here
    t2.setWorld((asker, from, to) => answer(isRoofRay(from, to) ? [hitAt(from.z + 2)] : []));
    await t2.ticks(3);
    assert.equal(t2.mutes.size, 0);
    assert.ok(t2.traces.some((x) => !isRoofRay(x.from, x.to)), "head-to-head rays were used");
  },
  async "storeys: samples once per storeyIntervalMs and drops players who left"() {
    const t = setup({ config: { mode: "storeys" } });
    t.add(1, 0, 0, 0); t.add(2, 2, 0, 3.2);
    t.setFloorAt((p) => p.z);
    t.setWorld((asker, from, to) => answer(isRoofRay(from, to) ? [hitAt(from.z + 2)] : []));
    await t.ticks(5);
    assert.equal(t.traces.length, 2, "no re-sampling within the interval");
    t.players.pop();
    await t.ticks(1);
    assert.deepEqual([...t.vf.storeys.keys()], [1]);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", e.message); }
}
console.log(failed ? `${failed} failed` : `all ${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
