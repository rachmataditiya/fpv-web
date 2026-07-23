/** Turns a ParsedBsp into renderable meshes + a collision world.
 *
 *  Rendering: one mesh per texture group (typically 30–120 draw calls for a CS
 *  map — fine). Missing textures get a deterministic name-hashed fallback so
 *  the map is readable even without its WADs.
 *
 *  Collision: one merged BVH (three-mesh-bvh) over all visible geometry.
 *  The physics step uses floorAt() (downward ray) + sweep() (segment cast along
 *  the frame's motion) — see physics/quad.ts CollisionWorld. */
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import type { ParsedBsp } from '../world/bsp/bspParser';
import type { CollisionWorld } from '../physics/quad';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface BspWorld {
  group: THREE.Group;
  collision: CollisionWorld;
}

/** Fallback for textures whose WAD wasn't supplied: quiet warm plaster with a
 *  touch of per-name tint + fine noise — reads as "untextured wall", not as a
 *  broken checkerboard. Deterministic per name. */
function fallbackTexture(name: string): THREE.DataTexture {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const hue = 0.09 + (((h >>> 8) % 100) / 100) * 0.06;   // sand → clay band
  const light = 0.5 + (((h >>> 16) % 40) - 20) / 200;    // ±0.1 around mid
  const base = new THREE.Color().setHSL(hue, 0.22, light);
  let seed = h >>> 0;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const S = 32;
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const n = 1 + (rnd() - 0.5) * 0.12; // fine grain
    const o = i * 4;
    data[o] = Math.min(255, base.r * 255 * n);
    data[o + 1] = Math.min(255, base.g * 255 * n);
    data[o + 2] = Math.min(255, base.b * 255 * n);
    data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildBspWorld(bsp: ParsedBsp): BspWorld {
  const group = new THREE.Group();
  group.name = 'bspWorld';

  const collisionGeoms: THREE.BufferGeometry[] = [];

  for (const g of bsp.groups) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
    geom.computeVertexNormals();

    const texInfo = bsp.textures.get(g.textureName);
    let map: THREE.Texture;
    let transparent = false;
    if (texInfo?.rgba) {
      const tex = new THREE.DataTexture(new Uint8Array(texInfo.rgba), texInfo.width, texInfo.height);
      tex.needsUpdate = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.NearestFilter; // keep the retro texel look up close
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      map = tex;
      transparent = g.textureName.startsWith('{');
    } else {
      map = fallbackTexture(g.textureName);
    }

    const mat = new THREE.MeshStandardMaterial({
      map,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.45,
      side: THREE.DoubleSide, // BSP winding varies per model; double-side is safe
      transparent,
      alphaTest: transparent ? 0.5 : 0,
    });
    const mesh = new THREE.Mesh(geom, mat);
    group.add(mesh);
    collisionGeoms.push(geom);
  }

  // --- merged collision BVH ---
  let totalVerts = 0;
  for (const g of bsp.groups) totalVerts += g.positions.length;
  const merged = new Float32Array(totalVerts);
  let o = 0;
  for (const g of bsp.groups) {
    merged.set(g.positions, o);
    o += g.positions.length;
  }
  const collGeom = new THREE.BufferGeometry();
  collGeom.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  (collGeom as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(collGeom);
  // DoubleSide is required: GoldSrc winding is inconsistent after conversion,
  // and a FrontSide raycast would skip floors whose normals point down.
  const collMesh = new THREE.Mesh(collGeom, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  collMesh.visible = false;

  const ray = new THREE.Raycaster();
  (ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  const _down = new THREE.Vector3(0, -1, 0);
  const _origin = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  // The map SITS ON solid ground: an oversized plane level with the map's
  // lowest floor. There is no space beneath the map — floorAt falls back to
  // this base height everywhere, so the drone can never get under it. Upward
  // is unlimited (no ceiling).
  let baseY = 0;
  {
    let minY = Infinity;
    let maxR = 0;
    for (let i = 0; i < merged.length; i += 3) {
      if (merged[i + 1] < minY) minY = merged[i + 1];
      const r = Math.max(Math.abs(merged[i]), Math.abs(merged[i + 2]));
      if (r > maxR) maxR = r;
    }
    if (Number.isFinite(minY)) {
      baseY = minY;
      const base = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(800, maxR * 6), Math.max(800, maxR * 6)),
        new THREE.MeshStandardMaterial({ color: 0x8a7a5f, roughness: 1, metalness: 0, envMapIntensity: 0.3 }),
      );
      base.rotation.x = -Math.PI / 2;
      base.position.y = minY - 0.02; // hair below the map's lowest floors (no z-fight)
      group.add(base);
    }
  }

  const collision: CollisionWorld = {
    floorAt(x, y, z) {
      _origin.set(x, y + 0.05, z);
      ray.set(_origin, _down);
      ray.far = 2000;
      const hit = ray.intersectObject(collMesh, false)[0];
      // outside/off the map → the solid base ground, never a void
      return hit ? Math.max(hit.point.y, baseY) : baseY;
    },
    sweep(from, to) {
      _dir.subVectors(to, from);
      const dist = _dir.length();
      if (dist < 1e-9) return null;
      _dir.multiplyScalar(1 / dist);
      ray.set(from, _dir);
      ray.far = dist;
      const hit = ray.intersectObject(collMesh, false)[0];
      if (!hit) return null;
      const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
      return { point: hit.point.clone(), normal: n };
    },
  };

  return { group, collision };
}
