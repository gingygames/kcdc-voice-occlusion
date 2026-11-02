// voiceprobe (client): finds the probe NPC's entity, sets its ObstrOcclCalcType and plays a sound on it; can also set
// the FMOD occlusion / obstruction parameters directly, alternate modes (A/B), report who this client hears and time
// raycasts. Texts: strings.js, which the build prepends to this file (client scripts may not share globals).

const T = globalThis.VOICEPROBE_I18N;
const RESOURCE = T.name;
const EV = Object.fromEntries(["start", "mode", "play", "camera", "stop", "report", "occlusion", "ab", "result", "resultState", "hear", "bench", "quiet"].map((k) => [k, `${RESOURCE}:${k}`]));
const SWITCH = "ObstrOcclCalcType"; // Libs/GameAudio/default_controls.xml
const PARAMS = ["occlusion", "obstruction"]; // Libs/GameAudio/g_rtpcs.xml -> FMOD parameters

const obj = (x) => (typeof x === "string" ? JSON.parse(x) : x ?? {});
let probe = null; // { pos, ent, mode, source, purpose, fallback, param }
let ab = null; // { timer, seconds }
let camera = null; // third-person distance or null

const report = (text) => {
  Hud.showNotification(`${RESOURCE}: ${text}`);
  Events.emitServer(EV.report, { text });
};

function findNpc(pos) {
  const near = World.entitiesInRadius(pos, 2.5, { max: 16 }).filter((e) => e.entityId && (!LocalPlayer || e.entityId !== LocalPlayer.entityId));
  const npc = near.find((e) => /npc|human|actor/i.test(e.class)) ?? null;
  return { npc, classes: near.map((e) => `${e.class}@${e.distance.toFixed(1)}`).join(", ") };
}

function applyParams() {
  if (!probe?.ent || probe.param == null) return [false, false];
  return PARAMS.map((name) => Audio.setEntityParameter(probe.ent, name, probe.param));
}

function play() {
  if (!probe?.ent) return;
  const source = probe.source || probe.fallback;
  Audio.stopAllOnEntity(probe.ent);
  const switched = Audio.setEntitySwitch(probe.ent, SWITCH, probe.mode);
  const trigger = source.startsWith("trigger:");
  const ok = trigger ? Audio.playOnEntity(source.slice(8), probe.ent) : Audio.playFile(source, probe.ent, probe.purpose || "20");
  applyParams();
  report(T.played(probe.mode, switched, ok, source, trigger, probe.purpose || "20"));
}

function stopAb(silent) {
  if (!ab) return;
  clearInterval(ab.timer);
  ab = null;
  if (!silent) report(T.abStopped);
}

Events.on(EV.start, (payload) => {
  const m = obj(payload);
  stopAb(true);
  probe = { pos: new Vector3(m.pos.x, m.pos.y, m.pos.z), ent: 0, mode: "MultiRay", source: "", purpose: "", fallback: m.source, param: null };
  let tries = 0;
  const look = () => {
    if (!probe) return;
    const { npc, classes } = findNpc(probe.pos);
    if (npc) {
      probe.ent = npc.entityId;
      report(T.entityFound(npc.class, npc.entityId, classes));
      return play();
    }
    if (++tries < 20) return setTimeout(look, 500);
    report(T.entityNotFound(classes));
  };
  setTimeout(look, 500);
});

Events.on(EV.mode, (payload) => {
  if (!probe) return;
  stopAb(true);
  probe.mode = obj(payload).mode;
  play();
});

Events.on(EV.play, (payload) => {
  if (!probe) return;
  const m = obj(payload);
  probe.source = m.source;
  probe.purpose = m.purpose;
  play();
});

// Direct test of the FMOD parameters the engine's occlusion drives. If the sound muffles with occlusion=1 while the
// switch does nothing, the speech events do have the automation and only the engine-side calculation is missing.
Events.on(EV.occlusion, (payload) => {
  if (!probe?.ent) return;
  const v = obj(payload).value;
  if (v == null) {
    probe.param = 0;
    applyParams();
    probe.param = null;
    return report(T.occlusionOff);
  }
  probe.param = v;
  const [occ, obs] = applyParams();
  report(T.occlusionSet(v, occ, obs));
});

// A/B: flip the switch on the playing sound without restarting it. If nothing changes but `mode` (which restarts)
// does, the switch is read only when the event starts.
Events.on(EV.ab, (payload) => {
  if (!probe?.ent) return;
  const sec = obj(payload).seconds;
  stopAb(sec != null);
  if (sec == null) return;
  const flip = () => {
    if (!probe?.ent) return stopAb(true);
    probe.mode = probe.mode === "Ignore" ? "MultiRay" : "Ignore";
    const switched = Audio.setEntitySwitch(probe.ent, SWITCH, probe.mode);
    Hud.showNotification(`${RESOURCE}: ${T.abTick(probe.mode, switched)}`);
  };
  ab = { seconds: sec, timer: setInterval(flip, sec * 1000) };
  report(T.abStarted(sec));
});

// If the probe's sound changes when only the camera moves, the game's listener follows the camera, not the body.
Events.on(EV.camera, (payload) => {
  const d = obj(payload).distance;
  camera = d;
  Camera.setThirdPerson(d == null ? null : { distance: d });
  report(d == null ? T.cameraBack : T.cameraSet(d, Camera.isThirdPerson()));
});

// The server asked for the state to attach to a recorded result.
Events.on(EV.result, () => {
  Events.emitServer(EV.resultState, {
    mode: probe ? probe.mode : null,
    source: probe ? probe.source || probe.fallback : null,
    purpose: probe ? probe.purpose || "20" : null,
    occlusionParam: probe ? probe.param : null,
    camera,
    ab: ab ? ab.seconds : null,
  });
});

// Who does this client play right now? Objective check for voice resources (voicefloors) without headphones.
Events.on(EV.hear, (payload) => {
  const rows = (obj(payload).players ?? []).map((r) => {
    let talking = null;
    try { talking = Voice.isPlayerTalking(new Player(r.id)); } catch (e) { /* unknown player */ }
    return { ...r, talking };
  });
  let talking = false, tier = "?", range = "?";
  try { talking = Voice.isTalking(); tier = Voice.getTier(); range = Voice.getRange(); } catch (e) { /* older build */ }
  report(T.hearReport(rows, talking, tier, range));
});

// How much does World.raycastAll cost here? Horizontal 20 m rays from head height, evenly around.
Events.on(EV.bench, (payload) => {
  const n = obj(payload).rays ?? 100;
  const p = LocalPlayer?.position;
  if (!p) return;
  const from = new Vector3(p.x, p.y, p.z + 1.6);
  let hits = 0;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const to = new Vector3(from.x + Math.cos(a) * 20, from.y + Math.sin(a) * 20, from.z + 1.5);
    hits += World.raycastAll(from, to, { mode: "cover", maxHits: 8 }).length;
  }
  report(T.benchReport(n, Date.now() - t0, hits));
});

// Stop only what plays on the probe now: the named trigger (what a mitigation resource would do) or everything on the entity.
Events.on(EV.quiet, () => {
  if (!probe?.ent) return;
  stopAb(true);
  const source = probe.source || probe.fallback;
  const trigger = source.startsWith("trigger:");
  const ok = trigger ? Audio.stopOnEntity(source.slice(8), probe.ent) : Audio.stopAllOnEntity(probe.ent);
  report(T.quietDone(source, trigger, ok));
});

Events.on(EV.stop, () => {
  stopAb(true);
  if (Camera.isThirdPerson()) Camera.setThirdPerson(null);
  camera = null;
  if (probe?.ent) Audio.stopAllOnEntity(probe.ent);
  probe = null;
});
