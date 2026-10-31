// voiceprobe (client): finds the probe NPC's entity, sets its ObstrOcclCalcType and plays a sound on it.

const EV = { start: "voiceprobe:start", mode: "voiceprobe:mode", play: "voiceprobe:play", camera: "voiceprobe:camera", stop: "voiceprobe:stop", report: "voiceprobe:report" };
const SWITCH = "ObstrOcclCalcType"; // Libs/GameAudio/default_controls.xml

const obj = (x) => (typeof x === "string" ? JSON.parse(x) : x ?? {});
let probe = null; // { pos, ent, mode, source, purpose, fallback }

const report = (text) => {
  Hud.showNotification("voiceprobe: " + text);
  Events.emitServer(EV.report, { text });
};

function findNpc(pos) {
  const near = World.entitiesInRadius(pos, 2.5, { max: 16 }).filter((e) => e.entityId && (!LocalPlayer || e.entityId !== LocalPlayer.entityId));
  const npc = near.find((e) => /npc|human|actor/i.test(e.class)) ?? null;
  return { npc, classes: near.map((e) => `${e.class}@${e.distance.toFixed(1)}`).join(", ") };
}

function play() {
  if (!probe?.ent) return;
  const source = probe.source || probe.fallback;
  Audio.stopAllOnEntity(probe.ent);
  const switched = Audio.setEntitySwitch(probe.ent, SWITCH, probe.mode);
  const trigger = source.startsWith("trigger:");
  const ok = trigger ? Audio.playOnEntity(source.slice(8), probe.ent) : Audio.playFile(source, probe.ent, probe.purpose || "20");
  report(`mode ${probe.mode} (switch ${switched ? "accepted" : "REJECTED"}), sound ${ok ? "playing" : "REJECTED"}: ${source}${trigger ? " (trigger)" : " (purpose " + (probe.purpose || "20") + ")"}`);
}

Events.on(EV.start, (payload) => {
  const m = obj(payload);
  probe = { pos: new Vector3(m.pos.x, m.pos.y, m.pos.z), ent: 0, mode: "MultiRay", source: "", purpose: "", fallback: m.source };
  let tries = 0;
  const look = () => {
    if (!probe) return;
    const { npc, classes } = findNpc(probe.pos);
    if (npc) {
      probe.ent = npc.entityId;
      report(`NPC entity ${npc.class} #${npc.entityId} (nearby: ${classes})`);
      return play();
    }
    if (++tries < 20) return setTimeout(look, 500);
    report(`NPC not found; nearby: ${classes || "nothing"}`);
  };
  setTimeout(look, 500);
});

Events.on(EV.mode, (payload) => {
  if (!probe) return;
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

// If the probe's sound changes when only the camera moves, the game's listener follows the camera, not the body.
Events.on(EV.camera, (payload) => {
  const d = obj(payload).distance;
  Camera.setThirdPerson(d == null ? null : { distance: d });
  report(d == null ? "camera back in first person" : `camera ${d} m behind you (third person: ${Camera.isThirdPerson()})`);
});

Events.on(EV.stop, () => {
  if (Camera.isThirdPerson()) Camera.setThirdPerson(null);
  if (probe?.ent) Audio.stopAllOnEntity(probe.ent);
  probe = null;
});
