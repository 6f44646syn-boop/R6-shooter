// Bot brain for battle mode. Bots see along clear sight lines (within a view cone, or anyone
// who just shot at them), hear gunfire, footsteps, vaults and reloads (less through walls),
// react after a delay, aim with a human-like hand (_aim), fire bursts with the gun's real
// spray (partly controlled), strafe, crouch behind low cover, fall back to cover to reload or
// when hurt, and roam on A* paths. Bots on one team talk: they call out what they see and
// hear, and teammates go there, some of them round the side (flanking).
//
// Levels: Easy, Medium, Hard and Terminator (near-instant, precise, leads moving targets,
// hears everything, always pushes on a callout).
import { Weapon } from '../core/weapon.js?v=9163767-mw60jd0c';
import { RecoilEngine } from '../core/recoil.js?v=9163767-mw60jd0c';
import { mulberry32 } from '../core/prng.js?v=9163767-mw60jd0c';

// Per level: reaction (s), aim error sd (deg), turn rate when not fighting (deg/s), recoil
// control (0..1), burst [min, max] shots, pause between bursts (s), head aim chance, strafes,
// uses cover, view cone (deg), move speed (m/s); and the "hand": motor (flick duration
// factor, 1 = an average player), flick (smallest error worth a flick, deg), pursuit
// (tracking rate, 1/s), tremor (hand shake, deg).
export const LEVELS = {
  easy: { name: 'Easy', reaction: 0.7, err: 1.9, turn: 120, control: 0.35, burst: [3, 5], pause: 0.75, head: 0.05, strafe: 0, cover: false, cone: 110, speed: 2.6, motor: 1.5, flick: 3, pursuit: 5, tremor: 0.22 },
  medium: { name: 'Medium', reaction: 0.5, err: 1.3, turn: 220, control: 0.65, burst: [5, 9], pause: 0.45, head: 0.2, strafe: 0.5, cover: true, cone: 140, speed: 3.0, motor: 1.15, flick: 2.2, pursuit: 8, tremor: 0.14 },
  hard: { name: 'Hard', reaction: 0.3, err: 0.6, turn: 400, control: 0.85, burst: [6, 12], pause: 0.3, head: 0.45, strafe: 1, cover: true, cone: 170, speed: 3.4, motor: 0.85, flick: 1.5, pursuit: 12, tremor: 0.09 },
  terminator: { name: 'Terminator', reaction: 0.17, err: 0.22, turn: 600, control: 0.97, burst: [12, 22], pause: 0.12, head: 0.75, strafe: 1, cover: true, cone: 210, speed: 3.9, motor: 0.55, flick: 0.9, pursuit: 20, tremor: 0.035, lead: true },
};
// How far each level hears (x the sound's range) and how often it flanks on a callout.
const HEARING = { easy: 0.6, medium: 0.85, hard: 1, terminator: 1.35 };
const FLANK = { easy: 0, medium: 0.3, hard: 0.5, terminator: 0.6 };

const DEG = Math.PI / 180;
const wrap180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };

export class Bot {
  // fighter: its Fighter; level: key of LEVELS; seed: per-bot randomness.
  constructor(fighter, level, gun, seed) {
    this.f = fighter;
    this.L = LEVELS[level] || LEVELS.medium;
    this.level = LEVELS[level] ? level : 'medium';
    this.heard = null;         // { x, y, z, t, kind } the last thing it heard
    this.lastSay = -10; this.calledTarget = null;
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
    // The "hand" (see _aim): where the bot means to aim, the current flick, shake phases.
    this.ay = fighter.yaw; this.ap = 0; this.mv = null; this.settleUntil = 0; this.adsE = 0;
    this.tr = 0; this.ph = [0, 1, 2, 3].map(() => this.rng() * 6.283);
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
    this.heard = null; this.calledTarget = null; this.flank = 0; this.lastSeen = null;
    this.ay = this.f.yaw; this.ap = 0; this.mv = null; this.adsE = 0; this.f.ads = 0; this.f.viewDY = this.f.viewDP = 0;
    this.weapon.setGun(this.gun);
    this.weapon.reloadSpeed = 1.5;
  }

  onHurt(by, t) { this.attacker = by; this.attackedAt = t; }
  // A bullet went close past: the shooter gives themselves away.
  onShotAt(by, t) { if (!this.target) { this.attacker = by; this.attackedAt = t; } }
  // A teammate's callout: go and look (unless already fighting).
  onCallout(intel, t, battle) {
    if (this.target || !this.f.alive || this === intel.from) return;
    if (this.lastSeen && this.lastSeen.t >= intel.t) return;
    this.lastSeen = { x: intel.x, z: intel.z, y: intel.y, t: intel.t, shared: true };
    this.flank = this.rng() < FLANK[this.level] ? (this.rng() < 0.5 ? -1 : 1) : 0;
    this.nextPath = Math.min(this.nextPath, t + 0.2 + this.rng() * 0.4);
    if (this.flank && this.rng() < 0.6) this.say(battle, t, 'Flanking ' + (this.flank < 0 ? 'left' : 'right') + '!');
  }
  // Say something on the team radio (rate-limited).
  say(battle, t, text, force = false) {
    if (!force && t - this.lastSay < 2.5) return;
    this.lastSay = t;
    if (battle.radio) battle.radio(this.f, text, t);
  }

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
    // At night someone with their flashlight off is hard to spot beyond a few metres.
    if (arena.atm && arena.atm.night && !e.light && Math.hypot(dx, dz) > 9 && !(this.attacker === e && t - this.attackedAt < 1.2) && t > e.flashUntil + 0.3) return false;
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
      if (best !== this.target) {
        if (!best && this.target && this.target.alive) this.say(battle, t, 'Lost them.');
        this.target = best; this.seenAt = best ? t : -1; this.burstLeft = 0;
      }
      if (best) {
        this.lastSeen = { x: best.x, z: best.z, y: best.y, t };
        // Call it out to the team (once per sighting, after a moment).
        if (this.calledTarget !== best && t - this.seenAt > 0.25) {
          this.calledTarget = best;
          this.say(battle, t, 'Contact! ' + battle.arena.placeName(best.x, best.z, best.y) + '.', true);
          if (battle.shareIntel) battle.shareIntel(this, { x: best.x, y: best.y, z: best.z, t, from: this });
        }
      } else if (this.attacker && this.attacker.alive && t - this.attackedAt < 1.5) this.lastSeen = { x: this.attacker.x, z: this.attacker.z, y: this.attacker.y, t };
      else {
        // Nothing in sight: listen.
        const h = this._listen(battle, t);
        if (h && (!this.heard || h.t > this.heard.t + 1.5 || h.loud > this.heard.loud)) {
          this.heard = h;
          this.lastSeen = { x: h.x, z: h.z, y: h.y, t, heard: true };
          this.nextPath = Math.min(this.nextPath, t + 0.25);
          if (h.kind === 'shot') { this.say(battle, t, 'Shots ' + battle.arena.placeName(h.x, h.z, h.y) + '!'); if (battle.shareIntel) battle.shareIntel(this, { x: h.x, y: h.y, z: h.z, t, from: this }); }
          else if (h.kind === 'steps' && h.d < 10) this.say(battle, t, 'Footsteps close, ' + battle.arena.placeName(h.x, h.z, h.y) + '.');
          else if (h.kind === 'reload') this.say(battle, t, 'They are reloading! Push!');
        }
      }
    }
    const tgt = this.target;

    /* reload */
    if (this.weapon.ammo === 0 || (!tgt && this.weapon.ammo < this.gun.magSize * 0.4)) {
      if (this.weapon.startReload(t)) {
        this.weapon.releaseTrigger();
        if (tgt) {
          this.say(battle, t, 'Reloading, cover me!');
          if (L.cover && this.mode !== 'retreat' && this.level !== 'terminator') {
            const spot = this._coverFrom(tgt, arena);
            if (spot) { this.mode = 'retreat'; this._setGoal(spot.x, spot.z, arena, t, spot.y); this.crouchWanted = spot.low; }
          }
        }
      }
    }

    /* mode */
    if (L.cover && f.health < 45 && this.mode !== 'retreat' && this.mode !== 'hold' && tgt && this.level !== 'terminator') {
      const spot = this._coverFrom(tgt, arena);
      if (spot) { this.mode = 'retreat'; this._setGoal(spot.x, spot.z, arena, t, spot.y); this.crouchWanted = spot.low; this.say(battle, t, "I'm hit, falling back!"); }
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
      const nearLow = arena.coverSpots.some((s) => s.low && Math.abs(s.y - f.y) < 0.3 && Math.hypot(s.x - f.x, s.z - f.z) < 0.9);
      this.crouchWanted = nearLow && (L === LEVELS.hard ? t < this.pauseUntil : f.health < 60);
    } else {
      // roam or retreat: follow the path to the goal.
      if (this.mode === 'roam') {
        this.crouchWanted = false;
        if (!this.goal || t >= this.nextPath) {
          const ls = this.lastSeen && t - this.lastSeen.t < 6 ? this.lastSeen : null;
          // Head for where the enemy was, each bot from its own angle (no conga lines).
          if (ls && this.flank && Math.hypot(ls.x - f.x, ls.z - f.z) > 8) {
            // round the side: a point beside the enemy, square to the direct line
            const dx = ls.x - f.x, dz = ls.z - f.z, L2 = Math.hypot(dx, dz), side = this.flank * (6 + this.rng() * 3);
            this._setGoal(ls.x - dz / L2 * side - dx / L2 * 2, ls.z + dx / L2 * side - dz / L2 * 2, arena, t, ls.y || 0);
            if (!this.path.length) this._setGoal(ls.x, ls.z, arena, t, ls.y || 0);
          } else if (ls) { const a = this.rng() * Math.PI * 2, r = 1.5 + this.rng() * 3; this._setGoal(ls.x + Math.cos(a) * r, ls.z + Math.sin(a) * r, arena, t, ls.y || 0); }
          else {
            const spots = arena.coverSpots;
            const s = spots[Math.floor(this.rng() * spots.length)];
            this._setGoal(s.x, s.z, arena, t, s.y);
          }
        }
      }
      const wp = this.path[0];
      if (wp) {
        const dx = wp[0] - f.x, dz = wp[1] - f.z, d = Math.hypot(dx, dz);
        if (d < 0.35) { this.path.shift(); if (!this.path.length) this.nextPath = Math.min(this.nextPath, t + 0.2); }
        else { mx = dx / d; mz = dz / d; }
      } else if (this.mode === 'retreat') { this.mode = 'hold'; this.holdUntil = t + this._r(1.5, 3); }
      if (this.mode === 'hold') { mx = mz = 0; }
    }
    // Ease velocity, move, collide.
    const k = 1 - Math.exp(-10 * dt);
    const sp = (this.crouchWanted ? Math.min(speed, 1.5) : speed) * (1 - 0.35 * this.adsE);
    f.vx += (mx * sp - f.vx) * k; f.vz += (mz * sp - f.vz) * k;
    const p = { x: f.x + f.vx * dt, y: f.y, z: f.z + f.vz * dt };
    arena.resolve(p);
    if (Math.hypot(p.x - (f.x + f.vx * dt), p.z - (f.z + f.vz * dt)) > 0.01 && this.mode !== 'fight') this.nextPath = Math.min(this.nextPath, t + 0.4);  // bumped: re-plan soon
    // Never walk into acid (strafing included).
    if (!arena.hazards.length || arena.hazardAt(p.x, arena.groundAt(p.x, p.z, f.y), p.z) === 0 || arena.hazardAt(f.x, f.y, f.z) > 0) { f.x = p.x; f.z = p.z; }
    else { f.vx = f.vz = 0; this.strafeDir = -this.strafeDir; }
    // Stand on what is underneath, or fall.
    const g = arena.groundAt(f.x, f.z, f.y);
    if (g >= f.y - 1e-4) { f.y = g; f.vy = 0; }
    else { f.vy -= 22 * dt; f.y = Math.max(g, f.y + f.vy * dt); if (f.y === g) f.vy = 0; }
    f.crouch += ((this.crouchWanted ? 1 : 0) - f.crouch) * (1 - Math.exp(-12 * dt));

    /* aim */
    let wantYaw = f.yaw, wantPitch = 0;
    if (tgt) {
      if (t >= this.nextErr) {
        this.nextErr = t + this._r(0.35, 0.8);
        // Aim settles the longer the bot tracks you: 1.5x error on first sight, 0.6x after ~2 s.
        const settle = 0.6 + 0.9 * Math.exp(-(t - this.seenAt) / 1.2);
        // (half of it: the rest of the inaccuracy now comes from the hand: flicks, lag, shake)
      this.errYaw = this._gauss() * L.err * 0.5 * settle; this.errPitch = this._gauss() * L.err * 0.3 * settle;
      }
      if (this.burstLeft === 0) this.aimHead = this.rng() < L.head;
      const aimPt = this.aimHead ? tgt.head(this._pt) : tgt.chest(this._pt);
      if (L.lead) { aimPt[0] += (tgt.vx || 0) * 0.06; aimPt[2] += (tgt.vz || 0) * 0.06; }
      f.eye(this._eye);
      const dx = aimPt[0] - this._eye[0], dy = aimPt[1] - this._eye[1], dz = aimPt[2] - this._eye[2];
      wantYaw = Math.atan2(dx, -dz) / DEG + this.errYaw;
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) / DEG + this.errPitch;
    } else if (this.lastSeen && t - this.lastSeen.t < 5 && Math.hypot(this.lastSeen.x - f.x, this.lastSeen.z - f.z) > 2) {
      // Pre-aim: crosshair at head height towards where they were seen or heard, even while
      // walking (Easy only looks where it walks).
      if (this.level !== 'easy' || Math.hypot(f.vx, f.vz) < 0.3) {
        const ls = this.lastSeen; f.eye(this._eye);
        wantYaw = Math.atan2(ls.x - f.x, -(ls.z - f.z)) / DEG;
        wantPitch = Math.atan2((ls.y || 0) + 1.55 - this._eye[1], Math.hypot(ls.x - f.x, ls.z - f.z)) / DEG;
      } else wantYaw = Math.atan2(f.vx, -f.vz) / DEG;
    } else if (Math.hypot(f.vx, f.vz) > 0.3) {
      wantYaw = Math.atan2(f.vx, -f.vz) / DEG;
    }
    this._aim(t, dt, tgt, wantYaw, wantPitch);
    // Aim down sights while fighting (the third-person pose and replays show it); slower.
    const adsWant = tgt && t - this.seenAt > L.reaction * 0.5 && this.mode !== 'retreat' ? 1 : 0;
    this.adsE += Math.max(-dt / 0.2, Math.min(dt / 0.2, adsWant - this.adsE));
    f.ads = this.adsE;
    // The view climbs with the recoil you have not pulled down, and settles after a burst.
    if (!this.weapon.triggerHeld) { const k = Math.exp(-6 * dt); f.viewDY = (f.viewDY || 0) * k; f.viewDP = (f.viewDP || 0) * k; }

    /* fire: after the reaction time, when lined up, in bursts */
    const ready = tgt && t - this.seenAt >= L.reaction && !this.weapon.reloading && t >= this.pauseUntil && t >= f.protectUntil;
    const lined = Math.abs(wrap180(wantYaw - f.yaw)) < 2.5 + L.err && Math.abs(wantPitch - f.pitch) < 2.5 + L.err;
    const steady = !this.mv || this.mv.t > this.mv.T * 0.8;      // fire as a flick lands, not halfway
    if (ready && lined && steady && this.mode !== 'retreat') {
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
    f.viewDY = this._off[0] * k; f.viewDP = this._off[1] * k;
    const yaw = (f.yaw + f.viewDY) * DEG, pitch = (f.pitch + f.viewDP) * DEG;
    const cp = Math.cos(pitch);
    out[0] = Math.sin(yaw) * cp; out[1] = Math.sin(pitch); out[2] = -Math.cos(yaw) * cp;
    return out;
  }

  // The loudest enemy sound this bot can hear now: { x, y, z, t, kind, loud, d } or null.
  // Sounds carry less through walls; where it came from is only roughly known.
  _listen(battle, t) {
    const f = this.f, arena = battle.arena, mult = HEARING[this.level];
    let best = null;
    f.eye(this._eye);
    for (const n of battle.noises || []) {
      if (t - n.t > 0.4 || n.team === f.team) continue;
      const d = Math.hypot(n.x - f.x, n.z - f.z, (n.y - f.y) * 1.5);
      let range = n.range * mult;
      if (d > range) continue;
      if (!arena.sightLine(this._eye, [n.x, n.y + 1.2, n.z])) range *= 0.6;     // through walls
      if (d > range) continue;
      const loud = 1 - d / range;
      if (!best || loud > best.loud) {
        const err = d * (this.level === 'terminator' ? 0.03 : 0.1);
        best = { x: n.x + this._gauss() * err, y: n.y, z: n.z + this._gauss() * err, t, kind: n.kind, loud, d };
      }
    }
    return best;
  }

  // Aim like a hand on a mouse. A target far from the crosshair gets a flick: a quick
  // movement that starts fast and eases in (minimum-jerk), takes longer for bigger turns
  // (Fitts' law), and lands a little short or long and to the side; then smaller corrective
  // flicks. Close to the target the aim tracks it with a lag. A slight shake on top.
  // Before reacting to a new target the bot does not move its aim towards it.
  _aim(t, dt, tgt, wantYaw, wantPitch) {
    const f = this.f, L = this.L;
    const dY = wrap180(wantYaw - this.ay), dP = wantPitch - this.ap, dist = Math.hypot(dY, dP);
    const reacted = !tgt || t - this.seenAt >= L.reaction * 0.85;
    if (this.mv) {
      const M = this.mv;
      M.t += dt;
      const u = Math.min(1, M.t / M.T), s = u * u * u * (10 - 15 * u + 6 * u * u);
      this.ay = M.y0 + M.dy * s; this.ap = M.p0 + M.dp * s;
      if (u >= 1) { this.mv = null; this.settleUntil = t + this._r(0.04, 0.12) * L.motor; }
    } else if (tgt && reacted && dist > L.flick && t >= this.settleUntil) {
      const gain = 0.95 + this._gauss() * 0.07, side = this._gauss() * 0.035;
      const T = (0.07 + 0.055 * Math.log2(1 + dist / 1.2)) * L.motor;
      this.mv = { t: 0, T, y0: this.ay, p0: this.ap, dy: dY * gain - dP * side, dp: dP * gain + dY * side };
    } else if (reacted) {
      // tracking (or, with no one to fight, turning where it walks / looks)
      const k = 1 - Math.exp(-(tgt ? L.pursuit : 5) * dt), cap = (tgt ? 900 : L.turn) * dt;
      this.ay += Math.max(-cap, Math.min(cap, dY * k));
      this.ap += Math.max(-cap, Math.min(cap, dP * k));
    }
    this.ay = ((this.ay % 360) + 360) % 360;
    this.ap = Math.max(-80, Math.min(80, this.ap));
    this.tr += dt;
    const sh = L.tremor, p = this.ph, tr = this.tr;
    f.yaw = ((this.ay + sh * (Math.sin(tr * 7.1 + p[0]) + 0.5 * Math.sin(tr * 13.3 + p[1]))) % 360 + 360) % 360;
    f.pitch = this.ap + sh * 0.8 * (Math.sin(tr * 6.3 + p[2]) + 0.5 * Math.sin(tr * 11.7 + p[3]));
  }

  _setGoal(x, z, arena, t, y = 0) {
    this.goal = { x, z, y };
    this.path = arena.findPath(this.f.x, this.f.z, x, z, this.f.y, y);
    this.nextPath = t + (this.path.length ? this._r(1.8, 3.2) : this._r(0.5, 0.9));   // unreachable: try another goal soon
  }

  // A cover spot near me that the threat cannot see (crouched height if it is low cover).
  _coverFrom(threat, arena) {
    const f = this.f, eye = threat.eye([0, 0, 0]);
    let best = null, bd = Infinity;
    for (const s of arena.coverSpots) {
      const d = Math.hypot(s.x - f.x, s.z - f.z);
      if (d > 9 || d >= bd) continue;
      const h = s.low ? 0.95 : 1.5;
      if (arena.sightLine(eye, [s.x, s.y + h, s.z])) continue;
      best = s; bd = d;
    }
    return best;
  }
}
