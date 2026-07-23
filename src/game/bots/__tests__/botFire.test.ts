import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mulberry32 } from '../../rng';
import { aimError, resolveBotShot } from '../botFire';
import { TUNING } from '../types';
import type { CollisionWorld } from '../../../physics/quad';

const S = TUNING.soldier;
const openWorld: CollisionWorld = { floorAt: () => 0 };
const muzzle = new THREE.Vector3(0, 1.4, 0);

describe('bot aim model', () => {
  it('error tightens with tracking time and widens with distance/speed', () => {
    expect(aimError(S, 0, 10, 0)).toBeGreaterThan(aimError(S, S.aimTightenS, 10, 0));
    expect(aimError(S, 1, 50, 0)).toBeGreaterThan(aimError(S, 1, 10, 0));
    expect(aimError(S, 1, 10, 20)).toBeGreaterThan(aimError(S, 1, 10, 0));
    // fully tracked, point blank ≈ the floor value
    expect(aimError(S, 99, 0, 0)).toBeCloseTo(S.aimErrMin, 5);
  });

  it('always hits a close, slow, fully-tracked target', () => {
    const rng = mulberry32(3);
    const target = new THREE.Vector3(0, 1.4, -10);
    for (let i = 0; i < 50; i++) {
      const shot = resolveBotShot(muzzle, target, 0, 0.3, 99, openWorld, rng, S);
      expect(shot.hitPlayer).toBe(true);
    }
  });

  it('tracked fire lands more hits than reaction-snap fire at range', () => {
    const target = new THREE.Vector3(0, 1.4, -50);
    const count = (trackTime: number): number => {
      const rng = mulberry32(11);
      let hits = 0;
      for (let i = 0; i < 300; i++) {
        if (resolveBotShot(muzzle, target, 0, 0.3, trackTime, openWorld, rng, S).hitPlayer) hits++;
      }
      return hits;
    };
    const tracked = count(S.aimTightenS);
    const snap = count(0);
    expect(tracked).toBeGreaterThan(snap);
    expect(snap).toBeGreaterThan(0); // still dangerous, just not laser-accurate
  });

  it('walls block the shot short of the target', () => {
    const walled: CollisionWorld = {
      floorAt: () => 0,
      // wall crossing the line of fire 5m out
      sweep: (from, to) => {
        const t = (-5 - from.z) / (to.z - from.z);
        if (t < 0 || t > 1) return null;
        return {
          point: new THREE.Vector3(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, -5),
          normal: new THREE.Vector3(0, 0, 1),
        };
      },
    };
    const target = new THREE.Vector3(0, 1.4, -10);
    const rng = mulberry32(5);
    for (let i = 0; i < 20; i++) {
      const shot = resolveBotShot(muzzle, target, 0, 0.3, 99, walled, rng, S);
      expect(shot.hitPlayer).toBe(false);
      expect(shot.to.z).toBeGreaterThanOrEqual(-5.01); // stops at the wall
    }
  });

  it('is reproducible from the seed', () => {
    const target = new THREE.Vector3(4, 3, -30);
    const run = () => {
      const rng = mulberry32(42);
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        const s = resolveBotShot(muzzle, target, 3, 0.3, 0.5, openWorld, rng, S);
        out.push(s.to.x, s.to.y, s.to.z, s.hitPlayer ? 1 : 0);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
