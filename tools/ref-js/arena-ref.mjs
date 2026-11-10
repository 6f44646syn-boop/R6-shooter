// The JavaScript physics and navigation of Battle's arena as they were before the Rust core
// took them over (milestone 3): copied from js/battle/arena.js with three.js left out. Kept
// as the reference tools/check-core.mjs compares the core against.
//
// Changes from the original, so both sides do the same arithmetic: Math.hypot(a, b) is
// written sqrt(a*a + b*b) (two places) and x ** 2 is written x * x (one place). The body
// radius is a parameter (it was 0.35). Milestone 4 fixed a bug in both: a drop must land on
// the floor actually underneath (it could fall through an upper floor beside furniture).
import { layoutSolids } from '../../js/battle/solids.js';

export const STEP = 0.45, BODY_H = 1.75, VAULT_MAX = 1.5;
const CELL = 0.5, GRID = 2, DROP = 4.2;

export class RefArena {
  // map: an entry of MAPS (js/battle/maps.js); bodyR: the body radius.
  constructor(map, bodyR = 0.35) {
    this.R = bodyR;
    this.hx = map.hx; this.hz = map.hz; this.wallH = map.wallH; this.ceiling = !!map.ceiling;
    this.boxes = layoutSolids(map);
    this.hazards = (map.acid || []).map((a) => ({ minX: a.x - a.w / 2, maxX: a.x + a.w / 2, minZ: a.z - a.d / 2, maxZ: a.z + a.d / 2, dps: a.dps || 34 }));
    this._buildGrid();
    this._buildNav();
  }

  /* ---------- broad phase ---------- */
  _buildGrid() {
    const gx = this.gx = Math.ceil(this.hx * 2 / GRID), gz = this.gz = Math.ceil(this.hz * 2 / GRID);
    this.grid = Array.from({ length: gx * gz }, () => []);
    for (const b of this.boxes) {
      const i0 = this._gi(b.minX - 0.01), i1 = this._gi(b.maxX + 0.01), j0 = this._gj(b.minZ - 0.01), j1 = this._gj(b.maxZ + 0.01);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.grid[j * gx + i].push(b);
    }
    this._stamp = 0;
    this._seen = new Uint32Array(this.boxes.length);
  }
  _gi(x) { return Math.max(0, Math.min(this.gx - 1, Math.floor((x + this.hx) / GRID))); }
  _gj(z) { return Math.max(0, Math.min(this.gz - 1, Math.floor((z + this.hz) / GRID))); }
  // Boxes overlapping the square (x, z) +- r (each once).
  near(x, z, r, out = []) {
    out.length = 0;
    const st = ++this._stamp;
    for (let j = this._gj(z - r); j <= this._gj(z + r); j++) for (let i = this._gi(x - r); i <= this._gi(x + r); i++) {
      for (const b of this.grid[j * this.gx + i]) { if (this._seen[b.i] !== st) { this._seen[b.i] = st; out.push(b); } }
    }
    return out;
  }

  /* ---------- standing and collision ---------- */
  // Does box b block a body whose feet are at y?
  static blocks(b, y) { return b.maxY > y + STEP + 1e-4 && b.minY < y + BODY_H; }
  // Height of what you stand on at (x, z) with feet near y: the floor or a top you can step to.
  groundAt(x, z, y) {
    let g = 0;
    for (const b of this.near(x, z, 0, this._gnear || (this._gnear = []))) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.maxY <= y + STEP + 1e-4 && b.maxY > g) g = b.maxY;
    }
    return g;
  }
  // Push a circle (x, z, radius r, feet at p.y) out of every box that blocks it, and keep it
  // inside the walls.
  resolve(p, r = this.R) {
    const y = p.y || 0;
    for (const b of this.near(p.x, p.z, r + 0.05, this._rnear || (this._rnear = []))) {
      if (!RefArena.blocks(b, y)) continue;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        p.x = cx + dx / d * r; p.z = cz + dz / d * r;
      } else {
        // Centre inside the box: leave by the nearest face.
        const opts = [[p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0], [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1]];
        opts.sort((a, c) => a[0] - c[0]);
        const [, sx, sz] = opts[0];
        if (sx) p.x = sx < 0 ? b.minX - r : b.maxX + r; else p.z = sz < 0 ? b.minZ - r : b.maxZ + r;
      }
    }
    p.x = Math.max(-this.hx + r, Math.min(this.hx - r, p.x));
    p.z = Math.max(-this.hz + r, Math.min(this.hz - r, p.z));
    return p;
  }
  // Damage per second at a fighter's feet (acid), or 0.
  hazardAt(x, y, z) {
    if (y > 0.2) return 0;
    for (const h of this.hazards) if (x > h.minX && x < h.maxX && z > h.minZ && z < h.maxZ) return h.dps;
    return 0;
  }
  // Vault or climb: from feet (x, y, z) facing (dx, dz) (unit). Returns { x, y, z, top } for
  // the landing spot, or null if there is nothing low enough right in front.
  vaultTarget(x, y, z, dx, dz) {
    let best = null;
    const r = this.R;
    for (const b of this.near(x + dx * 0.8, z + dz * 0.8, 1.2, [])) {
      if (!RefArena.blocks(b, y)) continue;
      if (b.maxY - y > VAULT_MAX || b.minY > y + 0.6) continue;
      // Ray from the body centre along the facing direction against the grown footprint.
      let t0 = -Infinity, t1 = Infinity;
      for (const [o, d, lo, hi] of [[x, dx, b.minX - r, b.maxX + r], [z, dz, b.minZ - r, b.maxZ + r]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = Infinity; break; } continue; }
        let a = (lo - o) / d, c = (hi - o) / d;
        if (a > c) { const s = a; a = c; c = s; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      }
      if (!(t0 <= t1) || t0 > 0.75 || t1 < 0) continue;
      if (!best || t0 < best.t0) best = { b, t0, t1 };
    }
    if (!best) return null;
    const { b, t1 } = best, top = b.maxY, tin = Math.max(0, best.t0);
    const thick = t1 - tin - r * 2;
    // Thin cover: over it to the far side. A deep top: climb onto it.
    const tries = thick < 1.3 ? [[t1 + 0.1, null], [tin + r + 0.45, top]] : [[tin + r + 0.45, top]];
    for (const [t, onTop] of tries) {
      const px = x + dx * t, pz = z + dz * t;
      if (Math.abs(px) > this.hx - r || Math.abs(pz) > this.hz - r) continue;
      const gy = this.groundAt(px, pz, onTop !== null ? onTop : top);
      if (onTop !== null && Math.abs(gy - onTop) > 0.05) continue;
      if (onTop === null && gy > top - 0.3) continue;
      const p = this.resolve({ x: px, y: gy, z: pz });
      if (Math.sqrt((p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz)) > 0.08) continue;
      // Headroom over the obstacle while crossing.
      let clear = true;
      for (const c of this.near((x + px) / 2, (z + pz) / 2, 1.4, [])) {
        if (c === b || c.maxY <= top + 0.05 || c.minY > top + 1.2) continue;
        if (this._segBox(x, z, px, pz, c)) { clear = false; break; }
      }
      if (clear) return { x: px, y: gy, z: pz, top };
    }
    return null;
  }
  _segBox(ax, az, bx, bz, b) {
    let t0 = 0, t1 = 1;
    for (const [o, d, lo, hi] of [[ax, bx - ax, b.minX, b.maxX], [az, bz - az, b.minZ, b.maxZ]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) return false;
    }
    return true;
  }

  /* ---------- raycast ---------- */
  // Nearest hit of the ray o + t d (d unit) with solids, walls, floor or ceiling, up to maxT.
  // Fills out = { t, n: [x, y, z] } and returns t (Infinity if nothing). Walks the broad-phase
  // grid along the ray, so far-away boxes cost nothing.
  raycast(o, d, maxT = 200, out = null) {
    let best = maxT, nx = 0, ny = 0, nz = 0;
    const st = ++this._stamp, seen = this._seen, HX = this.hx, HZ = this.hz;
    let ix = this._gi(o[0]), iz = this._gj(o[2]);
    const sx = d[0] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
    const adx = Math.abs(d[0]), adz = Math.abs(d[2]);
    let tMaxX = adx < 1e-12 ? Infinity : ((-HX + (ix + (sx > 0 ? 1 : 0)) * GRID) - o[0]) / d[0];
    let tMaxZ = adz < 1e-12 ? Infinity : ((-HZ + (iz + (sz > 0 ? 1 : 0)) * GRID) - o[2]) / d[2];
    const tdx = adx < 1e-12 ? Infinity : GRID / adx, tdz = adz < 1e-12 ? Infinity : GRID / adz;
    let tEnter = 0;
    while (tEnter < best) {
      for (const b of this.grid[iz * this.gx + ix]) {
        if (seen[b.i] === st) continue;
        seen[b.i] = st;
        let t0 = 0, t1 = best, ax = -1, ok = true;
        for (let a = 0; a < 3; a++) {
          const oo = o[a], dd = d[a];
          const lo = a === 0 ? b.minX : a === 1 ? b.minY : b.minZ, hi = a === 0 ? b.maxX : a === 1 ? b.maxY : b.maxZ;
          if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) { ok = false; break; } continue; }
          let ta = (lo - oo) / dd, tb = (hi - oo) / dd;
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          if (ta > t0) { t0 = ta; ax = a; }
          if (tb < t1) t1 = tb;
          if (t0 > t1) { ok = false; break; }
        }
        if (!ok || ax < 0 || t0 <= 1e-6 || t0 >= best) continue;
        best = t0;
        nx = ny = nz = 0;
        const s = -Math.sign(d[ax]);
        if (ax === 0) nx = s; else if (ax === 1) ny = s; else nz = s;
      }
      if (tMaxX < tMaxZ) { tEnter = tMaxX; tMaxX += tdx; ix += sx; if (ix < 0 || ix >= this.gx) break; }
      else { tEnter = tMaxZ; tMaxZ += tdz; iz += sz; if (iz < 0 || iz >= this.gz) break; }
      if (tEnter === Infinity) break;
    }
    // perimeter walls, floor and ceiling (indoors)
    const planes = this._planes || (this._planes = [[0, -HX, 1], [0, HX, -1], [2, -HZ, 1], [2, HZ, -1], [1, 0, 1]].concat(this.ceiling ? [[1, this.wallH, -1]] : []));
    for (const [a, v, s] of planes) {
      if (Math.abs(d[a]) < 1e-12) continue;
      const t = (v - o[a]) / d[a];
      if (t <= 1e-6 || t >= best || Math.sign(d[a]) === s) continue;
      best = t; nx = ny = nz = 0;
      if (a === 0) nx = s; else if (a === 1) ny = s; else nz = s;
    }
    if (out) { out.t = best; out.n[0] = nx; out.n[1] = ny; out.n[2] = nz; }
    return best >= maxT ? Infinity : best;
  }

  // Clear line between two points (arrays [x, y, z])?
  sightLine(a, b) {
    const d = this._sd || (this._sd = [0, 0, 0]);
    d[0] = b[0] - a[0]; d[1] = b[1] - a[1]; d[2] = b[2] - a[2];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return true;
    d[0] /= L; d[1] /= L; d[2] /= L;
    return this.raycast(a, d, L) === Infinity;
  }

  /* ---------- navigation ---------- */
  // Each grid cell has one node per level you can stand on there (the floor, a box top, a
  // stair tread, a ramp, an upper floor) with room for a body and no hazard. Neighbouring
  // nodes link when you can step up (STEP) or drop down (DROP) between them.
  _buildNav() {
    const nx = this.nx = Math.round(this.hx * 2 / CELL), nz = this.nz = Math.round(this.hz * 2 / CELL);
    const r = this.R + 0.1, list = [];
    const X = [], Z = [], Y = [], cellOf = [];
    this.cellNodes = Array.from({ length: nx * nz }, () => []);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = -this.hx + (i + 0.5) * CELL, z = -this.hz + (j + 0.5) * CELL;
      if (x < -this.hx + r || x > this.hx - r || z < -this.hz + r || z > this.hz - r) continue;
      const near = this.near(x, z, r + 0.05, list).slice();
      const raw = [0];
      for (const b of near) if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY < this.wallH - 1.6) raw.push(b.maxY);
      raw.sort((a, b) => a - b);
      const levels = [];
      for (const y of raw) { if (levels.length && y - levels[levels.length - 1] < 0.12) levels[levels.length - 1] = y; else levels.push(y); }
      for (const y of levels) {
        if (this.hazardAt(x, y, z)) continue;
        if (Math.abs(this.groundAt(x, z, y) - y) > 1e-3) continue;     // something higher is in the way
        let ok = true;
        for (const b of near) {
          if (!RefArena.blocks(b, y)) continue;
          if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) { ok = false; break; }
        }
        if (!ok) continue;
        this.cellNodes[j * nx + i].push(X.length);
        X.push(x); Z.push(z); Y.push(y); cellOf.push(j * nx + i);
      }
    }
    const n = X.length;
    this.nodeX = Float32Array.from(X); this.nodeZ = Float32Array.from(Z); this.nodeY = Float32Array.from(Y); this.nodeCell = Int32Array.from(cellOf);
    this._g = new Float32Array(n); this._from = new Int32Array(n); this._closed = new Uint8Array(n);
    this.nodeCount = n;
  }
  cellOf(x, z) {
    const i = Math.max(0, Math.min(this.nx - 1, Math.floor((x + this.hx) / CELL)));
    const j = Math.max(0, Math.min(this.nz - 1, Math.floor((z + this.hz) / CELL)));
    return j * this.nx + i;
  }
  cellCentre(c) { return [-this.hx + ((c % this.nx) + 0.5) * CELL, -this.hz + (Math.floor(c / this.nx) + 0.5) * CELL]; }
  // The node at (x, z) you would stand on with feet near y (or -1).
  nodeAt(x, z, y = 0) {
    let best = -1, bd = 0.6;
    for (const k of this.cellNodes[this.cellOf(x, z)]) { const d = Math.abs(this.nodeY[k] - y); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  walkable(x, z, y = 0) { return this.nodeAt(x, z, y) >= 0; }
  _nearestNode(x, z, y = 0) {
    const k0 = this.nodeAt(x, z, y);
    if (k0 >= 0) return k0;
    let best = -1, bd = Infinity;
    for (let k = 0; k < this.nodeCount; k++) {
      const dx = this.nodeX[k] - x, dz = this.nodeZ[k] - z, dy = this.nodeY[k] - y, d = dx * dx + dz * dz + 4 * (dy * dy);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  // The node a body moving from height y would stand on in this cell (step up or fall), or -1.
  // A drop needs open space at the starting height (no rail or wall in the way).
  _stepInto(cell, y) {
    let best = -1, by = -Infinity;
    for (const k of this.cellNodes[cell]) { const ny = this.nodeY[k]; if (ny <= y + STEP + 1e-3 && ny > by) { by = ny; best = k; } }
    if (best < 0) return -1;
    if (y - by > STEP + 1e-3) {
      if (y - by > DROP) return -1;
      if (!this._dropOk) this._dropOk = new Map();
      const key = cell * 64 + Math.round(y * 4);
      let ok = this._dropOk.get(key);
      if (ok === undefined) { const [x, z] = this.cellCentre(cell); ok = this._freeAt(x, z, y) && Math.abs(this.groundAt(x, z, y) - by) < 0.13; this._dropOk.set(key, ok); }
      if (!ok) return -1;
    }
    return best;
  }
  // Room for a body at (x, z) with feet at y?
  _freeAt(x, z, y, r = this.R + 0.05) {
    for (const b of this.near(x, z, r + 0.05, this._fnear || (this._fnear = []))) {
      if (!RefArena.blocks(b, y)) continue;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return false;
    }
    return true;
  }
  // Can a body walk straight from a to b (each [x, z, y]), stepping and dropping as it goes?
  clearWalk(a, b) {
    const L = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])), n = Math.max(1, Math.ceil(L / (CELL * 0.25)));
    let y = a[2];
    for (let k = 1; k <= n; k++) {
      const f = k / n, x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
      const nd = this._stepInto(this.cellOf(x, z), y);
      if (nd < 0) return false;
      y = this.nodeY[nd];
    }
    return Math.abs(y - b[2]) < 0.3;
  }
  // A* over the nodes (8 neighbours, no corner cutting), then string-pulled.
  // Returns waypoints [[x, z, y], ...] ending at the goal (or [] if unreachable).
  findPath(ax, az, bx, bz, ay = 0, by = 0) {
    const start = this._nearestNode(ax, az, ay), goal = this._nearestNode(bx, bz, by);
    if (start < 0 || goal < 0) return [];
    const nx = this.nx, NX = this.nodeX, NZ = this.nodeZ, NY = this.nodeY;
    const g = this._g, from = this._from, closed = this._closed;
    g.fill(Infinity); from.fill(-1); closed.fill(0);
    const gx = NX[goal], gz = NZ[goal], gy = NY[goal];
    const heap = [];        // [f, node]
    const push = (f, c) => {
      heap.push([f, c]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    const h = (k) => { const dx = Math.abs(NX[k] - gx), dz = Math.abs(NZ[k] - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + Math.abs(NY[k] - gy); };
    const reach = (cell, y) => { for (const k of this.cellNodes[cell]) { const d = NY[k] - y; if (d <= STEP + 1e-3 && d >= -DROP) return true; } return false; };
    g[start] = 0; push(h(start), start);
    let found = false;
    while (heap.length) {
      const [, c] = pop();
      if (closed[c]) continue;
      if (c === goal) { found = true; break; }
      closed[c] = 1;
      const cell = this.nodeCell[c], ci = cell % nx, cj = Math.floor(cell / nx), cy = NY[c];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= this.nz) continue;
        const k = this._stepInto(j * nx + i, cy);
        if (k < 0 || closed[k]) continue;
        if (di && dj && (!reach(cj * nx + i, cy) || !reach(j * nx + ci, cy))) continue;   // no corner cutting
        const ng = g[c] + (di && dj ? 1.414 : 1) * CELL + Math.max(0, NY[k] - cy) * 0.5;
        if (ng < g[k]) { g[k] = ng; from[k] = c; push(ng + h(k), k); }
      }
    }
    if (!found) return [];
    const nodes = [];
    for (let c = goal; c !== -1; c = from[c]) nodes.push(c);
    nodes.reverse();
    const pts = nodes.map((k) => [NX[k], NZ[k], NY[k]]);
    if (this.nodeAt(bx, bz, by) === goal) pts[pts.length - 1] = [bx, bz, NY[goal]];
    // String pulling: skip waypoints while the straight line stays walkable.
    const out = [];
    let cur = [ax, az, NY[start]], k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = Math.min(pts.length - 1, k + 40); m > k; m--) if (this.clearWalk(cur, pts[m])) { far = m; break; }
      out.push(pts[far]);
      cur = pts[far];
      k = far + 1;
    }
    return out;
  }
}
