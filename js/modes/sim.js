// Match simulation for Team Deathmatch, Capture the Flag and Bomb (no three.js, no DOM:
// the same code runs in the browser and in tools/check-modes.mjs).
//
// Fixed 60 Hz steps. Actors are bodies with health, a gun and an operator. Bots think at
// 15 Hz (staggered) and act every step; the human is moved by the browser (the range's look,
// recoil, sights and movement) and reports its shots. Teams are 'A' and 'B'.
//
// Body for hits (actor frame, standing; crouching squashes y to 0.7): head sphere at 1.62 m
// (r 0.13), torso capsule 0.95-1.34 m (r 0.24), legs capsule 0.1-0.9 m (r 0.19).
import { mulberry32 } from '../core/prng.js?v=9ba226e-mwa4h4pc';
import { rayCapsule, raySphere, dirFrom, yawTo, wrap180, DEG } from './geom.js?v=9ba226e-mwa4h4pc';
import { BODY_R } from './map.js?v=9ba226e-mwa4h4pc';
import { Brain } from './bots.js?v=9ba226e-mwa4h4pc';
import { makeRules } from './rules.js?v=9ba226e-mwa4h4pc';
import { Nades } from './nades.js?v=9ba226e-mwa4h4pc';
import { Abilities } from './abilities.js?v=9ba226e-mwa4h4pc';

export const TICK = 1 / 60;
export const EYE = 1.6, CROUCH_EYE = 1.1;
const MODEL_DAMAGE = { smg: 28, rifle: 36, carbine: 34, lmg: 38, marksman: 48 };
const MODEL_SPEED = { smg: 1.05, rifle: 0.95, carbine: 0.97, lmg: 0.88, marksman: 0.92 };
export const ZONE_MULT = { head: 2, torso: 1, limbs: 0.8 };
export const NOISE = { shot: 35, run: 12, walk: 4, crouch: 0, knife: 10, door: 25 };
export const KNIFE = { range: 1.7, cone: 50, damage: 60, back: 200, door: 100, every: 0.75 };

// Bot skill by difficulty.
export const SKILL = {
  easy: { name: 'Easy', reaction: 0.45, err: 3.2, turn: 200, burst: [3, 5], pause: 0.55, head: 0.1, strafe: 0.2 },
  normal: { name: 'Normal', reaction: 0.3, err: 2.0, turn: 320, burst: [4, 8], pause: 0.35, head: 0.2, strafe: 0.5 },
  hard: { name: 'Hard', reaction: 0.18, err: 1.1, turn: 480, burst: [6, 12], pause: 0.22, head: 0.35, strafe: 0.9 },
  terminator: { name: 'Terminator', reaction: 0.12, err: 0.55, turn: 720, burst: [10, 18], pause: 0.12, head: 0.6, strafe: 1 },
};

export function gunStats(g) {
  return {
    id: g.id, name: g.name, model: g.model, rpm: g.rpm, magSize: g.magSize, reload: g.reloadSeconds || 2.8,
    damage: g.damage || MODEL_DAMAGE[g.model] || 32, speed: g.moveSpeedMult || MODEL_SPEED[g.model] || 1, tone: g.tone ?? 0.5,
  };
}

export class Match {
  static gunStatsOf(g) { return gunStats(g); }
  // o: { map (MatchMap), mode, guns (guns.json list), ops (ops.json), abilities (abilities.json),
  //      teamSize, difficulty, abilitiesOn, minutes, headshot ('lethal'|'x2'), seed,
  //      human: { op, side } | null (null: all bots, for the check) }
  constructor(o) {
    this.o = { teamSize: 5, difficulty: 'normal', minutes: 10, headshot: 'lethal', seed: 1, ...o };
    this.map = o.map;
    this.rng = mulberry32(this.o.seed >>> 0);
    this.t = 0; this.tick = 0;
    this.events = []; this.noises = [];
    this.over = false; this.winner = null; this.endReason = '';
    this.actors = [];
    this.bb = { A: { seen: new Map(), deaths: [] }, B: { seen: new Map(), deaths: [] } };
    this.gunsById = new Map(o.guns.map((g) => [g.id, g]));
    this.losBudget = 0;
    this.ab = new Abilities(this, o.abilities || {});
    this.nades = new Nades(this);
    this.rules = makeRules(this);
    this._makeTeams();
    this.rules.start();
  }
  r(a = 0, b = 1) { return a + (b - a) * this.rng(); }
  gauss() { let u = 0, v = 0; while (u === 0) u = this.rng(); while (v === 0) v = this.rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  emit(e) { e.t = this.t; this.events.push(e); if (this.events.length > 400) this.events.splice(0, 100); }

  /* ---------- teams and operators ---------- */
  opsFor(side) {
    const O = this.o.ops;
    return side === 'attack' ? O.attackers : side === 'defend' ? O.defenders : [...O.attackers, ...O.defenders];
  }
  _makeTeams() {
    const n = this.o.teamSize, h = this.o.human;
    const pool = (team) => this.opsFor(this.rules.sideOf ? this.rules.sideOf(team) : null);
    for (const team of ['A', 'B']) {
      const used = new Set();
      const pick = () => {
        const p = pool(team).filter((op) => !used.has(op.id));
        const op = p[Math.floor(this.rng() * p.length)];
        used.add(op.id);
        return op;
      };
      for (let i = 0; i < n; i++) {
        let op;
        const isHuman = h && team === this.humanTeam() && i === 0;
        if (isHuman) { op = pool(team).find((x) => x.id === h.op) || pool(team)[0]; used.add(op.id); }
        else op = pick();
        this.addActor(team, op, isHuman);
      }
    }
  }
  humanTeam() { return this.o.human && this.rules.humanTeam ? this.rules.humanTeam() : 'A'; }
  addActor(team, op, human) {
    const g = this.gunsById.get(op.gun) || this.o.guns[0];
    const a = {
      id: this.actors.length + 1, team, op, human, name: human ? 'You' : op.name, gun: gunStats(g), gunData: g,
      x: 0, z: 0, y: 0, vx: 0, vz: 0, yaw: 0, pitch: 0, crouch: 0, speed: 0, ads: 0,
      hp: 100, alive: false, respawnAt: 0, protectUntil: 0, lastHurt: -10, kills: 0, deaths: 0, assists: 0,
      ammo: g.magSize, reloadUntil: 0, nextShot: 0, stunUntil: 0, slowUntil: 0, shakeUntil: 0, wobbleUntil: 0, revealedUntil: 0,
      carry: null, hold: null, stuckFor: 0, _sx: 0, _sz: 0, _st: 0,
    };
    a.brain = human ? null : new Brain(this, a, this.o.difficulty);
    this.ab.init(a);
    this.actors.push(a);
    return a;
  }
  enemiesOf(a) { return this.actors.filter((b) => b.team !== a.team); }
  teammates(a) { return this.actors.filter((b) => b.team === a.team && b !== a); }
  human() { return this.actors.find((a) => a.human) || null; }

  /* ---------- spawning ---------- */
  // A random safe spawn (no enemy within 12 m or in sight), from the map's spawns and the
  // waypoints within `spread` m of them; if none is safe, the best scored one.
  spawn(a, list, protect = 3, spread = 8) {
    const foes = this.enemiesOf(a).filter((e) => e.alive);
    if (!this._pools) this._pools = new Map();
    const pk = list.map((s) => s[0] + ',' + s[1]).join(';') + '|' + spread;
    let pool = this._pools.get(pk);
    if (!pool) {
      pool = list.slice();
      for (const n of this.map.data.nodes || []) {
        const near = list.find((s) => Math.hypot(n[0] - s[0], n[1] - s[1]) <= spread);
        if (near && this.map.free(n[0], n[1], 0.5)) pool.push([n[0], n[1], near[2]]);
      }
      this._pools.set(pk, pool);
    }
    const eyeAt = [0, 0, 0];
    const ok = (s) => {
      if (this.actors.some((b) => b !== a && b.alive && Math.hypot(b.x - s[0], b.z - s[1]) < 1.8)) return false;
      for (const e of foes) {
        const d = Math.hypot(e.x - s[0], e.z - s[1]);
        if (d < 12) return false;
        if (d < 45 && this.map.sight(this.eye(e, eyeAt), [s[0], 1.2, s[1]])) return false;
      }
      return true;
    };
    let best = null;
    for (let i = 0; i < 30 && !best; i++) { const s = pool[Math.floor(this.rng() * pool.length)]; if (ok(s)) best = s; }
    if (best) return this._place(a, best, protect);
    best = list[0];
    let bs = -Infinity;
    for (const s of pool) {
      let d = 99;
      for (const e of foes) d = Math.min(d, Math.hypot(e.x - s[0], e.z - s[1]));
      let seen = false;
      for (const e of foes) if (Math.hypot(e.x - s[0], e.z - s[1]) < 45 && this.map.sight([e.x, e.y + EYE, e.z], [s[0], 1.2, s[1]])) { seen = true; break; }
      const busy = this.actors.some((b) => b !== a && b.alive && Math.hypot(b.x - s[0], b.z - s[1]) < 0.8);
      const score = d - (seen ? 60 : 0) - (busy ? 30 : 0) + this.rng();
      if (score > bs) { bs = score; best = s; }
    }
    return this._place(a, best, protect);
  }
  _place(a, best, protect) {
    // a little off the spot (so two never land on each other), without crossing a wall
    const p = this.map.moveCircle({ x: best[0], z: best[1] }, this.r(-0.6, 0.6), this.r(-0.6, 0.6));
    Object.assign(a, { x: p.x, z: p.z, y: 0, vx: 0, vz: 0, yaw: best[2] || 0, pitch: 0, crouch: 0, hp: 100, alive: true, protectUntil: this.t + protect, lastHurt: -10,
      ammo: a.gun.magSize, reloadUntil: 0, nextShot: 0, stunUntil: 0, slowUntil: 0, shakeUntil: 0, wobbleUntil: 0, carry: null, hold: null, stuckFor: 0, _sx: p.x, _sz: p.z, _st: this.t });
    this.nades.refill(a);
    if (a.brain) a.brain.spawned();
    this.emit({ type: 'spawn', id: a.id });
  }

  /* ---------- damage ---------- */
  hit(v, dmg, by, zone = 'torso', kind = 'gun') {
    if (!v.alive || this.over) return 0;
    if (by && by !== v && by.team === v.team) return 0;           // no friendly fire
    if (this.t < v.protectUntil) return 0;
    if (zone === 'head' && kind === 'gun') dmg = this.o.headshot === 'x2' ? dmg * 2 : 999;
    else dmg *= kind === 'gun' ? ZONE_MULT[zone] || 1 : 1;
    const applied = Math.min(dmg, v.hp);
    v.hp -= dmg; v.lastHurt = this.t;
    if (v.hold) { v.hold = null; this.emit({ type: 'holdCancel', id: v.id }); }   // taking damage cancels plant / defuse
    if (v.brain && by) v.brain.hurtBy(by);
    this.emit({ type: 'hit', id: v.id, by: by ? by.id : 0, zone, dmg: applied, kind });
    if (v.hp <= 0) this.kill(v, by, zone === 'head' && kind === 'gun', kind);
    return applied;
  }
  kill(v, by, head = false, kind = 'gun') {
    v.hp = 0; v.alive = false; v.deaths++; v.hold = null;
    if (by && by !== v && by.team !== v.team) by.kills++;
    this.bb[v.team].deaths.push({ x: v.x, z: v.z, t: this.t });
    if (this.bb[v.team].deaths.length > 8) this.bb[v.team].deaths.shift();
    this.emit({ type: 'kill', id: v.id, by: by ? by.id : 0, head, kind });
    this.ab.onDeath(v);
    this.rules.onKill(v, by);
  }

  /* ---------- shooting ---------- */
  // A bullet from actor a: eye origin o, unit direction d. Returns { t, actor, zone, panel }.
  shoot(a, o, d, damage = a.gun.damage, kind = 'gun') {
    let best = 200, hit = null;
    const w = this.map.raycast(o, d, 200);
    if (w) best = w.t;
    for (const e of this.actors) {
      if (!e.alive || e === a || e.team === a.team) continue;
      const r = this.rayActor(o, d, e, best);
      if (r && r.t < best) { best = r.t; hit = r; }
    }
    // gadgets die to one hit
    const g = this.ab.rayGadgets(o, d, best, a);
    if (g) { best = g.t; hit = null; this.ab.destroy(g.g, a); }
    const end = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
    this.emit({ type: 'shot', id: a.id, from: o.slice(), to: end, team: a.team, kind, wall: !hit && !g && w && w.box && !w.box.ground ? 1 : 0 });
    if (hit && damage > 0) this.hit(hit.actor, damage, a, hit.zone, kind);
    // bullets splinter doors: a few shots break one
    if (!hit && !g && w && w.box && w.box.kind === 'door' && damage > 0) this.doorHit(this.map.panels[w.box.panel], 22, a);
    return { t: best, actor: hit ? hit.actor : null, zone: hit ? hit.zone : null, box: !hit && w ? w.box : null, end };
  }
  rayActor(o, d, e, maxT = Infinity) {
    const ox = o[0] - e.x, oz = o[2] - e.z, dd = d[0] * d[0] + d[2] * d[2];
    if (dd > 1e-12) { const tc = -(ox * d[0] + oz * d[2]) / dd; if ((ox + d[0] * tc) ** 2 + (oz + d[2] * tc) ** 2 > 0.6) return null; }
    const s = 1 - 0.3 * e.crouch, x = e.x, z = e.z, y = e.y;
    let t = raySphere(o, d, [x, y + 1.62 * s, z], 0.13), zone = 'head';
    const tt = rayCapsule(o, d, [x, y + 0.95 * s, z], [x, y + 1.34 * s, z], 0.24);
    if (tt < t) { t = tt; zone = 'torso'; }
    const tl = rayCapsule(o, d, [x, y + 0.1, z], [x, y + 0.9 * s, z], 0.19);
    if (tl < t) { t = tl; zone = 'limbs'; }
    return t < maxT ? { t, zone, actor: e } : null;
  }
  doorHit(pn, dmg, a) {
    if (this.map.hurtDoor(pn, dmg)) {
      const b = pn.box, x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
      this.noises.push({ x, z, t: this.t, range: NOISE.door, kind: 'door', team: a ? a.team : '', id: a ? a.id : 0 });
      this.emit({ type: 'door', x, z, by: a ? a.id : 0 });
    }
  }
  // K: the knife. Hits the closest enemy in front within reach (lethal from behind), else a
  // door in front. Returns what it hit: 'actor', 'door', or '' (a miss).
  knife(a) {
    if (!a.alive || this.over || this.t < (a.knifeAt || 0) || this.rules.frozen(a) || (a.ab && a.ab.busy)) return null;
    const peace = this.rules.noFire(a);          // prep: doors only
    a.knifeAt = this.t + KNIFE.every;
    if (this.t < a.protectUntil) a.protectUntil = this.t;
    this.noise(a, NOISE.knife, 'knife');
    this.emit({ type: 'knife', id: a.id });
    let best = null, bd = KNIFE.range;
    for (const e of this.actors) {
      if (peace || !e.alive || e === a || e.team === a.team) continue;
      const d = Math.hypot(e.x - a.x, e.z - a.z);
      if (d >= bd || Math.abs(wrap180(yawTo(e.x - a.x, e.z - a.z) - a.yaw)) > KNIFE.cone) continue;
      if (!this.map.sight(this.eye(a), [e.x, 1.1, e.z])) continue;
      best = e; bd = d;
    }
    if (best) {
      const behind = Math.abs(wrap180(best.yaw - a.yaw)) < 70;
      this.hit(best, behind ? KNIFE.back : KNIFE.damage, a, 'torso', 'knife');
      return 'actor';
    }
    const o = this.eye(a), d = dirFrom(a.yaw, Math.max(-35, Math.min(20, a.pitch)));
    const w = this.map.raycast(o, d, KNIFE.range + 0.2);
    if (w && w.box && w.box.kind === 'door') { this.doorHit(this.map.panels[w.box.panel], KNIFE.door, a); return 'door'; }
    const g = this.ab.rayGadgets(o, d, KNIFE.range, a);
    if (g) { this.ab.destroy(g.g, a); return 'gadget'; }
    return '';
  }
  // The human's shot (direction from the range's recoil and spread).
  humanShot(a, o, d) {
    if (!a.alive || this.over || this.rules.frozen(a) || this.rules.noFire(a)) return null;
    if (this.t < a.protectUntil) a.protectUntil = this.t;          // firing ends spawn protection
    this.noise(a, NOISE.shot, 'shot');
    return this.shoot(a, o, d);
  }
  noise(a, range, kind) {
    if (range <= 0) return;
    this.noises.push({ x: a.x, z: a.z, t: this.t, range, kind, team: a.team, id: a.id });
    while (this.noises.length && this.noises[0].t < this.t - 0.5) this.noises.shift();
  }
  eye(a, out = [0, 0, 0]) { out[0] = a.x; out[1] = a.y + (EYE + (CROUCH_EYE - EYE) * a.crouch); out[2] = a.z; return out; }

  /* ---------- the step ---------- */
  step() {
    if (this.over) return;
    const dt = TICK;
    this.t += dt; this.tick++;
    this.losBudget = 18;
    this.rules.update(dt);
    // bots: think at 15 Hz (staggered), act every step
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (!a.alive || !a.brain) continue;
      if ((this.tick + i) % 4 === 0) a.brain.think();
      a.brain.act(dt);
    }
    this.ab.update(dt);
    this.nades.update(dt);
    this._separate();
    for (const a of this.actors) {
      if (!a.alive) continue;
      // reload timer, footsteps
      if (a.reloadUntil && this.t >= a.reloadUntil) { a.reloadUntil = 0; a.ammo = a.gun.magSize; }
      if (this.tick % 15 === 0) {
        const sp = a.speed;
        this.noise(a, a.crouch > 0.5 ? NOISE.crouch : sp > 4 ? NOISE.run : sp > 1.2 ? NOISE.walk : 0, 'steps');
      }
      // stuck watchdog metric: wants to move but has not moved 0.3 m in a second
      if (this.t - a._st >= 1) {
        const moved = Math.hypot(a.x - a._sx, a.z - a._sz);
        a.stuckFor = a.brain && a.brain.wantsMove() && moved < 0.3 ? a.stuckFor + (this.t - a._st) : 0;
        a._sx = a.x; a._sz = a.z; a._st = this.t;
        // wedged into a gap too thin for a body (pushed there): back onto the nearest waypoint
        if (a.stuckFor >= 2 && !a.human && !this.map.free(a.x, a.z, BODY_R * 0.9)) {
          const k = this.map.nearestNode(a.x, a.z, false), n = k >= 0 && this.map.nodes[k];
          if (n && Math.hypot(n[0] - a.x, n[1] - a.z) < 3) { a.x = n[0]; a.z = n[1]; a.stuckFor = 0; if (a.brain) a.brain.path = []; }
        }
      }
      if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) { this.nan = true; a.x = 0; a.z = 0; }
    }
    this.rules.check();
  }
  // Move a bot's body: wish velocity (vx, vz) in m/s, with collision.
  moveActor(a, wx, wz, dt) {
    const k = 1 - Math.exp(-12 * dt);
    a.vx += (wx - a.vx) * k; a.vz += (wz - a.vz) * k;
    const p = this.map.moveCircle({ x: a.x, z: a.z }, a.vx * dt, a.vz * dt);
    a.speed = Math.hypot(p.x - a.x, p.z - a.z) / dt;
    a.x = p.x; a.z = p.z;
  }
  speedOf(a) {
    let s = a.gun.speed;
    if (this.t < a.slowUntil) s *= 1 - (this.ab.cfg.jolt_mines ? this.ab.cfg.jolt_mines.slow : 0.4);
    if (a.carry && a.carry.type === 'flag') s *= 0.9;
    if (this.t < a.stunUntil) s = 0;
    return s;
  }
  // Bodies do not overlap (the human is moved by the browser: only bots give way).
  _separate() {
    const L = this.actors;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      if (!a.alive || !b.alive) continue;
      let dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz), min = BODY_R * 2;
      if (d >= min) continue;
      if (d < 1e-5) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
      const wa = a.human ? 0 : 1, wb = b.human ? 0 : 1;
      if (!wa && !wb) continue;
      const push = (min - d) / (wa + wb);
      if (wa) { a.x -= dx * push; a.z -= dz * push; this.map.resolve(a); }
      if (wb) { b.x += dx * push; b.z += dz * push; this.map.resolve(b); }
    }
  }
  end(winner, reason) {
    if (this.over) return;
    this.over = true; this.winner = winner; this.endReason = reason;
    this.emit({ type: 'end', winner, reason });
  }
  // Team blackboard: an enemy seen or heard.
  // by: the one who saw it; inside an enemy jammer the radio is down (nobody else hears it)
  report(team, e, x = e.x, z = e.z, by = null) { if (by && this.ab.jammed(by.x, by.z, by.team)) return; this.bb[team].seen.set(e.id, { x, z, t: this.t, id: e.id }); }
}
export { dirFrom, yawTo, wrap180, DEG };
