import { packArt } from '../render/pack-art.js?v=d8fe671-mwd9takn';
// The battle soldier: a helmeted figure in a plate carrier holding a rifle at the ready.
// Hits are decided on simple shapes (a sphere head and capsules: SOLDIER_PARTS) laid out in
// the same pose as the model, so what you see is what can be hit. The gear (helmet, vest,
// pouches, pack, boots) sits snugly over those shapes.
//
// Coordinates: metres, the soldier's own frame: x right, y up from the feet, z forward.
import * as THREE from '../../vendor/three/three.module.min.js?v=d8fe671-mwd9takn';
import { HDPack } from '../render/hd-pack.js?v=d8fe671-mwd9takn';
import { sightShading } from '../scene/sight-model.js?v=d8fe671-mwd9takn';

const L = -1, R = 1;
const cap = (a, b, r, zone) => ({ t: 'capsule', a, b, r, zone });
export const SOLDIER_PARTS = [
  { t: 'sphere', c: [0, 1.62, 0.02], r: 0.125, zone: 'head' },
  cap([0, 1.45, 0], [0, 1.53, 0.01], 0.06, 'head'),
  cap([-0.19, 1.38, 0], [0.19, 1.38, 0], 0.085, 'body'),
  cap([0, 1.03, 0], [0, 1.3, 0], 0.18, 'body'),
  cap([-0.1, 0.93, 0], [0.1, 0.93, 0], 0.12, 'body'),
  cap([0.22, 1.37, 0], [0.25, 1.13, 0.12], 0.058, 'limb'),     // right arm: on the grip
  cap([0.25, 1.13, 0.12], [0.09, 1.19, 0.33], 0.05, 'limb'),
  cap([-0.22, 1.37, 0], [-0.21, 1.17, 0.18], 0.058, 'limb'),   // left arm: under the handguard
  cap([-0.21, 1.17, 0.18], [0.0, 1.23, 0.5], 0.05, 'limb'),
  ...[L, R].flatMap((s) => [
    cap([s * 0.1, 0.88, 0], [s * 0.11, 0.48, 0.03], 0.085, 'limb'),
    cap([s * 0.11, 0.46, 0.03], [s * 0.11, 0.1, 0], 0.065, 'limb'),
  ]),
];
// Where the right hand holds the grip (the gun is placed from here).
export const GRIP_HAND = [0.08, 1.19, 0.34];

// Ray against the parts. o, d: origin and unit direction in the soldier frame (arrays).
// Writes { t, p, n, zone } into out and returns true on a hit.
const tmp = [0, 0, 0];
function closestOnSegmentToRay(a, b, o, d) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const wx = a[0] - o[0], wy = a[1] - o[1], wz = a[2] - o[2];
  const aa = ux * ux + uy * uy + uz * uz, bb = ux * d[0] + uy * d[1] + uz * d[2];
  const dd = ux * wx + uy * wy + uz * wz, ee = d[0] * wx + d[1] * wy + d[2] * wz;
  const den = aa - bb * bb;
  let s = den > 1e-12 ? (bb * ee - dd) / den : 0;
  s = Math.max(0, Math.min(1, s));
  tmp[0] = a[0] + ux * s; tmp[1] = a[1] + uy * s; tmp[2] = a[2] + uz * s;
  return tmp;
}
export function raycastSoldier(o, d, out) {
  let best = Infinity;
  for (const p of SOLDIER_PARTS) {
    const c = p.t === 'sphere' ? p.c : closestOnSegmentToRay(p.a, p.b, o, d);
    const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
    const bq = ox * d[0] + oy * d[1] + oz * d[2];
    const disc = bq * bq - (ox * ox + oy * oy + oz * oz - p.r * p.r);
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

/* ---------- the model: one mesh with vertex colours (one draw call) ---------- */
const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
function colored(g, color) {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function capsuleGeo(a, b, r, seg = 10) {
  const A = v3(a), B = v3(b), dir = B.clone().sub(A), len = dir.length();
  const g = new THREE.CapsuleGeometry(r, len, 3, seg);
  const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()), new THREE.Vector3(1, 1, 1));
  return g.applyMatrix4(m);
}
function boxAt(w, h, d, x, y, z, rx = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1)));
  return g;
}

const cache = new Map();
// team: the team colour (hex). Returns { upper, legL, legR } geometries with colours (legs
// with the hip at their origin).
export function soldierGeometry(team, enhanced) {
  // High / Ultra with the Enhanced Graphics pack: its detailed soldier (Claude; same pose and
  // hit shapes). Without it, the simple soldier, with the pack's equipment overlay (Codex).
  // (enhanced: the caller's quality when it knows it; otherwise the current gun shading)
  const hd = (enhanced === undefined ? sightShading() === 'high' || sightShading() === 'ultra' : !!enhanced) && HDPack.loadedGun('soldier');
  const key = team + ':' + (hd ? 'hd' + packArt.revision : enhanced && packArt.soldier ? packArt.revision : 0);
  if (cache.has(key)) return cache.get(key);
  const tc = new THREE.Color(team);
  const mix = (c, k, grey = 0x3a3d3a) => '#' + new THREE.Color(grey).lerp(tc, k).multiplyScalar(c).getHexString();
  const cloth = mix(0.85, 0.42), clothDark = mix(0.6, 0.35), patch = '#' + tc.clone().multiplyScalar(1.1).getHexString();
  const VEST = 0x2b302b, GEAR = 0x4a4636, BLACK = 0x161718, SKIN = 0xc89a78, HELMET = 0x343a34;
  if (hd) {
    const cols = { cloth, clothDark, patch, vest: VEST, gear: GEAR, black: BLACK, skin: SKIN, helmet: HELMET };
    const out = hdSoldier(hd, cols);
    // pack v5: the far level of detail, for players more than ~16 m away
    if (hd.lods.length > 1) out.far = hdSoldier(hd, cols, 1);
    cache.set(key, out);
    return out;
  }
  const parts = [];
  const add = (g, c) => parts.push(colored(g, c));
  // head, face, helmet (with a team band), goggles, ears/headset
  add(new THREE.SphereGeometry(0.108, 14, 10).translate(0, 1.6, 0.02), SKIN);
  add(new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(0, 1.63, 0.0), HELMET);
  add(new THREE.CylinderGeometry(0.131, 0.131, 0.03, 16, 1, true).translate(0, 1.645, 0), patch);
  add(boxAt(0.17, 0.05, 0.05, 0, 1.615, 0.115), BLACK);
  for (const s of [L, R]) add(boxAt(0.04, 0.08, 0.07, s * 0.115, 1.585, 0.0), BLACK);
  add(boxAt(0.12, 0.05, 0.05, 0, 1.53, 0.07), clothDark);                       // collar
  // body: under-layer, plate carrier, pouches, belt, pack, shoulder patches
  add(capsuleGeo([0, 1.03, 0], [0, 1.3, 0], 0.17, 12), cloth);
  add(capsuleGeo([-0.19, 1.38, 0], [0.19, 1.38, 0], 0.08), cloth);
  add(boxAt(0.4, 0.4, 0.31, 0, 1.2, 0.0), VEST);
  for (const x of [-0.12, 0, 0.12]) add(boxAt(0.1, 0.13, 0.07, x, 1.07, 0.18), GEAR);
  add(boxAt(0.3, 0.08, 0.05, 0, 1.3, 0.165), GEAR);
  add(boxAt(0.42, 0.07, 0.3, 0, 0.96, 0), BLACK);
  add(boxAt(0.3, 0.38, 0.15, 0, 1.2, -0.22), GEAR);
  add(boxAt(0.26, 0.08, 0.13, 0, 1.43, -0.22), VEST);
  for (const s of [L, R]) add(boxAt(0.02, 0.07, 0.07, s * 0.29, 1.3, 0.03, 0, 0), patch);
  add(capsuleGeo([-0.1, 0.93, 0], [0.1, 0.93, 0], 0.12), clothDark);
  // arms holding the rifle, gloves
  const arms = SOLDIER_PARTS.filter((p) => p.zone === 'limb' && p.a[1] > 1);
  for (const p of arms) add(capsuleGeo(p.a, p.b, p.r * 0.97), cloth);
  add(new THREE.SphereGeometry(0.055, 10, 8).translate(...GRIP_HAND), BLACK);
  add(new THREE.SphereGeometry(0.055, 10, 8).translate(0.0, 1.23, 0.5), BLACK);
  // legs, knee pads, boots: one piece per leg, built around its hip so it can swing
  const legs = { [L]: [], [R]: [] };
  for (const s of [L, R]) {
    const hip = new THREE.Matrix4().makeTranslation(-s * HIP_X, -HIP_Y, 0);
    const leg = (g, c) => legs[s].push(colored(g.applyMatrix4(hip), c));
    leg(capsuleGeo([s * 0.1, 0.88, 0], [s * 0.11, 0.48, 0.03], 0.082), cloth);
    leg(capsuleGeo([s * 0.11, 0.46, 0.03], [s * 0.11, 0.12, 0], 0.063), cloth);
    leg(boxAt(0.11, 0.12, 0.05, s * 0.11, 0.47, 0.09), BLACK);
    leg(boxAt(0.12, 0.12, 0.27, s * 0.11, 0.06, 0.04), BLACK);
    leg(boxAt(0.05, 0.12, 0.09, s * 0.19, 0.78, 0.0), GEAR);                  // thigh pouch
  }
  if (enhanced && packArt.soldier) for (const p of packArt.soldier) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.position.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.normal.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(p.index.slice(), 1));
    add(g, { webbing: 0x454b3f, stitch: 0x74745d, gear: GEAR, black: BLACK, glass: 0x445b62 }[p.role] || GEAR);
  }
  const out = { upper: merge(parts), legL: merge(legs[L]), legR: merge(legs[R]) };
  for (const [old, g] of cache) if (old.startsWith(team + ':') && old !== key && !old.endsWith(':0')) {
    for (const geometry of [...Object.values(g), ...Object.values(g.far || {})]) if (geometry && geometry.isBufferGeometry) geometry.dispose(); cache.delete(old);
  }
  cache.set(key, out);
  return out;
}
// The pack's soldier: colours per part (team colours where the cloth is), with its baked
// ambient occlusion and cavity darkening multiplied in (the body material is plain
// vertex-coloured Lambert). Legs move to their hip hinge like the simple soldier's.
function hdSoldier(model, colors, lod = 0) {
  const C = {};
  for (const [k, v] of Object.entries(colors)) C[k] = new THREE.Color(v);
  const parts = { upper: [], legL: [], legR: [] };
  for (const p of model.lods[Math.min(lod, model.lods.length - 1)]) {
    const n = p.position.length / 3, col = new Float32Array(n * 3), c = C[p.role] || C.gear;
    for (let i = 0; i < n; i++) {
      const ao = p.detail[i * 4] / 255, edge = p.detail[i * 4 + 1] / 255, cav = p.detail[i * 4 + 2] / 255;
      const k = (0.3 + 0.7 * Math.pow(ao, 1.3)) * (1 - 0.35 * cav) * (1 + 0.12 * edge);
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.position.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.normal.slice(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(p.index, 1));
    const ng = g.toNonIndexed();
    if (p.group === 'legL') ng.translate(HIP_X, -HIP_Y, 0);
    if (p.group === 'legR') ng.translate(-HIP_X, -HIP_Y, 0);
    (parts[p.group] || parts.upper).push(ng);
  }
  return { upper: merge(parts.upper), legL: merge(parts.legL), legR: merge(parts.legR), hd: true };
}
// Where the legs hinge (soldier frame).
export const HIP_X = 0.1, HIP_Y = 0.9;
function merge(parts) {
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
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
  merged.computeBoundingSphere();
  return merged;
}
