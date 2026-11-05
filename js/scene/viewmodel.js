// Blocky first-person gun models, one look per gun type, plus a sight that matches the
// optic's zoom. Purely cosmetic and original low-poly shapes; hidden while aiming down sights.
// It is a child of the camera, so it follows the view (including recoil punch).
import * as THREE from '../../vendor/three/three.module.min.js';

export const MODEL_TYPES = ['rifle', 'carbine', 'smg', 'lmg', 'marksman'];

// Body colour per gun slot, so two guns of the same type still look different.
const FINISHES = [0x3a3d42, 0x6b5b45, 0x46523b, 0x2f3540, 0x5a5048, 0x4a4f57, 0x3d4a48, 0x55493c, 0x383838, 0x4f5560];

const mats = new Map();
function mat(color) {
  if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color }));
  return mats.get(color);
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
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat(color));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// Bake every part's transform into its geometry and merge parts that share a material, so a
// whole gun is drawn in ~3 draw calls instead of one per box.
function mergeByMaterial(group) {
  const byMat = new Map();
  group.updateMatrixWorld(true);
  for (const m of [...group.children]) {
    if (!m.isMesh || m.material.transparent) continue;
    const geo = m.geometry.toNonIndexed();
    geo.applyMatrix4(m.matrix);
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(geo);
    group.remove(m);
    m.geometry.dispose();
  }
  for (const [material, geos] of byMat) {
    let n = 0;
    for (const g of geos) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      o += g.attributes.position.count;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    group.add(new THREE.Mesh(merged, material));
  }
}

// Gun coordinates: -z is forward (muzzle), y up, origin at the receiver centre.
const BUILDERS = {
  rifle(g, c) {
    box(g, c, 0.05, 0.07, 0.36, 0, 0, 0);                  // receiver
    box(g, c, 0.046, 0.05, 0.22, 0, 0.004, -0.28);         // handguard
    tube(g, BLACK, 0.011, 0.16, 0, 0.012, -0.46);          // barrel
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.08, 0.06, 0.25);   // grip
    box(g, BLACK, 0.03, 0.08, 0.05, 0, -0.07, -0.07, -0.15);  // curved mag, upper
    box(g, BLACK, 0.03, 0.07, 0.05, 0, -0.14, -0.1, -0.4);    // curved mag, lower
    box(g, c, 0.045, 0.07, 0.2, 0, -0.012, 0.27);          // fixed stock
  },
  carbine(g, c) {
    box(g, c, 0.05, 0.068, 0.3, 0, 0, 0);
    box(g, c, 0.05, 0.055, 0.14, 0, 0.004, -0.22);         // short rail handguard
    for (let i = 0; i < 4; i++) box(g, BLACK, 0.052, 0.006, 0.018, 0, 0.034, -0.17 - i * 0.03); // rail teeth
    tube(g, BLACK, 0.01, 0.12, 0, 0.012, -0.35);
    box(g, BLACK, 0.012, 0.022, 0.03, 0, 0.018, -0.42);    // muzzle brake
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.08, 0.05, 0.25);
    box(g, BLACK, 0.03, 0.13, 0.05, 0, -0.09, -0.07, -0.08);  // straight mag
    box(g, STEEL, 0.012, 0.012, 0.18, 0, 0.012, 0.24);     // collapsible stock tube
    box(g, c, 0.04, 0.08, 0.04, 0, -0.01, 0.33);           // butt pad
  },
  smg(g, c) {
    box(g, c, 0.048, 0.075, 0.24, 0, 0, 0);
    tube(g, BLACK, 0.016, 0.1, 0, 0.01, -0.17);            // stubby suppressor-ish shroud
    box(g, BLACK, 0.032, 0.09, 0.04, 0, -0.075, 0.05, 0.2);
    box(g, BLACK, 0.026, 0.19, 0.035, 0, -0.13, -0.06);    // long stick mag
    box(g, BLACK, 0.026, 0.07, 0.03, 0, -0.07, -0.12);     // vertical foregrip
    box(g, STEEL, 0.01, 0.06, 0.012, 0, -0.01, 0.15);      // folded stock arms
    box(g, STEEL, 0.04, 0.01, 0.13, 0, -0.04, 0.12);
  },
  lmg(g, c) {
    box(g, c, 0.07, 0.09, 0.4, 0, 0, 0);                   // big receiver
    box(g, c, 0.07, 0.03, 0.12, 0, 0.06, 0.02);            // feed cover
    box(g, STEEL, 0.012, 0.04, 0.1, 0, 0.09, -0.08);       // carry handle
    tube(g, STEEL, 0.022, 0.24, 0, 0.005, -0.32, 8);       // ventilated shroud
    tube(g, BLACK, 0.013, 0.12, 0, 0.005, -0.5);           // heavy barrel
    box(g, BLACK, 0.012, 0.012, 0.16, -0.02, -0.03, -0.32); // folded bipod legs
    box(g, BLACK, 0.012, 0.012, 0.16, 0.02, -0.03, -0.32);
    box(g, BLACK, 0.11, 0.1, 0.12, 0.005, -0.09, -0.05);   // box magazine
    box(g, BLACK, 0.036, 0.1, 0.045, 0, -0.09, 0.09, 0.25);
    box(g, c, 0.05, 0.085, 0.2, 0, -0.01, 0.3);
  },
  marksman(g, c) {
    box(g, c, 0.048, 0.07, 0.34, 0, 0, 0);
    box(g, c, 0.04, 0.045, 0.26, 0, 0.002, -0.29);         // slim long handguard
    tube(g, BLACK, 0.009, 0.24, 0, 0.012, -0.53);          // long barrel
    box(g, BLACK, 0.03, 0.06, 0.07, 0, -0.06, -0.06);      // short box mag
    box(g, BLACK, 0.034, 0.1, 0.045, 0, -0.08, 0.06, 0.25);
    box(g, c, 0.045, 0.06, 0.24, 0, -0.008, 0.29);         // long stock
    box(g, c, 0.04, 0.03, 0.08, 0, 0.04, 0.27);            // cheek riser
  },
};

// Sight on top, chosen by optic magnification.
function addSight(g, zoom, topY) {
  if (zoom <= 1) {
    // Open reflex sight: base plus a thin frame around the glass.
    box(g, BLACK, 0.03, 0.012, 0.05, 0, topY + 0.006, -0.02);
    box(g, BLACK, 0.004, 0.035, 0.008, -0.016, topY + 0.03, -0.035);
    box(g, BLACK, 0.004, 0.035, 0.008, 0.016, topY + 0.03, -0.035);
    box(g, BLACK, 0.036, 0.004, 0.008, 0, topY + 0.047, -0.035);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.03),
      new THREE.MeshBasicMaterial({ color: 0x5fb3a4, transparent: true, opacity: 0.35 }));
    glass.position.set(0, topY + 0.03, -0.035);
    g.add(glass);
  } else {
    // Tube scope: longer and fatter as the zoom goes up.
    const len = zoom < 3 ? 0.1 : 0.16 + Math.min(zoom, 12) * 0.006;
    const r = zoom < 3 ? 0.014 : 0.018;
    box(g, BLACK, 0.02, 0.016, 0.03, 0, topY + 0.008, -0.04);
    box(g, BLACK, 0.02, 0.016, 0.03, 0, topY + 0.008, 0.04);
    tube(g, BLACK, r, len, 0, topY + 0.016 + r, 0);
    tube(g, BLACK, r * 1.35, 0.025, 0, topY + 0.016 + r, -len / 2);     // objective bell
    tube(g, BLACK, r * 1.2, 0.02, 0, topY + 0.016 + r, len / 2);        // eyepiece
  }
}

const TOP_Y = { rifle: 0.035, carbine: 0.034, smg: 0.0375, lmg: 0.075, marksman: 0.035 };

export class Viewmodel {
  constructor(camera) {
    this.root = new THREE.Group();
    this.base = new THREE.Vector3(0.16, -0.15, -0.36);
    this.root.position.copy(this.base);
    this.root.scale.setScalar(0.7);
    this.root.rotation.y = 0.06;
    camera.add(this.root);
    this.models = new Map(); // cache key -> group, built once per gun
    this.current = null;
    this.kick = 0;
  }

  // gun: validated gun data; slot: its index (picks the finish colour).
  setGun(gun, slot) {
    const type = MODEL_TYPES.includes(gun.model) ? gun.model : 'rifle';
    const key = gun.id;
    let m = this.models.get(key);
    if (!m) {
      m = new THREE.Group();
      BUILDERS[type](m, FINISHES[slot % FINISHES.length]);
      addSight(m, gun.optic, TOP_Y[type]);
      mergeByMaterial(m);
      this.models.set(key, m);
      this.root.add(m);
    }
    if (this.current) this.current.visible = false;
    m.visible = true;
    this.current = m;
  }

  shot() { this.kick = Math.min(1, this.kick + 0.6); }

  update(dt, visible) {
    this.root.visible = visible;
    // Exponential decay of the kick, independent of frame rate.
    this.kick *= Math.exp(-dt * 18);
    this.root.position.set(this.base.x, this.base.y + this.kick * 0.01, this.base.z + this.kick * 0.04);
    this.root.rotation.x = this.kick * 0.08;
  }
}
