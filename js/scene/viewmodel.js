// First-person weapon: a blocky gun per type plus a procedural 3D sight (sight-model.js),
// drawn in its own scene with a fixed-FOV camera so it keeps its size while the world camera
// zooms. Handles the hip <-> aim raise, sway lag and recoil kick. Original low-poly shapes.
import * as THREE from '../../vendor/three/three.module.min.js?v=97ee87f-mw7pvirk';
import { buildSight, makeEnvMap, mergeStatic, setSightShading, sightShading, setHighEnv, highEnv, highMaterial, VM_FOV, EYE_Z, VIEW_H } from './sight-model.js?v=97ee87f-mw7pvirk';
import { matcap } from './matcap.js?v=97ee87f-mw7pvirk';
import { mulberry32 } from '../core/prng.js?v=97ee87f-mw7pvirk';
import { gunMaps } from './range-tex.js?v=97ee87f-mw7pvirk';
import { skinById, FACTORY } from '../core/skins.js?v=97ee87f-mw7pvirk';
import { legendCanvas, onLegendChange } from '../core/legend.js?v=97ee87f-mw7pvirk';
import { bakeSkin, bakeDetail, disposeBaked, triplanar } from '../render/gpu-tex.js?v=97ee87f-mw7pvirk';

export const MODEL_TYPES = ['rifle', 'carbine', 'smg', 'lmg', 'marksman'];

// Body colour per gun slot, so two guns of the same type still look different.
const FINISHES = [0x3a3d42, 0x6b5b45, 0x46523b, 0x2f3540, 0x5a5048, 0x4a4f57, 0x3d4a48, 0x55493c, 0x383838, 0x4f5560];

const mats = new Map();
let ENV = null;
let RENDERER = null;
let SKIN_SLOT = 0;              // slot being built (its equipped skin, or its factory skin in ultra)
let ULTRA_TEX = 4096;           // largest skin size (tests use less: software rendering)
export function setUltraTexSize(n) { ULTRA_TEX = n; }
// Which skin a slot wears: (slot) -> skin id or null (set by main.js from your profile).
let RESOLVE = () => null;
export function setSkinResolver(fn) { RESOLVE = fn; }
// The skin a slot shows right now: equipped, else (ultra only) its factory skin, else none.
export function skinFor(slot) {
  const id = RESOLVE(slot);
  if (id !== null && id !== undefined && skinById(id)) return skinById(id);
  return sightShading() === 'ultra' ? FACTORY[slot % FACTORY.length] : null;
}
export function skinName(slot) { const d = skinFor(slot); return d ? d.name : ''; }
// Skin bake size per shading: 4096 ultra, 2048 high, 1024 otherwise.
function skinSize() {
  if (WORLD) return 512;                       // guns other people carry: seen from metres away
  const sh = sightShading();
  return Math.min(ULTRA_TEX, sh === 'ultra' ? 4096 : sh === 'high' ? 2048 : 1024);
}
let WORLD = false;              // building a third-person gun
let SKIN_FORCE;                 // undefined: the slot's skin; null: none; id: that skin
function currentSkin() {
  if (SKIN_FORCE !== undefined) return SKIN_FORCE === null ? null : skinById(SKIN_FORCE) || null;
  return skinFor(SKIN_SLOT);
}
const skins = new Map();        // skin id + size -> baked skin; the last few are kept
let detailPaint = null, detailBrushed = null;
// The Legendary skin: your photo as the colour (tiled bigger than patterns), a smooth lacquered
// finish; it updates when you choose another photo.
let LEGEND_TEX = null;
function legendSkin(def) {
  if (!LEGEND_TEX) {
    const a = new THREE.CanvasTexture(legendCanvas());
    a.wrapS = a.wrapT = THREE.RepeatWrapping;
    a.anisotropy = 8;
    const rm = new THREE.DataTexture(new Uint8Array([0, 80, 50, 255]), 1, 1);
    rm.wrapS = rm.wrapT = THREE.RepeatWrapping; rm.needsUpdate = true;
    LEGEND_TEX = { albedo: a, rm, normal: null, def, wear: def.wear, clearcoat: 1, glow: [0, 0, 0], scale: 2.6 };
    onLegendChange(() => { a.needsUpdate = true; });
  }
  return LEGEND_TEX;
}
function bakedSkin(def) {
  if (def.photo) return legendSkin(def);
  const size = skinSize(), key = def.id + '@' + size;
  if (!skins.has(key)) {
    skins.set(key, bakeSkin(RENDERER, def, size));
    const big = [...skins.keys()].filter((k) => !k.endsWith('@512'));
    if (big.length > 4) {            // big maps: keep a few guns' worth (small third-person ones stay)
      const old = big[0], sk = skins.get(old);
      disposeBaked(sk.albedo); disposeBaked(sk.rm); skins.delete(old);
      for (const [k, m] of mats) if (m.userData.skinKey === old) { m.dispose(); mats.delete(k); }
    }
  }
  return skins.get(key);
}
function ultraDetail(kind) {
  if (kind === 'paint') return (detailPaint = detailPaint || bakeDetail(RENDERER, 'paint', Math.min(ULTRA_TEX, 2048)));
  return (detailBrushed = detailBrushed || bakeDetail(RENDERER, 'brushed', Math.min(ULTRA_TEX, 2048)));
}
// The finish parts wear the skin, mapped by 3D position, edges worn to bare metal.
//   ultra / high: MeshPhysical (lacquer clearcoat, glow), ultra adds paint micro-detail.
//   detailed: MeshStandard.   fast: matcap (cheap) with the skin as its colour.
// Guns other people carry use cheaper shading in High / Ultra (no lacquer layers): they are
// small on screen and there can be a dozen of them.
function shading() { const s = sightShading(); return WORLD && (s === 'high' || s === 'ultra') ? 'detailed' : s; }
function skinMaterial(def) {
  const sh = shading(), sk = bakedSkin(def);
  let m;
  if (sh === 'fast') {
    m = new THREE.MeshMatcapMaterial({ color: 0xffffff, matcap: matcap('metal') });
    triplanar(m, { skin: sk, scale: sk.scale || 2.8, gain: 1.7 });
  } else if (sh === 'detailed') {
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, envMap: ENV, envMapIntensity: 0.9 });
    triplanar(m, { skin: sk, scale: sk.scale || 2.8 });
  } else {
    // Shine by rarity: every skin gets some lacquer; Epic and Black Ice also a colour-shifting
    // (iridescent) sheen.
    const r = def.rarity;
    const coat = Math.max(sk.clearcoat || 0, { common: 0.25, rare: 0.55, epic: 0.9, blackice: 1, legendary: 1 }[r] || 0);
    m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 1, metalness: 1, normalMap: gunMaps('metal').normal, normalScale: new THREE.Vector2(0.6, 0.6),
      clearcoat: coat, clearcoatRoughness: r === 'epic' || r === 'blackice' ? 0.05 : 0.15, envMap: highEnv(), envMapIntensity: r === 'common' ? 1.1 : 1.4,
      iridescence: r === 'blackice' ? 0.8 : r === 'legendary' ? 0.5 : r === 'epic' ? 0.45 : 0, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 600],
    });
    triplanar(m, sh === 'ultra' ? { skin: sk, scale: sk.scale || 2.8, detail: ultraDetail('paint'), detailScale: 9, detailStrength: 0.5 } : { skin: sk, scale: sk.scale || 2.8 });
  }
  m.userData.skinKey = def.id + '@' + skinSize();
  return m;
}
// kind: 'auto' (black = polymer, else metal) or 'metal' (barrels, tubes).
function mat(color, kind = 'auto') {
  const sh = shading();
  const skin = kind === 'auto' && color !== BLACK && color !== STEEL ? currentSkin() : null;
  const key = sh + color + kind + (skin ? '|skin' + skin.id + '@' + skinSize() : '');
  if (!mats.has(key)) {
    if (skin) { mats.set(key, skinMaterial(skin)); return mats.get(key); }
    if (sh === 'ultra') {
      // Polymer, steel and fabric: the high materials plus micro-detail.
      const m = kind === 'cloth' ? highMaterial(color, 'polymer', { roughness: 0.95, envMapIntensity: 0.35, envMap: highEnv() })
        : color === BLACK && kind === 'auto' ? highMaterial(0x232528, 'polymer', { envMap: highEnv() })
          : highMaterial(color, 'metal', { envMap: highEnv() });
      if (kind !== 'cloth') triplanar(m, { detail: ultraDetail(color === BLACK && kind === 'auto' ? 'paint' : 'brushed'), detailScale: 10, detailStrength: 0.5 });
      mats.set(key, m);
      return m;
    }
    if (kind === 'cloth') {
      // Gloves and sleeves: matt fabric.
      mats.set(key, sh === 'high' ? highMaterial(color, 'polymer', { roughness: 0.95, envMapIntensity: 0.35 })
        : sh === 'fast' ? new THREE.MeshMatcapMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), matcap: matcap('rubber') })
          : new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.9 }));
      return mats.get(key);
    }
    mats.set(key, sh === 'high'
      // Black parts are polymer (grip, magazine); steel and finish colours are coated metal.
      ? (color === BLACK && kind === 'auto' ? highMaterial(0x232528, 'polymer') : highMaterial(color, 'metal'))
      : sh === 'fast'
      // Matcap tints multiply a mid-grey sphere, so brighten the finish colour to match.
      ? new THREE.MeshMatcapMaterial({ color: new THREE.Color(color).multiplyScalar(1.7), matcap: matcap('metal') })
      : new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.55, envMap: ENV, envMapIntensity: 0.8 }));
  }
  return mats.get(key);
}
const BLACK = 0x1c1e21, STEEL = 0x55595f;

function box(g, color, w, h, d, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.rotation.x = rx;
  g.add(m);
  return m;
}
function tube(g, color, r, len, x, y, z, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat(color, 'metal'));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// Gun coordinates: -z is forward (muzzle), y up, origin at the receiver centre.
const BUILDERS = {
  rifle(g, c, mg) {
    box(g, c, 0.05, 0.07, 0.36, 0, 0, 0);                  // receiver
    box(g, c, 0.046, 0.05, 0.22, 0, 0.004, -0.28);         // handguard
    tube(g, BLACK, 0.011, 0.16, 0, 0.012, -0.46);          // barrel
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.08, 0.06, 0.25);   // grip
    box(mg, BLACK, 0.03, 0.08, 0.05, 0, -0.07, -0.07, -0.15);  // curved mag, upper
    box(mg, BLACK, 0.03, 0.07, 0.05, 0, -0.14, -0.1, -0.4);    // curved mag, lower
    box(g, c, 0.045, 0.07, 0.2, 0, -0.012, 0.27);          // fixed stock
  },
  carbine(g, c, mg) {
    box(g, c, 0.05, 0.068, 0.3, 0, 0, 0);
    box(g, c, 0.05, 0.055, 0.14, 0, 0.004, -0.22);         // short rail handguard
    for (let i = 0; i < 4; i++) box(g, BLACK, 0.052, 0.006, 0.018, 0, 0.034, -0.17 - i * 0.03); // rail teeth
    tube(g, BLACK, 0.01, 0.12, 0, 0.012, -0.35);
    box(g, BLACK, 0.012, 0.022, 0.03, 0, 0.018, -0.42);    // muzzle brake
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.08, 0.05, 0.25);
    box(mg, BLACK, 0.03, 0.13, 0.05, 0, -0.09, -0.07, -0.08);  // straight mag
    box(g, STEEL, 0.012, 0.012, 0.18, 0, 0.012, 0.24);     // collapsible stock tube
    box(g, c, 0.04, 0.08, 0.04, 0, -0.01, 0.33);           // butt pad
  },
  smg(g, c, mg) {
    box(g, c, 0.048, 0.075, 0.24, 0, 0, 0);
    tube(g, BLACK, 0.016, 0.1, 0, 0.01, -0.17);            // stubby suppressor-ish shroud
    box(g, BLACK, 0.032, 0.09, 0.04, 0, -0.075, 0.05, 0.2);
    box(mg, BLACK, 0.026, 0.19, 0.035, 0, -0.13, -0.06);    // long stick mag
    box(g, BLACK, 0.026, 0.07, 0.03, 0, -0.07, -0.12);     // vertical foregrip
    box(g, STEEL, 0.01, 0.06, 0.012, 0, -0.01, 0.15);      // folded stock arms
    box(g, STEEL, 0.04, 0.01, 0.13, 0, -0.04, 0.12);
  },
  lmg(g, c, mg) {
    box(g, c, 0.07, 0.09, 0.4, 0, 0, 0);                   // big receiver
    box(g, c, 0.07, 0.03, 0.12, 0, 0.06, 0.02);            // feed cover
    box(g, STEEL, 0.012, 0.04, 0.1, 0, 0.09, -0.08);       // carry handle
    tube(g, STEEL, 0.022, 0.24, 0, 0.005, -0.32, 8);       // ventilated shroud
    tube(g, BLACK, 0.013, 0.12, 0, 0.005, -0.5);           // heavy barrel
    box(g, BLACK, 0.012, 0.012, 0.16, -0.02, -0.03, -0.32); // folded bipod legs
    box(g, BLACK, 0.012, 0.012, 0.16, 0.02, -0.03, -0.32);
    box(mg, BLACK, 0.11, 0.1, 0.12, 0.005, -0.09, -0.05);   // box magazine
    box(g, BLACK, 0.036, 0.1, 0.045, 0, -0.09, 0.09, 0.25);
    box(g, c, 0.05, 0.085, 0.2, 0, -0.01, 0.3);
  },
  marksman(g, c, mg) {
    box(g, c, 0.048, 0.07, 0.34, 0, 0, 0);
    box(g, c, 0.04, 0.045, 0.26, 0, 0.002, -0.29);         // slim long handguard
    tube(g, BLACK, 0.009, 0.24, 0, 0.012, -0.53);          // long barrel
    box(mg, BLACK, 0.03, 0.06, 0.07, 0, -0.06, -0.06);      // short box mag
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.08, 0.06, 0.25);
    box(g, c, 0.045, 0.06, 0.24, 0, -0.008, 0.29);         // long stock
    box(g, c, 0.04, 0.03, 0.08, 0, 0.04, 0.27);            // cheek riser
  },
};

// Picatinny-style rail along the top of the receiver and handguard: a base strip with
// cross slots. from/to: z range (gun coordinates), y: top of the part it sits on.
function topRail(g, y, from, to) {
  box(g, BLACK, 0.026, 0.006, from - to, 0, y + 0.003, (from + to) / 2);
  for (let z = from - 0.006; z > to + 0.004; z -= 0.01) box(g, BLACK, 0.026, 0.005, 0.005, 0, y + 0.0085, z);
}
const RAILS = {   // [top y, rear z, front z]
  rifle: [[0.035, 0.12, -0.17], [0.029, -0.18, -0.38]],
  carbine: [[0.034, 0.1, -0.14]],
  smg: [[0.0375, 0.08, -0.11]],
  lmg: [[0.075, 0.08, -0.04]],
  marksman: [[0.035, 0.12, -0.16], [0.0245, -0.17, -0.4]],
};

// Gloved hands and sleeves (gun coordinates). Support hand under the handguard, firing
// hand on the grip; forearms run out of the bottom of the screen.
const GLOVE = 0x2c2e30, GLOVE_BACK = 0x55602e, SLEEVE = 0x30343a;
const HAND_Z = { rifle: -0.24, carbine: -0.2, smg: -0.12, lmg: -0.28, marksman: -0.26 };
const GRIP_Z = { rifle: 0.06, carbine: 0.05, smg: 0.05, lmg: 0.09, marksman: 0.06 };
function capsule(g, color, r, a, b) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), l = d.length();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 3, 10), mat(color, 'cloth'));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.position.copy(A.add(B).multiplyScalar(0.5));
  g.add(m);
  return m;
}
function hands(g, type) {
  // Support hand: palm under the handguard, fingers wrapping up the left side, thumb on the right.
  const hz = HAND_Z[type];
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.085), mat(GLOVE, 'cloth'));
  palm.position.set(-0.004, -0.04, hz);
  palm.rotation.z = 0.25;
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const z = hz - 0.03 + i * 0.02;
    capsule(g, GLOVE, 0.0085, [-0.03, -0.04, z], [-0.036, -0.005, z - 0.004]);
    capsule(g, GLOVE, 0.0075, [-0.036, -0.005, z - 0.004], [-0.022, 0.018, z - 0.006]);
  }
  capsule(g, GLOVE, 0.009, [0.022, -0.04, hz + 0.03], [0.03, -0.005, hz - 0.01]);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.04, 0.07), mat(GLOVE_BACK, 'cloth'));
  back.position.set(-0.034, -0.03, hz);
  back.rotation.z = -0.3;
  g.add(back);
  capsule(g, GLOVE, 0.024, [-0.01, -0.06, hz + 0.04], [-0.05, -0.1, hz + 0.1]);       // wrist
  capsule(g, SLEEVE, 0.036, [-0.05, -0.1, hz + 0.1], [-0.16, -0.36, hz + 0.32]);      // forearm
  // Firing hand on the grip, index finger along the frame.
  const gz = GRIP_Z[type];
  capsule(g, GLOVE, 0.026, [0.006, -0.065, gz + 0.02], [0.006, -0.11, gz + 0.04]);
  capsule(g, GLOVE_BACK, 0.012, [0.03, -0.06, gz + 0.01], [0.03, -0.1, gz + 0.03]);
  capsule(g, GLOVE, 0.007, [0.026, -0.03, gz - 0.005], [0.026, -0.03, gz - 0.06]);
  capsule(g, GLOVE, 0.028, [0.02, -0.13, gz + 0.06], [0.06, -0.2, gz + 0.12]);        // wrist
  capsule(g, SLEEVE, 0.04, [0.06, -0.2, gz + 0.12], [0.13, -0.42, gz + 0.22]);        // forearm
}


/* ---------- Black Ice: 3D ice crystals ---------- */
// Clusters of faceted shards growing off the top and bottom edges of the gun's parts and the
// magazine's front edge. Short near the sight rail so they never get in the way of aiming.
const iceMats = new Map();
function iceMaterial(def) {
  const sh = sightShading(), key = sh + def.id;
  if (iceMats.has(key)) return iceMats.get(key);
  const c = new THREE.Color(...def.ice);
  let m;
  if (sh === 'fast') m = new THREE.MeshMatcapMaterial({ color: c.clone().multiplyScalar(1.6), matcap: matcap('metal'), transparent: true, opacity: 0.86, flatShading: true });
  else if (sh === 'detailed') m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.84, flatShading: true, envMap: ENV, envMapIntensity: 2, emissive: c.clone().multiplyScalar(0.2) });
  else m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.8, flatShading: true, clearcoat: 1, clearcoatRoughness: 0.03,
    iridescence: 0.35, iridescenceIOR: 1.5, envMap: highEnv(), envMapIntensity: 2.4, emissive: c.clone().multiplyScalar(0.22) });
  // Inspect: the shards shoot off along their own direction (and fall), then regrow from
  // their bases. iceT is the inspect progress 0..1 (1 = resting).
  const u = { iceT: { value: 1 } };
  m.userData.ice = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute vec3 iceBase; attribute vec3 iceDir; attribute float iceRnd; uniform float iceT;\n' +
      'float iceS(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float fly = iceS(0.12 + iceRnd * 0.06, 0.42, iceT);
        float grow = iceS(0.5 + iceRnd * 0.12, 0.88, iceT);
        bool flying = iceT < 0.46;
        float sc = flying ? 1.0 - fly * 0.6 : grow * (1.0 + 0.3 * sin(grow * 3.14159));
        vec3 off = flying ? iceDir * fly * (0.15 + iceRnd * 0.3) + vec3(0.0, -0.35, 0.0) * fly * fly : vec3(0.0);
        if (flying && fly > 0.98) sc = 0.0;
        transformed = iceBase + (transformed - iceBase) * sc + off;`);
  };
  m.customProgramCacheKey = () => 'ice' + sh;
  iceMats.set(key, m);
  return m;
}
function iceCrystals(g, mg, def, type) {
  const rng = mulberry32(def.id * 977 + type.length * 31);
  const rails = RAILS[type] || [];
  const railFrom = Math.max(...rails.map((r) => r[1]), 0) + 0.03, railTo = Math.min(...rails.map((r) => r[2]), 0) - 0.03;
  const build = (group) => {
    const pos = [], nor = [], base = [], dirs = [], rnds = [];
    const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const b = new THREE.Vector3(), dv = new THREE.Vector3();
    const spike = (part, x, y, z, dir, len, r) => {
      const geo = new THREE.ConeGeometry(r, len, rng() < 0.5 ? 4 : 5, 1).toNonIndexed();
      geo.translate(0, len / 2, 0);                                    // base on the surface
      // dir: 0 up, 1 down, 2 forward (-z); with a random lean.
      const lean = () => (rng() - 0.5) * 0.9;
      if (dir === 0) e.set(lean(), rng() * 6.28, lean());
      else if (dir === 1) e.set(Math.PI + lean(), rng() * 6.28, lean());
      else e.set(-Math.PI / 2 + lean() * 0.6, 0, lean());
      q.setFromEuler(e);
      tmp.compose(v.set(x, y, z), q, one);
      geo.applyMatrix4(tmp).applyMatrix4(part.matrix);
      pos.push(...geo.attributes.position.array); nor.push(...geo.attributes.normal.array);
      // Base point and pointing direction (gun space) for the inspect animation.
      b.set(x, y, z).applyMatrix4(part.matrix);
      dv.set(0, 1, 0).applyQuaternion(q).transformDirection(part.matrix);
      const rr = rng(), n = geo.attributes.position.count;
      for (let k = 0; k < n; k++) { base.push(b.x, b.y, b.z); dirs.push(dv.x, dv.y, dv.z); rnds.push(rr); }
      geo.dispose();
    };
    for (const part of group.children) {
      if (!part.isMesh || !part.geometry.parameters || part.geometry.type !== 'BoxGeometry') continue;
      const { width: w, height: h, depth: d } = part.geometry.parameters;
      if (d < 0.04 || h < 0.02) continue;                              // skip small bits (rail teeth, pins)
      part.updateMatrix();
      const isMag = group === mg;
      for (const top of [true, false]) {
        const n = Math.round(d / 0.035 * (0.6 + rng() * 0.8));
        for (let i = 0; i < n; i++) {
          const z = (rng() - 0.5) * d * 0.9;
          const zg = z + part.position.z;
          const nearSight = top && zg < railFrom && zg > railTo;        // under the sight: keep them tiny
          const k = nearSight ? 0.25 : top ? 1 : 0.8;
          const cluster = 1 + Math.floor(rng() * 3);
          for (let c = 0; c < cluster; c++) {
            spike(part, (rng() - 0.5) * w * 0.85, top ? h / 2 : -h / 2, z + (rng() - 0.5) * 0.012, top ? 0 : 1, (0.012 + rng() * 0.04) * k, 0.003 + rng() * 0.004);
          }
        }
      }
      if (isMag) for (let i = 0; i < 4; i++) spike(part, (rng() - 0.5) * w * 0.6, (rng() - 0.5) * h * 0.8, -d / 2, 2, 0.015 + rng() * 0.03, 0.003 + rng() * 0.003);
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('iceBase', new THREE.Float32BufferAttribute(base, 3));
    geo.setAttribute('iceDir', new THREE.Float32BufferAttribute(dirs, 3));
    geo.setAttribute('iceRnd', new THREE.Float32BufferAttribute(rnds, 1));
    const mesh = new THREE.Mesh(geo, iceMaterial(def));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
  };
  build(g);
  build(mg);
}

/* ---------- moving parts and ultra detail (gun coordinates) ---------- */
// half receiver width, ejection port z, muzzle [y, z], trigger z, handguard [y, from, to]
const SPEC = {
  rifle: { hw: 0.025, port: 0.0, muzzle: [0.012, -0.545], trig: 0.0, hg: [0.004, -0.19, -0.37] },
  carbine: { hw: 0.025, port: 0.0, muzzle: [0.018, -0.44], trig: -0.005, hg: [0.004, -0.16, -0.28] },
  smg: { hw: 0.024, port: 0.02, muzzle: [0.01, -0.225], trig: 0.0, hg: null },
  lmg: { hw: 0.035, port: 0.0, muzzle: [0.005, -0.565], trig: 0.03, hg: [0.005, -0.22, -0.42] },
  marksman: { hw: 0.024, port: 0.0, muzzle: [0.012, -0.655], trig: 0.0, hg: [0.002, -0.18, -0.4] },
};
const DARK = 0x0d0e10;

// Bolt carrier seen through the ejection port, with its charging handle; slides back per shot.
function boltGroup(type) {
  const sp = SPEC[type], g = new THREE.Group();
  box(g, STEEL, 0.004, 0.012, 0.045, sp.hw + 0.0015, 0.012, sp.port);
  const knob = tube(g, STEEL, 0.004, 0.018, sp.hw + 0.01, 0.012, sp.port + 0.03);
  knob.rotation.set(0, 0, Math.PI / 2);
  mergeStatic(g);
  return g;
}

// Small parts that make the silhouettes read as real guns: ports, trigger and guard,
// selector, pins, handguard vents, a muzzle device, magazine ribs, sling points.
function ultraDetails(g, type, c, mg) {
  const sp = SPEC[type], tz = sp.trig;
  box(g, DARK, 0.0025, 0.02, 0.055, sp.hw + 0.0005, 0.012, sp.port);                 // ejection port
  box(g, BLACK, 0.0035, 0.004, 0.06, sp.hw + 0.001, 0.024, sp.port);                 // dust cover hinge
  box(g, BLACK, 0.006, 0.004, 0.06, 0, -0.062, tz - 0.01);                           // trigger guard
  box(g, BLACK, 0.006, 0.026, 0.004, 0, -0.05, tz - 0.04);
  const trig = box(g, STEEL, 0.004, 0.022, 0.005, 0, -0.046, tz - 0.012, 0.35);      // trigger
  void trig;
  const sel = box(g, STEEL, 0.003, 0.006, 0.016, -sp.hw - 0.0015, -0.012, tz + 0.03, 0.6);   // selector
  void sel;
  for (const z of [-0.06, tz + 0.02, 0.09]) {                                         // pins
    const pin = tube(g, STEEL, 0.0025, sp.hw * 2 + 0.003, 0, -0.02, z, 8);
    pin.rotation.set(0, 0, Math.PI / 2);
  }
  if (sp.hg) {
    const [y, from, to] = sp.hg;
    for (let z = from; z > to + 0.02; z -= 0.035) for (const sx of [-1, 1]) box(g, DARK, 0.002, 0.012, 0.022, sx * 0.024, y - 0.004, z);   // vents
  }
  // Muzzle device: a short brake with side ports.
  const [my, mz] = sp.muzzle;
  tube(g, BLACK, 0.0115, 0.04, 0, my, mz - 0.01, 12);
  for (const dz of [-0.022, -0.01, 0.002]) for (const sx of [-1, 1]) box(g, DARK, 0.004, 0.008, 0.006, sx * 0.0105, my, mz + dz);
  // Magazine ribs and base plate.
  mg.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(mg);
  if (!bb.isEmpty()) {
    const h = bb.max.y - bb.min.y, cz = (bb.min.z + bb.max.z) / 2, d = bb.max.z - bb.min.z;
    for (let i = 1; i <= 3; i++) for (const sx of [-1, 1]) box(mg, BLACK, 0.002, 0.004, d * 0.7, sx * (bb.max.x + 0.0005), bb.max.y - h * i * 0.22, cz);
    box(mg, STEEL, bb.max.x - bb.min.x + 0.004, 0.006, d * 0.9 + 0.004, (bb.min.x + bb.max.x) / 2, bb.min.y + 0.002, cz);
  }
  // Sling loop at the back.
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0018, 6, 14), mat(STEEL, 'metal'));
  loop.position.set(-sp.hw - 0.006, -0.01, 0.16);
  loop.rotation.y = Math.PI / 2;
  g.add(loop);
}

// Muzzle flash: a star-shaped glow facing you and two crossed side flames. Additive, unlit.
let FLASH_TEX = null;
function flashTexture() {
  if (FLASH_TEX) return FLASH_TEX;
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d'), c = S / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.2, 'rgba(255,200,110,0.9)');
  gr.addColorStop(0.5, 'rgba(255,130,40,0.35)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = gr;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, r = i % 2 ? c * 0.35 : c;
    g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  g.closePath(); g.fill();
  FLASH_TEX = new THREE.CanvasTexture(cv);
  FLASH_TEX.colorSpace = THREE.SRGBColorSpace;
  return FLASH_TEX;
}
function flashGroup() {
  const m = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  // Three planes (front star, two crossed side flames) in one geometry: one draw call.
  const parts = [new THREE.PlaneGeometry(0.09, 0.09)];
  for (const r of [0, Math.PI / 2]) {
    const side = new THREE.PlaneGeometry(0.03, 0.12);
    side.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.PI / 2, r, 0)).setPosition(0, 0, -0.05));
    parts.push(side);
  }
  const pos = [], uv = [];
  for (const pg of parts) {
    const ng = pg.toNonIndexed();
    pos.push(...ng.attributes.position.array); uv.push(...ng.attributes.uv.array);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const g = new THREE.Mesh(geo, m);
  g.frustumCulled = false;
  g.visible = false;
  g.renderOrder = 2;
  return g;
}
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const TOP_Y = { rifle: 0.035, carbine: 0.034, smg: 0.0375, lmg: 0.075, marksman: 0.035 };

/* ---------- a model per gun ---------- */
// Each gun gets its own model (original low-poly shapes that suggest each gun's layout).
// Guns without an entry use the model of their type.
export const MODEL_FOR = {
  'smg-01': 'evo', 'rifle-01': 'bullpup', 'rifle-02': 'carbine', 'mp-01': 'machinepistol', 'rifle-06': 'ak',
  'lmg-01': 'lmg', 'smg-05': 'compact', 'rifle-05': 'sfw', 'smg-03': 'pdw', 'smg-04': 'smg',
};
Object.assign(BUILDERS, {
  // angular compact SMG, skeleton side-folding stock, long top rail
  evo(g, c, mg) {
    box(g, c, 0.046, 0.064, 0.3, 0, 0, 0);
    box(g, BLACK, 0.044, 0.03, 0.22, 0, -0.045, 0.01);
    box(g, c, 0.044, 0.05, 0.12, 0, -0.002, -0.2, -0.08);
    tube(g, BLACK, 0.009, 0.1, 0, 0.008, -0.31);
    tube(g, BLACK, 0.012, 0.03, 0, 0.008, -0.37);
    box(g, BLACK, 0.032, 0.1, 0.042, 0, -0.1, 0.07, 0.3);
    box(g, BLACK, 0.034, 0.008, 0.09, 0, -0.072, 0);
    box(mg, BLACK, 0.026, 0.14, 0.05, 0, -0.12, -0.05, -0.18);
    box(mg, BLACK, 0.026, 0.05, 0.05, 0, -0.2, -0.07, -0.35);
    box(g, STEEL, 0.01, 0.012, 0.2, 0, 0, 0.25);
    box(g, STEEL, 0.01, 0.012, 0.2, 0, -0.05, 0.25);
    box(g, BLACK, 0.03, 0.08, 0.02, 0, -0.025, 0.35);
  },
  // bullpup: magazine behind the grip, long body, carry rail
  bullpup(g, c, mg) {
    box(g, c, 0.05, 0.085, 0.58, 0, -0.01, 0.02);
    box(g, c, 0.03, 0.03, 0.22, 0, 0.045, -0.05);
    box(g, c, 0.048, 0.06, 0.14, 0, -0.005, -0.33);
    tube(g, BLACK, 0.01, 0.12, 0, 0.01, -0.46);
    tube(g, BLACK, 0.013, 0.04, 0, 0.01, -0.53);
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.1, -0.12, 0.25);
    box(g, BLACK, 0.03, 0.008, 0.08, 0, -0.06, -0.15);
    box(mg, BLACK, 0.03, 0.12, 0.055, 0, -0.1, 0.1, -0.1);
    box(g, BLACK, 0.052, 0.09, 0.03, 0, -0.01, 0.32);
  },
  // machine pistol: tiny boxy receiver, magazine in the grip, folded wire stock
  machinepistol(g, c, mg) {
    box(g, c, 0.04, 0.07, 0.2, 0, 0, 0);
    tube(g, BLACK, 0.011, 0.05, 0, 0.01, -0.125);
    tube(g, BLACK, 0.013, 0.015, 0, 0.01, -0.15);
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.085, 0.03, 0.15);
    box(mg, BLACK, 0.026, 0.08, 0.034, 0, -0.17, 0.055, 0.15);
    box(g, BLACK, 0.03, 0.05, 0.03, 0, -0.06, -0.07);
    for (const x of [-0.022, 0.022]) box(g, STEEL, 0.006, 0.006, 0.16, x, 0, 0.1);
    box(g, STEEL, 0.045, 0.03, 0.006, 0, -0.02, 0.18);
  },
  // AK-style: gas tube over the barrel, curved magazine, slant brake, skeleton stock
  ak(g, c, mg) {
    box(g, c, 0.05, 0.07, 0.34, 0, 0, 0);
    box(g, c, 0.048, 0.012, 0.3, 0, 0.038, 0.02);                // dust cover
    tube(g, c, 0.012, 0.2, 0, 0.045, -0.27);                      // gas tube
    box(g, c, 0.05, 0.05, 0.2, 0, 0, -0.26);
    tube(g, BLACK, 0.011, 0.18, 0, 0.01, -0.46);
    box(g, BLACK, 0.022, 0.022, 0.05, 0, 0.01, -0.57);
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.08, 0.07, 0.3);
    box(mg, BLACK, 0.032, 0.09, 0.055, 0, -0.08, -0.06, -0.2);
    box(mg, BLACK, 0.032, 0.085, 0.055, 0, -0.15, -0.088, -0.5);
    box(mg, BLACK, 0.032, 0.06, 0.055, 0, -0.2, -0.122, -0.75);
    box(g, BLACK, 0.012, 0.012, 0.22, 0, 0.01, 0.28);
    box(g, BLACK, 0.012, 0.012, 0.22, 0, -0.04, 0.28);
    box(g, c, 0.04, 0.08, 0.025, 0, -0.012, 0.39);
    box(g, BLACK, 0.03, 0.02, 0.1, 0, 0.03, 0.3);
  },
  // compact SMG: no stock, vertical foregrip, cocking tube over the barrel, curved magazine
  compact(g, c, mg) {
    box(g, c, 0.044, 0.07, 0.26, 0, 0, 0);
    tube(g, STEEL, 0.01, 0.12, 0, 0.025, -0.18);
    tube(g, BLACK, 0.01, 0.07, 0, 0, -0.165);
    tube(g, BLACK, 0.013, 0.02, 0, 0, -0.2);
    box(g, BLACK, 0.03, 0.09, 0.035, 0, -0.07, -0.13);
    box(g, BLACK, 0.032, 0.1, 0.045, 0, -0.085, 0.06, 0.25);
    box(mg, BLACK, 0.026, 0.1, 0.04, 0, -0.09, -0.04, -0.25);
    box(mg, BLACK, 0.026, 0.06, 0.04, 0, -0.16, -0.07, -0.45);
    box(g, BLACK, 0.04, 0.05, 0.02, 0, 0, 0.14);
  },
  // special-forces carbine: long rail handguard, heavy barrel, fixed stock
  sfw(g, c, mg) {
    box(g, c, 0.05, 0.068, 0.3, 0, 0, 0);
    box(g, BLACK, 0.044, 0.03, 0.16, 0, -0.045, 0.02);
    box(g, c, 0.054, 0.056, 0.3, 0, 0.004, -0.3);
    for (const x of [-0.029, 0.029]) box(g, BLACK, 0.006, 0.012, 0.28, x, 0.004, -0.3);
    box(g, BLACK, 0.026, 0.006, 0.28, 0, -0.026, -0.3);
    tube(g, BLACK, 0.014, 0.12, 0, 0.012, -0.51);
    tube(g, BLACK, 0.016, 0.04, 0, 0.012, -0.59);
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.08, 0.05, 0.25);
    box(mg, BLACK, 0.03, 0.13, 0.05, 0, -0.1, -0.06, -0.1);
    box(g, c, 0.042, 0.07, 0.24, 0, -0.02, 0.27, 0.05);
    box(g, BLACK, 0.044, 0.09, 0.02, 0, -0.025, 0.39);
  },
  // PDW: magazine in the grip, folding foregrip, telescoping stock
  pdw(g, c, mg) {
    box(g, c, 0.042, 0.07, 0.25, 0, 0, 0);
    box(g, c, 0.036, 0.03, 0.12, 0, -0.04, -0.07);
    tube(g, BLACK, 0.009, 0.06, 0, 0.008, -0.155);
    tube(g, BLACK, 0.012, 0.025, 0, 0.008, -0.195);
    box(g, BLACK, 0.034, 0.11, 0.045, 0, -0.09, 0.02, 0.12);
    box(mg, BLACK, 0.028, 0.08, 0.036, 0, -0.18, 0.035, 0.12);
    box(g, BLACK, 0.028, 0.06, 0.03, 0, -0.08, -0.09, 0.2);
    for (const x of [-0.016, 0.016]) box(g, STEEL, 0.006, 0.006, 0.14, x, 0, 0.17);
    box(g, BLACK, 0.044, 0.06, 0.015, 0, -0.01, 0.245);
  },
});
Object.assign(TOP_Y, { evo: 0.032, bullpup: 0.06, machinepistol: 0.035, ak: 0.044, compact: 0.035, sfw: 0.034, pdw: 0.035 });
Object.assign(RAILS, {
  evo: [[0.032, 0.14, -0.24]], bullpup: [[0.06, 0.05, -0.15]], machinepistol: [[0.035, 0.08, -0.08]],
  ak: [[0.044, 0.12, -0.12]], compact: [[0.035, 0.1, -0.1]], sfw: [[0.034, 0.1, -0.14], [0.032, -0.16, -0.44]], pdw: [[0.035, 0.11, -0.12]],
});
Object.assign(HAND_Z, { evo: -0.2, bullpup: -0.32, machinepistol: -0.07, ak: -0.26, compact: -0.13, sfw: -0.3, pdw: -0.09 });
Object.assign(GRIP_Z, { evo: 0.07, bullpup: -0.12, machinepistol: 0.03, ak: 0.07, compact: 0.06, sfw: 0.05, pdw: 0.02 });
Object.assign(SPEC, {
  evo: { hw: 0.023, port: 0, muzzle: [0.008, -0.385], trig: 0, hg: [0, -0.15, -0.25] },
  bullpup: { hw: 0.025, port: 0.12, muzzle: [0.01, -0.55], trig: -0.15, hg: [0, -0.28, -0.38] },
  machinepistol: { hw: 0.02, port: 0, muzzle: [0.01, -0.158], trig: 0, hg: null },
  ak: { hw: 0.025, port: 0, muzzle: [0.01, -0.595], trig: 0, hg: [0, -0.18, -0.35] },
  compact: { hw: 0.022, port: 0.02, muzzle: [0, -0.21], trig: 0.02, hg: null },
  sfw: { hw: 0.025, port: 0, muzzle: [0.012, -0.61], trig: 0, hg: [0.004, -0.17, -0.43] },
  pdw: { hw: 0.021, port: 0, muzzle: [0.008, -0.208], trig: 0, hg: null },
});



const easeInOut = (x) => x * x * (3 - 2 * x);

// A gun as other players see it (third person, real size): the same model and skin, without
// rails, hands or moving parts. Cached per gun, finish and skin; returns a new group sharing
// geometry and materials. Gun coordinates: -z forward, origin at the receiver; grip at gripZ.
const worldGuns = new Map();
export function buildWorldGun(gun, slot, skinId) {
  const type = MODEL_FOR[gun.id] || (MODEL_TYPES.includes(gun.model) ? gun.model : 'rifle');
  const key = sightShading() + '|' + gun.id + '|' + slot + '|' + (skinId ?? '-');
  if (!worldGuns.has(key)) {
    const g = new THREE.Group(), mg = new THREE.Group();
    SKIN_SLOT = slot; SKIN_FORCE = skinId ?? null; WORLD = true;
    try { BUILDERS[type](g, FINISHES[slot % FINISHES.length], mg); }
    finally { SKIN_FORCE = undefined; WORLD = false; }
    g.add(mg);
    mergeStatic(g);
    const box = new THREE.Box3().setFromObject(g);
    worldGuns.set(key, { g, gripZ: GRIP_Z[type] ?? 0.06, front: box.min.z, top: box.max.y });
  }
  const w = worldGuns.get(key), out = new THREE.Group();
  for (const m of w.g.children) { const c = new THREE.Mesh(m.geometry, m.material); c.castShadow = true; out.add(c); }
  out.userData = { gripZ: w.gripZ, front: w.front, top: w.top };
  return out;
}

export class WeaponRig {
  constructor(renderer) {
    ENV = makeEnvMap(renderer);
    this.env = ENV;
    this.scene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight(0xe8ecf2, 0x2a2824, 0.9);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(-0.5, 0.8, 0.9);   // from above-left and a little in front, so edges facing you catch light
    const rim = new THREE.DirectionalLight(0xb8c8ff, 0.6);
    rim.position.set(0.8, 0.3, -0.5);
    this.scene.add(rim);
    this.scene.add(key);
    this.key = key; this.rim = rim;
    this.camera = new THREE.PerspectiveCamera(VM_FOV, 16 / 9, 0.01, 3);
    this.root = new THREE.Group();            // posed between hip and aimed
    this.scene.add(this.root);
    this.models = new Map();                  // gun id + optic id -> group
    this.current = null;
    // Springs (metres / radians): sway lag x/y, kick-back z, kick pitch.
    this.sx = 0; this.sy = 0; this.vx = 0; this.vy = 0;
    this.kz = 0; this.vz = 0; this.kp = 0; this.vp = 0;
    this.H = 1080;
    this.visible = true;
    // Hip and aimed poses of the root.
    this.hipPos = new THREE.Vector3(0.085, -0.075, 0.015);
    this.hipRot = new THREE.Euler(0.03, 0.09, 0.02);
    this.q0 = new THREE.Quaternion().setFromEuler(this.hipRot);
    this.q1 = new THREE.Quaternion();
    this.qt = new THREE.Quaternion();
    this.kickQ = new THREE.Quaternion();
    this.xAxis = new THREE.Vector3(1, 0, 0);
    this.zAxis = new THREE.Vector3(0, 0, 1);
    this.cantQ = new THREE.Quaternion();
    this.bobY = 0;           // walking bob, set by main.js
    this._v = new THREE.Vector3();
    this._e = new THREE.Vector3();
    RENDERER = renderer;
    // Animations (Settings > Weapon animations): draw, reload, sprint pose, bolt, flash, brass.
    this.animations = true;
    this.drawT = 1;          // 0 -> 1 while the gun is being drawn
    this.reloadP = -1;       // reload progress 0..1 from main.js, -1 when not reloading
    this._lastP = -1;
    this.sprinting = false;  // set by main.js
    this.inspectT = -1;      // 0..1 while inspecting (I), -1 otherwise
    this.meleeT = -1;        // 0..1 during a melee jab (K)
    this.inspectHold = -1;   // tests: hold the inspect pose at this progress
    this.sprintE = 0;
    this.boltZ = 0; this.flashT = 0; this.flashRot = 0; this.flashS = 1;
    this._a = { x: 0, y: 0, z: 0, p: 0, yw: 0, r: 0 };
    this._ae = new THREE.Euler(0, 0, 0, 'YXZ');
    this._aq = new THREE.Quaternion();
    this._pv = new THREE.Vector3(); this._pb = new THREE.Vector3();
    // Muzzle flash light on the gun (no effect on the cheap matcap shading).
    this.flashLight = new THREE.PointLight(0xffb060, 0, 0.8, 2);
    this.scene.add(this.flashLight);
    // Ejected brass (in view space).
    const caseGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.016, 10);
    const caseMat = new THREE.MeshStandardMaterial({ color: 0xc8963c, metalness: 1, roughness: 0.3, envMap: ENV, envMapIntensity: 1.5 });
    this.brass = [];
    this.brassI = 0;
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(caseGeo, caseMat);
      b.visible = false;
      b.frustumCulled = false;
      b.userData = { v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 };
      this.scene.add(b);
      this.brass.push(b);
    }
  }

  // Animation offsets for this frame (position in metres, angles in radians), and the
  // magazine, bolt, flash and brass. e: ADS blend (animations are toned down while aiming).
  _animate(dt, e) {
    const a = this._a;
    a.x = a.y = a.z = a.p = a.yw = a.r = 0;
    const u = this.current && this.current.userData;
    if (!this.animations) {
      if (u && u.mag) { u.mag.position.y = 0; u.mag.visible = true; u.bolt.position.z = u.boltZ; u.flash.visible = false; }
      this.flashLight.intensity = 0;
      for (const b of this.brass) b.visible = false;
      return a;
    }
    // Draw: the gun comes up from below, pitched down and rolled.
    if (this.drawT < 1) this.drawT = Math.min(1, this.drawT + dt / 0.42);
    const d = 1 - Math.pow(1 - this.drawT, 3);
    a.y -= 0.11 * (1 - d); a.p -= 0.7 * (1 - d); a.r += 0.25 * (1 - d);
    // Inspect: bring the gun to the middle, show the right side, then the left, then back.
    if (this.inspectHold >= 0) this.inspectT = this.inspectHold;
    else if (this.inspectT >= 0) { this.inspectT += dt / 3.2; if (this.inspectT >= 1) this.inspectT = -1; }
    if (this.inspectT >= 0) {
      const p = this.inspectT;
      const w = smooth01(0, 0.15, p) * (1 - smooth01(0.85, 1, p)) * (1 - e);
      const side = smooth01(0.42, 0.62, p);           // 0: right side towards you, 1: left side
      a.yw += w * (1.15 * (1 - side) - 1.0 * side);
      a.r += w * (0.18 - 0.36 * side);
      a.p += w * 0.12;
      a.x -= 0.075 * w; a.y += 0.075 * w; a.z -= 0.11 * w;
    }
    // Sprint: lowered and turned in towards the chest.
    this.sprintE += ((this.sprinting ? 1 : 0) - this.sprintE) * Math.min(1, dt * 9);
    const se = this.sprintE * (1 - e);
    a.x -= 0.035 * se; a.y -= 0.045 * se; a.yw += 0.55 * se; a.r += 0.35 * se; a.p -= 0.2 * se;
    if (u && u.mag) {
      // Reload: tilt the gun, old magazine drops out, new one goes in, slap, charge.
      const p = this.reloadP;
      if (p >= 0) {
        const tilt = smooth01(0, 0.15, p) * (1 - smooth01(0.85, 1, p)) * (1 - 0.6 * e);
        a.r += 0.45 * tilt; a.p += 0.12 * tilt; a.y += 0.05 * tilt; a.x -= 0.05 * tilt; a.z -= 0.05 * tilt;   // brought up to look at the mag well
        let my = 0, vis = true;
        if (p >= 0.15 && p < 0.4) { const q = (p - 0.15) / 0.25; my = -0.35 * q * q; }
        else if (p >= 0.4 && p < 0.5) vis = false;
        else if (p >= 0.5 && p < 0.75) { const q = (p - 0.5) / 0.25; my = -0.25 * Math.pow(1 - q, 3); }
        u.mag.position.y = my; u.mag.visible = vis;
        if (this._lastP >= 0 && this._lastP < 0.75 && p >= 0.75) { this.vp += 0.6; this.vz += 0.15; }   // slap
        if (p > 0.8 && p < 0.92) this.boltZ = Math.max(this.boltZ, 0.04 * Math.sin(Math.PI * (p - 0.8) / 0.12));
        this._lastP = p;
      } else { u.mag.position.y = 0; u.mag.visible = true; this._lastP = -1; }
      // Bolt returns forward; flash lasts one or two frames.
      this.boltZ *= Math.exp(-dt * 30);
      u.bolt.position.z = u.boltZ + this.boltZ;
      this.flashT -= dt;
      const on = this.flashT > 0;
      u.flash.visible = on;
      if (on) { u.flash.rotation.z = this.flashRot; u.flash.scale.setScalar(this.flashS * (1 - 0.5 * e)); }
      this.flashLight.intensity = on ? 2.5 * this.flashS : 0;
      if (on) { u.flash.getWorldPosition(this.flashLight.position); }
    }
    for (const b of this.brass) {
      if (!b.visible) continue;
      const v = b.userData.v, w = b.userData.w;
      b.userData.life -= dt;
      if (b.userData.life <= 0) { b.visible = false; continue; }
      v.y -= 9.8 * dt;
      b.position.addScaledVector(v, dt);
      b.rotation.x += w.x * dt; b.rotation.y += w.y * dt; b.rotation.z += w.z * dt;
    }
    return a;
  }

  setAspect(a, H) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
    this.H = H;
  }

  // High graphics: reflections come from the range's sky (env, a PMREM texture).
  setHighEnv(env) { setHighEnv(env); }

  // 'fast' (matcap), 'detailed' (PBR) or 'high' (textured PBR, high graphics). Rebuilds the
  // cached models on change.
  setShading(mode) {
    if (mode === sightShading()) return;
    setSightShading(mode);
    this.applyLights();
    for (const m of this.models.values()) this.root.remove(m);
    this.models.clear();
    this.current = null;
  }

  // Drop the cached models (after a shading change made through another rig).
  rebuild() {
    for (const m of this.models.values()) this.root.remove(m);
    this.models.clear();
    this.current = null;
    this.gunId = undefined;
    this.applyLights();
  }

  // Skin animation amount (0..1) and clock for the current gun's skin materials.
  animateSkins(t, amount) {
    const u = this.current && this.current.userData;
    if (!u || !u.skinMats) return;
    for (const mat of u.skinMats) { const tu = mat.userData.tri; tu.triAnim.value = amount; tu.triTime.value = t; }
    // Black Ice shards: shoot off and regrow with the inspect (resting otherwise).
    const iceT = this.inspectT >= 0 && this.inspectHold < 0 ? this.inspectT : this.inspectHold >= 0 ? this.inspectHold : 1;
    for (const mat of u.iceMats || []) mat.userData.ice.iceT.value = iceT;
  }

  // Light levels for the current shading (also used by a second rig, e.g. battle player 2).
  applyLights() {
    const high = sightShading() === 'high' || sightShading() === 'ultra';
    // Same light directions as the range in high graphics: warm key over the left shoulder.
    this.hemi.intensity = high ? 0.3 : 0.9;
    this.key.color.set(high ? 0xffe8d0 : 0xffffff);
    this.key.intensity = high ? 2.4 : 1.8;
    this.rim.intensity = high ? 0.9 : 0.6;
  }

  // gun: validated gun data; slot: its index (finish colour); optic: chosen sight.
  setGun(gun, slot, optic) {
    const type = MODEL_FOR[gun.id] || (MODEL_TYPES.includes(gun.model) ? gun.model : 'rifle');
    // forceSkin (replays: someone else's gun): undefined = your skin for the slot, else that id / null.
    const sk = this.forceSkin !== undefined ? (this.forceSkin === null ? null : skinById(this.forceSkin)) : skinFor(slot);
    const key = gun.id + '|' + optic.id + '|' + (sk ? sk.id : '-') + (this.noHands ? '|nh' : '');   // a skin change builds a new model
    let m = this.models.get(key);
    if (!m) {
      m = new THREE.Group();
      const sight = buildSight(optic, ENV);
      sight.group.position.set(0, 0, -EYE_Z);
      m.add(sight.group);
      const gunG = new THREE.Group();
      const magG = new THREE.Group();
      SKIN_SLOT = slot;
      if (this.forceSkin !== undefined) SKIN_FORCE = this.forceSkin;
      const finish = FINISHES[slot % FINISHES.length];
      BUILDERS[type](gunG, finish, magG);
      if (sk && sk.rarity === 'blackice' && sk.ice) iceCrystals(gunG, magG, sk, type);
      for (const [y, from, to] of RAILS[type]) topRail(gunG, y, from, to);
      if (sightShading() === 'ultra') ultraDetails(gunG, type, finish, magG);
      if (!this.noHands) hands(gunG, type);
      SKIN_FORCE = undefined;
      mergeStatic(gunG);
      mergeStatic(magG);
      gunG.add(magG);
      const bolt = boltGroup(type);
      gunG.add(bolt);
      const flash = flashGroup();
      const [my, mz] = SPEC[type].muzzle;
      // Flashlight on the side of the barrel (shown at night).
      const torch = new THREE.Group();
      const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.085, 12), mat(BLACK));
      tb.rotation.x = Math.PI / 2; torch.add(tb);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0125, 14), new THREE.MeshBasicMaterial({ color: 0xfff6d8, toneMapped: false }));
      lens.position.z = -0.0435; lens.rotation.y = Math.PI; torch.add(lens);
      torch.position.set(SPEC[type].hw + 0.022, my - 0.012, mz + 0.1);
      torch.visible = false;
      gunG.add(torch);
      flash.position.set(0, my, mz - 0.035);
      gunG.add(flash);
      m.userData = { torch, mag: magG, bolt, boltZ: bolt.position.z, flash, port: new THREE.Vector3(SPEC[type].hw + 0.01, 0.014, SPEC[type].port), gun: gunG };
      const skinMats = new Set();
      gunG.traverse((o) => { if (o.isMesh && o.material.userData.tri && o.material.userData.skinKey) skinMats.add(o.material); });
      m.userData.skinMats = [...skinMats];
      const iceSet = new Set();
      m.traverse((o) => { if (o.isMesh && o.material.userData.ice) iceSet.add(o.material); });
      m.userData.iceMats = [...iceSet];
      const s = 0.62;
      gunG.scale.setScalar(s);
      // Rail (top of the receiver) under the sight's mount; receiver centred a little ahead.
      gunG.position.set(0, sight.railY - TOP_Y[type] * s, -EYE_Z - 0.05);
      m.add(gunG);
      m.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      this.models.set(key, m);
      this.root.add(m);
    }
    if (this.current) this.current.visible = false;
    m.visible = true;
    if (m.userData.torch) m.userData.torch.visible = !!this.torchOn;
    // Draw animation when the gun itself changes (not for a sight change).
    if (this.gunId !== gun.id && this.gunId !== undefined && this.animations) this.drawT = 0;
    this.gunId = gun.id;
    this.current = m;
  }

  // The flashlight on the gun (night battles).
  setTorch(on) { this.torchOn = !!on; if (this.current && this.current.userData.torch) this.current.userData.torch.visible = this.torchOn; }

  // Mouse movement in screen pixels: the sight lags the view by a few pixels.
  nudge(dxPx, dyPx) {
    const mPerPx = VIEW_H / this.H;
    this.vx -= dxPx * mPerPx * 2.5;
    this.vy += dyPx * mPerPx * 2.5;
  }

  // A shot: kick back towards the eye (5-12 mm) and tip up slightly.
  kick() {
    // m/s impulse. With the spring below (w = 30 rad/s, near-critical damping) the peak is
    // about 0.67 * v / w: 0.25 m/s -> 5.6 mm, 0.55 m/s -> 12 mm.
    this.vz += 0.25 + Math.random() * 0.3;
    this.vp += 0.9;
    this.cancelInspect();
    if (!this.animations || !this.current) return;
    this.boltZ = 0.032;                        // bolt slams back, then returns
    this.flashT = 0.045;
    this.flashRot = Math.random() * Math.PI;
    this.flashS = 0.75 + Math.random() * 0.5;
    this._ejectBrass();
  }

  // K: a quick melee jab (the gun swings across and forward, then back).
  melee() { this.meleeT = 0; this.cancelInspect(); }

  // I: inspect the weapon (ignored while aiming or reloading).
  inspect() { if (this.animations && this.reloadP < 0) this.inspectT = 0; }
  cancelInspect() { if (this.inspectHold < 0) this.inspectT = -1; }

  // Spent case out of the ejection port: up and to the right, spinning, under gravity.
  _ejectBrass() {
    const u = this.current.userData;
    if (!u.port) return;
    const b = this.brass[this.brassI++ % this.brass.length];
    this.current.updateMatrixWorld(true);
    b.position.copy(u.port).applyMatrix4(u.gun.matrixWorld);
    b.userData.v.set(0.9 + Math.random() * 0.5, 0.7 + Math.random() * 0.4, -0.15 + Math.random() * 0.15);   // right, up, a little forward
    b.userData.w.set(Math.random() * 30, Math.random() * 20, Math.random() * 30);
    b.userData.life = 0.55;
    b.visible = true;
  }

  // e: eased ADS blend 0..1. t: seconds (breathing). dt: frame time.
  update(dt, e, t) {
    const mPerPx = VIEW_H / this.H;
    let rem = Math.min(dt, 0.1);
    while (rem > 0) {
      const h = Math.min(rem, 1 / 240);
      // Sway: stiff spring, settles in ~0.2 s.
      this.vx += (-260 * this.sx - 30 * this.vx) * h;
      this.vy += (-260 * this.sy - 30 * this.vy) * h;
      this.sx += this.vx * h; this.sy += this.vy * h;
      // Kick: snappy, returns in ~0.12 s.
      this.vz += (-900 * this.kz - 55 * this.vz) * h;
      this.vp += (-700 * this.kp - 50 * this.vp) * h;
      this.kz += this.vz * h; this.kp += this.vp * h;
      rem -= h;
    }
    // Lag limited to 2-4 px of screen.
    const lim = 4 * mPerPx;
    this.sx = Math.max(-lim, Math.min(lim, this.sx));
    this.sy = Math.max(-lim, Math.min(lim, this.sy));
    this.kz = Math.max(-0.002, Math.min(0.012, this.kz));

    // e is already eased (smootherstep) by main.js; use it directly so the gun lands exactly
    // with the zoom. The raise follows a slight arc (dips, then rises into line) with a
    // little cant on the way, instead of sliding in a straight line.
    const k = e;
    const A = this._animate(Math.min(dt, 0.1), k);
    // Skin animations play only while inspecting (they ease in and out with the pose).
    {
      const target = this.inspectT >= 0 ? 1 : 0;
      this.skinAnim = (this.skinAnim || 0) + (target - (this.skinAnim || 0)) * Math.min(1, dt * 5);
      if (this.skinAnim < 0.002) this.skinAnim = 0;
      this.animateSkins(t, this.skinAnim);
    }
    const arc = Math.sin(Math.PI * k);
    const br = (1 - 0.6 * k) * 0.0004;
    this.root.position.set(
      this.hipPos.x * (1 - k) + this.sx + Math.sin(t * 1.1) * br,
      this.hipPos.y * (1 - k) - 0.012 * arc + this.sy + Math.sin(t * 0.7 + 1) * br + this.bobY,
      this.hipPos.z * (1 - k) + this.kz,
    );
    this.root.position.x += A.x; this.root.position.y += A.y; this.root.position.z += A.z;
    this.qt.slerpQuaternions(this.q0, this.q1, k);
    this.kickQ.setFromAxisAngle(this.xAxis, this.kp * 0.05);
    this.cantQ.setFromAxisAngle(this.zAxis, -0.12 * arc);
    this.root.quaternion.copy(this.qt).multiply(this.cantQ).multiply(this.kickQ);
    if (A.p || A.yw || A.r) {
      // Animation turns pivot about the middle of the gun (between the hands), not the eye.
      const pv = this._pv.set(0, -0.045, -0.26);
      const before = this._pb.copy(pv).applyQuaternion(this.root.quaternion);
      this.root.quaternion.multiply(this._aq.setFromEuler(this._ae.set(A.p, A.yw, A.r)));
      pv.applyQuaternion(this.root.quaternion);
      this.root.position.add(before.sub(pv));
    }
    if (this.meleeT >= 0) {
      this.meleeT += Math.min(dt, 0.1) / 0.38;
      if (this.meleeT >= 1) this.meleeT = -1;
      else {
        const p = Math.sin(Math.PI * Math.min(1, this.meleeT * 1.4)) * (this.meleeT < 0.7 ? 1 : (1 - this.meleeT) / 0.3);
        this.root.position.x -= 0.07 * p; this.root.position.y -= 0.04 * p; this.root.position.z -= 0.09 * p;
        this.root.quaternion.multiply(this._aq.setFromEuler(this._ae.set(-0.25 * p, 0.6 * p, 0.5 * p)));
      }
    }
  }

  // Where the sight's window is on screen right now (for the lens pass), in pixels from the
  // screen centre, plus a scale for kick-back (closer = bigger).
  // Projects the sight's real rear opening through the weapon camera, so the lens mask follows
  // the sight through the whole raise (position, rotation, kick).
  lensOffset(out) {
    const H = this.H, W = H * this.camera.aspect;
    this.root.updateMatrixWorld();
    const v = this._v.set(0, 0, -EYE_Z).applyMatrix4(this.root.matrixWorld);
    out.scale = EYE_Z / Math.max(0.03, -v.z);
    v.project(this.camera);
    out.x = v.x * W / 2;
    out.y = v.y * H / 2;
    return out;
  }
}
