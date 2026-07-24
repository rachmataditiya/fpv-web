/** GLTF model infrastructure (Kenney CC0 packs in public/assets/models/).
 *
 *  Design contract: every consumer keeps its PROCEDURAL mesh as the instant
 *  visual and the loaded GLB swaps in when ready — the game must stay fully
 *  playable when assets 404 (offline dev, stripped deploys). Loading is
 *  render-side only; sim state (hit radii, physics) never depends on it. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF | null>>();

/** Load + cache a GLB. Resolves null on any failure — callers treat that as
 *  "keep the procedural fallback", never as an error. */
export function loadGltf(url: string): Promise<GLTF | null> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).catch((err) => {
      console.warn(`model ${url} unavailable — procedural fallback stays`, err);
      return null;
    });
    cache.set(url, p);
  }
  return p;
}

export interface NormalizeOpts {
  /** Scale so the largest horizontal extent equals this (meters). */
  targetSize?: number;
  /** Scale so the bbox height equals this (meters) — wins over targetSize. */
  targetHeight?: number;
  /** true → origin at the feet (min-y = 0); false → origin at bbox center. */
  originAtFeet?: boolean;
  /** Extra yaw (rad) if the source faces a different way than our −Z. */
  rotateY?: number;
}

/** Wrap an object in a normalizing parent: scaled to the requested size and
 *  re-centered per our conventions. Pure math — exported for unit tests. */
export function normalizeInto(obj: THREE.Object3D, opts: NormalizeOpts): THREE.Group {
  const wrap = new THREE.Group();
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  let s = 1;
  if (opts.targetHeight && size.y > 1e-6) s = opts.targetHeight / size.y;
  else if (opts.targetSize) {
    const horiz = Math.max(size.x, size.z);
    if (horiz > 1e-6) s = opts.targetSize / horiz;
  }
  const center = new THREE.Vector3();
  box.getCenter(center);
  // the measured box includes the object's CURRENT position — compensate, or
  // a model authored with an offset root lands off-origin after scaling
  const px = -(center.x - obj.position.x) * s;
  const py = (opts.originAtFeet ? -(box.min.y - obj.position.y) : -(center.y - obj.position.y)) * s;
  const pz = -(center.z - obj.position.z) * s;
  obj.position.set(px, py, pz);
  obj.scale.setScalar(s);
  if (opts.rotateY) wrap.rotation.y = opts.rotateY;
  wrap.add(obj);
  return wrap;
}

/** Replace `group`'s children with a normalized clone of the GLB when it
 *  arrives. For STATIC models only (plain clone). Resolves true on swap. */
export async function swapInModel(group: THREE.Group, url: string, opts: NormalizeOpts): Promise<boolean> {
  const gltf = await loadGltf(url);
  if (!gltf) return false;
  const instance = gltf.scene.clone(true);
  const wrapped = normalizeInto(instance, opts);
  group.clear();
  group.add(wrapped);
  return true;
}
