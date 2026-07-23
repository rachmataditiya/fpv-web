import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface ExclusionZone { x: number; z: number; r: number }
export interface ScatterConfig {
  seed: number;
  areaRadius: number;
  treeCount: number;
  rockCount: number;
  minRadius?: number;
}

/** Deterministic PRNG (mulberry32) */
const mulberry32 = (a: number) => {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, a | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};

export function scatterProps(
  cfg: ScatterConfig,
  heightAt: (x: number, z: number) => number,
  exclusions: ExclusionZone[]
): THREE.Group {
  const prng = mulberry32(cfg.seed);
  const minR = cfg.minRadius ?? 0;
  const areaR = cfg.areaRadius;
  const group = new THREE.Group();

  const randRange = (lo: number, hi: number) => lo + prng() * (hi - lo);
  const randDiskPos = () => {
    const r = Math.sqrt(prng()) * (areaR - minR) + minR;
    const a = prng() * Math.PI * 2;
    return [r * Math.cos(a), r * Math.sin(a)];
  };

  const matDarkGreen = new THREE.MeshStandardMaterial({ color: 0x2d5a27, flatShading: true, roughness: 1 });
  const matMidGreen  = new THREE.MeshStandardMaterial({ color: 0x4c8c4a, flatShading: true, roughness: 1 });
  const matBrownGreen= new THREE.MeshStandardMaterial({ color: 0x5b6e3b, flatShading: true, roughness: 1 });
  const matGrey      = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, flatShading: true, roughness: 1 });

  const trunkGeom = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5).translate(0, 0.6, 0);
  const coneLow = new THREE.ConeGeometry(0.6, 0.8, 6).translate(0, 1.6, 0);
  const coneUp = new THREE.ConeGeometry(0.45, 0.7, 6).translate(0, 2.35, 0);
  const coniferGeom = mergeGeometries([trunkGeom, coneLow, coneUp], false);

  const roundTrunk = new THREE.CylinderGeometry(0.08, 0.14, 1.5, 5).translate(0, 0.75, 0);
  const roundCanopy = new THREE.IcosahedronGeometry(0.8, 0).translate(0, 1.5, 0);
  // Cylinder is indexed, Icosahedron is not — mergeGeometries refuses mixed
  // indexing (returns null!), so de-index the trunk first.
  const roundGeom = mergeGeometries([roundTrunk.toNonIndexed(), roundCanopy], false);

  const bushGeom = new THREE.IcosahedronGeometry(0.55, 0);
  const rockGeom = new THREE.IcosahedronGeometry(0.5, 0);

  const nConifer = Math.floor(cfg.treeCount * 0.55);
  const nRound   = Math.floor(cfg.treeCount * 0.25);
  const nBush    = cfg.treeCount - nConifer - nRound;

  const isSteep = (x: number, z: number) => {
    const h0 = heightAt(x, z);
    return Math.abs(heightAt(x + 2, z) - h0) > 3 || Math.abs(heightAt(x, z + 2) - h0) > 3;
  };

  const place = (
    count: number,
    mesh: THREE.InstancedMesh,
    sink: (y: number, scale?: THREE.Vector3) => number,
    getScale: () => [number, number, number],
    baseHue: number,
    sat: number,
    light: number
  ) => {
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    let placed = 0;
    const maxAttempts = count * 4;
    for (let i = 0; i < maxAttempts && placed < count; i++) {
      const [x, z] = randDiskPos();
      if (exclusions.some(e => (x - e.x) ** 2 + (z - e.z) ** 2 < (e.r + 2) ** 2)) continue;
      if (isSteep(x, z)) continue;

      const h = heightAt(x, z);
      const [sx, sy, sz] = getScale();
      s.set(sx, sy, sz);
      const y = sink(h, s);
      const yaw = prng() * Math.PI * 2;

      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), s);
      mesh.setMatrixAt(placed, m);

      const hue = baseHue + (prng() - 0.5) * 0.1;
      c.setHSL(hue, sat, light);
      mesh.setColorAt(placed, c);

      placed++;
    }
    mesh.count = placed;
    if (placed > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  };

  const types: Array<{ count: number; geom: THREE.BufferGeometry; mat: THREE.Material; baseHue: number; sat: number; l: number }> = [
    { count: nConifer, geom: coniferGeom, mat: matDarkGreen, baseHue: 0.3, sat: 0.6, l: 0.25 },
    { count: nRound,   geom: roundGeom,   mat: matMidGreen,  baseHue: 0.3, sat: 0.7, l: 0.3  },
    { count: nBush,    geom: bushGeom,    mat: matBrownGreen,baseHue: 0.25,sat: 0.5, l: 0.25 }
  ];
  for (const t of types) {
    const mesh = new THREE.InstancedMesh(t.geom, t.mat, t.count);
    mesh.frustumCulled = true;
    place(
      t.count,
      mesh,
      (y) => y - 0.1,
      () => {
        const base = randRange(0.8, 1.6);
        const hScale = randRange(0.9, 1.4);
        return [base, base * hScale, base];
      },
      t.baseHue,
      t.sat,
      t.l
    );
    group.add(mesh);
  }

  const rockMesh = new THREE.InstancedMesh(rockGeom, matGrey, cfg.rockCount);
  rockMesh.frustumCulled = true;
  place(
    cfg.rockCount,
    rockMesh,
    (y, scale) => y - (scale?.y ?? 1) * 0.8,
    () => {
      const sx = randRange(0.3, 1.0);
      const sz = randRange(0.3, 1.0);
      const sy = randRange(0.3, 1.0);
      return [sx, sy, sz];
    },
    0.0,
    0.0,
    0.5
  );
  group.add(rockMesh);

  return group;
}
