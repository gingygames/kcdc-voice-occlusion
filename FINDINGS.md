# Findings: how Kingdoms Connected voice works, and what the game already knows

Researched 2026-10-31 against Kingdoms Connected **1.7.3** (`@kingdomsconnected/types` 1.7.2 and 1.7.3, the voice API
is identical in both), the open-source [MafiaHub Framework](https://github.com/MafiaHub/Framework)
(`code/framework/src/voice/`, default branch `develop` as of 2026-10-30; there is no `main`), strings in `KCDCClient.dll` 1.7.3, and the retail
Kingdom Come: Deliverance II data (`IPL_GameData.pak`, `Scripts.pak`, `WHGame.dll`). No game files are included in this
repository; everything below is names and numbers you can check in your own install.

## 1. Voice chat today

**Transport and relay (Framework).** The client captures the microphone (push-to-talk `V` by default or voice
activation, with noise suppression) and sends Opus at 40 kbps in 20 ms frames. The server's `VoiceRouter` decides who
receives each talker by a linear scan over players, using **only** distance, virtual world, server mute / deafen and
one-way local mutes. Recipients are refreshed every 250 ms. There is no script hook into this decision.

**Range.** The default range is 25 m in KCDC (`Voice.setRange`; the Framework default is 15). There are three tiers:
whisper 3 m, normal = server range, shout 25 m (`Voice.setTierRange`). Players cycle tiers with the key
`kcdc_keybind_voice_tier` (Controls > Keybinds > Multiplayer) or `Voice.setTier`. The server can give one player any
range with `Voice.setPlayerRange`.

**Playback.** The Framework's built-in mixer (miniaudio) does inverse-distance rolloff normalised to the talker's
range, plus a constant-power stereo pan capped at 60 %. Nothing else: no occlusion, no filter. KCDC instead routes voice
into the game's FMOD through `IVoiceSink`: `KCDCClient.dll` contains "Voice: FMOD refused a voice channel; leaving voice
on the framework's own device". No occlusion is applied on that path either, although KCDC traces rays for nametags
("KCDC Nametag occlusion ray").

**Limits that matter for crowds** (`voice_config.h`): at most `kMaxAudibleTalkers = 6` talkers are mixed per client
(nearest first, 12 decoders kept), the jitter buffer adapts between 2 and 10 frames (40–200 ms), and each talker costs
5 KB/s per listener.

**Third-person camera.** `ListenerTransform` already has `attenuationPosition`, documented as the place where "a
third-person game puts … the character" while the camera stays in `position`. It came in with
[PR #247](https://github.com/MafiaHub/Framework/pull/247) (merged 2026-08-15): distance is measured from it, panning
still from the camera, and zero means "unset, use the camera". Whether KCDC fills it could not be determined
statically; the probe's `camera` command tests it in game.

**Voice in the Framework's history (checked 2026-11-02).** Voice is an actively developed area: server relay M1
([#243](https://github.com/MafiaHub/Framework/pull/243)) and client mixer M2
([#245](https://github.com/MafiaHub/Framework/pull/245)) in July 2026, runtime-settable rolloff radius
([#265](https://github.com/MafiaHub/Framework/pull/265)), virtual-world routing
([#284](https://github.com/MafiaHub/Framework/pull/284)), relay and codec off the main thread
([#345](https://github.com/MafiaHub/Framework/pull/345), October), and an open PR that hands a player's Opus packets to
server scripts ([#365 `Voice.capture`](https://github.com/MafiaHub/Framework/pull/365)). A single-client test bench
with a synthetic speaker was proposed twice and closed unmerged
([#258](https://github.com/MafiaHub/Framework/pull/258), [#334](https://github.com/MafiaHub/Framework/pull/334), branch
`voice/bench` still exists). No issue, PR or branch mentions occlusion, walls or floors. The repository's licence
(MafiaHub OSS license, clause 5) permits derivative work only in order to contribute it back, so the way to change the
Framework is an issue or a pull request there, not a fork.

### Script API

| side | voice API |
|---|---|
| server | `setRange`, `setPlayerRange`, `setTierRange`, `setPlayerTier`, `setPlayerMuted`, `setPlayerDeaf`, `setLocalMute(listener, target, bool)`, `isPlayerTalking`, `isPlayerVoiceEnabled`; events `playerVoiceStart`, `playerVoiceStop`, `playerVoiceTierChange` |
| client | `setTier` / `getTier`, `getRange` (server default only), `setHearingRange` (**global** narrowing for all talkers), `setVolume` (global), `getInputLevel`, `isTalking`, `isPlayerTalking(player)`, `setIndicatorVisible`; events `voiceStart`, `voiceStop` |

**Missing:** any per-talker volume or filter on the client. The only per-pair lever is the server's `setLocalMute`, and
it is binary. A resource can therefore cut voice between two players, but it cannot muffle it.

## 2. What the game already has

### Material data

`Libs/MaterialEffects/SurfaceTypes.xml` gives every surface a `sound_obstruction`. The names are the same ones
`WorldRayHit.surface` returns, so the table can be used as is.

| surface | `sound_obstruction` |
|---|---|
| `mat_wood`, `mat_wood_soft`, `mat_glass`, `mat_water`, `mat_ceramics`, `mat_sack` | 0.1 |
| `mat_door_wood` | 0.15 |
| `mat_thatch`, `mat_rock`, `mat_door_metal` | 0.2 |
| `mat_plaster`, `mat_wicker` | 0.3 |
| `mat_soil`, `mat_mud`, `mat_gravel`, `mat_road`, `mat_field`, `mat_grass*`, `mat_forest`, `mat_vegetation`, `mat_bushes` | 0.6 |
| `mat_stairs_stone`, `mat_stairs_wood`, `mat_slope` | 0.05 |
| metals, armour, fabric, flesh, `mat_window`, `*_seethrough`, barriers | 0 |

These values are tuned for FMOD's low-pass on world sounds, not for voice; a voice model needs a scale factor (stone at
0.2 would barely dampen speech through a wall).

### Occlusion engine

- `Libs/GameAudio/default_controls.xml` declares the ATL switch `ObstrOcclCalcType` with the states `Ignore`,
  `SingleRay` and `MultiRay`; `Libs/GameAudio/g_rtpcs.xml` maps the results to the FMOD parameters `obstruction` and
  `occlusion`.
- `WHGame.dll` contains `CPropagationProcessor`, the enum `EAudioObjectObstructionCalcType` (`eAOOCT_Ignore`,
  `eAOOCT_SingleRay`, `eAOOCT_MultiRay`), `CEntityAudioProxy`, `SetAudioObstructionCalcType`, and the cvars
  `s_OcclusionMaxDistance`, `s_OcclusionMaxSyncDistance`, `s_FullObstructionMaxDistance`,
  `s_OcclusionDistanceHysteresis`, `wh_s_OcclusionRayEnabled`, `wh_s_OcclusionSmoothFloatDefaultAlpha` and
  `wh_s_ObstructionSmoothFloatDefaultAlpha`.
- `Scripts/Entities/AI/NPC.lua` and `NPC_Female.lua` set `eiSoundObstructionType = 2` (SingleRay) on every NPC;
  `Scripts/Utils/AudioUtils.lua` applies it through `ObstrOcclCalcType` on the entity's default aux audio proxy.
  Audio area and trigger-spot entities expose the same property to level designers.

### The game reads speech occlusion itself

`WHGame.dll` has `wh_s_OcclusionBubbleThreshold` ("Hide text bubbles when occlusion is above this value. See also
sound_obstruction in SurfaceTypes.xml"), `wh_s_OcclusionBubbleThresholdEnable` ("Enable hiding text bubbles on
unsuccessful raycasts") and `wh_s_OcclusionRayNPCVerticalOffset`. Gameplay code therefore reads the occlusion the audio
system computed for a speaking NPC and hides the subtitle when the NPC is behind a wall. Following the cross-references
of those cvars leads to the code that reads it.

### Speech host events

NPC speech plays through `event:/voice/dialog/bark_010`, `bark_020`, `bark_035`, `bark_050`, `bark_100`, `bark_200`,
`bark_inner`, `dialog` and `cinematic`. These are the host events KCDC's `Audio.playFile(file, entityId, purpose)`
already uses (`purpose` = `10` … `200`, `inner`, `sfp_dialog`, …).

## 3. What a server resource can do today

**Range key and reach preview: fully possible.** A key with more steps than the three tiers (e.g. 2 / 5 / 12 / 20 /
35 m) → server validates → `Voice.setPlayerRange`. Preview with `Gizmos`: a terrain-hugging ring (polyline with
`World.getGroundZ` per point) for ~1.5 s after a change, or a fan of `World.raycastAll` rays that shrinks behind walls
and leaks through open doors; plus markers over players who would hear you.

**Floors: possible, binary.** Only for pairs within range and at least 1.8 m apart in height. The server asks clients
to trace (`World.raycastAll(player, from, to, { maxHits: 8 })` runs on the chosen player's machine), counts a
"floor" as a hit with `|normal.z| ≥ 0.7` between the two heights that is neither terrain nor a stairs surface, and calls
`Voice.setLocalMute` both ways when every ray hits a floor according to either player's client (a lying client
can mute itself but cannot unmute a pair to eavesdrop). A ready resource: [voicefloors/](voicefloors/). A gallery open to a hall
stays audible because one ray gets through. To scale, classify a storey per player instead of per pair: floor height
from `Navigation.floorAt` (server-side, authoritative) plus one ray up to the ceiling per second. Limits: voice cuts
in and out instead of fading, the first words after changing floors can leak (~0.5–1 s), and walls are not handled.

**Walls with materials: possible, binary.** The same idea, with occlusion expressed as extra distance:
`effectiveDistance = distance + Σ sound_obstruction × scale`, muting when it exceeds the talker's range. A path length
through open doors from `Navigation.findPath(…, { doors: "open" })` can stand in for sound travelling around corners.
Inside the range the voice is still at full volume; only a native implementation can muffle it.

**Not possible from a resource:** muffling or partial volume for one talker, moving the audio listener to the
character in third person, making the engine's occlusion apply to voice. These are what [PROPOSAL.md](PROPOSAL.md)
asks for.
