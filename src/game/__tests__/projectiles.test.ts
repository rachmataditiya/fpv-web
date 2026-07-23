/** ProjectilePool: straight flight, deterministic spread cone, the three
 *  detonation fuses (world sweep / player proximity / ttl), and pool reuse. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ProjectilePool } from '../projectiles';
import { mulberry32Stateful } from '../rng';
import type { CollisionWorld } from '../../physics/quad';

const DT = 1 / 240;
const openWorld: CollisionWorld = { floorAt: () => 0 };
/** Wall across x = 5 blocking any segment that crosses it. */
const walledWorld: CollisionWorld = {
  floorAt: () => 0,
  sweep: (from, to) => {
    const t = (5 - from.x) / (to.x - from.x);
    if (!isFinite(t) || t < 0 || t > 1) return null;
    return {
      point: new THREE.Vector3(5, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t),
      normal: new THREE.Vector3(-1, 0, 0),
    };
  },
};

/** A player parked far away — no proximity fuse, ever. */
const farPlayer = { pos: new THREE.Vector3(1000, 0, 1000), radius: 0.3, alive: true };

function tickN(pool: ProjectilePool, seconds: number, player = farPlayer) {
  const all = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) all.push(...pool.tick(DT, player));
  return all;
}

describe('ProjectilePool', () => {
  it('flies straight at the spawn speed with zero spread', () => {
    const pool = new ProjectilePool(openWorld);
    pool.spawn(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 0), 12, 0, mulberry32Stateful(1));
    const events = tickN(pool, 0.5);
    expect(events.length).toBe(0); // nothing detonated it
    const p = pool.list[0];
    expect(p.alive).toBe(true);
    expect(p.pos.x).toBeCloseTo(12 * 0.5, 3);
    expect(p.pos.y).toBeCloseTo(2, 9); // gravity-less
    expect(p.pos.z).toBeCloseTo(0, 9);
    expect(p.vel.length()).toBeCloseTo(12, 9);
  });

  it('spread is seeded-deterministic: same seed → identical velocity', () => {
    const a = new ProjectilePool(openWorld);
    const b = new ProjectilePool(openWorld);
    const from = new THREE.Vector3(0, 2, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    a.spawn(from, dir, 12, 0.05, mulberry32Stateful(99));
    b.spawn(from, dir, 12, 0.05, mulberry32Stateful(99));
    expect(a.list[0].vel.toArray()).toEqual(b.list[0].vel.toArray());
    // and the cone actually bent the shot away from the raw direction
    expect(a.list[0].vel.z).toBeLessThan(0);
    expect(Math.abs(a.list[0].vel.x) + Math.abs(a.list[0].vel.y)).toBeGreaterThan(0);
  });

  it('detonates on a world sweep hit — blast at the impact point', () => {
    const pool = new ProjectilePool(walledWorld);
    pool.spawn(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 0), 12, 0, mulberry32Stateful(1));
    const events = tickN(pool, 1);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('blast');
    expect(events[0].pos.x).toBeCloseTo(5, 6); // the wall plane, not past it
    expect(pool.list[0].alive).toBe(false);
  });

  it('proximity-fuses on the player (and not on a dead player)', () => {
    const pool = new ProjectilePool(openWorld);
    pool.spawn(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 12, 0, mulberry32Stateful(1));
    const player = { pos: new THREE.Vector3(3, 0, 0), radius: 0.3, alive: true };
    const events = tickN(pool, 0.5, player);
    expect(events.length).toBe(1);
    expect(events[0].pos.x).toBeLessThanOrEqual(3);
    expect(events[0].pos.x).toBeGreaterThan(0);

    const dead = new ProjectilePool(openWorld);
    dead.spawn(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 12, 0, mulberry32Stateful(1));
    const none = tickN(dead, 0.5, { ...player, alive: false });
    expect(none.length).toBe(0); // flew straight through the corpse
  });

  it('airbursts at its current position when the ttl expires', () => {
    const pool = new ProjectilePool(openWorld, { ttlS: 0.2 });
    pool.spawn(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), 12, 0, mulberry32Stateful(1));
    const events = tickN(pool, 0.5);
    expect(events.length).toBe(1);
    expect(events[0].pos.x).toBeGreaterThan(2.2); // died of old age, mid-air
    expect(events[0].pos.x).toBeLessThan(2.6);   // ≈ 12 m/s × 0.2 s
  });

  it('recycles the oldest slot when the pool is exhausted', () => {
    const pool = new ProjectilePool(openWorld, { size: 2 });
    const rng = mulberry32Stateful(5);
    const from = new THREE.Vector3(0, 0, 0);
    const dir = new THREE.Vector3(1, 0, 0);
    pool.spawn(from, dir, 12, 0, rng); // slot 0
    tickN(pool, 0.2);                  // slot 0: flown 2.4m, ttl now lowest
    pool.spawn(from, dir, 12, 0, rng); // slot 1 (free)
    tickN(pool, 0.1);                  // slot 0: 3.6m; slot 1: 1.2m
    pool.spawn(from, dir, 12, 0, rng); // pool full → recycles slot 0 (oldest)
    expect(pool.list.length).toBe(2);
    expect(pool.list.every((p) => p.alive)).toBe(true);
    expect(pool.list[0].pos.x).toBeCloseTo(0, 6);    // recycled: back at the muzzle
    expect(pool.list[1].pos.x).toBeCloseTo(1.2, 3);  // untouched: kept flying
    const events = tickN(pool, 0.05);
    expect(events.length).toBe(0);
    expect(pool.list[0].pos.x).toBeGreaterThan(0.5);
  });
});
