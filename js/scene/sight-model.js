// Procedural 3D sight models built from data/optics.json (no images, no imported models).
//
// The weapon is drawn in its own small scene with a fixed-FOV camera (VM_FOV), like most
// shooters, so the sight keeps its size on screen while the world camera zooms. A sight's
// rear opening sits EYE_Z in front of that camera; its window (housing.w / housing.h, as
// fractions of screen height) is converted to metres so it covers the same share of the
// screen as the numbers in optics.json say.
//
// Local frame of a sight: origin at the centre of its rear opening, -z forward, y up.
import * as THREE from '../../vendor/three/three.module.min.js?v=9be6deb-mwdgwpqb';
import { matcap } from './matcap.js?v=9be6deb-mwdgwpqb';
import { gunMaps } from './range-tex.js?v=9be6deb-mwdgwpqb';

export const VM_FOV = 50;      // vertical FOV of the weapon camera, degrees
export const EYE_Z = 0.14;     // eye to rear of the sight, metres
// Height of the view at the rear of the sight: one "screen height" in metres there.
export const VIEW_H = 2 * EYE_Z * Math.tan((VM_FOV * Math.PI) / 360);

// Shared materials (one set per shading mode, reused by every sight).
//   fast:     MeshMatcapMaterial (one texture read per pixel). Default; much cheaper on
//             integrated graphics, which matters when the sight fills the screen while aiming.
//   detailed: MeshStandardMaterial, metalness 0.8, roughness 0.45, with an environment map.
//   high:     MeshStandardMaterial with procedural wear, roughness and normal maps, lit by the
//             range's sky (HIGH_ENV) so reflections match the world. Used by high graphics.
let SHADING = 'fast';
let HIGH_ENV = null;
export function setSightShading(mode) { SHADING = ['detailed', 'high', 'ultra'].includes(mode) ? mode : 'fast'; }
export function setHighEnv(env) { HIGH_ENV = env; }
export function highEnv() { return HIGH_ENV; }
// Textured physically based material for high graphics. kind: 'metal' | 'polymer'.
export function highMaterial(color, kind = 'metal', o = {}) {
  const t = gunMaps(kind);
  const metal = kind === 'metal';
  return new THREE.MeshStandardMaterial({
    color, map: t.map, roughnessMap: t.rough, metalnessMap: metal ? t.rough : null, normalMap: t.normal,
    normalScale: new THREE.Vector2(1, 1), roughness: metal ? 1 : 0.85, metalness: metal ? 1 : 0.05,
    envMap: HIGH_ENV, envMapIntensity: metal ? 1.1 : 0.6, ...o,
  });
}
export function sightShading() { return SHADING; }
const MATSETS = {};
export function sightMaterials(envMap) {
  if (MATSETS[SHADING]) return MATSETS[SHADING];
  if (SHADING === 'fast') {
    const mc = (color, kind) => new THREE.MeshMatcapMaterial({ color, matcap: matcap(kind) });
    MATSETS.fast = {
      metal: mc(0x5d636b, 'metal'), edge: mc(0x8a9099, 'metal'), inner: mc(0x1a1c1f, 'rubber'),
      rubber: mc(0x4a4c50, 'rubber'), screw: mc(0x9aa0a8, 'metal'), post: mc(0x3a3e44, 'metal'),
    };
    return MATSETS.fast;
  }
  if (SHADING === 'high' || SHADING === 'ultra') {
    if (MATSETS.high) return (MATSETS[SHADING] = MATSETS.high);
    MATSETS[SHADING] = MATSETS.high = {
      metal: highMaterial(0x3a3f46, 'metal'), edge: highMaterial(0x5a616b, 'metal'),
      inner: new THREE.MeshStandardMaterial({ color: 0x08090a, metalness: 0.2, roughness: 0.9 }),
      rubber: highMaterial(0x1a1b1d, 'polymer'), screw: highMaterial(0x8a9098, 'metal'), post: highMaterial(0x202328, 'metal'),
    };
    return MATSETS.high;
  }
  let MATS = null;
  const metal = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.8, roughness: 0.45, envMap, envMapIntensity: 1.6 });
  MATS = {
    metal,
    edge: new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.85, roughness: 0.3, envMap, envMapIntensity: 2.0 }),
    inner: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, metalness: 0.3, roughness: 0.8 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0, roughness: 0.92 }),
    screw: new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.9, roughness: 0.3, envMap }),
    post: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.6, roughness: 0.5, envMap }),
  };
  MATSETS.detailed = MATS;
  return MATS;
}

function roundRectPath(p, w, h, r, ccw = false) {
  const x = -w / 2, y = -h / 2;
  r = Math.max(0.0001, Math.min(r, w / 2 - 0.0001, h / 2 - 0.0001));
  if (!ccw) {
    p.moveTo(x + r, y);
    p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y);
  } else {
    p.moveTo(x + r, y);
    p.quadraticCurveTo(x, y, x, y + r); p.lineTo(x, y + h - r);
    p.quadraticCurveTo(x, y + h, x + r, y + h); p.lineTo(x + w - r, y + h);
    p.quadraticCurveTo(x + w, y + h, x + w, y + h - r); p.lineTo(x + w, y + r);
    p.quadraticCurveTo(x + w, y, x + w - r, y); p.lineTo(x + r, y);
  }
  return p;
}

function outline(shape, w, h, r) {
  const s = new THREE.Shape();
  if (shape === 'round') s.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
  else roundRectPath(s, w, h, r);
  return s;
}
function hole(shape, w, h, r) {
  const p = new THREE.Path();
  if (shape === 'round') p.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, true, 0);
  else roundRectPath(p, w, h, r, true);
  return p;
}

// Ring (outer outline minus inner window) extruded backwards from z = 0 to z = -depth.
function frame(shape, w, h, r, b, depth, bevel) {
  const s = outline(shape, w + 2 * b, h + 2 * b, r + b);
  s.holes.push(hole(shape, w, h, r));
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2,
    curveSegments: 40,
  });
  g.translate(0, 0, -depth);
  return g;
}

function screwsAlong(group, mat, x0, x1, y, z, r) {
  for (const x of [x0, x1]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.8, 12), mat);
    s.rotation.z = Math.PI / 2;
    s.position.set(x, y, z);
    group.add(s);
  }
}

// Build one sight. Returns { group, railY, depth } where railY is the bottom of the mount
// (where the gun's rail sits) in the sight's frame.
export function buildSight(optic, envMap) {
  const M = sightMaterials(envMap);
  const hs = optic.housing;
  const S = VIEW_H;                                     // metres per "screen height"
  const w = hs.w * S, h = hs.h * S, b = hs.bezel * S, r = (hs.radius || 0) * S;
  const ow = w + 2 * b, oh = h + 2 * b;
  const mag = optic.zoom > 1;
  const iron = optic.group === 'iron';
  const g = new THREE.Group();

  // Depth of the body: thin reflex frame, deeper holo box, short dot tube. A magnified
  // sight is seen from behind through its eyepiece: the long tube hides behind the eyepiece
  // ring, so only the ring (with the eyecup, turrets and mount) is modelled, and the zoomed
  // picture fills the whole eyepiece.
  const depth = iron ? 0.006
    : mag ? 0.016
    : hs.shape === 'round' ? 0.03
    : (hs.w >= 0.33 ? 0.032 : 0.014);
  const body = new THREE.Mesh(frame(hs.shape, w, h, r, b, depth, iron ? 0 : Math.min(b * 0.25, 0.0012)), M.metal);
  g.add(body);

  // Glass: rear eyepiece (magnified) or the window itself (1x), slightly tinted.
  if (!iron) {
    const tint = mag ? 0x3c6e6a : (hs.shape === 'rect' ? 0x4a6fa0 : 0x8a6a3a);
    const glassMat = SHADING === 'fast'
      ? new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.025 + (hs.tint || 0) * 0.6, depthWrite: false })
      : new THREE.MeshStandardMaterial({
        color: tint, transparent: true, opacity: 0.025 + (hs.tint || 0) * 0.6, metalness: 0.1, roughness: 0.05,
        envMap, envMapIntensity: 0.6, depthWrite: false,
      });
    const gs = outline(hs.shape, w * 1.002, h * 1.002, r);
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(gs, 40), glassMat);
    glass.position.z = mag ? -0.004 : -depth * 0.55;
    glass.renderOrder = 2;
    g.add(glass);
  }

  // Magnified: rubber eyecup at the rear, objective bell at the front, turrets, mount.
  let bottom = -oh / 2;
  if (mag) {
    const cup = Math.max(0.018 * S, b * 0.35);
    const ring = new THREE.Mesh(frame(hs.shape, ow * 0.98, oh * 0.98, r + b, cup, 0.014, 0.001), M.rubber);
    ring.position.z = 0.012;
    g.add(ring);
    // Machined lip between the eyecup and the eyepiece glass.
    const lip = new THREE.Mesh(frame(hs.shape, w, h, r, Math.max(0.0008, b * 0.12), 0.003, 0.0004), M.edge);
    lip.position.z = 0.001;
    g.add(lip);
    const tr = 0.0085, th = 0.012;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr, th, 24), M.metal);
    top.position.set(0, oh / 2 + th / 2 - 0.001, -depth * 0.5);
    g.add(top);
    const side = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr, th, 24), M.metal);
    side.rotation.z = Math.PI / 2;
    side.position.set(ow / 2 + th / 2 - 0.001, 0, -depth * 0.5);
    g.add(side);
    // knurl rings on the turret caps
    for (const t of [top, side]) {
      const k = new THREE.Mesh(new THREE.TorusGeometry(tr * 1.02, 0.0007, 6, 24), M.edge);
      k.rotation.x = Math.PI / 2;
      k.position.y = th * 0.25;
      t.add(k);
    }
  }

  // Hood over the window.
  if (hs.hood > 0) {
    const hh = Math.max(hs.hood * S, 0.002);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(ow * 0.9, hh, depth * 1.15), M.metal);
    hood.position.set(0, oh / 2 + hh / 2 - 0.0005, -depth * 0.55);
    g.add(hood);
  }

  // Mount: base under the window, then the rail clamp with two screws.
  if (iron) {
    const colH = 0.02;
    const col = new THREE.Mesh(new THREE.BoxGeometry(ow * 0.7, colH, 0.012), M.metal);
    col.position.set(0, -oh / 2 - colH / 2 + b * 0.5, -0.004);
    g.add(col);
    bottom = -oh / 2 - colH + b * 0.5;
    // Front sight post far forward on the gun, its tip on the line of sight (y = 0).
    const pz = -0.33, pw = 0.0024, ph = 0.03;
    const post = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.004), M.post);
    post.position.set(0, -ph / 2, pz);
    g.add(post);
    const ears = new THREE.Mesh(frame('rect', 0.016, 0.02, 0.003, 0.003, 0.006, 0), M.metal);
    ears.position.set(0, -0.006, pz + 0.003);
    g.add(ears);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.008), M.metal);
    tower.position.set(0, -0.03 - 0.015, pz);
    g.add(tower);
  } else {
    const baseH = Math.max((hs.base || 0) * S, 0.004);
    const bw = ow * (mag ? 0.32 : 0.78), bd = mag ? 0.03 : depth * 1.05;
    const base = new THREE.Mesh(new THREE.BoxGeometry(bw, baseH, bd), M.metal);
    base.position.set(0, -oh / 2 - baseH / 2 + b * 0.4, -depth * 0.5);
    g.add(base);
    const clampH = 0.007;
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(bw * 1.08, clampH, bd * 0.8), M.edge);
    const cy = -oh / 2 - baseH + b * 0.4 - clampH / 2;
    clamp.position.set(0, cy, -depth * 0.5);
    g.add(clamp);
    screwsAlong(g, M.screw, -bw * 0.56, bw * 0.56, cy, -depth * 0.5 - bd * 0.2, 0.0018);
    screwsAlong(g, M.screw, -bw * 0.56, bw * 0.56, cy, -depth * 0.5 + bd * 0.2, 0.0018);
    bottom = cy - clampH / 2;
  }

  mergeStatic(g);
  return { group: g, railY: bottom, depth };
}

// Bake every opaque mesh under `group` (any depth) into one mesh per material, so a sight
// costs a handful of draw calls. Transparent meshes (glass) stay separate.
export function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map(), keep = [], rel = new THREE.Matrix4();
  const held = group.children.filter((c) => c.userData.keepGroup);       // moving rigs (a charm on its pivot) stay whole
  for (const h of held) h.removeFromParent();
  group.traverse((o) => {
    if (o.isPoints) { keep.push(o); return; }
    if (!o.isMesh) return;
    if (o.material.transparent || o.userData.hd) { keep.push(o); return; }   // pack models are merged already (and carry extra data)
    rel.multiplyMatrices(inv, o.matrixWorld);
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(rel);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
  });
  for (const o of keep) { rel.multiplyMatrices(inv, o.matrixWorld); o.removeFromParent(); o.matrix.copy(rel); o.matrix.decompose(o.position, o.quaternion, o.scale); }
  group.clear();
  for (const [material, geos] of byMat) {
    let n = 0;
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    // UVs too (textured parts in high graphics); a part without them gets (0, 0).
    const uv = new Float32Array(n * 2);
    let k = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, k * 3);
      nor.set(g.attributes.normal.array, k * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, k * 2);
      k += g.attributes.position.count;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(merged, material);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  for (const o of keep) { o.frustumCulled = false; group.add(o); }
  if (held.length) group.add(...held);
}

// Small procedural environment map so metal edges catch light: a dim room with a few bright
// panels (strip lights, a window), prefiltered once with PMREM.
export function makeEnvMap(renderer, polished = false) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(polished ? 0x383639 : 0x15171a);
  const panel = (w, h, x, y, z, ry, c, intensity = 1) => {
    const color = new THREE.Color(c).multiplyScalar(intensity);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry;
    env.add(m);
  };
  panel(6, 0.5, 0, 3, -1, 0, 0xfff4e0);
  panel(6, 0.5, 0, 3, 1, 0, 0xfff4e0);
  panel(2, 1.4, -3, 1.2, 0, Math.PI / 2, 0x9fb4c8);
  panel(10, 10, 0, -2, 0, 0, 0x3a3833);
  const floor = env.children[env.children.length - 1];
  floor.rotation.x = -Math.PI / 2;
  if (polished) {
    // Large warm reflection cards give polished gold a readable highlight even in dark scenes.
    for (const side of [-1, 1]) {
      panel(4.2, 0.92, side * 3, 0.4, -side * 0.9, Math.PI / 2, 0xfff7e8, 1.24);
      panel(2.6, 0.8, side * 3, -0.35, -side * 1.42, Math.PI / 2, 0xe9e3dd, 0.51);
      panel(2.6, 0.26, side * 2.8, 1.12, side * 1.04, Math.PI / 2, 0xfff9eb, 1.8);
    }
    panel(3.1, 1.1, 0, 0.45, 3, 0, 0xfff2de, 0.94);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, polished ? 0.06 : 0.02).texture;
  pm.dispose();
  for (const mesh of env.children) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  return tex;
}
