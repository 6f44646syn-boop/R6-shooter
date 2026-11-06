// Battle arena: an original walled yard with cover (shipping containers, stacked crates,
// tall and low walls, concrete barriers). Point-symmetric so both spawn sides are equal.
//
// Provides the scene, movement collision (circle vs boxes), bullet and sight-line raycasts,
// a navigation grid with A* for the bots, cover spots and spawn points.
//
// Coordinates: metres, x right, y up, z towards the "A" side. Same yaw convention as the
// range: yaw 0 looks along -z, positive turns right.
import * as THREE from '../../vendor/three/three.module.min.js?v=f8481f4-mw49i1xb';
import { concreteTiles, wallPanels, duskSky, hazardStripes } from '../scene/range-tex.js?v=f8481f4-mw49i1xb';
import { mergeStatic, makeEnvMap } from '../scene/sight-model.js?v=f8481f4-mw49i1xb';
import { flatMaterial } from '../scene/low.js?v=f8481f4-mw49i1xb';
import { BulletHoles } from '../scene/holes.js?v=f8481f4-mw49i1xb';
import { mulberry32 } from '../core/prng.js?v=f8481f4-mw49i1xb';

export const HALF_X = 18, HALF_Z = 14, WALL_H = 4.5;
const CELL = 0.5;                // nav grid cell (m)
const BODY_R = 0.35;             // fighter radius for collision

// Cover on the "A" half (z > 0) and the middle; each is mirrored through the centre
// (x, z) -> (-x, -z) for the "B" half. kind: container | crate | wall | low | barrier.
const HALF_LAYOUT = [
  { x: 0, z: 0, w: 6, d: 2.4, h: 2.6, kind: 'container', color: 0x8a3a2a, mirror: false },
  { x: -4.5, z: 3.5, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' },
  { x: -3.3, z: 3.5, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
  { x: 7.5, z: 1.5, w: 0.4, d: 4, h: 2.6, kind: 'wall' },
  { x: -9, z: 6.5, w: 4, d: 0.4, h: 1.0, kind: 'low' },
  { x: 9, z: 6.5, w: 4, d: 0.4, h: 1.0, kind: 'low' },
  { x: 0, z: 8, w: 5, d: 0.4, h: 1.0, kind: 'low' },
  { x: -12.5, z: 9.5, w: 2.4, d: 6, h: 2.6, kind: 'container', color: 0x2d4f7a },
  { x: 13.5, z: 2.5, w: 0.4, d: 5, h: 2.6, kind: 'wall' },
  { x: 14, z: 11, w: 3, d: 0.6, h: 1.1, kind: 'barrier' },
  { x: 5, z: 11, w: 2, d: 0.6, h: 1.1, kind: 'barrier' },
  { x: 2.5, z: 11, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
  { x: 9, z: 3, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
  { x: -7, z: 10.5, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' },
  { x: -15.5, z: 2, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
  { x: 3.5, z: 4.8, w: 2.4, d: 0.6, h: 1.1, kind: 'barrier' },
];

export const SPAWNS = {
  A: [[-10, 12.5], [0, 12.8], [10, 12.5], [16, 8], [-16, 6]],
  B: [[10, -12.5], [0, -12.8], [-10, -12.5], [-16, -8], [16, -6]],
};

/* ---------- textures (procedural) ---------- */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// Wooden-framed crate face (one face per 1.2 m tile).
function crateTexture() {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(5);
  g.fillStyle = '#8a6a43'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 32) {                // planks
    g.fillStyle = 'rgba(0,0,0,' + (0.05 + rng() * 0.1) + ')'; g.fillRect(0, y, S, 32);
    g.fillStyle = 'rgba(40,25,10,0.6)'; g.fillRect(0, y, S, 2);
  }
  for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(60,40,20,0.15)'; g.fillRect(rng() * S, rng() * S, 1 + rng() * 30, 1); }
  g.strokeStyle = '#5a4128'; g.lineWidth = 22; g.strokeRect(11, 11, S - 22, S - 22);   // frame
  g.beginPath(); g.moveTo(16, 16); g.lineTo(S - 16, S - 16); g.stroke();               // brace
  g.fillStyle = '#2a2a2a';
  for (const [x, y] of [[11, 11], [S - 11, 11], [11, S - 11], [S - 11, S - 11]]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
  return tex(cv);
}
// Ribbed container steel, 1 m tile; tinted by the material colour.
function containerTexture() {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(9);
  for (let x = 0; x < S; x++) {
    const v = Math.sin((x / S) * Math.PI * 2 * 4);
    const l = 190 + v * 45;
    g.fillStyle = 'rgb(' + (l | 0) + ',' + (l | 0) + ',' + (l | 0) + ')'; g.fillRect(x, 0, 1, S);
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * S, y = rng() * S * 0.7, h = 20 + rng() * 80;
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, 'rgba(90,50,20,0.35)'); gr.addColorStop(1, 'rgba(90,50,20,0)');
    g.fillStyle = gr; g.fillRect(x, y, 2 + rng() * 4, h);
  }
  return tex(cv);
}

// Light poured concrete with formwork seams and stains, 1 m tile.
function concreteTexture() {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(13);
  g.fillStyle = '#b9b5ad'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const v = 150 + rng() * 80;
    g.fillStyle = 'rgba(' + (v | 0) + ',' + ((v - 4) | 0) + ',' + ((v - 10) | 0) + ',0.25)';
    g.beginPath(); g.arc(rng() * S, rng() * S, 1 + rng() * 4, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 12; i++) {
    const x = rng() * S, y = rng() * S, r = 10 + rng() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(80,70,60,0.18)'); gr.addColorStop(1, 'rgba(80,70,60,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.fillStyle = 'rgba(60,58,54,0.5)'; g.fillRect(0, S / 2 - 1, S, 2); g.fillRect(S - 2, 0, 2, S);
  return tex(cv);
}

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
  constructor() {
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x241a16);
    scene.fog = new THREE.Fog(0x5a4038, 40, 110);
    this.quality = null;
    this._tiers = { low: new Map(), high: new Map() };
    this._spec = new Map();     // standard material -> () => high material
    const L = (lo, hi) => { if (hi) this._spec.set(lo, hi); return lo; };
    const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 1, ...o });

    /* lights */
    this.hemi = new THREE.HemisphereLight(0xc0c8dc, 0x4a3a30, 1.8);
    scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xffd8b0, 1.6);
    key.position.set(-14, 22, 10);
    key.target.position.set(0, 0, 0);
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 70 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
    scene.add(key, key.target);
    this.key = key;

    /* sky */
    const skyTex = duskSky();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    scene.add(sky);

    /* floor */
    const tiles = concreteTiles();
    tiles.map.repeat.set(HALF_X, HALF_Z);
    tiles.normal.repeat.copy(tiles.map.repeat); tiles.rough.repeat.copy(tiles.map.repeat);
    const floorMat = L(new THREE.MeshLambertMaterial({ map: tiles.map, color: 0xb8b4ae }),
      () => std({ map: tiles.map, color: 0xb8b4ae, normalMap: tiles.normal, roughnessMap: tiles.rough, roughness: 1, metalness: 0 }));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    /* perimeter walls */
    const wp = wallPanels();
    const wallMat = L(new THREE.MeshLambertMaterial({ map: wp.map }), () => std({ map: wp.map, normalMap: wp.normal, roughness: 0.6, metalness: 0.5 }));
    const walls = new THREE.Group();
    for (const [w, x, z, ry] of [[HALF_X * 2, 0, -HALF_Z, 0], [HALF_X * 2, 0, HALF_Z, Math.PI], [HALF_Z * 2, -HALF_X, 0, Math.PI / 2], [HALF_Z * 2, HALF_X, 0, -Math.PI / 2]]) {
      const g = new THREE.PlaneGeometry(w, WALL_H);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 1.2, uv.getY(i) * WALL_H / 3.6);
      const m = new THREE.Mesh(g, wallMat);
      m.position.set(x, WALL_H / 2, z); m.rotation.y = ry;
      walls.add(m);
    }
    mergeStatic(walls);
    walls.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(walls);

    /* cover */
    const crateMap = crateTexture(), contMap = containerTexture(), conc = concreteTexture(), hz = hazardStripes();
    const mats = {
      crate: L(new THREE.MeshLambertMaterial({ map: crateMap }), () => std({ map: crateMap, roughness: 0.85, metalness: 0 })),
      wall: L(new THREE.MeshLambertMaterial({ map: wp.map, color: 0xc4c8cc }), () => std({ map: wp.map, normalMap: wp.normal, color: 0xd8dce0, roughness: 0.6, metalness: 0.5 })),
      low: L(new THREE.MeshLambertMaterial({ map: conc }), () => std({ map: conc, roughness: 0.95, metalness: 0 })),
      barrier: L(new THREE.MeshLambertMaterial({ map: conc, color: 0xe4e0d8 }), () => std({ map: conc, color: 0xe4e0d8, roughness: 0.9, metalness: 0 })),
      stripe: L(new THREE.MeshLambertMaterial({ map: hz }), () => std({ map: hz, roughness: 0.6, metalness: 0 })),
    };
    const contMats = new Map();
    const contMat = (c) => {
      if (!contMats.has(c)) contMats.set(c, L(new THREE.MeshLambertMaterial({ map: contMap, color: c }), () => std({ map: contMap, color: c, roughness: 0.55, metalness: 0.6 })));
      return contMats.get(c);
    };
    this.boxes = [];
    const cover = new THREE.Group();
    const add = (b) => {
      this.boxes.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h, kind: b.kind });
      const mat = b.kind === 'container' ? contMat(b.color) : mats[b.kind];
      const m = new THREE.Mesh(boxGeo(b.w, b.h, b.d, b.kind === 'crate' ? 1.2 : 1), mat);
      m.position.set(b.x, b.h / 2, b.z);
      cover.add(m);
      if (b.kind === 'barrier') {         // hazard band along the top
        const s = new THREE.Mesh(boxGeo(b.w + 0.01, 0.12, b.d + 0.01, 0.5), mats.stripe);
        s.position.set(b.x, b.h - 0.12, b.z);
        cover.add(s);
      }
    };
    for (const b of HALF_LAYOUT) {
      add(b);
      if (b.mirror !== false) add({ ...b, x: -b.x, z: -b.z });
    }
    mergeStatic(cover);
    cover.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(cover);

    this.holes = new BulletHoles(scene);
    this.holes.setSize(0.03);

    scene.traverse((o) => { if (o.isMesh && o.parent === scene) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    this._buildNav();
    this._buildCover();
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
    this.hemi.intensity = high ? 1.1 : q === 'low' ? 2.6 : 1.8;
    this.key.intensity = high ? 2.8 : 1.6;
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
    p.x = Math.max(-HALF_X + r, Math.min(HALF_X - r, p.x));
    p.z = Math.max(-HALF_Z + r, Math.min(HALF_Z - r, p.z));
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
    const planes = [[0, -HALF_X, 1], [0, HALF_X, -1], [2, -HALF_Z, 1], [2, HALF_Z, -1], [1, 0, 1]];
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
    const nx = this.nx = Math.round(HALF_X * 2 / CELL), nz = this.nz = Math.round(HALF_Z * 2 / CELL);
    const free = this.free = new Uint8Array(nx * nz);
    const r = BODY_R + 0.1;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = -HALF_X + (i + 0.5) * CELL, z = -HALF_Z + (j + 0.5) * CELL;
      let ok = x > -HALF_X + r && x < HALF_X - r && z > -HALF_Z + r && z < HALF_Z - r;
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
    const i = Math.max(0, Math.min(this.nx - 1, Math.floor((x + HALF_X) / CELL)));
    const j = Math.max(0, Math.min(this.nz - 1, Math.floor((z + HALF_Z) / CELL)));
    return j * this.nx + i;
  }
  cellCentre(c) { return [-HALF_X + ((c % this.nx) + 0.5) * CELL, -HALF_Z + (Math.floor(c / this.nx) + 0.5) * CELL]; }
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
    const list = side ? SPAWNS[side] : [...SPAWNS.A, ...SPAWNS.B];
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
