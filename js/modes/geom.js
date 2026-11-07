// Geometry for the match modes (no three.js, no DOM: runs in the browser and in Node).
// Boxes: { minX, maxX, minY, maxY, minZ, maxZ }. Rays: origin o [x, y, z], unit direction d.

// Ray against a box. Returns the entry distance (> 0) or Infinity; sets out.n (normal axis).
export function rayBox(o, d, b, maxT = Infinity, out = null) {
  let t0 = 0, t1 = maxT, ax = -1;
  for (let a = 0; a < 3; a++) {
    const oo = o[a], dd = d[a];
    const lo = a === 0 ? b.minX : a === 1 ? b.minY : b.minZ, hi = a === 0 ? b.maxX : a === 1 ? b.maxY : b.maxZ;
    if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) return Infinity; continue; }
    let ta = (lo - oo) / dd, tb = (hi - oo) / dd;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) { t0 = ta; ax = a; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  if (ax < 0 || t0 <= 1e-6) return Infinity;       // starting inside counts as no hit
  if (out) { out.n = ax; out.s = -Math.sign(d[ax]); }
  return t0;
}

// Ray against a sphere (centre c, radius r): entry distance or Infinity.
export function raySphere(o, d, c, r) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const disc = b * b - (ox * ox + oy * oy + oz * oz - r * r);
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 1e-6 ? t : Infinity;
}

// Ray against a capsule (segment a-b, radius r): entry distance or Infinity.
const tmp = [0, 0, 0];
export function rayCapsule(o, d, a, b, r) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const wx = a[0] - o[0], wy = a[1] - o[1], wz = a[2] - o[2];
  const aa = ux * ux + uy * uy + uz * uz, bb = ux * d[0] + uy * d[1] + uz * d[2];
  const dd = ux * wx + uy * wy + uz * wz, ee = d[0] * wx + d[1] * wy + d[2] * wz;
  const den = aa - bb * bb;
  let s = den > 1e-12 ? (bb * ee - dd) / den : 0;
  s = Math.max(0, Math.min(1, s));
  tmp[0] = a[0] + ux * s; tmp[1] = a[1] + uy * s; tmp[2] = a[2] + uz * s;
  // The closest point on the segment; refine once against the ray's closest approach.
  let t = raySphere(o, d, tmp, r);
  if (t === Infinity) return Infinity;
  const px = o[0] + d[0] * t, py = o[1] + d[1] * t, pz = o[2] + d[2] * t;
  let s2 = aa > 1e-12 ? ((px - a[0]) * ux + (py - a[1]) * uy + (pz - a[2]) * uz) / aa : 0;
  s2 = Math.max(0, Math.min(1, s2));
  tmp[0] = a[0] + ux * s2; tmp[1] = a[1] + uy * s2; tmp[2] = a[2] + uz * s2;
  const t2 = raySphere(o, d, tmp, r);
  return Math.min(t, t2);
}

// Push a circle (x, z, radius r) out of a box (in the xz plane). Returns true if it moved.
export function pushCircleBox(p, r, b) {
  const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
  const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-12) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; return true; }
  const opts = [[p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0], [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1]];
  let best = opts[0];
  for (const q of opts) if (q[0] < best[0]) best = q;
  if (best[1]) p.x = best[1] < 0 ? b.minX - r : b.maxX + r; else p.z = best[2] < 0 ? b.minZ - r : b.maxZ + r;
  return true;
}

// Does a circle at (x, z) overlap the box (xz)?
export function circleHitsBox(x, z, r, b) {
  const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

// Segment a-b (xz) against a box grown by r: true if it crosses.
export function segHitsBox(ax, az, bx, bz, b, r = 0) {
  let t0 = 0, t1 = 1;
  for (const [o, d, lo, hi] of [[ax, bx - ax, b.minX - r, b.maxX + r], [az, bz - az, b.minZ - r, b.maxZ + r]]) {
    if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return false; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export const DEG = Math.PI / 180;
export const wrap180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;
// Unit direction from yaw (0 = -z, + right) and pitch (deg, + up).
export function dirFrom(yaw, pitch, out = [0, 0, 0]) {
  const y = yaw * DEG, p = pitch * DEG, cp = Math.cos(p);
  out[0] = Math.sin(y) * cp; out[1] = Math.sin(p); out[2] = -Math.cos(y) * cp;
  return out;
}
export function yawTo(dx, dz) { return Math.atan2(dx, -dz) / DEG; }
