// node probe/test/probe.test.mjs [path/to/other/strings.js]
// Runs server.js and client.js against a fake KCDC API: every command, every event, every string. With a path to a
// translated strings file it checks that translation too (the Czech hlassonda build passes its strings.cs.js).
import * as fs from "node:fs";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const stringsFile = process.argv[2] ?? join(src, "strings.js");
const tmp = join(dirname(fileURLToPath(import.meta.url)), "tmp-resources");

class V3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  distance(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); }
}

function setup() {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  // Both sides in one process: server `p.emit` delivers to the client handlers, client `Events.emitServer` back.
  const sh = {}, ch = {};
  const chat = [], hud = [];
  const audio = [];
  const npcs = [];
  const client = {
    console, Math, Object, String, Number, Date, JSON, Promise, setTimeout: (f) => f(), setInterval: () => 7, clearInterval: () => {},
    Vector3: V3,
    Events: { on: (n, f) => ((ch[n] ??= []).push(f)), emitServer: (n, payload) => (sh[n] ?? []).forEach((f) => f(players[0], payload)) },
    Hud: { showNotification: (t) => hud.push(t) },
    World: { entitiesInRadius: () => [{ entityId: 42, class: "NPC_NAI", distance: 0.4 }], raycastAll: () => [{ surface: "mat_wood" }, { surface: "mat_rock" }] },
    Audio: {
      stopAllOnEntity: () => (audio.push(["stopAll"]), true), stopOnEntity: (t) => (audio.push(["stopOne", t]), true), setEntitySwitch: (e, s, st) => (audio.push(["switch", st]), true),
      playFile: (f, e, purpose) => (audio.push(["file", f, purpose]), true), playOnEntity: (t) => (audio.push(["trigger", t]), true),
      setEntityParameter: (e, name, v) => (audio.push(["param", name, v]), name === "occlusion"),
    },
    Camera: { third: false, setThirdPerson(o) { this.third = o != null; }, isThirdPerson() { return this.third; } },
    Voice: { isPlayerTalking: (p) => p.id === 2, isTalking: () => false, getTier: () => 1, getRange: () => 25 },
    Player: class { constructor(id) { this.id = id; } },
    LocalPlayer: { entityId: 1, position: new V3(10, 10, 100) },
  };
  client.globalThis = client;
  const players = [];
  const mk = (id, x, y, z) => ({ id, nickname: "p" + id, virtualWorld: 0, position: new V3(x, y, z), emit: (n, payload) => (ch[n] ?? []).forEach((f) => f(payload)) });
  players.push(mk(1, 10, 10, 100), mk(2, 14, 10, 103.5), mk(3, 200, 200, 100));
  const server = {
    console: { log() {} }, Math, Object, String, Number, Date, JSON, Promise,
    require: (m) => (m === "fs" ? { ...fsShim } : null),
    Events: { on: (n, f) => ((sh[n] ??= []).push(f)), onClient: (n, f) => ((sh[n] ??= []).push(f)) },
    Chat: { sendToPlayer: (p, t) => chat.push([p.id, t]) },
    Npc: { create: (o) => { const n = { ...o, removed: false, remove() { this.removed = true; } }; npcs.push(n); return n; } },
    Player: { all: () => players.slice() },
    Navigation: { floorAt: (pt) => pt.z - 0.1, findPath: (a, b, o) => ({ length: o.doors === "none" ? 30 : 12, complete: o.doors !== "none", points: [] }) },
  };
  server.globalThis = server;
  // fs shim rooted in tmp (the resource writes resources/<name>/data/results.json relative to the server folder)
  const fsShim = {
    existsSync: (p) => fs.existsSync(join(tmp, p)),
    mkdirSync: (p, o) => fs.mkdirSync(join(tmp, p), o),
    readFileSync: (p, enc) => fs.readFileSync(join(tmp, p), enc),
    writeFileSync: (p, data) => fs.writeFileSync(join(tmp, p), data),
  };
  for (const ctx of [client, server]) {
    vm.createContext(ctx);
    vm.runInContext(readFileSync(stringsFile, "utf8"), ctx);
  }
  vm.runInContext(readFileSync(join(src, "server.js"), "utf8"), server);
  vm.runInContext(readFileSync(join(src, "client.js"), "utf8"), client);
  const T = server.VOICEPROBE_I18N;
  const cmd = (sub, ...args) => (sh.playerCommand ?? []).forEach((f) => f(players[0], T.name, sub == null ? [] : [sub, ...args]));
  const last = () => chat.at(-1)?.[1] ?? "";
  return { T, cmd, chat, hud, audio, npcs, players, last, emit: (n, ...a) => (sh[n] ?? []).forEach((f) => f(...a)), fs: fsShim, client };
}

const tests = {
  "spawn: NPC created, client finds it and plays in MultiRay"(t) {
    t.cmd();
    assert.equal(t.npcs.length, 1);
    assert.equal(t.npcs[0].name, t.T.npcName);
    assert.ok(t.audio.some((a) => a[0] === "switch" && a[1] === "MultiRay"));
    assert.ok(t.chat.some(([, m]) => m.includes("NPC_NAI")), "entity report reaches chat");
    assert.ok(t.last().includes("MultiRay"), "play report is last");
  },
  "mode accepts the translated word and the English key"(t) {
    t.cmd();
    t.cmd(t.T.sub.mode, t.T.modes.ignore);
    assert.ok(t.audio.some((a) => a[0] === "switch" && a[1] === "Ignore"));
    t.cmd("mode", "single");
    assert.ok(t.audio.some((a) => a[0] === "switch" && a[1] === "SingleRay"));
    t.cmd(t.T.sub.mode, "bogus");
    assert.equal(t.last(), t.T.usageMode(t.T.name, t.T.sub));
  },
  "occlusion sets both FMOD parameters and reports acceptance; off resets"(t) {
    t.cmd();
    t.cmd(t.T.sub.occlusion, "0,8");
    assert.deepEqual(t.audio.filter((a) => a[0] === "param").map((a) => [a[1], a[2]]), [["occlusion", 0.8], ["obstruction", 0.8]]);
    assert.equal(t.last(), t.T.occlusionSet(0.8, true, false));
    t.cmd(t.T.sub.occlusion, "off");
    assert.equal(t.last(), t.T.occlusionOff);
    t.cmd(t.T.sub.occlusion, "2");
    assert.equal(t.last(), t.T.usageOcclusion(t.T.name, t.T.sub));
  },
  "ab starts and stops, mode stops it too"(t) {
    t.cmd();
    t.cmd(t.T.sub.ab);
    assert.equal(t.last(), t.T.abStarted(3));
    t.cmd(t.T.sub.ab, "off");
    assert.equal(t.last(), t.T.abStopped);
    t.cmd(t.T.sub.ab, "99");
    assert.equal(t.last(), t.T.usageAb(t.T.name, t.T.sub));
  },
  "result: client state attached, file written, tool-readable"(t) {
    t.cmd();
    t.cmd(t.T.sub.mode, "ignore");
    t.cmd(t.T.sub.result, "upstairs", "4", "clearly", "muffled");
    assert.equal(t.last(), t.T.resultSaved(1, "upstairs", 4, "Ignore"));
    const rows = JSON.parse(t.fs.readFileSync(`resources/${t.T.name}/data/results.json`, "utf8"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].note, "clearly muffled");
    assert.equal(rows[0].mode, "Ignore");
    assert.equal(rows[0].heightDiff, 0);
    t.cmd(t.T.sub.result, "upstairs", "9");
    assert.equal(t.last(), t.T.usageResult(t.T.name, t.T.sub));
  },
  "hear: lists players within 60 m with the client's verdict"(t) {
    t.cmd(t.T.sub.hear);
    const m = t.last();
    assert.ok(m.includes("p2"), "near player listed");
    assert.ok(!m.includes("p3"), "far player not listed");
    assert.equal(m, t.T.hearReport([{ id: 2, nickname: "p2", distance: 5.3, talking: true }], false, 1, 25));
  },
  "bench reports rays, time and hits"(t) {
    t.cmd(t.T.sub.bench, "10");
    assert.match(t.last(), /10/);
    assert.ok(t.last().includes(t.T.benchReport(10, 0, 20).split(":")[0].slice(0, 5)));
  },
  "nav without and with a probe"(t) {
    t.cmd(t.T.sub.nav);
    assert.ok(t.last().includes("99.9"), "floorAt here");
    t.cmd();
    t.cmd(t.T.sub.nav);
    assert.ok(t.last().includes("12.0 m"), "open-door path length");
    assert.ok(t.last().includes("30.0 m"), "closed-doors path length");
  },
  "quiet stops the named trigger, or everything for a file"(t) {
    t.cmd();
    t.cmd(t.T.sub.play, "trigger:special_player_washing");
    t.cmd(t.T.sub.quiet);
    assert.deepEqual(t.audio.at(-1), ["stopOne", "special_player_washing"]);
    assert.equal(t.last(), t.T.quietDone("trigger:special_player_washing", true, true));
    t.cmd(t.T.sub.play, "sounds/x/y", "20");
    t.cmd(t.T.sub.quiet);
    assert.deepEqual(t.audio.at(-1), ["stopAll"]);
  },
  "camera and stop"(t) {
    t.cmd();
    t.cmd(t.T.sub.camera, "5");
    assert.equal(t.last(), t.T.cameraSet(5, true));
    t.cmd(t.T.sub.stop);
    assert.equal(t.last(), t.T.removed);
    assert.ok(t.npcs[0].removed);
    assert.equal(t.client.Camera.third, false);
  },
  "help lists every subcommand word"(t) {
    t.cmd("?");
    for (const [k, w] of Object.entries(t.T.sub)) assert.ok(k === "help" || t.last().includes(` ${w}`), `help mentions ${w}`);
  },
  "disconnect and resourceStop clean up"(t) {
    t.cmd();
    t.emit("playerDisconnect", t.players[0]);
    assert.ok(t.npcs[0].removed);
    t.cmd();
    t.emit("resourceStop", t.T.name);
    assert.ok(t.npcs[1].removed);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(setup()); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", e.message); }
}
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : `all ${Object.keys(tests).length} passed (${stringsFile})`);
process.exit(failed ? 1 : 0);
