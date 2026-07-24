import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadGltf, normalizeInto } from '../modelLoader';

describe('modelLoader', () => {
  it('caches by url and resolves null on failure (fallback contract)', async () => {
    const a = loadGltf('file:///definitely-missing.glb');
    const b = loadGltf('file:///definitely-missing.glb');
    expect(b).toBe(a); // same promise instance — one request per url
    expect(await a).toBeNull(); // failure = null, never a throw
  });

  it('normalizeInto scales to target height with feet at y=0', () => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1));
    box.position.y = 5; // arbitrary offset — must be neutralized
    const wrap = normalizeInto(box, { targetHeight: 1.8, originAtFeet: true });
    const bb = new THREE.Box3().setFromObject(wrap);
    expect(bb.max.y - bb.min.y).toBeCloseTo(1.8, 4);
    expect(bb.min.y).toBeCloseTo(0, 4);
    expect((bb.min.x + bb.max.x) / 2).toBeCloseTo(0, 4);
  });

  it('normalizeInto scales to target horizontal size centered at origin', () => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 8));
    const wrap = normalizeInto(b, { targetSize: 0.37 });
    const bb = new THREE.Box3().setFromObject(wrap);
    expect(Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)).toBeCloseTo(0.37, 4);
    expect((bb.min.y + bb.max.y) / 2).toBeCloseTo(0, 4);
  });
});
