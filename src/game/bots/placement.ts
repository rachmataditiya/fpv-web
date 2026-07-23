/** Deterministic ground-point sampling for bot spawns/waypoints — the same
 *  recipe as BarrelField.place(): random point in the map bounds, must sit on
 *  real geometry (strictFloor), on a FLAT footprint, with headroom, clear of
 *  the player spawn and of other bots. Pure: all randomness from the caller's
 *  seeded rng, world access through CollisionWorld only. */
import * as THREE from 'three';
import type { CollisionWorld } from '../../physics/quad';

const _sweepA = new THREE.Vector3();
const _sweepB = new THREE.Vector3();

export interface PlacementSpec {
  world: CollisionWorld;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Geometry-only floor sampler (null = fall back to world.floorAt). */
  strictFloor: ((x: number, z: number) => number | null) | null;
  avoid: { x: number; z: number };
  avoidRadius: number;
  /** Existing occupants to keep minSeparation away from (x/z used). */
  others: readonly { x: number; z: number }[];
  minSeparation: number;
  /** Flatness rim-tap radius (entity footprint). */
  footRadius: number;
  /** Required clear height above the floor. */
  clearance: number;
  rng: () => number;
}

export interface PlacedPoint {
  x: number;
  /** Floor height at (x, z). */
  y: number;
  z: number;
}

export function samplePoint(spec: PlacementSpec, tries = 24): PlacedPoint | null {
  const { world, bounds, strictFloor, avoid, avoidRadius, others, minSeparation, footRadius, clearance, rng } = spec;
  const floor = (x: number, z: number) =>
    strictFloor ? strictFloor(x, z) : world.floorAt(x, 200, z);
  for (let t = 0; t < tries; t++) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + rng() * (bounds.maxZ - bounds.minZ);
    const y = floor(x, z);
    if (y === null) continue; // outside the map footprint
    if ((x - avoid.x) ** 2 + (z - avoid.z) ** 2 < avoidRadius * avoidRadius) continue;
    let crowded = false;
    for (const o of others) {
      if ((x - o.x) ** 2 + (z - o.z) ** 2 < minSeparation * minSeparation) { crowded = true; break; }
    }
    if (crowded) continue;
    // FLAT footprint — same rim-tap trick as barrels: rejects wall tops,
    // stair edges, and slopes.
    let flat = true;
    for (const [dx, dz] of [[footRadius, 0], [-footRadius, 0], [0, footRadius], [0, -footRadius]]) {
      const fy = floor(x + dx, z + dz);
      if (fy === null || Math.abs(fy - y) > 0.3) { flat = false; break; }
    }
    if (!flat) continue;
    if (world.sweep) {
      _sweepA.set(x, y + 0.05, z);
      _sweepB.set(x, y + clearance, z);
      if (world.sweep(_sweepA, _sweepB)) continue; // ceiling too low / inside solid
    }
    return { x, y, z };
  }
  return null;
}
