/** Difficulty scaling: pure applyDifficulty + BotManager wiring. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyDifficulty } from '../difficulty';
import { BotManager } from '../botManager';
import { TUNING } from '../types';
import type { Bot } from '../types';
import type { CollisionWorld } from '../../../physics/quad';

const flatWorld: CollisionWorld = { floorAt: () => 0 };
const BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
const AVOID = new THREE.Vector3(500, 0, 500);

describe('applyDifficulty', () => {
  it('normal is the identity scaling', () => {
    const n = applyDifficulty(TUNING.soldier, 'normal');
    expect(n.reactionS).toBeCloseTo(TUNING.soldier.reactionS);
    expect(n.aimErrBase).toBeCloseTo(TUNING.soldier.aimErrBase);
    expect(n.aimErrMin).toBeCloseTo(TUNING.soldier.aimErrMin);
    expect(n.aimErrPerMeter).toBeCloseTo(TUNING.soldier.aimErrPerMeter);
    expect(n.aimErrPerSpeed).toBeCloseTo(TUNING.soldier.aimErrPerSpeed);
    expect(n.damage).toBeCloseTo(TUNING.soldier.damage);
    // untouched fields pass through
    expect(n.hp).toBe(TUNING.soldier.hp);
    expect(n.visionRange).toBe(TUNING.soldier.visionRange);
  });

  it('easy: slower reactions, sloppier aim, weaker damage than normal', () => {
    const e = applyDifficulty(TUNING.soldier, 'easy');
    const n = applyDifficulty(TUNING.soldier, 'normal');
    expect(e.reactionS).toBeGreaterThan(n.reactionS);
    expect(e.aimErrBase).toBeGreaterThan(n.aimErrBase);
    expect(e.aimErrMin).toBeGreaterThan(n.aimErrMin);
    expect(e.damage).toBeLessThan(n.damage);
  });

  it('hard: faster reactions, tighter aim, heavier damage — easy < normal < hard', () => {
    const e = applyDifficulty(TUNING.drone, 'easy');
    const n = applyDifficulty(TUNING.drone, 'normal');
    const h = applyDifficulty(TUNING.drone, 'hard');
    expect(e.reactionS).toBeGreaterThan(n.reactionS);
    expect(n.reactionS).toBeGreaterThan(h.reactionS);
    expect(e.aimErrBase).toBeGreaterThan(n.aimErrBase);
    expect(n.aimErrBase).toBeGreaterThan(h.aimErrBase);
    expect(e.damage).toBeLessThan(n.damage);
    expect(n.damage).toBeLessThan(h.damage);
    // exact documented multipliers
    expect(h.damage).toBeCloseTo(TUNING.drone.damage * 1.3);
    expect(e.damage).toBeCloseTo(TUNING.drone.damage * 0.7);
    expect(h.reactionS).toBeCloseTo(TUNING.drone.reactionS * 0.6);
    expect(e.aimErrBase).toBeCloseTo(TUNING.drone.aimErrBase * 1.6);
  });

  it('is pure — the base TUNING blocks are never mutated', () => {
    const sBefore = { ...TUNING.soldier };
    const dBefore = { ...TUNING.drone };
    applyDifficulty(TUNING.soldier, 'hard');
    applyDifficulty(TUNING.drone, 'easy');
    expect({ ...TUNING.soldier }).toEqual(sBefore);
    expect({ ...TUNING.drone }).toEqual(dBefore);
  });

  it('BotManager snapshots difficulty into each bot at construction', () => {
    const hard = new BotManager(flatWorld, BOUNDS, AVOID, null, [], { drones: 1, soldiers: 1 }, 4242, { difficulty: 'hard' });
    const easy = new BotManager(flatWorld, BOUNDS, AVOID, null, [], { drones: 1, soldiers: 1 }, 4242, { difficulty: 'easy' });
    const hardDrone = hard.targets[0] as Bot;
    const easyDrone = easy.targets[0] as Bot;
    expect(hardDrone.tune.damage).toBeCloseTo(TUNING.drone.damage * 1.3);
    expect(easyDrone.tune.damage).toBeCloseTo(TUNING.drone.damage * 0.7);
    expect(hardDrone.tune.reactionS).toBeLessThan(easyDrone.tune.reactionS);
    // normal (default) matches base tuning
    const normal = new BotManager(flatWorld, BOUNDS, AVOID, null, [], { drones: 1, soldiers: 0 });
    expect((normal.targets[0] as Bot).tune.damage).toBeCloseTo(TUNING.drone.damage);
  });
});
