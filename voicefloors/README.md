# voicefloors – stop proximity voice carrying between floors (Kingdoms Connected)

A drop-in **server-only** resource for KCDC servers: players on different floors of a building stop hearing each
other in proximity voice. Nothing to install for players. It uses only today's script API, so it is binary: the voice is
cut, not muffled. Real muffling through walls and floors needs the engine-side change in [PROPOSAL.md](../PROPOSAL.md).

> **Status: experimental.** 13 automated tests pass against a fake API, and the resource starts cleanly on a real
> KCDC 1.7.3 server. Voice behaviour has **not yet been verified with two players in game**. Please report results.

## How it works

1. Every 500 ms the server looks at pairs of players in the same virtual world who are within voice range
   (`Voice.getPlayerRange`) and at least **1.8 m apart in height**. Every other pair is left to distance alone.
2. For each such pair it asks **both players' clients** to trace from head to head: three rays, the centre one and one
   0.5 m to each side (`World.raycastAll(player, …, { mode: "cover" })` runs on that player's machine).
3. A **floor or ceiling** is a hit whose normal is near vertical (`|normal.z| ≥ 0.7`), that is not terrain (a hill
   crest between two players is not a floor) and not a stairs surface (`mat_stairs_*`).
4. If every ray hits a floor, the pair is muted both ways with `Voice.setLocalMute`. A gallery or balcony open to a hall
   stays audible, because one ray gets through.
5. **Either** client reporting a floor is enough. A modified client can therefore only mute itself; it cannot unmute a
   pair to eavesdrop, because the other side's client still reports the floor.
6. A change applies after two identical verdicts in a row (≈ 1 s), so pairs do not flicker on stairs. Pairs nobody has
   moved in are not traced again.
7. It only lifts mutes it set itself. A mute set by a player, an admin tool or another resource is never touched. All
   its mutes are released when the resource stops or is turned off.

## Install

```sh
node voicefloors/build.mjs     # -> voicefloors/dist/voicefloors/
```

Copy `voicefloors/dist/voicefloors/` into your server's `resources/` folder and start it (`ensure voicefloors`). Edit
`config.js` in the copied folder to tune it and add admin Steam IDs, then restart the resource.

| setting | default | meaning |
|---|---|---|
| `enabled` | `true` | start active |
| `minHeightDiff` | `1.8` | metres of height difference before a pair is checked |
| `intervalMs` | `500` | how often pairs are evaluated |
| `maxChecksPerTick` | `24` | pairs traced per tick at most, oldest first |
| `rays` / `sideOffset` | `3` / `0.5` | rays per check and their sideways spacing |
| `headHeight` | `1.6` | ray height above the feet |
| `floorNormalZ` | `0.7` | how horizontal a hit must be to count as a floor |
| `confirmTicks` | `2` | identical verdicts before muting or unmuting |
| `moveThreshold` | `0.3` | metres a player must move before a settled pair is traced again |
| `admins` | `[]` | Steam IDs allowed to use `on`, `off` and `debug` |

## Commands

| command | who | what |
|---|---|---|
| `/voicefloors` or `/voicefloors status` | everyone | on/off, watched pairs, muted pairs |
| `/voicefloors on` / `off` | admins | turn on, or off and release all its mutes |
| `/voicefloors debug` | admins | chat line on every mute and unmute |

## Limits

- **Cut, not muffled.** Inside range a voice is either at its normal distance volume or gone.
- **First words can leak** for ~0.5–1 s after someone changes floor (tick + confirmation + client round trip).
- **Walls on the same floor are not handled.** Only vertical separation.
- **Horizontal props count as floors** if all three rays cross them (a large table top between two heads at the right
  angle). The side rays make this rare.
- **Cost:** traces only for pairs with a height difference, in range, that moved; at most `maxChecksPerTick` × 2
  clients × `rays` traces per tick. In a very full two-storey building, lower `maxChecksPerTick` or raise `intervalMs`.

## Test

```sh
node voicefloors/test/voicefloors.test.mjs
```

Runs the resource against a fake KCDC API: muting across floors, unmuting on the same floor, galleries, a lying
client, walls / terrain / stairs, unanswered traces, foreign mutes, no re-tracing of settled pairs, virtual worlds,
release on stop, admin commands.
