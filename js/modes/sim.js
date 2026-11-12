import { utilityFor, abilitiesFor } from '../balance/bomb-utility.js?v=47bc4b7-mwdas1g3';
// Match simulation for Team Deathmatch, Capture the Flag and Bomb (no three.js, no DOM:
// the same code runs in the browser and in tools/check-modes.mjs).
//
// Fixed 60 Hz steps. Actors are bodies with health, a gun and an operator. Bots think at
// 15 Hz (staggered) and act every step; the human is moved by the browser (the range's look,
// recoil, sights and movement) and reports its shots. Teams are 'A' and 'B'.
//
// Body for hits (actor frame, standing; crouching squashes y to 0.7): head sphere at 1.62 m
// (r 0.13), torso capsule 0.95-1.34 m (r 0.24), legs capsule 0.1-0.9 m (r 0.19).
import { mulberry32 } from '../core/prng.js?v=47bc4b7-mwdas1g3';
import { effectiveGun } from '../core/loadout.js?v=47bc4b7-mwdas1g3';
import { rayCapsule, raySphere, dirFrom, yawTo, wrap180, DEG } from './geom.js?v=47bc4b7-mwdas1g3';
import { BODY_R } from './map.js?v=47bc4b7-mwdas1g3';
import { Brain } from './bots.js?v=47bc4b7-mwdas1g3';
import { makeRules } from './rules.js?v=47bc4b7-mwdas1g3';
import { Nades } from './nades.js?v=47bc4b7-mwdas1g3';
import { Abilities } from './abilities.js?v=47bc4b7-mwdas1g3';

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
    noise: g.noise ?? 1, suppressed: !!g.suppressed, attach: g.attach || null,
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
    this.utility = utilityFor(this.o.mode);
    this.map.barricadeHp = this.utility.barricadeHp;
    this.acid = !!(o.map.data.hazards && o.map.data.hazards.length);
    this.rng = mulberry32(this.o.seed >>> 0);
    this.t = 0; this.tick = 0;
    this.events = []; this.noises = [];
    this.over = false; this.winner = null; this.endReason = '';
    this.actors = [];
    this.bb = { A: { seen: new Map(), deaths: [] }, B: { seen: new Map(), deaths: [] } };
    this.gunsById = new Map(o.guns.map((g) => [g.id, g]));
    this.losBudget = 0; this.pathBudget = 2;
    this.ab = new Abilities(this, abilitiesFor(this.o.mode, o.abilities || {}));
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
  // Players. o.human: you ({ op, side }); o.remotes: players on other PCs in a network match
  // ({ op, team, name, attach, peer }), each takes a place in their team ahead of the bots.
  // o.roster (network clients): the host's exact list of actors, so every PC has the same ids.
  _makeTeams() {
    const n = this.o.teamSize, h = this.o.human, remotes = this.o.remotes || [];
    const pool = (team) => this.opsFor(this.rules.sideOf ? this.rules.sideOf(team) : null);
    const byId = (id) => [...this.o.ops.attackers, ...this.o.ops.defenders].find((x) => x.id === id);
    if (this.o.roster) {
      for (const r of this.o.roster) this.addActor(r.team, byId(r.op) || pool(r.team)[0], !!r.human, r.human && !r.you ? r : null, r);
      return;
    }
    for (const team of ['A', 'B']) {
      const used = new Set();
      const pick = () => {
        const p = pool(team).filter((op) => !used.has(op.id));
        const op = p[Math.floor(this.rng() * p.length)];
        used.add(op.id);
        return op;
      };
      const humans = [...(h && team === this.humanTeam() ? [null] : []), ...remotes.filter((r) => r.team === team)];
      for (let i = 0; i < Math.max(n, humans.length); i++) {
        if (i < humans.length) {
          const r = humans[i], want = r ? r.op : h.op;
          const op = pool(team).find((x) => x.id === want && !used.has(x.id)) || pool(team).find((x) => !used.has(x.id)) || pool(team)[0];
          used.add(op.id);
          this.addActor(team, op, true, r);
        } else this.addActor(team, pick(), false);
      }
    }
  }
  humanTeam() { return this.o.human && this.rules.humanTeam ? this.rules.humanTeam() : 'A'; }
  // The gun an actor carries: the catalogue gun with that actor's attachments (o.attach: the
  // human's saved codes by gun id; bots carry the measured loadout).
  gunFor(human, id, attach = this.o.attach) {
    const g = this.gunsById.get(id) || this.o.guns[0];
    return human && attach ? effectiveGun(g, attach[g.id]) : g;
  }
  // net: a player on another PC ({ name, attach, peer }); fixed: a roster entry (id, name).
  addActor(team, op, human, net = null, fixed = null) {
    const attach = human ? (net ? net.attach || null : this.o.attach) : null;
    const g = this.gunFor(human, op.gun, attach);
    const a = {
      id: fixed ? fixed.id : this.actors.length + 1, team, op, human, name: fixed ? fixed.name : human ? (net ? String(net.name || 'Player') : 'You') : op.name, gun: gunStats(g), gunData: g,
      remote: net ? (net.peer ?? true) : null, attachMap: attach, skin: (net && net.skin) ?? (fixed && fixed.skin) ?? null,
      x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0, onGround: true, yaw: 0, pitch: 0, crouch: 0, speed: 0, ads: 0,
      hp: 100, alive: false, respawnAt: 0, protectUntil: 0, lastHurt: -10, kills: 0, deaths: 0, assists: 0,
      ammo: g.magSize, reloadUntil: 0, nextShot: 0, stunUntil: 0, slowUntil: 0, shakeUntil: 0, wobbleUntil: 0, revealedUntil: 0,
      carry: null, hold: null, stuckFor: 0, _sx: 0, _sz: 0, _st: 0,
    };
    a.brain = human || this.o.client ? null : new Brain(this, a, this.o.difficulty);
    this.ab.init(a);
    this.actors.push(a);
    return a;
  }
  enemiesOf(a) { return this.actors.filter((b) => b.team !== a.team); }
  teammates(a) { return this.actors.filter((b) => b.team === a.team && b !== a); }
  // You (on this PC); players on other PCs are human too, but remote.
  human() { return this.actors.find((a) => a.human && !a.remote) || null; }
  isMe(a) { return !!a && a.human && !a.remote; }

  /* ---------- spawning ---------- */
  // A random safe spawn (no enemy within 12 m or in sight), from the map's spawns
  // ([x, z, yaw, y]) and the places within `spread` m of them on the same level; if none is
  // safe, the best scored one.
  spawn(a, list, protect = 3, spread = 8) {
    const foes = this.enemiesOf(a).filter((e) => e.alive);
    if (!this._pools) this._pools = new Map();
    const pk = list.map((s) => s[0] + ',' + s[1]).join(';') + '|' + spread;
    let pool = this._pools.get(pk);
    if (!pool) {
      pool = list.slice();
      for (const n of this.map.data.nodes || []) {
        const near = list.find((s) => Math.hypot(n[0] - s[0], n[1] - s[1]) <= spread && Math.abs((n[2] || 0) - (s[3] || 0)) < 1.5);
        if (near && this.map.free(n[0], n[1], 0.5, n[2] || 0)) pool.push([n[0], n[1], near[2], n[2] || 0]);
      }
      this._pools.set(pk, pool);
    }
    const eyeAt = [0, 0, 0];
    const ok = (s) => {
      if (this.actors.some((b) => b !== a && b.alive && Math.hypot(b.x - s[0], b.z - s[1]) < 1.8)) return false;
      for (const e of foes) {
        const d = Math.hypot(e.x - s[0], e.z - s[1]);
        if (d < 12) return false;
        if (d < 45 && this.map.sight(this.eye(e, eyeAt), [s[0], (s[3] || 0) + 1.2, s[1]])) return false;
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
      for (const e of foes) if (Math.hypot(e.x - s[0], e.z - s[1]) < 45 && this.map.sight([e.x, e.y + EYE, e.z], [s[0], (s[3] || 0) + 1.2, s[1]])) { seen = true; break; }
      const busy = this.actors.some((b) => b !== a && b.alive && Math.hypot(b.x - s[0], b.z - s[1]) < 0.8);
      const score = d - (seen ? 60 : 0) - (busy ? 30 : 0) + this.rng();
      if (score > bs) { bs = score; best = s; }
    }
    return this._place(a, best, protect);
  }
  _place(a, best, protect) {
    // a little off the spot (so two never land on each other), without crossing a wall
    const y0 = best[3] || 0, p = this.map.moveCircle({ x: best[0], y: y0, z: best[1] }, this.r(-0.6, 0.6), this.r(-0.6, 0.6));
    p.y = this.map.groundAt(p.x, p.z, p.y);
    // not off the edge of a platform, and not into a gap too narrow to walk out of
    if (Math.abs(p.y - y0) > 0.5 || !this.map.standable(p.x, p.z, p.y)) { p.x = best[0]; p.z = best[1]; p.y = this.map.groundAt(p.x, p.z, y0); }
    Object.assign(a, { x: p.x, z: p.z, y: p.y, vx: 0, vy: 0, vz: 0, onGround: true, yaw: best[2] || 0, pitch: 0, crouch: 0, hp: 100, alive: true, protectUntil: this.t + protect, lastHurt: -10,
      ammo: a.gun.magSize, reloadUntil: 0, nextShot: 0, stunUntil: 0, slowUntil: 0, shakeUntil: 0, wobbleUntil: 0, carry: null, hold: null, vaulting: null, wireAt: -9, stuckFor: 0, _sx: p.x, _sz: p.z, _st: this.t });
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
    this.bb[v.team].deaths.push({ x: v.x, z: v.z, y: v.y, t: this.t });
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
    // gadgets die to one hit (barbed wire takes a few)
    const g = this.ab.rayGadgets(o, d, best, a);
    if (g) { best = g.t; hit = null; this.ab.hurtGadget(g.g, a); }
    const end = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
    this.emit({ type: 'shot', id: a.id, from: o.slice(), to: end, team: a.team, kind, wall: !hit && !g && w && w.box && !w.box.ground ? 1 : 0 });
    if (hit && damage > 0) this.hit(hit.actor, damage, a, hit.zone, kind);
    // bullets splinter doors: a few shots break one
    if (!hit && !g && w && w.box && w.box.kind === 'door' && damage > 0) this.doorHit(this.map.panels[w.box.panel], 22, a, end);
    // and chip soft walls: a few shots open a hole the size of a hand span
    if (!hit && !g && w && w.box && w.box.kind === 'soft' && damage > 0) this.cellHit(w.box, damage * 0.4, a, end);
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
  // A soft-wall cell hit (bullets, a knife): splinters, and a hole when it breaks.
  cellHit(cell, dmg, a, at) {
    if (cell.kind !== 'soft' || !cell.alive) return;
    const broke = this.map.hurtCell(cell, dmg);
    const c = at || [(cell.minX + cell.maxX) / 2, (cell.minY + cell.maxY) / 2, (cell.minZ + cell.maxZ) / 2];
    this.emit({ type: 'splinter', x: c[0], y: c[1], z: c[2], kind: 'soft', broke });
    if (broke) this.noises.push({ x: c[0], z: c[2], y: c[1], t: this.t, range: 12, kind: 'wall', team: a ? a.team : '', id: a ? a.id : 0 });
  }
  doorHit(pn, dmg, a, at = null) {
    if (pn && pn.alive) { const b = pn.box, c = at || [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2]; this.emit({ type: 'splinter', x: c[0], y: c[1], z: c[2], kind: 'door' }); }
    if (this.map.hurtDoor(pn, dmg)) {
      const b = pn.box, x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2, y = (b.minY + b.maxY) / 2;
      this.noises.push({ x, y, z, t: this.t, range: NOISE.door, kind: 'door', team: a ? a.team : '', id: a ? a.id : 0 });
      this.emit({ type: 'door', x, y, z, by: a ? a.id : 0 });
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
      if (d >= bd || Math.abs(e.y - a.y) > 1.2 || Math.abs(wrap180(yawTo(e.x - a.x, e.z - a.z) - a.yaw)) > KNIFE.cone) continue;
      if (!this.map.sight(this.eye(a), [e.x, e.y + 1.1, e.z])) continue;
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
    if (w && w.box && w.box.kind === 'soft') { this.cellHit(w.box, 999, a); return 'wall'; }
    const wire = this.ab.wireInFront(a, KNIFE.range + 0.2);
    if (wire) { this.ab.destroy(wire, a); return 'gadget'; }
    const g = this.ab.rayGadgets(o, d, KNIFE.range, a);
    if (g) { this.ab.destroy(g.g, a); return 'gadget'; }
    return '';
  }
  // The human's shot (direction from the range's recoil and spread).
  humanShot(a, o, d) {
    if (!a.alive || this.over || this.rules.frozen(a) || this.rules.noFire(a)) return null;
    if (this.t < a.protectUntil) a.protectUntil = this.t;          // firing ends spawn protection
    this.noise(a, NOISE.shot * (a.gun.noise ?? 1), 'shot');   // a suppressor carries less far
    return this.shoot(a, o, d);
  }
  noise(a, range, kind) {
    if (range <= 0) return;
    this.noises.push({ x: a.x, z: a.z, y: a.y, t: this.t, range, kind, team: a.team, id: a.id });
    while (this.noises.length && this.noises[0].t < this.t - 0.5) this.noises.shift();
  }
  eye(a, out = [0, 0, 0]) { out[0] = a.x; out[1] = a.y + (EYE + (CROUCH_EYE - EYE) * a.crouch); out[2] = a.z; return out; }

  /* ---------- the step ---------- */
  step() {
    if (this.over) return;
    const dt = TICK;
    this.t += dt; this.tick++;
    this.losBudget = 18;
    // Path planning budget: at most this many new routes a step (a bot over budget plans at
    // its next think, 1/15 s later). Long routes for several bots in one step were the
    // worst steps (10 ms on Winter Cabin). A count, not a time, so matches stay deterministic.
    this.pathBudget = 2;
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
        if (a.stuckFor >= 2 && !a.human && !this.map.free(a.x, a.z, BODY_R * 0.9, a.y)) {
          const n = this.map.nearestSpot(a.x, a.z, a.y);
          if (n && Math.hypot(n[0] - a.x, n[1] - a.z) < 3) { a.x = n[0]; a.z = n[1]; a.y = n[2]; a.vy = 0; a.stuckFor = 0; if (a.brain) a.brain.path = []; }
        }
      }
      if (this.rules.confine(a) && a.human) { a.forced = true; a.kept = true; }
      // acid pools burn (in 8-point bites)
      if (this.acid) { const dps = this.map.hazardAt(a.x, a.y, a.z); if (dps) { a.burn = (a.burn || 0) + dps * dt; if (a.burn >= 8) { a.burn -= 8; this.hit(a, 8, null, 'torso', 'acid'); } } }        // Bomb: defenders stay in the building
      if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.y)) { this.nan = true; a.x = 0; a.z = 0; a.y = 0; a.vy = 0; }
    }
    this.rules.check();
  }
  // Vault or climb (as C does for you): over low cover or onto a ledge in direction (dx, dz).
  // A Bomb defender never vaults out of the building. Returns true if it started.
  vault(a, dx, dz) {
    if (a.vaulting || !a.alive) return false;
    const v = this.map.vaultTarget(a.x, a.y, a.z, dx, dz);
    if (!v) return false;
    const k = this.rules.keepIn(a, v.x, v.z);
    if (k && k[2]) return false;
    a.vaulting = { t: 0, dur: 0.32 + 0.12 * Math.max(0, v.top - a.y), from: [a.x, a.y, a.z], to: [v.x, v.y, v.z], peak: Math.max(v.top, a.y, v.y) + 0.22 };
    this.noise(a, 10, 'vault');
    return true;
  }
  // Move a bot's body: wish velocity (vx, vz) in m/s. The core moves it with collision, up
  // stairs and ramps, and lets it fall off ledges.
  moveActor(a, wx, wz, dt) {
    if (a.vaulting) {
      const v = a.vaulting, e = (x) => x * x * (3 - 2 * x);
      v.t += dt;
      const p = Math.min(1, v.t / v.dur);
      a.x = v.from[0] + (v.to[0] - v.from[0]) * e(p); a.z = v.from[2] + (v.to[2] - v.from[2]) * e(p);
      a.y = p < 0.45 ? v.from[1] + (v.peak - v.from[1]) * e(p / 0.45) : v.peak + (v.to[1] - v.peak) * e((p - 0.45) / 0.55);
      a.speed = 3; a.vy = 0;
      if (p >= 1) { a.vaulting = null; a.y = v.to[1]; }
      return;
    }
    const k = 1 - Math.exp(-12 * dt);
    a.vx += (wx - a.vx) * k; a.vz += (wz - a.vz) * k;
    const p = this._body || (this._body = { x: 0, y: 0, z: 0, vy: 0 });
    p.x = a.x; p.y = a.y; p.z = a.z; p.vy = a.vy || 0;
    a.onGround = this.map.stepBody(p, a.vx * dt, a.vz * dt, dt);
    // never walk out over acid (strafing included): slide along its edge instead; a body
    // already over it (pushed off a catwalk) keeps moving and falling
    if (this.acid && this.overAcid(p) && !this.overAcid(a)) {
      let ok = false;
      for (const [dx, dz] of Math.abs(a.vx) > Math.abs(a.vz) ? [[a.vx, 0], [0, a.vz], [0, 0]] : [[0, a.vz], [a.vx, 0], [0, 0]]) {
        p.x = a.x; p.y = a.y; p.z = a.z; p.vy = a.vy || 0;
        a.onGround = this.map.stepBody(p, dx * dt, dz * dt, dt);
        if (!this.overAcid(p)) { ok = true; break; }
      }
      if (!ok) { a.vx = a.vz = 0; a.speed = 0; return; }
    }
    a.speed = Math.hypot(p.x - a.x, p.z - a.z) / dt;
    a.x = p.x; a.y = p.y; a.z = p.z; a.vy = p.vy;
  }
  // Is the floor under this body acid?
  overAcid(p) { return this.map.hazardAt(p.x, this.map.groundAt(p.x, p.z, p.y), p.z) > 0; }
  speedOf(a) {
    let s = a.gun.speed;
    if (this.t < a.slowUntil) s *= 1 - (this.ab.cfg.jolt_mines ? this.ab.cfg.jolt_mines.slow : 0.4);
    if (a.carry && a.carry.type === 'flag') s *= 0.9;
    if (this.t - (a.wireAt ?? -9) < 0.1) s *= this.utility.wireSpeed;  // in barbed wire
    if (this.t < a.stunUntil) s = 0;
    return s;
  }
  // Bodies do not overlap (the human is moved by the browser: only bots give way).
  _separate() {
    const L = this.actors;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      if (!a.alive || !b.alive || Math.abs(a.y - b.y) > 1.6) continue;
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
  report(team, e, x = e.x, z = e.z, by = null) { if (by && this.ab.jammed(by.x, by.z, by.team, by.y + 1)) return; this.bb[team].seen.set(e.id, { x, z, y: e.y, t: this.t, id: e.id }); }
}
export { dirFrom, yawTo, wrap180, DEG };
