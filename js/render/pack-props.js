// Enhanced Graphics pack v5: detailed props (hd/props/<name>.rrmz, tools/hd/props.mjs) in place
// of the match maps' fitted boxes (crates, cars, furniture, barriers, planters, the fountain)
// and their trees and bushes, on High and Ultra. Drawn instanced: one draw per prop and
// material. Collision is unchanged (the boxes). Each prop is made at a typical size and fitted
// to its box; shelves, counters, benches, barriers and planters repeat a unit along the box.
import * as THREE from '../../vendor/three/three.module.min.js?v=0d862c8-mwbx01zn';
import { HDPack } from './hd-pack.js?v=0d862c8-mwbx01zn';
import { loadLightVolume, useLightVolume } from './pack-materials.js?v=0d862c8-mwbx01zn';

// Material per role: [sRGB colour, roughness, metalness] (as tools/hd/props.mjs PROP_ROLES)
const ROLES = {
  wood: [0xa07448, 0.6, 0], wood2: [0x8c6238, 0.65, 0], woodDark: [0x5e3f26, 0.55, 0], fabric: [0x6b5a4a, 0.95, 0], fabric2: [0x7c6a58, 0.95, 0], fabric3: [0xb8a07a, 0.95, 0],
  mattress: [0xe6e2d8, 0.9, 0], paper: [0xf2efe6, 0.8, 0], metal: [0x8a9096, 0.45, 0.85], metalRed: [0xa83a2a, 0.5, 0.4], chrome: [0xd8dce0, 0.18, 1], glass: [0x1a2430, 0.08, 0.2],
  screen: [0x0a0e14, 0.12, 0], plastic: [0x26282c, 0.6, 0], dark: [0x141516, 0.8, 0], paint: [0xffffff, 0.32, 0.25], tyre: [0x1a1a1c, 0.88, 0], light: [0xf0ead8, 0.1, 0],
  tail: [0x9a1810, 0.2, 0], stone: [0xa49c8e, 0.85, 0], stone2: [0xb8b0a2, 0.8, 0], concrete: [0xc8c2b8, 0.9, 0], redPaint: [0xc0381e, 0.6, 0], white: [0xe8e4dc, 0.6, 0],
  soil: [0x4a3626, 0.98, 0], leaf: [0x4a7a34, 0.75, 0], leaf2: [0x3a6428, 0.75, 0], flower: [0xd86a8a, 0.6, 0], bark: [0x5a4232, 0.95, 0], water: [0x3a7aa0, 0.05, 0],
  book1: [0x8a2a24, 0.7, 0], book2: [0x2a4a7a, 0.7, 0], book3: [0x3a6a42, 0.7, 0], book4: [0xb89a50, 0.7, 0],
};
export const PROP_LOOKS = ['crate', 'car', 'desk', 'table', 'sofa', 'bed', 'shelf', 'counter', 'bench', 'barrier', 'planter', 'fountain'];

const models = new Map();   // name -> Promise<{ size, bay, parts: Map<role, BufferGeometry> }>
HDPack.onChange(() => { if (!HDPack.ready) { for (const p of models.values()) p.then((m) => m && m.parts.forEach((g) => g.dispose())).catch(() => {}); models.clear(); } });
function loadModel(name) {
  if (!models.has(name)) {
    const p = HDPack.model('props/' + name + '.rrmz', 'prop-' + name).then((mdl) => {
      if (!mdl) return null;
      const byRole = new Map();
      for (const part of mdl.lods[0]) {
        const n = part.position.length / 3, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const ao = part.detail[i * 4] / 255, cav = part.detail[i * 4 + 2] / 255;
          const k = (0.35 + 0.65 * Math.pow(ao, 1.2)) * (1 - 0.3 * cav);
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(part.position.slice(), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(part.normal.slice(), 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setIndex(new THREE.BufferAttribute(part.index, 1));
        if (!byRole.has(part.role)) byRole.set(part.role, []);
        byRole.get(part.role).push(g.toNonIndexed());
      }
      const parts = new Map();
      for (const [role, list] of byRole) parts.set(role, mergeGeos(list));
      const h = mdl.header || {};
      return { size: h.size || [1, 1, 1], bay: !!h.bay, parts };
    });
    p.catch(() => models.delete(name));
    models.set(name, p);
  }
  return models.get(name);
}
function mergeGeos(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [k, w] of [['position', 3], ['normal', 3], ['color', 3]]) {
    const a = new Float32Array(n * w); let o = 0;
    for (const g of list) { a.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(a, w));
  }
  for (const g of list) g.dispose();
  out.computeBoundingSphere();
  return out;
}

const mats = new Map();
function material(role, env) {
  const key = role + (env ? env.uuid : '');
  if (!mats.has(key)) {
    const [c, r, mt] = ROLES[role] || [0x888888, 0.8, 0];
    mats.set(key, new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt, vertexColors: true, envMap: env || null, envMapIntensity: 0.4, transparent: false }));
  }
  return mats.get(key);
}

// Instance transforms for a box [x0, y0, z0, x1, y1, z1] (one, or one per unit for bays).
function fit(def, b, out, m4) {
  const [L, H, D] = def.size;
  const lx = b[3] - b[0], lz = b[5] - b[2], h = b[4] - b[1];
  const alongX = lx >= lz, len = alongX ? lx : lz, dep = alongX ? lz : lx;
  const n = def.bay ? Math.max(1, Math.round(len / L)) : 1, unit = len / n;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? Math.PI / 2 : 0);
  const s = new THREE.Vector3(dep / D, h / H, unit / L), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + (i + 0.5) * unit;
    p.set((b[0] + b[3]) / 2 + (alongX ? t : 0), b[1], (b[2] + b[5]) / 2 + (alongX ? 0 : t));
    out.push(m4.clone().compose(p, q, s));
  }
}

// group: buildMapLook()'s group. Resolves when done; a stale call changes nothing visible.
export async function applyPackProps(group, quality, renderer, mapId, env) {
  if (!group) return 0;
  const high = (quality === 'high' || quality === 'ultra') && HDPack.ready;
  const u = group.userData;
  // revert
  if (u.packProps) { for (const im of u.packProps) { im.removeFromParent(); im.dispose(); } u.packProps = null; }
  group.traverse((o) => { if (o.userData.propLook && o.userData.propHidden) { o.visible = true; o.userData.propHidden = false; } });
  if (!high || !u.propBoxes) return 0;
  const installed = new Set((HDPack.installed && HDPack.installed.files || []).map((f) => f.path));
  const wanted = [...Object.keys(u.propBoxes), ...(u.trees && u.trees.length ? ['tree'] : []), ...(u.bushes && u.bushes.length ? ['bush'] : [])].filter((n) => installed.has('props/' + n + '.rrmz'));
  if (!wanted.length) return 0;
  const [vol, ...loaded] = await Promise.all([loadLightVolume(mapId).catch(() => null), ...wanted.map((n) => loadModel(n).catch(() => null))]);
  if (u.packProps || !group.parent) return 0;
  const made = [], m4 = new THREE.Matrix4(), col = new THREE.Color();
  wanted.forEach((name, k) => {
    const def = loaded[k];
    if (!def) return;
    const mats4 = [], tints = [];
    if (name === 'tree' || name === 'bush') {
      const list = name === 'tree' ? u.trees : u.bushes;
      for (const [x, z, s = 1] of list) {
        const sc = name === 'tree' ? s : 0.9 + ((x * 13 + z * 7) % 1 + 1) % 1 * 0.4;
        mats4.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (x * 3.7 + z * 1.3) % 6.28), new THREE.Vector3(sc, sc, sc)));
        tints.push(0xffffff);
      }
    } else for (const box of u.propBoxes[name]) { const before = mats4.length; fit(def, box.b, mats4, m4); for (let i = before; i < mats4.length; i++) tints.push(box.tint); }
    if (!mats4.length) return;
    for (const [role, geo] of def.parts) {
      const mat = material(role, env);
      if (vol) useLightVolume(mat, vol);
      const im = new THREE.InstancedMesh(geo, mat, mats4.length);
      mats4.forEach((mm, i) => im.setMatrixAt(i, mm));
      if (role === 'paint') { tints.forEach((t, i) => im.setColorAt(i, col.setHex(t))); }
      im.castShadow = true; im.receiveShadow = true;
      im.userData.ownMaterial = true;   // (pack materials leave it alone)
      im.frustumCulled = false;
      group.add(im); made.push(im);
    }
  });
  // hide the boxes the props replace
  const done = new Set(wanted);
  group.traverse((o) => { if (o.userData.propLook && done.has(o.userData.propLook) && o.visible) { o.visible = false; o.userData.propHidden = true; } });
  u.packProps = made;
  return made.length;
}
