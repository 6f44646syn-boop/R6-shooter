// A match map built from data/maps/*.json (no three.js: shared by the game, the map builder and
// the headless check).
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
import { rayBox, pushCircleBox, circleHitsBox, segHitsBox } from './geom.js?v=a1880ea-mw7geivu';

export const PANEL_W = 1.5, HOLE_H = 2.2, BODY_R = 0.32, DOOR_HP = 100, STEP = 0.35, DOOR_GAP = 0.3;
// Blocks a body at floor level (not a box overhead, not a tiny ledge you step over).
const blocks = (b) => b.minY < 1.7 && b.maxY > STEP;
const GRID = 2;

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
    this._grid();
    this.nodes = data.nodes || []; this.links = data.links || [];
    this.adj = this.nodes.map(() => []);
    for (const [a, b] of this.links) { this.adj[a].push(b); this.adj[b].push(a); }
    this._g = new Float32Array(this.nodes.length); this._from = new Int32Array(this.nodes.length); this._closed = new Uint8Array(this.nodes.length);
    this.version = 0;               // bumps when a panel breaks (renderer refresh)
  }

  _grid() {
    this.gx = Math.ceil((this.hx * 2 + 4) / GRID); this.gz = Math.ceil((this.hz * 2 + 4) / GRID);
    this.cells = Array.from({ length: this.gx * this.gz }, () => []);
    for (const b of this.solids) for (let j = this._cj(b.minZ); j <= this._cj(b.maxZ); j++) for (let i = this._ci(b.minX); i <= this._ci(b.maxX); i++) this.cells[j * this.gx + i].push(b);
    this._seen = new Uint32Array(this.solids.length); this._stamp = 0;
  }
  _ci(x) { return Math.max(0, Math.min(this.gx - 1, Math.floor((x + this.hx + 2) / GRID))); }
  _cj(z) { return Math.max(0, Math.min(this.gz - 1, Math.floor((z + this.hz + 2) / GRID))); }
  near(x, z, r, out) {
    out.length = 0;
    const st = ++this._stamp;
    for (let j = this._cj(z - r); j <= this._cj(z + r); j++) for (let i = this._ci(x - r); i <= this._ci(x + r); i++) {
      for (const b of this.cells[j * this.gx + i]) if (b.alive && this._seen[b.i] !== st) { this._seen[b.i] = st; out.push(b); }
    }
    return out;
  }

  // Keep a body (circle) out of walls. Low cover blocks movement too (vault not in modes).
  // flyer: a drone, low enough to pass under anything that starts above DOOR_GAP.
  resolve(p, r = BODY_R, flyer = false) {
    const list = this.near(p.x, p.z, r + 0.1, this._rl || (this._rl = []));
    for (let k = 0; k < 2; k++) for (const b of list) if (flyer ? b.minY < DOOR_GAP - 0.05 && b.maxY > 0.05 : blocks(b)) pushCircleBox(p, r, b);
    return p;
  }
  free(x, z, r = BODY_R) {
    for (const b of this.near(x, z, r + 0.1, this._fl || (this._fl = []))) if (blocks(b) && circleHitsBox(x, z, r, b)) return false;
    return Math.abs(x) < this.hx - r && Math.abs(z) < this.hz - r;
  }
  // Can a body walk straight from a to b?
  walkClear(ax, az, bx, bz, r = BODY_R + 0.08) {
    const minX = Math.min(ax, bx) - r, maxX = Math.max(ax, bx) + r, minZ = Math.min(az, bz) - r, maxZ = Math.max(az, bz) + r;
    const list = this.near((minX + maxX) / 2, (minZ + maxZ) / 2, Math.max(maxX - minX, maxZ - minZ) / 2 + 0.1, this._wl || (this._wl = []));
    for (const b of list) if (blocks(b) && segHitsBox(ax, az, bx, bz, b, r - 0.02)) return false;
    return true;
  }

  // Nearest solid hit along a ray (walls and live panels), within maxT.
  // Returns { t, box } or null. Walks the grid cells the ray crosses.
  raycast(o, d, maxT = 200) {
    let best = maxT, hit = null;
    const st = ++this._stamp, seen = this._seen;
    let i = this._ci(o[0]), j = this._cj(o[2]);
    const sx = d[0] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
    const ox0 = -this.hx - 2, oz0 = -this.hz - 2;
    let tx = Math.abs(d[0]) < 1e-12 ? Infinity : ((ox0 + (i + (sx > 0 ? 1 : 0)) * GRID) - o[0]) / d[0];
    let tz = Math.abs(d[2]) < 1e-12 ? Infinity : ((oz0 + (j + (sz > 0 ? 1 : 0)) * GRID) - o[2]) / d[2];
    const dx = Math.abs(d[0]) < 1e-12 ? Infinity : GRID / Math.abs(d[0]), dz = Math.abs(d[2]) < 1e-12 ? Infinity : GRID / Math.abs(d[2]);
    let enter = 0;
    while (enter < best) {
      for (const b of this.cells[j * this.gx + i]) {
        if (!b.alive || seen[b.i] === st) continue;
        seen[b.i] = st;
        const t = rayBox(o, d, b, best);
        if (t < best) { best = t; hit = b; }
      }
      if (tx < tz) { enter = tx; tx += dx; i += sx; if (i < 0 || i >= this.gx) break; }
      else { enter = tz; tz += dz; j += sz; if (j < 0 || j >= this.gz) break; }
    }
    // the ground
    if (d[1] < -1e-9) { const t = -o[1] / d[1]; if (t > 0 && t < best) { best = t; hit = { ground: true }; } }
    return hit ? { t: best, box: hit } : null;
  }
  sight(a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return true;
    d[0] /= L; d[1] /= L; d[2] /= L;
    const h = this.raycast(a, d, L);
    return !h || h.box.ground;
  }
  // Break panels: the panel hit (and others whose centre is within r of point p), if allowed.
  breakAt(p, r, allowReinforced = false) {
    const out = [];
    for (const pn of this.panels) {
      if (!pn.alive || (pn.kind === 'reinforced' && !allowReinforced)) continue;
      const b = pn.box, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      if (Math.hypot(cx - p[0], cz - p[2]) <= r + 0.75 && p[1] < HOLE_H + 0.5) { pn.alive = false; b.alive = false; out.push(pn.i); }
    }
    if (out.length) this.version++;
    return out;
  }
  // Every breakable panel whole again (a new Bomb round).
  resetPanels() { for (const p of this.panels) { p.alive = true; p.box.alive = true; if (p.kind === 'door') p.hp = DOOR_HP; } this.version++; }
  // Damage a door (bullets, a knife). Returns true if it broke.
  hurtDoor(pn, dmg) {
    if (!pn || pn.kind !== 'door' || !pn.alive) return false;
    pn.hp -= dmg;
    if (pn.hp > 0) return false;
    pn.alive = false; pn.box.alive = false; this.version++;
    return true;
  }
  // The first whole door a body walking from a to b would bump into (or null).
  doorOn(ax, az, bx, bz, r = BODY_R) {
    let best = null, bd = Infinity;
    for (const pn of this.panels) {
      if (pn.kind !== 'door' || !pn.alive) continue;
      const b = pn.box;
      if (!segHitsBox(ax, az, bx, bz, b, r)) continue;
      const d = Math.hypot((b.minX + b.maxX) / 2 - ax, (b.minZ + b.maxZ) / 2 - az);
      if (d < bd) { bd = d; best = pn; }
    }
    return best;
  }
  callout(x, z) {
    for (const c of this.data.callouts || []) if (x >= Math.min(c.x0, c.x1) && x <= Math.max(c.x0, c.x1) && z >= Math.min(c.z0, c.z1) && z <= Math.max(c.z0, c.z1)) return c.name;
    return '';
  }

  /* ---------- waypoint navigation ---------- */
  nearestNode(x, z, needSight = true) {
    let best = -1, bd = Infinity;
    for (let k = 0; k < this.nodes.length; k++) {
      const n = this.nodes[k], d = (n[0] - x) ** 2 + (n[1] - z) ** 2;
      if (d < bd && (!needSight || d > 64 || this.walkClear(x, z, n[0], n[1], BODY_R * 0.9))) { bd = d; best = k; }
    }
    if (best < 0 && needSight) return this.nearestNode(x, z, false);
    return best;
  }
  // A* from (ax, az) to (bx, bz); returns [[x, z], ...] smoothed (string pulled), or [].
  path(ax, az, bx, bz) {
    const s = this.nearestNode(ax, az), g = this.nearestNode(bx, bz);
    if (s < 0 || g < 0) return [];
    const N = this.nodes, G = this._g, F = this._from, C = this._closed;
    G.fill(Infinity); F.fill(-1); C.fill(0);
    const heap = [];
    const push = (f, c) => { heap.push([f, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = (k) => Math.hypot(N[k][0] - N[g][0], N[k][1] - N[g][1]);
    G[s] = 0; push(h(s), s);
    let found = false;
    while (heap.length) {
      const [, c] = pop();
      if (C[c]) continue;
      if (c === g) { found = true; break; }
      C[c] = 1;
      for (const k of this.adj[c]) {
        if (C[k]) continue;
        const ng = G[c] + Math.hypot(N[k][0] - N[c][0], N[k][1] - N[c][1]);
        if (ng < G[k]) { G[k] = ng; F[k] = c; push(ng + h(k), k); }
      }
    }
    if (!found) return [];
    const pts = [];
    for (let c = g; c !== -1; c = F[c]) pts.push([N[c][0], N[c][1]]);
    pts.reverse();
    if (this.free(bx, bz)) pts.push([bx, bz]);
    // string pulling
    const out = [];
    let cur = [ax, az], k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = Math.min(pts.length - 1, k + 12); m > k; m--) if (this.walkClear(cur[0], cur[1], pts[m][0], pts[m][1])) { far = m; break; }
      out.push(pts[far]); cur = pts[far]; k = far + 1;
    }
    return out;
  }
}
