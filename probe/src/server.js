// voiceprobe (server): does a sound KCDC plays on an entity respond to the game's own occlusion?
// Spawns an NPC; the client toggles the ATL switch ObstrOcclCalcType (Ignore / SingleRay / MultiRay) on it and
// plays a file through the game's speech host events (Audio.playFile, the path live voice could take) or a game
// trigger. Also records what the tester hears (data/results.json), lists who this client hears, times raycasts and
// reads the navmesh (floorAt, path lengths through doors). Texts and the command name: strings.js. See probe/README.md.

// strings.js is listed before this file; when the server does not share globals between a resource's scripts, require it.
const T = globalThis.VOICEPROBE_I18N ?? (typeof require === "function" ? require("./strings.js") : null);
const RESOURCE = T.name;
if (!globalThis.VOICEPROBE_I18N) console.log(`[${RESOURCE}] strings loaded via require (scripts do not share globalThis)`);
const EV = Object.fromEntries(["start", "mode", "play", "camera", "stop", "report", "occlusion", "ab", "result", "resultState", "hear", "bench", "quiet"].map((k) => [k, `${RESOURCE}:${k}`]));
const TEST_FILE = `sounds/kcdc/${RESOURCE}/test`; // stream/sounds/kcdc/<name>/test.ogg, if you add one
const DATA_DIR = `resources/${RESOURCE}/data`;
const RESULTS = `${DATA_DIR}/results.json`;

const probes = new Map(); // player id -> { npc, at }
const pendingResults = new Map(); // player id -> { place, score, note }
const obj = (x) => (typeof x === "string" ? JSON.parse(x) : x ?? {});
const say = (p, text) => Chat.sendToPlayer(p, text, { author: RESOURCE });
const help = () => T.help(RESOURCE, T.sub);
const subOf = (word) => Object.keys(T.sub).find((k) => T.sub[k] === word || k === word) ?? null;
const modeOf = (word) => ({ [T.modes.ignore]: "Ignore", [T.modes.single]: "SingleRay", [T.modes.multi]: "MultiRay", ignore: "Ignore", single: "SingleRay", multi: "MultiRay" })[word] ?? null;
const v3 = (p) => ({ x: p.x, y: p.y, z: p.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

let fs = null;
try { fs = require("fs"); } catch (e) { /* no fs on this build: results cannot be saved */ }

function defaultSource() {
  if (T.defaultSound) return T.defaultSound;
  try {
    return fs?.existsSync(`resources/${RESOURCE}/stream/${TEST_FILE}.ogg`) ? TEST_FILE : T.fallbackTrigger;
  } catch (e) {
    return T.fallbackTrigger;
  }
}

function stop(p) {
  const s = probes.get(p.id);
  if (!s) return;
  p.emit(EV.stop, "{}");
  try { s.npc.remove(); } catch (e) { /* already gone */ }
  probes.delete(p.id);
}

function spawn(p) {
  stop(p);
  const at = v3(p.position);
  const npc = Npc.create({ name: T.npcName, position: at, invulnerable: true, frozen: true, interactable: false, nametag: true, virtualWorld: p.virtualWorld });
  probes.set(p.id, { npc, at });
  p.emit(EV.start, JSON.stringify({ pos: at, source: defaultSource() }));
  say(p, T.spawned(RESOURCE, T.sub) + "\n" + help());
}

function saveResult(p, state) {
  const r = pendingResults.get(p.id);
  if (!r) return;
  pendingResults.delete(p.id);
  if (!fs) return say(p, T.resultFailed("no fs module"));
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const all = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, "utf8")) : [];
    const s = probes.get(p.id);
    const here = v3(p.position);
    all.push({
      time: new Date().toISOString(),
      player: p.nickname,
      place: r.place,
      score: r.score,
      note: r.note,
      mode: state.mode ?? null,
      source: state.source ?? null,
      purpose: state.purpose ?? null,
      occlusionParam: state.occlusionParam ?? null,
      camera: state.camera ?? null,
      distance: s ? Number(dist(here, s.at).toFixed(1)) : null,
      heightDiff: s ? Number((here.z - s.at.z).toFixed(2)) : null,
    });
    fs.writeFileSync(RESULTS, JSON.stringify(all, null, 2) + "\n");
    say(p, T.resultSaved(all.length, r.place, r.score, state.mode ?? "-"));
    console.log(`[${RESOURCE}] result ${p.nickname}: ${r.place} ${r.score}/5 mode ${state.mode} ${r.note}`);
  } catch (e) {
    say(p, T.resultFailed(e?.message ?? e));
  }
}

function nav(p) {
  const here = v3(p.position);
  const s = probes.get(p.id);
  const floor = (at) => { try { const f = Navigation.floorAt(at); return f == null ? null : Number(f.toFixed(2)); } catch (e) { return null; } };
  const path = (doors) => { try { return Navigation.findPath(here, s.at, { doors }); } catch (e) { return null; } };
  const r = { floorHere: floor(here), zHere: here.z.toFixed(2), probe: !!s };
  if (s) {
    r.floorProbe = floor(s.at);
    r.zProbe = s.at.z.toFixed(2);
    r.dist = dist(here, s.at).toFixed(1);
    r.open = T.navPath(path("open"));
    r.none = T.navPath(path("none"));
    r.any = T.navPath(path("any"));
  }
  say(p, T.navReport(r));
}

function hear(p) {
  const here = v3(p.position);
  const rows = Player.all()
    .filter((o) => o.id !== p.id && o.virtualWorld === p.virtualWorld && dist(v3(o.position), here) <= 60)
    .map((o) => ({ id: o.id, nickname: o.nickname, distance: Number(dist(v3(o.position), here).toFixed(1)) }));
  p.emit(EV.hear, JSON.stringify({ players: rows }));
}

Events.on("playerCommand", (p, cmd, args) => {
  if (cmd !== RESOURCE) return;
  const sub = subOf((args[0] ?? "").toLowerCase());
  if (args[0] === "?" || sub === "help") return say(p, help());
  if (sub === "stop") return stop(p), say(p, T.removed);
  if (sub === "mode") {
    const mode = modeOf((args[1] ?? "").toLowerCase());
    if (!mode || !probes.has(p.id)) return say(p, T.usageMode(RESOURCE, T.sub));
    return p.emit(EV.mode, JSON.stringify({ mode }));
  }
  if (sub === "camera") {
    const a = (args[1] ?? "").toLowerCase();
    const m = Number(a.replace(",", "."));
    if (a !== "off" && !(m >= 0.3 && m <= 20)) return say(p, T.usageCamera(RESOURCE, T.sub));
    return p.emit(EV.camera, JSON.stringify({ distance: a === "off" ? null : m }));
  }
  if (sub === "play") {
    if (!probes.has(p.id)) return say(p, T.spawnFirst(RESOURCE));
    return p.emit(EV.play, JSON.stringify({ source: args[1] ?? "", purpose: args[2] ?? "" }));
  }
  if (sub === "occlusion") {
    if (!probes.has(p.id)) return say(p, T.spawnFirst(RESOURCE));
    const a = (args[1] ?? "").toLowerCase();
    const v = Number(a.replace(",", "."));
    if (a !== "off" && !(v >= 0 && v <= 1)) return say(p, T.usageOcclusion(RESOURCE, T.sub));
    return p.emit(EV.occlusion, JSON.stringify({ value: a === "off" ? null : v }));
  }
  if (sub === "ab") {
    if (!probes.has(p.id)) return say(p, T.spawnFirst(RESOURCE));
    const a = (args[1] ?? "3").toLowerCase();
    const sec = Number(a.replace(",", "."));
    if (a !== "off" && !(sec >= 1 && sec <= 60)) return say(p, T.usageAb(RESOURCE, T.sub));
    return p.emit(EV.ab, JSON.stringify({ seconds: a === "off" ? null : sec }));
  }
  if (sub === "result") {
    const score = Number(args[2]);
    if (!args[1] || !(score >= 0 && score <= 5)) return say(p, T.usageResult(RESOURCE, T.sub));
    pendingResults.set(p.id, { place: args[1], score, note: args.slice(3).join(" ") });
    return p.emit(EV.result, "{}"); // the client answers with its state (mode, source, ...)
  }
  if (sub === "hear") return hear(p);
  if (sub === "bench") {
    const n = Number(args[1] ?? 100);
    return p.emit(EV.bench, JSON.stringify({ rays: n >= 1 && n <= 1000 ? Math.floor(n) : 100 }));
  }
  if (sub === "nav") return nav(p);
  if (sub === "quiet") {
    if (!probes.has(p.id)) return say(p, T.spawnFirst(RESOURCE));
    return p.emit(EV.quiet, "{}");
  }
  spawn(p);
});

Events.onClient(EV.report, (sender, payload) => {
  const text = String(obj(payload).text ?? "");
  say(sender, text);
  console.log(`[${RESOURCE}] ${sender.nickname}: ${text}`);
});
Events.onClient(EV.resultState, (sender, payload) => saveResult(sender, obj(payload)));

Events.on("playerDisconnect", (p) => { stop(p); pendingResults.delete(p.id); });
Events.on("resourceStop", (name) => {
  if (name !== RESOURCE) return;
  for (const s of probes.values()) {
    try { s.npc.remove(); } catch (e) { /* already gone */ }
  }
});
