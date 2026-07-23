/** Bot hitscan — the inverse of the player Weapon: a probabilistic aim at one
 *  known target. Error cone tightens with continuous tracking time and widens
 *  with distance + target speed (CS-bot feel: first contact misses, sustained
 *  contact gets lethal). Pure and deterministic — all randomness from the
 *  bot's seeded rng. */
import * as THREE from 'three';
import type { CollisionWorld } from '../../physics/quad';
import { BOT_WEAPON_RANGE } from './types';

export interface FireTuning {
  aimErrBase: number;
  aimErrMin: number;
  aimTightenS: number;
  aimErrPerMeter: number;
  aimErrPerSpeed: number;
}

export interface BotShot {
  /** Impact point (world hit, target hit, or max-range end). Fresh vector. */
  to: THREE.Vector3;
  hitPlayer: boolean;
}

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _end = new THREE.Vector3();
const _rel = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Current aim-error cone half-angle for a bot that has tracked `trackTime`s. */
export function aimError(tune: FireTuning, trackTime: number, dist: number, targetSpeed: number): number {
  const t = Math.min(1, trackTime / tune.aimTightenS);
  return tune.aimErrBase - (tune.aimErrBase - tune.aimErrMin) * t
    + dist * tune.aimErrPerMeter
    + targetSpeed * tune.aimErrPerSpeed;
}

export function resolveBotShot(
  muzzle: THREE.Vector3,
  targetPos: THREE.Vector3,
  targetSpeed: number,
  targetRadius: number,
  trackTime: number,
  world: CollisionWorld,
  rng: () => number,
  tune: FireTuning,
): BotShot {
  _dir.subVectors(targetPos, muzzle);
  const dist = _dir.length();
  _dir.normalize();

  // deterministic error offset in the aim plane
  const err = aimError(tune, trackTime, dist, targetSpeed);
  _right.crossVectors(_dir, WORLD_UP);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0); // aiming straight up/down
  _right.normalize();
  _up.crossVectors(_right, _dir);
  const a = rng() * Math.PI * 2;
  const r = rng() * err;
  _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();

  _end.copy(muzzle).addScaledVector(_dir, BOT_WEAPON_RANGE);

  let worldDist = Infinity;
  if (world.sweep) {
    const hit = world.sweep(muzzle, _end);
    if (hit) worldDist = hit.point.distanceTo(muzzle);
  }

  // sphere test vs the player, must be closer than the wall
  _rel.subVectors(targetPos, muzzle);
  const along = _rel.dot(_dir);
  if (along > 0 && along <= Math.min(worldDist, BOT_WEAPON_RANGE)) {
    const perpSq = _rel.lengthSq() - along * along;
    if (perpSq <= targetRadius * targetRadius) {
      return { to: muzzle.clone().addScaledVector(_dir, along), hitPlayer: true };
    }
  }
  const end = Math.min(worldDist, BOT_WEAPON_RANGE);
  return { to: muzzle.clone().addScaledVector(_dir, end), hitPlayer: false };
}
