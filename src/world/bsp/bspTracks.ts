/** Race tracks for BSP maps.
 *
 *  Sources, in priority order:
 *   1. The player's own edited track — localStorage 'fpv_bsp_tracks', keyed by
 *      map id ('custom:<name>' / 'server:<name>').
 *   2. A published `track.json` in the server map's folder (a TrackDef).
 *
 *  The in-game editor (main.ts, key G/U while editing) builds a TrackDef from
 *  drone positions; exportTrackJson() downloads it for publishing to
 *  `maps/<name>/track.json` on the server. */
import type { GateDef, TrackDef } from '../track';

const LS = 'fpv_bsp_tracks';

type Store = Record<string, TrackDef>;

function loadAll(): Store {
  try {
    return (JSON.parse(localStorage.getItem(LS) ?? '{}') as Store) || {};
  } catch {
    return {};
  }
}

export function savedTrackFor(mapId: string): TrackDef | null {
  return loadAll()[mapId] ?? null;
}

export function saveTrackFor(mapId: string, track: TrackDef): void {
  const m = loadAll();
  m[mapId] = track;
  try {
    localStorage.setItem(LS, JSON.stringify(m));
  } catch {
    /* quota */
  }
}

export function deleteTrackFor(mapId: string): void {
  const m = loadAll();
  delete m[mapId];
  try {
    localStorage.setItem(LS, JSON.stringify(m));
  } catch {
    /* quota */
  }
}

/** Fetch a published track.json (validated loosely). */
export async function fetchServerTrack(url: string): Promise<TrackDef | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const t = (await res.json()) as TrackDef;
    if (!Array.isArray(t.gates) || t.gates.length < 2 || !t.spawn) return null;
    return t;
  } catch {
    return null;
  }
}

/** Build a valid TrackDef from editor-placed gates. Bounds envelop the gates
 *  generously (the BSP world itself provides walls); sectors split in thirds. */
export function buildTrack(
  name: string,
  gates: GateDef[],
  spawn: { pos: [number, number, number]; yawDeg: number },
): TrackDef {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const g of gates) {
    minX = Math.min(minX, g.pos[0]); maxX = Math.max(maxX, g.pos[0]);
    minY = Math.min(minY, g.pos[1]); maxY = Math.max(maxY, g.pos[1]);
    minZ = Math.min(minZ, g.pos[2]); maxZ = Math.max(maxZ, g.pos[2]);
  }
  const n = gates.length;
  const sectorEnds = n >= 6 ? [Math.floor(n / 3), Math.floor((2 * n) / 3)] : n >= 3 ? [Math.floor(n / 2)] : [];
  return {
    name,
    spawn,
    bounds: {
      min: [minX - 60, Math.min(-20, minY - 30), minZ - 60],
      max: [maxX + 60, maxY + 80, maxZ + 60],
    },
    gates,
    sectorEnds,
  };
}

/** Download the track as a `track.json` for publishing to the server folder. */
export function exportTrackJson(track: TrackDef): void {
  const blob = new Blob([JSON.stringify(track, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'track.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
