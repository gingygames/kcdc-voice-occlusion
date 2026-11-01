// voicefloors configuration. Edit, then restart the resource (ensure voicefloors). Admins can change number and
// boolean keys (and `mode`) at runtime with /voicefloors set <key> <value>; that is not persisted.
globalThis.VOICEFLOORS_CONFIG = {
  enabled: true,
  // "pairs": every pair with a height difference is traced head to head on both clients (O(N²) in a full house).
  // "storeys": each player is sampled once per storeyIntervalMs (Navigation.floorAt on the server plus one ray up to the
  // roof on their client); pairs both under a roof on floors more than storeyFloorDiff apart are muted. Pairs whose floor
  // is unknown or whose height difference is in the ambiguous band (minHeightDiffRelease..storeyAmbiguousDiff, galleries)
  // fall back to head-to-head rays. O(N) traces.
  mode: "pairs",
  // A pair starts being watched at this height difference (metres) and stops being watched only below
  // minHeightDiffRelease, so a pair on a staircase does not flicker. Below that, distance alone decides.
  minHeightDiff: 1.8,
  minHeightDiffRelease: 1.4,
  // How often pairs are re-evaluated (ms).
  intervalMs: 500,
  // Most pairs checked per tick; the rest wait their turn. Pairs where someone is talking go first, then oldest first.
  maxChecksPerTick: 24,
  // Rays per check: 1 = head to head; 3 = also 0.5 m to each side, so a pillar or a table does not count as a floor
  // and a gallery open to a hall stays audible.
  rays: 3,
  sideOffset: 0.5,
  // Ray height above the feet, standing and crouched.
  headHeight: 1.6,
  headHeightCrouched: 1.1,
  // A hit counts as floor/ceiling when its normal is at least this vertical (0.7 ≈ within 45°) ...
  floorNormalZ: 0.7,
  // ... and its height is within [upper player's floor − floorBelow, upper player's floor + floorAbove] (metres). The
  // upper player's floor is Navigation.floorAt when the navmesh knows it, else their position. A table top or a bed by
  // the lower player's head is therefore not a floor.
  floorBelow: 0.6,
  floorAbove: 0.3,
  // Consecutive identical verdicts needed before a pair is muted or unmuted, against flicker on stairs.
  confirmTicks: 2,
  // Skip re-checking a confirmed pair while neither player moved more than this (metres).
  moveThreshold: 0.3,
  // storeys mode: how often each player is sampled (ms), how far up the roof ray goes (m), how far apart two floor
  // heights must be to count as different storeys (m), and the height difference below which a pair is ambiguous
  // (gallery, mezzanine) and is traced head to head instead (m).
  storeyIntervalMs: 1000,
  roofRayLength: 6,
  storeyFloorDiff: 2.0,
  storeyAmbiguousDiff: 2.5,
  // Steam IDs allowed to use /voicefloors on|off|debug|stats|why|set. Everyone can use /voicefloors status.
  admins: [],
  // Optional: a function deciding admin rights instead of the `admins` list, e.g. from another resource's export:
  //   isAdmin: (player) => Exports.get("myadmin", "isAdmin")(player) === true,
  isAdmin: null,
};
