// node quietactions/test/quietactions.test.mjs — server and client against a fake KCDC API in one process.
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
  const sh = {}, ch = {};
  const chat = [], audio = [];
  const players = [];
  // one client, attached to player 1
  const mk = (id, x, y, z, extra = {}) => ({
    id, nickname: "p" + id, steamId: "s" + id, virtualWorld: 0, ready: true, position: new V3(x, y, z),
    emit: (n, payload) => { if (id === 1) (ch[n] ?? []).forEach((f) => f(payload)); },
    ...extra,
  });
  players.push(mk(1, 0, 0, 0), mk(2, 5, 0, 0), mk(3, 500, 0, 0));
  const entities = { 1: 101, 2: 102, 3: 103 };
  const client = {
    console, Math, Object, String, Number, JSON, Date, setInterval: () => 9, clearInterval: () => {},
    Events: { on: (n, f) => ((ch[n] ??= []).push(f)), emitServer: (n, payload) => (sh[n] ?? []).forEach((f) => f(players[0], payload)) },
    Audio: { stopOnEntity: (t, e) => (audio.push(["stop", t, e]), true), playOnEntity: (t, e) => (audio.push(["play", t, e]), true) },
    Player: class { constructor(id) { this.id = id; } get entityId() { return entities[this.id] ?? 0; } },
    LocalPlayer: { entityId: 101 },
  };
  client.globalThis = client;
  const server = {
    console: { log() {} }, Math, Object, String, Number, JSON, Date, setInterval: () => 1, clearInterval: () => {},
    Events: { on: (n, f) => ((sh[n] ??= []).push(f)), onClient: (n, f) => ((sh[n] ??= []).push(f)) },
    Chat: { sendToPlayer: (p, t) => chat.push([p.id, t]) },
    Player: { all: () => players.slice() },
  };
  server.globalThis = server;
  for (const ctx of [client, server]) vm.createContext(ctx);
  vm.runInContext(readFileSync(join(src, "config.js"), "utf8"), server);
  server.QUIETACTIONS_CONFIG.admins = admins;
  vm.runInContext(readFileSync(join(src, "server.js"), "utf8"), server);
  vm.runInContext(readFileSync(join(src, "client.js"), "utf8"), client); // emits hello -> config arrives
  const s = server.__quietactions, c = client.__quietactionsClient;
  const emit = (n, ...a) => (sh[n] ?? []).forEach((f) => f(...a));
  const cmd = (...args) => emit("playerCommand", players[0], "quietactions", args);
  return { s, c, chat, audio, players, emit, cmd, last: () => chat.at(-1)?.[1] ?? "" };
}

const tests = {
  "hello: client receives the config and polls the configured triggers"(t) {
    assert.equal(t.c.cfg.enabled, true);
    assert.deepEqual(t.c.cfg.pollTriggers, ["special_player_washing", "special_player_cooking", "special_washing_laundry"]);
  },
  "near: only other players within radius, and only when the list changes"(t) {
    t.s.tickNear();
    assert.deepEqual(t.c.near, [2]);
    const n = t.s.lastNear.size;
    t.s.tickNear();
    assert.equal(t.s.lastNear.size, n);
    t.players[2].position = new V3(10, 0, 0);
    t.s.tickNear();
    assert.deepEqual(t.c.near, [2, 3]);
  },
  "poll silences the player-only triggers on other bodies, never on the local body"(t) {
    t.s.tickNear();
    t.c.poll();
    const stops = t.audio.filter((a) => a[0] === "stop");
    assert.equal(stops.length, 3);
    assert.ok(stops.every((a) => a[2] === 102), "only player 2's body");
    assert.deepEqual(stops.map((a) => a[1]), ["special_player_washing", "special_player_cooking", "special_washing_laundry"]);
    assert.equal(t.c.stats.stopped, 3);
  },
  "dice roll: cut the dice sounds on both bodies and play the table sound on the acting body"(t) {
    t.players[2].position = new V3(8, 0, 0);
    t.emit("diceMatchStart", 7, t.players[1], t.players[2], 1000);
    t.emit("diceRoll", { match: 7, player: 3, faces: [1, 2, 3, 4, 5, 6] });
    const stops = t.audio.filter((a) => a[0] === "stop");
    assert.equal(stops.length, 6, "3 triggers x 2 bodies");
    assert.deepEqual([...new Set(stops.map((a) => a[2]))].sort(), [102, 103]);
    assert.deepEqual(t.audio.filter((a) => a[0] === "play"), [["play", "dice_table_short", 103]]);
    assert.equal(t.c.stats.rolls, 1);
  },
  "dice events other than a roll only silence"(t) {
    t.emit("diceMatchStart", 7, t.players[1], t.players[2], 1000);
    t.players[2].position = new V3(8, 0, 0);
    t.emit("diceTurnStart", { match: 7, player: 2 });
    assert.equal(t.audio.filter((a) => a[0] === "play").length, 0);
    assert.ok(t.audio.filter((a) => a[0] === "stop").length > 0);
  },
  "dice table out of radius: nothing reaches this client"(t) {
    t.emit("diceMatchStart", 8, t.players[2], t.players[1], 1000); // player 3 at 500 m acts
    t.emit("diceRoll", { match: 8, player: 3 });
    assert.equal(t.audio.length, 0);
  },
  "match end forgets the match; disconnect forgets its players"(t) {
    t.emit("diceMatchStart", 7, t.players[1], t.players[2], 1000);
    assert.equal(t.s.matches.size, 1);
    t.emit("diceMatchEnd", 7, t.players[1], t.players[2], 0, "won", 1000, 200);
    assert.equal(t.s.matches.size, 0);
    t.emit("diceMatchStart", 9, t.players[1], t.players[2], 1000);
    t.emit("playerDisconnect", t.players[1]);
    assert.equal(t.s.matches.size, 0);
  },
  "off disables polling on the client and admin commands need a listed Steam ID"(t) {
    t.cmd("off");
    assert.equal(t.s.CFG.enabled, true, "non-admin cannot turn it off");
    const u = setup({ admins: ["s1"] });
    u.cmd("off");
    assert.equal(u.s.CFG.enabled, false);
    assert.equal(u.c.cfg.enabled, false);
    u.s.tickNear();
    u.c.poll();
    assert.equal(u.audio.length, 0);
    u.cmd("status");
    assert.match(u.last(), /quietactions off/);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(setup()); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", e.message); }
}
console.log(failed ? `${failed} failed` : `all ${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
