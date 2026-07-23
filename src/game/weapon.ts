/** Drone blaster — hitscan weapon fired from the nose along body-forward (−Z).
 *
 *  Deterministic: fire requests are queued by the input action edge and consumed
 *  inside the fixed physics tick. World geometry blocks shots (CollisionWorld
 *  sweep); barrels are tested as bounding spheres — nearest hit wins. */
import * as THREE from 'three';
import type { CollisionWorld } from '../physics/quad';
import { mulberry32Stateful } from './rng';
import type { StatefulRng } from './rng';

export const WEAPON_RANGE = 300;   // m
export const WEAPON_COOLDOWN = 0.11; // s — ~9 rounds/s, rifle-like
const SPREAD_PER_HEAT = 0.0045;    // rad of cone half-angle per heat unit
const HEAT_PER_SHOT = 1;
const HEAT_COOL_RATE = 5;          // units/s
const HEAT_MAX = 6;                // max ~1.5° spread under sustained fire

export interface ShotTarget {
  /** Sphere hit test: world position + radius. */
  pos: THREE.Vector3;
  radius: number;
  alive: boolean;
}

export interface ShotResult {
  from: THREE.Vector3;
  to: THREE.Vector3;              // impact point or max-range end
  targetIndex: number | null;     // which ShotTarget was hit (null = world/air)
  hitWorld: boolean;
}

const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Weapon {
  private cooldown = 0;
  private queued = false;
  /** Sustained-fire heat → spread cone (first shot is laser-accurate). */
  private heat = 0;
  private rng: StatefulRng = mulberry32Stateful(0xf1e2d3);

  /** Called from the input action edge (any thread-of-control). */
  requestFire(): void {
    this.queued = true;
  }

  /** Snapshot the sim-relevant state (cooldown/heat/rng draw position) so a
   *  replay can re-simulate shots bit-exactly from this point. */
  serialize(): { cooldown: number; heat: number; rngState: number } {
    return { cooldown: this.cooldown, heat: this.heat, rngState: this.rng.getState() };
  }

  restore(s: { cooldown: number; heat: number; rngState: number }): void {
    this.cooldown = s.cooldown;
    this.heat = s.heat;
    this.queued = false;
    this.rng.setState(s.rngState);
  }

  /** Advance cooldown; if a shot is queued and ready, resolve it.
   *  Returns the shot result or null. Call once per physics tick. */
  tick(
    dt: number,
    dronePos: THREE.Vector3,
    droneQuat: THREE.Quaternion,
    world: CollisionWorld | undefined,
    targets: readonly ShotTarget[],
  ): ShotResult | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.heat = Math.max(0, this.heat - HEAT_COOL_RATE * dt);
    if (!this.queued) return null;
    this.queued = false;
    if (this.cooldown > 0) return null;
    this.cooldown = WEAPON_COOLDOWN;

    _dir.set(0, 0, -1).applyQuaternion(droneQuat);
    // spread: deterministic random offset in the aim plane, grows with heat
    const spread = this.heat * SPREAD_PER_HEAT;
    this.heat = Math.min(HEAT_MAX, this.heat + HEAT_PER_SHOT);
    if (spread > 0) {
      _right.set(1, 0, 0).applyQuaternion(droneQuat);
      _up.set(0, 1, 0).applyQuaternion(droneQuat);
      const a = this.rng() * Math.PI * 2;
      const r = this.rng() * spread;
      _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    }
    _from.copy(dronePos).addScaledVector(_dir, 0.15); // just past the props
    _to.copy(_from).addScaledVector(_dir, WEAPON_RANGE);

    // world blocking distance
    let worldDist = Infinity;
    if (world?.sweep) {
      const hit = world.sweep(_from, _to);
      if (hit) worldDist = hit.point.distanceTo(_from);
    }

    // nearest target sphere along the ray, closer than the world hit
    let bestIdx: number | null = null;
    let bestDist = worldDist;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t.alive) continue;
      _rel.subVectors(t.pos, _from);
      const along = _rel.dot(_dir);
      if (along < 0 || along > bestDist) continue;
      const perpSq = _rel.lengthSq() - along * along;
      if (perpSq <= t.radius * t.radius) {
        bestDist = along;
        bestIdx = i;
      }
    }

    const dist = Math.min(bestDist, WEAPON_RANGE);
    return {
      from: _from.clone(),
      to: _from.clone().addScaledVector(_dir, dist),
      targetIndex: bestIdx,
      hitWorld: bestIdx === null && worldDist < WEAPON_RANGE,
    };
  }
}
