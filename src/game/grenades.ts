/** Drone-dropped grenades — the second weapon system: released from the quad,
 *  they inherit its velocity, fall ballistically, and detonate on world
 *  contact or a 2.5s fuse. Blast consequences (bots, barrels, the player) are
 *  the caller's job via the returned events, mirroring barrels/projectiles.
 *  Sim-side deterministic: stepped in the fixed tick, no randomness at all. */
import * as THREE from 'three';
import type { CollisionWorld } from '../physics/quad';

export interface GrenadeBlast {
  type: 'grenade-blast';
  pos: THREE.Vector3;
}

const GRAVITY = -9.81;
const FUSE_S = 2.5;
const COOLDOWN_S = 3;
export const GRENADE_BLAST_RADIUS = 6;
/** Bots inside the blast take this (kills any soldier but the heavy). */
export const GRENADE_BOT_DAMAGE = 40;
/** The pilot is not exempt — drop and LEAVE. */
export const GRENADE_PLAYER_DAMAGE = 40;

interface Slot {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  ttl: number;
  mesh: THREE.Mesh;
}

const _next = new THREE.Vector3();

export class GrenadePool {
  readonly group = new THREE.Group();
  /** Seconds until the next drop is allowed. */
  cooldown = 0;
  private slots: Slot[] = [];
  private events: GrenadeBlast[] = [];

  constructor(size = 4) {
    this.group.name = 'grenades';
    const geo = new THREE.SphereGeometry(0.09, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1d211d, roughness: 0.5, metalness: 0.4 });
    for (let i = 0; i < size; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.slots.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), ttl: 0, mesh });
    }
  }

  get ready(): boolean {
    return this.cooldown <= 0;
  }

  /** Release below the quad, inheriting its velocity. False while cooling down
   *  (a full pool also refuses — no recycling live explosives). */
  drop(quadPos: THREE.Vector3, quadVel: THREE.Vector3): boolean {
    if (this.cooldown > 0) return false;
    const slot = this.slots.find((s) => !s.alive);
    if (!slot) return false;
    slot.pos.copy(quadPos);
    slot.pos.y -= 0.25; // clear of the props
    slot.vel.copy(quadVel);
    slot.ttl = FUSE_S;
    slot.alive = true;
    slot.mesh.visible = true;
    slot.mesh.position.copy(slot.pos);
    this.cooldown = COOLDOWN_S;
    return true;
  }

  /** Advance cooldown + all live grenades. Returned array is reused per tick. */
  tick(dt: number, world: CollisionWorld | undefined): readonly GrenadeBlast[] {
    this.events.length = 0;
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const s of this.slots) {
      if (!s.alive) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        this.explode(s, s.pos);
        continue;
      }
      s.vel.y += GRAVITY * dt;
      _next.copy(s.pos).addScaledVector(s.vel, dt);
      const hit = world?.sweep ? world.sweep(s.pos, _next) : null;
      if (hit) {
        this.explode(s, hit.point);
        continue;
      }
      // no sweep on this map (terrain) — floor test keeps it honest
      if (world && !world.sweep) {
        const floor = world.floorAt(_next.x, _next.y, _next.z);
        if (floor !== null && _next.y <= floor + 0.05) {
          _next.y = floor + 0.05;
          this.explode(s, _next);
          continue;
        }
      }
      s.pos.copy(_next);
      s.mesh.position.copy(s.pos);
    }
    return this.events;
  }

  private explode(s: Slot, at: THREE.Vector3): void {
    s.alive = false;
    s.mesh.visible = false;
    this.events.push({ type: 'grenade-blast', pos: at.clone() });
  }
}
