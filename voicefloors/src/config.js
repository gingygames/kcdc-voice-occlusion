// voicefloors configuration. Edit, then restart the resource (ensure voicefloors).
globalThis.VOICEFLOORS_CONFIG = {
  enabled: true,
  // Only pairs at least this far apart in height are checked (metres). Below it, distance alone decides.
  minHeightDiff: 1.8,
  // How often pairs are re-evaluated (ms).
  intervalMs: 500,
  // Most pairs checked per tick; the rest wait their turn, oldest first. Each check asks both players' clients for
  // `rays` traces.
  maxChecksPerTick: 24,
  // Rays per check: 1 = head to head; 3 = also 0.5 m to each side, so a pillar or a table does not count as a floor
  // and a gallery open to a hall stays audible.
  rays: 3,
  sideOffset: 0.5,
  headHeight: 1.6,
  // A hit counts as floor/ceiling when its normal is at least this vertical (0.7 ≈ within 45°).
  floorNormalZ: 0.7,
  // Consecutive identical verdicts needed before a pair is muted or unmuted, against flicker on stairs.
  confirmTicks: 2,
  // Skip re-checking a confirmed pair while neither player moved more than this (metres).
  moveThreshold: 0.3,
  // Steam IDs allowed to use /voicefloors on|off|debug. Everyone can use /voicefloors status.
  admins: [],
};
