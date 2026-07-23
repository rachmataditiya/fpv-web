import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TargetRegistry } from '../targetRegistry';
import type { ShotTarget } from '../weapon';

function target(x: number): ShotTarget {
  return { pos: new THREE.Vector3(x, 0, 0), radius: 0.5, alive: true };
}

function source(n: number, hits: number[]) {
  const targets = Array.from({ length: n }, (_, i) => target(i));
  return { targets, onHit: (i: number) => hits.push(i) };
}

describe('TargetRegistry', () => {
  it('flattens sources in registration order', () => {
    const reg = new TargetRegistry();
    const a = source(2, []);
    const b = source(3, []);
    reg.register(a);
    reg.register(b);
    const flat = reg.collect();
    expect(flat.length).toBe(5);
    expect(flat[0]).toBe(a.targets[0]);
    expect(flat[1]).toBe(a.targets[1]);
    expect(flat[2]).toBe(b.targets[0]);
    expect(flat[4]).toBe(b.targets[2]);
  });

  it('routes a global hit index back to the owning source', () => {
    const reg = new TargetRegistry();
    const hitsA: number[] = [];
    const hitsB: number[] = [];
    reg.register(source(2, hitsA));
    reg.register(source(3, hitsB));
    reg.collect();
    reg.dispatchHit(1); // last of A
    reg.dispatchHit(2); // first of B
    reg.dispatchHit(4); // last of B
    expect(hitsA).toEqual([1]);
    expect(hitsB).toEqual([0, 2]);
  });

  it('tracks source arrays that grow between collects', () => {
    const reg = new TargetRegistry();
    const hitsA: number[] = [];
    const hitsB: number[] = [];
    const a = source(1, hitsA);
    const b = source(1, hitsB);
    reg.register(a);
    reg.register(b);
    expect(reg.collect().length).toBe(2);
    a.targets.push(target(9));
    expect(reg.collect().length).toBe(3);
    reg.dispatchHit(1); // new last of A
    reg.dispatchHit(2); // B shifted by one
    expect(hitsA).toEqual([1]);
    expect(hitsB).toEqual([0]);
  });

  it('is empty with no sources (pre-BSP-load state)', () => {
    const reg = new TargetRegistry();
    expect(reg.collect()).toEqual([]);
    reg.dispatchHit(0); // no source — must not throw
  });
});
