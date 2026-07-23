/** B1.8 hardening: long-soak cross-run determinism. Two identically-seeded
 *  BotManagers fed an identical scripted player must agree bit-exactly after
 *  10 000 ticks (~42s of sim) — through patrols, engagements, deaths from
 *  blasts, respawns, heavy rockets, and scout marks. Any hidden wall-clock or
 *  unseeded randomness in the bot stack shows up here as a diff. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BotManager } from '../botManager';
import { BARREL_BLAST_BOT_DAMAGE, BARREL_BLAST_RADIUS } from '../../barrels';
import type { CollisionWorld } from '../../../physics/quad';

const DT = 1 / 240;
const BOUNDS = { minX: -80, maxX: 80, minZ: -80, maxZ: 80 };
const AVOID = new THREE.Vector3(200, 0, 200);

/** Flat floor with one wall across z = -20 — exercises LOS breaks, wall
 *  steering, and projectile impacts, not just open-field math. */
const world: CollisionWorld = {
  floorAt: () => 0,
  sweep: (from, to) => {
    const t = (-20 - from.z) / (to.z - from.z);
    if (!isFinite(t) || t < 0 || t > 1) return null;
    return {
      point: new THREE.Vector3(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, -20),
      normal: new THREE.Vector3(0, 0, 1),
    };
  },
};

function makeManager(): BotManager {
  return new BotManager(world, BOUNDS, AVOID, null, [], undefined, 4242, { difficulty: 'normal' });
}

/** Scripted player: laps an oval through the bots' patrol space, "fires"
 *  every second, dips low past the wall line — pure function of the tick. */
function playerAt(tick: number, pos: THREE.Vector3, vel: THREE.Vector3): { noise: boolean } {
  const t = tick * DT;
  const a = t * 0.35;
  pos.set(Math.cos(a) * 35, 3 + Math.sin(t * 0.9) * 2, Math.sin(a) * 45 - 5);
  vel.set(-Math.sin(a) * 35 * 0.35, Math.cos(t * 0.9) * 1.8, Math.cos(a) * 45 * 0.35);
  return { noise: tick % 240 === 0 };
}

describe('bot stack long-soak determinism', () => {
  it('two runs, 10k ticks, identical serialized state throughout', () => {
    const a = makeManager();
    const b = makeManager();
    const posA = new THREE.Vector3();
    const velA = new THREE.Vector3();
    const posB = new THREE.Vector3();
    const velB = new THREE.Vector3();

    for (let tick = 0; tick < 10_000; tick++) {
      const nA = playerAt(tick, posA, velA);
      const nB = playerAt(tick, posB, velB);
      const evA = a.tick(DT, { playerPos: posA, playerVel: velA, playerAlive: true, playerNoise: nA.noise });
      const evB = b.tick(DT, { playerPos: posB, playerVel: velB, playerAlive: true, playerNoise: nB.noise });
      expect(evA.length).toBe(evB.length);
      // a synthetic barrel blast at a fixed spot partway in — area damage,
      // deaths, and respawns must replicate too
      if (tick === 4000) {
        const at = new THREE.Vector3(20, 1, 10);
        const dA = a.blast(at, BARREL_BLAST_RADIUS, BARREL_BLAST_BOT_DAMAGE);
        const dB = b.blast(at, BARREL_BLAST_RADIUS, BARREL_BLAST_BOT_DAMAGE);
        expect(dA.length).toBe(dB.length);
      }
      if (tick % 2000 === 1999) {
        expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
      }
    }
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
    expect(a.kills).toBe(b.kills);
  }, 30_000);

  it('tick() reuses its events array (no per-tick allocation)', () => {
    const m = makeManager();
    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    playerAt(0, pos, vel);
    const first = m.tick(DT, { playerPos: pos, playerVel: vel, playerAlive: true, playerNoise: false });
    const second = m.tick(DT, { playerPos: pos, playerVel: vel, playerAlive: true, playerNoise: false });
    expect(second).toBe(first); // same array instance, recycled
  });

  it('barrel blast kills a soldier standing next to it', () => {
    const m = makeManager();
    const soldier = m.targets.find((t, i) => i >= 0 && (t as { kind?: string }).kind === 'soldier' && (t as { botClass?: string }).botClass !== 'heavy' && t.alive);
    expect(soldier).toBeDefined();
    const died = m.blast(soldier!.pos, BARREL_BLAST_RADIUS, BARREL_BLAST_BOT_DAMAGE);
    expect(died.length).toBeGreaterThan(0);
    expect(soldier!.alive).toBe(false);
    expect(m.kills).toBeGreaterThan(0);
  });

  it('the heavy survives a barrel blast', () => {
    const m = makeManager();
    const heavy = m.targets.find((t) => (t as { botClass?: string }).botClass === 'heavy');
    expect(heavy).toBeDefined();
    m.blast(heavy!.pos, BARREL_BLAST_RADIUS, BARREL_BLAST_BOT_DAMAGE);
    expect(heavy!.alive).toBe(true); // 50hp - 34 = tanky by design
  });
});
