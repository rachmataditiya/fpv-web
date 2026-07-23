/** Bot senses — pure helpers over CollisionWorld.
 *  canSee = range gate → horizontal FOV gate → world.sweep occlusion (the same
 *  segment test the player weapon uses for wall blocking). On terrain maps
 *  sweep is absent, but bots only exist on BSP maps so occlusion is real. */
import * as THREE from 'three';
import type { CollisionWorld } from '../../physics/quad';

const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();

export function canSee(
  eye: THREE.Vector3,
  yaw: number,
  target: THREE.Vector3,
  range: number,
  fovRad: number,
  world: CollisionWorld,
): boolean {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq > range * range) return false;
  // horizontal FOV about facing (-sin yaw, -cos yaw); 360° vision skips the gate
  if (fovRad < Math.PI * 2) {
    const horiz = Math.hypot(dx, dz);
    if (horiz > 1e-6) {
      const dot = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / horiz;
      if (dot < Math.cos(fovRad / 2)) return false;
    }
  }
  if (world.sweep) {
    _eye.copy(eye);
    _target.copy(target);
    if (world.sweep(_eye, _target)) return false; // wall in between
  }
  return true;
}

export function hearsNoise(pos: THREE.Vector3, noiseAt: THREE.Vector3, range: number): boolean {
  return pos.distanceToSquared(noiseAt) <= range * range;
}
