// A combatant in battle mode (human or bot): body, health, team, score, and the exact hit
// test. The body is the range's training dummy (sphere head, capsule limbs) in team colours,
// so what you see is exactly what can be hit. Crouching squashes the body to CROUCH_SCALE.
import * as THREE from '../../vendor/three/three.module.min.js?v=cd68db2-mw4e6311';
import { buildDummy, raycastDummy } from '../scene/dummy.js?v=cd68db2-mw4e6311';

export const STAND_EYE = 1.6, CROUCH_EYE = 1.12;
export const CROUCH_SCALE = 0.7;
export const MAX_HEALTH = 100;
// Damage multipliers per body zone.
export const ZONE_DAMAGE = { head: 2.5, body: 1, limb: 0.75 };
// Damage per bullet when the gun data has none (by model type).
const DEFAULT_DAMAGE = { smg: 28, rifle: 36, carbine: 34, lmg: 38, marksman: 48 };
export function gunDamage(gun) { return gun.damage || DEFAULT_DAMAGE[gun.model] || 32; }

const DEG = Math.PI / 180;

export class Fighter {
  // opts: { name, team, color (hex), human }
  constructor(opts) {
    Object.assign(this, { name: 'Fighter', team: 'bots', color: 0xffffff, human: false }, opts);
    this.x = 0; this.z = 0; this.vx = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.crouch = 0;            // 0 standing .. 1 crouched (eased)
    this.health = MAX_HEALTH;
    this.alive = true;
    this.respawnAt = 0;
    this.protectUntil = 0;      // spawn protection
    this.lastHurt = -10;        // time of the last damage (regeneration waits)
    this.kills = 0; this.deaths = 0;
    this.gun = null;

    /* body */
    this.group = new THREE.Group();
    const d = buildDummy();
    d.children[1].removeFromParent();          // no base plate
    const body = d.children[0];
    body.material = new THREE.MeshLambertMaterial({ vertexColors: true, color: new THREE.Color(this.color).multiplyScalar(1.15) });
    body.castShadow = true;
    this.body = body;
    this.scaleG = new THREE.Group();
    this.scaleG.add(body);
    this.group.add(this.scaleG);
    // A carried gun: a dark block at chest height pointing forward (the body faces +z locally).
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x1d1f22 });
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), gunMat);
    gun.position.set(0.14, 1.22, 0.3);
    gun.castShadow = true;
    this.scaleG.add(gun);
    this.muzzle = new THREE.Vector3(0.14, 1.25, 0.62);   // local, standing
    // Muzzle flash (seen by others): a small additive star.
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshBasicMaterial({
      color: 0xffc070, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.flash.position.copy(this.muzzle);
    this.flash.visible = false;
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

  get eyeH() { return STAND_EYE + (CROUCH_EYE - STAND_EYE) * this.crouch; }
  get scaleY() { return 1 + (CROUCH_SCALE - 1) * this.crouch; }
  eye(out = [0, 0, 0]) { out[0] = this.x; out[1] = this.eyeH; out[2] = this.z; return out; }
  // Aim points on this fighter (world): head and chest.
  head(out = [0, 0, 0]) { out[0] = this.x; out[1] = 1.6 * this.scaleY; out[2] = this.z; return out; }
  chest(out = [0, 0, 0]) { out[0] = this.x; out[1] = 1.18 * this.scaleY; out[2] = this.z; return out; }

  // Sync the mesh with the state (call once per frame).
  updateVisual(t) {
    this.group.visible = this.alive;
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = Math.PI - this.yaw * DEG;   // dummy faces +z; yaw 0 faces -z
    this.scaleG.scale.y = this.scaleY;
    this.flash.visible = t < this.flashUntil;
    if (this.flash.visible) this.flash.rotation.z = Math.random() * Math.PI;
    const top = 1.6 * this.scaleY + 0.3;
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
    out.set(this.x + lx * Math.cos(a) + lz * Math.sin(a), ly, this.z - lx * Math.sin(a) + lz * Math.cos(a));
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
      if (cx * cx + cz * cz > 0.7 * 0.7) return null;
    }
    // Into the body frame: translate, rotate by -bodyAngle, unsquash y.
    const a = -(Math.PI - this.yaw * DEG), ca = Math.cos(a), sa = Math.sin(a), s = this.scaleY;
    const lo = this._o, ld = this._d;
    lo[0] = ox * ca + oz * sa; lo[1] = o[1] / s; lo[2] = -ox * sa + oz * ca;
    ld[0] = d[0] * ca + d[2] * sa; ld[1] = d[1] / s; ld[2] = -d[0] * sa + d[2] * ca;
    const L = Math.hypot(ld[0], ld[1], ld[2]);
    ld[0] /= L; ld[1] /= L; ld[2] /= L;
    if (!raycastDummy(lo, ld, this._hit)) return null;
    // Back to world.
    const p = this._hit.p, ia = -a, ci = Math.cos(ia), si = Math.sin(ia);
    const wx = this.x + p[0] * ci + p[2] * si, wy = p[1] * s, wz = this.z - p[0] * si + p[2] * ci;
    const t = Math.hypot(wx - o[0], wy - o[1], wz - o[2]);
    return { t, zone: this._hit.zone, p: [wx, wy, wz] };
  }
}
