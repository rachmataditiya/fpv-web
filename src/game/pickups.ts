/** Weapon pickups for BSP maps — floating icons that swap the player's
 *  arsenal config on contact. Deterministic seeded placement on real floors
 *  (CollisionWorld.floorAt), mirroring BarrelField; timed respawn in place
 *  (same weapon). Sim-side only — meshes are the caller's job (main.ts). */
import * as THREE from 'three';
import type { CollisionWorld } from '../physics/quad';
import type { WeaponId } from './weapon';
import { mulberry32 } from './rng';

const _sweepA = new THREE.Vector3();
const _sweepB = new THREE.Vector3();

const RESPAWN_S = 20;
const COUNT = 6;
/** Player contact radius (m). */
export const PICKUP_RADIUS = 1.5;
/** Hover height above the floor (m). */
export const PICKUP_HOVER = 1.2;
/** Round-robin assignment order (seeded-shuffled per field). */
const WEAPON_ORDER: readonly WeaponId[] = ['burst', 'railgun', 'blaster'];

export interface Pickup {
  weapon: WeaponId;
  pos: THREE.Vector3;
  alive: boolean;
  respawnIn: number; // s, counts down while collected
}

export interface PickupEvent {
  type: 'pickup';
  weapon: WeaponId;
  index: number;
}

export class PickupField {
  readonly pickups: Pickup[] = [];
  private rng: () => number;
  private world: CollisionWorld;
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private avoid: THREE.Vector3;
  private strictFloor: ((x: number, z: number) => number | null) | null;
  private readonly events: PickupEvent[] = [];
  /** place() succeeded per slot — failed slots keep retrying instead of
   *  respawning in place (they have no spot yet). */
  private readonly placed: boolean[] = [];

  /** bounds = horizontal extent of the BSP geometry; avoid = spawn point.
   *  strictFloor: geometry-only sampler (no base-ground fallback) so pickups
   *  never spawn outside the map footprint. */
  constructor(
    world: CollisionWorld,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    avoid: THREE.Vector3,
    seed: number,
    strictFloor: ((x: number, z: number) => number | null) | null = null,
    count = COUNT,
  ) {
    this.world = world;
    this.strictFloor = strictFloor;
    this.bounds = bounds;
    this.avoid = avoid.clone();
    this.rng = mulberry32(seed);

    // seeded shuffle of the assignment order, then round-robin
    const order = [...WEAPON_ORDER];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }

    for (let i = 0; i < count; i++) {
      const p: Pickup = {
        weapon: order[i % order.length],
        pos: new THREE.Vector3(),
        alive: false,
        respawnIn: 0,
      };
      this.placed[i] = this.place(p);
      this.pickups.push(p);
    }
  }

  /** Find a floor spot for the pickup; false (stays dead, retries soon) when
   *  no valid spot came up this try. */
  private place(p: Pickup): boolean {
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
      const r = 0.4;
      let flat = true;
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const fy = floor(x + dx, z + dz);
        if (fy === null || Math.abs(fy - y) > 0.3) { flat = false; break; }
      }
      if (!flat) continue;
      // headroom: nothing between the floor and the hovering icon + margin
      if (this.world.sweep) {
        _sweepA.set(x, y + 0.05, z);
        _sweepB.set(x, y + PICKUP_HOVER + 0.6, z);
        if (this.world.sweep(_sweepA, _sweepB)) continue; // ceiling too low / inside solid
      }
      p.pos.set(x, y + PICKUP_HOVER, z);
      p.alive = true;
      return true;
    }
    p.alive = false;
    p.respawnIn = 2; // retry soon
    return false;
  }

  /** Contact checks + respawn timers. Call once per physics tick.
   *  Returns the reused events array — copy if you need to keep it. */
  tick(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): PickupEvent[] {
    const evs = this.events;
    evs.length = 0;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (p.alive) {
        if (playerAlive && p.pos.distanceTo(playerPos) <= PICKUP_RADIUS) {
          p.alive = false;
          p.respawnIn = RESPAWN_S;
          evs.push({ type: 'pickup', weapon: p.weapon, index: i });
        }
      } else {
        p.respawnIn -= dt;
        if (p.respawnIn <= 0) {
          p.respawnIn = 0;
          if (this.placed[i]) {
            p.alive = true; // respawn in place (same weapon, same spot)
          } else {
            this.placed[i] = this.place(p); // never placed — keep trying
          }
        }
      }
    }
    return evs;
  }
}
