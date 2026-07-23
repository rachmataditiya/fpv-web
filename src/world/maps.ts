/** Map registry: each map = optional race track + environment dressing.
 *  'canyon' — the race mode map (Canyon Run at sunset).
 *  'valley' — cinematic free-fly map: big low-poly valley, no gates. */
import type { TrackDef } from './track';
import { canyonTrack } from './tracks/canyon';
import type { EnvConfig } from '../render/environment';

export type MapId = 'canyon' | 'valley';
export type AnyMapId = MapId | `custom:${string}`;

export interface MapDef {
  id: AnyMapId;
  name: string;
  mode: 'race' | 'cinematic';
  track: TrackDef | null;                       // null = free-fly only
  spawn: { pos: [number, number, number]; yawDeg: number };
  env: EnvConfig;
}

const canyon: MapDef = {
  id: 'canyon',
  name: 'Canyon Run',
  mode: 'race',
  track: canyonTrack,
  spawn: canyonTrack.spawn,
  env: {
    hdri: '/assets/sky_sunset.hdr',
    groundTexture: '/assets/ground_forest.jpg',
    groundRepeat: 170,
    terrain: { size: 1500, segments: 150, maxHeight: 55, seed: 7, flatRadius: 130 },
    scatter: { seed: 11, areaRadius: 650, treeCount: 320, rockCount: 110 },
    fog: { color: 0xc9a184, near: 300, far: 1600 },
    sun: { position: [-350, 140, 220], intensity: 1.5, color: 0xffd2a6 },
    hemiIntensity: 0.45,
    exposure: 1.05,
  },
};

const valley: MapDef = {
  id: 'valley',
  name: 'Green Valley (cinematic)',
  mode: 'cinematic',
  track: null,
  spawn: { pos: [0, 2, 0], yawDeg: 0 },
  env: {
    hdri: '/assets/sky_day.hdr',
    groundTexture: '/assets/ground_grass.jpg',
    groundRepeat: 190,
    terrain: { size: 1700, segments: 170, maxHeight: 75, seed: 21, flatRadius: 90 },
    scatter: { seed: 4, areaRadius: 750, treeCount: 650, rockCount: 160 },
    fog: { color: 0xd7e8f7, near: 320, far: 1900 },
    sun: { position: [220, 320, 120], intensity: 1.7 },
    hemiIntensity: 0.65,
    exposure: 1.0,
  },
};

export const MAPS: Record<MapId, MapDef> = { canyon, valley };

export function resolveMapId(raw: string | null | undefined): MapId {
  return raw === 'valley' ? 'valley' : 'canyon';
}

/** MapDef shell for an uploaded GoldSrc BSP — the BSP world itself loads async
 *  (IndexedDB → parse → meshes) after boot; spawn is patched in then. */
export function customMapDef(name: string): MapDef {
  return {
    id: `custom:${name}`,
    name,
    mode: 'cinematic',
    track: null,
    spawn: { pos: [0, 2, 0], yawDeg: 0 },
    env: {
      hdri: '/assets/sky_day.hdr',
      hideGround: true, // the BSP brings its own floors
      fog: { color: 0xd7e8f7, near: 200, far: 1200 },
      sun: { position: [220, 320, 120], intensity: 1.6 },
      hemiIntensity: 0.7,
      exposure: 1.0,
    },
  };
}
