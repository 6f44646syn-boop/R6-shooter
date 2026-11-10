// A match map built from data/maps/*.json (no three.js: shared by the game, the map builder and
// the headless check). This file reads the map data and keeps the list of solids and breakable
// panels for drawing and game rules; every geometric question (collision, movement, stairs,
// falling, vaulting, raycasts, line of sight, pathfinding) is answered by the Rust core
// (rust/core, through js/wasm/world.js): the same code Battle uses. Heights are the height of
// the feet (y); the ground floor is 0.
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
//   nodes:      [[x, z, y]]                      places a body can stand, about 2 m apart, all
//                                                reachable from the spawns (tools/build-maps.mjs)
//   open: true                                   open sky (no limit on how high you can stand)
//   ceil:       height of a ceiling that stops bullets and grenades (indoor maps)
//   hazards:    [{ minX, maxX, minZ, maxZ }]     floor that hurts (paths avoid it)
//   cover:      [[x, z]]                         cover spots
//   gadgets:    { mine: [[x, z]], jammer: [...], catcher: [...] }  spots for defenders' gadgets
//   callouts:   [{ name, x0, z0, x1, z1 }]
//
// Soft and reinforced walls are split into panels 1.5 m wide. The lower 2.2 m of a panel can
// be destroyed (a hole); the part above stays.
import { CoreWorld, BODY_R, STEP, DOOR_GAP, KIND } from '../wasm/world.js?v=e1f5a8d-mwah3s7c';

export const PANEL_W = 1.5, HOLE_H = 2.2, DOOR_HP = 100;
export { BODY_R, STEP, DOOR_GAP };

export class MatchMap {
  constructor(data) {
    this.data = data;
    this.id = data.id; this.name = data.name;
    this.hx = data.hx; this.hz = data.hz; this.wallH = data.wallH || 3.2;
    const H = this.wallH;
    this.solids = [];               // everything that blocks (static and panels)
    this.panels = [];               // breakable parts: { box, kind: 'soft'|'reinforced'|'door', alive, i }
    const add = (b) => { b.i = this.solids.length; b.alive = true; this.solids.push(b); return b; };
    const T = 0.25;
    for (const w of data.walls) { const y0 = w.y0 || 0, y1 = y0 + (w.h ?? H); add({ minX: Math.min(w.x0, w.x1), maxX: Math.max(w.x0, w.x1), minZ: Math.min(w.z0, w.z1), maxZ: Math.max(w.z0, w.z1), minY: y0, maxY: y1, kind: w.kind || (y0 > 0 ? 'upper' : y1 < 1.4 ? 'low' : 'wall'), look: w.look }); }
    // perimeter (far taller than anything thrown)
    for (const [x0, z0, x1, z1] of [[-this.hx - 1, -this.hz - 1, this.hx + 1, -this.hz], [-this.hx - 1, this.hz, this.hx + 1, this.hz + 1], [-this.hx - 1, -this.hz, -this.hx, this.hz], [this.hx, -this.hz, this.hx + 1, this.hz]]) {
      add({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: 0, maxY: 1e4, kind: 'edge' });
    }
    for (const kind of ['soft', 'reinforced']) for (const w of data[kind] || []) {
      const alongX = Math.abs(w.x1 - w.x0) >= Math.abs(w.z1 - w.z0);
      const a0 = alongX ? Math.min(w.x0, w.x1) : Math.min(w.z0, w.z1), a1 = alongX ? Math.max(w.x0, w.x1) : Math.max(w.z0, w.z1);
      const c = alongX ? w.z0 : w.x0, n = Math.max(1, Math.round((a1 - a0) / PANEL_W));
      for (let k = 0; k < n; k++) {
        const s0 = a0 + (a1 - a0) * k / n, s1 = a0 + (a1 - a0) * (k + 1) / n;
        const box = alongX ? { minX: s0, maxX: s1, minZ: c - T / 2, maxZ: c + T / 2 } : { minX: c - T / 2, maxX: c + T / 2, minZ: s0, maxZ: s1 };
        const low = add({ ...box, minY: 0, maxY: HOLE_H, kind, code: KIND.panel });
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
      const low = add({ ...box, minY: DOOR_GAP, maxY: HOLE_H, kind: 'door', code: KIND.door });
      if (H > HOLE_H + 0.05) add({ ...box, minZ: box.minZ - (alongX ? 0.08 : 0), maxZ: box.maxZ + (alongX ? 0.08 : 0), minX: box.minX - (alongX ? 0 : 0.08), maxX: box.maxX + (alongX ? 0 : 0.08), minY: HOLE_H, maxY: H, kind: 'wall' });
      low.panel = this.panels.length;
      this.panels.push({ box: low, kind: 'door', alive: true, i: this.panels.length, alongX, hp: DOOR_HP });
    }
    // The Rust core's copy of this map: solids on a grid, and the path nodes on every level.
    // (nav: false skips the nodes: the map builder's first pass, which only asks about walls.)
    this.world = new CoreWorld({ hx: this.hx, hz: this.hz, wallH: data.open ? Infinity : H, ceil: data.ceil || 0, solids: this.solids, hazards: data.hazards || [], nav: data.nav !== false });
    this.nodes = data.nodes || [];  // places to go: [x, z, y]
    const zone = data.inside && data.inside.length ? data.inside : data.building ? [data.building] : null;
    this.hasZone = !!zone && data.nav !== false;
    if (this.hasZone) this.world.setZone(zone);
    this.version = 0;               // bumps when a panel breaks (renderer refresh)
  }
  // Free the core's copy (the game calls this when a match ends; otherwise it is freed when
  // this object is garbage collected).
  dispose() { this.world.dispose(); }

  // The live solids in the grid cells within r of a point.
  near(x, z, r, out = []) {
    const idx = this.world.near(x, z, r, this._ni || (this._ni = []));
    out.length = 0;
    for (const k of idx) out.push(this.solids[k]);
    return out;
  }

  /* ---------- standing and moving (p: { x, y, z }; y is the height of the feet) ---------- */
  // Height of what is underfoot at (x, z) for feet near y: the floor, a stair, an upper floor.
  groundAt(x, z, y = 0, flyer = false) { return this.world.groundAt(x, z, y, flyer); }
  // Keep a body (circle) out of walls. Low cover blocks movement too.
  // flyer: a drone, low enough to pass under anything that starts above DOOR_GAP.
  resolve(p, r = BODY_R, flyer = false) { return this.world.resolve(p, r, flyer); }
  // Move a circle by (dx, dz) without ever passing through anything: the core cuts the move
  // into steps shorter than half the radius, each followed by the push-out (one big step can
  // carry the centre past a thin wall: that was the "drone through the wall" bug), and lifts
  // p.y onto stairs and ramps as it goes.
  moveCircle(p, dx, dz, r = BODY_R, flyer = false) { return this.world.move(p, dx, dz, r, flyer); }
  // One step of a body p { x, y, z, vy }: moveCircle, then stand on what is underneath or
  // fall. Returns true while it is on the ground.
  stepBody(p, dx, dz, dt, r = BODY_R, flyer = false) { return this.world.stepBody(p, dx, dz, dt, r, flyer); }
  free(x, z, r = BODY_R, y = 0) { return this.world.free(x, z, r, y); }
  // Nothing in the way of a body sliding straight from a to b at height y?
  walkClear(ax, az, bx, bz, r = BODY_R + 0.08, y = 0) { return this.world.walkClear(ax, az, bx, bz, r, y); }
  // Vault over low cover or climb onto a ledge up to 1.5 m: { x, y, z, top } to land on, or null.
  vaultTarget(x, y, z, dx, dz) { return this.world.vaultTarget(x, y, z, dx, dz, BODY_R); }

  // Nearest solid hit along a ray (walls and live panels), within maxT.
  // Returns { t, box } (box.ground for the floor or a ceiling) or null.
  raycast(o, d, maxT = 200) {
    const w = this.world, t = w.raycast(o, d, maxT);
    if (t < 0) return null;
    return { t, box: w.hit >= 0 ? this.solids[w.hit] : w.hit === -3 ? CEILING : GROUND, axis: w.axis };
  }
  sight(a, b) { return this.world.sight(a, b); }

  /* ---------- breakable panels and doors ---------- */
  // A panel's state lives here (for drawing and rules) and in the core (for collision and paths).
  _setPanel(pn, alive) {
    pn.alive = alive; pn.box.alive = alive;
    this.world.setAlive(pn.box.i, alive);
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
      if (Math.hypot(cx - p[0], cz - p[2]) <= r + 0.75 && p[1] < b.maxY + 0.5 && p[1] > b.minY - 1) { this._setPanel(pn, false); out.push(pn.i); }
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
  // The first whole door a body walking from a to b (feet at y) would bump into (or null).
  doorOn(ax, az, bx, bz, r = BODY_R, y = 0) {
    const k = this.world.doorOn(ax, az, bx, bz, r, y);
    return k < 0 ? null : this.panels[this.solids[k].panel];
  }
  // Damage per second of the floor at a body's feet (acid pools), or 0.
  hazardAt(x, y, z) {
    if (y > 0.2) return 0;
    for (const h of this.data.hazards || []) if (x > h.minX && x < h.maxX && z > h.minZ && z < h.maxZ) return h.dps || 34;
    return 0;
  }
  callout(x, z) {
    for (const c of this.data.callouts || []) if (x >= Math.min(c.x0, c.x1) && x <= Math.max(c.x0, c.x1) && z >= Math.min(c.z0, c.z1) && z <= Math.max(c.z0, c.z1)) return c.name;
    return '';
  }

  /* ---------- navigation (every level) ---------- */
  // The nearest spot a body can stand on to (x, z, y), on the same side of any wall: [x, z, y] or null.
  nearestSpot(x, z, y = 0) {
    const k = this.world.nearestNode(x, z, y);
    if (k < 0) return null;
    const n = this._nav || (this._nav = this.world.navNodes());
    return [n.x[k], n.z[k], n.y[k]];
  }
  // Is there a spot to stand on at (x, z) near height y?
  standable(x, z, y = 0) { return this.world.nodeAt(x, z, y) >= 0; }
  // Can a body walk straight from a to b (each [x, z, y]), stepping up and dropping as it goes?
  clearWalk(a, b) { return this.world.clearWalk(a, b); }
  // A* from a to b over every level (stairs, ramps, drops), smoothed: [[x, z, y], ...] ending
  // at b, or [] if there is no way. Boarded doors count as open; standing soft walls do not.
  // inside: only through the building (Bomb's defenders: data.inside).
  path(ax, az, bx, bz, ay = 0, by = 0, inside = false) { return this.world.path(ax, az, ay, bx, bz, by, inside && this.hasZone); }
}
const GROUND = { ground: true }, CEILING = { ground: true, ceiling: true };
