// First-person weapon: a blocky gun per type plus a procedural 3D sight (sight-model.js),
// drawn in its own scene with a fixed-FOV camera so it keeps its size while the world camera
// zooms. Handles the hip <-> aim raise, sway lag and recoil kick. Original low-poly shapes.
import * as THREE from '../../vendor/three/three.module.min.js';
import { buildSight, makeEnvMap, mergeStatic, setSightShading, sightShading, setHighEnv, highMaterial, VM_FOV, EYE_Z, VIEW_H } from './sight-model.js';
import { matcap } from './matcap.js';

export const MODEL_TYPES = ['rifle', 'carbine', 'smg', 'lmg', 'marksman'];

// Body colour per gun slot, so two guns of the same type still look different.
const FINISHES = [0x3a3d42, 0x6b5b45, 0x46523b, 0x2f3540, 0x5a5048, 0x4a4f57, 0x3d4a48, 0x55493c, 0x383838, 0x4f5560];

const mats = new Map();
let ENV = null;
// kind: 'auto' (black = polymer, else metal) or 'metal' (barrels, tubes).
function mat(color, kind = 'auto') {
  const key = sightShading() + color + kind;
  if (!mats.has(key)) {
    const sh = sightShading();
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

const TOP_Y = { rifle: 0.035, carbine: 0.034, smg: 0.0375, lmg: 0.075, marksman: 0.035 };


const easeInOut = (x) => x * x * (3 - 2 * x);

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
    const high = sightShading() === 'high';
    // Same light directions as the range in high graphics: warm key over the left shoulder.
    this.hemi.intensity = high ? 0.3 : 0.9;
    this.key.color.set(high ? 0xffe8d0 : 0xffffff);
    this.key.intensity = high ? 2.4 : 1.8;
    this.rim.intensity = high ? 0.9 : 0.6;
    for (const m of this.models.values()) this.root.remove(m);
    this.models.clear();
    this.current = null;
  }

  // gun: validated gun data; slot: its index (finish colour); optic: chosen sight.
  setGun(gun, slot, optic) {
    const type = MODEL_TYPES.includes(gun.model) ? gun.model : 'rifle';
    const key = gun.id + '|' + optic.id;
    let m = this.models.get(key);
    if (!m) {
      m = new THREE.Group();
      const sight = buildSight(optic, ENV);
      sight.group.position.set(0, 0, -EYE_Z);
      m.add(sight.group);
      const gunG = new THREE.Group();
      BUILDERS[type](gunG, FINISHES[slot % FINISHES.length]);
      mergeStatic(gunG);
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
    this.current = m;
  }

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
    const arc = Math.sin(Math.PI * k);
    const br = (1 - 0.6 * k) * 0.0004;
    this.root.position.set(
      this.hipPos.x * (1 - k) + this.sx + Math.sin(t * 1.1) * br,
      this.hipPos.y * (1 - k) - 0.012 * arc + this.sy + Math.sin(t * 0.7 + 1) * br + this.bobY,
      this.hipPos.z * (1 - k) + this.kz,
    );
    this.qt.slerpQuaternions(this.q0, this.q1, k);
    this.kickQ.setFromAxisAngle(this.xAxis, this.kp * 0.05);
    this.cantQ.setFromAxisAngle(this.zAxis, -0.12 * arc);
    this.root.quaternion.copy(this.qt).multiply(this.cantQ).multiply(this.kickQ);
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
