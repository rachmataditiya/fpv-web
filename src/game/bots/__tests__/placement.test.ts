import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../rng';
import { samplePoint } from '../placement';
import type { PlacementSpec } from '../placement';
import type { CollisionWorld } from '../../../physics/quad';

/** Flat world at y=0; strictFloor null outside |x|,|z| <= 50 (map footprint). */
const flatWorld: CollisionWorld = { floorAt: () => 0 };
const footprint = (x: number, z: number) => (Math.abs(x) <= 50 && Math.abs(z) <= 50 ? 0 : null);

function spec(over: Partial<PlacementSpec> = {}): PlacementSpec {
  return {
    world: flatWorld,
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    strictFloor: footprint,
    avoid: { x: 0, z: 0 },
    avoidRadius: 20,
    others: [],
    minSeparation: 8,
    footRadius: 0.4,
    clearance: 2.2,
    rng: mulberry32(1),
    ...over,
  };
}

describe('bot placement', () => {
  it('only returns points on the map footprint, clear of the avoid radius', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = samplePoint(spec({ rng: mulberry32(seed) }));
      if (!p) continue; // a seed may exhaust its tries — that's a valid outcome
      expect(Math.abs(p.x)).toBeLessThanOrEqual(50);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(50);
      expect(p.x ** 2 + p.z ** 2).toBeGreaterThanOrEqual(20 ** 2);
      expect(p.y).toBe(0);
    }
  });

  it('is deterministic: same seed, same point', () => {
    const a = samplePoint(spec({ rng: mulberry32(7) }));
    const b = samplePoint(spec({ rng: mulberry32(7) }));
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });

  it('respects separation from existing occupants', () => {
    const others = [{ x: 30, z: 30 }];
    for (let seed = 1; seed <= 20; seed++) {
      const p = samplePoint(spec({ rng: mulberry32(seed), others, minSeparation: 25 }));
      if (!p) continue;
      expect((p.x - 30) ** 2 + (p.z - 30) ** 2).toBeGreaterThanOrEqual(25 ** 2);
    }
  });

  it('rejects non-flat footprints (step edge)', () => {
    // a 2m step at x=0; bounds hug the seam so every candidate straddles it
    const stepped = (x: number, _z: number) => (x > 0 ? 0 : 2);
    const p = samplePoint(
      spec({
        strictFloor: stepped,
        bounds: { minX: -0.3, maxX: 0.3, minZ: -100, maxZ: 100 },
        avoidRadius: 0,
        footRadius: 0.4,
      }),
    );
    expect(p).toBeNull();
  });

  it('rejects spots without headroom', () => {
    const lowCeiling: CollisionWorld = {
      floorAt: () => 0,
      sweep: () => ({ point: { x: 0, y: 1, z: 0 } as never, normal: { x: 0, y: -1, z: 0 } as never }),
    };
    const p = samplePoint(spec({ world: lowCeiling, strictFloor: null }));
    expect(p).toBeNull();
  });
});
