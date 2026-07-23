/** Explosive barrels for BSP maps — the shootable objects. Deterministic seeded
 *  placement on real floors (CollisionWorld.floorAt), 1-hit explosions, timed
 *  respawn at a fresh spot. Mesh comes from render/barrelMesh.ts; effects and
 *  scoring are the caller's job (events returned from hit()/tick()). */
import * as THREE from 'three';
import { createBarrelMesh, BARREL_RADIUS, BARREL_HEIGHT } from '../render/barrelMesh';
import type { CollisionWorld } from '../physics/quad';
import type { ShotTarget } from './weapon';
import { mulberry32 } from './rng';

const _sweepA = new THREE.Vector3();
const _sweepB = new THREE.Vector3();

const RESPAWN_S = 10;
const COUNT = 16;
/** Blast radius that crashes a too-close drone. */
export const BARREL_BLAST_RADIUS = 5;

interface Barrel extends ShotTarget {
  mesh: THREE.Group;
  respawnIn: number; // s, counts down while dead
}

export class BarrelField {
  readonly group = new THREE.Group();
  private barrels: Barrel[] = [];
  private rng: () => number;
  private world: CollisionWorld;
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private avoid: THREE.Vector3;
  score = 0;

  private strictFloor: ((x: number, z: number) => number | null) | null;

  /** bounds = horizontal extent of the BSP geometry; avoid = spawn point.
   *  strictFloor: geometry-only sampler (no base-ground fallback) so barrels
   *  never spawn outside the map footprint. */
  constructor(
    world: CollisionWorld,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    avoid: THREE.Vector3,
    seed = 1337,
    strictFloor: ((x: number, z: number) => number | null) | null = null,
  ) {
    this.world = world;
    this.strictFloor = strictFloor;
    this.bounds = bounds;
    this.avoid = avoid.clone();
    this.rng = mulberry32(seed);
    this.group.name = 'barrels';
    for (let i = 0; i < COUNT; i++) {
      const b: Barrel = {
        pos: new THREE.Vector3(),
        radius: Math.max(BARREL_RADIUS, BARREL_HEIGHT / 2),
        alive: false,
        mesh: createBarrelMesh(),
        respawnIn: 0,
      };
      b.mesh.visible = false;
      this.group.add(b.mesh);
      this.barrels.push(b);
      this.place(b);
    }
  }

  /** Find a floor spot for the barrel; keep it dead if none found this try. */
  private place(b: Barrel): void {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const floor = (x: number, z: number) =>
      this.strictFloor ? this.strictFloor(x, z) : this.world.floorAt(x, 200, z);
    for (let tries = 0; tries < 24; tries++) {
      const x = minX + this.rng() * (maxX - minX);
      const z = minZ + this.rng() * (maxZ - minZ);
      const y = floor(x, z);
      if (y === null) continue; // outside the map footprint
      if ((x - this.avoid.x) ** 2 + (z - this.avoid.z) ** 2 < 8 ** 2) continue; // clear of spawn
      // FLAT footprint: the floor under all four rim points must match the
      // center — rejects wall tops, stair edges, and slopes.
      const r = BARREL_RADIUS;
      let flat = true;
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const fy = floor(x + dx, z + dz);
        if (fy === null || Math.abs(fy - y) > 0.3) { flat = false; break; }
      }
      if (!flat) continue;
      // headroom: nothing between the barrel base and its top + margin
      if (this.world.sweep) {
        _sweepA.set(x, y + 0.05, z);
        _sweepB.set(x, y + BARREL_HEIGHT + 0.4, z);
        if (this.world.sweep(_sweepA, _sweepB)) continue; // ceiling too low / inside solid
      }
      b.pos.set(x, y + BARREL_HEIGHT / 2, z); // sphere center at mid-height
      b.mesh.position.set(x, y, z);
      b.mesh.rotation.y = this.rng() * Math.PI * 2;
      b.mesh.visible = true;
      b.alive = true;
      return;
    }
    b.alive = false;
    b.mesh.visible = false;
    b.respawnIn = 2; // retry soon
  }

  get targets(): readonly ShotTarget[] {
    return this.barrels;
  }

  aliveCount(): number {
    return this.barrels.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
  }

  /** Explode barrel i. Returns its position (for FX) — caller checks drone blast range. */
  explode(i: number): THREE.Vector3 {
    const b = this.barrels[i];
    b.alive = false;
    b.mesh.visible = false;
    b.respawnIn = RESPAWN_S;
    this.score++;
    return b.pos;
  }

  /** Chain reaction: explode every unexploded barrel within `radius` of `pos`
   *  (heavy rocket blasts). Returns the boom positions, live-first order. */
  blastNear(pos: THREE.Vector3, radius: number): THREE.Vector3[] {
    const booms: THREE.Vector3[] = [];
    for (let i = 0; i < this.barrels.length; i++) {
      const b = this.barrels[i];
      if (!b.alive || b.pos.distanceTo(pos) > radius) continue;
      booms.push(this.explode(i));
    }
    return booms;
  }

  /** Respawn timers. Call once per physics tick. */
  tick(dt: number): void {
    for (const b of this.barrels) {
      if (b.alive) continue;
      b.respawnIn -= dt;
      if (b.respawnIn <= 0) this.place(b);
    }
  }
}
