// A human player in battle mode: movement with collision, crouch, sprint, lean, aiming,
// the weapon with its real spray, and a first-person weapon model.
//
// Controls:
//   mouse (player 1):   mouse look, WASD move, Shift sprint, Space crouch, Q/E lean,
//                       C vault / climb, left button fire, right button aim, R reload.
//   pad   (player 2):   left stick move, right stick look, RT fire, LT aim, X reload,
//                       B crouch, A vault, L3 sprint, LB/RB lean.
//   keys  (player 2, no gamepad): I J K L move, arrow keys look, Enter fire,
//                       Right Shift aim, Backspace reload, / crouch.
import * as THREE from '../../vendor/three/three.module.min.js?v=bbc2366-mwdhu71j';
import { Look, PITCH_LIMIT } from '../core/look.js?v=bbc2366-mwdhu71j';
import { Weapon } from '../core/weapon.js?v=bbc2366-mwdhu71j';
import { RecoilEngine } from '../core/recoil.js?v=bbc2366-mwdhu71j';
import { Spread } from '../core/spread.js?v=bbc2366-mwdhu71j';
import { focalRatio } from '../core/sensitivity.js?v=bbc2366-mwdhu71j';
import { WeaponRig } from '../scene/viewmodel.js?v=bbc2366-mwdhu71j';
import { EYE_Z, VIEW_H } from '../scene/sight-model.js?v=bbc2366-mwdhu71j';
import { reticleTextures } from '../ui/reticle-tex.js?v=bbc2366-mwdhu71j';
import { RETICLE_COLORS } from '../ui/scope.js?v=bbc2366-mwdhu71j';

const DEG = Math.PI / 180;
const WALK = 3.4, SPRINT = 5.6, CROUCH_WALK = 1.6, ADS_WALK = 2.2;
const LEAN_DIST = 0.32, LEAN_ROLL = 11;
const PAD_LOOK = 210, KEY_LOOK = 150;      // degrees per second at full stick / key
const easeOut = (x) => 1 - (1 - x) ** 3;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Human {
  // deps: { renderer, settings, sfx, opticFor(gun), adsVFov(optic), baseDpc() }
  constructor(fighter, controls, deps, slotOf) {
    this.f = fighter;
    this.controls = controls;          // 'mouse' | 'pad' | 'keys'
    this.deps = deps;
    this.slotOf = slotOf;              // gun -> loadout slot (skin / finish)
    this.look = new Look();
    this.weapon = new Weapon();
    this.recoil = new RecoilEngine();
    this.spread = new Spread();
    this._spr = [0, 0];
    this.camera = new THREE.PerspectiveCamera(deps.settings.fov, 1, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.rig = new WeaponRig(deps.renderer);
    this.rig.applyLights();
    this.in = { fwd: false, back: false, left: false, right: false, sprint: false, crouch: false, leanL: false, leanR: false, fire: false, ads: false, vault: false };
    this.vault = null;                 // { t0, dur, from, to, peak } while vaulting
    this._vaultWas = false;
    this.camY = 0;                     // smoothed feet height for the camera (stairs)
    this.ads = false; this.adsP = 0; this.adsE = 0;
    this.lean = 0;
    this.offset = [0, 0]; this.bulletOff = [0, 0];
    this.fovV = deps.settings.fov;
    this.walkPhase = 0;
    this.padIndex = -1;
    this.reticle = null;
    this._fireWas = false;
    this._dir = [0, 0, 0]; this._eye = [0, 0, 0];
  }

  setGun(gun) {
    this.gun = gun;
    this.f.gun = gun;
    this.optic = gun ? this.deps.opticFor(gun) : null;
    this.weapon.setGun(gun);
    this.weapon.reloadSpeed = this.deps.settings.reloadSpeed;
    this.recoil.setGun(gun);
    if (!gun) { this.rig.root.visible = false; return; }
    this.recoil.setScale(gun.opticRecoilScale[this.optic.id] || 1);
    this.recoil.aimScale = this.deps.settings.aimRecoil;
    this.recoil.hipScale = this.deps.settings.hipRecoil;
    this.recoil.aimSmooth = this.deps.settings.aimSmooth;
    this.recoil.newMagazine((Math.random() * 4294967296) >>> 0);
    this.rig.setGun(gun, this.slotOf(gun), this.optic);
    this._buildReticle();
  }

  // The sight's reticle as a glowing quad in the weapon scene at the sight's window, so it
  // lines up with the screen centre when fully aimed (split screen has no lens pass).
  _buildReticle(H = 1080) {
    if (this.reticle) { this.reticle.removeFromParent(); this.reticle.geometry.dispose(); this.reticle.material.dispose(); }
    const ret = reticleTextures(this.optic, RETICLE_COLORS[this.deps.settings.reticleColor] || RETICLE_COLORS.red, H);
    const half = ret.half / 1080 * VIEW_H;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshBasicMaterial({
      map: ret.texture, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    m.position.set(0, 0, -EYE_Z - 0.001);
    m.renderOrder = 20;
    m.frustumCulled = false;
    this.rig.root.add(m);
    this.reticle = m;
  }

  respawn(x, z, t, y = 0) {
    if (this.controls === 'mouse') this.deps.controls?.release();
    const f = this.f;
    f.x = x; f.z = z; f.y = y; f.vx = f.vy = f.vz = 0; f.crouch = 0;
    this.camY = y; this.vault = null;
    // Face the middle of the arena.
    this.look.setAngles(Math.atan2(-x, z) / DEG, 0);
    this.recoil.reset(); this.recoil.clearOffset(); this.offset[0] = this.offset[1] = 0;
    this.weapon.setGun(this.gun);
    this.weapon.reloadSpeed = this.deps.settings.reloadSpeed;
    this.setAds(false); this.adsP = this.adsE = 0;
    this.rig.drawT = 0;
  }

  releaseAll() {
    for (const k of Object.keys(this.in)) this.in[k] = false;
    this.weapon.releaseTrigger();
    this.setAds(false);
  }

  setAds(on) {
    if (this.ads === on) return;
    const e = this.adsE;
    this.ads = on;
    if (on) this.rig.cancelInspect();
    this.adsP = on ? 1 - Math.cbrt(1 - e) : Math.cbrt(e);
  }

  // Degrees per mouse count right now (focal-length scaling while aiming, like the range).
  dpc() {
    const s = this.deps.settings;
    return this.deps.baseDpc() * focalRatio(this.fovV, s.fov, s.mdm);
  }

  mouseMove(dx, dy) {
    if (!this.f.alive) return;
    const d = this.dpc(), s = this.deps.settings;
    if (this.look.apply(dx, dy, d, d * s.sensV / s.sensH) && this.adsP > 0) {
      const pxPerDeg = 1080 / this.fovV;
      this.rig.nudge(dx * d * pxPerDeg, dy * d * pxPerDeg);
    }
  }

  // Player 2: keyboard state is set by key(); a gamepad is polled here.
  pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = this.padIndex >= 0 ? pads[this.padIndex] : null;
    if (!pad) { for (const p of pads) if (p && p.connected) { pad = p; this.padIndex = p.index; break; } }
    let lx = 0, ly = 0;
    if (pad) {
      this.controls = 'pad';
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const ax = pad.axes;
      const mx = dz(ax[0] || 0), my = dz(ax[1] || 0);
      this.in.fwd = my < -0.3; this.in.back = my > 0.3; this.in.left = mx < -0.3; this.in.right = mx > 0.3;
      this._stick = [mx, my];
      lx = dz(ax[2] || 0); ly = dz(ax[3] || 0);
      const b = (i) => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
      this.in.fire = b(7); this.in.ads = b(6); this.in.crouch = b(1); this.in.sprint = b(10) || this.in.sprint && Math.hypot(mx, my) > 0.5;
      this.in.leanL = b(4); this.in.leanR = b(5); this.in.vault = b(0);
      if (b(2) && !this._reloadWas) this.reload();
      this._reloadWas = b(2);
      if (b(3) && !this._inspectWas && !this.ads) this.rig.inspect();   // Y: inspect
      this._inspectWas = b(3);
      lx = Math.sign(lx) * lx * lx; ly = Math.sign(ly) * ly * ly;      // finer aim near centre
      const rate = PAD_LOOK * focalRatio(this.fovV, this.deps.settings.fov, 0) * dt;
      this._turn(lx * rate, ly * rate);
    } else if (this.controls !== 'mouse') {
      this.controls = 'keys';
      this._stick = null;
      const k = this._keysLook || { x: 0, y: 0 };
      const rate = KEY_LOOK * focalRatio(this.fovV, this.deps.settings.fov, 0) * dt;
      this._turn(k.x * rate, k.y * rate);
    }
  }
  _turn(dyaw, dpitch) {
    if (!this.f.alive || (!dyaw && !dpitch)) return;
    this.look.setAngles(this.look.yaw + dyaw, Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.look.pitch - dpitch)));
  }

  reload() { if (this.f.alive && this.weapon.startReload(this.deps.now())) this.deps.sfx.reload(); }

  // Keyboard for player 2 without a gamepad. Returns true if handled.
  key(code, down) {
    const map = { KeyI: 'fwd', KeyK: 'back', KeyJ: 'left', KeyL: 'right', Enter: 'fire', ShiftRight: 'ads', Slash: 'crouch', Period: 'sprint' };
    if (map[code]) { this.in[map[code]] = down; return true; }
    const look = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[code];
    if (look) {
      this._keysHeld = this._keysHeld || new Set();
      if (down) this._keysHeld.add(code); else this._keysHeld.delete(code);
      const k = { x: 0, y: 0 };
      for (const c of this._keysHeld) { const v = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[c]; k.x += v[0]; k.y += v[1]; }
      this._keysLook = k;
      return true;
    }
    if (code === 'Backspace') { if (down) this.reload(); return true; }
    return false;
  }

  // Simulation step. battle.fire(this, shotT) is called for each bullet.
  update(t, dt, battle) {
    const f = this.f, s = this.deps.settings;
    if (this.controls !== 'mouse') this.pollPad(dt);
    if (!f.alive) { this.weapon.releaseTrigger(); this.setAds(false); }
    // Trigger and aim from the input state.
    if (this.gun && f.alive && !this.vault) {
      if (this.in.fire && !this._fireWas) {
        if (this.weapon.ammo === 0 && !this.weapon.reloading) this.deps.sfx.click();
        this.weapon.pressTrigger(t);
      } else if (!this.in.fire && this._fireWas) this.weapon.releaseTrigger();
      this.setAds(this.in.ads);
    }
    this._fireWas = this.in.fire;
    if (t < f.protectUntil && this.in.fire) f.protectUntil = t;     // shooting ends spawn protection
    const ammoBefore = this.weapon.ammo;
    const ev = this.weapon.update(t, (shotT) => battle.fire(this, shotT));
    if (ev === 'reloaded' || (this.weapon.ammo === 0 && ammoBefore > 0)) this.recoil.newMagazine((Math.random() * 4294967296) >>> 0);
    if (ev === 'reloaded') this.deps.sfx.reload();
    if (s.autoReload && f.alive && this.weapon.ammo === 0 && !this.weapon.reloading && this.weapon.startReload(t)) this.deps.sfx.reload();

    // Recoil view offset; leftover recoil folds into the aim after the spray (no recovery).
    this.recoil.offsetAt(t, this.offset);
    if (this.gun && (this.offset[0] || this.offset[1]) && t - this.recoil.lastShot > Math.max(this.gun.resetSeconds, this.recoil.easeDur)) {
      this.look.setAngles(this.look.yaw + this.offset[0], this.look.pitch + this.offset[1]);
      this.recoil.clearOffset();
      this.offset[0] = this.offset[1] = 0;
    }

    // Movement relative to the facing direction, with collision.
    const crouched = this.in.crouch && f.alive;
    let fwd = (this.in.fwd ? 1 : 0) - (this.in.back ? 1 : 0), side = (this.in.right ? 1 : 0) - (this.in.left ? 1 : 0);
    if (this._stick) { side = this._stick[0]; fwd = -this._stick[1]; }
    const sprinting = this.in.sprint && !crouched && !this.ads && fwd > 0.3;
    let tx = 0, tz = 0;
    if (f.alive && (fwd || side)) {
      const y = this.look.yaw * DEG;
      tx = fwd * Math.sin(y) + side * Math.cos(y);
      tz = -fwd * Math.cos(y) + side * Math.sin(y);
      const l = Math.max(1, Math.hypot(tx, tz));
      const sp = (crouched ? CROUCH_WALK : this.ads ? ADS_WALK : sprinting ? SPRINT : WALK) * (this.speedMult ?? 1);
      tx = tx / l * sp; tz = tz / l * sp;
    }
    const arena = battle.arena;
    // Vault / climb (C): over low cover, or up onto a ledge up to 1.5 m.
    // a tap shorter than a frame (slow PCs) still counts: the key handlers set _vaultTap on key-down
    const vaultIn = this.in.vault || this._vaultTap; this._vaultTap = false;
    if (vaultIn && !this._vaultWas && f.alive && !this.vault && dt > 0) {
      const y = this.look.yaw * DEG, dx = Math.sin(y), dz = -Math.cos(y);
      const to = arena.vaultTarget(f.x, f.y, f.z, dx, dz);
      if (to) {
        this.vault = { t: 0, dur: 0.32 + 0.12 * Math.max(0, to.top - f.y), from: { x: f.x, y: f.y, z: f.z }, to, peak: to.top + 0.22 };
        this.setAds(false); this.weapon.releaseTrigger(); this.rig.cancelInspect();
        if (this.deps.sfx.vault) this.deps.sfx.vault();
      }
    }
    this._vaultWas = vaultIn;
    if (this.vault && f.alive) {
      const v = this.vault;
      v.t += dt;
      const p = Math.min(1, v.t / v.dur), e = (x) => x * x * (3 - 2 * x);
      f.x = v.from.x + (v.to.x - v.from.x) * e(p);
      f.z = v.from.z + (v.to.z - v.from.z) * e(p);
      f.y = p < 0.45 ? v.from.y + (v.peak - v.from.y) * e(p / 0.45) : v.peak + (v.to.y - v.peak) * e((p - 0.45) / 0.55);
      f.crouch += (0.35 - f.crouch) * (1 - Math.exp(-16 * dt));
      if (p >= 1) {
        this.vault = null;
        f.y = v.to.y; f.vy = 0;
        const L = Math.hypot(v.to.x - v.from.x, v.to.z - v.from.z) || 1;
        f.vx = (v.to.x - v.from.x) / L * WALK * 0.8; f.vz = (v.to.z - v.from.z) / L * WALK * 0.8;
      }
    } else {
      if (!f.alive) this.vault = null;
      const k = 1 - Math.exp(-14 * dt);
      f.vx += (tx - f.vx) * k; f.vz += (tz - f.vz) * k;
      // The core moves the body: in steps too short to pass through a thin wall or a door on
      // a slow frame, up stairs and ramps as it goes, then standing on what is underneath
      // or falling.
      const p = this._body || (this._body = { x: 0, y: 0, z: 0, vy: 0 });
      p.x = f.x; p.y = f.y; p.z = f.z; p.vy = f.vy || 0;
      f.onGround = arena.stepBody(p, f.vx * dt, f.vz * dt, dt);
      f.x = p.x; f.y = p.y; f.z = p.z; f.vy = p.vy;
      f.crouch += ((crouched ? 1 : 0) - f.crouch) * (1 - Math.exp(-16 * dt));
    }
    // The camera follows steps smoothly; falls and vaults directly.
    if (this.vault || Math.abs(f.y - this.camY) > 1.2 || f.y < this.camY) this.camY = f.y;
    else this.camY += (f.y - this.camY) * (1 - Math.exp(-20 * dt));
    const lt = (this.in.leanR ? 1 : 0) - (this.in.leanL ? 1 : 0);
    this.lean += (lt - this.lean) * (1 - Math.exp(-14 * dt));
    f.yaw = this.look.yaw; f.pitch = this.look.pitch;
    f.lean = this.lean; f.viewOptic = this.optic?.id;
    f.viewDY = this.offset[0]; f.viewDP = this.offset[1];

    // Aim-down-sights blend and FOV (vertical FOV setting; sight's aimed FOV).
    const target = this.ads ? 1 : 0;
    if (this.adsP !== target) {
      // 0.15 s for the catalogue gun; attachments scale it (angled grip faster, extended mag slower).
      const g = this.gun, step = dt / (0.15 * (g && g.base ? g.adsSeconds / (g.base.adsSeconds || 0.3) : 1));
      this.adsP = target ? Math.min(1, this.adsP + step) : Math.max(0, this.adsP - step);
    }
    this.adsE = this.ads ? easeOut(this.adsP) : 1 - easeOut(1 - this.adsP);
    f.ads = this.adsE;
    const tHip = Math.tan(s.fov * DEG / 2), tAds = this.optic ? Math.tan(this.deps.adsVFov(this.optic) * DEG / 2) : tHip;
    this.fovV = 2 * Math.atan(tHip + (tAds - tHip) * this.adsE) / DEG;

    // Camera: eye + lean, aim + recoil offset; dead players see the floor where they fell.
    const y = this.look.yaw * DEG;
    const cam = this.camera;
    if (f.alive) {
      cam.position.set(f.x + Math.cos(y) * LEAN_DIST * this.lean, this.camY + f.eyeH - 0.05 * Math.abs(this.lean), f.z + Math.sin(y) * LEAN_DIST * this.lean);
      cam.rotation.set(Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.look.pitch + this.offset[1])) * DEG, -(this.look.yaw + this.offset[0]) * DEG, -LEAN_ROLL * this.lean * DEG);
    } else {
      cam.position.set(f.x, f.y + 0.45, f.z);
      cam.rotation.set(-0.25, -y, 0.5);
    }
    if (cam.fov !== this.fovV) { cam.fov = this.fovV; cam.updateProjectionMatrix(); }

    // Weapon model.
    const rig = this.rig;
    this.walkPhase += dt * 9 * Math.min(1, Math.hypot(f.vx, f.vz) / 3);
    rig.bobY = Math.sin(this.walkPhase) * 0.004 * Math.min(1, Math.hypot(f.vx, f.vz) / 3) * (1 - 0.8 * this.adsE);
    rig.animations = s.animations;
    rig.reloadP = this.weapon.reloading ? this.weapon.reloadProgress : -1;
    rig.reloadEmpty = !!this.weapon.reloadEmpty;
    rig.sprinting = sprinting || !!this.vault;
    rig.update(dt, this.adsE, t);
    rig.root.visible = f.alive && !!this.gun;
    if (this.reticle) this.reticle.material.opacity = smooth(0.55, 0.9, this.adsE);
  }

  // Unit direction of a bullet fired now (aim + spray offset at the shot).
  shotDirection(t, out) {
    this.recoil.aimed = this.ads;
    this.recoil.fire(t, this.bulletOff);
    const sp = this._spr;
    if (this.deps.settings.hipSpread && !this.ads) this.spread.shot(t, this.gun, Math.hypot(this.f.vx, this.f.vz) > 0.5, this.f.crouch > 0.5, this.adsE, Math.random, sp);
    else sp[0] = sp[1] = 0;
    const yaw = (this.look.yaw + this.bulletOff[0] + sp[0]) * DEG;
    const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.look.pitch + this.bulletOff[1] + sp[1])) * DEG;
    const cp = Math.cos(pitch);
    out[0] = Math.sin(yaw) * cp; out[1] = Math.sin(pitch); out[2] = -Math.cos(yaw) * cp;
    this.rig.kick();
    return out;
  }
  // Eye position now (shots leave from here; the camera follows at the end of update()).
  eye(out) {
    const f = this.f, y = this.look.yaw * DEG;
    out[0] = f.x + Math.cos(y) * LEAN_DIST * this.lean;
    out[1] = this.camY + f.eyeH - 0.05 * Math.abs(this.lean);
    out[2] = f.z + Math.sin(y) * LEAN_DIST * this.lean;
    return out;
  }
}
