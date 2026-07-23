import type { BspTexture } from './bspParser';
import { decodeMipTex } from './bspParser';

/**
 * Extracts a null-terminated string from a DataView using Latin-1 encoding.
 * Reads up to `maxLen` bytes, stopping at the first 0x00.
 */
function cstr(view: DataView, offset: number, maxLen: number): string {
  const bytes: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    const byte = view.getUint8(offset + i);
    if (byte === 0) break;
    bytes.push(byte);
  }
  return String.fromCharCode(...bytes);
}

const WAD_MAGIC_1 = 'WAD3';
const WAD_MAGIC_2 = 'WAD2';
const MAX_TEXTURE_SIZE = 4096;
const MIPTEX_TYPE_STD = 0x43; // standard miptex type
const MIPTEX_TYPE_ALT = 0x44; // also miptex in some tools

/**
 * Parses a Half-Life WAD3 (or WAD2) texture archive.
 *
 * @param buf - the raw bytes of the .wad file
 * @returns a Map from lowercased texture names to their decoded RGBA data
 * @throws if the file magic is not recognized
 */
export function parseWad(buf: ArrayBuffer): Map<string, BspTexture> {
  const view = new DataView(buf);

  // --- verify magic ---
  const magic = cstr(view, 0, 4);
  if (magic !== WAD_MAGIC_1 && magic !== WAD_MAGIC_2) {
    throw new Error(`Bad WAD magic: expected '${WAD_MAGIC_1}' or '${WAD_MAGIC_2}', got '${magic}'`);
  }

  const numEntries = view.getInt32(4, true);
  const dirOffset = view.getInt32(8, true);

  // --- parse directory entries ---
  const entries: {
    filePos: number;
    name: string;
  }[] = [];

  for (let i = 0; i < numEntries; i++) {
    const base = dirOffset + i * 32;
    // protect against truncated directories
    if (base + 32 > buf.byteLength) break;

    const filePos = view.getInt32(base, true);
    const type = view.getUint8(base + 12);
    const compression = view.getUint8(base + 13);

    const rawName = cstr(view, base + 16, 16);
    const name = rawName.toLowerCase();

    // Mip texture types for WAD3/WAD2: 0x43 (standard), 0x44 (alternate)
    // Skip if compression is enabled (compression !== 0)
    const isMiptex = (type === MIPTEX_TYPE_STD || type === MIPTEX_TYPE_ALT) && compression === 0;

    if (isMiptex) {
      entries.push({ filePos, name });
    }
  }

  const textures = new Map<string, BspTexture>();

  for (const entry of entries) {
    try {
      // --- read the miptex header inside the lump ---
      // miptex structure: name[16], width u32, height u32, mipOffsets[4] u32
      // Total header = 40 bytes
      const lumpBase = entry.filePos;
      if (lumpBase + 40 > buf.byteLength) continue;

      const width = view.getUint32(lumpBase + 16, true);
      const height = view.getUint32(lumpBase + 20, true);
      const mip0Offset = view.getUint32(lumpBase + 24, true); // relative to lumpBase

      // sanity checks on dimensions
      if (width === 0 || width > MAX_TEXTURE_SIZE) continue;
      if (height === 0 || height > MAX_TEXTURE_SIZE) continue;
      if (mip0Offset < 0) continue;

      // verify mip0 data doesn't exceed buffer
      if (lumpBase + mip0Offset > buf.byteLength) continue;

      // decode the first mip level to RGBA
      const rgba = decodeMipTex(view, lumpBase, entry.name, width, height, mip0Offset);

      // construct BspTexture
      const texture: BspTexture = {
        name: entry.name,
        width,
        height,
        rgba,
      };

      textures.set(entry.name, texture);
    } catch {
      // individual entry decoding failed – skip it
      continue;
    }
  }

  return textures;
}
