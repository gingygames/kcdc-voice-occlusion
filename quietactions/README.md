# quietactions – stop other players' dice, washing and cooking from being heard everywhere

A drop-in resource for Kingdoms Connected servers that works around a KCDC bug described in
[PLAYER-ONLY-SOUNDS.md](../PLAYER-ONLY-SOUNDS.md): the game's first-person sound variants for dice, washing, cooking
and laundry are never distance-culled and 2D, and KCDC fires them on the bodies of other players, so a dice game in a
manor is heard down in the village and someone washing sounds as if you were washing yourself.

**This is a band-aid.** The fix belongs in KCDC (fire the positioned variants on remote bodies). Until then this
resource silences those sounds on other players' bodies on every client and, for dice, plays the positioned table
sound instead. Switch it off once KCDC fixes it.

> **Status: experimental.** 8 automated tests pass against a fake API. The in-game assumption behind it (the sounds
> are bound to the player's body entity, so `Audio.stopOnEntity` reaches them) was observed once with one client and
> still needs a two-player check. Please report results.

## How it works

- **Nearby players.** Clients cannot list players, so every second the server sends each client the ids of the other
  players within `radius` (80 m), only when the list changed.
- **Washing, cooking, laundry.** Every `pollIntervalMs` (200 ms) the client calls `Audio.stopOnEntity` for
  `special_player_washing`, `special_player_cooking` and `special_washing_laundry` on each of those bodies. Stopping a
  trigger that is not playing is not an error, so this is cheap; at most 200 ms of a sound leaks.
- **Dice.** The server sees every dice event (`diceMatchStart`, `diceTurnStart`, `diceRoll`, `diceMove`,
  `diceTurnEnd`, `diceMatchEnd`) with both players. It tells the clients within `radius` of the table, which cut
  `dice_shake_player`, `dice_wood1_player` and `dice_bowl_put_player` on both bodies; on a roll they play
  `dice_table_short` positioned on the acting player's body, so the dice are heard at the table and nowhere else.
- **Never the local body.** A player keeps hearing their own washing, cooking and dice exactly as the game intends.

## Install

```sh
node quietactions/build.mjs     # -> quietactions/dist/quietactions/
```

Copy `quietactions/dist/quietactions/` into your server's `resources/` folder and start it (`ensure quietactions`).
Edit `config.js` in the copied folder to tune it and add admin Steam IDs, then restart the resource.

| setting | default | meaning |
|---|---|---|
| `enabled` | `true` | start active |
| `radius` | `80` | other players within this many metres are watched |
| `pollIntervalMs` | `200` | how often each client silences the polled triggers |
| `nearIntervalMs` | `1000` | how often the server refreshes each client's neighbour list |
| `pollTriggers` | washing, cooking, laundry | player-only triggers silenced on other bodies |
| `diceTriggers` | shake, wood, bowl | player-only dice triggers silenced at every dice event |
| `diceRollSound` | `"dice_table_short"` | positioned trigger played on the acting body on a roll (`""` = none) |
| `admins` | `[]` | Steam IDs allowed to use `on`, `off`, `stats` |
| `isAdmin` | `null` | optional `(player) => boolean`, replaces `admins` |

## Commands

| command | who | what |
|---|---|---|
| `/quietactions` or `/quietactions status` | everyone | on/off, triggers, interval, dice matches watched |
| `/quietactions on` / `off` | admins | turn on or off (clients follow) |
| `/quietactions stats` | admins | per client: how many silence calls hit a body, how many dice rolls were replaced |

## Limits

- Up to one poll interval of a washing or cooking sound can still be heard.
- Dice events arrive from the server, so the first-person dice sound may start a network round trip before it is cut.
- Only the triggers listed are handled; see [PLAYER-ONLY-SOUNDS.md](../PLAYER-ONLY-SOUNDS.md) for the whole family.

## Test

```sh
node quietactions/test/quietactions.test.mjs
```
