// Bot brains for the match modes: utility choices at 15 Hz, actions every step.
//
// Perception: 110 degree view cone, 45 m, line-of-sight raycasts (a per-step budget shared by
// all bots), hearing (noises within their range), and the team blackboard. No wallhacks.
// States: route (going somewhere), engage, cover, reload, objective (from the mode's rules),
// ability (abilities.js decides). Aim: reaction time, then an error that shrinks while on
// target and grows with sustained fire (bloom); bursts limited by the gun's rpm and magazine.
// Navigation: A* on the map's waypoint graph, string-pulled, with a stuck watchdog (no
// progress for 3 s: re-path; still stuck: walk to the nearest waypoint).
import { SKILL, EYE, NOISE } from './sim.js?v=646d2f7-mw61ssr2';
import { dirFrom, yawTo, wrap180, DEG } from './geom.js?v=646d2f7-mw61ssr2';

const VIEW = 55, RANGE = 45;

export class Brain {
  constructor(m, a, diff) {
    this.m = m; this.a = a; this.S = SKILL[diff] || SKILL.normal;
    this.spawned();
  }
  spawned() {
    const a = this.a;
    this.target = null; this.seenAt = -1; this.visAt = -10; this.vis = new Map();
    this.path = []; this.goal = null; this.goalKey = ''; this.nextPath = 0; this.state = 'route';
    this.aimYaw = a.yaw; this.aimPitch = 0; this.errY = 0; this.errP = 0; this.nextErr = 0; this.bloom = 0; this.onTarget = 0;
    this.burst = 0; this.pauseUntil = 0; this.strafe = 0; this.nextStrafe = 0; this.head = false;
    this.attacker = null; this.attackedAt = -10; this.heard = null;
    this.progT = this.m.t; this.progD = Infinity; this.stuckStage = 0;
    this.holding = false; this.wantCrouch = false; this.patrol = null; this.role = null;
  }
  hurtBy(e) { this.attacker = e; this.attackedAt = this.m.t; this.m.report(this.a.team, e); }
  wantsMove() { return this.path.length > 0 && !this.holding && this.m.t >= this.a.stunUntil && !this.a.hold && !(this.m.rules.frozen(this.a)); }

  /* ---------- think (15 Hz) ---------- */
  think() {
    const m = this.m, a = this.a, t = m.t, eye = m.eye(a, this._eye || (this._eye = [0, 0, 0]));
    // see
    let best = null, bd = Infinity;
    for (const e of m.actors) {
      if (!e.alive || e.team === a.team) continue;
      const dx = e.x - a.x, dz = e.z - a.z, d = Math.hypot(dx, dz);
      if (d > RANGE) { this.vis.delete(e.id); continue; }
      const inCone = Math.abs(wrap180(yawTo(dx, dz) - a.yaw)) <= VIEW || (this.attacker === e && t - this.attackedAt < 1) || t < e.revealedUntil;
      if (!inCone) { this.vis.delete(e.id); continue; }
      let v = this.vis.get(e.id);
      if (m.losBudget > 0 || v === undefined) {
        m.losBudget--;
        const s = 1 - 0.3 * e.crouch;
        v = m.map.sight(eye, [e.x, e.y + 1.5 * s, e.z]) || m.map.sight(eye, [e.x, e.y + 1.1 * s, e.z]);
        if (t < e.revealedUntil && !v) v = false;
        this.vis.set(e.id, v);
      }
      if (v) { m.report(a.team, e); if (d < bd) { bd = d; best = e; } }
    }
    if (best !== this.target) { this.target = best; this.seenAt = best ? t : -1; this.burst = 0; this.onTarget = 0; }
    if (best) this.visAt = t;
    // hear
    for (const n of m.noises) {
      if (n.team === a.team || t - n.t > 0.3) continue;
      const d = Math.hypot(n.x - a.x, n.z - a.z);
      if (d > n.range) continue;
      const fx = n.x + m.gauss() * d * 0.08, fz = n.z + m.gauss() * d * 0.08;
      this.heard = { x: fx, z: fz, t };
      const e = m.actors.find((q) => q.id === n.id);
      if (e) m.report(a.team, e, fx, fz);
    }
    // decide
    const S = this.S;
    if (a.ammo === 0 && !a.reloadUntil) a.reloadUntil = t + a.gun.reload;
    if (!best && a.ammo < a.gun.magSize * 0.4 && !a.reloadUntil && t - this.visAt > 2) a.reloadUntil = t + a.gun.reload;
    m.ab.botThink(this);
    // committed to reaching cover: do not flip-flop
    if ((this.state === 'cover' || this.state === 'reload') && t < this.commitUntil && this.path.length) return;
    const obj = m.rules.botGoal(this);
    // Objective runs (stealing, carrying, recovering a flag; planting...) keep moving and shoot
    // on the way.
    if (best && obj && obj.push) {
      this.push = true;
      this.state = 'objective';
      this.setGoal(obj.x, obj.z, obj.key || 'obj');
      this.holding = false; this.face = null; this.wantCrouch = false;
      return;
    }
    if (best && !(obj && obj.ignoreEnemies)) {
      if (a.hp < 35 && S !== SKILL.terminator && !this.holding && (!obj || !obj.must)) {
        const c = this.coverFrom(best);
        if (c) { this.state = 'cover'; this.setGoal(c[0], c[1], 'cover'); this.wantCrouch = true; this.commitUntil = t + 3; return; }
      }
      this.state = 'engage';
      // close the distance if far, otherwise strafe (handled in act)
      if (bd > 22) this.setGoal(best.x, best.z, 'chase'); else { this.path = []; this.goal = null; this.goalKey = ''; }
      this.wantCrouch = false;
      return;
    }
    if (a.reloadUntil && t - this.visAt < 4) {
      const last = [...m.bb[a.team].seen.values()].sort((p, q) => q.t - p.t)[0];
      if (last) { const c = this.coverFrom(last); if (c) { this.state = 'reload'; this.setGoal(c[0], c[1], 'cover'); this.wantCrouch = true; this.commitUntil = t + 3; return; } }
    }
    this.push = !!(obj && obj.push);
    if (obj) {
      this.state = 'objective';
      this.setGoal(obj.x, obj.z, obj.key || 'obj');
      this.holding = !!obj.hold && Math.hypot(obj.x - a.x, obj.z - a.z) < (obj.r || 1.2);
      this.face = obj.face || null;
      this.wantCrouch = !!obj.crouch && this.holding;
      if (this.holding) { this.path = []; }
      return;
    }
    this.holding = false; this.face = null; this.wantCrouch = false;
    this.state = 'route';
    // hunt: the freshest sighting or sound, recent deaths, else patrol
    let g = null;
    for (const s of m.bb[a.team].seen.values()) if (t - s.t < 12 && (!g || s.t > g.t)) g = s;
    if (g) { this.setGoal(g.x, g.z, 'hunt' + Math.round(g.x) + ',' + Math.round(g.z)); return; }
    const dth = m.bb[a.team].deaths.filter((d) => t - d.t < 20).pop();
    if (dth) { this.setGoal(dth.x, dth.z, 'death' + Math.round(dth.x)); return; }
    if (!this.patrol || Math.hypot(this.patrol[0] - a.x, this.patrol[1] - a.z) < 3 || t > this.patrolUntil) {
      const N = m.map.nodes;
      for (let k = 0; k < 10; k++) { const n = N[Math.floor(m.rng() * N.length)]; if (Math.hypot(n[0] - a.x, n[1] - a.z) > 15) { this.patrol = n; break; } }
      this.patrolUntil = t + 25;
    }
    if (this.patrol) this.setGoal(this.patrol[0], this.patrol[1], 'patrol' + this.patrol[0] + ',' + this.patrol[1]);
  }
  // A cover spot near me out of the threat's sight.
  coverFrom(e) {
    const m = this.m, a = this.a;
    let best = null, bd = 12;
    const av = this.avoid && m.t < this.avoid.until ? this.avoid : null;
    for (const c of m.map.data.cover) {
      const d = Math.hypot(c[0] - a.x, c[1] - a.z);
      if (d >= bd || (av && Math.hypot(c[0] - av.x, c[1] - av.z) < 1.5)) continue;
      if (m.actors.some((q) => q !== a && q.alive && q.team === a.team && Math.hypot(q.x - c[0], q.z - c[1]) < 1.2)) continue;   // a teammate is there
      if (m.map.sight([e.x, 1.6, e.z], [c[0], 1.0, c[1]])) continue;
      best = c; bd = d;
    }
    return best;
  }
  setGoal(x, z, key) {
    const m = this.m, a = this.a;
    const changed = key !== this.goalKey || !this.goal || Math.hypot(x - this.goal[0], z - this.goal[1]) > 2;
    if (!changed && m.t < this.nextPath && this.path.length) return;
    this.goal = [x, z]; this.goalKey = key;
    this.path = Math.hypot(x - a.x, z - a.z) < 1.5 ? [] : m.map.path(a.x, a.z, x, z);   // already there
    this.nextPath = m.t + 3 + m.rng();
    this.progT = m.t; this.progD = Infinity;
  }

  /* ---------- act (every step) ---------- */
  act(dt) {
    const m = this.m, a = this.a, t = m.t, S = this.S;
    let wx = 0, wz = 0;
    const frozen = m.rules.frozen(a) || t < a.stunUntil || a.hold || this.a.ab.busy;
    const tgt = this.target && this.target.alive ? this.target : null;
    const sees = tgt && t - this.visAt < 0.3;
    // movement
    if (!frozen) {
      let speed = 3.4;
      if (this.state === 'engage' && sees && this.path.length === 0) {
        if (t >= this.nextStrafe) { this.nextStrafe = t + m.r(0.4, 1.1); this.strafe = m.rng() < S.strafe ? (m.rng() < 0.5 ? -1 : 1) : 0; }
        const y = a.yaw * DEG;
        wx = Math.cos(y) * this.strafe; wz = Math.sin(y) * this.strafe; speed = 2.6;
      } else if (this.path.length && !this.holding) {
        const wp = this.path[0], dx = wp[0] - a.x, dz = wp[1] - a.z, d = Math.hypot(dx, dz);
        if (d < (this.path.length === 1 ? 1.0 : 0.5)) { this.path.shift(); this.progD = Infinity; }
        else {
          wx = dx / d; wz = dz / d;
          speed = (this.state === 'route' && !tgt) || this.push ? 5.2 : this.state === 'cover' || this.state === 'reload' ? 4.6 : 4.2;
          // stuck watchdog
          if (d < this.progD - 0.3) { this.progD = d; this.progT = t; }
          else if (this.path.length === 1 && d < 2 && t - this.progT > 1) { this.path.length = 0; this.progD = Infinity; }   // close enough (someone is standing there)
          else if (t - this.progT > 3) {
            this.progT = t; this.progD = Infinity;
            if (this.stuckStage === 0) { this.stuckStage = 1; this.nextPath = 0; const g = this.goal; if (g) { this.path = m.map.path(a.x, a.z, g[0], g[1]); } }
            else {
              // still stuck: give this goal up for a while and step onto the nearest waypoint
              this.stuckStage = 0;
              if (this.goal) this.avoid = { x: this.goal[0], z: this.goal[1], until: t + 15 };
              const k = m.map.nearestNode(a.x, a.z, false);
              this.path = k >= 0 ? [m.map.nodes[k].slice()] : [];
              this.goal = null; this.goalKey = ''; this.patrol = null;
            }
          }
        }
      }
      if (this.wantCrouch) speed = Math.min(speed, 1.6);
      speed *= m.speedOf(a);
      wx *= speed; wz *= speed;
    }
    m.moveActor(a, wx, wz, dt);
    a.crouch += ((this.wantCrouch && !(sees && this.state === 'engage') ? 1 : 0) - a.crouch) * Math.min(1, dt * 10);
    // aim
    let wantY = this.aimYaw, wantP = 0;
    if (tgt && sees) {
      if (this.burst === 0 && t >= this.pauseUntil) this.head = m.rng() < S.head;
      const s = 1 - 0.3 * tgt.crouch, eye = m.eye(a);
      const ty = tgt.y + (this.head ? 1.62 : 1.2) * s, dx = tgt.x - eye[0], dz = tgt.z - eye[2];
      wantY = yawTo(dx, dz); wantP = Math.atan2(ty - eye[1], Math.hypot(dx, dz)) / DEG;
      this.onTarget += dt;
    } else {
      this.onTarget = 0;
      if (this.face) wantY = yawTo(this.face[0] - a.x, this.face[1] - a.z);
      else if (Math.hypot(a.vx, a.vz) > 0.5) wantY = yawTo(a.vx, a.vz);
      else if (this.heard && t - this.heard.t < 3) wantY = yawTo(this.heard.x - a.x, this.heard.z - a.z);
    }
    if (t >= this.nextErr) {
      this.nextErr = t + 0.25;
      const base = S.err * (0.35 + 0.65 * Math.exp(-this.onTarget / 1.0)) + this.bloom;
      this.errY = m.gauss() * base; this.errP = m.gauss() * base * 0.6;
    }
    this.bloom = Math.max(0, this.bloom - dt * 4);
    const turn = S.turn * dt;
    const dy = wrap180(wantY - this.aimYaw), dp = wantP - this.aimPitch;
    this.aimYaw += Math.max(-turn, Math.min(turn, dy * Math.min(1, dt * 14)));
    this.aimPitch += Math.max(-turn, Math.min(turn, dp * Math.min(1, dt * 14)));
    a.yaw = ((this.aimYaw % 360) + 360) % 360;
    a.pitch = Math.max(-80, Math.min(80, this.aimPitch));
    // fire
    if (frozen || !sees || a.reloadUntil || a.ammo <= 0) return;
    if (t - this.seenAt < S.reaction || t < this.pauseUntil || t < a.nextShot) return;
    if (Math.abs(wrap180(wantY - a.yaw)) > 4 + S.err || Math.abs(wantP - a.pitch) > 4 + S.err) return;
    if (this.burst === 0) this.burst = Math.round(m.r(S.burst[0], S.burst[1]));
    const d = dirFrom(a.yaw + this.errY, a.pitch + this.errP, this._d || (this._d = [0, 0, 0]));
    if (t < a.protectUntil) a.protectUntil = t;
    m.noise(a, NOISE.shot, 'shot');
    m.shoot(a, m.eye(a), d);
    a.ammo--; a.nextShot = t + 60 / a.gun.rpm;
    this.bloom = Math.min(3.5, this.bloom + 0.22);
    if (--this.burst <= 0) { this.burst = 0; this.pauseUntil = t + S.pause * m.r(0.7, 1.3); }
    if (a.ammo <= 0) a.reloadUntil = t + a.gun.reload;
  }
}
export { EYE };
