// Writes the .rrm mesh format (see js/render/hd-mesh.js for the layout and the reader).
function oct(nx, ny, nz) {
  const l = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
  let x = nx / l, y = ny / l;
  if (nz < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); }
  return [Math.round(Math.max(-1, Math.min(1, x)) * 32767), Math.round(Math.max(-1, Math.min(1, y)) * 32767)];
}
// lods: [[{ group, role, pos, nor, ao, edge, cavity, idx }]], extra: header fields.
export function writeRRM(lods, extra = {}) {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const lod of lods) for (const p of lod) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) {
    box[k] = Math.min(box[k], p.pos[i + k]); box[k + 3] = Math.max(box[k + 3], p.pos[i + k]);
  }
  for (let k = 0; k < 3; k++) { box[k] -= 1e-4; box[k + 3] += 1e-4; }
  const chunks = [];
  let off = 0;
  const put = (arr) => { const o = off; const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); chunks.push(b); off += b.length; const pad = (4 - (off & 3)) & 3; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } return o; };
  const header = { ...extra, box, lods: [] };
  for (const lod of lods) {
    const parts = [];
    for (const p of lod) {
      const v = p.pos.length / 3;
      const q = new Uint16Array(v * 3);
      for (let i = 0; i < v; i++) for (let k = 0; k < 3; k++) q[i * 3 + k] = Math.round((p.pos[i * 3 + k] - box[k]) / (box[k + 3] - box[k]) * 65535);
      const n = new Int16Array(v * 2);
      for (let i = 0; i < v; i++) { const [a, b] = oct(p.nor[i * 3], p.nor[i * 3 + 1], p.nor[i * 3 + 2]); n[i * 2] = a; n[i * 2 + 1] = b; }
      const d = new Uint8Array(v * 4);
      for (let i = 0; i < v; i++) { d[i * 4] = Math.round(p.ao[i] * 255); d[i * 4 + 1] = Math.round(p.edge[i] * 255); d[i * 4 + 2] = Math.round(p.cavity[i] * 255); }
      const i32 = v > 65535;
      const ix = i32 ? Uint32Array.from(p.idx) : Uint16Array.from(p.idx);
      parts.push({ group: p.group, role: p.role, v, i: p.idx.length, i32, pos: put(q), nor: put(n), det: put(d), idx: put(ix) });
    }
    header.lods.push({ parts });
  }
  const hj = new TextEncoder().encode(JSON.stringify(header));
  const base = (8 + hj.length + 3) & ~3;
  const out = new Uint8Array(base + off);
  out.set([82, 82, 77, 49], 0);
  new DataView(out.buffer).setUint32(4, hj.length, true);
  out.set(hj, 8);
  let p = base;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
