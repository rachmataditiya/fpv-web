import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

export interface FlatZone {
  x: number;
  z: number;
  r: number;
}

export interface TerrainConfig {
  size: number;
  segments: number;
  maxHeight: number;
  seed: number;
  hillFreq?: number;
  flatRadius?: number;
}

export interface Terrain {
  mesh: THREE.Mesh;
  heightAt(x: number, z: number): number;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

function distance(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function buildTerrain(
  cfg: TerrainConfig,
  flatZones: FlatZone[]
): Terrain {
  const freq = cfg.hillFreq ?? 1 / 300;
  const flatRadius = cfg.flatRadius ?? 0;
  const rng = mulberry32(cfg.seed);
  const noise2d = createNoise2D(rng);

  const heightFn = (x: number, z: number): number => {
    let h = 0;
    h += 1.0 * noise2d(x * freq, z * freq);
    h += 0.5 * noise2d(x * freq * 2, z * freq * 2);
    h += 0.25 * noise2d(x * freq * 4, z * freq * 4);
    h = (h / 1.75) * cfg.maxHeight;

    const dist = distance(x, z);

    for (const zone of flatZones) {
      const zoneDist = distance(x - zone.x, z - zone.z);
      if (zoneDist < zone.r) {
        const blend = smoothstep((zoneDist - zone.r * 0.7) / (zone.r * 0.3));
        h *= blend;
      }
    }

    if (flatRadius > 0) {
      const blend = smoothstep((dist - flatRadius * 0.7) / (flatRadius * 0.3));
      h *= blend;
      const falloff = smoothstep((dist - flatRadius) / (flatRadius * 1.2));
      h *= falloff;
    }

    return Math.max(0, h);
  };

  const geometry = new THREE.PlaneGeometry(
    cfg.size,
    cfg.size,
    cfg.segments,
    cfg.segments
  );
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const positions = pos.array as Float32Array;

  // After rotateX(-π/2) the attribute layout is [x, y(up), z] — displace Y from
  // the world-space (x, z) of each vertex.
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    positions[i + 1] = heightFn(x, z);
  }
  pos.needsUpdate = true;

  geometry.computeVertexNormals();

  const colors: number[] = [];
  const colorRng = mulberry32(cfg.seed + 1);
  const _c = new THREE.Color();
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const normalArray = normals.array as Float32Array;

  const grassColor = 0x4f6a38; // sage
  const brownColor = 0x7a5c40; // dry earth
  const greyColor = 0x6e6353;  // warm rock
  const lightColor = 0xa89a80; // sun-bleached earth (peaks only)

  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1]; // up component
    const hRatio = y / cfg.maxHeight;
    const nx = normalArray[i];
    const nz = normalArray[i + 2];
    const slope = Math.sqrt(nx * nx + nz * nz);

    let color: number;
    if (hRatio > 0.95) {
      color = lightColor;
    } else if (slope > 0.5 || hRatio > 0.8) {
      color = greyColor;
    } else if (hRatio > 0.33) {
      color = brownColor;
    } else {
      color = grassColor;
    }

    // Raw byte attributes bypass three's color management and are read as
    // LINEAR — pushing sRGB hex bytes directly washes everything out. Route
    // through THREE.Color so the hex is converted sRGB → linear first.
    const jitter = 1 + (colorRng() - 0.5) * 0.2;
    _c.setHex(color);
    colors.push(
      Math.min(255, Math.round(_c.r * jitter * 255)),
      Math.min(255, Math.round(_c.g * jitter * 255)),
      Math.min(255, Math.round(_c.b * jitter * 255)),
    );
  }

  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(new Uint8Array(colors), 3, true)
  );

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.35, // damp IBL so hills stay grounded against the bright sky
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -0.01;

  return {
    mesh,
    heightAt: heightFn,
  };
}
