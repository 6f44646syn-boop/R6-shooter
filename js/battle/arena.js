// Battle arena: an original walled yard with cover (shipping containers, stacked crates,
// tall and low walls, concrete barriers). Point-symmetric so both spawn sides are equal.
//
// Provides the scene, movement collision (circle vs boxes), bullet and sight-line raycasts,
// a navigation grid with A* for the bots, cover spots and spawn points.
//
// Coordinates: metres, x right, y up, z towards the "A" side. Same yaw convention as the
// range: yaw 0 looks along -z, positive turns right.
import * as THREE from '../../vendor/three/three.module.min.js?v=2156b86-mw4poxh9';
import { MAPS } from './maps.js?v=2156b86-mw4poxh9';
// (textures for each map live in maps.js)
import { concreteTiles } from '../scene/range-tex.js?v=2156b86-mw4poxh9';
import { mergeStatic, makeEnvMap } from '../scene/sight-model.js?v=2156b86-mw4poxh9';
import { flatMaterial } from '../scene/low.js?v=2156b86-mw4poxh9';
import { BulletHoles } from '../scene/holes.js?v=2156b86-mw4poxh9';
import { mulberry32 } from '../core/prng.js?v=2156b86-mw4poxh9';

export const HALF_X = 18, HALF_Z = 14, WALL_H = 4.5;   // the Container Yard (other maps differ)
const CELL = 0.5;                // nav grid cell (m)
const BODY_R = 0.35;             // fighter radius for collision

// Box with UVs in world metres / tile, so textures keep their scale on any size.
function boxGeo(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // +x -x +y -y +z -z
  for (let i = 0; i < uv.count; i++) {
    const [fw, fh] = faces[Math.floor(i / 4)];
    uv.setXY(i, uv.getX(i) * fw / tile, uv.getY(i) * fh / tile);
  }
  return g;
}

export class Arena {
  // mapId: a key of MAPS (maps.js).
  constructor(mapId = 'yard') {
    const map = this.map = MAPS[mapId] || MAPS.yard;
    this.mapId = MAPS[mapId] ? mapId : 'yard';
    this.hx = map.hx; this.hz = map.hz; this.wallH = map.wallH;
    const HX = this.hx, HZ = this.hz, WH = this.wallH;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(map.background);
    scene.fog = new THREE.Fog(...map.fog);
    this.quality = null;
    this._tiers = { low: new Map(), high: new Map() };
    this._spec = new Map();     // standard material -> () => high material
    const L = (lo, hi) => { if (hi) this._spec.set(lo, hi); return lo; };
    const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 1, ...o });
    // Material from a spec { map (texture or function), color, rough, metal, emissive, emissiveMap, basic }.
    const matCache = new Map();
    const material = (m) => {
      if (m.emissive !== undefined || m.emissiveMap) return new THREE.MeshBasicMaterial({ color: m.emissive ?? 0xffffff, map: m.emissiveMap || null, toneMapped: false });
      const map = typeof m.map === 'function' ? m.map() : m.map || null;
      if (m.basic) return new THREE.MeshBasicMaterial({ map, color: m.color ?? 0xffffff });
      const key = (map ? map.uuid : '-') + '|' + (m.color ?? 0xffffff) + '|' + (m.rough ?? 0.8) + '|' + (m.metal ?? 0);
      if (!matCache.has(key)) {
        matCache.set(key, L(new THREE.MeshLambertMaterial({ map, color: m.color ?? 0xffffff }),
          () => std({ map, color: m.color ?? 0xffffff, roughness: m.rough ?? 0.8, metalness: m.metal ?? 0 })));
      }
      return matCache.get(key);
    };

    /* lights */
    this.hemi = new THREE.HemisphereLight(map.hemi[0], map.hemi[1], map.hemi[2]);
    scene.add(this.hemi);
    const key = new THREE.DirectionalLight(map.key[0], map.key[1]);
    key.position.set(...map.key[2]);
    key.target.position.set(0, 0, 0);
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 70 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
    scene.add(key, key.target);
    this.key = key;
    this._lights = { hemi: map.hemi[2], key: map.key[1] };

    /* sky */
    if (map.sky) {
      const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), new THREE.MeshBasicMaterial({ map: map.sky(), side: THREE.BackSide, fog: false, depthWrite: false }));
      sky.renderOrder = -1;
      scene.add(sky);
    }

    /* floor */
    const fl = map.floor();
    const roughTex = fl.rough && fl.rough.isTexture ? fl.rough : null;
    for (const t of [fl.map, fl.normal, roughTex]) if (t) t.repeat.set(HX * 2 / (fl.tile || 2), HZ * 2 / (fl.tile || 2));
    const floorMat = L(new THREE.MeshLambertMaterial({ map: fl.map, color: fl.color ?? 0xffffff }),
      () => std({ map: fl.map, color: fl.color ?? 0xffffff, normalMap: fl.normal || null, roughnessMap: roughTex, roughness: roughTex ? 1 : (typeof fl.rough === 'number' ? fl.rough : 0.9), metalness: 0 }));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    /* perimeter walls (and a ceiling indoors) */
    const wl = map.wall();
    const wallMat = L(new THREE.MeshLambertMaterial({ map: wl.map }), () => std({ map: wl.map, normalMap: wl.normal || null, roughness: wl.rough ?? 0.7, metalness: wl.metal ?? 0 }));
    const walls = new THREE.Group();
    for (const [w, x, z, ry] of [[HX * 2, 0, -HZ, 0], [HX * 2, 0, HZ, Math.PI], [HZ * 2, -HX, 0, Math.PI / 2], [HZ * 2, HX, 0, -Math.PI / 2]]) {
      const g = new THREE.PlaneGeometry(w, WH);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / wl.tileW, uv.getY(i) * WH / wl.tileH);
      const m = new THREE.Mesh(g, wallMat);
      m.position.set(x, WH / 2, z); m.rotation.y = ry;
      walls.add(m);
    }
    mergeStatic(walls);
    walls.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(walls);

    /* decoration helpers (nothing here blocks movement or bullets) */
    const decor = new THREE.Group();
    const add = (geo, m, x, y, z) => { const mesh = new THREE.Mesh(geo, material(m)); mesh.position.set(x, y, z); decor.add(mesh); return mesh; };
    const ctx = {
      box: (m, w, h, d, x, y, z) => add(boxGeo(w, h, d, m.tile || 1), m, x, y, z),
      plane: (m, w, h, x, y, z, ry = 0) => { const p = add(new THREE.PlaneGeometry(w, h), m, x, y, z); p.rotation.y = ry; return p; },
      cone: (m, r, h, x, y, z, rx = 0) => { const c = add(new THREE.ConeGeometry(r, h, 10), m, x, y, z); c.rotation.x = rx; return c; },
      cylinder: (m, r, h, x, y, z) => add(new THREE.CylinderGeometry(r, r, h, 20), m, x, y, z),
    };
    if (map.ceiling) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), material({ color: map.ceiling.color, rough: 0.9 }));
      c.rotation.x = Math.PI / 2; c.position.y = WH;
      c.receiveShadow = true;                     // never casts: the light comes in from above
      scene.add(c);
      if (map.ceiling.lights) for (let x = -HX + 3; x < HX; x += 6) for (let z = -HZ + 3; z < HZ; z += 6) ctx.box({ emissive: map.ceiling.lights }, 1.8, 0.04, 0.5, x, WH - 0.03, z);
    }

    /* cover */
    this.boxes = [];
    const cover = new THREE.Group();
    const addCover = (b) => {
      this.boxes.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h, kind: b.kind });
      const k = map.kinds[b.kind] || {};
      const m = new THREE.Mesh(boxGeo(b.w, b.h, b.d, k.tile || 1), material({ ...k, color: b.color ?? k.color }));
      m.position.set(b.x, b.h / 2, b.z);
      cover.add(m);
      if (k.decor) k.decor(ctx, b);
    };
    for (const b of map.layout) {
      addCover(b);
      if (b.mirror !== false) addCover({ ...b, x: -b.x, z: -b.z });
    }
    if (map.extra) map.extra(ctx, map);
    if (map.outside) map.outside(ctx, map);
    mergeStatic(cover);
    cover.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(cover);
    mergeStatic(decor);
    decor.traverse((o) => { if (o.isMesh) { o.castShadow = !o.material.isMeshBasicMaterial; o.receiveShadow = true; } });
    scene.add(decor);

    /* falling snow */
    this.snow = null;
    if (map.snow) {
      const n = 1600, pos = new Float32Array(n * 3), rng = mulberry32(5);
      for (let i = 0; i < n; i++) { pos[i * 3] = (rng() - 0.5) * HX * 2.4; pos[i * 3 + 1] = rng() * 9; pos[i * 3 + 2] = (rng() - 0.5) * HZ * 2.4; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false }));
      this.snow.frustumCulled = false;
      scene.add(this.snow);
    }

    this.holes = new BulletHoles(scene);
    this.holes.setSize(0.03);

    scene.traverse((o) => { if (o.isMesh && o.parent === scene) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    this.spawns = { A: map.spawns, B: map.spawns.map(([x, z]) => [-x, -z]) };
    this._buildNav();
    this._buildCover();
  }

  // Per-frame animation (falling snow).
  update(dt, t) {
    if (!this.snow) return;
    const a = this.snow.geometry.attributes.position, p = a.array;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] -= dt * 0.9;
      p[i] += Math.sin(t * 0.7 + i) * dt * 0.15;
      if (p[i + 1] < 0) p[i + 1] += 9;
    }
    a.needsUpdate = true;
  }

  /* ---------- graphics quality ---------- */
  setGraphics(q, renderer) {
    if (!['low', 'high', 'ultra'].includes(q)) q = 'standard';
    const tier = q === 'low' ? 'low' : (q === 'high' || q === 'ultra') ? 'high' : null;
    if (tier === 'low' && !this._tiers.low.size) {
      this.scene.traverse((o) => { if (o.isMesh) { const lo = o.userData.loMat || o.material; const f = flatMaterial(lo); if (f) this._tiers.low.set(lo, f); } });
    }
    if (tier === 'high' && !this._tiers.high.size) {
      this.env = this.env || makeEnvMap(renderer);
      for (const [lo, make] of this._spec) this._tiers.high.set(lo, make());
    }
    const map = tier ? this._tiers[tier] : null;
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      const lo = o.userData.loMat || o.material;
      o.userData.loMat = lo;
      o.material = (map && map.get(lo)) || lo;
    });
    const high = tier === 'high';
    this.key.visible = q !== 'low';
    this.key.castShadow = high;
    const ks = q === 'ultra' ? 4096 : 2048;
    if (this.key.shadow.mapSize.x !== ks) { this.key.shadow.mapSize.set(ks, ks); if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; } }
    this.hemi.intensity = this._lights.hemi * (high ? 0.6 : q === 'low' ? 1.45 : 1);
    this.key.intensity = this._lights.key * (high ? 1.75 : 1);
    this.scene.environment = high ? this.env : null;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = high ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = high ? 1.3 : 1;
    this.quality = q;
  }

  /* ---------- collision ---------- */
  // Push a circle (x, z, radius r) out of every box taller than stepH and keep it inside.
  resolve(p, r = BODY_R) {
    for (const b of this.boxes) {
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      let dx = p.x - cx, dz = p.z - cz;
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

  /* ---------- raycast ---------- */
  // Nearest hit of the ray o + t d (d unit) with cover, walls or floor, up to maxT.
  // Fills out = { t, n: [x, y, z] } and returns t (Infinity if nothing).
  raycast(o, d, maxT = 200, out = null) {
    let best = maxT, nx = 0, ny = 0, nz = 0;
    for (const b of this.boxes) {
      let t0 = 0, t1 = best, ax = 0;
      // slabs: x, y (0..h), z
      const sl = [[o[0], d[0], b.minX, b.maxX], [o[1], d[1], 0, b.h], [o[2], d[2], b.minZ, b.maxZ]];
      let ok = true;
      for (let a = 0; a < 3; a++) {
        const [oo, dd, lo, hi] = sl[a];
        if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) { ok = false; break; } continue; }
        let ta = (lo - oo) / dd, tb = (hi - oo) / dd;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) { t0 = ta; ax = a; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
      if (!ok || t0 <= 1e-6 || t0 >= best) continue;
      best = t0;
      nx = ny = nz = 0;
      const s = -Math.sign([d[0], d[1], d[2]][ax]);
      if (ax === 0) nx = s; else if (ax === 1) ny = s; else nz = s;
    }
    // perimeter walls and floor
    const planes = [[0, -this.hx, 1], [0, this.hx, -1], [2, -this.hz, 1], [2, this.hz, -1], [1, 0, 1]];
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
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return true;
    d[0] /= L; d[1] /= L; d[2] /= L;
    return this.raycast(a, d, L) === Infinity;
  }

  /* ---------- navigation ---------- */
  _buildNav() {
    const nx = this.nx = Math.round(this.hx * 2 / CELL), nz = this.nz = Math.round(this.hz * 2 / CELL);
    const free = this.free = new Uint8Array(nx * nz);
    const r = BODY_R + 0.1;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = -this.hx + (i + 0.5) * CELL, z = -this.hz + (j + 0.5) * CELL;
      let ok = x > -this.hx + r && x < this.hx - r && z > -this.hz + r && z < this.hz - r;
      for (const b of this.boxes) {
        if (!ok) break;
        if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) ok = false;
      }
      free[j * nx + i] = ok ? 1 : 0;
    }
    this._g = new Float32Array(nx * nz);
    this._from = new Int32Array(nx * nz);
    this._closed = new Uint8Array(nx * nz);
  }
  cellOf(x, z) {
    const i = Math.max(0, Math.min(this.nx - 1, Math.floor((x + this.hx) / CELL)));
    const j = Math.max(0, Math.min(this.nz - 1, Math.floor((z + this.hz) / CELL)));
    return j * this.nx + i;
  }
  cellCentre(c) { return [-this.hx + ((c % this.nx) + 0.5) * CELL, -this.hz + (Math.floor(c / this.nx) + 0.5) * CELL]; }
  walkable(x, z) { return this.free[this.cellOf(x, z)] === 1; }
  _nearestFree(c) {
    if (this.free[c]) return c;
    const [x, z] = this.cellCentre(c);
    let best = -1, bd = Infinity;
    for (let k = 0; k < this.free.length; k++) {
      if (!this.free[k]) continue;
      const [cx, cz] = this.cellCentre(k);
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  // Straight walkable line between two points (samples every quarter cell)?
  clearWalk(ax, az, bx, bz) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / (CELL * 0.25));
    for (let k = 1; k < n; k++) { const f = k / n; if (!this.walkable(ax + (bx - ax) * f, az + (bz - az) * f)) return false; }
    return true;
  }
  // A* over the grid (8 neighbours, no corner cutting), then string-pulled.
  // Returns waypoints [[x, z], ...] ending at the goal (or [] if unreachable).
  findPath(ax, az, bx, bz) {
    const nx = this.nx, start = this._nearestFree(this.cellOf(ax, az)), goal = this._nearestFree(this.cellOf(bx, bz));
    if (start < 0 || goal < 0) return [];
    const g = this._g, from = this._from, closed = this._closed;
    g.fill(Infinity); from.fill(-1); closed.fill(0);
    const [gx, gz] = this.cellCentre(goal);
    const heap = [];        // [f, cell]
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
    const h = (c) => { const [x, z] = this.cellCentre(c); const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    g[start] = 0; push(h(start), start);
    let found = false;
    while (heap.length) {
      const [, c] = pop();
      if (closed[c]) continue;
      if (c === goal) { found = true; break; }
      closed[c] = 1;
      const ci = c % nx, cj = Math.floor(c / nx);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= this.nz) continue;
        const k = j * nx + i;
        if (!this.free[k] || closed[k]) continue;
        if (di && dj && (!this.free[cj * nx + i] || !this.free[j * nx + ci])) continue;   // no corner cutting
        const ng = g[c] + (di && dj ? 1.414 : 1) * CELL;
        if (ng < g[k]) { g[k] = ng; from[k] = c; push(ng + h(k), k); }
      }
    }
    if (!found) return [];
    const cells = [];
    for (let c = goal; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => this.cellCentre(c));
    pts[pts.length - 1] = this.walkable(bx, bz) ? [bx, bz] : pts[pts.length - 1];
    // String pulling: skip waypoints while the straight line stays walkable.
    const out = [];
    let cur = [ax, az], k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) if (this.clearWalk(cur[0], cur[1], pts[m][0], pts[m][1])) { far = m; break; }
      out.push(pts[far]);
      cur = pts[far];
      k = far + 1;
    }
    return out;
  }

  /* ---------- cover spots and spawns ---------- */
  _buildCover() {
    this.coverSpots = [];
    for (const b of this.boxes) {
      if (b.h < 0.9) continue;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, off = BODY_R + 0.25;
      const cand = [];
      const along = (x0, z0, x1, z1, n) => { for (let k = 0; k < n; k++) { const f = (k + 0.5) / n; cand.push([x0 + (x1 - x0) * f, z0 + (z1 - z0) * f]); } };
      const nX = Math.max(1, Math.round((b.maxX - b.minX) / 2)), nZ = Math.max(1, Math.round((b.maxZ - b.minZ) / 2));
      along(b.minX, b.maxZ + off, b.maxX, b.maxZ + off, nX); along(b.minX, b.minZ - off, b.maxX, b.minZ - off, nX);
      along(b.maxX + off, b.minZ, b.maxX + off, b.maxZ, nZ); along(b.minX - off, b.minZ, b.minX - off, b.maxZ, nZ);
      for (const [x, z] of cand) if (this.walkable(x, z)) this.coverSpots.push({ x, z, low: b.h < 1.4, bx: cx, bz: cz });
    }
  }

  // Spawn point farthest from the given enemies (positions {x, z}); side 'A' | 'B' | null (any).
  spawnPoint(side, enemies, rng = Math.random) {
    const list = (side ? this.spawns[side] : [...this.spawns.A, ...this.spawns.B]).map((p) => {
      if (this.walkable(p[0], p[1])) return p;
      return this.cellCentre(this._nearestFree(this.cellOf(p[0], p[1])));   // a spawn inside cover moves out
    });
    let best = list[0], bd = -1;
    for (const p of list) {
      let d = Infinity;
      for (const e of enemies) d = Math.min(d, Math.hypot(e.x - p[0], e.z - p[1]));
      d += rng() * 2;   // a little variety between equal choices
      if (d > bd) { bd = d; best = p; }
    }
    return { x: best[0], z: best[1] };
  }
}
