// Enhanced Graphics pack meshes (.rrm): the compact binary the pack's guns are stored in,
// written by tools/hd/format.mjs. Works in the browser and in Node (tests).
//   'RRM1', u32 header length, header JSON, padding to 4 bytes, then the parts' data:
//   positions u16 x3 (scaled to the file's box), normals as two i16 (octahedral),
//   detail u8 x4 (ambient occlusion, edge, cavity, spare), indices u16 or u32.

export function octDecode(x, y) {
  let nx = x, ny = y, nz = 1 - Math.abs(x) - Math.abs(y);
  if (nz < 0) { const ox = nx; nx = (1 - Math.abs(ny)) * Math.sign(ox || 1); ny = (1 - Math.abs(ox)) * Math.sign(ny || 1); }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// buf: ArrayBuffer (already decompressed). Returns { header, lods: [[{ group, role,
// position: Float32Array, normal: Float32Array, detail: Uint8Array, index }]] }.
export function parseRRM(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'RRM1') throw new Error('not an RRM1 mesh');
  const hl = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
  const base = (8 + hl + 3) & ~3;
  const [x0, y0, z0, x1, y1, z1] = header.box, sx = (x1 - x0) / 65535, sy = (y1 - y0) / 65535, sz = (z1 - z0) / 65535;
  const lods = header.lods.map((lod) => lod.parts.map((p) => {
    const q = new Uint16Array(buf, base + p.pos, p.v * 3), position = new Float32Array(p.v * 3);
    for (let i = 0; i < p.v; i++) { position[i * 3] = x0 + q[i * 3] * sx; position[i * 3 + 1] = y0 + q[i * 3 + 1] * sy; position[i * 3 + 2] = z0 + q[i * 3 + 2] * sz; }
    const o = new Int16Array(buf, base + p.nor, p.v * 2), normal = new Float32Array(p.v * 3);
    for (let i = 0; i < p.v; i++) { const n = octDecode(o[i * 2] / 32767, o[i * 2 + 1] / 32767); normal[i * 3] = n[0]; normal[i * 3 + 1] = n[1]; normal[i * 3 + 2] = n[2]; }
    const detail = new Uint8Array(buf.slice(base + p.det, base + p.det + p.v * 4));
    const index = p.i32 ? new Uint32Array(buf.slice(base + p.idx, base + p.idx + p.i * 4)) : new Uint16Array(buf.slice(base + p.idx, base + p.idx + p.i * 2));
    return { group: p.group, role: p.role, position, normal, detail, index };
  }));
  return { header, lods };
}
