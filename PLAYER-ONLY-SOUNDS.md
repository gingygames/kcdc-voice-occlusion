# Other players' "first-person" sounds are heard at any distance (dice, washing, cooking)

A bug in Kingdoms Connected 1.7.3, unrelated to voice occlusion but found with the same probe. Reported to the KCDC
team on 2026-11-02; this page is the reference for that report.

## Symptom

When another player plays dice, washes or cooks, everyone who has that player streamed hears it at full volume and
with no direction, as if they were doing it themselves. At Ratboř manor a dice game is audible down in the village.
It seems to happen "only in some places": those are the places where other players happen to be within streaming
range of the table, trough or pot.

## Cause (game data, `Libs/GameAudio/special.xml`)

Kingdom Come: Deliverance II has a separate set of sounds for actions that, in single player, only Henry performs.
They are never distance-culled (`distance_culling="65535"`), some carry controller haptics (`osh_preset`), and they are
2D: the one who performs the action is always at distance zero. Positioned variants with normal culling exist next
to them for NPCs and the surroundings.

| action | player-only trigger (never culled, 2D) | positioned variant (culled) |
|---|---|---|
| dice | `dice_wood1_player`, `dice_shake_player`, `dice_bowl_put_player` (haptics 70 / 71) | `dice_put`, `dice_take`, `dice_table_short`, `dice_bowl_handling1`, `dice_bowl_handling2` (5 m) |
| washing | `special_player_washing` → `event:/special/player_washing` | water foley, `f_water_add_bath` (15 m) |
| laundry | `special_washing_laundry` | – |
| cooking | `special_player_cooking` → `event:/special/player_cooking` | `special_player_eat_from_kettle` is culled (5 m) |
| same family | `special_player_spurs_use`, `special_barber_scissors`, `special_hc_back_crack`, `special_pickpocket_*`, `special_lockpicking_*`, `special_alchemy_*`, `special_player_death`, `dice_won` / `dice_lost`, `ui_consume_drink(_loop)`, `special_skiptime_*`, `c_perfect_block`, `c_master_strike` | |

Outside cinematics 591 triggers are never culled; almost all are UI, music, weather, and this first-person family.

A remote player's body in KCDC is a player character, not an NPC, so when it performs the washing, cooking or dice
animation the game (or KCDC's own sync) fires the player-only variant.

## Verified in game (2026-11-02, KCDC 1.7.3, one client, [probe](probe/))

| trigger played on the probe NPC | 40–60 m away | conclusion |
|---|---|---|
| `special_player_washing` | **heard unchanged** | 2D, never culled |
| `f_ta_leather_wash` | not heard | positioned variant behaves |
| `dice_wood1_player` | **heard** | 2D, never culled |
| `dice_put` | not heard | positioned variant behaves |
| `special_player_washing` then `/voiceprobe stop` | gone | bound to the entity (probably; `quiet` = `Audio.stopOnEntity` is the exact check) |

Repro: `/voiceprobe play trigger:special_player_washing`, walk 50 m away.

## Suggested fix (KCDC)

On bodies that are not the local player, suppress triggers of this family, or map `*_player` triggers to the
positioned variant (`dice_wood1_player` → `dice_table_short`, `dice_bowl_put_player` → `dice_put`, …). The list is
mechanical: every non-cinematic `ATLTrigger` in `special.xml` and `ui.xml` whose `FmodEvent` has
`distance_culling="65535"`.

## Script-side patch until then (possible if the sounds are entity-bound)

- **Dice, precisely:** the server sees `diceTurnStart` / `diceRoll` / `diceMove` and both players (`Dice` API); it
  tells nearby clients, which call `Audio.stopOnEntity("dice_shake_player" | "dice_wood1_player" |
  "dice_bowl_put_player", entityId)` on both bodies and play the positioned `dice_table_short` / `dice_put` with
  `playOnEntity` instead, so the dice are heard at the table but not in the village.
- **Washing, cooking, laundry (no event):** every ~200 ms the client walks the other players within ~80 m and calls
  `Audio.stopOnEntity` for `special_player_washing`, `special_player_cooking`, `special_washing_laundry` (stopping a
  trigger that is not playing is not an error). At most 200 ms of each sound leaks.
- Never touch the local player's own body, so players keep hearing their own washing.
- A band-aid: switch it off once KCDC fixes the mapping.

## Related finding

A file started with `Audio.playFile` cannot be stopped by a script and plays to its end even when its entity is
removed; ATL triggers (`playOnEntity`) stop with the entity. Details in [FINDINGS.md](FINDINGS.md#speech-host-events).
