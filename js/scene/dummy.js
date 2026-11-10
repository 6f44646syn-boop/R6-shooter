// Training dummy: a standing figure built from one sphere (head) and capsules (everything else).
// The same part list draws the mesh, decides hits and outlines the magazine plot, so what you
// see is exactly what counts.
//
// Coordinates: metres in the target group's frame. x right, y up from the floor, z towards the
// player. The head centre is at eye height (1.6 m), so a level aim is a head-height aim.
import * as THREE from '../../vendor/three/three.module.min.js?v=m4-m8-audio-1';

export const DUMMY_HEAD_Y = 1.6;

// t: 'sphere' (c, r) or 'capsule' (a, b, r). zone: head | body | limb.
const L = -1, R = 1;
const limb = (sx, a, b, r, zone = 'limb') => ({ t: 'capsule', a: [sx * a[0], a[1], a[2] || 0], b: [sx * b[0], b[1], b[2] || 0], r, zone });
export const DUMMY_PARTS = [
  { t: 'sphere', c: [0, 1.6, 0], r: 0.105, zone: 'head', color: 0xd9a441 },
  { t: 'capsule', a: [0, 1.44, 0], b: [0, 1.5, 0], r: 0.055, zone: 'head', color: 0x8c6a35 },
  { t: 'capsule', a: [-0.17, 1.37, 0], b: [0.17, 1.37, 0], r: 0.07, zone: 'body', color: 0xc99550 },
  { t: 'capsule', a: [0, 1.02, 0], b: [0, 1.3, 0], r: 0.16, zone: 'body', color: 0xcf9b56 },
  { t: 'capsule', a: [-0.09, 0.92, 0], b: [0.09, 0.92, 0], r: 0.11, zone: 'body', color: 0x8c6a35 },
  ...[L, R].flatMap((s) => [
    { ...limb(s, [0.25, 1.35], [0.28, 1.08], 0.052), color: 0xc99550 },   // upper arm
    { ...limb(s, [0.28, 1.06], [0.29, 0.8], 0.045), color: 0xb98745 },    // forearm
    { ...limb(s, [0.1, 0.88], [0.11, 0.48], 0.075), color: 0xc99550 },    // thigh
    { ...limb(s, [0.11, 0.46], [0.11, 0.1], 0.058), color: 0xb98745 },    // shin
  ]),
];

const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// One merged mesh with vertex colours (one draw call), plus a small base plate.
export function buildDummy() {
  const group = new THREE.Group();
  const geos = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const p of DUMMY_PARTS) {
    let g;
    if (p.t === 'sphere') {
      g = new THREE.SphereGeometry(p.r, 16, 12);
      g.translate(p.c[0], p.c[1], p.c[2]);
    } else {
      const a = v3(p.a), b = v3(p.b), dir = b.clone().sub(a), len = dir.length();
      g = new THREE.CapsuleGeometry(p.r, len, 4, 12);
      q.setFromUnitVectors(up, dir.normalize());
      m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
    }
    g = g.toNonIndexed();
    const c = new THREE.Color(p.color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    geos.push(g);
  }
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const body = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.32), new THREE.MeshLambertMaterial({ color: 0x2d3036 }));
  base.position.y = 0.02;
  group.add(body, base);
  return group;
}

// Ray against the dummy. o, d: ray origin and unit direction in the target frame (arrays).
// Writes { t, p: [x,y,z], n: [x,y,z], zone } into out and returns true on a hit.
// Capsules: hit if the ray passes within r of the segment; the hit point is where the ray
// meets the sphere of radius r around the closest segment point (exact for the round caps,
// within millimetres on the sides).
export function raycastDummy(o, d, out) {
  let best = Infinity;
  for (const p of DUMMY_PARTS) {
    let c;
    if (p.t === 'sphere') c = p.c;
    else c = closestOnSegmentToRay(p.a, p.b, o, d);
    // ray-sphere
    const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
    const bq = ox * d[0] + oy * d[1] + oz * d[2];
    const cq = ox * ox + oy * oy + oz * oz - p.r * p.r;
    const disc = bq * bq - cq;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t <= 0 || t >= best) continue;
    best = t;
    const hx = o[0] + d[0] * t, hy = o[1] + d[1] * t, hz = o[2] + d[2] * t;
    const nx = hx - c[0], ny = hy - c[1], nz = hz - c[2], nl = Math.hypot(nx, ny, nz) || 1;
    out.t = t; out.zone = p.zone;
    out.p[0] = hx; out.p[1] = hy; out.p[2] = hz;
    out.n[0] = nx / nl; out.n[1] = ny / nl; out.n[2] = nz / nl;
  }
  return best < Infinity;
}

// Point on segment ab closest to the ray o + t d (t >= 0). Allocates nothing on the hot path
// except the returned 3-array, reused per call.
const tmp = [0, 0, 0];
function closestOnSegmentToRay(a, b, o, d) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const wx = a[0] - o[0], wy = a[1] - o[1], wz = a[2] - o[2];
  const aa = ux * ux + uy * uy + uz * uz;
  const bb = ux * d[0] + uy * d[1] + uz * d[2];
  const cc = 1; // |d| = 1
  const dd = ux * wx + uy * wy + uz * wz;
  const ee = d[0] * wx + d[1] * wy + d[2] * wz;
  const den = aa * cc - bb * bb;
  let s = den > 1e-12 ? (bb * ee - cc * dd) / den : 0;
  s = Math.max(0, Math.min(1, s));
  tmp[0] = a[0] + ux * s; tmp[1] = a[1] + uy * s; tmp[2] = a[2] + uz * s;
  return tmp;
}

// Front outline for the 2D plot: draws every part as seen from the player, in plot space.
// X, Y map metres (relative to the head centre) to pixels; s is pixels per metre.
export function drawDummyOutline(g, X, Y, s) {
  for (const p of DUMMY_PARTS) {
    g.beginPath();
    if (p.t === 'sphere') {
      g.arc(X(p.c[0]), Y(p.c[1] - DUMMY_HEAD_Y), p.r * s, 0, Math.PI * 2);
    } else {
      const ax = X(p.a[0]), ay = Y(p.a[1] - DUMMY_HEAD_Y), bx = X(p.b[0]), by = Y(p.b[1] - DUMMY_HEAD_Y);
      g.lineCap = 'round';
      g.lineWidth = 2 * p.r * s;
      g.moveTo(ax, ay); g.lineTo(bx, by);
      g.strokeStyle = 'rgba(120,150,190,0.18)';
      g.stroke();
      continue;
    }
    g.fillStyle = 'rgba(120,150,190,0.18)';
    g.fill();
  }
  g.lineWidth = 1;
  g.lineCap = 'butt';
}
