# voiceprobe – one-client occlusion test for Kingdoms Connected

Checks whether a sound KCDC plays on an entity through the game's speech host events (`Audio.playFile` →
`event:/voice/dialog/bark_0XX`, the path live voice could take, see Option A0 in [PROPOSAL.md](../PROPOSAL.md))
responds to the **engine's own occlusion** (ATL switch `ObstrOcclCalcType`: `Ignore` / `SingleRay` / `MultiRay`,
driven by `sound_obstruction` in `SurfaceTypes.xml`). One game client is enough.

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
`a_o_bell_kkut_kostelni` (`Audio.playOnEntity`), which tests the game's own event path instead.

## Commands

| command | what it does |
|---|---|
| `/voiceprobe` | spawns the NPC "Voice probe" where you stand and plays the sound in `MultiRay` mode |
| `/voiceprobe mode ignore\|single\|multi` | switches occlusion calculation on that entity and replays |
| `/voiceprobe play [file\|trigger:name] [purpose]` | plays something else: `play sounds/kcdc/<res>/<file> 20`, `play trigger:a_o_bell_kkut_kostelni` |
| `/voiceprobe camera <0.3-20>\|off` | third-person camera behind you; your body stays put |
| `/voiceprobe stop` | removes the NPC |

Each step reports in chat whether the game accepted the switch and the sound (`accepted` / `REJECTED`).

## Procedure

1. In a two-storey building (a tavern in Kuttenberg) spawn the probe on the ground floor: `/voiceprobe`.
2. Go upstairs above it, then behind a wall on the same floor, then outside a closed door.
3. At each spot compare `/voiceprobe mode ignore` with `/voiceprobe mode multi`.
4. **Camera:** stand 5 m from the probe in the open and toggle `/voiceprobe camera 15` / `camera off`; then stand
   around a corner so that the camera peeks into the probe's room. If the sound changes when only the camera moves,
   the game's listener follows the camera, not the body.

## Reading the result

- **Switch accepted and `multi` sounds quieter or muffled behind walls / through floors compared with `ignore`:** the
  speech host events respond to the engine's occlusion, so live voice fed into them (Option A0) gets walls, floors and
  materials for free.
- **Switch accepted but no difference:** those events don't automate the `occlusion` parameter, or KCDC disables
  entity occlusion. Option A (read the computed value, apply it to the voice channel) or B (own rays) remain.
- **Switch `REJECTED`:** `Audio.setEntitySwitch` doesn't resolve switches from `default_controls.xml`, which is a
  question for the KCDC team. The NPC keeps its default `SingleRay` from `NPC.lua`, so walking behind a wall still
  shows whether that default is audible.
- `NPC not found` means the probe found no NPC body within 2.5 m; the message lists the entity classes it saw.
