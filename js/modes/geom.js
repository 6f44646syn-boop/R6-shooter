// Geometry for the match modes (no three.js, no DOM: runs in the browser and in Node).
// Rays: origin o [x, y, z], unit direction d. Box tests, collision and line of sight are in
// the Rust core (rust/core/src/geom.rs, world.rs); what is left here is hit zones on bodies
// and angle helpers.

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

export const DEG = Math.PI / 180;
export const wrap180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;
// Unit direction from yaw (0 = -z, + right) and pitch (deg, + up).
export function dirFrom(yaw, pitch, out = [0, 0, 0]) {
  const y = yaw * DEG, p = pitch * DEG, cp = Math.cos(p);
  out[0] = Math.sin(y) * cp; out[1] = Math.sin(p); out[2] = -Math.cos(y) * cp;
  return out;
}
export function yawTo(dx, dz) { return Math.atan2(dx, -dz) / DEG; }
