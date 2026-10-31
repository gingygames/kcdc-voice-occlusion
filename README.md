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
| [probe/](probe/) | a small resource that tests the key assumption in game with one client |

## Status

| | |
|---|---|
| API, Framework source and game data analysis | done (2026-10-31, KCDC 1.7.3) |
| In-game probe (does a KCDC-played speech event respond to `ObstrOcclCalcType`?) | pending, results will be added here |
| Script-only floor fallback for servers ([voicefloors/](voicefloors/)) | experimental: tests pass, starts on KCDC 1.7.3, not yet verified with two players |

## Notes

- Not affiliated with Kingdoms Connected, MafiaHub or Warhorse Studios. No game files are included. Names, numbers and
  short strings are quoted so they can be checked in your own install.
- Corrections and results from other servers are welcome as issues or pull requests.

Code and text: [MIT](LICENSE).
