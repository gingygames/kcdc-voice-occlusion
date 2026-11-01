# voicefloors – stop proximity voice carrying between floors (Kingdoms Connected)

A drop-in **server-only** resource for KCDC servers: players on different floors of a building stop hearing each
other in proximity voice. Nothing to install for players. It uses only today's script API, so it is binary: the voice is
cut, not muffled. Real muffling through walls and floors needs the engine-side change in [PROPOSAL.md](../PROPOSAL.md).

> **Status: experimental.** 30 automated tests pass against a fake API, and the resource starts cleanly on a real
> KCDC 1.7.3 server. Voice behaviour has **not yet been verified with two players in game**. Please report results
> (`/voicefloors why <player>` prints everything the decision was based on).

## How it works

1. Every 500 ms the server looks at pairs of players in the same virtual world who are within voice range
   (`Voice.getPlayerRange`) and at least **1.8 m apart in height**. A pair stays watched until the difference drops below
   **1.4 m** (hysteresis, so a pair on a staircase does not flicker). Every other pair is left to distance alone.
2. For each such pair it asks the players' **clients** to trace from head to head: three rays, the centre one and one
   0.5 m to each side (`World.raycastAll(player, …, { mode: "cover" })` runs on that player's machine). A crouched
   player's end of the ray sits at 1.1 m instead of 1.6 m.
3. A **floor or ceiling** is a hit whose normal is near vertical (`|normal.z| ≥ 0.7`), that is not terrain (a hill
   crest between two players is not a floor), not a stairs surface (`mat_stairs_*`), **and whose height is within
   0.6 m below to 0.3 m above the upper player's floor**. The upper player's floor is `Navigation.floorAt` on their
   position when the navmesh knows it, else their position. A table top or a bed next to the lower player's head is
   therefore not a floor.
4. If every ray hits a floor, the pair is muted both ways with `Voice.setLocalMute`. A gallery or balcony open to a hall
   stays audible, because one ray gets through.
5. **Either** client reporting a floor is enough. A modified client can therefore only mute itself; it cannot unmute a
   pair to eavesdrop, because the other side's client still reports the floor. While a pair's last verdict was "floor",
   only one client is asked per check (alternating) and the other only if the first says "open", which halves the
   traces for pairs that stay apart.
6. A change applies after two identical verdicts in a row (≈ 1 s), so pairs do not flicker on stairs. Pairs nobody has
   moved in are not traced again. When more pairs are due than `maxChecksPerTick`, pairs where someone is talking
   (`Voice.isPlayerTalking`) go first, then the longest-waiting ones.
7. It only lifts mutes it set itself. A mute set by a player, an admin tool or another resource is never touched. All
   its mutes are released when the resource stops, is turned off, or when either player of a muted pair disconnects.

### `storeys` mode

With `mode: "storeys"` the work is per player instead of per pair, O(N) traces instead of O(N²): once a second the
server reads each player's floor height with `Navigation.floorAt` and asks their client for **one ray straight up**
(6 m) from their head. A horizontal non-terrain hit means they are under a roof. A pair in range is muted when **both are
under a roof and their floor heights differ by more than 2 m**. Pairs whose floor or roof is unknown (no navmesh,
unanswered client) or whose height difference is in the ambiguous band of 1.4–2.5 m (galleries, mezzanines) are decided
by head-to-head rays exactly as in `pairs` mode. Switch at runtime with `/voicefloors set mode storeys`.

## Install

```sh
node voicefloors/build.mjs     # -> voicefloors/dist/voicefloors/
```

Copy `voicefloors/dist/voicefloors/` into your server's `resources/` folder and start it (`ensure voicefloors`). Edit
`config.js` in the copied folder to tune it and add admin Steam IDs, then restart the resource. Numbers, booleans and
`mode` can also be changed live with `/voicefloors set` (not persisted).

| setting | default | meaning |
|---|---|---|
| `enabled` | `true` | start active |
| `mode` | `"pairs"` | `pairs`: trace every pair head to head; `storeys`: one floor sample and one roof ray per player, rays only for ambiguous pairs |
| `minHeightDiff` | `1.8` | metres of height difference before a pair is watched |
| `minHeightDiffRelease` | `1.4` | a watched pair is released only below this (hysteresis on stairs) |
| `intervalMs` | `500` | how often pairs are evaluated |
| `maxChecksPerTick` | `24` | pairs traced per tick at most; talking pairs first, then oldest first |
| `rays` / `sideOffset` | `3` / `0.5` | rays per check and their sideways spacing |
| `headHeight` / `headHeightCrouched` | `1.6` / `1.1` | ray height above the feet, standing and crouched |
| `floorNormalZ` | `0.7` | how horizontal a hit must be to count as a floor |
| `floorBelow` / `floorAbove` | `0.6` / `0.3` | a floor hit must lie within this many metres below / above the upper player's floor |
| `confirmTicks` | `2` | identical verdicts before muting or unmuting |
| `moveThreshold` | `0.3` | metres a player must move before a settled pair is traced again |
| `storeyIntervalMs` | `1000` | `storeys`: how often each player's floor and roof are sampled |
| `roofRayLength` | `6` | `storeys`: metres the roof ray goes up from the head |
| `storeyFloorDiff` | `2.0` | `storeys`: floor heights further apart than this are different storeys |
| `storeyAmbiguousDiff` | `2.5` | `storeys`: pairs with a smaller height difference are traced head to head instead |
| `admins` | `[]` | Steam IDs allowed to use the admin commands |
| `isAdmin` | `null` | optional `(player) => boolean`; when set it replaces `admins` |

Hooking admin rights to another resource's export:

```js
// config.js
isAdmin: (player) => Exports.get("myadmin", "isAdmin")(player) === true,
```

## Commands

| command | who | what |
|---|---|---|
| `/voicefloors` or `/voicefloors status` | everyone | on/off, mode, watched pairs, muted pairs |
| `/voicefloors on` / `off` | admins | turn on, or off and release all its mutes |
| `/voicefloors debug` | admins | chat line on every mute and unmute |
| `/voicefloors why <nick or id>` | admins | trace you ↔ that player right now and print the verdict, the floor window, and for every ray on both clients each hit (`surface`, `kind`, `normal.z`, `z`, floor or why not); in `storeys` mode also both players' floor and roof. Changes no mute |
| `/voicefloors stats` | admins | rays in the last 60 s, average client reply time, share unanswered, pairs watched / muted, mode |
| `/voicefloors set <key> <value>` | admins | change a number, boolean or `mode` setting until the resource restarts; prints old → new; unknown key is an error |

Example `why` output:

```
why Hans <-> Theresa: dz 3.20 m, distance 3.77 m, mode pairs, pair muted, last verdict floor.
floor window 2.60..3.50 m from Theresa (floorAt z 3.20); heads 1.60 / 1.60 m.
client Hans: FLOOR on every ray
  ray 1: mat_wood brush nz 1.00 z 1.00 -> not floor: z outside floor window 2.60..3.50
  ray 1: mat_wood brush nz 1.00 z 3.00 -> floor
  ...
client Theresa: OPEN
  ray 3: no hits -> open
verdict: floor between -> mute.
```

## Limits

- **Cut, not muffled.** Inside range a voice is either at its normal distance volume or gone.
- **First words can leak** for ~0.5–1 s after someone changes floor (tick + confirmation + client round trip).
- **Walls on the same floor are not handled.** Only vertical separation.
- **Horizontal props at floor height** (a loft bed, a wide beam right under the upper floor) still count as floors if
  all three rays cross them. Props at other heights no longer do.
- **Cost:** `pairs` mode traces only pairs with a height difference, in range, that moved; at most
  `maxChecksPerTick` × 2 clients × `rays` traces per tick, half that for pairs that stay separated. `storeys` mode
  costs one ray per player per second plus head-to-head rays for ambiguous pairs only.

## Test

```sh
node voicefloors/test/voicefloors.test.mjs
```

Runs the resource against a fake KCDC API (with `Navigation.floorAt`, `Player.crouched` and `Voice.isPlayerTalking`):
muting across floors, unmuting on the same floor, galleries, a lying client, walls / terrain / stairs, the floor window
(table tops, `floorAt`), hysteresis on stairs, crouching, talking-first priority, the one-client shortcut, unanswered
traces, foreign mutes, no re-tracing of settled pairs, virtual worlds, release on stop and on disconnect, the `isAdmin`
hook, `why` / `stats` / `set`, and `storeys` mode (mute, no roof, same storey, ambiguous fallback, sampling interval).
