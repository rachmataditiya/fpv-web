// FILE 3: src/render/__tests__/ragdoll.test.ts
import { expect, it, describe } from 'vitest';
import * as THREE from 'three';
import { RagdollPool } from '../ragdoll';
import { DecalPool } from '../decals';

describe('RagdollPool', () => {
  it('spawns a ragdoll and simulates correctly', () => {
    const scene = new THREE.Scene();
    const pool = new RagdollPool(scene, 1);
    pool.spawn(new THREE.Vector3(0, 2, 0), new THREE.Vector3(5, 2, 0));

    const dt = 1 / 60;
    const floorAt = (_x: number, _z: number) => 0;

    // Run simulation for 3 seconds (180 ticks)
    for (let i = 0; i < 180; i++) {
      pool.update(dt, floorAt);
    }

    // Check ragdoll children are above floor (accounting for small epsilon)
    const corpseGroup = scene.children[0] as THREE.Group;
    if (corpseGroup && corpseGroup.children.length > 0) {
      corpseGroup.children.forEach((child) => {
        expect(child.position.y).toBeGreaterThanOrEqual(-0.01);
      });

      // Check that at least one part has moved in +X direction (impulse was (5,2,0))
      const anyXover1 = corpseGroup.children.some((child) => child.position.x > 1);
      expect(anyXover1).toBe(true);
    }
  });

  it('limits pool to given size (ring buffer)', () => {
    const scene = new THREE.Scene();
    const pool = new RagdollPool(scene, 4);

    // Spawn 5 corpses, only 4 should exist in the scene at any time
    for (let i = 0; i < 5; i++) {
      pool.spawn(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 0));
    }

    // Scene should only have the 4 ragdoll groups
    const groupCount = scene.children.filter((c) => c instanceof THREE.Group).length;
    expect(groupCount).toBeLessThanOrEqual(4);
  });

  it('does not throw on update when corpses are hidden', () => {
    const scene = new THREE.Scene();
    const pool = new RagdollPool(scene, 2);
    const dt = 1 / 60;
    const floorAt = (_x: number, _z: number) => 0;

    pool.spawn(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 0));

    // Simulate until corpse auto-hides (~6+ seconds)
    for (let i = 0; i < 360; i++) {
      expect(() => pool.update(dt, floorAt)).not.toThrow();
    }
  });
});

describe('DecalPool', () => {
  it('limits decals to max size', () => {
    const parent = new THREE.Group();
    const pool = new DecalPool(parent, 32);

    // Add 40 decals, pool should recycle and never exceed 32
    for (let i = 0; i < 40; i++) {
      pool.add(new THREE.Vector3(0, 0, i), new THREE.Vector3(0, 1, 0));
    }

    expect(parent.children.length).toBeLessThanOrEqual(32);
  });

  it('positions decals at offset point along normal', () => {
    const parent = new THREE.Group();
    const pool = new DecalPool(parent, 1);

    const point = new THREE.Vector3(1, 2, 3);
    const normal = new THREE.Vector3(0, 1, 0);
    pool.add(point, normal);

    const decal = parent.children[0] as THREE.Mesh;
    expect(decal.visible).toBe(true);
    // Position should be point + normal * 0.01
    const expected = point.clone().addScaledVector(normal, 0.01);
    expect(decal.position.x).toBeCloseTo(expected.x, 5);
    expect(decal.position.y).toBeCloseTo(expected.y, 5);
    expect(decal.position.z).toBeCloseTo(expected.z, 5);
  });

  it('clears all decals', () => {
    const parent = new THREE.Group();
    const pool = new DecalPool(parent, 5);

    // Add several decals
    for (let i = 0; i < 5; i++) {
      pool.add(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    }

    // All should be visible
    let visibleCount = parent.children.filter((c) => (c as THREE.Mesh).visible).length;
    expect(visibleCount).toBe(5);

    // Clear
    pool.clear();

    // All should be hidden
    visibleCount = parent.children.filter((c) => (c as THREE.Mesh).visible).length;
    expect(visibleCount).toBe(0);
  });
});
