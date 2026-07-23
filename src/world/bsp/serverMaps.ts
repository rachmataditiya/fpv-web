/** Server-hosted map folders. The production nginx serves /maps/ with
 *  `autoindex_format json`, so dropping `maps/<name>/{*.bsp, *.wad}` on the
 *  server publishes a map with zero build steps or manifests. Each folder =
 *  one map: exactly one .bsp (first found wins) + any number of .wads.
 *
 *  Dev servers (vite) have no autoindex — every function degrades to
 *  "no server maps" instead of throwing. */

export interface ServerMap {
  name: string;      // folder name
  bspUrl: string;
  wadUrls: string[];
  /** Published race track (maps/<name>/track.json), if any. */
  trackUrl: string | null;
}

interface AutoindexEntry {
  name: string;
  type: 'directory' | 'file';
}

async function listing(url: string): Promise<AutoindexEntry[] | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null; // dev server fallback page, not an index
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return null;
    return data as AutoindexEntry[];
  } catch {
    return null;
  }
}

/** Enumerate map folders on the server (empty when unsupported/none). */
export async function listServerMaps(): Promise<ServerMap[]> {
  const root = await listing('/maps/');
  if (!root) return [];
  const out: ServerMap[] = [];
  for (const dir of root.filter((e) => e.type === 'directory')) {
    const files = await listing(`/maps/${encodeURIComponent(dir.name)}/`);
    if (!files) continue;
    const bsp = files.find((f) => f.type === 'file' && f.name.toLowerCase().endsWith('.bsp'));
    if (!bsp) continue;
    const wads = files.filter((f) => f.type === 'file' && f.name.toLowerCase().endsWith('.wad'));
    const track = files.find((f) => f.type === 'file' && f.name.toLowerCase() === 'track.json');
    const base = `/maps/${encodeURIComponent(dir.name)}/`;
    out.push({
      name: dir.name,
      bspUrl: base + encodeURIComponent(bsp.name),
      wadUrls: wads.map((w) => base + encodeURIComponent(w.name)),
      trackUrl: track ? base + 'track.json' : null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Download one server map's binaries. */
export async function fetchServerMap(name: string): Promise<{ bsp: ArrayBuffer; wads: ArrayBuffer[] } | null> {
  const maps = await listServerMaps();
  const m = maps.find((x) => x.name === name);
  if (!m) return null;
  const bspRes = await fetch(m.bspUrl);
  if (!bspRes.ok) return null;
  const bsp = await bspRes.arrayBuffer();
  const wads: ArrayBuffer[] = [];
  for (const u of m.wadUrls) {
    const r = await fetch(u);
    if (r.ok) wads.push(await r.arrayBuffer());
  }
  return { bsp, wads };
}
