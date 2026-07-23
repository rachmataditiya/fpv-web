/** Environment dressing on top of the base scene: HDRI sky (background + IBL),
 *  textured ground, low-poly terrain and scattered props. All assets are CC0
 *  (Poly Haven — see public/assets/CREDITS.txt), served from /assets.
 *
 *  applyEnvironment() mutates the scene built by createScene(): it removes the
 *  procedural sky + grids, retunes fog/lights to match the HDRI, and adds the
 *  terrain/scatter group. Async — the sim can start before it resolves. */
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { buildTerrain } from './terrain';
import type { TerrainConfig, FlatZone } from './terrain';
import { scatterProps } from './scatter';
import type { ScatterConfig, ExclusionZone } from './scatter';

export interface EnvConfig {
  hdri: string;                 // e.g. '/assets/sky_sunset.hdr'
  /** BSP maps bring their own floors — remove the default ground plane. */
  hideGround?: boolean;
  groundTexture?: string;       // repeating texture for the flat play-area ground
  groundRepeat?: number;        // tiles across the ground (default 48)
  terrain?: TerrainConfig;
  scatter?: ScatterConfig;
  fog: { color: number; near: number; far: number };
  sun?: { position: [number, number, number]; intensity: number; color?: number };
  hemiIntensity?: number;
  exposure?: number;            // ACES tone-mapping exposure (default 1.0)
}

export interface AppliedEnvironment {
  group: THREE.Group;
  /** Non-null when the env has terrain — feed terrain.heightAt to physics. */
  terrain: ReturnType<typeof buildTerrain> | null;
}

export async function applyEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  cfg: EnvConfig,
  flatZones: FlatZone[],
  exclusions: ExclusionZone[],
): Promise<AppliedEnvironment> {
  const group = new THREE.Group();
  group.name = 'environment';

  // --- HDRI: background + image-based lighting (equirect maps are PMREM'd
  // internally by three when assigned to scene.environment) ---
  const hdr = await new RGBELoader().loadAsync(cfg.hdri);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.environment = hdr;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.exposure ?? 1.0;

  // --- retire the procedural stand-ins ---
  const retire = ['sky', 'grid100', 'grid10'];
  if (cfg.hideGround) retire.push('ground');
  for (const name of retire) {
    const o = scene.getObjectByName(name);
    o?.parent?.remove(o);
  }

  // --- fog + lights matched to the HDRI mood ---
  scene.fog = new THREE.Fog(cfg.fog.color, cfg.fog.near, cfg.fog.far);
  const sun = scene.getObjectByName('sun') as THREE.DirectionalLight | undefined;
  if (sun && cfg.sun) {
    sun.position.set(...cfg.sun.position);
    sun.intensity = cfg.sun.intensity;
    if (cfg.sun.color !== undefined) sun.color.set(cfg.sun.color);
  }
  const hemi = scene.getObjectByName('hemi') as THREE.HemisphereLight | undefined;
  if (hemi && cfg.hemiIntensity !== undefined) hemi.intensity = cfg.hemiIntensity;

  // --- textured ground for the flat play area ---
  if (cfg.groundTexture) {
    const ground = scene.getObjectByName('ground') as THREE.Mesh | undefined;
    if (ground) {
      const tex = await new THREE.TextureLoader().loadAsync(cfg.groundTexture);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      const rep = cfg.groundRepeat ?? 48;
      tex.repeat.set(rep, rep);
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const mat = ground.material as THREE.MeshStandardMaterial;
      mat.map = tex;
      mat.color.set(0xbdbdbd); // let the texture carry the hue
      mat.needsUpdate = true;
    }
  }

  // --- terrain + props (deterministic, built once) ---
  let terrain: AppliedEnvironment['terrain'] = null;
  if (cfg.terrain) {
    terrain = buildTerrain(cfg.terrain, flatZones);
    group.add(terrain.mesh);
    if (cfg.scatter) group.add(scatterProps(cfg.scatter, terrain.heightAt, exclusions));
  } else if (cfg.scatter) {
    group.add(scatterProps(cfg.scatter, () => 0, exclusions));
  }

  scene.add(group);
  return { group, terrain };
}
