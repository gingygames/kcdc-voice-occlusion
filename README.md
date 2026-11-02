# Occlusion-aware proximity voice for Kingdoms Connected

Research and a feature proposal for [Kingdoms Connected](https://kingdomsconnected.com) (KCD2 multiplayer on the
MafiaHub Framework): proximity voice that respects **walls, floors, doors and materials**, so a council meeting
upstairs isn't heard by everyone waiting downstairs.

**TL;DR**

- Voice today is relayed by distance only and mixed with distance rolloff and stereo pan. Walls and floors don't
  matter, and a server script can only mute pairs of players, not muffle them.
- **Kingdom Come: Deliverance II already computes occlusion for its own speech.** Every NPC uses the engine's
  occlusion rays (`NPC.lua`), the game hides NPC subtitles when that occlusion is high (`wh_s_OcclusionBubbleThreshold`),
  every surface has a `sound_obstruction` value, and NPC speech plays through the same FMOD host events
  (`event:/voice/dialog/bark_0XX`) that KCDC already uses for `Audio.playFile`.
- So voice could get realistic occlusion largely from the engine: either play live voice as a native speech line
  (Option A0) or apply the engine's computed occlusion to the existing voice channel (Option A). Cost stays flat in
  crowds, because a client mixes at most 6 talkers.
- Until then, server owners can drop in [voicefloors/](voicefloors/): it stops voice carrying **between floors**
  today (binary, via `Voice.setLocalMute`, server-only, experimental).

| document | content |
|---|---|
| [FINDINGS.md](FINDINGS.md) | how KCDC voice works today, the script API, what the game data and binary contain, what a resource can do now |
| [PROPOSAL.md](PROPOSAL.md) | proposed implementation: Framework layer, KCDC occlusion provider (A0 / A / B), crowds, third-person camera, cheating, tests |
| [voicefloors/](voicefloors/) | **for server owners now:** server-only resource that mutes players on different floors |
| [probe/](probe/) | a small resource that tests the key assumption in game with one client, records results, lists who you hear |
| [quietactions/](quietactions/) | **for server owners now:** band-aid for that bug: silences those sounds on other players' bodies and plays positioned dice sounds instead |
| [PLAYER-ONLY-SOUNDS.md](PLAYER-ONLY-SOUNDS.md) | a related KCDC bug found with the probe: other players' dice, washing and cooking are heard at any distance (never-culled 2D "player" sound variants), with the trigger list, repro and a possible script-side patch |
| [CHANGELOG.md](CHANGELOG.md) | what changed in each version |

## Status

[![test](https://github.com/gingygames/kcdc-voice-occlusion/actions/workflows/test.yml/badge.svg)](https://github.com/gingygames/kcdc-voice-occlusion/actions/workflows/test.yml)

| | |
|---|---|
| API, Framework source and game data analysis | done (2026-10-31, KCDC 1.7.3) |
| In-game probe (does a KCDC-played speech event respond to `ObstrOcclCalcType`, or to the FMOD `occlusion` parameter set directly?) | **done 2026-11-02, KCDC 1.7.3, one client, Kuttenberg tavern:** the switch is accepted; `MultiRay` is audibly muffled compared with `Ignore` outside behind the wall on the same floor; one storey up no difference was heard (wooden floors carry `sound_obstruction` 0.1, so a voice model needs a floor penalty); `occlusion=1` set directly muffles clearly (4/5), so the speech events do automate the parameter; moving the camera 15 m back changes loudness, so the game's listener follows the camera, not the body. Option A0 is viable; details in [PROPOSAL.md](PROPOSAL.md#probe-results-2026-11-02) |
| Script-only floor fallback for servers ([voicefloors/](voicefloors/)) | 0.2.0, experimental: 30 tests pass, starts on KCDC 1.7.3, not yet verified with two players |
| Player-only game sounds heard everywhere ([PLAYER-ONLY-SOUNDS.md](PLAYER-ONLY-SOUNDS.md)) | verified in game 2026-11-02; KCDC bug, reported to the team; band-aid resource [quietactions/](quietactions/) 0.1.0 (8 tests, not yet verified with two players) |
| Framework-side proposal (Layer 1 of [PROPOSAL.md](PROPOSAL.md)) | filed as [MafiaHub/Framework#367](https://github.com/MafiaHub/Framework/issues/367) on 2026-11-02, awaiting the maintainers' view; a pull request is offered there |

Ready-to-copy resource folders (`voicefloors.zip`, `voiceprobe.zip`) are attached to each
[release](https://github.com/gingygames/kcdc-voice-occlusion/releases) and built by CI for every push. Tested it on
your server? Please open a [test report](https://github.com/gingygames/kcdc-voice-occlusion/issues/new?template=test-report.yml).

## Notes

- Not affiliated with Kingdoms Connected, MafiaHub or Warhorse Studios. No game files are included. Names, numbers and
  short strings are quoted so they can be checked in your own install.
- Corrections and results from other servers are welcome as issues or pull requests.

Code and text: [MIT](LICENSE).
