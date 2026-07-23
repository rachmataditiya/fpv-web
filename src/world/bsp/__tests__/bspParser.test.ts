import { describe, it, expect } from 'vitest';
import { BSP_SCALE, parseBsp } from '../bspParser';

/** Build a minimal-but-valid GoldSrc v30 BSP: one 8×8 embedded texture, one
 *  square face (2 triangles) on the floor, one model, one spawn entity. */
function buildTestBsp(): ArrayBuffer {
  const chunks: { data: Uint8Array; lump: number }[] = [];
  const push = (lump: number, data: Uint8Array) => chunks.push({ lump, data });

  // entities (lump 0)
  push(0, new TextEncoder().encode('{\n"classname" "worldspawn"\n}\n{\n"classname" "info_player_start"\n"origin" "100 200 36"\n"angle" "90"\n}\n\0'));

  // textures (lump 2): count=1, offset, one embedded 8×8 miptex
  {
    const w = 8, h = 8;
    const px = w * h;
    const mipSizes = px + (px >> 2) + (px >> 4) + (px >> 6);
    const size = 8 + 40 + mipSizes + 2 + 768;
    const buf = new Uint8Array(size);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 1, true);        // texture count
    dv.setInt32(4, 8, true);         // offset of miptex 0 (relative to lump)
    const base = 8;
    buf.set(new TextEncoder().encode('floor01'), base); // name
    dv.setUint32(base + 16, w, true);
    dv.setUint32(base + 20, h, true);
    // mip offsets relative to miptex base
    let o = 40;
    for (let m = 0; m < 4; m++) {
      dv.setUint32(base + 24 + m * 4, o, true);
      o += px >> (m * 2);
    }
    // indices all = 3; palette[3] = (10, 200, 30)
    buf.fill(3, base + 40, base + 40 + mipSizes);
    const palBase = base + 40 + mipSizes + 2;
    buf[palBase + 3 * 3] = 10;
    buf[palBase + 3 * 3 + 1] = 200;
    buf[palBase + 3 * 3 + 2] = 30;
    push(2, buf);
  }

  // vertices (lump 3): square 0..64 quake units at z=0
  {
    const v = new Float32Array([0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 64, 0]);
    push(3, new Uint8Array(v.buffer));
  }

  // texinfo (lump 6): vs=(1,0,0) sShift 0, vt=(0,1,0) tShift 0, miptex 0
  {
    const b = new Uint8Array(40);
    const dv = new DataView(b.buffer);
    dv.setFloat32(0, 1, true);   // vs.x
    dv.setFloat32(16, 0, true);  // vt.x
    dv.setFloat32(20, 1, true);  // vt.y
    dv.setUint32(32, 0, true);   // miptex
    push(6, b);
  }

  // faces (lump 7): one face, 4 edges starting at surfedge 0
  {
    const b = new Uint8Array(20);
    const dv = new DataView(b.buffer);
    dv.setUint32(4, 0, true);  // firstEdge
    dv.setUint16(8, 4, true);  // numEdges
    dv.setUint16(10, 0, true); // texinfo
    push(7, b);
  }

  // edges (lump 12): (0,1) (1,2) (2,3) (3,0)
  push(12, new Uint8Array(new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]).buffer));
  // surfedges (lump 13): 0,1,2,3 forward
  push(13, new Uint8Array(new Int32Array([0, 1, 2, 3]).buffer));

  // models (lump 14): one model, firstFace 0, numFaces 1
  {
    const b = new Uint8Array(64);
    const dv = new DataView(b.buffer);
    dv.setInt32(56, 0, true);
    dv.setInt32(60, 1, true);
    push(14, b);
  }

  // assemble: header (4 + 15*8) + lumps (4-aligned)
  const headerSize = 4 + 15 * 8;
  let cursor = headerSize;
  const placed = new Map<number, { ofs: number; len: number }>();
  for (const c of chunks) {
    cursor = (cursor + 3) & ~3;
    placed.set(c.lump, { ofs: cursor, len: c.data.length });
    cursor += c.data.length;
  }
  const out = new Uint8Array(cursor);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 30, true); // version
  for (const c of chunks) {
    const p = placed.get(c.lump)!;
    out.set(c.data, p.ofs);
  }
  for (let l = 0; l < 15; l++) {
    const p = placed.get(l) ?? { ofs: 0, len: 0 };
    dv.setUint32(4 + l * 8, p.ofs, true);
    dv.setUint32(8 + l * 8, p.len, true);
  }
  return out.buffer;
}

describe('parseBsp', () => {
  it('rejects Source and unknown versions', () => {
    const vbsp = new Uint8Array([0x56, 0x42, 0x53, 0x50, 0, 0, 0, 0]);
    expect(() => parseBsp(vbsp.buffer)).toThrow(/Source-engine/);
    const v29 = new ArrayBuffer(8);
    new DataView(v29).setUint32(0, 29, true);
    expect(() => parseBsp(v29)).toThrow(/version 29/);
  });

  it('parses geometry, texture, and spawn from a synthetic map', () => {
    const bsp = parseBsp(buildTestBsp());

    // one group, 2 triangles = 6 verts = 18 floats
    expect(bsp.groups).toHaveLength(1);
    const g = bsp.groups[0];
    expect(g.textureName).toBe('floor01');
    expect(g.positions.length).toBe(18);
    expect(g.uvs.length).toBe(12);

    // quake (64, 64, 0) → three (64·s, 0, −64·s)
    const s = 64 * BSP_SCALE;
    const pts: number[][] = [];
    for (let i = 0; i < 18; i += 3) pts.push([g.positions[i], g.positions[i + 1], g.positions[i + 2]]);
    expect(pts).toContainEqual([expect.closeTo(s, 5), expect.closeTo(0, 5), expect.closeTo(-s, 5)]);

    // UV of quake vertex (64,64,0) with vs=x/8 → u = 64/8 = 8
    const maxU = Math.max(...g.uvs.filter((_, i) => i % 2 === 0));
    expect(maxU).toBeCloseTo(8);

    // embedded texture decoded: palette index 3 everywhere → rgba (10,200,30,255)
    const tex = bsp.textures.get('floor01')!;
    expect(tex.rgba).not.toBeNull();
    expect([...tex.rgba!.slice(0, 4)]).toEqual([10, 200, 30, 255]);

    // spawn: quake (100,200,36), yaw 90 → three (100s, 36s+0.5, −200s), yaw 0
    expect(bsp.spawns).toHaveLength(1);
    const sp = bsp.spawns[0];
    expect(sp.pos[0]).toBeCloseTo(100 * BSP_SCALE);
    expect(sp.pos[1]).toBeCloseTo(36 * BSP_SCALE + 0.5);
    expect(sp.pos[2]).toBeCloseTo(-200 * BSP_SCALE);
    expect(sp.yawDeg).toBe(0);
  });
});
