// Enhanced Graphics pack v5: baked sky light for the match maps (hd/light/<map>.rrl).
// For a grid of points every 0.5 m (up to the roofs), how much of the sky each one sees: 24
// cosine-weighted rays through the game's own collision (the Rust core: walls, roofs, doors and
// windows as they start a round). Light then spreads a little through doorways and windows into
// rooms, and a floor keeps interiors from going black. The game multiplies indirect light (sky,
// bounce, reflections) by it on High and Ultra: shaded rooms, dark corners, light at openings.
// It replaces screen-space ambient occlusion on High (cheaper), see js/render/pack-materials.js.
//   file: gzip( u32 header length, JSON { v: 2, min, n, cell }, Uint8 RG n.x*n.y*n.z, x fastest )
//   R: sky light (cool: sky, its reflections), G: room light (warm: indoors, under roofs)
// node tools/build-light.mjs [map ...]
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { MatchMap } from '../js/modes/map.js';

const OUT = new URL('../hd/light/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const MAPS = new URL('../data/maps/', import.meta.url);
const only = process.argv.slice(2);
const CELL = 0.5, RAYS = 24, FLOOR = 0.16, ROOM = 0.62, NEAR = 1.6;

// cosine-weighted directions over the upper hemisphere (a fixed spiral)
const dirs = [];
for (let i = 0; i < RAYS; i++) {
  const u = (i + 0.5) / RAYS, r = Math.sqrt(u), a = i * 2.39996323;
  dirs.push([r * Math.cos(a), Math.sqrt(1 - u), r * Math.sin(a)]);
}
// the whole sphere (local occlusion: corners, under furniture)
const sph = [];
for (let i = 0; i < 18; i++) { const y = 1 - 2 * (i + 0.5) / 18, r = Math.sqrt(1 - y * y), a = i * 2.39996323; sph.push([r * Math.cos(a), y, r * Math.sin(a)]); }
// the map's boundary walls are infinitely high: not a roof, not occlusion
const hit = (map, p, d, max) => { const h = map.raycast(p, d, max); return h && h.box && h.box.kind === 'edge' ? null : h; };

for (const f of readdirSync(MAPS).filter((n) => n.endsWith('.json'))) {
  const id = f.replace('.json', '');
  if (only.length && !only.includes(id)) continue;
  const data = JSON.parse(readFileSync(new URL(f, MAPS)));
  const map = new MatchMap(data);
  const t0 = Date.now();
  let top = 4;
  for (const b of map.solids) if (b.maxY < 30) top = Math.max(top, b.maxY);
  const min = [-map.hx - 1, 0, -map.hz - 1];
  const n = [Math.ceil((map.hx * 2 + 2) / CELL) + 1, Math.ceil((top + 1.5) / CELL) + 1, Math.ceil((map.hz * 2 + 2) / CELL) + 1];
  const N = n[0] * n[1] * n[2], vis = new Float32Array(N), room = new Float32Array(N), solid = new Uint8Array(N);
  const idx = (x, y, z) => x + n[0] * (y + n[1] * z);
  for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
    const p = [min[0] + x * CELL, Math.max(0.08, min[1] + y * CELL), min[2] + z * CELL];
    let open = 0, inside = 0, far = 0;
    const rot = ((x * 7 + y * 13 + z * 29) % 97) / 97 * Math.PI * 2, c = Math.cos(rot), s = Math.sin(rot);
    for (const d of dirs) {
      const dd = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
      const h = hit(map, p, dd, 80);
      if (!h) open++;
      else if (h.t < 0.03) inside++;
    }
    for (const d of sph) { const h = hit(map, p, [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c], NEAR); if (!h) far++; else if (h.t < 0.03) inside++; }
    const k = idx(x, y, z);
    if (inside > (RAYS + sph.length) / 2) solid[k] = 1;
    const sky = open / RAYS, ao = far / sph.length;
    // under a roof or an upper floor: the room's own lights, darker in corners
    const covered = !!hit(map, p, [0, 1, 0], 12);
    vis[k] = sky * (0.6 + 0.4 * ao);
    room[k] = covered ? 0.35 + 0.65 * ao : 0;
  }
  // light through openings: a few rounds of spreading into darker neighbours
  const tmp = new Float32Array(N);
  for (let it = 0; it < 4; it++) {
    for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
      const k = idx(x, y, z);
      if (solid[k]) { tmp[k] = vis[k]; continue; }
      let s = 0, c = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= n[0] || Y >= n[1] || Z >= n[2]) continue;
        const q = idx(X, Y, Z); if (solid[q]) continue; s += vis[q]; c++;
      }
      tmp[k] = c ? Math.max(vis[k], 0.9 * s / c) : vis[k];
    }
    vis.set(tmp);
  }
  // cells inside walls take their open neighbours' light (no dark halo bleeding out of walls)
  for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
    const k = idx(x, y, z); if (!solid[k]) continue;
    let s = 0, s2 = 0, c = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= n[0] || Y >= n[1] || Z >= n[2]) continue;
      const q = idx(X, Y, Z); if (!solid[q]) { s += vis[q]; s2 += room[q]; c++; }
    }
    vis[k] = c ? s / c : FLOOR; room[k] = c ? s2 / c : 0;
  }
  const bytes = new Uint8Array(N * 2);
  for (let k = 0; k < N; k++) { bytes[2 * k] = Math.round(255 * (FLOOR + (1 - FLOOR) * Math.min(1, vis[k]))); bytes[2 * k + 1] = Math.round(255 * Math.min(1, room[k])); }
  const head = Buffer.from(JSON.stringify({ v: 2, min, n, cell: CELL }));
  const len = Buffer.alloc(4); len.writeUInt32LE(head.length);
  const gz = gzipSync(Buffer.concat([len, head, Buffer.from(bytes)]), { level: 9 });
  writeFileSync(new URL(id + '.rrl', OUT), gz);
  map.dispose();
  console.log(id.padEnd(12), n.join('x').padEnd(12), (gz.length / 1024).toFixed(0) + ' KB', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
