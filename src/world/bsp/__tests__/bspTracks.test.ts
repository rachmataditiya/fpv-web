// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTrack, savedTrackFor, saveTrackFor, deleteTrackFor } from '../bspTracks';
import type { GateDef } from '../../track';

const gates: GateDef[] = [
  { pos: [0, 2, 0], yawDeg: 0, size: { w: 4, h: 4 }, kind: 'square' },
  { pos: [30, 2, -10], yawDeg: 45, size: { w: 4, h: 4 }, kind: 'square' },
  { pos: [10, 4, -40], yawDeg: 90, size: { w: 4, h: 4 }, kind: 'square' },
];

describe('bspTracks', () => {
  beforeEach(() => localStorage.clear());

  it('buildTrack derives bounds and sectors', () => {
    const t = buildTrack('test', gates, { pos: [0, 1, 10], yawDeg: 0 });
    expect(t.gates).toHaveLength(3);
    expect(t.sectorEnds).toEqual([1]); // n=3 → [floor(3/2)]
    expect(t.bounds.min[0]).toBeLessThan(0);
    expect(t.bounds.max[0]).toBeGreaterThan(30);
    expect(t.bounds.max[1]).toBeGreaterThan(50); // generous headroom
  });

  it('save/load/delete roundtrip per map id', () => {
    const t = buildTrack('dust', gates, { pos: [0, 1, 10], yawDeg: 0 });
    expect(savedTrackFor('server:dust2')).toBeNull();
    saveTrackFor('server:dust2', t);
    const back = savedTrackFor('server:dust2');
    expect(back).not.toBeNull();
    expect(back!.gates).toHaveLength(3);
    expect(savedTrackFor('custom:other')).toBeNull(); // keyed per map
    deleteTrackFor('server:dust2');
    expect(savedTrackFor('server:dust2')).toBeNull();
  });
});
