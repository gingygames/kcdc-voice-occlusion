// quietactions configuration. Edit, then restart the resource (ensure quietactions).
globalThis.QUIETACTIONS_CONFIG = {
  enabled: true,
  // Other players within this many metres are watched (metres).
  radius: 80,
  // How often each client silences the never-culled "player" sounds on the bodies of other players (ms).
  pollIntervalMs: 200,
  // How often the server refreshes each client's list of nearby players (ms).
  nearIntervalMs: 1000,
  // Player-only triggers to silence on other players' bodies (never distance-culled in Libs/GameAudio/special.xml).
  pollTriggers: ["special_player_washing", "special_player_cooking", "special_washing_laundry"],
  // Dice: silence these on both players' bodies at every server dice event...
  diceTriggers: ["dice_shake_player", "dice_wood1_player", "dice_bowl_put_player"],
  // ...and play this positioned trigger on the acting player's body when the server deals a roll ("" = none).
  diceRollSound: "dice_table_short",
  // Steam IDs allowed to use /quietactions on|off|stats. Everyone can use /quietactions status.
  admins: [],
  // Optional: (player) => boolean, replaces `admins` when set.
  isAdmin: null,
};
