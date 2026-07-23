import type { TrackDef } from '../track';

/**
 * BOX TRACK - Simple 4-gate test square for validating gate detection.
 * ~50×50 m counter-clockwise loop, all gates 5×5 m flat (y=2.5 m).
 *
 * Gate normals point along the AVERAGE of the incoming and outgoing travel
 * directions (each corner is a 90° turn, so the gate sits at 45° to both legs —
 * dot(travel, normal) = 0.71 on both sides of every crossing).
 */
export const boxTrack: TrackDef = {
  name: 'Box',
  // Spawn 25 m before G0 along its normal, facing straight through it.
  spawn: { pos: [17.7, 2.5, 32.3], yawDeg: 135 },
  bounds: { min: [-100, 0, -50], max: [100, 50, 100] },
  gates: [
    // G0: start/finish. In: +Z (from G3), out: −X (to G1) → normal at 135°.
    { pos: [0, 2.5, 50], yawDeg: 135, size: { w: 5, h: 5 }, kind: 'square' },
    // G1: in −X, out −Z → 45°.
    { pos: [-50, 2.5, 50], yawDeg: 45, size: { w: 5, h: 5 }, kind: 'square' },
    // G2: in −Z, out +X → −45°.
    { pos: [-50, 2.5, 0], yawDeg: -45, size: { w: 5, h: 5 }, kind: 'square' },
    // G3: in +X, out +Z → −135°.
    { pos: [0, 2.5, 0], yawDeg: -135, size: { w: 5, h: 5 }, kind: 'square' },
  ],
  sectorEnds: [1],
};
