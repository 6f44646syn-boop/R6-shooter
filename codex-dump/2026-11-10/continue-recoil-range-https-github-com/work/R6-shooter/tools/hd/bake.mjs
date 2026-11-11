// Turns a kit Model into render-ready meshes: smooth normals across rounded edges (creased
// at sharp ones), evenly fine triangles, and per-vertex ambient occlusion (ray traced against
// the whole gun), edge wear (convex edges) and cavity (inside corners) masks.
import { ROLES, GROUPS } from './kit.mjs';

const CREASE = Math.cos(40 * Math.PI / 180);

// Non-indexed triangle soup -> indexed mesh with creased, angle-weighted normals.
export function crease(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position.array, nt = P.length / 9;
  const fn = new Float32Array(nt * 3), keep = new Uint8Array(nt);
  const ang = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2];
    const vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-13) continue;
    keep[t] = 1;
    fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    for (let k = 0; k < 3; k++) {          // corner angles (normal weights)
      const a = o + k * 3, b = o + ((k + 1) % 3) * 3, c = o + ((k + 2) % 3) * 3;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const d = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / (Math.hypot(...e1) * Math.hypot(...e2) || 1);
      ang[t * 3 + k] = Math.acos(Math.max(-1, Math.min(1, d)));
    }
  }
  const key = (i) => Math.round(P[i] * 1e6) + ',' + Math.round(P[i + 1] * 1e6) + ',' + Math.round(P[i + 2] * 1e6);
  const byPos = new Map();
  for (let t = 0; t < nt; t++) if (keep[t]) for (let k = 0; k < 3; k++) {
    const kk = key(t * 9 + k * 3);
    let L = byPos.get(kk); if (!L) byPos.set(kk, (L = []));
    L.push(t * 3 + k);
  }
  const pos = [], nor = [], idx = [], weld = new Map();
  for (let t = 0; t < nt; t++) {
    if (!keep[t]) continue;
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3, L = byPos.get(key(o));
      let nx = 0, ny = 0, nz = 0;
      for (const c of L) {
        const f = (c / 3) | 0;
        const d = fn[t * 3] * fn[f * 3] + fn[t * 3 + 1] * fn[f * 3 + 1] + fn[t * 3 + 2] * fn[f * 3 + 2];
        if (d < CREASE) continue;
        const w = ang[c];
        nx += fn[f * 3] * w; ny += fn[f * 3 + 1] * w; nz += fn[f * 3 + 2] * w;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const wk = key(o) + '|' + Math.round(nx * 500) + ',' + Math.round(ny * 500) + ',' + Math.round(nz * 500);
      let vi = weld.get(wk);
      if (vi === undefined) { vi = pos.length / 3; weld.set(wk, vi); pos.push(P[o], P[o + 1], P[o + 2]); nor.push(nx, ny, nz); }
      tri.push(vi);
    }
    if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) idx.push(...tri);
  }
  return { pos, nor, idx };
}

// Split every edge longer than L that belongs to a triangle with real area (thin bevel
// strips are left alone). Edges are matched by position, so both sides of a crease split
// alike: no cracks or T-junctions.
export function tessellate(mesh, L) {
  let { pos, nor, idx } = mesh;
  const minArea = 0.12 * L * L;
  for (let pass = 0; pass < 12; pass++) {
    const mid = new Map(), marked = new Set();
    const len = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
    const pk = (a) => Math.round(pos[a * 3] * 1e6) + ',' + Math.round(pos[a * 3 + 1] * 1e6) + ',' + Math.round(pos[a * 3 + 2] * 1e6);
    const pe = (a, b) => { const x = pk(a), y = pk(b); return x < y ? x + '|' + y : y + '|' + x; };
    const ek = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
    for (let i = 0; i < idx.length; i += 3) {
      const A = idx[i], B = idx[i + 1], C = idx[i + 2];
      const ux = pos[B * 3] - pos[A * 3], uy = pos[B * 3 + 1] - pos[A * 3 + 1], uz = pos[B * 3 + 2] - pos[A * 3 + 2];
      const vx = pos[C * 3] - pos[A * 3], vy = pos[C * 3 + 1] - pos[A * 3 + 1], vz = pos[C * 3 + 2] - pos[A * 3 + 2];
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      if (area < minArea) continue;
      for (let k = 0; k < 3; k++) { const a = idx[i + k], b = idx[i + (k + 1) % 3]; if (len(a, b) > L) marked.add(pe(a, b)); }
    }
    if (!marked.size) break;
    for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = idx[i + k], b = idx[i + (k + 1) % 3];
      if (marked.has(pe(a, b))) mid.set(ek(a, b), -1);
    }
    // Midpoints are shared by position (both sides of a crease get the same point).
    const at = (a, b) => {
      const k = ek(a, b);
      let v = mid.get(k);
      if (v === undefined) return -1;
      if (v < 0) {
        v = pos.length / 3;
        pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
        let nx = nor[a * 3] + nor[b * 3], ny = nor[a * 3 + 1] + nor[b * 3 + 1], nz = nor[a * 3 + 2] + nor[b * 3 + 2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / l, ny / l, nz / l);
        mid.set(k, v);
      }
      return v;
    };
    const out = [];
    for (let i = 0; i < idx.length; i += 3) {
      const v = [idx[i], idx[i + 1], idx[i + 2]];
      const m = [at(v[0], v[1]), at(v[1], v[2]), at(v[2], v[0])];
      const n = m.filter((x) => x >= 0).length;
      if (n === 0) { out.push(...v); continue; }
      if (n === 3) { out.push(v[0], m[0], m[2], m[0], v[1], m[1], m[2], m[1], v[2], m[0], m[1], m[2]); continue; }
      // Rotate so the first split edge is v0-v1.
      let r = 0;
      if (n === 1) r = m.findIndex((x) => x >= 0);
      else r = m[0] >= 0 && m[1] >= 0 ? 0 : m[1] >= 0 && m[2] >= 0 ? 1 : 2;   // edges r and r+1 split
      const a = v[r], b = v[(r + 1) % 3], c = v[(r + 2) % 3], m0 = m[r], m1 = m[(r + 1) % 3];
      if (n === 1) { out.push(a, m0, c, m0, b, c); continue; }
      // Two split edges (a-b at m0, b-c at m1): a corner triangle and a quad a, m0, m1, c.
      out.push(m0, b, m1);
      if (len(a, m1) < len(m0, c)) out.push(a, m0, m1, a, m1, c); else out.push(a, m0, c, m0, m1, c);
    }
    idx = out;
  }
  return { pos, nor, idx };
}

// Convexity per vertex from neighbours within R: < 0 on convex edges, > 0 in inside corners.
function curvature(mesh, R) {
  const { pos, nor } = mesh, n = pos.length / 3, cell = R;
  const grid = new Map(), ck = (x, y, z) => x + ',' + y + ',' + z;
  for (let i = 0; i < n; i++) {
    const k = ck(Math.floor(pos[i * 3] / cell), Math.floor(pos[i * 3 + 1] / cell), Math.floor(pos[i * 3 + 2] / cell));
    let L = grid.get(k); if (!L) grid.set(k, (L = []));
    L.push(i);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let s = 0, w = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const L = grid.get(ck(cx + a, cy + b, cz + c));
      if (!L) continue;
      for (const j of L) {
        const dx = pos[j * 3] - x, dy = pos[j * 3 + 1] - y, dz = pos[j * 3 + 2] - z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-5 || d > R) continue;
        // Only neighbours on the same surface sheet (not the far side of a thin part).
        if (nor[j * 3] * nor[i * 3] + nor[j * 3 + 1] * nor[i * 3 + 1] + nor[j * 3 + 2] * nor[i * 3 + 2] < -0.2) continue;
        const k = (dx * nor[i * 3] + dy * nor[i * 3 + 1] + dz * nor[i * 3 + 2]) / d, ww = 1 - d / R;
        s += k * ww; w += ww;
      }
    }
    out[i] = w ? s / w : 0;
  }
  return out;
}

/* ---------- ray tracing for ambient occlusion ---------- */
function buildBVH(tris) {
  const n = tris.length / 9, ids = new Uint32Array(n), cen = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    ids[i] = i;
    for (let k = 0; k < 3; k++) cen[i * 3 + k] = (tris[i * 9 + k] + tris[i * 9 + 3 + k] + tris[i * 9 + 6 + k]) / 3;
  }
  const nodes = [];       // [minx, miny, minz, maxx, maxy, maxz, left|start, right|count, leaf]
  const build = (lo, hi) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = lo; i < hi; i++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
      const x = tris[ids[i] * 9 + v * 3 + k];
      if (x < b[k]) b[k] = x; if (x > b[k + 3]) b[k + 3] = x;
    }
    const me = nodes.length;
    nodes.push(null);
    if (hi - lo <= 4) { nodes[me] = [...b, lo, hi - lo, 1]; return me; }
    let ax = 0, ext = -1;
    for (let k = 0; k < 3; k++) if (b[k + 3] - b[k] > ext) { ext = b[k + 3] - b[k]; ax = k; }
    const sub = Array.from(ids.subarray(lo, hi)).sort((p, q) => cen[p * 3 + ax] - cen[q * 3 + ax]);
    ids.set(sub, lo);
    const mid = (lo + hi) >> 1;
    const l = build(lo, mid), r = build(mid, hi);
    nodes[me] = [...b, l, r, 0];
    return me;
  };
  build(0, n);
  const N = new Float64Array(nodes.length * 9);
  nodes.forEach((nd, i) => N.set(nd, i * 9));
  return { N, ids, tris };
}
// Any hit closer than tmax along (o + t d)?
function occluded(bvh, ox, oy, oz, dx, dy, dz, tmax) {
  const { N, ids, tris } = bvh;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  const stack = [0];
  let best = Infinity;
  while (stack.length) {
    const o = stack.pop() * 9;
    let t0 = ((ix >= 0 ? N[o] : N[o + 3]) - ox) * ix, t1 = ((ix >= 0 ? N[o + 3] : N[o]) - ox) * ix;
    const ty0 = ((iy >= 0 ? N[o + 1] : N[o + 4]) - oy) * iy, ty1 = ((iy >= 0 ? N[o + 4] : N[o + 1]) - oy) * iy;
    if (ty0 > t0) t0 = ty0; if (ty1 < t1) t1 = ty1;
    const tz0 = ((iz >= 0 ? N[o + 2] : N[o + 5]) - oz) * iz, tz1 = ((iz >= 0 ? N[o + 5] : N[o + 2]) - oz) * iz;
    if (tz0 > t0) t0 = tz0; if (tz1 < t1) t1 = tz1;
    if (t1 < Math.max(t0, 0) || t0 > Math.min(tmax, best)) continue;
    if (N[o + 8]) {
      const s = N[o + 6], c = N[o + 7];
      for (let i = s; i < s + c; i++) {
        const p = ids[i] * 9;
        const e1x = tris[p + 3] - tris[p], e1y = tris[p + 4] - tris[p + 1], e1z = tris[p + 5] - tris[p + 2];
        const e2x = tris[p + 6] - tris[p], e2y = tris[p + 7] - tris[p + 1], e2z = tris[p + 8] - tris[p + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det < 1e-14) continue;      // back faces: the ray started inside another part
        const inv = 1 / det, tx = ox - tris[p], tY = oy - tris[p + 1], tZ = oz - tris[p + 2];
        const u = (tx * px + tY * py + tZ * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = tY * e1z - tZ * e1y, qy = tZ * e1x - tx * e1z, qz = tx * e1y - tY * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-6 && t < best) best = t;
      }
    } else { stack.push(N[o + 6], N[o + 7]); }
  }
  return best <= tmax ? best : -1;
}
// Cosine-weighted hemisphere directions (Hammersley), in tangent space.
function hemisphere(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let b = i, r = 0, f = 0.5;
    while (b) { if (b & 1) r += f; b >>= 1; f /= 2; }
    const u = (i + 0.5) / n, phi = 2 * Math.PI * r, s = Math.sqrt(u);
    out.push([s * Math.cos(phi), s * Math.sin(phi), Math.sqrt(1 - u)]);
  }
  return out;
}

// model: kit Model; o: { L (tessellation edge), R (curvature radius), rays, maxD }.
// Returns [{ group, role, pos, nor, ao, edge, cavity, idx }] merged per group and role.
export function bake(model, { L = 0.005, R = 0.003, rays = 48, maxD = 0.06 } = {}) {
  const meshes = [];
  const all = [];
  for (const p of model.parts) {
    const c = crease(p.geo);
    if (!c.idx.length) continue;
    for (let i = 0; i < c.idx.length; i++) all.push(c.pos[c.idx[i] * 3], c.pos[c.idx[i] * 3 + 1], c.pos[c.idx[i] * 3 + 2]);
    const t = tessellate(c, L);
    meshes.push({ group: p.group, role: p.role, mesh: t, curv: curvature(t, R) });
  }
  const bvh = buildBVH(new Float64Array(all));
  const dirs = hemisphere(rays);
  for (const m of meshes) {
    const { pos, nor } = m.mesh, n = pos.length / 3;
    m.ao = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
      // Tangent frame, rotated by a per-vertex angle so the pattern does not band.
      let tx, ty, tz;
      if (Math.abs(nx) < 0.9) { tx = 0; ty = -nz; tz = ny; } else { tx = nz; ty = 0; tz = -nx; }
      let l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      const rot = ((i * 2654435761) >>> 0) / 4294967296 * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
      const ox = pos[i * 3] + nx * 2e-4, oy = pos[i * 3 + 1] + ny * 2e-4, oz = pos[i * 3 + 2] + nz * 2e-4;
      let occ = 0;
      for (const [a0, b0, c] of dirs) {
        const a = a0 * cr - b0 * sr, b = a0 * sr + b0 * cr;
        const dx = tx * a + bx * b + nx * c, dy = ty * a + by * b + ny * c, dz = tz * a + bz * b + nz * c;
        const t = occluded(bvh, ox, oy, oz, dx, dy, dz, maxD);
        if (t >= 0) { const q = t / maxD; occ += 1 - q * q; }
      }
      m.ao[i] = 1 - occ / dirs.length;
    }
  }
  // Merge per group and role.
  const out = [];
  for (const group of GROUPS) for (const role of ROLES) {
    const ms = meshes.filter((m) => m.group === group && m.role === role);
    if (!ms.length) continue;
    const pos = [], nor = [], ao = [], edge = [], cav = [], idx = [];
    for (const m of ms) {
      const base = pos.length / 3;
      for (const v of m.mesh.pos) pos.push(v);
      for (const v of m.mesh.nor) nor.push(v);
      for (const v of m.ao) ao.push(v);
      for (const k of m.curv) { edge.push(Math.min(1, Math.max(0, -k * 2.2))); cav.push(Math.min(1, Math.max(0, k * 2.2))); }
      for (const i of m.mesh.idx) idx.push(i + base);
    }
    out.push({ group, role, pos, nor, ao, edge, cavity: cav, idx });
  }
  return out;
}
