// Bot brain for battle mode. Bots see along clear sight lines (within a wide view cone, or
// anyone who just shot them), react after a delay, turn towards the target at a limited
// rate with an aim error that drifts, fire bursts with the gun's real spray (partly
// controlled), strafe, crouch behind low cover, retreat to cover when hurt, and roam the
// arena on A* paths when they have no one to fight.
import { Weapon } from '../core/weapon.js';
import { RecoilEngine } from '../core/recoil.js';
import { mulberry32 } from '../core/prng.js';

// Per level: reaction (s), aim error sd (deg), turn rate (deg/s), recoil control (0..1),
// burst [min, max] shots, pause between bursts (s), head aim chance, strafes, uses cover,
// view cone (deg), move speed (m/s).
export const LEVELS = {
  easy: { name: 'Easy', reaction: 0.7, err: 1.9, turn: 120, control: 0.35, burst: [3, 5], pause: 0.75, head: 0.05, strafe: 0, cover: false, cone: 110, speed: 2.6 },
  medium: { name: 'Medium', reaction: 0.5, err: 1.3, turn: 220, control: 0.65, burst: [5, 9], pause: 0.45, head: 0.2, strafe: 0.5, cover: true, cone: 140, speed: 3.0 },
  hard: { name: 'Hard', reaction: 0.3, err: 0.6, turn: 400, control: 0.85, burst: [6, 12], pause: 0.3, head: 0.45, strafe: 1, cover: true, cone: 170, speed: 3.4 },
};

const DEG = Math.PI / 180;
const wrap180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };

export class Bot {
  // fighter: its Fighter; level: key of LEVELS; seed: per-bot randomness.
  constructor(fighter, level, gun, seed) {
    this.f = fighter;
    this.L = LEVELS[level] || LEVELS.medium;
    this.rng = mulberry32(seed >>> 0);
    this.weapon = new Weapon();
    this.recoil = new RecoilEngine();
    this.setGun(gun);
    this.target = null;
    this.seenAt = -1;          // when the current target was first seen (reaction clock)
    this.lastSeen = null;      // { x, z, t } of the last enemy sighting
    this.nextLook = 0;
    this.errYaw = 0; this.errPitch = 0; this.nextErr = 0;
    this.burstLeft = 0; this.pauseUntil = 0; this.aimHead = false;
    this.path = []; this.goal = null; this.nextPath = 0;
    this.strafeDir = 1; this.nextStrafe = 0;
    this.mode = 'roam';        // roam | fight | retreat | hold
    this.holdUntil = 0;
    this.crouchWanted = false;
    this.attacker = null; this.attackedAt = -10;
    this._eye = [0, 0, 0]; this._pt = [0, 0, 0]; this._off = [0, 0];
  }

  setGun(gun) {
    this.gun = gun;
    this.f.gun = gun;
    this.weapon.setGun(gun);
    this.weapon.reloadSpeed = 1.5;
    this.recoil.setGun(gun);
    this.recoil.newMagazine((this.rng() * 4294967296) >>> 0);
  }

  respawned() {
    this.target = null; this.seenAt = -1; this.path = []; this.goal = null; this.mode = 'roam';
    this.weapon.setGun(this.gun);
    this.weapon.reloadSpeed = 1.5;
  }

  onHurt(by, t) { this.attacker = by; this.attackedAt = t; }

  _r(a, b) { return a + (b - a) * this.rng(); }
  _gauss() { let u = 0, v = 0; while (u === 0) u = this.rng(); while (v === 0) v = this.rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // Can this bot see fighter e right now? (sight line to head or chest, inside the cone,
  // or e attacked it in the last second)
  canSee(e, arena, t) {
    const f = this.f;
    f.eye(this._eye);
    const dx = e.x - f.x, dz = e.z - f.z;
    const ang = Math.atan2(dx, -dz) / DEG;
    const inCone = Math.abs(wrap180(ang - f.yaw)) <= this.L.cone / 2 || (this.attacker === e && t - this.attackedAt < 1.2);
    if (!inCone) return false;
    return arena.sightLine(this._eye, e.head(this._pt)) || arena.sightLine(this._eye, e.chest(this._pt));
  }

  // One update. battle provides: arena, enemiesOf(fighter), fire(bot, shotT).
  update(t, dt, battle) {
    const f = this.f, L = this.L, arena = battle.arena;
    if (!f.alive) { this.weapon.releaseTrigger(); return; }

    /* perception */
    if (t >= this.nextLook) {
      this.nextLook = t + 0.12;
      let best = null, bd = Infinity;
      for (const e of battle.enemiesOf(f)) {
        if (!e.alive || t < e.protectUntil) continue;
        if (!this.canSee(e, arena, t)) continue;
        const d = Math.hypot(e.x - f.x, e.z - f.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (best !== this.target) { this.target = best; this.seenAt = best ? t : -1; this.burstLeft = 0; }
      if (best) this.lastSeen = { x: best.x, z: best.z, t };
      else if (this.attacker && this.attacker.alive && t - this.attackedAt < 1.5) this.lastSeen = { x: this.attacker.x, z: this.attacker.z, t };
    }
    const tgt = this.target;

    /* reload */
    if (this.weapon.ammo === 0 || (!tgt && this.weapon.ammo < this.gun.magSize * 0.4)) {
      if (this.weapon.startReload(t)) this.weapon.releaseTrigger();
    }

    /* mode */
    if (L.cover && f.health < 45 && this.mode !== 'retreat' && this.mode !== 'hold' && tgt) {
      const spot = this._coverFrom(tgt, arena);
      if (spot) { this.mode = 'retreat'; this._setGoal(spot.x, spot.z, arena, t); this.crouchWanted = spot.low; }
    }
    if (this.mode === 'hold' && t > this.holdUntil) this.mode = 'roam';
    if (this.mode !== 'retreat' && this.mode !== 'hold') this.mode = tgt ? 'fight' : 'roam';

    /* movement target velocity */
    let mx = 0, mz = 0, speed = L.speed;
    if (this.mode === 'fight') {
      // Strafe while fighting (medium sometimes, hard always); easy stands and shoots.
      if (L.strafe > 0 && t >= this.nextStrafe) {
        this.nextStrafe = t + this._r(0.5, 1.3);
        this.strafeDir = this.rng() < 0.5 ? -1 : 1;
        if (this.rng() > L.strafe) this.strafeDir = 0;
      }
      const y = f.yaw * DEG;
      mx = Math.cos(y) * this.strafeDir; mz = Math.sin(y) * this.strafeDir;
      speed = L.speed * 0.6;
      // Behind low cover: crouch between bursts (peek up to shoot) on hard; medium crouches when hurt.
      const nearLow = arena.coverSpots.some((s) => s.low && Math.hypot(s.x - f.x, s.z - f.z) < 0.9);
      this.crouchWanted = nearLow && (L === LEVELS.hard ? t < this.pauseUntil : f.health < 60);
    } else {
      // roam or retreat: follow the path to the goal.
      if (this.mode === 'roam') {
        this.crouchWanted = false;
        if (!this.goal || t >= this.nextPath || this.path.length === 0) {
          const ls = this.lastSeen && t - this.lastSeen.t < 6 ? this.lastSeen : null;
          // Head for where the enemy was, each bot from its own angle (no conga lines).
          if (ls) { const a = this.rng() * Math.PI * 2, r = 1.5 + this.rng() * 3; this._setGoal(ls.x + Math.cos(a) * r, ls.z + Math.sin(a) * r, arena, t); }
          else {
            const spots = arena.coverSpots;
            const s = spots[Math.floor(this.rng() * spots.length)];
            this._setGoal(s.x, s.z, arena, t);
          }
        }
      }
      const wp = this.path[0];
      if (wp) {
        const dx = wp[0] - f.x, dz = wp[1] - f.z, d = Math.hypot(dx, dz);
        if (d < 0.35) this.path.shift();
        else { mx = dx / d; mz = dz / d; }
      } else if (this.mode === 'retreat') { this.mode = 'hold'; this.holdUntil = t + this._r(1.5, 3); }
      if (this.mode === 'hold') { mx = mz = 0; }
    }
    // Ease velocity, move, collide.
    const k = 1 - Math.exp(-10 * dt);
    const sp = this.crouchWanted ? Math.min(speed, 1.5) : speed;
    f.vx += (mx * sp - f.vx) * k; f.vz += (mz * sp - f.vz) * k;
    const p = { x: f.x + f.vx * dt, z: f.z + f.vz * dt };
    arena.resolve(p);
    if (Math.hypot(p.x - (f.x + f.vx * dt), p.z - (f.z + f.vz * dt)) > 0.01 && this.mode !== 'fight') this.nextPath = 0;  // bumped: re-plan
    f.x = p.x; f.z = p.z;
    f.crouch += ((this.crouchWanted ? 1 : 0) - f.crouch) * (1 - Math.exp(-12 * dt));

    /* aim */
    let wantYaw = f.yaw, wantPitch = 0;
    if (tgt) {
      if (t >= this.nextErr) {
        this.nextErr = t + this._r(0.35, 0.8);
        // Aim settles the longer the bot tracks you: 1.5x error on first sight, 0.6x after ~2 s.
        const settle = 0.6 + 0.9 * Math.exp(-(t - this.seenAt) / 1.2);
        this.errYaw = this._gauss() * L.err * settle; this.errPitch = this._gauss() * L.err * 0.6 * settle;
      }
      if (this.burstLeft === 0) this.aimHead = this.rng() < L.head;
      const aimPt = this.aimHead ? tgt.head(this._pt) : tgt.chest(this._pt);
      f.eye(this._eye);
      const dx = aimPt[0] - this._eye[0], dy = aimPt[1] - this._eye[1], dz = aimPt[2] - this._eye[2];
      wantYaw = Math.atan2(dx, -dz) / DEG + this.errYaw;
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) / DEG + this.errPitch;
    } else if (Math.hypot(f.vx, f.vz) > 0.3) {
      wantYaw = Math.atan2(f.vx, -f.vz) / DEG;
    } else if (this.lastSeen && t - this.lastSeen.t < 4) {
      wantYaw = Math.atan2(this.lastSeen.x - f.x, -(this.lastSeen.z - f.z)) / DEG;
    }
    const step = L.turn * dt;
    const dyaw = wrap180(wantYaw - f.yaw);
    f.yaw = ((f.yaw + Math.max(-step, Math.min(step, dyaw))) % 360 + 360) % 360;
    f.pitch += Math.max(-step, Math.min(step, wantPitch - f.pitch));

    /* fire: after the reaction time, when lined up, in bursts */
    const ready = tgt && t - this.seenAt >= L.reaction && !this.weapon.reloading && t >= this.pauseUntil && t >= f.protectUntil;
    const lined = Math.abs(wrap180(wantYaw - f.yaw)) < 2.5 + L.err && Math.abs(wantPitch - f.pitch) < 2.5 + L.err;
    if (ready && lined && this.mode !== 'retreat') {
      if (!this.weapon.triggerHeld) {
        if (this.burstLeft === 0) this.burstLeft = Math.round(this._r(L.burst[0], L.burst[1]));
        this.weapon.pressTrigger(t);
      }
    } else if (this.weapon.triggerHeld) this.weapon.releaseTrigger();
    this.weapon.update(t, (shotT) => {
      battle.fire(this, shotT);
      if (--this.burstLeft <= 0) { this.burstLeft = 0; this.weapon.releaseTrigger(); this.pauseUntil = shotT + this._r(L.pause * 0.7, L.pause * 1.3); }
    });
  }

  // Direction of the next bullet: aim plus the uncontrolled part of the gun's spray.
  shotDirection(t, out) {
    const f = this.f;
    // A new burst starts from the bot's own aim: drop the last burst's leftover recoil.
    if (t - this.recoil.lastShot > Math.max(this.gun.resetSeconds, this.recoil.easeDur)) { this.recoil.clearOffset(); this.recoil.shotIndex = 0; }
    this.recoil.fire(t, this._off);
    const k = 1 - this.L.control;
    const yaw = (f.yaw + this._off[0] * k) * DEG, pitch = (f.pitch + this._off[1] * k) * DEG;
    const cp = Math.cos(pitch);
    out[0] = Math.sin(yaw) * cp; out[1] = Math.sin(pitch); out[2] = -Math.cos(yaw) * cp;
    return out;
  }

  _setGoal(x, z, arena, t) {
    this.goal = { x, z };
    this.path = arena.findPath(this.f.x, this.f.z, x, z);
    this.nextPath = t + this._r(1.8, 3.2);
  }

  // A cover spot near me that the threat cannot see (crouched height if it is low cover).
  _coverFrom(threat, arena) {
    const f = this.f, eye = threat.eye([0, 0, 0]);
    let best = null, bd = Infinity;
    for (const s of arena.coverSpots) {
      const d = Math.hypot(s.x - f.x, s.z - f.z);
      if (d > 9 || d >= bd) continue;
      const h = s.low ? 0.95 : 1.5;
      if (arena.sightLine(eye, [s.x, h, s.z])) continue;
      best = s; bd = d;
    }
    return best;
  }
}
