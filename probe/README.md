# voiceprobe – one-client occlusion test for Kingdoms Connected

Checks whether a sound KCDC plays on an entity through the game's speech host events (`Audio.playFile` →
`event:/voice/dialog/bark_0XX`, the path live voice could take, see Option A0 in [PROPOSAL.md](../PROPOSAL.md))
responds to the **engine's own occlusion** (ATL switch `ObstrOcclCalcType`: `Ignore` / `SingleRay` / `MultiRay`,
driven by `sound_obstruction` in `SurfaceTypes.xml`). One game client is enough. It also sets the FMOD occlusion
parameters directly, records what you hear, lists which players your client is playing (an objective check for
[voicefloors](../voicefloors/)), times `World.raycastAll` and reads the navmesh.

## Install

Plain JavaScript, no dependencies:

```sh
node probe/build.mjs        # -> probe/dist/voiceprobe/
```

Copy `probe/dist/voiceprobe/` into your server's `resources/` folder and start it (`ensure voiceprobe` in the server
console, or restart the server).

**Sound to test with.** For the speech-event path, put any speech-like `.ogg` at
`probe/stream/sounds/kcdc/voiceprobe/test.ogg` before building: the probe then plays it with
`Audio.playFile("sounds/kcdc/voiceprobe/test", npc, "20")`. Without it the probe falls back to the game trigger
`a_o_bell_kkut_kostelni` (`Audio.playOnEntity`), which tests the game's own event path instead. A streamed file from
another resource works too: set `defaultSound` in `src/strings.js`.

**Other language or command name.** All texts, the command word and the subcommand words live in `src/strings.js`.
Swap that file for a translated copy with another `name` and build with that name (the Czech `hlassonda` in
`gingygames/gingy-kcdc`, `hlas/kcdc`, is built exactly so). The English subcommand words are always accepted.

## Commands

| command | what it does |
|---|---|
| `/voiceprobe` | spawns the NPC "Voice probe" where you stand and plays the sound in `MultiRay` mode |
| `/voiceprobe mode ignore\|single\|multi` | switches occlusion calculation on that entity and replays |
| `/voiceprobe ab [seconds\|off]` | alternates `Ignore` / `MultiRay` every 3 s (or `seconds`) on the playing sound **without restarting it**; HUD shows the current mode |
| `/voiceprobe occlusion <0-1>\|off` | sets the FMOD parameters `occlusion` and `obstruction` on the probe's entity directly (`Audio.setEntityParameter`), reports whether each was accepted |
| `/voiceprobe play [file\|trigger:name] [purpose]` | plays something else: `play sounds/kcdc/<res>/<file> 20`, `play trigger:a_o_bell_kkut_kostelni` |
| `/voiceprobe camera <0.3-20>\|off` | third-person camera behind you; your body stays put |
| `/voiceprobe result <place> <0-5> [note]` | records what you hear (0 = no difference to `ignore`, 5 = silent) with the current mode, parameters, distance and height difference into `resources/voiceprobe/data/results.json` |
| `/voiceprobe hear` | which players within 60 m this client is playing right now (`Voice.isPlayerTalking`), plus your tier and range |
| `/voiceprobe bench [rays]` | times `World.raycastAll` on this client: 100 horizontal 20 m rays by default |
| `/voiceprobe nav` | `Navigation.floorAt` where you stand and, with a probe spawned, path lengths to it through open doors / ignoring closed doors / any door |
| `/voiceprobe quiet` | stops only the sound now playing on the probe (`Audio.stopOnEntity` for a trigger, `stopAllOnEntity` for a file); the NPC stays. If you still hear it, the sound is not bound to the entity |
| `/voiceprobe stop` | removes the NPC |

Each step reports in chat whether the game accepted the switch, the parameters and the sound (`accepted` /
`REJECTED`).

## Procedure

1. In a two-storey building (a tavern in Kuttenberg) spawn the probe on the ground floor: `/voiceprobe`.
2. Go upstairs above it, then behind a wall on the same floor, then outside a closed door.
3. At each spot run `/voiceprobe ab` and listen, or compare `/voiceprobe mode ignore` with `/voiceprobe mode multi`
   (`mode` restarts the sound; if only `mode` makes a difference, the switch is read when the event starts).
4. At each spot also try `/voiceprobe occlusion 1` and `occlusion off`.
5. Record every observation: `/voiceprobe result upstairs 4 clearly muffled`, `/voiceprobe result wall 0`, …
6. **Camera:** stand 5 m from the probe in the open and toggle `/voiceprobe camera 15` / `camera off`; then stand
   around a corner so that the camera peeks into the probe's room. If the sound changes when only the camera moves,
   the game's listener follows the camera, not the body.
7. **Navmesh:** from upstairs run `/voiceprobe nav` (does `floorAt` give the upper floor?). Then stand behind a door,
   close it, run `nav`, open it, run `nav` again: if the "open doors" path length changes, `findPath` follows live
   door state.
8. Afterwards turn the recorded results into a table:
   ```sh
   node probe/tools/results-md.mjs <server>/resources/voiceprobe/data/results.json
   ```

## Reading the result

- **Switch accepted and `multi` sounds quieter or muffled behind walls / through floors compared with `ignore`:** the
  speech host events respond to the engine's occlusion, so live voice fed into them (Option A0) gets walls, floors and
  materials for free.
- **Switch does nothing, but `occlusion 1` muffles the sound:** the events do have the `occlusion` automation; only the
  engine-side calculation is not running for this entity (KCDC disables it, or the switch is not resolved). Option A0
  still works if KCDC computes the value itself, Option A works as described.
- **Neither makes a difference:** those events don't automate `occlusion` / `obstruction`. Option A with FMOD
  `set3DOcclusion` or a low-pass on the voice channel, or Option B (own rays), remain.
- **Switch `REJECTED`:** `Audio.setEntitySwitch` doesn't resolve switches from `default_controls.xml`, which is a
  question for the KCDC team. The NPC keeps its default `SingleRay` from `NPC.lua`, so walking behind a wall still
  shows whether that default is audible.
- `NPC not found` means the probe found no NPC body within 2.5 m; the message lists the entity classes it saw.

## Test

```sh
node probe/test/probe.test.mjs                      # English strings
node probe/test/probe.test.mjs path/to/strings.js   # a translated strings file
```

Runs server and client scripts against a fake KCDC API: every command, every event and every string (a translation
missing a key fails here, not in game).
