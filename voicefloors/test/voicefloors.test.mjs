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

function setup({ admins = [] } = {}) {
  const handlers = {};
  const mutes = new Set(); // "listener>talker"
  const chat = [];
  const players = [];
  const traces = []; // { asker, from, to }
  // world(askerId, from, to) -> { answered, hits }
  let world = () => ({ answered: true, hits: [] });
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
      setLocalMute: (l, t, m) => (m ? mutes.add(`${l.id}>${t.id}`) : mutes.delete(`${l.id}>${t.id}`)),
    },
    World: {
      raycastAll: async (asker, from, to) => (traces.push({ asker: asker.id, from, to }), world(asker.id, from, to)),
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(src, "config.js"), "utf8"), ctx);
  ctx.VOICEFLOORS_CONFIG.admins = admins;
  vm.runInContext(readFileSync(join(src, "server.js"), "utf8"), ctx);
  const vf = ctx.__voicefloors;
  const add = (id, x, y, z, extra = {}) => {
    const p = { id, nickname: "p" + id, steamId: "s" + id, virtualWorld: 0, ready: true, position: new V3(x, y, z), ...extra };
    players.push(p);
    return p;
  };
  const flush = () => new Promise((r) => setImmediate(r));
  const ticks = async (n) => { for (let i = 0; i < n; i++) { vf.tick(); await flush(); await flush(); } };
  const emit = (n, ...a) => (handlers[n] ?? []).forEach((f) => f(...a));
  return { vf, mutes, chat, players, traces, add, ticks, emit, setWorld: (f) => (world = f) };
}

const floorHit = { kind: "brush", surface: "mat_wood", normal: { x: 0, y: 0, z: 1 }, position: { x: 0, y: 0, z: 3 } };
const wallHit = { kind: "brush", surface: "mat_plaster", normal: { x: 1, y: 0, z: 0 }, position: { x: 0, y: 0, z: 2 } };
const terrainHit = { kind: "terrain", surface: "mat_soil", normal: { x: 0, y: 0, z: 1 }, position: { x: 0, y: 0, z: 2 } };
const stairsHit = { kind: "brush", surface: "mat_stairs_wood", normal: { x: 0, y: 0, z: 0.9 }, position: { x: 0, y: 0, z: 2 } };
const answer = (hits) => ({ answered: true, hits });

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
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", e.message); }
}
console.log(failed ? `${failed} failed` : `all ${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
