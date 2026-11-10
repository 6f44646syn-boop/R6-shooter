// A combatant in battle mode (human or bot): body, health, team, score, and the exact hit
// test. The body is a soldier (soldier.js) in team colours carrying their real gun with its
// skin; hits are decided on the same shapes the body is built around. Crouching squashes the
// body to CROUCH_SCALE. y is the height of the feet (floors, stairs, box tops).
import * as THREE from '../../vendor/three/three.module.min.js?v=m4-m8-audio-1';
import { soldierGeometry, raycastSoldier, GRIP_HAND, HIP_X, HIP_Y } from './soldier.js?v=m4-m8-audio-1';
import { buildWorldGun } from '../scene/viewmodel.js?v=m4-m8-audio-1';

export const STAND_EYE = 1.6, CROUCH_EYE = 1.12;
export const CROUCH_SCALE = 0.7;
export const MAX_HEALTH = 100;
// Damage multipliers per body zone.
export const ZONE_DAMAGE = { head: 2.5, body: 1, limb: 0.75 };
// Damage per bullet when the gun data has none (by model type).
const DEFAULT_DAMAGE = { smg: 28, rifle: 36, carbine: 34, lmg: 38, marksman: 48 };
export function gunDamage(gun) { return gun.damage || DEFAULT_DAMAGE[gun.model] || 32; }

const DEG = Math.PI / 180;
const GUN_SCALE = 1.1;

// Outline: each vertex pushed out along its normal by a few millimetres plus a little more
// with distance (about the same thickness on screen near and far).
let SHIELD = null;
// Spawn protection: a pale bubble round the body while it lasts.
function shieldMesh() {
  if (!SHIELD) SHIELD = { geo: new THREE.SphereGeometry(1, 20, 14), mat: new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }) };
  const m = new THREE.Mesh(SHIELD.geo, SHIELD.mat);
  m.userData.ownMaterial = true; m.scale.set(0.62, 1.05, 0.62); m.position.y = 0.95; m.visible = false; m.renderOrder = 4;
  return m;
}
// Teammates through walls: a blue silhouette drawn only where something is in front of them
// (depth "greater" test), so in the open they look normal.
let GHOST = null;
function ghostMaterial() {
  return GHOST || (GHOST = new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.5, depthWrite: false, depthFunc: THREE.GreaterDepth, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
}
let OUTLINE = null;
function outlineMaterial() {
  return OUTLINE || (OUTLINE = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: true, toneMapped: false,
    uniforms: { color: { value: new THREE.Color(0xff2a2a) } },
    vertexShader: `
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * (0.011 + 0.0024 * -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 color; void main() { gl_FragColor = vec4(color, 0.9); }`,
  }));
}

// The flashlight beam: an open cone from the lens forward (+z), bright at the lens and fading
// out (vertex colours with additive blending), shared by every fighter.
let BEAM = null, LENS = null;
function beamMesh() {
  if (!BEAM) {
    const len = 6, g = new THREE.ConeGeometry(0.75, len, 18, 6, true);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, len / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const k = Math.pow(Math.max(0, 1 - p.getZ(i) / len), 2.2); col[i * 3] = k; col[i * 3 + 1] = k * 0.95; col[i * 3 + 2] = k * 0.85; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    BEAM = { g, m: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }) };
  }
  const m = new THREE.Mesh(BEAM.g, BEAM.m);
  m.userData.ownMaterial = true;
  m.renderOrder = 3;
  return m;
}
function lensSprite() {
  if (!LENS) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,240,200,0.7)'); gr.addColorStop(1, 'rgba(255,230,180,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    LENS = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  }
  const s = new THREE.Sprite(LENS);
  s.scale.set(0.35, 0.35, 1);
  s.userData.ownMaterial = true;
  return s;
}

export class Fighter {
  // opts: { name, team, color (hex), human }
  constructor(opts) {
    Object.assign(this, { name: 'Fighter', team: 'bots', color: 0xffffff, human: false }, opts);
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.viewDY = 0; this.viewDP = 0;   // recoil on top of the aim (what their screen shows)
    this.ads = 0;               // aim down sights 0..1
    this.crouch = 0;            // 0 standing .. 1 crouched (eased)
    this.health = MAX_HEALTH;
    this.alive = true;
    this.respawnAt = 0;
    this.protectUntil = 0;      // spawn protection
    this.lastHurt = -10;        // time of the last damage (regeneration waits)
    this.kills = 0; this.deaths = 0;
    this.gun = null;
    this.skin = null;           // skin id on the gun (others see it)
    this.night = false;         // night battle: the flashlight on the gun
    this.light = true;          // flashlight switched on

    /* body */
    this.group = new THREE.Group();
    const geo = soldierGeometry(this.color), mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const body = new THREE.Mesh(geo.upper, mat);
    body.castShadow = true;
    this.body = body;
    // Thin red outline (an inflated back-facing copy of the body): others stand out by day.
    const ol = (g) => { const m = new THREE.Mesh(g, outlineMaterial()); m.userData.ownMaterial = true; return m; };
    this.outline = new THREE.Group();
    this.outline.add(ol(geo.upper));
    this.outline.visible = false;
    const gh = (g) => { const m = new THREE.Mesh(g, ghostMaterial()); m.userData.ownMaterial = true; m.renderOrder = 7; m.visible = false; return m; };
    this.ghosts = [gh(geo.upper)];
    this.scaleG = new THREE.Group();
    this.scaleG.add(body, this.outline, this.ghosts[0]);
    this.shield = shieldMesh();
    this.group.add(this.shield);
    // Legs swing from the hips when walking (see updateVisual).
    this.legs = [-1, 1].map((s) => {
      const g = s < 0 ? geo.legL : geo.legR, piv = new THREE.Group();
      piv.position.set(s * HIP_X, HIP_Y, 0);
      const m = new THREE.Mesh(g, mat); m.castShadow = true;
      const o = ol(g), gl = gh(g);
      this.ghosts.push(gl);
      piv.add(m, o, gl);
      this.scaleG.add(piv);
      return { piv, o };
    });
    this._ph = 0; this._spd = 0;
    this.group.add(this.scaleG);
    this.gunG = new THREE.Group();          // the carried gun (set by setLook)
    this.gunG.position.set(GRIP_HAND[0], GRIP_HAND[1], GRIP_HAND[2]);
    this.scaleG.add(this.gunG);
    this.muzzle = new THREE.Vector3(0.08, 1.27, 0.95);   // local, standing (moved by setLook)
    this._lookKey = '';
    this._gunModel = null;
    // Flashlight: a lit lens and a soft beam (others see where you look at night).
    this.torchG = new THREE.Group();
    this.torchG.add(beamMesh(), lensSprite());
    this.torchG.visible = false;
    this.gunG.add(this.torchG);
    // Muzzle flash (seen by others): a small additive star.
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshBasicMaterial({
      color: 0xffc070, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.flash.position.copy(this.muzzle);
    this.flash.visible = false;
    this.flash.userData.ownMaterial = true;
    this.scaleG.add(this.flash);
    this.flashUntil = 0;
    // Health bar above the head (sprites face every camera).
    this.barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x111111, depthWrite: false, transparent: true, opacity: 0.7 }));
    this.barBg.scale.set(0.62, 0.07, 1);
    this.barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x5cff7a, depthWrite: false }));
    this.barFg.center.set(0, 0.5);
    this.barFg.scale.set(0.6, 0.05, 1);
    this.group.add(this.barBg, this.barFg);
    this.showBar = !this.human;
    this._o = [0, 0, 0]; this._d = [0, 0, 0];
    this._hit = { t: 0, p: [0, 0, 0], n: [0, 0, 0], zone: null };
  }

  // The gun model others see: gun data, its loadout slot (finish) and skin id (or null).
  setLook(gun, slot, skin) {
    this.gun = gun; this.skin = skin ?? null;
    const key = gun.id + '|' + slot + '|' + this.skin;
    if (key === this._lookKey) return;
    this._lookKey = key;
    if (this._gunModel) this._gunModel.removeFromParent();
    const g = this._gunModel = buildWorldGun(gun, slot, this.skin);
    g.traverse((o) => { if (o.isMesh) o.userData.ownMaterial = true; });
    g.rotation.y = Math.PI;                  // gun -z (muzzle) -> body +z (forward)
    g.scale.setScalar(GUN_SCALE);
    // gunG sits at the right hand (and tilts with the aim there); the grip, at
    // (0, -0.08, gripZ) in gun coordinates, goes into that hand.
    g.position.set(0, 0.08 * GUN_SCALE, g.userData.gripZ * GUN_SCALE);
    this.gunG.add(g);
    this.muzzle.set(GRIP_HAND[0], GRIP_HAND[1] + 0.09 * GUN_SCALE, GRIP_HAND[2] + (g.userData.gripZ - g.userData.front) * GUN_SCALE);
    this.flash.position.copy(this.muzzle);
    this.torchG.position.set(0.04, 0.07 * GUN_SCALE, (g.userData.gripZ - g.userData.front) * GUN_SCALE - 0.08);
  }

  get eyeH() { return STAND_EYE + (CROUCH_EYE - STAND_EYE) * this.crouch; }
  get scaleY() { return 1 + (CROUCH_SCALE - 1) * this.crouch; }
  eye(out = [0, 0, 0]) { out[0] = this.x; out[1] = this.y + this.eyeH; out[2] = this.z; return out; }
  // Aim points on this fighter (world): head and chest.
  head(out = [0, 0, 0]) { out[0] = this.x; out[1] = this.y + 1.62 * this.scaleY; out[2] = this.z; return out; }
  chest(out = [0, 0, 0]) { out[0] = this.x; out[1] = this.y + 1.18 * this.scaleY; out[2] = this.z; return out; }

  // Sync the mesh with the state (call once per frame).
  // Free this fighter's own materials (its geometry, gun model and outline materials are shared).
  dispose() { this.group.removeFromParent(); this.body.material.dispose(); this.barBg.material.dispose(); this.barFg.material.dispose(); }
  // A teammate's silhouette through walls (match modes).
  setGhost(on) { if (this._ghost === on) return; this._ghost = on; for (const g of this.ghosts) g.visible = on; }
  updateVisual(t) {
    this.group.visible = this.alive;
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = Math.PI - this.yaw * DEG;   // the body faces +z; yaw 0 faces -z
    this.scaleG.scale.y = this.scaleY;
    // Walking: speed from how far the body moved (works for everyone, bots and other PCs).
    const dtv = Math.min(0.1, Math.max(0, t - (this._vt ?? t)));
    this._vt = t;
    let sp = dtv > 0 ? Math.hypot(this.x - (this._lx ?? this.x), this.z - (this._lz ?? this.z)) / dtv : 0;
    this._lx = this.x; this._lz = this.z;
    if (sp > 12) sp = 0;                              // a respawn, not a step
    this._spd += (sp - this._spd) * Math.min(1, dtv * 10);
    this._ph += this._spd * dtv * 4.5;
    const amp = Math.min(0.6, this._spd * 0.14) * (1 - 0.4 * this.crouch), sw = Math.sin(this._ph) * amp;
    this.legs[0].piv.rotation.x = sw; this.legs[1].piv.rotation.x = -sw;
    this.scaleG.position.y = Math.abs(Math.sin(this._ph)) * 0.03 * Math.min(1, this._spd / 3);
    for (const l of this.legs) l.o.visible = this.outline.visible;
    // The gun tips with the aim a little.
    this.gunG.rotation.x = -Math.max(-30, Math.min(30, this.pitch)) * DEG * 0.5;
    // spawn protection bubble: blinks in its last half second
    const pr = this.protectUntil - t;
    this.shield.visible = this.alive && pr > 0 && (pr > 0.5 || Math.floor(t * 12) % 2 === 0);
    this.torchG.visible = this.night && this.light;
    this.flash.visible = t < this.flashUntil;
    if (this.flash.visible) this.flash.rotation.z = Math.random() * Math.PI;
    const top = 1.62 * this.scaleY + 0.35;
    this.barBg.position.set(0, top, 0);
    this.barFg.position.set(-0.3, top, 0);
    this.barFg.scale.x = 0.6 * Math.max(0, this.health) / MAX_HEALTH;
    this.barFg.material.color.setHex(this.health > 60 ? 0x5cff7a : this.health > 30 ? 0xffd34a : 0xff5040);
    this.barBg.visible = this.barFg.visible = this.showBar && this.alive;
  }

  // Muzzle position in world space (for tracers).
  muzzleWorld(out = new THREE.Vector3()) {
    const s = this.scaleY, a = Math.PI - this.yaw * DEG;
    const lx = this.muzzle.x, ly = this.muzzle.y * s, lz = this.muzzle.z;
    out.set(this.x + lx * Math.cos(a) + lz * Math.sin(a), this.y + ly, this.z - lx * Math.sin(a) + lz * Math.cos(a));
    return out;
  }

  // Ray o + t d (world, d unit) against the body. Returns { t, zone, p } or null.
  raycast(o, d) {
    if (!this.alive) return null;
    // Quick reject: distance from the ray to the body's vertical axis.
    const ox = o[0] - this.x, oz = o[2] - this.z;
    const dd = d[0] * d[0] + d[2] * d[2];
    if (dd > 1e-12) {
      const tc = -(ox * d[0] + oz * d[2]) / dd;
      const cx = ox + d[0] * tc, cz = oz + d[2] * tc;
      if (cx * cx + cz * cz > 0.8 * 0.8) return null;
    }
    // Into the body frame: translate, rotate by -bodyAngle, unsquash y.
    const a = -(Math.PI - this.yaw * DEG), ca = Math.cos(a), sa = Math.sin(a), s = this.scaleY;
    const lo = this._o, ld = this._d;
    lo[0] = ox * ca + oz * sa; lo[1] = (o[1] - this.y) / s; lo[2] = -ox * sa + oz * ca;
    ld[0] = d[0] * ca + d[2] * sa; ld[1] = d[1] / s; ld[2] = -d[0] * sa + d[2] * ca;
    const L = Math.hypot(ld[0], ld[1], ld[2]);
    ld[0] /= L; ld[1] /= L; ld[2] /= L;
    if (!raycastSoldier(lo, ld, this._hit)) return null;
    // Back to world.
    const p = this._hit.p, ia = -a, ci = Math.cos(ia), si = Math.sin(ia);
    const wx = this.x + p[0] * ci + p[2] * si, wy = this.y + p[1] * s, wz = this.z - p[0] * si + p[2] * ci;
    const t = Math.hypot(wx - o[0], wy - o[1], wz - o[2]);
    return { t, zone: this._hit.zone, p: [wx, wy, wz] };
  }
}
