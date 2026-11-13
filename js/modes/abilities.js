// Operator abilities (numbers in data/abilities.json). Q uses yours; F and B where noted.
//
//   Ayla   Jolt Mines     3 mines on floor or wall: an enemy within 2 m sets one off, 1 s later
//                         a 4 m pulse: 20 damage, 40% slower and a view wobble for 3 s.
//   Fenrik Dread Mines    the same, but 10 damage and 6 s of aim shake and dark screen edges.
//   Glitch Spark Drone    a drone with a 20 s battery, driven from its own camera while the
//                         body stands still (6 m/s). Q scans 8 m (enemies outlined 3 s); F
//                         near a gadget zaps it off for 8 s. V: back to the body.
//   Dash   Breach Rounds  3 rounds at 40 m/s; on impact break soft walls and deal up to 60
//                         damage within 3 m (less further out). 1.2 s between shots.
//   Muse   Static Jammer  2 jammers (floor or soft wall), 8 m: enemy abilities, drones and
//                         gadgets stop working inside.
//   Pace   Wall Charge    2 charges on a soft or reinforced wall; Q again after a 2 s arm
//                         blows a 1.5 x 2 m hole. The only thing that opens reinforced walls.
//   Aiko   Pulse Scanner  Q pings a 20 m cone ahead: enemy gadgets in it are outlined through
//                         walls for 6 s. 10 s cooldown.
//   Kamai  Catcher        2 nodes on walls; each destroys one incoming projectile within 4 m,
//                         then recharges for 20 s. Counters Breach Rounds.
//   Huck   Underbarrel    B swaps to a 6-shell breacher: 8 pellets, up to 70 damage close up,
//                         breaks soft walls; 0.6 s a shell to reload.
//   Onyx   Charge Dash    hold Q 0.6 s, then dash 6 m: through soft walls, the first enemy hit
//                         is stunned and knocked back for 1.5 s. 2 charges, 12 s each.
// Gadgets die to one bullet. Bots use abilities too (see botThink).
import { raySphere, dirFrom, yawTo, wrap180, DEG } from './geom.js?v=ee5991e-mweaippm';

export const DRONE_R = 0.15;           // a drone's collision radius
export class Abilities {
  constructor(m, cfg) {
    this.m = m; this.cfg = cfg; this.on = !!m.o.abilitiesOn;
    this.gadgets = []; this.projectiles = []; this.nextId = 1;
  }
  init(a) {
    const id = a.op.ability, c = this.cfg[id] || {};
    a.ab = { id, c, name: c.name || '', charges: c.charges ?? 0, busy: false, cdUntil: 0, nextAt: 0, holdQ: 0, dash: null, drone: null, shotgun: false, shells: c.shells || 0, nextShell: 0, ready: [] };
    a.ab.prepDrones = 1;                        // every attacker: one drone for the Bomb prep phase
    if (id === 'charge_dash') a.ab.ready = Array.from({ length: c.charges || 2 }, () => 0);
  }
  refill(a) {
    const keep = a.ab;
    this.init(a);
    if (keep && keep.drone) this.destroy(keep.drone);
  }
  clearAll() { this.gadgets = []; this.projectiles = []; this.clouds = []; for (const a of this.m.actors) if (a.ab) { a.ab.drone = null; a.ab.busy = false; } }
  onDeath(a) {
    if (a.ab && a.ab.drone) this.destroy(a.ab.drone);
    if (a.ab) { a.ab.holdQ = 0; a.ab.dash = null; a.ab.busy = false; a.ab.shotgun = false; }
  }
  add(g) { g.id = this.nextId++; g.alive = true; g.disabledUntil = 0; g.revealedUntil = 0; g.revealedFor = null; this.gadgets.push(g); this.m.emit({ type: 'gadget', id: g.id, kind: g.type }); return g; }
  destroy(g, by = null) {
    if (!g || !g.alive) return;
    g.alive = false;
    if (g.type === 'drone') { const o = this.m.actors.find((a) => a.id === g.owner); if (o && o.ab) { o.ab.drone = null; o.ab.busy = false; } }
    this.m.emit({ type: 'gadgetDown', id: g.id, by: by ? by.id : 0 });
  }
  // Bullets and blades on a gadget: barbed wire takes a few, the rest go at once.
  hurtGadget(g, by = null) {
    if (g.type === 'wire' && --g.hp > 0) { this.m.emit({ type: 'splinter', x: g.x, y: g.y, z: g.z, kind: 'wire' }); return; }
    this.destroy(g, by);
  }

  /* ---------- barbed wire (Bomb defenders, in place of grenades) ---------- */
  // A 2 m roll laid on the floor in front, across the way you face (Caps Lock / G).
  placeWire(a) {
    const m = this.m;
    if (!a.alive || m.over || (a.wire || 0) <= 0 || (a.ab && a.ab.busy) || m.rules.frozen(a)) return null;
    const p = this.aimPoint(a, 2.5);
    let x = p.x, z = p.z, y = p.y - 0.05;
    if (p.wall || Math.hypot(x - a.x, z - a.z) < 0.8) { x = a.x + Math.sin(a.yaw * DEG) * 1.3; z = a.z - Math.cos(a.yaw * DEG) * 1.3; const q = { x, y: a.y, z }; m.map.resolve(q, 0.3); x = q.x; z = q.z; y = m.map.groundAt(x, z, a.y); }
    if (Math.abs(y - a.y) > 0.6) return null;
    const k = m.rules.keepIn(a, x, z);
    if (k && k[2]) return null;                      // not outside the building
    a.wire--;
    if (m.t < a.protectUntil) a.protectUntil = m.t;
    m.noise(a, 8, 'wire');
    return this.add({ type: 'wire', team: a.team, owner: a.id, x, y: y + 0.25, z, floor: y, yaw: a.yaw, r: 0.5, hp: m.utility.wireHp });
  }
  // Is (x, z) at floor height y inside wire g? (2.5 m along, 1.2 m across with a body's reach)
  inWire(g, x, z, y) {
    if (Math.abs(y - g.floor) > 0.5) return false;
    const yr = g.yaw * DEG, fx = Math.sin(yr), fz = -Math.cos(yr), dx = x - g.x, dz = z - g.z;
    return Math.abs(dx * fz * -1 + dz * fx) < 1.25 && Math.abs(dx * fx + dz * fz) < 0.6;
  }
  // The enemy wire a body is in right now, or null.
  wireAt(a) { for (const g of this.gadgets) if (g.alive && g.type === 'wire' && g.team !== a.team && this.inWire(g, a.x, a.z, a.y)) return g; return null; }
  // An enemy wire within reach in front of a (a knife clears it), or null.
  wireInFront(a, reach = 1.9) {
    const yr = a.yaw * DEG, fx = Math.sin(yr), fz = -Math.cos(yr);
    for (const g of this.gadgets) {
      if (!g.alive || g.type !== 'wire' || g.team === a.team || Math.abs(g.floor - a.y) > 0.6) continue;
      for (let s = 0.3; s <= reach; s += 0.3) if (this.inWire(g, a.x + fx * s, a.z + fz * s, a.y)) return g;
    }
    return null;
  }
  // The enemy wire on the way from a to (bx, bz), or null.
  wireOn(a, bx, bz) {
    const L = Math.hypot(bx - a.x, bz - a.z);
    for (const g of this.gadgets) {
      if (!g.alive || g.type !== 'wire' || g.team === a.team || Math.abs(g.floor - a.y) > 0.6) continue;
      for (let s = 0; s <= Math.min(L, 3); s += 0.25) if (this.inWire(g, a.x + (bx - a.x) / L * s, a.z + (bz - a.z) / L * s, a.y)) return { g, d: s };
    }
    return null;
  }
  // Every step: wire slows and scratches whoever moves through it, and rattles.
  _wires(dt) {
    const m = this.m, t = m.t;
    for (const g of this.gadgets) {
      if (!g.alive || g.type !== 'wire') continue;
      for (const e of m.actors) {
        if (!e.alive || e.team === g.team || !this.inWire(g, e.x, e.z, e.y)) continue;
        e.wireAt = t;
        if (e.speed > 0.4) {
          e.wireCut = (e.wireCut || 0) + 2 * dt;       // 2 health a second while moving through
          if (e.wireCut >= 1) { e.wireCut -= 1; m.hit(e, 1, m.actors.find((q) => q.id === g.owner), 'limbs', 'wire'); }
          if (t - (e.wireNoise || -9) > 0.35) { e.wireNoise = t; m.noise(e, 14, 'wire'); m.emit({ type: 'wire', id: e.id, x: e.x, y: e.y, z: e.z }); }
        }
      }
    }
  }
  // An enemy jammer covers this spot?
  // (y: the height of what is asked about; jammers reach in every direction, floors included)
  jammed(x, z, team, y) {
    const R = (this.cfg.static_jammer || {}).radius || 8;
    return this.gadgets.some((g) => g.alive && g.type === 'jammer' && g.team !== team && this.m.t >= g.disabledUntil && Math.hypot(g.x - x, g.z - z, y === undefined ? 0 : g.y - y) < R);
  }
  off(g) { return !g.alive || this.m.t < g.disabledUntil || this.jammed(g.x, g.z, g.team, g.y); }
  rayGadgets(o, d, maxT, shooter) {
    let best = maxT, hit = null;
    for (const g of this.gadgets) {
      if (!g.alive || g.team === shooter.team) continue;
      const t = raySphere(o, d, [g.x, g.y, g.z], g.r || 0.2);
      if (t < best) { best = t; hit = g; }
    }
    return hit ? { t: best, g: hit } : null;
  }

  /* ---------- using an ability ---------- */
  // Where you are aiming within range: { x, y, z, wall, box } on a wall or the floor.
  aimPoint(a, range) {
    const m = this.m, o = m.eye(a), d = dirFrom(a.yaw, a.pitch);
    const h = m.map.raycast(o, d, range);
    // a floor (the ground, a stair, an upper floor): lying on it
    if (h && !h.box.ceiling && (h.box.ground || (h.axis === 1 && d[1] < 0))) return { x: o[0] + d[0] * h.t, y: o[1] + d[1] * h.t + 0.05, z: o[2] + d[2] * h.t, wall: false };
    if (h && !h.box.ground) { const t = h.t - 0.06; return { x: o[0] + d[0] * t, y: Math.max(a.y + 0.2, Math.min(a.y + 2, o[1] + d[1] * t)), z: o[2] + d[2] * t, wall: true, box: h.box }; }
    const p = { x: a.x + Math.sin(a.yaw * DEG) * 1.5, y: a.y, z: a.z - Math.cos(a.yaw * DEG) * 1.5 };
    m.map.resolve(p, 0.2);
    return { x: p.x, y: m.map.groundAt(p.x, p.z, a.y) + 0.05, z: p.z, wall: false };
  }
  // Q pressed (down) or released (up). Returns true if something happened.
  // Bomb prep: every attacker has a plain drone (scan only). Glitch's Spark Drone is his
  // ability and also works in the action phase.
  prepOK(a) { const R = this.m.rules; return R.name === 'Bomb' && R.phase === 'prep' && R.isAttacker(a); }
  plainDrone(a) { return a.ab && a.ab.prepDrones > 0 && !a.ab.drone && this.prepOK(a); }
  launchDrone(a, plain) {
    const m = this.m, ab = a.ab, c = this.cfg.spark_drone || {};
    // set down at your feet and rolled 0.6 m forward (never placed straight through a wall)
    const g = this.add({ type: 'drone', basic: plain, team: a.team, owner: a.id, x: a.x, fy: a.y, vy: 0, y: a.y + 0.15, z: a.z, yaw: a.yaw, pitch: 0, r: 0.22, end: plain ? m.rules.phaseEnd : m.t + (c.battery || 20), scanAt: 0 });
    this.roll(g, Math.sin(a.yaw * DEG) * 0.6, -Math.cos(a.yaw * DEG) * 0.6, 0);
    ab.drone = g; ab.busy = true;
    if (plain) ab.prepDrones--; else ab.charges--;
    return g;
  }
  // Roll a drone by (dx, dz) over dt seconds: it never passes through anything, goes under
  // boarded doors, up ramps (not stairs), and falls off ledges.
  roll(g, dx, dz, dt) {
    const p = this._dp || (this._dp = { x: 0, y: 0, z: 0, vy: 0 });
    p.x = g.x; p.y = g.fy || 0; p.z = g.z; p.vy = g.vy || 0;
    // barbed wire snags the wheels
    if (this.gadgets.some((w) => w.alive && w.type === 'wire' && w.team !== g.team && this.inWire(w, g.x, g.z, p.y))) { dx *= 0.6; dz *= 0.6; }
    this.m.map.stepBody(p, dx, dz, dt, DRONE_R, true);
    g.x = p.x; g.z = p.z; g.fy = p.y; g.vy = p.vy; g.y = p.y + 0.15;
  }
  q(a, down) {
    const m = this.m, t = m.t, ab = a.ab, c = ab.c;
    if (!a.alive || !ab) return false;
    if (down && ab.drone && ab.drone.basic) { this.scan(a); return true; }
    if (down && this.plainDrone(a)) { this.launchDrone(a, true); return true; }
    if (!this.on || !a.alive || (m.rules.frozen(a) && !(ab.id === 'spark_drone' || ab.drone))) return false;
    if (!down) { if (ab.id === 'charge_dash') ab.holdQ = 0; return false; }
    if (this.jammed(a.x, a.z, a.team, a.y + 1) && !['jolt_mines', 'dread_mines', 'static_jammer', 'catcher'].includes(ab.id)) { m.emit({ type: 'msg', text: 'Jammed', id: a.id, private: true }); return false; }
    switch (ab.id) {
      case 'jolt_mines': case 'dread_mines': {
        if (ab.charges <= 0) return false;
        const p = this.aimPoint(a, c.placeRange || 3);
        this.add({ type: 'mine', kind: ab.id === 'jolt_mines' ? 'jolt' : 'dread', team: a.team, owner: a.id, x: p.x, y: p.y, z: p.z, r: 0.2, trigAt: 0 });
        ab.charges--; return true;
      }
      case 'static_jammer': {
        if (ab.charges <= 0) return false;
        const p = this.aimPoint(a, c.placeRange || 3);
        if (p.wall && p.box && p.box.kind !== 'soft') { p.wall = false; p.y = m.map.groundAt(p.x, p.z, a.y) + 0.05; }
        this.add({ type: 'jammer', team: a.team, owner: a.id, x: p.x, y: p.y, z: p.z, r: 0.22 });
        ab.charges--; return true;
      }
      case 'catcher': {
        if (ab.charges <= 0) return false;
        const p = this.aimPoint(a, c.placeRange || 3);
        this.add({ type: 'catcher', team: a.team, owner: a.id, x: p.x, y: p.wall ? p.y : p.y + 0.35, z: p.z, r: 0.2, readyAt: 0 });
        ab.charges--; return true;
      }
      case 'spark_drone': {
        if (ab.drone) { this.scan(a); return true; }
        if (ab.charges <= 0) return false;
        this.launchDrone(a, false); return true;
      }
      case 'breach_rounds': {
        if (ab.charges <= 0 || t < ab.nextAt) return false;
        const o = m.eye(a), d = dirFrom(a.yaw, a.pitch), v = c.speed || 40;
        this.projectiles.push({ id: this.nextId++, type: 'breach', team: a.team, owner: a.id, x: o[0] + d[0] * 0.5, y: o[1] - 0.1 + d[1] * 0.5, z: o[2] + d[2] * 0.5, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, life: 2.5, alive: true });
        ab.charges--; ab.nextAt = t + (c.interval || 1.2);
        m.noise(a, 20, 'ability');
        return true;
      }
      case 'wall_charge': {
        const placed = this.gadgets.find((g) => g.alive && g.type === 'charge' && g.owner === a.id);
        if (placed) {
          if (t < placed.armAt || this.off(placed)) return false;
          this.blowCharge(placed, a); return true;
        }
        if (ab.charges <= 0) return false;
        const p = this.aimPoint(a, c.placeRange || 2);
        if (!p.wall || !p.box || p.box.panel === undefined) { m.emit({ type: 'msg', text: 'Aim at a soft or reinforced wall', id: a.id, private: true }); return false; }
        this.add({ type: 'charge', team: a.team, owner: a.id, x: p.x, y: 1.1, z: p.z, r: 0.18, panel: p.box.panel, armAt: t + (c.arm || 2) });
        ab.charges--; return true;
      }
      case 'pulse_scanner': {
        if (t < ab.cdUntil) return false;
        ab.cdUntil = t + (c.cooldown || 10); ab.pingUntil = t + (c.time || 1.2);
        const range = c.range || 20, half = (c.cone || 60) / 2;
        let n = 0;
        for (const g of this.gadgets) {
          if (!g.alive || g.team === a.team) continue;
          const dx = g.x - a.x, dz = g.z - a.z, d = Math.hypot(dx, dz);
          if (d > range || Math.abs(wrap180(yawTo(dx, dz) - a.yaw)) > half) continue;
          g.revealedUntil = t + (c.revealTime || 6); g.revealedFor = a.team; n++;
        }
        m.emit({ type: 'msg', text: n ? n + ' enemy gadget' + (n > 1 ? 's' : '') + ' found' : 'No gadgets found', id: a.id, private: true });
        return true;
      }
      case 'underbarrel': this.toggleShotgun(a); return true;
      case 'charge_dash': {
        if (a.carry && a.carry.type === 'flag') return false;           // flag carriers: no movement abilities
        if (!ab.ready.some((r) => t >= r)) return false;
        ab.holdQ = t; return true;
      }
    }
    return false;
  }
  toggleShotgun(a) { if (!this.on || !a.alive || a.ab.id !== 'underbarrel') return false; a.ab.shotgun = !a.ab.shotgun; return true; }
  // F: the drone zaps a gadget off.
  f(a) {
    const ab = a.ab, d = ab.drone, m = this.m;
    if (!this.on || !d || !d.alive || d.basic || this.jammed(d.x, d.z, d.team, d.y)) return false;
    const R = ab.c.zapRange || 2;
    const g = this.gadgets.filter((x) => x.alive && x.team !== a.team && x.type !== 'drone').sort((p, q) => Math.hypot(p.x - d.x, p.z - d.z) - Math.hypot(q.x - d.x, q.z - d.z))[0];
    if (!g || Math.hypot(g.x - d.x, g.z - d.z) > R) { m.emit({ type: 'msg', text: 'No gadget in reach', id: a.id, private: true }); return false; }
    g.disabledUntil = m.t + (ab.c.zapTime || 8);
    m.emit({ type: 'msg', text: 'Gadget zapped', id: a.id, private: true });
    return true;
  }
  scan(a) {
    const ab = a.ab, d = ab.drone, m = this.m;
    if (!d || m.t < d.scanAt || this.jammed(d.x, d.z, d.team, d.y)) return false;
    d.scanAt = m.t + 1;
    const R = ab.c.scanRadius || 8;
    let n = 0;
    for (const e of m.actors) if (e.alive && e.team !== a.team && Math.hypot(e.x - d.x, e.z - d.z, e.y + 1 - d.y) < R) { e.revealedUntil = m.t + (ab.c.revealTime || 3); m.report(a.team, e); n++; }
    m.emit({ type: 'scan', id: a.id, x: d.x, z: d.z, r: R });
    if (n) m.emit({ type: 'msg', text: n + ' enem' + (n > 1 ? 'ies' : 'y') + ' spotted', id: a.id, private: true });
    return true;
  }
  recall(a) { if (a.ab && a.ab.drone) this.destroy(a.ab.drone); }
  // Drone driving (you): fwd/back/left/right flags, seconds.
  droneInput(a, inp, dt) {
    const d = a.ab && a.ab.drone;
    if (!d || !d.alive) return;
    // Drone speed comes from the drone's own settings: the operator's ability config only
    // when that ability IS the drone (another ability's "speed", e.g. Breach Rounds' 40 m/s
    // round, made every prep drone of that operator fly at 40 m/s).
    const dc = a.ab.id === 'spark_drone' ? a.ab.c : this.cfg.spark_drone || {};
    const sp = (dc.speed || 6) * (this.jammed(d.x, d.z, d.team, d.y) ? 0.5 : 1);
    const f = (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0), s = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (!f && !s) { this.roll(d, 0, 0, dt); return; }
    const y = d.yaw * DEG, L = Math.hypot(f, s);
    this.roll(d, (Math.sin(y) * f + Math.cos(y) * s) / L * sp * dt, (-Math.cos(y) * f + Math.sin(y) * s) / L * sp * dt, dt);
  }
  mouse(a, dx, dy) {
    const d = a.ab && a.ab.drone;
    if (!d || !d.alive) return false;
    d.yaw = ((d.yaw + dx * 0.12) % 360 + 360) % 360;
    d.pitch = Math.max(-60, Math.min(40, d.pitch - dy * 0.12));
    return true;
  }
  blowCharge(g, a) {
    const m = this.m, pn = m.map.panels[g.panel], c = this.cfg.wall_charge || {};
    m.map.breakPanel(pn);
    for (const e of m.actors) if (e.alive && Math.hypot(e.x - g.x, e.z - g.z, e.y + 1 - g.y) < (c.radius || 2)) m.hit(e, c.damage || 30, a, 'torso', 'ability');
    for (const w of this.gadgets) if (w.alive && w.type === 'wire' && Math.hypot(w.x - g.x, w.z - g.z) < 3) this.destroy(w, a);
    if (pn) { const b = pn.box; m.emit({ type: 'debris', x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2, kind: pn.kind, n: 24 }); }
    this.destroy(g);
    m.noise(a, 35, 'blast');
    m.emit({ type: 'boom', x: g.x, y: g.y, z: g.z, small: true });
  }
  // The breacher (Huck): 8 pellets in a cone, up to 70 damage close up, breaks soft walls.
  fireShotgun(a) {
    const m = this.m, ab = a.ab, c = ab.c, t = m.t;
    if (!a.alive || ab.shells <= 0 || t < ab.nextAt || m.rules.frozen(a)) return false;
    ab.shells--; ab.nextAt = t + (c.interval || 0.8); ab.nextShell = t + 1.2;
    const o = m.eye(a), n = c.pellets || 8, per = (c.damage || 70) / n, full = c.fullRange || 3, max = c.maxRange || 14;
    m.noise(a, 35, 'shot');
    let wall = null;
    for (let i = 0; i < n; i++) {
      const d = dirFrom(a.yaw + m.gauss() * (c.spread || 4) * 0.5, a.pitch + m.gauss() * (c.spread || 4) * 0.5);
      const r = m.shoot(a, o, d, 0, 'pellet');
      if (r.actor) { const f = r.t <= full ? 1 : Math.max(0, 1 - (r.t - full) / (max - full)); if (f > 0) m.hit(r.actor, per * f, a, r.zone === 'head' ? 'torso' : r.zone, 'pellet'); }
      else if (r.box && r.box.panel !== undefined && r.box.kind === 'soft' && r.t < (c.wallRange || 5)) wall = r;
    }
    if (wall) m.map.breakAt(wall.end, 0.1);
    return true;
  }
  breachImpact(p, x, y, z) {
    const m = this.m, c = this.cfg.breach_rounds || {}, owner = m.actors.find((a) => a.id === p.owner);
    m.map.breakAt([x, y, z], c.wallRadius || 1.6);
    const R = c.radius || 3;
    for (const e of m.actors) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - x, e.y + 1 - y, e.z - z);
      if (d < R) m.hit(e, (c.damage || 60) * (1 - d / R), owner, 'torso', 'ability');
    }
    for (const g of this.gadgets) if (g.alive && g.team !== p.team && Math.hypot(g.x - x, g.z - z) < R) this.destroy(g, owner);
    if (owner) m.noise(owner, 35, 'blast');
    m.emit({ type: 'boom', x, y, z, small: true });
  }

  // Dread: the screen shakes and darkens, the defenders see you through walls, and a bot
  // panics (runs for cover, slower to react).
  dread(e, team, c) {
    const m = this.m, t = m.t;
    const fresh = t >= (e.shakeUntil || 0);
    e.shakeUntil = Math.max(e.shakeUntil || 0, t + (c.shakeTime || 6));
    e.revealedUntil = Math.max(e.revealedUntil || 0, t + (c.revealTime || 6));
    m.report(team, e);
    if (fresh && e.brain) e.brain.panic(t + 3);
  }

  /* ---------- every step ---------- */
  update(dt) {
    const m = this.m, t = m.t;
    // drones: flat battery, and the plain prep drones stop when the action phase starts
    for (const g of this.gadgets) if (g.alive && g.type === 'drone' && (t >= g.end || (g.basic && m.rules.phase !== 'prep'))) this.destroy(g);
    this._wires(dt);
    if (!this.on) { this.gadgets = this.gadgets.filter((g) => g.alive); return; }
    // projectiles (Kamai's catchers take them first)
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.life -= dt;
      const C = this.cfg.catcher || {};
      const cat = this.gadgets.find((g) => g.type === 'catcher' && g.team !== p.team && !this.off(g) && t >= g.readyAt && Math.hypot(g.x - p.x, g.y - p.y, g.z - p.z) < (C.radius || 5));
      if (cat) { p.alive = false; cat.readyAt = t + (C.recharge || 10); m.emit({ type: 'caught', x: p.x, y: p.y, z: p.z, cx: cat.x, cy: cat.y, cz: cat.z }); continue; }
      const step = Math.hypot(p.vx, p.vy, p.vz) * dt, d = [p.vx * dt / step, p.vy * dt / step, p.vz * dt / step], o = [p.x, p.y, p.z];
      let hitT = Infinity;
      const w = m.map.raycast(o, d, step);
      if (w) hitT = w.t;
      for (const e of m.actors) { if (!e.alive || e.team === p.team) continue; const r = m.rayActor(o, d, e, hitT); if (r) hitT = r.t; }
      if (hitT < Infinity) { p.alive = false; this.breachImpact(p, o[0] + d[0] * hitT, o[1] + d[1] * hitT, o[2] + d[2] * hitT); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 3 * dt;
      if (p.life <= 0 || p.y < 0) { p.alive = false; this.breachImpact(p, p.x, Math.max(0.05, p.y), p.z); }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
    // mines, drones
    for (const g of this.gadgets) {
      if (!g.alive) continue;
      if (g.type === 'mine') {
        const c = this.cfg[g.kind === 'jolt' ? 'jolt_mines' : 'dread_mines'] || {};
        if (!g.trigAt) {
          if (this.off(g)) continue;
          if (m.actors.some((e) => e.alive && e.team !== g.team && Math.hypot(e.x - g.x, e.z - g.z, e.y + 0.5 - g.y) < (c.trigger || 2))) { g.trigAt = t + (c.delay || 1); m.emit({ type: 'mineArmed', id: g.id }); }
        } else if (t >= g.trigAt) {
          const owner = m.actors.find((a) => a.id === g.owner);
          for (const e of m.actors) {
            if (!e.alive || e.team === g.team || Math.hypot(e.x - g.x, e.z - g.z, e.y + 0.5 - g.y) > (c.radius || 4)) continue;
            m.hit(e, c.damage || 10, owner, 'torso', 'ability');
            if (g.kind === 'jolt') { e.slowUntil = t + (c.slowTime || 3); e.wobbleUntil = t + (c.wobbleTime || 3); }
            else this.dread(e, g.team, c);
          }
          if (g.kind === 'dread') this.clouds.push({ x: g.x, y: g.y, z: g.z, r: c.cloudRadius || 3, until: t + (c.cloudTime || 5), team: g.team, c });
          m.emit({ type: 'pulse', x: g.x, y: g.y, z: g.z, kind: g.kind, r: g.kind === 'dread' ? c.cloudRadius || 3 : c.radius || 4, dur: g.kind === 'dread' ? c.cloudTime || 5 : 0 });
          this.destroy(g);
        }
      } else if (g.type === 'drone' && t >= g.end) this.destroy(g);
    }
    // dread gas: anyone inside keeps shaking and stays revealed
    this.clouds = (this.clouds || []).filter((cl) => t < cl.until);
    for (const cl of this.clouds) for (const e of m.actors) if (e.alive && e.team !== cl.team && Math.hypot(e.x - cl.x, e.z - cl.z, e.y - (cl.y || 0)) < cl.r) this.dread(e, cl.team, { ...cl.c, shakeTime: 1.5, revealTime: 2 });
    // catchers also zap enemy drones and wall charges that come in range
    const C = this.cfg.catcher || {};
    for (const cat of this.gadgets) {
      if (cat.type !== 'catcher' || this.off(cat) || t < cat.readyAt) continue;
      const g = this.gadgets.find((x) => x.alive && x.team !== cat.team && (x.type === 'drone' || x.type === 'charge') && Math.hypot(x.x - cat.x, x.z - cat.z, x.y - cat.y) < (C.radius || 5));
      if (g) { cat.readyAt = t + (C.recharge || 10); m.emit({ type: 'caught', x: g.x, y: g.y || 0.3, z: g.z, cx: cat.x, cy: cat.y, cz: cat.z }); this.destroy(g); }
    }
    this.gadgets = this.gadgets.filter((g) => g.alive);
    // per actor: shells, dash charges, the charge dash itself
    for (const a of m.actors) {
      const ab = a.ab;
      if (!ab || !a.alive) continue;
      if (ab.id === 'underbarrel' && ab.shells < (ab.c.shells || 6) && t >= ab.nextShell) { ab.shells++; ab.nextShell = t + (ab.c.reload || 0.6); }
      if (ab.id === 'charge_dash') {
        if (ab.holdQ && t - ab.holdQ >= (ab.c.hold || 0.6)) {
          ab.holdQ = 0;
          const k = ab.ready.findIndex((r) => t >= r);
          if (k >= 0 && !(a.carry && a.carry.type === 'flag')) { ab.ready[k] = t + (ab.c.recharge || 12); this.startDash(a); }
        }
        if (ab.dash) this.stepDash(a, dt);
      }
    }
  }
  startDash(a) {
    const y = a.yaw * DEG;
    a.ab.dash = { t: 0, T: a.ab.c.time || 0.35, dx: Math.sin(y), dz: -Math.cos(y), left: a.ab.c.distance || 6, hit: false };
    this.m.noise(a, 12, 'dash');
  }
  stepDash(a, dt) {
    const m = this.m, D = a.ab.dash, c = a.ab.c;
    const sp = (c.distance || 6) / D.T, step = Math.min(D.left, sp * dt);
    const ahead = [a.x + D.dx * 0.6, a.y + 1, a.z + D.dz * 0.6];
    if (m.map.near(ahead[0], ahead[2], 0.5, []).some((b) => b.kind === 'soft' && b.alive)) m.map.breakAt(ahead, 0.3);
    const p = m.map.moveCircle({ x: a.x, y: a.y, z: a.z }, D.dx * step, D.dz * step);
    a.x = p.x; a.y = p.y; a.z = p.z; if (a.human) a.forced = true;
    D.left -= step; D.t += dt;
    if (!D.hit && !m.rules.noFire(a)) {
      const e = m.actors.find((q) => q.alive && q.team !== a.team && Math.hypot(q.x - a.x, q.z - a.z) < 1.0 && Math.abs(q.y - a.y) < 1.2);
      if (e) {
        D.hit = true;
        e.stunUntil = m.t + (c.stun || 2);
        m.emit({ type: 'stun', id: e.id, by: a.id });
        // knocked back along the dash, stopping at walls (never through them)
        const k = m.map.moveCircle({ x: e.x, y: e.y, z: e.z }, D.dx * (c.knockback || 2), D.dz * (c.knockback || 2));
        e.x = k.x; e.y = k.y; e.z = k.z; if (e.human) e.forced = true;
        m.hit(e, c.damage || 35, a, 'torso', 'ability');
        D.left = 0;
      }
    }
    if (D.left <= 0.001 || D.t > D.T * 2) a.ab.dash = null;
  }

  /* ---------- bots ---------- */
  botThink(brain) {
    brain.abGoal = null;
    const m = this.m, a = brain.a, ab = a.ab, t = m.t, R = m.rules;
    // attackers scout with their prep drone (staggered starts)
    if (ab && a.alive && ab.drone && ab.drone.basic) { this.botDrone(brain); return; }
    if (ab && a.alive && this.plainDrone(a) && t > R.phaseEnd - 27 + (a.id % 4) * 1.5) { this.launchDrone(a, true).path = null; return; }
    if (!this.on) return;
    if (!ab || !a.alive) return;
    const tgt = brain.target && brain.target.alive && t - brain.visAt < 0.3 ? brain.target : null;
    const dist = tgt ? Math.hypot(tgt.x - a.x, tgt.z - a.z) : Infinity;
    const bomb = R.name === 'Bomb', attacking = bomb && R.isAttacker(a);
    // shoot an enemy gadget it can see (no enemy in sight)
    if (!tgt && t >= (brain.gadgetAt || 0) && !R.frozen(a)) {
      brain.gadgetAt = t + 0.5;
      const eye = m.eye(a);
      const g = this.gadgets.find((x) => x.alive && x.team !== a.team && Math.hypot(x.x - a.x, x.z - a.z) < 12 && ((t < x.revealedUntil && x.revealedFor === a.team) || Math.hypot(x.x - a.x, x.z - a.z) < (x.type === 'mine' ? 3.5 : 7)) && m.map.sight(eye, [x.x, x.y, x.z]));
      if (g && a.ammo > 0 && !a.reloadUntil) {
        const d = [g.x - eye[0], g.y - eye[1], g.z - eye[2]], L = Math.hypot(d[0], d[1], d[2]);
        a.yaw = yawTo(d[0], d[2]); brain.aimYaw = a.yaw;
        m.noise(a, 35, 'shot'); m.shoot(a, eye, [d[0] / L, d[1] / L, d[2] / L]); a.ammo--;
      }
    }
    // gadget placement: defenders during prep at their site's spots; elsewhere near spots
    if (['jolt_mines', 'dread_mines', 'static_jammer', 'catcher'].includes(ab.id)) {
      if (ab.charges <= 0 || (bomb && attacking)) return;
      const type = ab.id === 'static_jammer' ? 'jammer' : ab.id === 'catcher' ? 'catcher' : 'mine';
      const spots = (m.map.data.gadgets[type] || []).filter((s) => (!bomb || !s[2] || (brain.site && s[2] === brain.site.name)) && !this.gadgets.some((g) => g.alive && Math.hypot(g.x - s[0], g.z - s[1]) < 1));
      // Bomb: the map's planned spots for this site, in order (the same set-up every round);
      // other modes: the nearest free spot
      const s = bomb ? spots[0] : spots.sort((p, q) => Math.hypot(p[0] - a.x, p[1] - a.z) - Math.hypot(q[0] - a.x, q[1] - a.z))[0];
      if (s && !tgt) {
        const d = Math.hypot(s[0] - a.x, s[1] - a.z);
        if (d < 2.2) {
          this.add(type === 'mine' ? { type: 'mine', kind: ab.id === 'jolt_mines' ? 'jolt' : 'dread', team: a.team, owner: a.id, x: s[0], y: 0.05, z: s[1], r: 0.2, trigAt: 0 }
            : type === 'jammer' ? { type: 'jammer', team: a.team, owner: a.id, x: s[0], y: 0.05, z: s[1], r: 0.22 }
              : { type: 'catcher', team: a.team, owner: a.id, x: s[0], y: 0.4, z: s[1], r: 0.2, readyAt: 0 });
          ab.charges--;
        } else if ((bomb && (R.phase === 'prep' || d < 14)) || d < 8) brain.abGoal = { x: s[0], z: s[1], key: 'gadget' + s[0] + ',' + s[1] };
      }
      return;
    }
    switch (ab.id) {
      case 'spark_drone': {
        if (ab.drone) { this.botDrone(brain); return; }
        // Bomb: everyone scouted with prep drones; Glitch's own drone goes out mid-round
        const scout = bomb && attacking && R.phase === 'action' && !tgt && t > (brain.droneAfter || 0) && R.phaseEnd - t < 135 && m.rng() < 0.02;
        if (ab.charges > 0 && (scout || (!tgt && !bomb && m.rng() < 0.01))) {
          if (this.q(a, true) && ab.drone) { ab.drone.path = null; if (!bomb) ab.drone.end = Math.min(ab.drone.end, t + 8); }
        }
        return;
      }
      case 'breach_rounds': {
        if (ab.charges <= 0 || t < ab.nextAt || this.jammed(a.x, a.z, a.team, a.y + 1) || R.frozen(a)) return;
        if (tgt && dist > 6 && dist < 25 && m.rng() < 0.3) { this.aimAt(a, brain, tgt.x, tgt.y + 1, tgt.z); this.q(a, true); return; }
        if (attacking && R.phase === 'action' && !tgt) {
          const p = this.panelNear(a, R.target, 'soft', 14);
          if (p) {
            this.aimAt(a, brain, p.x, 1.1, p.z);
            const h = m.map.raycast(m.eye(a), dirFrom(a.yaw, a.pitch), 16);
            if (h && h.box.panel === p.i) this.q(a, true);      // the wall is in clear view
          }
        }
        return;
      }
      case 'wall_charge': {
        if (!attacking || R.phase !== 'action') return;
        const placed = this.gadgets.find((g) => g.alive && g.type === 'charge' && g.owner === a.id);
        if (placed) {
          // carry on (the rules' goal) and blow it once clear of it, or 3 s after it arms
          if (t >= placed.armAt && !this.off(placed) && (Math.hypot(placed.x - a.x, placed.z - a.z) > 2.5 || t > placed.armAt + 3)) this.blowCharge(placed, a);
          return;
        }
        if (ab.charges <= 0 || tgt) return;
        brain.tried = brain.tried || {};
        const ok = (p) => p && !(brain.tried[p.i] > t);
        let p = this.panelNear(a, R.target, 'reinforced', 30);
        if (!ok(p)) p = this.panelNear(a, R.target, 'soft', 30);
        if (!ok(p)) return;
        const side = this.panelSide(p, a);
        if (Math.hypot(side.x - a.x, side.z - a.z) < 1.2) { this.aimAt(a, brain, p.x, 1.1, p.z); if (!this.q(a, true)) brain.tried[p.i] = t + 30; }
        else {
          if (brain.chargeFor !== p.i) { brain.chargeFor = p.i; brain.chargeSince = t; }
          if (t - brain.chargeSince > 8) { brain.tried[p.i] = t + 30; return; }     // cannot get there: forget it
          brain.abGoal = { x: side.x, z: side.z, key: 'charge' + p.i, push: true };
        }
        return;
      }
      case 'pulse_scanner': {
        if (t < ab.cdUntil || tgt || R.frozen(a)) return;
        if ((attacking && R.phase === 'action' && Math.hypot(R.target.x - a.x, R.target.z - a.z) < 22) || (!bomb && m.rng() < 0.05)) {
          if (bomb) { a.yaw = yawTo(R.target.x - a.x, R.target.z - a.z); brain.aimYaw = a.yaw; }
          this.q(a, true);
        }
        return;
      }
      case 'underbarrel': {
        const close = !!(tgt && dist < 7);
        if (close !== ab.shotgun && (!close || ab.shells > 0)) ab.shotgun = close;
        if (ab.shotgun && close && t - brain.seenAt > brain.S.reaction) { this.aimAt(a, brain, tgt.x, tgt.y + 1.1, tgt.z); this.fireShotgun(a); }
        if (!tgt && attacking && R.phase === 'action' && ab.shells > 0) {
          const p = this.panelNear(a, R.target, 'soft', 4);
          if (p) { this.aimAt(a, brain, p.x, 1, p.z); ab.shotgun = true; this.fireShotgun(a); ab.shotgun = false; }
        }
        return;
      }
      case 'charge_dash': {
        if (tgt && dist < 7 && dist > 1.5 && !ab.holdQ && !ab.dash && !(a.carry && a.carry.type === 'flag')) { a.yaw = yawTo(tgt.x - a.x, tgt.z - a.z); brain.aimYaw = a.yaw; this.q(a, true); }
        return;
      }
    }
  }
  aimAt(a, brain, x, y, z) {
    const e = this.m.eye(a), dx = x - e[0], dz = z - e[2];
    a.yaw = yawTo(dx, dz); a.pitch = Math.atan2(y - e[1], Math.hypot(dx, dz)) / DEG;
    brain.aimYaw = a.yaw; brain.aimPitch = a.pitch;
  }
  // The nearest live panel of a kind at a site (within range of me): { x, z, i, box }.
  panelNear(a, site, kind, range) {
    let best = null, bd = range;
    for (const p of this.m.map.panels) {
      if (!p.alive || p.kind !== kind) continue;
      const b = p.box, x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
      if (site && Math.hypot(x - site.x, z - site.z) > 9) continue;
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < bd) { bd = d; best = { x, z, i: p.i, box: b, alongX: p.alongX }; }
    }
    return best;
  }
  // Where to stand to put a charge on a panel: just outside it, on my side.
  panelSide(p, a) {
    const n = p.alongX ? [0, Math.sign(a.z - p.z) || -1] : [Math.sign(a.x - p.x) || -1, 0];
    return { x: p.x + n[0] * 0.75, z: p.z + n[1] * 0.75 };
  }
  // A bot's drone drives to the target site (or towards an enemy), scanning as it goes.
  botDrone(brain) {
    const m = this.m, a = brain.a, d = a.ab.drone, R = m.rules;
    if (!d || !d.alive) return;
    const goal = R.name === 'Bomb' ? R.target : m.actors.find((e) => e.team !== a.team && e.alive);
    if (!goal) return;
    if (!d.path || m.t > (d.repath || 0)) { d.path = m.map.path(d.x, d.z, goal.x, goal.z, d.fy || 0, goal.y || 0); d.repath = m.t + 3; }
    const wp = d.path && d.path[0];
    if (wp) {
      const dx = wp[0] - d.x, dz = wp[1] - d.z, L = Math.hypot(dx, dz);
      if (L < 0.6) d.path.shift();
      else { const st = Math.min(L, ((a.ab.id === 'spark_drone' ? a.ab.c : this.cfg.spark_drone || {}).speed || 6) / 15); this.roll(d, dx / L * st, dz / L * st, 1 / 15); d.yaw = yawTo(dx, dz); }
    }
    if (m.t >= d.scanAt) this.scan(a);
    if (!wp && Math.hypot(goal.x - d.x, goal.z - d.z) < 3 && m.rng() < 0.1) { this.destroy(d); brain.droneAfter = m.t + 60; }
  }

  /* ---------- HUD ---------- */
  hudText(a) {
    if (!a.ab) return '';
    const ab = a.ab, t = this.m.t;
    if (ab.drone) return 'Drone ' + Math.ceil(ab.drone.end - t) + ' s · Q scan' + (ab.drone.basic ? '' : ' · F zap') + ' · V back' + (this.jammed(ab.drone.x, ab.drone.z, a.team, ab.drone.y) ? ' · JAMMED' : '');
    if (this.plainDrone(a)) return 'Q Drone (prep only) · rolls under doors';
    if (!this.on || !ab.name) return '';
    switch (ab.id) {
      case 'pulse_scanner': return 'Q ' + ab.name + (t < ab.cdUntil ? ' · ' + Math.ceil(ab.cdUntil - t) + ' s' : ' · ready');
      case 'underbarrel': return 'B ' + ab.name + ' · ' + ab.shells + ' shells' + (ab.shotgun ? ' · ON' : '');
      case 'charge_dash': return 'Hold Q ' + ab.name + ' · ' + ab.ready.filter((r) => t >= r).length + '/' + ab.ready.length + (ab.holdQ ? ' · charging' : '');
      case 'wall_charge': { const p = this.gadgets.find((g) => g.alive && g.type === 'charge' && g.owner === a.id); return 'Q ' + ab.name + ' · ' + ab.charges + (p ? (t < p.armAt ? ' · arming' : ' · Q: blow it') : ''); }
      default: return 'Q ' + ab.name + ' · ' + ab.charges;
    }
  }
  cooldown(a) {
    const ab = a.ab, t = this.m.t;
    if (!ab) return 0;
    if (ab.id === 'pulse_scanner' && t < ab.cdUntil) return (ab.cdUntil - t) / (ab.c.cooldown || 10);
    if (ab.id === 'charge_dash') { const r = Math.min(...ab.ready); return r > t ? (r - t) / (ab.c.recharge || 12) : 0; }
    if (ab.id === 'breach_rounds' && t < ab.nextAt) return (ab.nextAt - t) / (ab.c.interval || 1.2);
    return 0;
  }
  ammoText(a) { return this.on && a.ab && a.ab.shotgun ? 'Breacher ' + a.ab.shells + ' / ' + (a.ab.c.shells || 6) : null; }
}
