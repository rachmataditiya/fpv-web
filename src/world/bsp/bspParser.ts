/** GoldSrc BSP v30 parser (Half-Life / Counter-Strike 1.6 era maps).
 *
 *  Scope: geometry + embedded miptex textures + spawn points. No lightmaps, no
 *  PVS — we render everything and light it with the sim's HDRI. Source-engine
 *  BSPs ('VBSP') and Quake v29 are rejected with a clear error.
 *
 *  Output is three-agnostic (plain typed arrays) so it unit-tests in node;
 *  render/bspWorld.ts turns it into meshes + a collision BVH.
 *
 *  Coordinates: Quake is Z-up, 1 unit = 1 inch. We convert to three's Y-up via
 *  (x, y, z) → (x, z, −y) — a proper rotation, so winding survives — and scale
 *  by 0.0254 to meters. de_dust ends up ~120 m across: drone-sized.
 */

export const BSP_SCALE = 0.0254;

// lump indices (v30)
const L_ENTITIES = 0;
const L_TEXTURES = 2;
const L_VERTICES = 3;
const L_TEXINFO = 6;
const L_FACES = 7;
const L_EDGES = 12;
const L_SURFEDGES = 13;
const L_MODELS = 14;

/** Decoded 8-bit palettized texture → RGBA. */
export interface BspTexture {
  name: string;
  width: number;
  height: number;
  /** null = data lives in an external WAD that wasn't supplied. */
  rgba: Uint8Array | null;
}

/** All faces sharing one texture, pre-triangulated, in three's Y-up meters. */
export interface BspFaceGroup {
  textureName: string;
  positions: Float32Array; // xyz triplets, non-indexed triangles
  uvs: Float32Array;       // normalized by the texture's declared size
}

export interface BspSpawn {
  pos: [number, number, number]; // three space, meters
  yawDeg: number;                // our convention (0 = facing −Z)
}

export interface ParsedBsp {
  groups: BspFaceGroup[];
  textures: Map<string, BspTexture>;
  spawns: BspSpawn[];
  /** texture names referenced but not embedded (candidates for WAD lookup) */
  missingTextures: string[];
}

/** Face textures that are engine markup, not visible geometry. */
const SKIP_TEX = new Set(['clip', 'origin', 'null', 'hint', 'skip', 'trigger', 'aaatrigger', 'black_hidden']);
function skippable(name: string): boolean {
  return SKIP_TEX.has(name) || name.startsWith('sky');
}

function cstr(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  return new TextDecoder('latin1').decode(bytes.subarray(0, end)).toLowerCase();
}

/** Decode one embedded miptex (mip level 0) to RGBA. GoldSrc palette follows
 *  the smallest mip: indices, then u16 color count (256), then 256×3 RGB.
 *  '{'-prefixed names use palette index 255 as transparent. */
export function decodeMipTex(
  view: DataView,
  base: number,
  name: string,
  width: number,
  height: number,
  mipOfs0: number,
): Uint8Array {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const px = width * height;
  const indices = bytes.subarray(base + mipOfs0, base + mipOfs0 + px);
  // palette sits after mip3 (whose size is px/64), skipping the u16 count
  const mip3End = base + mipOfs0 + px + (px >> 2) + (px >> 4) + (px >> 6);
  const pal = bytes.subarray(mip3End + 2, mip3End + 2 + 256 * 3);
  const transparent = name.startsWith('{');
  const rgba = new Uint8Array(px * 4);
  for (let i = 0; i < px; i++) {
    const idx = indices[i];
    const o = i * 4;
    rgba[o] = pal[idx * 3];
    rgba[o + 1] = pal[idx * 3 + 1];
    rgba[o + 2] = pal[idx * 3 + 2];
    rgba[o + 3] = transparent && idx === 255 ? 0 : 255;
  }
  return rgba;
}

export function parseBsp(buf: ArrayBuffer, wadTextures?: Map<string, BspTexture>): ParsedBsp {
  const view = new DataView(buf);
  const magic = view.getUint32(0, true);
  if (magic === 0x50534256 /* 'VBSP' */) {
    throw new Error('This is a Source-engine map (CS:S/CS:GO) — only GoldSrc v30 (CS 1.6 / Half-Life) is supported.');
  }
  if (magic !== 30) {
    throw new Error(`Unsupported BSP version ${magic} — only GoldSrc v30 (CS 1.6 / Half-Life) is supported.`);
  }
  const lump = (i: number) => ({ ofs: view.getUint32(4 + i * 8, true), len: view.getUint32(8 + i * 8, true) });

  // Typed-array views need element alignment; lump offsets aren't guaranteed
  // aligned, so fall back to a copy when they're not.
  const f32 = (ofs: number, n: number) =>
    ofs % 4 === 0 ? new Float32Array(buf, ofs, n) : new Float32Array(buf.slice(ofs, ofs + n * 4));
  const i32 = (ofs: number, n: number) =>
    ofs % 4 === 0 ? new Int32Array(buf, ofs, n) : new Int32Array(buf.slice(ofs, ofs + n * 4));
  const u16 = (ofs: number, n: number) =>
    ofs % 2 === 0 ? new Uint16Array(buf, ofs, n) : new Uint16Array(buf.slice(ofs, ofs + n * 2));

  // --- vertices (quake space; converted at emit time) ---
  const lv = lump(L_VERTICES);
  const nVerts = (lv.len / 12) | 0;
  const verts = f32(lv.ofs, nVerts * 3);

  // --- edges + surfedges ---
  const le = lump(L_EDGES);
  const edges = u16(le.ofs, (le.len / 2) | 0);
  const ls = lump(L_SURFEDGES);
  const surfedges = i32(ls.ofs, (ls.len / 4) | 0);

  // --- texinfo ---
  const lt = lump(L_TEXINFO);
  const nTexinfo = (lt.len / 40) | 0;

  // --- textures ---
  const lx = lump(L_TEXTURES);
  const texCount = view.getUint32(lx.ofs, true);
  const textures: BspTexture[] = [];
  const texByName = new Map<string, BspTexture>();
  const missing: string[] = [];
  for (let i = 0; i < texCount; i++) {
    const rel = view.getInt32(lx.ofs + 4 + i * 4, true);
    if (rel < 0) {
      textures.push({ name: `__missing_${i}`, width: 64, height: 64, rgba: null });
      continue;
    }
    const base = lx.ofs + rel;
    const name = cstr(new Uint8Array(buf, base, 16));
    const width = view.getUint32(base + 16, true);
    const height = view.getUint32(base + 20, true);
    const mip0 = view.getUint32(base + 24, true);
    let tex: BspTexture;
    if (mip0 !== 0) {
      tex = { name, width, height, rgba: decodeMipTex(view, base, name, width, height, mip0) };
    } else {
      // external — try supplied WADs (dims in the BSP header are authoritative)
      const wad = wadTextures?.get(name);
      tex = wad ? { name, width, height, rgba: wad.rgba } : { name, width, height, rgba: null };
      if (!wad && !skippable(name)) missing.push(name);
    }
    textures.push(tex);
    texByName.set(name, tex);
  }

  // --- faces + models ---
  const lf = lump(L_FACES);
  const nFaces = (lf.len / 20) | 0;
  const lm = lump(L_MODELS);
  const nModels = (lm.len / 64) | 0;

  // group triangles by texture
  const groupPos = new Map<number, number[]>();
  const groupUv = new Map<number, number[]>();

  const emitFace = (fi: number): void => {
    const fBase = lf.ofs + fi * 20;
    const firstEdge = view.getUint32(fBase + 4, true);
    const numEdges = view.getUint16(fBase + 8, true);
    const texinfoIdx = view.getUint16(fBase + 10, true);
    if (texinfoIdx >= nTexinfo || numEdges < 3) return;

    const tBase = lt.ofs + texinfoIdx * 40;
    const miptex = view.getUint32(tBase + 32, true);
    const tex = textures[miptex];
    if (!tex || skippable(tex.name)) return;

    const vs = [view.getFloat32(tBase, true), view.getFloat32(tBase + 4, true), view.getFloat32(tBase + 8, true)];
    const sShift = view.getFloat32(tBase + 12, true);
    const vt = [view.getFloat32(tBase + 16, true), view.getFloat32(tBase + 20, true), view.getFloat32(tBase + 24, true)];
    const tShift = view.getFloat32(tBase + 28, true);

    // face polygon loop (quake space)
    const poly: number[][] = [];
    for (let e = 0; e < numEdges; e++) {
      const se = surfedges[firstEdge + e];
      const vi = se >= 0 ? edges[se * 2] : edges[-se * 2 + 1];
      poly.push([verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]]);
    }

    let pos = groupPos.get(miptex);
    let uv = groupUv.get(miptex);
    if (!pos) {
      pos = [];
      uv = [];
      groupPos.set(miptex, pos);
      groupUv.set(miptex, uv);
    }
    const pushVert = (q: number[]) => {
      // quake → three: (x, z, −y), scaled to meters
      pos!.push(q[0] * BSP_SCALE, q[2] * BSP_SCALE, -q[1] * BSP_SCALE);
      const u = (q[0] * vs[0] + q[1] * vs[1] + q[2] * vs[2] + sShift) / tex.width;
      const v = (q[0] * vt[0] + q[1] * vt[1] + q[2] * vt[2] + tShift) / tex.height;
      uv!.push(u, v);
    };
    // triangle fan
    for (let t = 1; t < poly.length - 1; t++) {
      pushVert(poly[0]);
      pushVert(poly[t]);
      pushVert(poly[t + 1]);
    }
  };

  for (let m = 0; m < nModels; m++) {
    const mBase = lm.ofs + m * 64;
    const firstFace = view.getInt32(mBase + 56, true);
    const numFaces = view.getInt32(mBase + 60, true);
    for (let f = firstFace; f < firstFace + numFaces && f < nFaces; f++) emitFace(f);
  }

  const groups: BspFaceGroup[] = [];
  for (const [miptex, pos] of groupPos) {
    groups.push({
      textureName: textures[miptex].name,
      positions: new Float32Array(pos),
      uvs: new Float32Array(groupUv.get(miptex)!),
    });
  }

  // --- entities → spawns ---
  const len = lump(L_ENTITIES);
  const entText = new TextDecoder('latin1').decode(new Uint8Array(buf, len.ofs, len.len));
  const spawns: BspSpawn[] = [];
  for (const block of entText.split('}')) {
    const get = (k: string) => new RegExp(`"${k}"\\s+"([^"]*)"`).exec(block)?.[1];
    const cls = get('classname');
    if (cls !== 'info_player_start' && cls !== 'info_player_deathmatch') continue;
    const org = get('origin')?.split(/\s+/).map(Number);
    if (!org || org.length < 3 || org.some(Number.isNaN)) continue;
    const qYaw = Number(get('angle') ?? get('angles')?.split(/\s+/)[1] ?? 0) || 0;
    spawns.push({
      pos: [org[0] * BSP_SCALE, org[2] * BSP_SCALE + 0.5, -org[1] * BSP_SCALE],
      // quake yaw 0 = +X east; ours 0 = −Z. φ = θ − 90°.
      yawDeg: qYaw - 90,
    });
  }

  return { groups, textures: texByName, spawns, missingTextures: [...new Set(missing)] };
}
