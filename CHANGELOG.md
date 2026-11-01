# Changelog

## 0.2.0 – 2026-11-01

### voicefloors

- **Floor plausibility window.** A horizontal hit counts as a floor only when its height lies within `floorBelow`
  (0.6 m) below and `floorAbove` (0.3 m) above the upper player's floor, taken from `Navigation.floorAt` when the mesh
  knows it. A table top or a bed by the lower player's head no longer mutes a pair.
- **Hysteresis on stairs:** a pair is watched from 1.8 m of height difference and released only below 1.4 m
  (`minHeightDiffRelease`).
- **Crouching:** the ray end of a crouched player sits at `headHeightCrouched` (1.1 m).
- **Talking pairs first** when more pairs are due than `maxChecksPerTick` allows.
- **Fewer rays:** when the last verdict was "floor", one client (alternating) is asked first and the other only if it
  reports an open line. Either client reporting a floor still mutes.
- **Disconnect** now releases the mutes of the remaining player instead of just forgetting them.
- **`isAdmin(player)` hook** in `config.js` as an alternative to the `admins` Steam ID list.
- **Commands:** `/voicefloors why <player>` (trace the pair now and print every hit with the reason it did or did not
  count as a floor), `/voicefloors stats` (rays in the last 60 s, client reply time, unanswered share),
  `/voicefloors set <key> <value>` (runtime tuning until restart).
- **`mode: "storeys"`** (opt-in): one `Navigation.floorAt` and one roof ray per player per second instead of
  head-to-head rays per pair, O(N) instead of O(N²); ambiguous pairs (galleries, unknown floor) fall back to rays.
- 30 tests against the fake API (was 13).

### probe (voiceprobe / hlassonda)

- All texts, the command word and the subcommand words live in `src/strings.js`; a translated copy builds a localised
  resource (the Czech `hlassonda`).
- `occlusion <0-1>|off`: sets the FMOD parameters `occlusion` and `obstruction` on the probe directly.
- `ab [seconds|off]`: alternates `Ignore` / `MultiRay` on the playing sound without restarting it.
- `result <place> <0-5> [note]`: records observations with mode, parameters, distance and height difference into
  `resources/<name>/data/results.json`; `probe/tools/results-md.mjs` renders them as Markdown tables.
- `hear`: which players this client is playing right now (objective check for voicefloors).
- `bench [rays]`: times `World.raycastAll`; `nav`: `Navigation.floorAt` and path lengths through doors.
- 11 tests against a fake API, runnable with any strings file.

### repo

- GitHub Actions: tests, builds and zipped resources as artifacts on every push.
- Issue template "Test report" for results from other servers.

## 0.1.0 – 2026-10-31

- Research (FINDINGS.md), proposal for the KCDC team (PROPOSAL.md), one-client probe, `voicefloors` 0.1.0.
