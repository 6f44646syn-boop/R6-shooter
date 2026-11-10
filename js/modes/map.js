// A match map built from data/maps/*.json (no three.js: shared by the game, the map builder and
// the headless check). This file reads the map data and keeps the list of solids and breakable
// panels for drawing and game rules; every geometric question (collision, movement, raycasts,
// line of sight, pathfinding) is answered by the Rust core (rust/core, loaded by wasm/core.js).
//
// File format (metres; x right, z towards the "A"/attack side's back is -z... see each map):
//   name, hx, hz (half sizes), wallH
//   walls:      [{ x0, z0, x1, z1, h }]          solid boxes (h: height; low cover < 1.3)
//   soft:       [{ x0, z0, x1, z1 }]             breakable walls (thin, axis aligned)
//   reinforced: [{ x0, z0, x1, z1 }]             only a Wall Charge opens these
//   doors:      [{ x0, z0, x1, z1 }]             boarded doorways: a knife or a few bullets break them
//   (walls may have y0: a box that starts above the floor, such as an upper floor)
//   spawns:     { A: [[x, z, yaw]], B: [...] }   (Bomb maps: attack / defend)
//   flags:      { A: [x, z], B: [x, z] }         flag stands (CTF)
//   sites:      [{ name, x, z, r }]              bomb sites
//   nodes:      [[x, z]], links: [[i, j]]        waypoint graph (made by tools/build-maps.mjs)
//   cover:      [[x, z]]                         cover spots
//   gadgets:    { mine: [[x, z]], jammer: [...], catcher: [...] }  spots for defenders' gadgets
//   callouts:   [{ name, x0, z0, x1, z1 }]
//
// Soft and reinforced walls are split into panels 1.5 m wide. The lower 2.2 m of a panel can
// be destroyed (a hole); the part above stays.
import { core } from '../wasm/core.js?v=9ba226e-mwa4h4pc';

export const PANEL_W = 1.5, HOLE_H = 2.2, BODY_R = 0.32, DOOR_HP = 100, STEP = 0.35, DOOR_GAP = 0.3;

export class MatchMap {
  constructor(data) {
    this.data = data;
    this.id = data.id; this.name = data.name;
    this.hx = data.hx; this.hz = data.hz; this.wallH = data.wallH || 3.2;
    const H = this.wallH;
    this.solids = [];               // everything that blocks (static and panels)
    this.panels = [];               // breakable parts: { box, kind: 'soft'|'reinforced', alive, i }
    const add = (b) => { b.i = this.solids.length; b.alive = true; this.solids.push(b); return b; };
    const T = 0.25;
    for (const w of data.walls) { const y0 = w.y0 || 0, y1 = y0 + (w.h ?? H); add({ minX: Math.min(w.x0, w.x1), maxX: Math.max(w.x0, w.x1), minZ: Math.min(w.z0, w.z1), maxZ: Math.max(w.z0, w.z1), minY: y0, maxY: y1, kind: w.kind || (y0 > 0 ? 'upper' : y1 < 1.4 ? 'low' : 'wall'), look: w.look }); }
    // perimeter
    for (const [x0, z0, x1, z1] of [[-this.hx - 1, -this.hz - 1, this.hx + 1, -this.hz], [-this.hx - 1, this.hz, this.hx + 1, this.hz + 1], [-this.hx - 1, -this.hz, -this.hx, this.hz], [this.hx, -this.hz, this.hx + 1, this.hz]]) {
      add({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: 0, maxY: H + 2, kind: 'edge' });
    }
    for (const kind of ['soft', 'reinforced']) for (const w of data[kind] || []) {
      const alongX = Math.abs(w.x1 - w.x0) >= Math.abs(w.z1 - w.z0);
      const a0 = alongX ? Math.min(w.x0, w.x1) : Math.min(w.z0, w.z1), a1 = alongX ? Math.max(w.x0, w.x1) : Math.max(w.z0, w.z1);
      const c = alongX ? w.z0 : w.x0, n = Math.max(1, Math.round((a1 - a0) / PANEL_W));
      for (let k = 0; k < n; k++) {
        const s0 = a0 + (a1 - a0) * k / n, s1 = a0 + (a1 - a0) * (k + 1) / n;
        const box = alongX ? { minX: s0, maxX: s1, minZ: c - T / 2, maxZ: c + T / 2 } : { minX: c - T / 2, maxX: c + T / 2, minZ: s0, maxZ: s1 };
        const low = add({ ...box, minY: 0, maxY: HOLE_H, kind });
        add({ ...box, minY: HOLE_H, maxY: H, kind: kind + '-top' });
        low.panel = this.panels.length;
        this.panels.push({ box: low, kind, alive: true, i: this.panels.length, alongX });
      }
    }
    // doors: one panel each, the doorway above stays wall
    for (const w of data.doors || []) {
      const alongX = Math.abs(w.x1 - w.x0) >= Math.abs(w.z1 - w.z0), c = alongX ? (w.z0 + w.z1) / 2 : (w.x0 + w.x1) / 2, t = 0.16;
      const box = alongX ? { minX: Math.min(w.x0, w.x1), maxX: Math.max(w.x0, w.x1), minZ: c - t / 2, maxZ: c + t / 2 } : { minX: c - t / 2, maxX: c + t / 2, minZ: Math.min(w.z0, w.z1), maxZ: Math.max(w.z0, w.z1) };
      // a gap under the boards: drones roll through, people cannot
      const low = add({ ...box, minY: DOOR_GAP, maxY: HOLE_H, kind: 'door' });
      if (H > HOLE_H + 0.05) add({ ...box, minZ: box.minZ - (alongX ? 0.08 : 0), maxZ: box.maxZ + (alongX ? 0.08 : 0), minX: box.minX - (alongX ? 0 : 0.08), maxX: box.maxX + (alongX ? 0 : 0.08), minY: HOLE_H, maxY: H, kind: 'wall' });
      low.panel = this.panels.length;
      this.panels.push({ box: low, kind: 'door', alive: true, i: this.panels.length, alongX, hp: DOOR_HP });
    }
    // The Rust core's copy of this map: solids on a grid, and the waypoint graph.
    this.nodes = data.nodes || []; this.links = data.links || [];
    const c = this._c = core(), e = c.e;
    this._w = e.rc_world_new(this.hx, this.hz);
    if (c.reg) c.reg.register(this, this._w, this);
    const chunk = (list, per, write, send) => {
      const max = Math.floor(c.len / per);
      for (let at = 0; at < list.length || at === 0; at += max) {
        const n = Math.min(max, list.length - at), f = c.f;
        for (let k = 0; k < n; k++) write(f, k * per, list[at + k]);
        send(n, at === 0);
        if (!list.length) break;
      }
    };
    chunk(this.solids, 8, (f, o, b) => { f[o] = b.minX; f[o + 1] = b.maxX; f[o + 2] = b.minY; f[o + 3] = b.maxY; f[o + 4] = b.minZ; f[o + 5] = b.maxZ; f[o + 6] = b.kind === 'door' ? 1 : 0; f[o + 7] = b.alive ? 1 : 0; }, (n) => e.rc_world_add_solids(this._w, n));
    e.rc_world_build(this._w);
    chunk(this.nodes, 2, (f, o, n) => { f[o] = n[0]; f[o + 1] = n[1]; }, (n, first) => e.rc_nav_nodes(this._w, n, first ? 1 : 0));
    if (this.links.length) chunk(this.links, 2, (f, o, l) => { f[o] = l[0]; f[o + 1] = l[1]; }, (n) => e.rc_nav_links(this._w, n));
    this.version = 0;               // bumps when a panel breaks (renderer refresh)
  }
  // Free the core's copy (the game calls this when a match ends; otherwise it is freed when
  // this object is garbage collected).
  dispose() {
    if (this._w < 0) return;
    if (this._c.reg) this._c.reg.unregister(this);
    this._c.e.rc_world_free(this._w);
    this._w = -1;
  }

  // The live solids in the grid cells within r of a point.
  near(x, z, r, out = []) {
    out.length = 0;
    const n = this._c.e.rc_near(this._w, x, z, r), f = this._c.f;
    for (let k = 0; k < n; k++) out.push(this.solids[f[k]]);
    return out;
  }

  // Keep a body (circle) out of walls. Low cover blocks movement too.
  // flyer: a drone, low enough to pass under anything that starts above DOOR_GAP.
  resolve(p, r = BODY_R, flyer = false) {
    this._c.e.rc_resolve(this._w, p.x, p.z, r, flyer ? 1 : 0);
    const f = this._c.f;
    p.x = f[0]; p.z = f[1];
    return p;
  }
  // Move a circle by (dx, dz) without ever passing through anything: the core cuts the move
  // into steps shorter than half the radius, each followed by the push-out. (One big step can
  // carry the centre past a thin wall: that was the "drone through the wall" bug.)
  moveCircle(p, dx, dz, r = BODY_R, flyer = false) {
    this._c.e.rc_move(this._w, p.x, p.z, dx, dz, r, flyer ? 1 : 0);
    const f = this._c.f;
    p.x = f[0]; p.z = f[1];
    return p;
  }
  free(x, z, r = BODY_R) { return this._c.e.rc_free(this._w, x, z, r) === 1; }
  // Can a body walk straight from a to b?
  walkClear(ax, az, bx, bz, r = BODY_R + 0.08) { return this._c.e.rc_walk_clear(this._w, ax, az, bx, bz, r) === 1; }

  // Nearest solid hit along a ray (walls and live panels), within maxT.
  // Returns { t, box } (box.ground for the floor) or null.
  raycast(o, d, maxT = 200) {
    const e = this._c.e, t = e.rc_raycast(this._w, o[0], o[1], o[2], d[0], d[1], d[2], maxT);
    if (t < 0) return null;
    const h = e.rc_hit();
    return { t, box: h >= 0 ? this.solids[h] : GROUND };
  }
  sight(a, b) { return this._c.e.rc_sight(this._w, a[0], a[1], a[2], b[0], b[1], b[2]) === 1; }

  /* ---------- breakable panels and doors ---------- */
  // A panel's state lives here (for drawing and rules) and in the core (for collision).
  _setPanel(pn, alive) {
    pn.alive = alive; pn.box.alive = alive;
    this._c.e.rc_set_alive(this._w, pn.box.i, alive ? 1 : 0);
  }
  // Break one panel outright (a wall charge). Returns true if it was whole.
  breakPanel(pn) {
    if (!pn || !pn.alive) return false;
    this._setPanel(pn, false); this.version++;
    return true;
  }
  // Break panels: the panel hit (and others whose centre is within r of point p), if allowed.
  breakAt(p, r, allowReinforced = false) {
    const out = [];
    for (const pn of this.panels) {
      if (!pn.alive || (pn.kind === 'reinforced' && !allowReinforced)) continue;
      const b = pn.box, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      if (Math.hypot(cx - p[0], cz - p[2]) <= r + 0.75 && p[1] < HOLE_H + 0.5) { this._setPanel(pn, false); out.push(pn.i); }
    }
    if (out.length) this.version++;
    return out;
  }
  // Every breakable panel whole again (a new Bomb round).
  resetPanels() { for (const p of this.panels) { this._setPanel(p, true); if (p.kind === 'door') p.hp = DOOR_HP; } this.version++; }
  // Damage a door (bullets, a knife). Returns true if it broke.
  hurtDoor(pn, dmg) {
    if (!pn || pn.kind !== 'door' || !pn.alive) return false;
    pn.hp -= dmg;
    if (pn.hp > 0) return false;
    this._setPanel(pn, false); this.version++;
    return true;
  }
  // The first whole door a body walking from a to b would bump into (or null).
  doorOn(ax, az, bx, bz, r = BODY_R) {
    const k = this._c.e.rc_door_on(this._w, ax, az, bx, bz, r);
    return k < 0 ? null : this.panels[this.solids[k].panel];
  }
  callout(x, z) {
    for (const c of this.data.callouts || []) if (x >= Math.min(c.x0, c.x1) && x <= Math.max(c.x0, c.x1) && z >= Math.min(c.z0, c.z1) && z <= Math.max(c.z0, c.z1)) return c.name;
    return '';
  }

  /* ---------- waypoint navigation ---------- */
  // With needSight: the nearest waypoint within 8 m it can walk straight to; else the nearest.
  nearestNode(x, z, needSight = true) { return this._c.e.rc_nearest_node(this._w, x, z, needSight ? 1 : 0); }
  // A* from (ax, az) to (bx, bz); returns [[x, z], ...] smoothed (string pulled), or [].
  path(ax, az, bx, bz) {
    const n = this._c.e.rc_path(this._w, ax, az, bx, bz), f = this._c.f, out = new Array(n);
    for (let k = 0; k < n; k++) out[k] = [f[k * 2], f[k * 2 + 1]];
    return out;
  }
}
const GROUND = { ground: true };
