// Modelling kit for the Enhanced Graphics pack's guns (run offline by tools/build-hd.mjs).
// Parts are built from bevelled side profiles, cross-sections and lathed profiles, so edges
// are rounded and catch light, and holes (ports, slots, cut-outs) are real openings.
//
// Gun coordinates (the same as js/scene/viewmodel.js): -z forward (muzzle), y up, x right,
// origin at the receiver centre, metres. Side profiles are given as [z, y] points.
import * as THREE from '../../vendor/three/three.module.min.js';

// Detail level, set per LOD by the builder: curve segments per arc, bevel segments.
export const Q = { curve: 10, bevelSeg: 3, round: 20 };
export function setDetail(lod) {
  if (lod === 0) Object.assign(Q, { curve: 10, bevelSeg: 3, round: 22 });
  else Object.assign(Q, { curve: 4, bevelSeg: 1, round: 10 });
}

// Material roles (what the runtime gives each part):
//   finish  the gun's coated body: wears the skin
//   polymer black plastic (grips, stocks, magazines unless skinned)
//   steel   bare or parkerised steel (barrels, pins, levers)
//   dark    deep openings and the inside of ports
//   rubber  butt pads, grip panels
//   shell   polymer furniture (stocks, grips, handguards, magazine bodies): black, or the
//           skin when one is equipped, so a skin wraps the whole gun
export const ROLES = ['finish', 'polymer', 'steel', 'dark', 'rubber', 'shell'];
export const GROUPS = ['gun', 'mag', 'bolt'];

export class Model {
  constructor(name) { this.name = name; this.parts = []; this.group = 'gun'; }
  add(geo, role, group = this.group) {
    if (!ROLES.includes(role)) throw new Error('role ' + role);
    this.parts.push({ geo, role, group });
    return geo;
  }
  // Everything added inside fn goes to that group (magazine, bolt).
  in(group, fn) { const g = this.group; this.group = group; try { fn(); } finally { this.group = g; } }
}

/* ---------- shapes ---------- */
// pts: [[z, y] | [z, y, r]] with an optional corner radius (rounded with a quadratic curve).
function outline(path, pts) {
  const P = pts.map((p) => [-p[0], p[1], p[2] || 0]);
  const n = P.length;
  const corner = (i) => {
    const [x, y, r] = P[i];
    if (!r) return { a: [x, y], b: [x, y], c: null };
    const pv = P[(i + n - 1) % n], nx = P[(i + 1) % n];
    const d1 = [pv[0] - x, pv[1] - y], d2 = [nx[0] - x, nx[1] - y];
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const k = Math.min(r, l1 * 0.48, l2 * 0.48);
    return { a: [x + d1[0] / l1 * k, y + d1[1] / l1 * k], b: [x + d2[0] / l2 * k, y + d2[1] / l2 * k], c: [x, y] };
  };
  const C = P.map((_, i) => corner(i));
  path.moveTo(C[0].b[0], C[0].b[1]);
  for (let i = 1; i <= n; i++) {
    const c = C[i % n];
    path.lineTo(c.a[0], c.a[1]);
    if (c.c) path.quadraticCurveTo(c.c[0], c.c[1], c.b[0], c.b[1]);
  }
  return path;
}
export function shape(pts, holes = []) {
  const s = outline(new THREE.Shape(), pts);
  for (const h of holes) s.holes.push(h instanceof THREE.Path ? h : outline(new THREE.Path(), h));
  return s;
}
// Holes and outlines from primitives ([z, y] centre).
export function rect(z, y, l, h, r = 0) {
  const a = z - l / 2, b = z + l / 2, c = y - h / 2, d = y + h / 2;
  return [[a, c, r], [a, d, r], [b, d, r], [b, c, r]];
}
export function slot(z, y, l, h) { return rect(z, y, l, h, Math.min(l, h) / 2); }
export function circle(z, y, r, seg = Q.curve * 2) {
  const p = new THREE.Path();
  p.absarc(-z, y, r, 0, Math.PI * 2, true);
  return p;
}
// A polyline along a quadratic/cubic curve (for curved magazines and grips): samples [z, y].
export function bez(p0, p1, p2, p3, n = 12) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    if (p3) out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    else out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}

/* ---------- solids ---------- */
const M_SIDE = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);   // shape (-z, y) extruded along x
function extrude(sh, w, bevel) {
  const b = Math.max(0, Math.min(bevel, w * 0.45));
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(1e-5, w - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b,
    bevelSegments: b > 0 ? Q.bevelSeg : 0, curveSegments: Q.curve, steps: 1,
  });
  g.deleteAttribute('uv');
  return { g, b };
}
// Side profile (pts as [z, y], or a THREE.Shape) extruded across x from x0 to x1.
export function side(m, role, pts, x0, x1, { bevel = 0.0012, holes = [] } = {}) {
  const sh = pts instanceof THREE.Shape ? pts : shape(pts, holes);
  const { g, b } = extrude(sh, x1 - x0, bevel);
  g.translate(0, 0, b + x0);
  g.applyMatrix4(M_SIDE);
  return m.add(g, role);
}
// The same profile centred on x = 0 with width w.
export function sideC(m, role, pts, w, o) { return side(m, role, pts, -w / 2, w / 2, o); }
// Cross-section (pts as [x, y]) extruded along z from z0 to z1.
export function section(m, role, pts, z0, z1, { bevel = 0.001, holes = [] } = {}) {
  const s = new THREE.Shape();
  const P = pts.map((p) => [p[0], p[1], p[2] || 0]);
  // outline() mirrors z; cross-sections are in (x, y), so build the shape directly.
  outline(s, P.map((p) => [-p[0], p[1], p[2]]));
  for (const h of holes) s.holes.push(outline(new THREE.Path(), h.map((p) => [-p[0], p[1], p[2] || 0])));
  const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
  const { g, b } = extrude(s, hi - lo, bevel);
  g.translate(0, 0, b + lo);
  return m.add(g, role);
}
// Lathed profile [[r, z], ...] around an axis parallel to z through (x, y) (axis 'z'),
// or parallel to x ('x') / y ('y') through the given point.
export function lathe(m, role, prof, { x = 0, y = 0, z = 0, axis = 'z', seg = Q.round, phi = 0 } = {}) {
  const pts = prof.map(([r, t]) => new THREE.Vector2(Math.max(r, 0), t));
  const g = new THREE.LatheGeometry(pts, seg, phi, Math.PI * 2);
  g.deleteAttribute('uv');
  // Lathe axis is +y: map it to the wanted axis (rotations keep the winding).
  if (axis === 'z') g.rotateX(-Math.PI / 2);          // y -> -z: profile t grows forward
  else if (axis === 'x') g.rotateZ(-Math.PI / 2);
  g.translate(x, y, z);
  return m.add(g, role);
}
// A plain cylinder along z from z0 to z1 with rounded ends.
export function rod(m, role, r, z0, z1, { x = 0, y = 0, chamfer = 0.0006, seg = Q.round } = {}) {
  const a = Math.min(z0, z1), b = Math.max(z0, z1), c = Math.min(chamfer, r * 0.4, (b - a) * 0.3);
  // Profile t runs forward (-z): t = -z.
  return lathe(m, role, [[0, -b], [r - c, -b], [r, -b + c], [r, -a - c], [r - c, -a], [0, -a]], { x, y, seg });
}
// Rod along x or y (pins, posts).
export function pin(m, role, r, len, x, y, z, axis = 'x', seg = 12) {
  const c = Math.min(r * 0.35, len * 0.25);
  return lathe(m, role, [[0, -len / 2], [r - c, -len / 2], [r, -len / 2 + c], [r, len / 2 - c], [r - c, len / 2], [0, len / 2]], { x, y, z, axis, seg });
}
// Rounded box: a rounded side profile with bevelled x faces.
export function rbox(m, role, w, h, d, x, y, z, { r = 0.002, bevel = 0.0012, rx = 0 } = {}) {
  const g = side(m, role, rect(0, 0, d, h, r), -w / 2, w / 2, { bevel });
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

/* ---------- assemblies ---------- */
// Picatinny-style rail from z = from (rear) to to (front), sitting on y: a dovetail base and
// chamfered cross-teeth every 10 mm. Top of the teeth at y + 0.0105.
export function rail(m, y, from, to, { w = 0.0212, role = 'polymer' } = {}) {
  const hw = w / 2;
  section(m, role, [[-hw + 0.0025, y], [hw - 0.0025, y], [hw, y + 0.0028], [hw - 0.0018, y + 0.0045], [-hw + 0.0018, y + 0.0045], [-hw, y + 0.0028]], to, from, { bevel: 0.0004 });
  for (let z = from - 0.0045; z > to + 0.004; z -= 0.01) {
    section(m, role, [[-hw + 0.0012, y + 0.0042], [hw - 0.0012, y + 0.0042], [hw - 0.0012, y + 0.0085], [hw - 0.0032, y + 0.0105], [-hw + 0.0032, y + 0.0105], [-hw + 0.0012, y + 0.0085]],
      z - 0.0052, z, { bevel: 0.0005 });
  }
}
// Socket-head screw facing along x (sx = +1 right side, -1 left) at (y, z), head radius r.
export function screw(m, sx, xFace, y, z, r = 0.0022) {
  const h = r * 0.6;
  // Head standing out of the face (t = distance out), with a hex-ish socket in the top.
  const prof = [[0, -0.0004], [r, -0.0004], [r, h * 0.7], [r * 0.85, h], [r * 0.45, h], [r * 0.45, h * 0.45], [0, h * 0.45]];
  const g = lathe(m, 'steel', prof, { axis: 'x', seg: 12 });
  if (sx < 0) { g.scale(-1, 1, 1); flip(g); }
  g.translate(xFace, y, z);
  return g;
}
// Reverse triangle winding (after a mirror).
export function flip(g) {
  if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.index.needsUpdate = true; return g; }
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
  g.attributes.position.needsUpdate = true;
  return g;
}
// A copy mirrored to the other side (x -> -x).
export function mirror(m, g, role) { const c = g.clone().scale(-1, 1, 1); flip(c); return m.add(c, role); }
// Apply to every part added inside fn: a matrix (rotations about a pivot, etc.).
export function xform(m, fn, mat) {
  const n = m.parts.length;
  fn();
  for (let i = n; i < m.parts.length; i++) m.parts[i].geo.applyMatrix4(mat);
}
export function rotX(a, y = 0, z = 0) {
  return new THREE.Matrix4().makeTranslation(0, y, z).multiply(new THREE.Matrix4().makeRotationX(a)).multiply(new THREE.Matrix4().makeTranslation(0, -y, -z));
}
export function move(x, y, z) { return new THREE.Matrix4().makeTranslation(x, y, z); }

// Trigger guard, trigger blade and selector for a receiver whose underside is at yb, trigger
// at z = tz, half width hw.
export function triggerGroup(m, yb, tz, hw, { guard = true } = {}) {
  if (guard) {
    const outer = [[tz + 0.03, yb + 0.002], [tz + 0.03, yb - 0.026, 0.008], [tz - 0.042, yb - 0.026, 0.01], [tz - 0.048, yb + 0.002]];
    const inner = [[tz + 0.024, yb + 0.004], [tz + 0.024, yb - 0.021, 0.006], [tz - 0.038, yb - 0.021, 0.008], [tz - 0.041, yb + 0.004]];
    sideC(m, 'polymer', outer, 0.007, { holes: [inner], bevel: 0.0012 });
  }
  // Curved blade.
  const blade = [[tz - 0.002, yb + 0.002], ...bez([tz - 0.002, yb - 0.004], [tz - 0.006, yb - 0.012], [tz + 0.002, yb - 0.02], null, 6), [tz + 0.0055, yb - 0.0195], ...bez([tz + 0.005, yb - 0.017], [tz - 0.001, yb - 0.011], [tz + 0.004, yb - 0.003], null, 6).slice(1), [tz + 0.004, yb + 0.002]];
  sideC(m, 'steel', blade, 0.004, { bevel: 0.0008 });
  // Selector lever on the left above the grip.
  const lev = side(m, 'steel', [[0, 0.0022, 0.0015], [0, -0.0022, 0.0015], [-0.016, -0.0016, 0.0012], [-0.016, 0.0016, 0.0012]], 0, 0.0025, { bevel: 0.0006 });
  lev.rotateX(0.5).translate(-hw - 0.0028, yb + 0.012, tz + 0.03);
  pin(m, 'steel', 0.0038, 0.003, -hw - 0.0012, yb + 0.012, tz + 0.03, 'x', 14);
}
// Pistol grip: angled, finger grooves on the front, a beavertail at the top. Top front at
// (z, y), length down the grip len, rake angle a (radians, bottom further back).
export function grip(m, z, y, { len = 0.105, depth = 0.044, w = 0.032, a = 0.28, role = 'shell', grooves = true } = {}) {
  const front = grooves
    ? [[0, 0], ...bez([0, -0.012], [-0.006, -0.03], [0.004, -0.04], null, 5), ...bez([0.002, -0.045], [-0.005, -0.06], [0.003, -0.07], null, 5), [0, -len + 0.01]]
    : [[0, 0], [0, -len + 0.01]];
  const pts = [...front, [0.004, -len, 0.006], [depth + 0.004, -len, 0.006], [depth, -len + 0.012], ...bez([depth - 0.004, -0.03], [depth - 0.001, -0.012], [depth + 0.008, 0.004], null, 6), [depth + 0.006, 0.008, 0.004], [0.002, 0.008]];
  const g = sideC(m, role, pts.map(([zz, yy]) => [zz, yy]), w, { bevel: Math.min(0.006, w * 0.22) });
  // Raked back: the bottom is further back than the top.
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(-a));
  g.translate(0, y, z);
  const cap = rbox(m, 'polymer', w + 0.002, 0.006, depth + 0.006, 0, -len + 0.002, depth / 2 + 0.002, { r: 0.002 });
  cap.applyMatrix4(new THREE.Matrix4().makeRotationX(-a)); cap.translate(0, y, z);
  return g;
}
// Stick magazine: straight or curved (bend > 0 curves forward towards the bottom), with side
// ribs, a feed lip and a base plate. Top at (z, y) with the top face length d.
export function magazine(m, z, y, { h = 0.13, d = 0.05, w = 0.028, bend = 0, rake = 0, role = 'shell', ribs = 3, window = false } = {}) {
  m.in('mag', () => {
    const N = 10;
    const back = [], front = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, yy = -h * t, dz = -bend * t * t * h;      // forward (-z) as it goes down
      back.push([z + d / 2 + dz, y + yy]); front.push([z - d / 2 + dz * 1.15, y + yy]);
    }
    const pts = [...front, ...back.reverse()];
    pts[N][2] = 0.003; pts[N + 1][2] = 0.003;
    const body = sideC(m, role, pts, w, { bevel: 0.0022 });
    // Ribs down both sides.
    for (let r = 0; r < ribs; r++) {
      const off = d * (0.18 + 0.64 * (r + 0.5) / ribs) - d / 2;
      const rib = [];
      for (let i = 1; i <= N - 1; i++) { const t = i / N; rib.push([z + off - bend * t * t * h * 1.07, y - h * t]); }
      const strip = [...rib.map(([a, b]) => [a - 0.0022, b]), ...rib.slice().reverse().map(([a, b]) => [a + 0.0022, b])];
      side(m, role, strip, w / 2 - 0.0012, w / 2 + 0.0012, { bevel: 0.0006 });
      side(m, role, strip, -w / 2 - 0.0012, -w / 2 + 0.0012, { bevel: 0.0006 });
    }
    // Base plate.
    const bz = z - bend * h * 1.07, by = y - h;
    const plate = rbox(m, 'polymer', w + 0.005, 0.008, d * 1.05 + 0.006, 0, 0, 0, { r: 0.0025, bevel: 0.0015 });
    plate.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.atan2(bend * 2 * h, h) * 0.9)); plate.translate(0, by - 0.002, bz);
    // Brass showing at the top.
    rod(m, 'steel', 0.0048, z + d / 2 - 0.004, z - d / 2 + 0.006, { y: y + 0.003, x: 0.002 });
    if (window) for (let i = 0; i < 4; i++) rbox(m, 'dark', 0.003, 0.012, 0.006, w / 2 - 0.0005, y - 0.02 - i * 0.022, z + d * 0.3, { r: 0.002, bevel: 0.0005 });
    if (rake) for (const p of m.parts.filter((q) => q.group === 'mag' && !q.raked)) { p.geo.applyMatrix4(rotX(rake, y, z)); p.raked = true; }
  });
}
// Barrel with a step-down profile from z0 (chamber end) to z1 (muzzle), radius r.
export function barrel(m, y, z0, z1, r, { steps = 2, role = 'steel', x = 0 } = {}) {
  const L = z0 - z1, prof = [[0, -z0]];
  prof.push([r * 1.25, -z0], [r * 1.25, -z0 + L * 0.12]);
  for (let i = 0; i < steps; i++) { const t = 0.12 + (i + 1) * 0.25; prof.push([r * (1.18 - i * 0.09), -z0 + L * (t - 0.02)], [r * (1.1 - i * 0.1), -z0 + L * t]); }
  prof.push([r, -z1 - 0.002], [r * 0.85, -z1], [r * 0.45, -z1], [r * 0.45, -z1 - 0.001]);
  return lathe(m, role, prof, { x, y });
}
// Muzzle brake / compensator at the end of a barrel (front at zf, length len, radius r):
// a body with three pairs of side ports (real openings in a side-profile extrusion).
export function brake(m, y, zf, len, r, { ports = 3, role = 'steel' } = {}) {
  const zb = zf + len, h = r * 1.7;
  const holes = [];
  for (let i = 0; i < ports; i++) holes.push(slot(zf + len * (0.22 + i * 0.25), y, len * 0.13, h * 0.62));
  // Side walls with ports, and a top and bottom strap: reads as a slotted brake.
  side(m, role, rect((zf + zb) / 2, y, len, h * 1.04, 0.0015), r * 0.55, r * 1.02, { holes, bevel: 0.0006 });
  side(m, role, rect((zf + zb) / 2, y, len, h * 1.04, 0.0015), -r * 1.02, -r * 0.55, { holes, bevel: 0.0006 });
  section(m, role, [[-r * 0.6, y + h * 0.28], [r * 0.6, y + h * 0.28], [r * 0.55, y + h * 0.52, 0.002], [-r * 0.55, y + h * 0.52, 0.002]], zf, zb, { bevel: 0.0006 });
  section(m, role, [[-r * 0.6, y - h * 0.52, 0.002], [r * 0.6, y - h * 0.52, 0.002], [r * 0.55, y - h * 0.28], [-r * 0.55, y - h * 0.28]], zf, zb, { bevel: 0.0006 });
  lathe(m, 'dark', [[0, -zb + 0.003], [r * 0.5, -zb + 0.003], [r * 0.5, -zf - 0.0005], [0, -zf - 0.0005]], { y, seg: 12 });
  // Front ring with the bore.
  const tb = -zf - 0.006, tf = -zf;
  lathe(m, role, [[r * 0.42, tb], [r * 0.95, tb], [r, tb + 0.0015], [r, tf - 0.0015], [r * 0.95, tf], [r * 0.42, tf], [r * 0.42, tb]], { y });
}
// Flash hider: a tube with open prongs (slots cut by side extrusions in four directions).
export function flashHider(m, y, zf, len, r, role = 'steel') {
  lathe(m, role, [[r * 0.6, -zf - len], [r * 0.96, -zf - len], [r, -zf - len + 0.002], [r, -zf - len * 0.6], [r * 1.05, -zf - len * 0.55], [r * 1.05, -zf - 0.001], [r * 0.95, -zf], [r * 0.72, -zf], [r * 0.72, -zf - len * 0.5], [r * 0.6, -zf - len * 0.5], [r * 0.6, -zf - len]], { y });
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const g = rbox(m, 'dark', 0.0012, r * 0.55, len * 0.42, 0, 0, 0, { r: 0.0012, bevel: 0.0003 });
    g.translate(0, r * 0.9, zf + len * 0.22).applyMatrix4(new THREE.Matrix4().makeTranslation(0, y, 0).multiply(new THREE.Matrix4().makeRotationZ(a)).multiply(new THREE.Matrix4().makeTranslation(0, -y, 0)));
    g.translate(0, 0, 0);
  }
}
// Ejection port: a recessed dark opening in the right side of the receiver with a raised
// frame and a hinged dust cover above it. xr: right face of the receiver.
export function port(m, xr, y, z, l = 0.05, h = 0.018, { cover = true } = {}) {
  side(m, 'finish', rect(z, y, l + 0.008, h + 0.008, 0.003), xr - 0.001, xr + 0.0012, { holes: [rect(z, y, l, h, 0.002)], bevel: 0.0005 });
  side(m, 'dark', rect(z, y, l + 0.001, h + 0.001), xr - 0.0035, xr - 0.0005, { bevel: 0 });
  if (cover) {
    side(m, 'steel', rect(z, y + h / 2 + 0.0055, l + 0.004, 0.006, 0.0015), xr, xr + 0.0016, { bevel: 0.0005 });
    rod(m, 'steel', 0.0012, z + l / 2 + 0.006, z - l / 2 - 0.006, { x: xr + 0.0012, y: y + h / 2 + 0.0085, seg: 8 });
  }
}
// Ventilated handguard plate pattern: slots along a side, returns hole list for side().
export function slots(from, to, y, n, l, h) {
  const out = [], step = (from - to) / n;
  for (let i = 0; i < n; i++) out.push(slot(from - step * (i + 0.5), y, l, h));
  return out;
}
// Sling swivel loop at (x, y, z) on the side.
export function swivel(m, x, y, z, r = 0.007) {
  const g = new THREE.TorusGeometry(r, 0.0016, 8, Q.round);
  g.deleteAttribute('uv');
  g.rotateY(Math.PI / 2).translate(x, y, z);
  return m.add(g, 'steel');
}
