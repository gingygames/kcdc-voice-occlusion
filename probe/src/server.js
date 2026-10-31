// voiceprobe (server): does a sound KCDC plays on an entity respond to the game's own occlusion?
// Spawns an NPC; the client toggles the ATL switch ObstrOcclCalcType (Ignore / SingleRay / MultiRay) on it and
// plays a file through the game's speech host events (Audio.playFile, the path live voice could take) or a game
// trigger. See probe/README.md.

const EV = { start: "voiceprobe:start", mode: "voiceprobe:mode", play: "voiceprobe:play", camera: "voiceprobe:camera", stop: "voiceprobe:stop", report: "voiceprobe:report" };
const RESOURCE = "voiceprobe";
const TEST_FILE = "sounds/kcdc/voiceprobe/test";     // stream/sounds/kcdc/voiceprobe/test.ogg, if you add one
const FALLBACK_TRIGGER = "trigger:a_o_bell_kkut_kostelni";

const probes = new Map(); // player id -> { npc }
const obj = (x) => (typeof x === "string" ? JSON.parse(x) : x ?? {});
const say = (p, text) => Chat.sendToPlayer(p, text, { author: RESOURCE });

function defaultSource() {
  try {
    return require("fs").existsSync(`resources/${RESOURCE}/stream/${TEST_FILE}.ogg`) ? TEST_FILE : FALLBACK_TRIGGER;
  } catch (e) {
    return FALLBACK_TRIGGER;
  }
}

const HELP = [
  "/voiceprobe - spawn the probe NPC where you stand and start playing (MultiRay)",
  "/voiceprobe mode ignore|single|multi - switch occlusion calculation and replay",
  "/voiceprobe play [file|trigger:name] [purpose] - replay, e.g. play sounds/kcdc/x/y 20 or play trigger:a_o_bell_kkut_kostelni",
  "/voiceprobe camera <0.3-20>|off - third-person camera behind you; your body stays put",
  "/voiceprobe stop - remove the NPC",
].join("\n");

function stop(p) {
  const s = probes.get(p.id);
  if (!s) return;
  p.emit(EV.stop, "{}");
  try { s.npc.remove(); } catch (e) { /* already gone */ }
  probes.delete(p.id);
}

Events.on("playerCommand", (p, cmd, args) => {
  if (cmd !== RESOURCE) return;
  const sub = (args[0] ?? "").toLowerCase();
  if (sub === "help" || sub === "?") return say(p, HELP);
  if (sub === "stop") return stop(p), say(p, "Probe removed.");
  if (sub === "mode") {
    const mode = { ignore: "Ignore", single: "SingleRay", multi: "MultiRay" }[(args[1] ?? "").toLowerCase()];
    if (!mode || !probes.has(p.id)) return say(p, "Usage: /voiceprobe mode ignore|single|multi (spawn the probe first)");
    return p.emit(EV.mode, JSON.stringify({ mode }));
  }
  if (sub === "camera") {
    const a = (args[1] ?? "").toLowerCase();
    const m = Number(a.replace(",", "."));
    if (a !== "off" && !(m >= 0.3 && m <= 20)) return say(p, "Usage: /voiceprobe camera <0.3-20>|off");
    return p.emit(EV.camera, JSON.stringify({ distance: a === "off" ? null : m }));
  }
  if (sub === "play") {
    if (!probes.has(p.id)) return say(p, "Spawn the probe first: /voiceprobe");
    return p.emit(EV.play, JSON.stringify({ source: args[1] ?? "", purpose: args[2] ?? "" }));
  }
  stop(p);
  const pos = p.position;
  const at = { x: pos.x, y: pos.y, z: pos.z };
  const npc = Npc.create({ name: "Voice probe", position: at, invulnerable: true, frozen: true, interactable: false, nametag: true, virtualWorld: p.virtualWorld });
  probes.set(p.id, { npc });
  p.emit(EV.start, JSON.stringify({ pos: at, source: defaultSource() }));
  say(p, "Probe spawned where you stand. Go upstairs, behind a wall or outside a closed door and compare /voiceprobe mode ignore and multi.\n" + HELP);
});

Events.onClient(EV.report, (sender, payload) => {
  const text = String(obj(payload).text ?? "");
  say(sender, text);
  console.log(`[${RESOURCE}] ${sender.nickname}: ${text}`);
});

Events.on("playerDisconnect", (p) => stop(p));
Events.on("resourceStop", (name) => {
  if (name !== RESOURCE) return;
  for (const s of probes.values()) {
    try { s.npc.remove(); } catch (e) { /* already gone */ }
  }
});
