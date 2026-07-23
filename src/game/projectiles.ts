/** Pooled slow projectiles (the heavy bot's dodgeable rocket) — sim-side only,
 *  headless-testable: no meshes, no wall clock, all randomness from the
 *  caller's seeded rng. Gravity-less straight flight; explodes on a world
 *  sweep hit, a player proximity fuse, or ttl airburst. */
import * as THREE from 'three';
import type { CollisionWorld } from '../physics/quad';

export interface Projectile {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  ttl: number; // s remaining before airburst
}

export type ProjectileEvent = { type: 'blast'; pos: THREE.Vector3 };

/** Player proximity-fuse distance (m) — close enough counts as a hit. */
const PROXIMITY_M = 1.2;

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _next = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class ProjectilePool {
  /** Preallocated slots — never grows; exhausted spawns recycle the oldest. */
  readonly list: readonly Projectile[];
  private world: CollisionWorld;
  private blastRadius: number;
  private ttlS: number;
  private events: ProjectileEvent[] = [];

  constructor(world: CollisionWorld, opts?: { size?: number; blastRadius?: number; ttlS?: number }) {
    this.world = world;
    this.blastRadius = opts?.blastRadius ?? 4;
    this.ttlS = opts?.ttlS ?? 6;
    const size = opts?.size ?? 8;
    const list: Projectile[] = [];
    for (let i = 0; i < size; i++) {
      list.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), ttl: 0 });
    }
    this.list = list;
  }

  /** Launch one rocket: `dir` perturbed in a random cone of `spreadRad`
   *  half-angle (same right/up basis as botFire's resolveBotShot), flown at
   *  `speed` m/s. Pool full → the oldest slot (lowest ttl) is recycled. */
  spawn(from: THREE.Vector3, dir: THREE.Vector3, speed: number, spreadRad: number, rng: () => number): void {
    let slot: Projectile | null = null;
    for (const p of this.list) if (!p.alive && (slot === null || p.ttl < slot.ttl)) slot = p;
    if (slot === null) {
      slot = this.list[0];
      for (const p of this.list) if (p.ttl < slot.ttl) slot = p;
    }
    _dir.copy(dir).normalize();
    if (spreadRad > 0) {
      _right.crossVectors(_dir, WORLD_UP);
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0); // aiming straight up/down
      _right.normalize();
      _up.crossVectors(_right, _dir);
      const a = rng() * Math.PI * 2;
      const r = rng() * spreadRad;
      _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    }
    slot.pos.copy(from);
    slot.vel.copy(_dir).multiplyScalar(speed);
    slot.ttl = this.ttlS;
    slot.alive = true;
  }

  /** Advance all live projectiles. The returned array is reused next tick. */
  tick(dt: number, player: { pos: THREE.Vector3; radius: number; alive: boolean }): ProjectileEvent[] {
    this.events.length = 0;
    for (const p of this.list) {
      if (!p.alive) continue;
      p.ttl -= dt;
      if (p.ttl <= 0) {
        this.explode(p, p.pos); // airburst at the current position
        continue;
      }
      _next.copy(p.pos).addScaledVector(p.vel, dt);
      const hit = this.world.sweep ? this.world.sweep(p.pos, _next) : null;
      if (hit) {
        this.explode(p, hit.point); // blast at the wall impact point
        continue;
      }
      p.pos.copy(_next);
      if (player.alive && p.pos.distanceTo(player.pos) <= PROXIMITY_M + player.radius) {
        this.explode(p, p.pos); // proximity fuse
      }
    }
    return this.events;
  }

  get radius(): number {
    return this.blastRadius;
  }

  private explode(p: Projectile, at: THREE.Vector3): void {
    p.alive = false;
    this.events.push({ type: 'blast', pos: at.clone() });
  }
}
