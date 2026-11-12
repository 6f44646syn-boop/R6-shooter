import { skinSheets } from '../render/skins2.js?v=e347c75-mwe1k7e3';
import { packArt } from '../render/pack-art.js?v=e347c75-mwe1k7e3';
// First-person weapon: a blocky gun per type plus a procedural 3D sight (sight-model.js),
// drawn in its own scene with a fixed-FOV camera so it keeps its size while the world camera
// zooms. Handles the hip <-> aim raise, sway lag and recoil kick. Original low-poly shapes.
import * as THREE from '../../vendor/three/three.module.min.js?v=e347c75-mwe1k7e3';
import { packAnims, styleFor, sampleClip, eventsBetween } from './weapon-anims.js?v=e347c75-mwe1k7e3';
import { buildSight, makeEnvMap, mergeStatic, setSightShading, sightShading, setHighEnv, highEnv, highMaterial, VM_FOV, EYE_Z, VIEW_H } from './sight-model.js?v=e347c75-mwe1k7e3';
import { matcap } from './matcap.js?v=e347c75-mwe1k7e3';
import { mulberry32 } from '../core/prng.js?v=e347c75-mwe1k7e3';
import { gunMaps } from './range-tex.js?v=e347c75-mwe1k7e3';
import { skinById, FACTORY, SAKURA_ID } from '../core/skins.js?v=e347c75-mwe1k7e3';
import { legendCanvas, onLegendChange } from '../core/legend.js?v=e347c75-mwe1k7e3';
import { bakeSkin, bakeDetail, disposeBaked, triplanar } from '../render/gpu-tex.js?v=e347c75-mwe1k7e3';
import { HDPack } from '../render/hd-pack.js?v=e347c75-mwe1k7e3';
import { epicRelief } from './skin-relief.js?v=e347c75-mwe1k7e3';
import { prepareFrost, frostInspect, sakuraInspect, kilnInspect, abyssInspect, vesperInspect, forgeInspect, orreryInspect, amberInspect, jadeInspect, velvetInspect, opalInspect } from './inspect-effects.js?v=e347c75-mwe1k7e3';
import { F2 } from './f2-model.js?v=e347c75-mwe1k7e3';
import { G8 } from './g8-model.js?v=e347c75-mwe1k7e3';
import { C8 } from './c8-model.js?v=e347c75-mwe1k7e3';
import { R4 } from './r4-model.js?v=e347c75-mwe1k7e3';
import { AK } from './ak-model.js?v=e347c75-mwe1k7e3';
import { EVO } from './evo-model.js?v=e347c75-mwe1k7e3';
import { MP5K } from './compact-model.js?v=e347c75-mwe1k7e3';
import { T5 } from './smg-model.js?v=e347c75-mwe1k7e3';
import { SMG11 } from './machinepistol-model.js?v=e347c75-mwe1k7e3';
import { MP7 } from './pdw-model.js?v=e347c75-mwe1k7e3';

export const MODEL_TYPES = ['rifle', 'carbine', 'smg', 'lmg', 'marksman'];

// Body colour per gun slot, so two guns of the same type still look different.
const FINISHES = [0x3a3d42, 0x6b5b45, 0x46523b, 0x2f3540, 0x5a5048, 0x4a4f57, 0x3d4a48, 0x55493c, 0x383838, 0x4f5560];

const mats = new Map();
let ENV = null;
let RENDERER = null;
const sakuraEnvironments = new WeakMap();
function sakuraEnv() {
  let env = sakuraEnvironments.get(RENDERER);
  if (!env) {
    env = makeEnvMap(RENDERER, true);
    sakuraEnvironments.set(RENDERER, env);
  }
  return env;
}
let SKIN_SLOT = 0;              // slot being built (its equipped skin, or its factory skin in ultra)
let ULTRA_TEX = 4096;           // largest skin size (tests use less: software rendering)
let INSPECT_QUALITY = 'standard';   // shared graphics preset, independent of the optional gun shading
export function setUltraTexSize(n) { ULTRA_TEX = n; }
let HIRES_SKINS = false;          // setting: your own gun's skin at full size at every graphics level
export function setHiResSkins(on) { HIRES_SKINS = !!on; }
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
  if (HIRES_SKINS) return ULTRA_TEX;
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
  const size = skinSize(), key = def.id + ':' + (packArt.finish ? packArt.revision : 0) + 's' + skinSheets.rev + '@' + size;
  if (!skins.has(key)) {
    skins.set(key, bakeSkin(RENDERER, def, size));
    const big = [...skins.keys()].filter((k) => !k.endsWith('@512'));
    if (big.length > 4) {            // big maps: keep a few guns' worth (small third-person ones stay)
      const old = big[0], sk = skins.get(old);
      disposeBaked(sk.albedo); disposeBaked(sk.rm); disposeBaked(sk.normal); skins.delete(old);
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
  const sh = shading(), hd = HD;
  const sakura = def.id === SAKURA_ID, kiln = !!def.art;      // kiln: a painted Legendary (concept art)
  const sk = sakura || kiln ? { def, clearcoat: def.clearcoat } : bakedSkin(def);     // painted in the shader, nothing to bake
  let m;
  if (sh === 'fast') {
    m = new THREE.MeshMatcapMaterial({ color: 0xffffff, matcap: matcap('metal') });
    triplanar(m, { skin: sk, scale: sk.scale || 2.8, gain: 1.7 });
  } else if (sh === 'detailed') {
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1,
      envMap: sakura ? sakuraEnv() : hd ? highEnv() || ENV : ENV, envMapIntensity: 0.9 });
    triplanar(m, { skin: sk, scale: sk.scale || 2.8, hd });
  } else {
    // Shine by rarity: every skin gets some lacquer; Epic and Black Ice also a colour-shifting
    // (iridescent) sheen.
    const r = def.rarity;
    const coat = Math.max(sk.clearcoat || 0, { common: 0.25, rare: 0.55, epic: 0.9, blackice: 1, legendary: 1 }[r] || 0);
    m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 1, metalness: 1, normalMap: hd || sakura || kiln ? null : gunMaps('metal').normal, normalScale: new THREE.Vector2(0.6, 0.6),
      clearcoat: coat, clearcoatRoughness: sakura || kiln ? 0.035 : r === 'epic' || r === 'blackice' ? 0.05 : 0.15,
      envMap: sakura ? sakuraEnv() : highEnv(), envMapIntensity: r === 'common' ? 1.1 : sakura ? 1.22 : 1.4,
      iridescence: r === 'blackice' ? 0.64 : sakura || kiln ? 0 : r === 'legendary' ? 0.32 : r === 'epic' ? 0.45 : 0,
      iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 600],
    });
    // Pack models: relief depth (parallax) on graphics cards with WebGL 2.
    const depth = !sakura && !kiln && hd && RENDERER && RENDERER.capabilities.isWebGL2 ? (r === 'blackice' ? 0.0028 : r === 'common' ? 0.0008 : 0.0014) : 0;
    const detailStrength = r === 'legendary' || r === 'blackice' ? 0.16 : hd ? 0.35 : 0.5;
    const detail = !sakura && !kiln && (hd || sh === 'ultra') ? ultraDetail('paint') : null;
    triplanar(m, { skin: sk, scale: sk.scale || 2.8, hd, depth, detail, detailScale: 9, detailStrength });
  }
  m.userData.skinKey = def.id + ':' + (packArt.finish ? packArt.revision : 0) + 's' + skinSheets.rev + '@' + skinSize();
  return m;
}
// kind: 'auto' (black = polymer, else metal) or 'metal' (barrels, tubes).
function mat(color, kind = 'auto') {
  const sh = shading();
  const skin = kind === 'auto' && color !== BLACK && color !== STEEL ? currentSkin() : null;
  const key = sh + color + kind + (skin ? '|skin' + skin.id + ':' + (packArt.finish ? packArt.revision : 0) + 's' + skinSheets.rev + '@' + skinSize() : '') + (HD ? '|hd' : '');
  if (!mats.has(key)) {
    if (skin) { mats.set(key, skinMaterial(skin)); return mats.get(key); }
    if (HD) { mats.set(key, hdMaterial(color, kind, sh)); return mats.get(key); }
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
const BLACK = 0x1c1e21, STEEL = 0x55595f, RUBBER = 0x141516;

/* ---------- Enhanced Graphics pack models ---------- */
let HD = false;                 // building from a pack model (materials without UV maps)
// Materials for pack models: lit by the sky's reflections, micro-detail mapped by position,
// the baked ambient occlusion, and worn edges.
function hdMaterial(color, kind, sh) {
  const ultra = sh === 'ultra', world = sh === 'detailed';
  const P = {
    finish: { color, roughness: 0.42, metalness: 0.7, detail: 'paint', edge: 1, edgeCol: [0.34, 0.35, 0.37], edgeMetal: 1, coat: 0.25 },
    polymer: { color: 0x202225, roughness: 0.6, metalness: 0.05, detail: 'paint', edge: 0.8, edgeCol: [0.075, 0.078, 0.085], edgeMetal: 0.05, coat: 0 },
    metal: { color: kind === 'metal' && color !== STEEL ? color : 0x4a4e54, roughness: 0.34, metalness: 1, detail: 'brushed', edge: 1, edgeCol: [0.55, 0.56, 0.58], edgeMetal: 1, coat: 0 },
    rubber: { color: RUBBER, roughness: 0.93, metalness: 0, detail: 'paint', edge: 0, coat: 0 },
    dark: { color: 0x060607, roughness: 0.75, metalness: 0.4, detail: null, edge: 0, coat: 0 },
  }[kind === 'metal' ? 'metal' : kind === 'rubber' ? 'rubber' : kind === 'dark' ? 'dark' : color === BLACK ? 'polymer' : 'finish'];
  const o = { color: P.color, roughness: P.roughness, metalness: P.metalness, envMap: highEnv() || ENV, envMapIntensity: world ? 0.9 : 1.15 };
  const m = ultra && P.coat ? new THREE.MeshPhysicalMaterial({ ...o, clearcoat: P.coat, clearcoatRoughness: 0.35 }) : new THREE.MeshStandardMaterial(o);
  triplanar(m, { hd: true, detail: P.detail && !world ? ultraDetail(P.detail) : null, detailScale: P.detail === 'brushed' ? 14 : 10, detailStrength: ultra ? 0.5 : 0.35,
    hdEdge: P.edge, hdEdgeCol: P.edgeCol || [0, 0, 0], hdEdgeMetal: P.edgeMetal ?? 1 });
  return m;
}
const HD_KIND = { finish: (c) => [c, 'auto'], polymer: () => [BLACK, 'auto'], steel: () => [STEEL, 'metal'], rubber: () => [RUBBER, 'rubber'], dark: () => [0x060607, 'dark'],
  shell: (c) => (currentSkin() ? [c, 'auto'] : [BLACK, 'auto']) };     // furniture: the skin when one is on, else black polymer
// The pack's model for a gun type (when High or Ultra graphics and the pack is installed).
function hdModel(type) {
  if (TRACED[type]) return null;                // traced guns (f2-model.js, g8-model.js) at every level
  const sh = sightShading();
  return sh === 'high' || sh === 'ultra' ? HDPack.loadedGun(type) : null;
}
// Fill the gun, magazine and bolt groups from a pack model's level of detail.
function buildHD(g, mg, bg, model, lod, finish) {
  HD = true;
  try {
    for (const p of model.lods[Math.min(lod, model.lods.length - 1)]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
      geo.setAttribute('aDetail', new THREE.BufferAttribute(p.detail, 4, true));
      geo.setIndex(new THREE.BufferAttribute(p.index, 1));
      geo.computeBoundingSphere();
      const role = p.group === 'mag' && p.role === 'shell' && currentSkin()?.id === SAKURA_ID ? 'polymer' : p.role;
      const [c, kind] = HD_KIND[role](finish);
      const mesh = new THREE.Mesh(geo, mat(c, kind));
      mesh.userData.hd = true;
      (p.group === 'mag' ? mg : p.group === 'bolt' && bg ? bg : g).add(mesh);
    }
  } finally { HD = false; }
}

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
    box(g, currentSkin()?.id === SAKURA_ID ? c : BLACK, 0.034, 0.1, 0.045, 0, -0.08, 0.05, 0.25);
    box(mg, BLACK, 0.03, 0.13, 0.05, 0, -0.09, -0.07, -0.08);  // straight mag
    box(g, STEEL, 0.012, 0.012, 0.18, 0, 0.012, 0.24);     // collapsible stock tube
    if (currentSkin()?.id === SAKURA_ID) {
      box(g, c, 0.042, 0.02, 0.108, 0, 0.016, 0.272);     // cheekpiece
      box(g, c, 0.029, 0.013, 0.101, 0, -0.019, 0.279, 0.33);
      box(g, BLACK, 0.041, 0.075, 0.019, 0, -0.012, 0.333);
      for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
        box(g, BLACK, 0.002, 0.017, 0.008, side * 0.0248, 0.001, -0.175 - i * 0.022);
      }
    } else box(g, c, 0.04, 0.08, 0.04, 0, -0.01, 0.33);
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
  carbine: [],
  smg: [[0.0375, 0.08, -0.11]],
  lmg: [],
  marksman: [[0.035, 0.12, -0.16], [0.0245, -0.17, -0.4]],
};

// Gloved hands and sleeves (gun coordinates). Support hand under the handguard, firing
// hand on the grip; forearms run out of the bottom of the screen.
const GLOVE = 0x2c2e30, GLOVE_BACK = 0x55602e, SLEEVE = 0x30343a;
const HAND_Z = { rifle: -0.24, carbine: -0.2, smg: -0.12, lmg: -0.28, marksman: -0.26 };
const GRIP_Z = { rifle: 0.06, carbine: 0.05, smg: 0.05, lmg: 0.09, marksman: 0.06 };
function capsule(g, color, r, a, b) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), l = d.length();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 16), typeof color === 'object' ? color : mat(color, 'cloth'));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.position.copy(A.add(B).multiplyScalar(0.5));
  g.add(m);
  return m;
}
/* ---------- arms: fingerless leather gloves, bare forearms, a watch ---------- */
// Materials per shading: tanned skin, oiled leather with a pebbled grain (bump), nails, the
// watch. 'fast' shading uses matcaps like the rest of the gun.
const handMats = new Map();
function grainTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) { const v = 90 + r() * 90 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(r() * 256, r() * 256, 1 + r() * 2.6, 0, 7); g.fill(); }
  for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(40,40,40,0.5)'; g.lineWidth = 0.6; g.beginPath(); let x = r() * 256, y = r() * 256; g.moveTo(x, y); for (let k = 0; k < 5; k++) g.lineTo(x += (r() - 0.5) * 40, y += (r() - 0.5) * 12); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  return t;
}
function watchFace() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#101214'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#d8e6c8'; g.lineCap = 'round';
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, l = i % 3 ? 8 : 14; g.lineWidth = i % 3 ? 3 : 5; g.beginPath(); g.moveTo(64 + Math.sin(a) * 56, 64 - Math.cos(a) * 56); g.lineTo(64 + Math.sin(a) * (56 - l), 64 - Math.cos(a) * (56 - l)); g.stroke(); }
  g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + 26, 64 - 18); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 - 8, 64 - 42); g.stroke();
  return new THREE.CanvasTexture(c);
}
function handMat(kind) {
  const sh = sightShading(), key = sh + kind;
  if (handMats.has(key)) return handMats.get(key);
  const P = { skin: [0xa87456, 0.56, 0], leather: [0x4a2e20, 0.5, 0], strap: [0x7a4f30, 0.55, 0], nail: [0xd8aa98, 0.28, 0], steel: [0x1b1d20, 0.3, 0.8], face: [0xffffff, 0.2, 0], sleeve: [SLEEVE, 0.95, 0] }[kind];
  let m;
  if (sh === 'fast') m = new THREE.MeshMatcapMaterial({ color: new THREE.Color(P[0]).multiplyScalar(1.9), matcap: matcap(kind === 'steel' ? 'metal' : 'rubber') });
  else {
    m = new THREE.MeshStandardMaterial({ color: P[0], roughness: P[1], metalness: P[2], envMap: sh === 'high' || sh === 'ultra' ? highEnv() : ENV, envMapIntensity: kind === 'skin' ? 0.35 : 0.6 });
    if (kind === 'leather' || kind === 'strap') { m.bumpMap = grainTex(); m.bumpScale = 0.6; }
    if (kind === 'skin') { m.emissive = new THREE.Color(0x4a1a0c); m.emissiveIntensity = 0.05; m.bumpMap = grainTex(); m.bumpScale = 0.12; m.bumpMap.repeat.set(9, 9); }   // pores; a little warmth in the shade
    if (kind === 'face') { m.map = watchFace(); m.emissiveMap = m.map; m.emissive = new THREE.Color(0x3a4a30); }
  }
  m.userData.hand = true;
  handMats.set(key, m);
  return m;
}
const ell = (g, kind, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => {
  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), handMat(kind));
  b.scale.set(sx, sy, sz); b.position.set(x, y, z); b.rotation.set(rx, ry, rz); g.add(b); return b;
};
// A smooth tapering tube through points (radius r0 to r1): one piece, no ball joints.
function taperTube(g, pts, r0, r1, kind) {
  const curve = new THREE.CatmullRomCurve3(pts), seg = 14, rad = 10;
  const geo = new THREE.TubeGeometry(curve, seg, 1, rad, false), P = geo.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    const t = Math.floor(i / (rad + 1)) / seg;
    curve.getPointAt(t, c); v.fromBufferAttribute(P, i).sub(c).multiplyScalar(r0 + (r1 - r0) * t).add(c); P.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, handMat(kind)); g.add(m); return m;
}
// A finger from knuckle to tip through the joints: the glove covers the first segment (with a
// rolled edge), then bare skin, a rounded tip and a nail on the back (nb: the nail's outward side).
function finger(g, pts, r, nb) {
  const V = pts.map((p) => new THREE.Vector3(...p)), cut = V[0].clone().lerp(V[1], 0.62);
  taperTube(g, [V[0].clone().addScaledVector(V[0].clone().sub(V[1]).normalize(), r * 0.6), V[0], cut], r * 1.12, r * 1.08, 'leather');
  const edge = new THREE.Mesh(new THREE.TorusGeometry(r * 1.06, r * 0.18, 8, 18), handMat('leather'));
  edge.position.copy(cut); edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), V[1].clone().sub(V[0]).normalize()); g.add(edge);
  taperTube(g, [V[0].clone().lerp(V[1], 0.5), V[1], V[2], V[3]], r, r * 0.84, 'skin');
  const dir = V[3].clone().sub(V[2]).normalize(), n = new THREE.Vector3(...nb).normalize();
  ell(g, 'skin', r * 0.84, r * 0.84, r * 0.84, ...V[3].toArray());                                  // fingertip
  const nail = ell(g, 'nail', r * 0.6, r * 0.2, r * 0.78, ...V[3].clone().addScaledVector(dir, -r * 0.45).addScaledVector(n, r * 0.7).toArray());
  nail.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(n, dir).normalize(), n, dir));
}
// Vent holes in the back of the glove: skin showing through, with a stitched rim.
function vents(g, at, n, along, k = 3) {
  const N = new THREE.Vector3(...n).normalize(), A = new THREE.Vector3(...along).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), N);
  for (let i = 0; i < k; i++) {
    const p = new THREE.Vector3(...at).addScaledVector(A, (i - (k - 1) / 2) * 0.013);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.002, 20), handMat('skin'));
    hole.position.copy(p).addScaledVector(N, 0.0004); hole.quaternion.copy(q); g.add(hole);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0046, 0.0009, 6, 20), handMat('leather'));
    rim.position.copy(p).addScaledVector(N, 0.0012); rim.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)); g.add(rim);
  }
}
// A bare forearm along +y from the wrist (y = 0), oval and tapering, with the forearm muscles
// swelling towards the elbow; length 1 (scaled to fit).
function forearmGeo(r0, r1) {
  const geo = new THREE.CylinderGeometry(r1, r0, 1, 28, 30, false);
  geo.translate(0, 0.5, 0);
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x);
    const swell = 1 + 0.18 * Math.exp(-Math.pow((y - 0.42) / 0.2, 2)) * (0.6 + 0.4 * Math.cos(a - 0.6)) + 0.04 * Math.exp(-Math.pow((y - 0.06) / 0.04, 2));
    P.setX(i, x * swell * 1.12); P.setZ(i, z * swell * 0.88);              // oval: wider than deep
  }
  geo.computeVertexNormals();
  return geo;
}
// The support forearm for pack guns, laid each frame from the wrist to a shoulder point fixed in
// view space (bottom left, off screen): bare skin, a watch near the wrist, the sleeve rolled up
// near the elbow. Its +z side faces the camera (where the watch face is).
const SHOULDER = new THREE.Vector3(-0.4, -0.4, 0.1);
function supportArm() {
  const arm = new THREE.Group(), skin = new THREE.Mesh(forearmGeo(0.016, 0.026), handMat('skin'));
  const roll = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.011, 10, 24), handMat('sleeve'));
  const watch = new THREE.Group();
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.012, 32, 1, true), handMat('strap'));
  strap.scale.set(1.12, 1, 0.9);
  const caseM = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0125, 0.007, 32), handMat('steel'));
  caseM.rotation.x = Math.PI / 2; caseM.position.z = 0.0185;
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0108, 0.0018, 8, 32), handMat('steel'));
  bezel.position.z = 0.0222;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.0095, 32), handMat('face'));
  face.position.z = 0.0221;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.004, 10), handMat('steel'));
  crown.rotation.z = Math.PI / 2; crown.position.set(0.0135, 0, 0.0185);
  watch.add(strap, caseM, bezel, face, crown);
  watch.position.y = 0.04;
  arm.add(skin, watch);
  arm.userData.sleeve = skin;
  // the elbow and the upper arm (its sleeve pushed up, rolled just above the elbow)
  const upper = new THREE.Group(), elbow = new THREE.Mesh(new THREE.SphereGeometry(0.028, 24, 16), handMat('skin'));
  elbow.scale.set(1.05, 1, 0.92);
  const sleeveGeo = new THREE.CylinderGeometry(0.042, 0.036, 1, 24, 12, true); sleeveGeo.translate(0, 0.5, 0);
  const sleeve = new THREE.Mesh(sleeveGeo, handMat('sleeve'));
  roll.rotation.x = Math.PI / 2; roll.position.y = 0.035; roll.scale.setScalar(1.15);
  upper.add(elbow, sleeve, roll);
  upper.userData.sleeve = sleeve;
  arm.userData.upper = upper;
  return arm;
}
// sup (optional): a group for the support hand, so the pack's animations can move it. Its
// origin is the palm (returned), and its parts are placed relative to that.
function hands(g0, type, sup) {
  // Support (left) hand: palm under the handguard, fingers wrapping up the left side, the thumb
  // along the right. Fingerless leather glove: vented back, padded knuckles, a wrist strap.
  const hz = HAND_Z[type];
  let g = sup || g0;
  ell(g, 'leather', 0.028, 0.0135, 0.047, -0.004, -0.043, hz, 0, 0, 0.25);               // palm
  ell(g, 'leather', 0.023, 0.013, 0.024, 0.012, -0.047, hz + 0.028, 0, 0, 0.2);           // heel of the thumb
  ell(g, 'leather', 0.012, 0.027, 0.045, -0.03, -0.038, hz + 0.004, 0, 0, -0.35);         // back of the hand
  vents(g, [-0.041, -0.032, hz - 0.004], [-1, -0.35, 0], [0, 0, 1]);
  const LEN = [0.92, 1, 0.96, 0.8];                                                       // index .. little
  for (let i = 0; i < 4; i++) {
    const z = hz - 0.03 + i * 0.02, k = LEN[i], r = 0.0086 - i * 0.0004;
    finger(g, [[-0.027, -0.045, z], [-0.039, -0.023, z - 0.002], [-0.04, -0.002 * k, z - 0.004], [-0.028, 0.013 * k, z - 0.006]], r, [-1, 0.1, 0]);
    ell(g, 'leather', 0.0075, 0.006, 0.0085, -0.042, -0.026, z - 0.002);                 // knuckle pad
  }
  finger(g, [[0.014, -0.048, hz + 0.034], [0.024, -0.034, hz + 0.016], [0.029, -0.02, hz + 0.0], [0.03, -0.006, hz - 0.016]], 0.0094, [1, 0, 0]);   // thumb
  if (!sup) capsule(g, handMat('skin'), 0.019, [-0.012, -0.062, hz + 0.042], [-0.034, -0.085, hz + 0.075]);   // wrist (pack guns: the laid forearm is the wrist)
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.027, 0.016, 28), handMat('leather'));
  cuff.position.set(-0.016, -0.067, hz + 0.05);
  cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.024, -0.025, 0.035).normalize());
  g.add(cuff);
  // forearm: fixed under the gun when the hand never moves; pack guns lay it to the shoulder
  // every frame (supportArm), so it never swings through the gun
  if (!sup) {
    const fa = new THREE.Mesh(forearmGeo(0.021, 0.034), handMat('skin')), A = new THREE.Vector3(-0.034, -0.085, hz + 0.075), B = new THREE.Vector3(-0.17, -0.38, hz + 0.34);
    fa.position.copy(A); fa.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); fa.scale.y = A.distanceTo(B); g.add(fa);
  } else sup.userData.wrist = new THREE.Vector3(-0.02 + 0.004, -0.07 + 0.04, 0.054);   // palm-relative, inside the glove's cuff (no gap)
  const palm0 = new THREE.Vector3(-0.004, -0.04, hz);
  if (sup) { for (const c of sup.children) c.position.sub(palm0); sup.position.copy(palm0); }
  g = g0;
  // Firing (right) hand round the grip: fist on the right side, three fingers round the front,
  // the index finger straight along the frame, the thumb over the left side.
  const gz = GRIP_Z[type];
  ell(g, 'leather', 0.02, 0.036, 0.027, 0.014, -0.088, gz + 0.03, 0.3, 0, 0);             // the fist's back and palm
  vents(g, [0.034, -0.08, gz + 0.03], [1, 0, 0.2], [0, -1, 0.3]);
  for (let k = 0; k < 3; k++) {
    const y = -0.07 - k * 0.017;
    finger(g, [[0.026, y, gz + 0.012], [0.02, y, gz - 0.022], [0.0, y - 0.002, gz - 0.03], [-0.016, y - 0.004, gz - 0.02]], 0.0085 - k * 0.0005, [0, 0, -1]);
    ell(g, 'leather', 0.006, 0.0075, 0.0075, 0.031, y, gz + 0.008);                       // knuckle pad
  }
  finger(g, [[0.026, -0.05, gz + 0.012], [0.027, -0.038, gz - 0.012], [0.027, -0.033, gz - 0.035], [0.027, -0.031, gz - 0.056]], 0.0082, [1, 0.3, 0]);   // index along the frame
  finger(g, [[0.01, -0.06, gz + 0.04], [-0.006, -0.052, gz + 0.03], [-0.022, -0.052, gz + 0.016], [-0.026, -0.056, gz - 0.002]], 0.0095, [-1, 0.3, 0]);    // thumb
  capsule(g, handMat('skin'), 0.025, [0.02, -0.12, gz + 0.055], [0.05, -0.18, gz + 0.1]);   // wrist
  const cuff2 = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.031, 0.018, 28), handMat('leather'));
  cuff2.position.set(0.022, -0.125, gz + 0.058);
  cuff2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.03, -0.06, 0.045).normalize());
  g.add(cuff2);
  const fa2 = new THREE.Mesh(forearmGeo(0.025, 0.038), handMat('skin')), A2 = new THREE.Vector3(0.05, -0.18, gz + 0.1), B2 = new THREE.Vector3(0.14, -0.44, gz + 0.24);
  fa2.position.copy(A2); fa2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B2.clone().sub(A2).normalize()); fa2.scale.y = A2.distanceTo(B2); g.add(fa2);
  return palm0;
}


/* ---------- Black Ice: 3D ice crystals ---------- */
// A short ridge of faceted frost follows the top edges and wraps around the muzzle.
const iceMats = new Map();
const TAU = Math.PI * 2;
function iceMaterial(def, inspect) {
  const level = sightShading();
  const sh = !inspect && (level === 'high' || level === 'ultra') ? 'detailed' : level;
  const key = sh + '|' + def.id;
  if (!inspect && iceMats.has(key)) return iceMats.get(key);
  const c = new THREE.Color(...def.ice);
  const surface = { vertexColors: true, transparent: true, flatShading: true };
  let m;
  if (sh === 'fast') m = new THREE.MeshMatcapMaterial({ ...surface, matcap: matcap('metal'), opacity: 0.90 });
  else if (sh === 'detailed') m = new THREE.MeshStandardMaterial({ ...surface, roughness: 0.13, metalness: 0.04, opacity: 0.87, envMap: ENV, envMapIntensity: 2, emissive: c.clone().multiplyScalar(0.07) });
  else m = new THREE.MeshPhysicalMaterial({ ...surface, roughness: 0.13, metalness: 0.04, opacity: 0.83, clearcoat: 1, clearcoatRoughness: 0.035,
    ior: 1.31, iridescence: 0.19, iridescenceIOR: 1.35, envMap: highEnv(), envMapIntensity: 2.4, emissive: c.clone().multiplyScalar(0.065) });
  if (!inspect) { iceMats.set(key, m); return m; }
  // Each rig grows its own crystals along the frost front, then returns to the resting ridge.
  const u = { iceT: { value: 1 }, iceGlow: { value: 0 }, iceFront: { value: 0 } };
  m.userData.ice = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute vec3 iceBase; attribute float iceRnd; uniform float iceT, iceFront; varying float vIceSpark;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float grow = smoothstep(0.10 + iceRnd * 0.07, 0.44, iceT) * (1.0 - smoothstep(0.70, 1.0, iceT));
        grow *= smoothstep(-0.025, 0.075, iceFront - iceBase.z);
        transformed = iceBase + (transformed - iceBase) * (1.0 + grow * (0.24 + 0.33 * iceRnd));
        vIceSpark = grow * (0.1 + pow(max(0.0, sin(iceT * 27.0 + iceRnd * 76.0)), 10.0));`);
    sh.fragmentShader = 'uniform float iceGlow; varying float vIceSpark;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight += vec3(0.53, 0.78, 1.0) * vIceSpark * (0.38 + iceGlow * 0.72);\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'ice-inspect-' + sh;
  return m;
}
const FROST_FACETS = [
  [[0, 0], [0.82, 0], [1, 0.24], [0.63, 0.64], [0, 1]],
  [[0, 0], [0.76, 0], [1, 0.32], [0.37, 0.85], [0, 1]],
].map((profile, i) => {
  const indexed = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 5 + i);
  const facets = indexed.toNonIndexed();
  const vertices = facets.attributes.position;
  indexed.dispose(); facets.dispose();
  return vertices;
});

function iceCrystals(g, def, type, muzzle, inspect = true) {
  const rng = mulberry32(def.id * 977 + type.length * 31);
  const pos = [], col = [], base = [], rnds = [], anchors = [];
  const parts = g.children.filter(o => o.isMesh);
  const bounds = new THREE.Box3().setFromObject(g);
  const length = bounds.max.z - bounds.min.z;
  const [my, mz] = muzzle;
  const ray = new THREE.Raycaster(), hits = [];
  const normalMatrix = new THREE.Matrix3();
  const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3(), axis = new THREE.Vector3();
  const point = new THREE.Vector3(), origin = new THREE.Vector3(), scale = new THREE.Vector3();
  const turn = new THREE.Quaternion(), spin = new THREE.Quaternion();
  const tint = new THREE.Color(...def.ice).lerp(new THREE.Color(0xe5f5ff), 0.44);
  const white = new THREE.Color(0xf6fcff), color = new THREE.Color();

  function grow(hit, height, width) {
    const frost = FROST_FACETS[rng() < 0.58 ? 0 : 1];
    const rand = rng(), shade = 0.84 + rng() * 0.16;
    origin.copy(hit.point).addScaledVector(normal, -0.00095);
    axis.copy(normal).add(point.set((rng() - 0.5) * 0.52, (rng() - 0.5) * 0.32, (rng() - 0.5) * 0.52)).normalize();
    turn.setFromUnitVectors(up, axis).multiply(spin.setFromAxisAngle(up, rng() * TAU));
    scale.set(width, height, width);
    for (let i = 0; i < frost.count; i++) {
      color.copy(tint).lerp(white, frost.getY(i) * 0.9).multiplyScalar(shade);
      point.fromBufferAttribute(frost, i).multiply(scale).applyQuaternion(turn).add(origin);
      pos.push(point.x, point.y, point.z); col.push(color.r, color.g, color.b);
      if (inspect) { base.push(origin.x, origin.y, origin.z); rnds.push(rand); }
    }
    if (inspect) anchors.push({ point: origin.clone().addScaledVector(axis, height * 0.35), normal: axis.clone() });
  }

  function surface() {
    hits.length = 0;
    const hit = ray.intersectObjects(parts, false, hits)[0];
    if (hit) normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
    return hit;
  }

  // Trace the exposed crown on either side of the rail, with denser frost up front.
  const lane = Math.min(0.016, SPEC[type].hw * 0.65);
  const stride = inspect ? 0.007 : 0.018;
  for (let z = Math.max(bounds.min.z + 0.011, mz + 0.012); z < bounds.max.z - 0.012; z += stride) {
    const front = 1 - smooth01(mz + length * 0.19, mz + length * 0.58, z);
    for (const side of [-1, 1]) {
      if (rng() > 0.59 + front * 0.37) continue;
      ray.ray.origin.set(side * lane * (0.58 + rng() * 0.67), bounds.max.y + 0.025, z + (rng() - 0.5) * stride * 0.72);
      ray.ray.direction.set(0, -1, 0);
      const hit = surface();
      if (!hit || hit.point.y < 0.016 || normal.y < 0.34) continue;
      const height = Math.min(0.013, (0.0034 + rng() * 0.0063) * def.crystalShape * (0.74 + front * 0.36));
      grow(hit, height, 0.0027 + rng() * 0.0026);
    }
  }

  // Two uneven frost patches hug the muzzle collar and the forward housing.
  const reach = Math.min(0.145, length * 0.24);
  const bands = [[0.008, Math.min(0.035, reach * 0.44), inspect ? 62 : 19],
    [reach * 0.68, reach * 0.29, inspect ? 42 : 14]];
  for (const [offset, width, count] of bands) {
    for (let i = 0; i < count; i++) {
      const angle = rng() * TAU, nx = Math.cos(angle), ny = Math.sin(angle);
      if (ny < -0.22 && offset > 0.04 && rng() < 0.43) continue;
      ray.ray.origin.set(nx * 0.095, my + ny * 0.095, bounds.min.z + offset + rng() * width);
      ray.ray.direction.set(-nx, -ny, 0);
      const hit = surface();
      if (!hit || normal.dot(ray.ray.direction) > -0.36 || Math.hypot(hit.point.x, hit.point.y - my) > 0.046) continue;
      grow(hit, Math.min(0.0118, (0.0032 + rng() * 0.006) * def.crystalShape), 0.0025 + rng() * 0.0026);
    }
  }

  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  if (inspect) {
    geo.setAttribute('iceBase', new THREE.Float32BufferAttribute(base, 3));
    geo.setAttribute('iceRnd', new THREE.Float32BufferAttribute(rnds, 1));
  }
  const mesh = new THREE.Mesh(geo, iceMaterial(def, inspect));
  mesh.frustumCulled = !inspect;
  mesh.renderOrder = 1;
  g.add(mesh);
  return { mesh, anchors };
}

const sakuraMats = new Map();
const epicMats = new Map();
const PETAL = new THREE.SphereGeometry(1, 8, 6);
function epicInlays(gun, skin) {
  const sh = shading(), key = sh + '|' + skin.id;
  if (!epicMats.has(key)) {
    const colors = skin.c.map(c => new THREE.Color(...c));
    const dark = colors[0].lerp(new THREE.Color(0x171d29), 0.58);
    const enamel = colors[1].lerp(colors[2], 0.20);
    const trim = colors[3].lerp(new THREE.Color(0xded9bd), 0.38);
    epicMats.set(key, [dark, enamel, trim].map((color, i) => {
      const name = 'Epic inlay';
      if (sh === 'fast') return new THREE.MeshMatcapMaterial({ name, color, matcap: matcap('metal') });
      return new THREE.MeshStandardMaterial({ name, color, metalness: [0.46, 0.28, 0.68][i], roughness: [0.39, 0.25, 0.24][i],
        envMap: highEnv() || ENV, envMapIntensity: 1.45 });
    }));
  }
  epicRelief(gun, skin, epicMats.get(key));
}

// on the painted flowers of the R4-C concept: [y, z, size] (tools: the concept's pixels, see r4-model.js)
const SAKURA_SPOTS = [[0.009, -0.2878, 0.0104], [0.0238, -0.3163, 0.0066], [0.0079, -0.35, 0.0104], [0.0058, -0.4038, 0.0095], [-0.0543, -0.1137, 0.0104], [-0.0374, -0.139, 0.0076], [-0.0628, -0.1369, 0.0057]];
function sakuraInlays(gun, inspect = false) {
  const sh = shading();
  if (!sakuraMats.has(sh)) {
    const enamel = (color, roughness, metalness) => {
      if (sh === 'fast') return new THREE.MeshMatcapMaterial({ color, matcap: matcap('metal') });
      const finish = { color, roughness, metalness, envMap: sakuraEnv(), envMapIntensity: 1.1 };
      return sh === 'detailed' ? new THREE.MeshStandardMaterial(finish)
        : new THREE.MeshPhysicalMaterial({ ...finish, clearcoat: 1, clearcoatRoughness: 0.065 });
    };
    sakuraMats.set(sh, [enamel(0xe37ba2, 0.13, 0.43), enamel(0xbb4f7b, 0.13, 0.48), enamel(0xffd36f, 0.15, 0.85), enamel(0x8b6136, 0.42, 0.68)]);
  }
  const [pink, rose, gold, agedGold] = sakuraMats.get(sh);
  agedGold.name = 'Tarnished gilt';
  // (the gilt is in the painting now: no separate gold plates)
  const surfaces = [...gun.children];
  gun.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const normalMatrix = new THREE.Matrix3();
  const blossoms = [];
  // Sample the real exterior at the receiver, grip, handguard and stock on each model LOD.
  for (const side of [-1, 1]) {
    for (const [y, z, size] of SAKURA_SPOTS) {
      ray.ray.origin.set(side * 0.09, y, z);
      ray.ray.direction.set(-side, 0, 0);
      const hit = ray.intersectObjects(surfaces, false)[0];
      if (!hit) continue;
      const n = hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
      if (Math.abs(n.x) < 0.65) continue;
      const flower = new THREE.Group();
      flower.position.copy(hit.point).addScaledVector(n, 0.0007);
      flower.quaternion.setFromUnitVectors(zAxis, n);
      if (inspect) blossoms.push({ point: flower.position.clone(), normal: n, rotation: flower.quaternion.clone(), size });
      for (let i = 0; i < 5; i++) {
        const a = i * TAU / 5 + z * 14;
        const petal = new THREE.Mesh(PETAL, i % 2 ? rose : pink);
        petal.position.set(Math.cos(a) * size * 0.50, Math.sin(a) * size * 0.50, size * 0.12);
        petal.rotation.z = a;
        petal.scale.set(size * 0.56, size * 0.34, size * 0.16);
        flower.add(petal);
      }
      const centre = new THREE.Mesh(PETAL, gold);
      centre.scale.set(size * 0.24, size * 0.24, size * 0.22);
      flower.add(centre);
      gun.add(flower);
    }
    for (const row of [-1, 1]) for (let i = 0; i < 12; i++) {
      ray.ray.origin.set(side * 0.019, row * 0.07, -0.154 - i * 0.0114);
      ray.ray.direction.set(0, -row, 0);
      const hit = ray.intersectObjects(surfaces, false)[0];
      if (!hit) continue;
      const bead = new THREE.Mesh(PETAL, i % 3 ? pink : gold);
      bead.position.copy(hit.point);
      const size = 0.0012 + (i * 7 % 5) * 0.00033;
      bead.scale.set(size, size * 1.15, size * 1.38);
      gun.add(bead);
    }
  }
  return blossoms;
}

// Painted Legendaries: raised relief traced from the painting (it wears the same skin and lifts in
// the inspect), plus each skin's own pieces: Storm Kiln's stainless moon; Abyssal Crown's glass depth
// dial with its needle and the teal gem in the stock. Both sides, placed on the real surface.
const kilnMats = new Map();
const MOON = new THREE.CylinderGeometry(1, 1, 0.12, 28), BEAD = new THREE.SphereGeometry(1, 16, 10, 0, TAU, 0, Math.PI / 2);
function artInlays(gun, skin, model, inspect = false) {
  const sh = shading();
  if (!kilnMats.has(sh)) {
    const glaze = (color, roughness, metalness) => {
      if (sh === 'fast') return new THREE.MeshMatcapMaterial({ color, matcap: matcap('metal') });
      const finish = { color, roughness, metalness, envMap: highEnv() || ENV, envMapIntensity: 1.2 };
      return sh === 'detailed' ? new THREE.MeshStandardMaterial(finish) : new THREE.MeshPhysicalMaterial({ ...finish, clearcoat: 1, clearcoatRoughness: 0.04 });
    };
    kilnMats.set(sh, [glaze(0xeee6d4, 0.16, 0), glaze(0x1d3a9a, 0.14, 0), glaze(0xd9dde5, 0.22, 0.35)]);
  }
  const [ivory, cobalt, steel] = kilnMats.get(sh);
  const surfaces = [...gun.children];
  gun.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), zAxis = new THREE.Vector3(0, 0, 1), normalMatrix = new THREE.Matrix3();
  const onSurface = (side, y, z) => {
    ray.ray.origin.set(side * 0.1, y, z); ray.ray.direction.set(-side, 0, 0);
    const hit = ray.intersectObjects(surfaces, false)[0];
    if (!hit) return null;
    const n = hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
    return Math.abs(n.x) < 0.6 ? null : { point: hit.point, normal: n };
  };
  // concept image pixels (1400 wide) -> gun space [z, y], from the skin's art rectangle
  const [z0, z1, y0, y1] = skin.artRect, at = (x, y) => [z0 + (z1 - z0) * x / 1400, y1 - (y1 - y0) * y / 933];
  const reliefs = [], dials = [];
  const half = (model.body.depth || 0.05) / 2;
  for (const side of [-1, 1]) {
    const [mz, my] = at(822, 300);
    const m = skin.artLook === 'porcelain' && onSurface(side, my, mz);
    if (m) {
      const moon = new THREE.Mesh(MOON, steel);
      moon.position.copy(m.point).addScaledVector(m.normal, 0.0004);
      moon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), m.normal);
      moon.scale.set(0.0125, 0.0125, 0.0125);
      gun.add(moon);
    }
    // Raised glaze traced from the painting (f2-model.js): the waves on the stock and the scroll band
    // on the handguard, wearing the same painted skin; the biggest wave is the crest.
    const glazeMat = gun.children.find((c) => c.isMesh)?.material || ivory;
    const biggest = Math.max(...model.relief.map((r) => r.area));
    for (const r of model.relief || []) {
      const depth = r.kind === 'wave' ? 0.0042 : 0.003;
      const mesh = traced(gun, { outer: r.outer, depth }, 0);
      mesh.material = glazeMat;
      mesh.userData.hd = true;                  // kept out of the merged gun mesh: the inspect moves it
      mesh.position.x = side * (half + depth / 2 - 0.0008);    // (only moved across: the painting is looked up in gun space)
      if (inspect) reliefs.push({ group: mesh, base: mesh.position.clone(), normal: new THREE.Vector3(side, 0, 0), size: 0.008, crest: biggest > 0 && r.area === biggest, ring: r.centre });
    }
    if (skin.artLook === 'bronze') {
      // the depth dial: a domed glass over the painted face, and a needle under it
      const [dz, dy] = at(912, 405), R = 47 * (z1 - z0) / 1400;
      const face = onSurface(side, dy, dz);
      if (face) {
        const dial = new THREE.Group();
        dial.position.copy(face.point);
        dial.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.normal);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 10, 0, TAU, 0, 0.62), new THREE.MeshPhysicalMaterial({
          color: 0xd8fff4, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, envMap: highEnv() || ENV, envMapIntensity: 1.6, depthWrite: false }));
        dome.rotation.x = Math.PI / 2; dome.scale.set(1, 0.35, 1); dome.renderOrder = 2;
        const needle = new THREE.Mesh(new THREE.BoxGeometry(R * 0.035, R * 0.62, R * 0.03), new THREE.MeshStandardMaterial({ color: 0xd8b878, metalness: 0.6, roughness: 0.35 }));
        needle.geometry.translate(0, R * 0.28, 0);
        needle.position.z = R * 0.08; needle.rotation.z = -0.6;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.08, 8, 40), new THREE.MeshStandardMaterial({ color: 0x8a6a3e, metalness: 1, roughness: 0.32 }));
        dial.add(dome, needle, ring);
        for (const o of [dome, needle, ring]) o.userData.hd = true;     // separate (the needle moves; the glass is see-through)
        gun.add(dial);
        dials.push({ needle, rest: needle.rotation.z });
      }
      // the teal cabochon set in the stock's nautilus
      const [gz, gy] = at(1307, 438), gem = onSurface(side, gy, gz);
      if (gem) {
        const stone = new THREE.Mesh(BEAD, new THREE.MeshPhysicalMaterial({ color: 0x0f6f66, emissive: 0x0b5a50, emissiveIntensity: 0.6, roughness: 0.05, clearcoat: 1, envMap: highEnv() || ENV }));
        stone.position.copy(gem.point);
        stone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), gem.normal);
        stone.scale.set(14 * (z1 - z0) / 1400, 20 * (z1 - z0) / 1400, 0.004);
        gun.add(stone);
      }
    }
  }
  // where water drips from (the underside of the body) and where glints rise (points over the sides)
  const under = [], surface = [], out = model.body.outer;
  const bins = new Map();
  for (const [z, y] of out) { const k = Math.round(z / 0.02); if (!bins.has(k) || y < bins.get(k)[1]) bins.set(k, [z, y]); }
  for (const [z, y] of bins.values()) for (const side of [-1, 1]) under.push({ point: new THREE.Vector3(side * half * 0.8, y, z), normal: new THREE.Vector3(0, -1, 0) });
  const inside = (z, y) => { let c = false; for (let i = 0, j = out.length - 1; i < out.length; j = i++) { const [zi, yi] = out[i], [zj, yj] = out[j]; if ((yi > y) !== (yj > y) && z < (zj - zi) * (y - yi) / (yj - yi) + zi) c = !c; } return c; };
  const zs = out.map((p) => p[0]), ys = out.map((p) => p[1]);
  const [zMin, zMax, yMin, yMax] = [Math.min(...zs), Math.max(...zs), Math.min(...ys), Math.max(...ys)];
  for (let i = 0, seed = 7; surface.length < 80 && i < 2000; i++) {
    seed = (seed * 16807) % 2147483647; const z = zMin + (zMax - zMin) * (seed / 2147483647);
    seed = (seed * 16807) % 2147483647; const y = yMin + (yMax - yMin) * (seed / 2147483647);
    if (inside(z, y)) { const side = i % 2 ? 1 : -1; surface.push({ point: new THREE.Vector3(side * (half + 0.002), y, z), normal: new THREE.Vector3(side, 0, 0) }); }
  }
  // Sakura Gilt: roots that creep over both sides in the inspect (grown along their length)
  const roots = [];
  if (inspect && skin.artLook === 'lacquer') {
    const bark = new THREE.MeshStandardMaterial({ color: 0x2b1a12, roughness: 0.85, metalness: 0, envMap: highEnv() || ENV, envMapIntensity: 0.4 });
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const stem = new THREE.MeshStandardMaterial({ color: 0x5f8f3c, roughness: 0.6 }), leaf = new THREE.MeshStandardMaterial({ color: 0x86c45a, roughness: 0.5, side: THREE.DoubleSide });
    const petal = new THREE.MeshStandardMaterial({ color: 0xffa6c9, roughness: 0.45, emissive: 0x401020 }), bud = new THREE.MeshStandardMaterial({ color: 0xffd36a, roughness: 0.5 });
    const STEM = new THREE.CylinderGeometry(0.0004, 0.0009, 0.012, 5), LEAF = new THREE.SphereGeometry(1, 8, 6);
    // a sprout: a little stem out of the root and two leaves (each its own mesh: they grow in the inspect)
    const sprout = (side, at, p) => {
      const out = [], tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(side, 0.5 + rnd() * 0.6, rnd() - 0.6).normalize());
      const s = new THREE.Mesh(STEM, stem);
      s.position.copy(p).add(new THREE.Vector3(0, 0.006, 0).applyQuaternion(tilt)); s.quaternion.copy(tilt); out.push(s);
      const tipP = p.clone().add(new THREE.Vector3(0, 0.012, 0).applyQuaternion(tilt));
      for (const k of [-1, 1]) {
        const l = new THREE.Mesh(LEAF, leaf);
        l.position.copy(tipP).add(new THREE.Vector3(k * 0.003, 0, 0).applyQuaternion(tilt));
        l.quaternion.copy(tilt).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), k * 0.9));
        l.scale.set(0.0042, 0.0014, 0.0026); out.push(l);
      }
      if (rnd() < 0.7) {                                      // most sprouts carry a blossom
        const top = tipP.clone().add(new THREE.Vector3(0, 0.003, 0).applyQuaternion(tilt));
        for (let k = 0; k < 5; k++) {
          const pt = new THREE.Mesh(LEAF, petal), a = k / 5 * Math.PI * 2;
          pt.position.copy(top).add(new THREE.Vector3(Math.cos(a) * 0.0028, 0, Math.sin(a) * 0.0028).applyQuaternion(tilt));
          pt.quaternion.copy(tilt).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a));
          pt.scale.set(0.0026, 0.0007, 0.0018); out.push(pt);
        }
        const c = new THREE.Mesh(LEAF, bud); c.position.copy(top); c.scale.setScalar(0.0011); out.push(c);
      }
      for (const m of out) { m.userData.hd = true; m.userData.at = at; m.userData.base = m.scale.clone(); m.visible = false; gun.add(m); }
      return out;
    };
    const grow = (side, z, y, heading, steps, r) => {
      const lift = side * (half + r * 0.7);                  // half sunk into the glaze, half standing out
      const pts = [new THREE.Vector3(lift, y, z)];
      for (let i = 0; i < steps; i++) {
        let ok = false;
        for (let t = 0; t < 4 && !ok; t++) {
          heading += (rnd() - 0.5) * 0.7 + (t ? 0.9 : 0);
          const nz = z + Math.cos(heading) * 0.011, ny = y + Math.sin(heading) * 0.011;
          if (inside(nz, ny)) { z = nz; y = ny; ok = true; }
        }
        if (!ok) break;
        pts.push(new THREE.Vector3(lift, y, z));
        if (r > 0.0012 && rnd() < 0.12) grow(side, z, y, heading + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.6), Math.floor(steps * 0.5), r * 0.6);   // a side root
      }
      if (pts.length < 3) return;
      const curve = new THREE.CatmullRomCurve3(pts), segs = pts.length * 3;
      const geo = new THREE.TubeGeometry(curve, segs, r, 6, false), pos = geo.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
      for (let i = 0; i <= segs; i++) {                      // thick at the base, thin at the tip
        curve.getPointAt(i / segs, c);
        const k = 1 - 0.82 * i / segs;
        for (let j = 0; j <= 6; j++) { const n = i * 7 + j; v.fromBufferAttribute(pos, n).sub(c).multiplyScalar(k).add(c); pos.setXYZ(n, v.x, v.y, v.z); }
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, bark);
      mesh.userData.hd = true; mesh.geometry.setDrawRange(0, 0); mesh.visible = false;
      mesh.userData.sprouts = [];
      for (let i = 3; i < pts.length; i += 3) mesh.userData.sprouts.push(...sprout(side, i / pts.length, pts[i]));
      gun.add(mesh); roots.push(mesh);
    };
    for (const side of [-1, 1]) for (let n = 0; n < 7; n++) {
      // from the grip and the stock, climbing up and spreading forward
      const [z, y] = bins.size ? [...bins.values()][Math.floor(rnd() * bins.size)] : [0, 0];
      if (inside(z, y + 0.006)) grow(side, z, y + 0.006, Math.PI * (0.35 + rnd() * 0.5), 34, 0.0042 + rnd() * 0.002);
    }
  }
  // Forgeheart: under each ceramic plate, a molten channel behind smoked glass (hidden until the
  // plates lift), and points along the split for the sparks.
  const channels = [], seam = [], shards = [];
  if (inspect && skin.artLook === 'forge') {
    const smoked = new THREE.MeshPhysicalMaterial({ color: 0x120806, emissive: 0xff5a0a, emissiveIntensity: 0, roughness: 0.05, metalness: 0, clearcoat: 1, envMap: highEnv() || ENV });
    for (const r of model.relief) for (const side of [-1, 1]) {
      const ch = traced(gun, { outer: r.outer, depth: 0.0015 }, 0);
      ch.material = smoked; ch.userData.hd = true;
      ch.position.x = side * (half + 0.00075 - 0.0008);
      channels.push(ch);
      const low = r.outer.reduce((a, b) => (b[1] < a[1] ? b : a));        // the plate's lower edge, on the seam
      for (let i = 0; i < 6; i++) {
        const [pz, py] = r.outer[Math.floor(i / 6 * r.outer.length)];
        seam.push({ point: new THREE.Vector3(side * (half + 0.001), Math.min(py, low[1] + 0.004), pz), normal: new THREE.Vector3(side, 0.3, 0).normalize() });
      }
    }
    smoked.userData.forge = true;
    // the shards of the peak, traced from the owner's peak concept (04-forgeheart-peak.webp, on the base
    // concept's frame, 1536 x 1024 px): raised slabs wearing the same painting, which fades to the peak
    const px = ([x, y]) => [z0 + (z1 - z0) * x / 1536, y1 - (y1 - y0) * y / 1024];
    const SHARDS = [
      [[355, 345], [385, 326], [455, 316], [440, 342], [400, 353]], [[440, 346], [505, 319], [532, 315], [520, 341], [480, 356]],
      [[565, 336], [612, 326], [660, 368], [690, 398], [640, 382], [600, 362]],
      [[350, 440], [400, 415], [455, 400], [470, 420], [420, 450], [370, 460]], [[440, 405], [500, 386], [560, 395], [540, 420], [480, 426]],
      [[560, 396], [620, 386], [690, 402], [640, 421], [590, 421]],
      [[720, 395], [790, 370], [850, 345], [880, 330], [860, 365], [800, 395]], [[850, 350], [900, 330], [960, 322], [955, 346], [900, 376]],
      [[800, 401], [880, 386], [960, 376], [940, 401], [870, 411]],
    ];
    for (const poly of SHARDS) for (const side of [-1, 1]) {
      const depth = 0.007, mesh = traced(gun, { outer: poly.map(px), depth }, 0);
      mesh.material = gun.children.find((c) => c.isMesh && c.material.userData?.tri?.artMap)?.material || ivory; mesh.userData.hd = true; mesh.visible = false;
      mesh.position.x = side * (half + depth / 2 - 0.0008);
      const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
      shards.push({ group: mesh, base: mesh.position.clone(), side, start: 0.38 + Math.abs(cx - 705) / 1536 * 0.4 });
    }
  }
  // Storm Kiln: a charm hanging under the stock on a short chain, a porcelain disc with a cobalt
  // rim and a silver moon (it thrashes in the wind in the inspect)
  let charm = null;
  if (skin.artLook === 'porcelain') {
    const near = out.filter(([z]) => Math.abs(z - 0.12) < 0.02);
    const cy = near.length ? Math.min(...near.map(([, y]) => y)) : -0.05;
    charm = new THREE.Group(); charm.position.set(0, cy + 0.001, 0.12);
    const link = new THREE.TorusGeometry(0.0034, 0.0008, 6, 12);
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(link, steel); l.position.y = -0.0025 - i * 0.0058; l.rotation.y = i % 2 ? Math.PI / 2 : 0; charm.add(l);
    }
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.003, 28), ivory); disc.rotation.z = Math.PI / 2; disc.position.y = -0.042;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0013, 6, 28), cobalt); rim.rotation.y = Math.PI / 2; rim.position.y = -0.042;
    charm.add(disc, rim);
    for (const side of [-1, 1]) {
      const moon = new THREE.Mesh(MOON, steel); moon.scale.setScalar(0.0068);
      moon.position.set(side * 0.0016, -0.042, 0); moon.rotation.z = side * Math.PI / 2; charm.add(moon);
    }
    charm.userData.keepGroup = true;
    gun.add(charm);
  }
  return { reliefs, dials, under, surface, roots, channels, seam, shards, charm: inspect ? charm : null, muzzle: SPEC[Object.keys(TRACED).find((t) => TRACED[t] === model)]?.muzzle };
}

/* ---------- moving parts and ultra detail (gun coordinates) ---------- */
// half receiver width, ejection port z, muzzle [y, z], trigger z, handguard [y, from, to]
const SPEC = {
  rifle: { hw: 0.025, port: 0.0, muzzle: [0.012, -0.545], trig: 0.0, hg: [0.004, -0.19, -0.37] },
  carbine: { hw: 0.025, port: 0.0, muzzle: [0.0047, -0.523], trig: -0.029, hg: null },     // the traced R4-C (r4-model.js)
  smg: { hw: 0.024, port: 0.02, muzzle: [0.01, -0.225], trig: 0.0, hg: null },
  lmg: { hw: 0.0275, port: 0.0, muzzle: [0.0076, -0.639], trig: -0.004, hg: null },     // the traced G8A1 (g8-model.js)
  marksman: { hw: 0.024, port: 0.0, muzzle: [0.012, -0.655], trig: 0.0, hg: [0.002, -0.18, -0.4] },
};
const DARK = 0x0d0e10;

// Bolt carrier seen through the ejection port, with its charging handle; slides back per shot.
function boltGroup(type) {
  const sp = SPEC[type], g = new THREE.Group();
  if (TRACED[type]) return g;                   // traced guns: the painting already shows the bolt (a part would float over it)
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

const TOP_Y = { rifle: 0.035, carbine: 0.0545, smg: 0.0375, lmg: 0.049, marksman: 0.035 };

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
// The F2 (bullpup), traced from the Storm Kiln concept at real size (f2-model.js): each part is its
// outline extruded across the gun with rounded edges. The grip and handguard sit where the hands go.
function traced(g, o, color, kind = 'auto') {
  const v = (p) => new THREE.Vector2(p[0], p[1]);
  const shape = new THREE.Shape(o.outer.map(v));
  for (const h of o.holes || []) shape.holes.push(new THREE.Path(h.map(v)));
  const d = o.depth, bevel = Math.min(0.006, d * 0.3);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 6 });
  geo.rotateY(-Math.PI / 2);                      // outline x -> gun z, extruded across x
  geo.translate(d / 2 - bevel, 0, 0);
  const uv = geo.attributes.uv.array;             // outline units are metres: a texture tile every 5 cm
  for (let i = 0; i < uv.length; i++) uv[i] *= 20;
  const m = new THREE.Mesh(geo, mat(color, kind));
  g.add(m);
  return m;
}
// Guns rebuilt from their Legendary's concept: the outlines in js/scene/*-model.js. Parts marked
// paint wear a painted skin (the concept shows them finished), else they stay black or steel.
const SIGHT_Z = { bullpup: -0.08, carbine: 0.01 };     // gun z under the sight (default 0.05 / 0.62)
const TRACED = { bullpup: F2, lmg: G8, sfw: C8, carbine: R4, ak: AK, evo: EVO, compact: MP5K, smg: T5, machinepistol: SMG11, pdw: MP7 };
function tracedGun(model) {
  return (g, c, mg) => {
    const painted = !!currentSkin()?.art;
    traced(g, model.body, c);
    for (const p of model.parts) traced(g, p, p.paint && painted ? c : p.color === 'steel' ? STEEL : BLACK, p.color === 'steel' ? 'metal' : 'auto');
    traced(mg, model.mag, model.mag.paint && painted ? c : BLACK);
  };
}
for (const [type, model] of Object.entries(TRACED)) BUILDERS[type] = tracedGun(model);
Object.assign(TOP_Y, { evo: 0.032, bullpup: 0.1305, machinepistol: 0.035, ak: 0.044, compact: 0.035, sfw: 0.0459, pdw: 0.035 });
Object.assign(RAILS, {
  evo: [[0.032, 0.14, -0.24]], bullpup: [], machinepistol: [[0.035, 0.08, -0.08]],
  ak: [[0.044, 0.12, -0.12]], compact: [[0.035, 0.1, -0.1]], sfw: [], pdw: [[0.035, 0.11, -0.12]],
});
Object.assign(HAND_Z, { evo: -0.2, bullpup: -0.32, machinepistol: -0.07, ak: -0.26, compact: -0.13, sfw: -0.3, pdw: -0.09 });
Object.assign(GRIP_Z, { evo: 0.07, bullpup: -0.12, machinepistol: 0.03, ak: 0.07, compact: 0.06, sfw: 0.05, pdw: 0.02 });
// The rest of the Legendaries' guns, traced from their concepts (ak-, evo-, compact-, smg-,
// machinepistol-, pdw-model.js): rail tops, muzzles, and the MP5K / MP7 hand on its vertical grip.
const TRACED_FIT = {
  ak: { top: 0.0728, hw: 0.025, muzzle: [-0.002, -0.585] }, evo: { top: 0.0763, hw: 0.023, muzzle: [0.0122, -0.304] },
  compact: { top: 0.0661, hw: 0.023, muzzle: [0.0111, -0.304], hand: -0.19 }, smg: { top: 0.0905, hw: 0.023, muzzle: [0.0267, -0.238] },
  machinepistol: { top: 0.0855, hw: 0.021, muzzle: [0.0178, -0.198] }, pdw: { top: 0.0924, hw: 0.022, muzzle: [0.0114, -0.293], hand: -0.175 },
};
Object.assign(SPEC, {
  evo: { hw: 0.023, port: 0, muzzle: [0.008, -0.385], trig: 0, hg: [0, -0.15, -0.25] },
  bullpup: { hw: 0.025, port: 0.05, muzzle: [0.0169, -0.535], trig: -0.228, hg: null },
  machinepistol: { hw: 0.02, port: 0, muzzle: [0.01, -0.158], trig: 0, hg: null },
  ak: { hw: 0.025, port: 0, muzzle: [0.01, -0.595], trig: 0, hg: [0, -0.18, -0.35] },
  compact: { hw: 0.022, port: 0.02, muzzle: [0, -0.21], trig: 0.02, hg: null },
  sfw: { hw: 0.025, port: 0, muzzle: [0.0042, -0.544], trig: -0.04, hg: null },     // the traced C8-SFW (c8-model.js)
  pdw: { hw: 0.021, port: 0, muzzle: [0.008, -0.208], trig: 0, hg: null },
});
for (const [type, f] of Object.entries(TRACED_FIT)) {
  TOP_Y[type] = f.top; RAILS[type] = [];
  SPEC[type] = { hw: f.hw, port: GRIP_Z[type] - 0.07, muzzle: f.muzzle, trig: GRIP_Z[type] - 0.05, hg: null };
  if (f.hand) HAND_Z[type] = f.hand;
}


/* ---------- Attachments (Milestone 8, js/core/loadout.js codes) ---------- */
// Adds the attachments of a loadout code to a gun built along -z (muzzle at [my, mz]). The
// magazine parts go in mg so they move with the reload. Returns how far the muzzle moved
// forward (the flash goes to the new end). Neutral colours: skins never paint attachments.
const LASER_RED = 0xff3030;
function attachParts(g, mg, type, code, my, mz) {
  if (!code || code === '0000') return 0;
  const [mu, gr, un, mgk] = [...code].map(Number);
  const sp = SPEC[type], hz = HAND_Z[type] ?? -0.2;
  let ext = 0;
  if (mu === 1) {            // flash hider: a slotted tube
    tube(g, BLACK, 0.0105, 0.05, 0, my, mz - 0.025, 12);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; box(g, DARK, 0.003, 0.003, 0.03, Math.cos(a) * 0.0105, my + Math.sin(a) * 0.0105, mz - 0.032); }
    ext = 0.05;
  } else if (mu === 2) {     // compensator: a flat block with ports on top
    box(g, BLACK, 0.022, 0.02, 0.045, 0, my, mz - 0.0225);
    for (let i = 0; i < 3; i++) box(g, DARK, 0.014, 0.003, 0.006, 0, my + 0.0095, mz - 0.01 - i * 0.012);
    ext = 0.045;
  } else if (mu === 3) {     // muzzle brake: wide baffles with side windows
    tube(g, STEEL, 0.009, 0.055, 0, my, mz - 0.0275, 10);
    for (let i = 0; i < 3; i++) box(g, BLACK, 0.034, 0.018, 0.008, 0, my, mz - 0.008 - i * 0.018);
    ext = 0.055;
  } else if (mu === 4) {     // suppressor: a long can with an end cap
    tube(g, RUBBER, 0.017, 0.15, 0, my, mz - 0.075, 16);
    tube(g, BLACK, 0.0175, 0.012, 0, my, mz - 0.006, 16);
    tube(g, BLACK, 0.0175, 0.01, 0, my, mz - 0.145, 16);
    ext = 0.15;
  } else if (mu === 5) {     // extended barrel: a longer barrel and a small crown
    tube(g, STEEL, 0.0075, 0.08, 0, my, mz - 0.04, 10);
    tube(g, BLACK, 0.0095, 0.018, 0, my, mz - 0.075, 10);
    ext = 0.084;
  }
  // Grips go just ahead of the support hand, under the handguard.
  const gy = -0.032, gz = Math.max(mz + 0.03, hz - 0.075);
  if (gr === 1) {            // vertical grip: a ribbed post with a cap
    box(g, BLACK, 0.02, 0.008, 0.03, 0, gy - 0.004, gz);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.0135, 0.07, 12), mat(RUBBER, 'polymer'));
    post.position.set(0, gy - 0.043, gz); g.add(post);
    for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.0128, 0.0018, 4, 12), mat(BLACK, 'polymer')); r.rotation.x = Math.PI / 2; r.position.set(0, gy - 0.02 - i * 0.015, gz); g.add(r); }
    tube(g, BLACK, 0.014, 0.006, 0, gy - 0.08, gz).rotation.x = 0;
  } else if (gr === 2) {     // angled grip: a swept wedge
    box(g, BLACK, 0.02, 0.008, 0.06, 0, gy - 0.004, gz + 0.01);
    const w = box(g, RUBBER, 0.018, 0.026, 0.065, 0, gy - 0.02, gz + 0.012, -0.45);
    w.material = mat(RUBBER, 'polymer');
  }
  if (un === 1) {            // laser: a small box on the left of the handguard with a red lens
    const lx = -((sp ? sp.hw : 0.024) + 0.011), lz = Math.max(mz + 0.04, hz - 0.02);
    box(g, BLACK, 0.016, 0.018, 0.05, lx, my - 0.012, lz);
    box(g, STEEL, 0.004, 0.012, 0.02, lx + 0.009, my - 0.012, lz);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.004, 10), new THREE.MeshBasicMaterial({ color: LASER_RED, toneMapped: false }));
    lens.position.set(lx, my - 0.012, lz - 0.0255); lens.rotation.y = Math.PI; g.add(lens);
  }
  if (mgk === 1 || mgk === 2) {
    const b = new THREE.Box3().setFromObject(mg);
    if (!b.isEmpty()) {
      if (mgk === 1) {       // extended: a longer body, the same top in the magazine well
        // (each part is stretched down from the well; the group itself stays free for the reload)
        const top = b.max.y, k = 1.32;
        for (const c of [...mg.children]) { c.position.y = top + (c.position.y - top) * k; c.scale.y *= k; }
        const low = top + (b.min.y - top) * k;
        box(mg, BLACK, (b.max.x - b.min.x) * 0.9 + 0.004, 0.01, (b.max.z - b.min.z) * 0.9 + 0.004, (b.max.x + b.min.x) / 2, low - 0.003, (b.max.z + b.min.z) / 2);
      } else {               // quick-change: a pull loop under the base plate
        const cx = (b.max.x + b.min.x) / 2, cz = (b.max.z + b.min.z) / 2;
        const loop = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 14, Math.PI), mat(0x3d4a2a, 'cloth'));
        loop.position.set(cx, b.min.y, cz); loop.rotation.set(Math.PI, Math.PI / 2, 0); mg.add(loop);
        box(mg, 0x3d4a2a, 0.02, 0.004, 0.03, cx, b.min.y - 0.002, cz);
      }
    }
  }
  return ext;
}

const easeInOut = (x) => x * x * (3 - 2 * x);

// A gun as other players see it (third person, real size): the same model and skin, without
// rails, hands or moving parts. Cached per gun, finish and skin; returns a new group sharing
// geometry and materials. Gun coordinates: -z forward, origin at the receiver; grip at gripZ.
const worldGuns = new Map();
export function buildWorldGun(gun, slot, skinId) {
  const type = MODEL_FOR[gun.id] || (MODEL_TYPES.includes(gun.model) ? gun.model : 'rifle');
  const hdm = hdModel(type);
  const muzzle = hdm?.header.anchors?.muzzle || SPEC[type].muzzle;
  const at = gun.attach || null;
  const skin = skinById(skinId);
  const key = sightShading() + '|' + gun.id + '|' + slot + '|' + (skinId ?? '-') + (hdm ? '|hd' : '') + (at ? '|a' + at : '');
  if (!worldGuns.has(key)) {
    const g = new THREE.Group(), mg = new THREE.Group();
    SKIN_SLOT = slot; SKIN_FORCE = skinId ?? null; WORLD = true;
    try {
      if (hdm) buildHD(g, mg, null, hdm, 1, FINISHES[slot % FINISHES.length]);     // the pack's lighter model
      else BUILDERS[type](g, FINISHES[slot % FINISHES.length], mg);
      if (skinId === SAKURA_ID) sakuraInlays(g);
      if (skin?.art && TRACED[type]) artInlays(g, skin, TRACED[type]);
      if (skin?.rarity === 'epic') epicInlays(g, skin);
      if (at) { SKIN_FORCE = null; attachParts(g, mg, type, at, ...muzzle); }
    } finally { SKIN_FORCE = undefined; WORLD = false; }
    g.add(mg);
    mergeStatic(g);
    const box = new THREE.Box3().setFromObject(g);
    if (skin?.rarity === 'blackice') iceCrystals(g, skin, type, muzzle, false);
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
      if (u && u.mag) { u.mag.position.set(0, 0, 0); u.mag.rotation.set(0, 0, 0); u.mag.visible = true; u.bolt.position.z = u.boltZ; u.flash.visible = false; }
      if (u && u.support) { u.support.position.fromArray(u.anchors.rest); u.support.rotation.set(0, 0, 0); }
      this.flashLight.intensity = 0;
      for (const b of this.brass) b.visible = false;
      return a;
    }
    // Pack animations (High / Ultra with the pack's gun): keyframed clips instead of the
    // procedural draw, inspect and reload below, over the same durations.
    const style = u && u.support && u.anchors ? styleFor(u.type) : null;
    const S = this._clip || (this._clip = {});
    let hand = null, magK = null, boltK = 0;
    // Draw: the gun comes up from below, pitched down and rolled.
    if (this.drawT < 1) this.drawT = Math.min(1, this.drawT + dt / 0.42);
    if (style && this.drawT < 1) {
      sampleClip(style.draw, this.drawT, u.anchors, S);
      if (S.root) { a.x += S.root[0]; a.y += S.root[1]; a.z += S.root[2]; a.p += S.root[3]; a.yw += S.root[4]; a.r += S.root[5]; }
      hand = S.hand && S.hand.slice();
    } else if (!style) {
      const d = 1 - Math.pow(1 - this.drawT, 3);
      a.y -= 0.11 * (1 - d); a.p -= 0.7 * (1 - d); a.r += 0.25 * (1 - d);
    }
    // Premium finishes use their own reveal pose and timing. Other skins use the usual inspect.
    if (this.inspectHold >= 0) this.inspectT = this.inspectHold;
    else if (this.inspectT >= 0) { this.inspectT += dt / (u?.inspectFx?.seconds ?? 3.2); if (this.inspectT >= 1) this.inspectT = -1; }
    const insClip = u?.inspectFx?.clip || style?.inspect;
    if (this.inspectT >= 0 && insClip) {
      const p = this.inspectT, k = 1 - e;
      sampleClip(insClip, p, style ? u.anchors : null, S);
      if (S.root) { a.x += S.root[0] * k; a.y += S.root[1] * k; a.z += S.root[2] * k; a.p += S.root[3] * k; a.yw += S.root[4] * k; a.r += S.root[5] * k; }
      if (S.hand) hand = S.hand.slice();
      if (S.mag) magK = S.mag.slice();
      boltK = S.bolt;
      for (const ev of eventsBetween(insClip, this._lastI ?? -1, p)) this._clipEvent(ev);
      this._lastI = p;
    } else if (this.inspectT >= 0) {
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
    if (this.inspectT < 0) this._lastI = -1;
    if (u && u.mag && style) {
      // Pack reload: the tactical clip, or the empty one (magazine drops, charging handle).
      const p = this.reloadP;
      if (p >= 0) {
        if (this._lastP < 0) this._reloadClip = this.reloadEmpty ? style.reloadEmpty : style.reload;
        const clip = this._reloadClip || style.reload, k = 1 - 0.6 * e;
        sampleClip(clip, p, u.anchors, S);
        if (S.root) { a.x += S.root[0] * k; a.y += S.root[1] * k; a.z += S.root[2] * k; a.p += S.root[3] * k; a.yw += S.root[4] * k; a.r += S.root[5] * k; }
        if (S.hand) hand = S.hand.slice();
        if (S.mag) magK = S.mag.slice();
        boltK = Math.max(boltK, S.bolt);
        for (const ev of eventsBetween(clip, Math.max(0, this._lastP), p)) this._clipEvent(ev);
        this._lastP = p;
      } else this._lastP = -1;
      const mg = u.mag;
      if (magK) { mg.position.set(magK[0], magK[1], magK[2]); mg.rotation.set(magK[3], magK[4], magK[5]); mg.visible = magK[6] > 0.5; }
      else { mg.position.set(0, 0, 0); mg.rotation.set(0, 0, 0); mg.visible = true; }
      const an = u.anchors.rest, sup = u.support;
      if (hand) { sup.position.set(hand[0], hand[1], hand[2]); sup.rotation.set(hand[3], hand[4], hand[5]); }
      else { sup.position.set(an[0], an[1], an[2]); sup.rotation.set(0, 0, 0); }
    } else if (u && u.mag) {
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
    }
    if (u && u.mag) {
      // Bolt returns forward; flash lasts one or two frames.
      this.boltZ *= Math.exp(-dt * 30);
      u.bolt.position.z = u.boltZ + Math.max(this.boltZ, boltK);   // boltK: pulled by a pack clip
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
  setShading(mode, graphics = INSPECT_QUALITY) {
    if (mode === sightShading() && graphics === INSPECT_QUALITY) return;
    INSPECT_QUALITY = graphics;
    setSightShading(mode);
    this.applyLights();
    this._dropModels();
  }

  // Drop the cached models (after a shading change made through another rig).
  rebuild() {
    this._dropModels();
    this.gunId = undefined;
    this.applyLights();
  }

  _dropModels() {
    this.cancelInspect();
    for (const m of this.models.values()) {
      this.root.remove(m);
      m.userData.inspectFx?.dispose();
    }
    this.models.clear();
    this.current = null;
  }

  // Skin animation amount (0..1) and clock for the current gun's skin materials.
  animateSkins(t, amount) {
    const u = this.current?.userData;
    if (!u) return;
    const sweep = u.ice && !this.noHands ? amount * 0.24 : amount;
    for (const mat of u.skinMats) { const tu = mat.userData.tri; tu.triAnim.value = sweep; tu.triTime.value = t; }
    const phase = this.inspectHold >= 0 ? this.inspectHold : this.inspectT;
    u.inspectFx?.update(this.animations ? phase : -1);
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
    const hdm = hdModel(type);
    const key = gun.id + '|' + optic.id + '|' + (sk ? sk.id : '-') + (this.noHands ? '|nh' : '') + (hdm ? '|hd' + (packAnims.set ? 'a' + packAnims.revision : '') : TRACED[type] && packAnims.set ? '|ta' + packAnims.revision : '') + (gun.attach ? '|a' + gun.attach : '');   // a skin or attachment change builds a new model
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
      if (hdm) buildHD(gunG, magG, null, hdm, 0, finish);      // the pack's detailed model (rails, ports, pins built in)
      else BUILDERS[type](gunG, finish, magG);
      const blossoms = sk?.id === SAKURA_ID ? sakuraInlays(gunG, true) : null;
      const art = sk?.art && TRACED[type] ? artInlays(gunG, sk, TRACED[type], true) : null;
      if (sk?.rarity === 'epic') epicInlays(gunG, sk);
      if (!hdm) {
        for (const [y, from, to] of RAILS[type]) topRail(gunG, y, from, to);
        if (sightShading() === 'ultra' && !TRACED[type]) ultraDetails(gunG, type, finish, magG);   // (traced guns have their own)
      }
      // Attachments (unskinned), merged with the gun below like its own parts.
      const muzzle = hdm?.header.anchors?.muzzle || SPEC[type].muzzle;
      const [my, mz] = muzzle;
      const keepSkin = SKIN_FORCE; SKIN_FORCE = null;
      const ext = attachParts(gunG, magG, type, gun.attach, my, mz);
      SKIN_FORCE = keepSkin;
      const ice = sk?.rarity === 'blackice';
      const frost = ice ? prepareFrost(gunG, magG, sight.group) : null;
      const crystals = ice ? iceCrystals(gunG, sk, type, muzzle) : null;
      // Pack guns with the pack's animations: the support hand is its own part (it reloads).
      const sup = (hdm || TRACED[type]) && packAnims.set && !this.noHands ? new THREE.Group() : null;   // (traced guns take the pack's keyframed reloads too)
      let palm = null;
      if (!this.noHands) palm = hands(gunG, type, sup);
      SKIN_FORCE = undefined;
      mergeStatic(gunG);
      if (sup) { mergeStatic(sup); gunG.add(sup); sup.userData.arm = supportArm(); m.add(sup.userData.arm, sup.userData.arm.userData.upper); }
      const mb = new THREE.Box3().setFromObject(magG);
      mergeStatic(magG);
      gunG.add(magG);
      const bolt = boltGroup(type);
      gunG.add(bolt);
      const flash = flashGroup();
      // Flashlight on the side of the barrel (shown at night).
      const torch = new THREE.Group();
      const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.085, 12), mat(BLACK));
      tb.rotation.x = Math.PI / 2; torch.add(tb);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0125, 14), new THREE.MeshBasicMaterial({ color: 0xfff6d8, toneMapped: false }));
      lens.position.z = -0.0435; lens.rotation.y = Math.PI; torch.add(lens);
      torch.position.set(SPEC[type].hw + 0.022, my - 0.012, mz + 0.1);
      torch.visible = false;
      gunG.add(torch);
      flash.position.set(0, my, mz - 0.035 - ext);
      gunG.add(flash);
      m.userData = { torch, mag: magG, bolt, boltZ: bolt.position.z, flash, port: new THREE.Vector3(SPEC[type].hw + 0.01, 0.014, SPEC[type].port), gun: gunG, hd: !!hdm, type };
      if (sup) {
        // Anchors for the keyframed hand (gun space), measured on this model.
        const c = mb.isEmpty() ? new THREE.Vector3(0, -0.1, 0) : mb.getCenter(new THREE.Vector3());
        const hz = HAND_Z[type] ?? -0.2, sp = SPEC[type];
        m.userData.support = sup;
        m.userData.anchors = { id: key, rest: palm.toArray(), mag: c.toArray(), magBottom: [c.x, mb.isEmpty() ? -0.16 : mb.min.y, c.z], port: [sp.hw + 0.01, 0.012, sp.port + 0.03], pouch: [-0.12, -0.42, hz + 0.18] };
      }
      const skinMats = new Set();
      gunG.traverse((o) => { if (o.isMesh && o.material.userData.tri && o.material.userData.skinKey) skinMats.add(o.material); });
      m.userData.skinMats = [...skinMats];
      m.userData.ice = ice;
      const s = 0.62;
      gunG.scale.setScalar(s);
      // Rail (top of the receiver) under the sight's mount; receiver centred a little ahead. Where a
      // traced gun's rail ends sooner (the F2's carry handle, the R4-C), the gun sits back under the sight.
      gunG.position.set(0, sight.railY - TOP_Y[type] * s, -EYE_Z - (SIGHT_Z[type] ?? 0.05 / s) * s);
      m.add(gunG);
      if (ice) m.userData.inspectFx = frostInspect(gunG, frost, crystals, sk, INSPECT_QUALITY);
      else if (blossoms?.length) m.userData.inspectFx = sakuraInspect(gunG, blossoms, INSPECT_QUALITY, art?.roots || []);
      else if (art) m.userData.inspectFx = sk.artLook === 'bronze' ? abyssInspect(gunG, art, INSPECT_QUALITY) : sk.artLook === 'glass' ? vesperInspect(gunG, art, INSPECT_QUALITY) : sk.artLook === 'porcelain' ? kilnInspect(gunG, art, INSPECT_QUALITY) : sk.artLook === 'forge' ? forgeInspect(gunG, art, INSPECT_QUALITY) : sk.artLook === 'orrery' ? orreryInspect(gunG, art, INSPECT_QUALITY) : sk.artLook === 'amber' ? amberInspect(gunG, art, INSPECT_QUALITY) : sk.artLook === 'jade' ? jadeInspect(gunG, art, INSPECT_QUALITY) : sk.artLook === 'velvet' ? velvetInspect(gunG, art, INSPECT_QUALITY) : sk.artLook === 'opal' ? opalInspect(gunG, art, INSPECT_QUALITY) : null;
      m.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      this.models.set(key, m);
      this.root.add(m);
    }
    if (this.current && this.current !== m) {
      this.cancelInspect();
      this.current.visible = false;
    }
    m.visible = true;
    if (m.userData.torch) m.userData.torch.visible = !!this.torchOn;
    // Draw animation when the gun itself changes (not for a sight change).
    if (this.gunId !== gun.id && this.gunId !== undefined && this.animations) this.drawT = 0;
    this.gunId = gun.id;
    this.flashMul = gun.flash ?? 1;          // attachments: flash hider smaller, suppressor none
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
    this.flashT = (this.flashMul ?? 1) > 0 ? 0.045 : 0;
    this.flashRot = Math.random() * Math.PI;
    this.flashS = (0.75 + Math.random() * 0.5) * Math.max(0.35, this.flashMul ?? 1);
    this._ejectBrass();
  }

  // Pack clip events: the magazine slap and the charging handle nudge the gun.
  // Lay the pack support forearm from the wrist to the shoulder (see supportArm).
  _layArm() {
    const u = this.current && this.current.userData, sup = u && u.support, arm = sup && sup.userData.arm;
    if (!arm) return;
    arm.visible = arm.userData.upper.visible = sup.visible;
    if (!sup.visible) return;
    this.root.updateMatrixWorld(true);
    const m = this.current, up = arm.userData.upper, V = (k) => this['_v' + k] || (this['_v' + k] = new THREE.Vector3());
    const view = (v) => (this.root.parent ? this.root.parent.localToWorld(v) : v);
    const w = m.worldToLocal(sup.localToWorld(V('w').copy(sup.userData.wrist)));
    const sh = m.worldToLocal(view(V('s').copy(SHOULDER)));
    const cam = m.worldToLocal(view(V('c').set(0, 0, 0)));
    const pole = m.worldToLocal(view(V('p').set(-0.5, -1, 0.3).add(SHOULDER))).sub(sh).normalize();   // the elbow bends down and out
    // two bones: the elbow where a 0.27 m forearm and a 0.32 m upper arm meet (stretched if out of reach)
    const L1 = 0.27, L2 = 0.32, d = V('d').subVectors(sh, w), dist = d.length(); d.divideScalar(dist);
    const k = Math.max(1, dist / (L1 + L2) * 1.0001), l1 = L1 * k, l2 = L2 * k;
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const side = V('h').copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
    const el = V('e').copy(w).addScaledVector(d, a).addScaledVector(side, hgt);
    const place = (g, from, to, len) => {
      const dir = V('q').subVectors(to, from).divideScalar(len);
      const zc = V('z').subVectors(cam, from); zc.addScaledVector(dir, -zc.dot(dir)).normalize();      // +z (the watch face) towards the eye
      g.position.copy(from);
      g.quaternion.setFromRotationMatrix((this._am || (this._am = new THREE.Matrix4())).makeBasis(V('x').crossVectors(dir, zc), dir, zc));
    };
    place(arm, w, el, l1); arm.userData.sleeve.scale.y = l1;
    place(up, el, sh, l2); up.userData.sleeve.scale.y = l2;
    up.visible = true;
  }

  _clipEvent(name) {
    if (name === 'slap') { this.vp += 0.6; this.vz += 0.15; }
    else if (name === 'charge') { this.vp += 0.35; this.vz += 0.1; }
  }

  // K: a quick melee jab (the gun swings across and forward, then back).
  melee() { this.meleeT = 0; this.cancelInspect(); }

  // I: inspect the weapon (ignored while aiming or reloading).
  inspect() {
    if (!this.animations || this.reloadP >= 0) return;
    this.cancelInspect();
    this.inspectT = 0;
  }
  cancelInspect() {
    if (this.inspectHold >= 0) return;
    this.inspectT = -1;
    this.current?.userData.inspectFx?.update(-1);
  }

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
    if (this.inspectT >= 0 && (k > 0 || this.reloadP >= 0 || !this.animations)) this.cancelInspect();
    const A = this._animate(Math.min(dt, 0.1), k);
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
    this._layArm();
    if (this.meleeT >= 0) {
      this.meleeT += Math.min(dt, 0.1) / 0.38;
      if (this.meleeT >= 1) this.meleeT = -1;
      else {
        const p = Math.sin(Math.PI * Math.min(1, this.meleeT * 1.4)) * (this.meleeT < 0.7 ? 1 : (1 - this.meleeT) / 0.3);
        this.root.position.x -= 0.07 * p; this.root.position.y -= 0.04 * p; this.root.position.z -= 0.09 * p;
        this.root.quaternion.multiply(this._aq.setFromEuler(this._ae.set(-0.25 * p, 0.6 * p, 0.5 * p)));
      }
    }
    // Sample the emitter after applying the pose so trails follow the actual muzzle and receiver.
    const target = this.inspectT >= 0 ? 1 : 0;
    this.skinAnim = (this.skinAnim || 0) + (target - (this.skinAnim || 0)) * Math.min(1, dt * 5);
    if (this.skinAnim < 0.002) this.skinAnim = 0;
    this.animateSkins(t, this.skinAnim);
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
