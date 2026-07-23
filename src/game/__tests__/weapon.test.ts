import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Weapon, WEAPON_COOLDOWN } from '../weapon';
import type { ShotTarget } from '../weapon';

const DT = 1 / 240;
const pos = new THREE.Vector3(0, 2, 0);
const facingMinusZ = new THREE.Quaternion(); // identity: forward = −Z

function target(x: number, y: number, z: number, r = 0.5, alive = true): ShotTarget {
  return { pos: new THREE.Vector3(x, y, z), radius: r, alive };
}

describe('Weapon', () => {
  it('fires only when requested and respects the cooldown', () => {
    const w = new Weapon();
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull(); // nothing queued
    w.requestFire();
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).not.toBeNull();
    w.requestFire();
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).toBeNull(); // cooling down
    // advance past the cooldown
    for (let t = 0; t < WEAPON_COOLDOWN; t += DT) w.tick(DT, pos, facingMinusZ, undefined, []);
    w.requestFire();
    expect(w.tick(DT, pos, facingMinusZ, undefined, [])).not.toBeNull();
  });

  it('hits the nearest target sphere along the forward ray', () => {
    const w = new Weapon();
    const targets = [target(0, 2, -50), target(0, 2, -20), target(0, 2, -35)];
    w.requestFire();
    const shot = w.tick(DT, pos, facingMinusZ, undefined, targets)!;
    expect(shot.targetIndex).toBe(1); // z=-20 is nearest
    expect(shot.to.z).toBeCloseTo(-20, 0);
  });

  it('misses lateral and behind targets, ignores dead ones', () => {
    const w = new Weapon();
    const targets = [target(5, 2, -20), target(0, 2, 20), target(0, 2, -20, 0.5, false)];
    w.requestFire();
    const shot = w.tick(DT, pos, facingMinusZ, undefined, targets)!;
    expect(shot.targetIndex).toBeNull();
  });

  it('world geometry blocks shots at targets behind walls', () => {
    const w = new Weapon();
    const wallWorld = {
      floorAt: () => 0,
      sweep: (from: THREE.Vector3, to: THREE.Vector3) => {
        // wall plane at z = -10 between from and to
        if (from.z > -10 && to.z < -10) {
          return { point: new THREE.Vector3(from.x, from.y, -10), normal: new THREE.Vector3(0, 0, 1) };
        }
        return null;
      },
    };
    const targets = [target(0, 2, -20)];
    w.requestFire();
    const shot = w.tick(DT, pos, facingMinusZ, wallWorld, targets)!;
    expect(shot.targetIndex).toBeNull();
    expect(shot.hitWorld).toBe(true);
    expect(shot.to.z).toBeCloseTo(-10, 0);
  });
});
