import type { TrackDef } from '../track';

/**
 * CANYON TRACK - Main FPV racing circuit
 * 12 gates, ~450 m total distance, target lap ~25 s at 18 m/s
 * 
 * Layout:
 *  - Gates 0-3: fast opening section with banking offsets (~110m)
 *  - Gates 4-6: sharp hairpin turn with 180° reversal (~90m)
 *  - Gate 7: signature HIGH gate at y≈13 m (climb element)
 *  - Gate 8: signature DIVE gate at y≈1.8 m (dive element)
 *  - Gates 9-11: sweeping S-curves back to start/finish (~150m)
 *  - Sector 1 (G0-3): opening sprint
 *  - Sector 2 (G4-8): technical zone (hairpin + climb/dive)
 *  - Sector 3 (G9-0): recovery s-curves
 */
export const canyonTrack: TrackDef = {
  name: 'Canyon Run',
  spawn: {
    // 20 m before G0 along its normal, facing straight through it.
    pos: [-19.3, 2.5, -5.1],
    yawDeg: -104.7,
  },
  bounds: {
    min: [-150, 0, -40],
    max: [150, 65, 180],
  },
  gates: [
    // ===== SECTOR 1: OPENING SPRINT (Gates 0-3, ~110m) =====
    // G0: start/finish. Normal = avg of incoming (from G11) and outgoing (to G1).
    {
      pos: [0, 2.5, 0],
      yawDeg: -104.7,
      size: { w: 5, h: 5 },
      kind: 'square',
    },
    // G1: first banking offset right, 28m away
    {
      pos: [3, 2.5, 28],
      yawDeg: -171.5,
      size: { w: 4.5, h: 5 },
      kind: 'square',
    },
    // G2: banking further right, 27m away, banking turn begins
    {
      pos: [8, 2.8, 54],
      yawDeg: -176.6,
      size: { w: 4.5, h: 5 },
      kind: 'square',
    },
    // G3: exit opening section, 28m away, heading into hairpin entry
    {
      pos: [6, 2.6, 82],
      yawDeg: -151.3,
      size: { w: 4.5, h: 5 },
      kind: 'square',
    },

    // ===== SECTOR 2: TECHNICAL ZONE (Gates 4-8, ~170m) =====
    // HAIRPIN (Gates 4-6)
    // G4: hairpin entry, 27m away, heading right
    {
      pos: [30, 2.5, 95],
      yawDeg: -109.0,
      size: { w: 5, h: 5 },
      kind: 'square',
    },
    // G5: hairpin apex (perpendicular tight left turn), 30m away
    {
      pos: [60, 2.8, 100],
      yawDeg: -165.4,
      size: { w: 5, h: 5 },
      kind: 'square',
    },
    // G6: hairpin exit, 32m away, heading left toward climb
    {
      pos: [35, 2.5, 120],
      yawDeg: 121.3,
      size: { w: 5, h: 5 },
      kind: 'square',
    },

    // CLIMB & DIVE
    // G7: HIGH gate (signature climb), 49m away from G6, y=13 m (center height)
    // Gate is 8m tall, so bottom at y=9, top at y=17
    {
      pos: [-10, 13, 140],
      yawDeg: 118.8,
      size: { w: 4, h: 8 },
      kind: 'square',
    },
    // G8: DIVE gate (signature dive), 36m away from G7, y=1.8 m (near ground)
    // Steep descent from HIGH gate
    {
      pos: [-40, 1.8, 160],
      yawDeg: 84.3,
      size: { w: 5, h: 5 },
      kind: 'square',
    },

    // ===== SECTOR 3: RECOVERY S-CURVES & FINISH (Gates 9-11, ~150m) =====
    // G9: s-curve start, 42m away, heading left-ish
    {
      pos: [-70, 2.5, 130],
      yawDeg: 16.8,
      size: { w: 5, h: 5 },
      kind: 'square',
    },
    // G10: s-curve mid, 51m away
    {
      pos: [-60, 2.5, 80],
      yawDeg: -24.6,
      size: { w: 5, h: 5 },
      kind: 'square',
    },
    // G11: s-curve exit, 57m away, heading back toward G0
    {
      pos: [-25, 2.5, 35],
      yawDeg: -36.7,
      size: { w: 5, h: 5 },
      kind: 'square',
    },
  ],
  sectorEnds: [3, 8],
  decorations: [
    // Opening section cones
    { type: 'cone', pos: [1, 0, 14] },
    { type: 'cone', pos: [5, 0, 40] },
    { type: 'ramp', pos: [9, 0, 68], yawDeg: 175 },

    // Hairpin markers
    { type: 'cone', pos: [25, 0, 90] },
    { type: 'cone', pos: [50, 0, 98] },
    { type: 'cone', pos: [40, 0, 110] },

    // Climb approach and post-climb
    { type: 'cone', pos: [10, 0, 125] },
    { type: 'ramp', pos: [-5, 0, 135], yawDeg: 120 },

    // Post-dive markers
    { type: 'cone', pos: [-50, 0, 165] },
    { type: 'cone', pos: [-80, 0, 145] },

    // S-curve recovery cones
    { type: 'cone', pos: [-65, 0, 105] },
    { type: 'cone', pos: [-30, 0, 55] },
  ],
};
