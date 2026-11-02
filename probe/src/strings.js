// voiceprobe: every user-facing text and the per-deployment settings, in one place.
// server.js and client.js read only `T`. A translated copy of this file turns the probe into a localised resource with
// its own command name (the Czech `hlassonda` in gingygames/gingy-kcdc, hlas/kcdc, is built that way: it copies
// server.js and client.js from here and swaps this file). Keep the keys; change the values.
globalThis.VOICEPROBE_I18N = {
  // Resource name = chat command = chat author. Must equal `name` in package.json.
  name: "voiceprobe",
  npcName: "Voice probe",
  // Sound played by default: "" = stream/sounds/kcdc/<name>/test.ogg when present, else the fallback trigger below.
  defaultSound: "",
  fallbackTrigger: "trigger:a_o_bell_kkut_kostelni",
  // Subcommand words. The English keys are always accepted too.
  sub: { mode: "mode", play: "play", camera: "camera", stop: "stop", occlusion: "occlusion", ab: "ab", result: "result", hear: "hear", bench: "bench", nav: "nav", quiet: "quiet", help: "help" },
  // Mode words for the `mode` subcommand (ignore / single / multi).
  modes: { ignore: "ignore", single: "single", multi: "multi" },

  help: (c, s) => [
    `/${c} - spawn the probe NPC where you stand and start playing (MultiRay)`,
    `/${c} ${s.mode} ${"ignore|single|multi"} - switch occlusion calculation and replay`,
    `/${c} ${s.ab} [seconds|off] - alternate Ignore / MultiRay every few seconds without restarting the sound`,
    `/${c} ${s.occlusion} <0-1>|off - set the FMOD parameters occlusion and obstruction on the probe directly`,
    `/${c} ${s.play} [file|trigger:name] [purpose] - replay, e.g. ${s.play} sounds/kcdc/x/y 20 or ${s.play} trigger:a_o_bell_kkut_kostelni`,
    `/${c} ${s.camera} <0.3-20>|off - third-person camera behind you; your body stays put`,
    `/${c} ${s.result} <place> <0-5> [note] - record what you hear (0 = no difference, 5 = silent) into data/results.json`,
    `/${c} ${s.hear} - which players' voice this client is playing right now`,
    `/${c} ${s.bench} [rays] - time World.raycastAll on this client`,
    `/${c} ${s.nav} - Navigation.floorAt here and path lengths to the probe through open / closed / any doors`,
    `/${c} ${s.quiet} - stop only the sound now playing on the probe (Audio.stopOnEntity for a trigger), the NPC stays`,
    `/${c} ${s.stop} - remove the NPC`,
  ].join("\n"),

  // server
  spawned: (c, s) => `Probe spawned where you stand. Go upstairs, behind a wall or outside a closed door and compare /${c} ${s.mode} ignore and multi, or use /${c} ${s.ab}.`,
  removed: "Probe removed.",
  spawnFirst: (c) => `Spawn the probe first: /${c}`,
  usageMode: (c, s) => `Usage: /${c} ${s.mode} ignore|single|multi (spawn the probe first)`,
  usageCamera: (c, s) => `Usage: /${c} ${s.camera} <0.3-20>|off`,
  usageOcclusion: (c, s) => `Usage: /${c} ${s.occlusion} <0-1>|off`,
  usageAb: (c, s) => `Usage: /${c} ${s.ab} [1-60]|off`,
  usageResult: (c, s) => `Usage: /${c} ${s.result} <place> <0-5> [note], e.g. ${s.result} upstairs 4 clearly muffled`,
  resultSaved: (n, place, score, mode) => `Result #${n} saved: ${place} = ${score}/5 (mode ${mode}). Collect them with probe/tools/results-md.mjs.`,
  resultFailed: (err) => `Could not save the result: ${err}`,
  navReport: (r) => [
    `Navigation.floorAt here: ${r.floorHere ?? "null"} (your z ${r.zHere}, difference ${r.floorHere == null ? "-" : (r.zHere - r.floorHere).toFixed(2)} m)`,
    r.probe
      ? `probe: floorAt ${r.floorProbe ?? "null"} (z ${r.zProbe}), straight line ${r.dist} m; path through open doors ${r.open}, closed doors ignored (none) ${r.none}, any door ${r.any}`
      : `no probe spawned: spawn it, close a door between you and run this again to see whether the open-doors path follows the door`,
  ].join("\n"),
  navPath: (p) => (p ? `${p.length.toFixed(1)} m${p.complete ? "" : " (incomplete)"}` : "null"),

  // client
  entityFound: (cls, id, classes) => `NPC entity ${cls} #${id} (nearby: ${classes})`,
  entityNotFound: (classes) => `NPC not found; nearby: ${classes || "nothing"}`,
  played: (mode, switched, ok, source, trigger, purpose) =>
    `mode ${mode} (switch ${switched ? "accepted" : "REJECTED"}), sound ${ok ? "playing" : "REJECTED"}: ${source}${trigger ? " (trigger)" : ` (purpose ${purpose})`}`,
  cameraBack: "camera back in first person",
  cameraSet: (d, third) => `camera ${d} m behind you (third person: ${third})`,
  occlusionSet: (v, occ, obs) => `parameters on the probe: occlusion=${v} (${occ ? "accepted" : "REJECTED"}), obstruction=${v} (${obs ? "accepted" : "REJECTED"})`,
  occlusionOff: "occlusion and obstruction parameters reset to 0",
  abStarted: (sec) => `A/B: switching Ignore <-> MultiRay every ${sec} s on the playing sound (no restart). Stop with ab off or mode.`,
  abStopped: "A/B stopped",
  abTick: (mode, switched) => `A/B -> ${mode}${switched ? "" : " (switch REJECTED)"}`,
  hearReport: (rows, talking, tier, range) =>
    [`you: ${talking ? "talking" : "silent"}, tier ${tier}, range ${range} m`, ...(rows.length ? rows.map((r) => `${r.nickname} (${r.distance} m): ${r.talking === null ? "unknown" : r.talking ? "HEARD" : "silent"}`) : ["nobody else within 60 m"])].join("\n"),
  quietDone: (source, trigger, ok) => `${trigger ? "stopOnEntity" : "stopAllOnEntity"} for ${source}: ${ok ? "accepted" : "REJECTED"}. Still hearing it? Then the sound is not bound to the entity.`,
  benchReport: (n, ms, hits) => `${n} x World.raycastAll (20 m, cover, maxHits 8): ${ms} ms total, ${(ms / n).toFixed(2)} ms per ray, ${(hits / n).toFixed(1)} hits per ray on average`,
};
// KCDC loads server scripts as CommonJS modules; when they do not share `globalThis`, server.js requires this file.
if (typeof module !== "undefined" && module.exports) module.exports = globalThis.VOICEPROBE_I18N;
