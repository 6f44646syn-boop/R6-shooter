// Battle arena, built from a map description (maps.js).
//
// Provides the scene, movement collision with heights (solid boxes, box tops you stand on,
// stairs, ramps, upper floors), bullet and sight-line raycasts, a layered navigation graph
// with A* for the bots (they use stairs, ramps and upper floors), cover spots, spawn points
// and hazards (acid).
//
// Coordinates: metres, x right, y up, z towards the "A" side. Same yaw convention as the
// range: yaw 0 looks along -z, positive turns right.
import * as THREE from '../../vendor/three/three.module.min.js?v=3d9f8db-mw7k0mnu';
import { MAPS } from './maps.js?v=3d9f8db-mw7k0mnu';
import { mergeStatic, makeEnvMap } from '../scene/sight-model.js?v=3d9f8db-mw7k0mnu';
import { flatMaterial } from '../scene/low.js?v=3d9f8db-mw7k0mnu';
import { BulletHoles } from '../scene/holes.js?v=3d9f8db-mw7k0mnu';
import { mulberry32 } from '../core/prng.js?v=3d9f8db-mw7k0mnu';

export const HALF_X = 18, HALF_Z = 14, WALL_H = 4.5;
// Landmark names for callouts, by kind of cover.
const PLACE = {
  container: 'container', crate: 'crates', wall: 'wall', low: 'low wall', barrier: 'barrier', dock: 'loading dock', steel: 'stairs', plank: 'ramp',
  logwall: 'cabin', shed: 'shed', logs: 'woodpile', snowbank: 'snowbank', hill: 'hill', fence: 'fence', deck: 'lookout', tree: 'trees', sled: 'sled', table: 'table', bed: 'bed', fireplace: 'fireplace',
  slots: 'slots', cardtable: 'tables', roulette: 'roulette', bar: 'bar', pillar: 'pillar', cage: 'cage', room: 'rooms', partition: 'partition', stairs: 'stairs', ramp: 'ramp', rail: 'railing', couch: 'couches',
  lockers: 'lockers', shelf: 'shelves', boiler: 'boiler', barrel: 'barrels', platform: 'platform', desk: 'desks',
};   // the old Container Yard size (tests)
export const BODY_R = 0.35;       // fighter radius for collision
export const STEP = 0.45;         // highest ledge you walk up without vaulting
export const BODY_H = 1.75;       // standing height (what a box must clear to be walked under)
export const VAULT_MAX = 1.5;     // highest ledge you can vault or climb onto
const CELL = 0.5;                 // nav grid cell (m)
const GRID = 2;                   // broad-phase grid cell (m)
const DROP = 4.2;                 // bots may drop down this far
const RAMP_SLICE = 0.25;          // ramps collide as thin steps this long

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
// Solid wedge for a ramp (bottom at base, top rising from y0 to y1 along dir).
function wedgeGeo(r, tile = 1) {
  const w = r.maxX - r.minX, d = r.maxZ - r.minZ;
  const g = boxGeo(w, 1, d, tile);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + w / 2, z = p.getZ(i) + d / 2;      // 0..w, 0..d
    const f = r.dir === '+x' ? x / w : r.dir === '-x' ? 1 - x / w : r.dir === '+z' ? z / d : 1 - z / d;
    const top = r.y0 + (r.y1 - r.y0) * f;
    p.setY(i, p.getY(i) > 0 ? top : r.base);
  }
  g.computeVertexNormals();
  g.translate((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
  return g;
}

// Night sky: deep blue to black with stars and a moon.
let NIGHT_SKY = null;
function nightSky() {
  if (NIGHT_SKY) return NIGHT_SKY;
  const W = 2048, H = 1024, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), rng = mulberry32(88);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#02030a'); gr.addColorStop(0.45, '#0a1024'); gr.addColorStop(0.52, '#141a30'); gr.addColorStop(1, '#05060a');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1600; i++) {
    g.globalAlpha = 0.25 + rng() * 0.6; g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(rng() * W, H * (0.12 + rng() * 0.36), 0.5 + (rng() < 0.08 ? 0.8 : 0), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  const mx = W * 0.3, my = H * 0.3, glow = g.createRadialGradient(mx, my, 0, mx, my, 90);
  glow.addColorStop(0, 'rgba(220,230,255,0.45)'); glow.addColorStop(1, 'rgba(220,230,255,0)');
  g.fillStyle = glow; g.fillRect(mx - 90, my - 90, 180, 180);
  g.fillStyle = '#eef2ff'; g.beginPath(); g.arc(mx, my, 16, 0, Math.PI * 2); g.fill();
  NIGHT_SKY = new THREE.CanvasTexture(cv);
  NIGHT_SKY.colorSpace = THREE.SRGBColorSpace;
  return NIGHT_SKY;
}

// Soft round dot (snowflakes) and a soft cloudy blob (fog banks).
let DOT = null, BLOB = null;
function softDot() {
  if (DOT) return DOT;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return (DOT = new THREE.CanvasTexture(c));
}
function fogBlob() {
  if (BLOB) return BLOB;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), rng = mulberry32(90);
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2, r = rng() * S * 0.28, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.6, R = S * (0.12 + rng() * 0.18);
    const gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
  }
  return (BLOB = new THREE.CanvasTexture(c));
}

// Overcast sky for rain, storms and fog: grey cloud bands.
let GREY_SKY = null;
function greySky() {
  if (GREY_SKY) return GREY_SKY;
  const W = 1024, H = 512, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), rng = mulberry32(89);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#4a5058'); gr.addColorStop(0.5, '#7a8088'); gr.addColorStop(1, '#5a5e64');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(' + (rng() < 0.5 ? '40,44,50' : '120,126,134') + ',' + (0.1 + rng() * 0.2) + ')'; g.beginPath(); g.ellipse(rng() * W, H * (0.1 + rng() * 0.4), 60 + rng() * 160, 10 + rng() * 20, 0, 0, Math.PI * 2); g.fill(); }
  GREY_SKY = new THREE.CanvasTexture(cv);
  GREY_SKY.colorSpace = THREE.SRGBColorSpace;
  return GREY_SKY;
}

// Merge static meshes in square chunks (one mesh per material per chunk) and keep frustum
// culling on, so looking one way does not draw the whole map.
function mergeChunks(group, size = 22, bounds = null) {
  const chunks = new Map();
  group.updateMatrixWorld(true);
  const tmp = new THREE.Vector3();
  for (const o of [...group.children]) {
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    tmp.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
    // Everything outside the walls (scenery) goes in one piece.
    const key = bounds && (Math.abs(tmp.x) > bounds[0] + 1 || Math.abs(tmp.z) > bounds[1] + 1) ? 'far' : Math.floor(tmp.x / size) + ',' + Math.floor(tmp.z / size);
    if (!chunks.has(key)) chunks.set(key, new THREE.Group());
    chunks.get(key).add(o);
  }
  group.clear();
  for (const g of chunks.values()) {
    mergeStatic(g);
    g.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingSphere(); o.frustumCulled = true; } });
    group.add(g);
  }
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
      if (m.emissive !== undefined || m.emissiveMap) {
        const k = 'e' + (m.emissive ?? 0xffffff) + (m.emissiveMap ? m.emissiveMap.uuid : '');
        if (!matCache.has(k)) matCache.set(k, new THREE.MeshBasicMaterial({ color: m.emissive ?? 0xffffff, map: m.emissiveMap || null, toneMapped: false }));
        return matCache.get(k);
      }
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
    const S = Math.max(HX, HZ) + 6;
    Object.assign(key.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 100 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
    scene.add(key, key.target);
    this.key = key;
    this._lights = { hemi: map.hemi[2], key: map.key[1] };
    // Coloured glow lights (acid pools, a fireplace): no shadows.
    this.glows = [];
    for (const [c, i, x, y, z, dist] of map.glows || []) {
      const l = new THREE.PointLight(c, i, dist || 9, 1.6);
      l.position.set(x, y, z);
      scene.add(l);
      this.glows.push({ l, base: i, ph: x * 1.7 + z });
    }

    /* sky */
    this.sky = null;
    if (map.sky) {
      const sky = this.sky = new THREE.Mesh(new THREE.SphereGeometry(110, 32, 16), new THREE.MeshBasicMaterial({ map: map.sky(), side: THREE.BackSide, fog: false, depthWrite: false }));
      sky.renderOrder = -1;
      sky.userData.ownMaterial = true;
      this._daySky = sky.material.map;
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

    /* perimeter walls */
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
    const decor = new THREE.Group(), glowDecor = new THREE.Group();
    const add = (geo, m, x, y, z) => {
      const mesh = new THREE.Mesh(geo, material(m)); mesh.position.set(x, y, z);
      (mesh.material.isMeshBasicMaterial ? glowDecor : decor).add(mesh);
      return mesh;
    };
    const makeCtx = (yo = 0) => ({
      box: (m, w, h, d, x, y, z) => add(boxGeo(w, h, d, m.tile || 1), m, x, y + yo, z),
      // uv: [u0, v0, u1, v1] to show part of a texture sheet.
      plane: (m, w, h, x, y, z, ry = 0, uv = null) => {
        const g = new THREE.PlaneGeometry(w, h);
        if (uv) { const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1])); }
        const p = add(g, m, x, y + yo, z); p.rotation.y = ry; return p;
      },
      floorPlane: (m, w, d, x, y, z) => { const p = add(new THREE.PlaneGeometry(w, d), m, x, y + yo, z); p.rotation.x = -Math.PI / 2; return p; },
      cone: (m, r, h, x, y, z, rx = 0) => { const c = add(new THREE.ConeGeometry(r, h, 10), m, x, y + yo, z); c.rotation.x = rx; return c; },
      cylinder: (m, r, h, x, y, z, seg = 16) => add(new THREE.CylinderGeometry(r, r, h, seg), m, x, y + yo, z),
      tubeX: (m, r, len, x, y, z) => { const c = add(new THREE.CylinderGeometry(r, r, len, 10), m, x, y + yo, z); c.rotation.z = Math.PI / 2; return c; },
      tubeZ: (m, r, len, x, y, z) => { const c = add(new THREE.CylinderGeometry(r, r, len, 10), m, x, y + yo, z); c.rotation.x = Math.PI / 2; return c; },
      // Triangular prism (a gable end): base w along x, height h, thickness t along z.
      gable: (m, w, h, t, x, y, z) => {
        const sh = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
        const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
        g.translate(0, 0, -t / 2);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (m.tile || 1), uv.getY(i) / (m.tile || 1));
        return add(g, m, x, y + yo, z);
      },
    });
    const ctx = makeCtx(0);
    if (map.ceiling) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), material({ color: map.ceiling.color, rough: 0.9 }));
      c.rotation.x = Math.PI / 2; c.position.y = WH;
      c.receiveShadow = true;                     // never casts: the light comes in from above
      scene.add(c);
      const lightsAt = map.ceiling.lightsAt ? [...map.ceiling.lightsAt] : [];
      if (map.ceiling.lights && !map.ceiling.lightsAt) for (let x = -HX + 3; x < HX; x += 6) for (let z = -HZ + 3; z < HZ; z += 6) lightsAt.push([x, z]);
      for (const [x, z] of lightsAt) ctx.box({ emissive: map.ceiling.lights }, 1.8, 0.04, 0.5, x, WH - 0.03, z);
    }

    /* solids: boxes, stair steps, ramp slices */
    this.boxes = [];
    const cover = new THREE.Group(), noShadow = new THREE.Group();
    const solid = (minX, maxX, minY, maxY, minZ, maxZ, kind, extra = {}) => {
      const b = { minX, maxX, minY, maxY, minZ, maxZ, h: maxY, kind, i: this.boxes.length, ...extra };
      this.boxes.push(b);
      return b;
    };
    const kindOf = (b) => map.kinds[b.kind] || {};
    const addBox = (b) => {
      const y0 = b.y || 0;
      solid(b.x - b.w / 2, b.x + b.w / 2, y0, y0 + b.h, b.z - b.d / 2, b.z + b.d / 2, b.kind);
      if (b.hidden) return;
      const k = kindOf(b);
      if (!k.hiddenBox) {
        const m = new THREE.Mesh(boxGeo(b.w, b.h, b.d, k.tile || 1), material({ ...k, color: b.color ?? k.color }));
        m.position.set(b.x, y0 + b.h / 2, b.z);
        ((b.noShadow || k.noShadow) ? noShadow : cover).add(m);
      }
      if (k.decor) k.decor(makeCtx(y0), b);
    };
    const span = (b) => {
      const minX = b.x - b.w / 2, maxX = b.x + b.w / 2, minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
      const along = b.dir[1] === 'x' ? b.w : b.d;
      return { minX, maxX, minZ, maxZ, along };
    };
    // Piece i of n along dir: [x0, x1] and [z0, z1].
    const piece = (s, dir, i, n) => {
      let a0 = i * s.along / n, a1 = (i + 1) * s.along / n;
      if (dir[0] === '-') { const t0 = s.along - a1; a1 = s.along - a0; a0 = t0; }
      return [dir[1] === 'x' ? [s.minX + a0, s.minX + a1] : [s.minX, s.maxX], dir[1] === 'z' ? [s.minZ + a0, s.minZ + a1] : [s.minZ, s.maxZ]];
    };
    // Stairs: n solid steps rising along dir (each from the base up to its tread).
    const addStairs = (b) => {
      const s = span(b), y0 = b.y || 0, rise = b.rise || 0.3, n = Math.max(1, Math.round((b.y1 - y0) / rise));
      const k = kindOf(b), base = b.base ?? y0;
      for (let i = 0; i < n; i++) {
        const top = y0 + (b.y1 - y0) * (i + 1) / n;
        const [bx, bz] = piece(s, b.dir, i, n);
        solid(bx[0], bx[1], base, top, bz[0], bz[1], b.kind);
        const m = new THREE.Mesh(boxGeo(bx[1] - bx[0], top - base, bz[1] - bz[0], k.tile || 1), material({ ...k, color: b.color ?? k.color }));
        m.position.set((bx[0] + bx[1]) / 2, (base + top) / 2, (bz[0] + bz[1]) / 2);
        cover.add(m);
      }
    };
    // Ramps: a smooth wedge to look at; thin steps for collision, standing and bullets.
    const addRamp = (b) => {
      const s = span(b), y0 = b.y || 0, base = b.base ?? 0, n = Math.max(1, Math.ceil(s.along / RAMP_SLICE));
      for (let i = 0; i < n; i++) {
        const top = y0 + (b.y1 - y0) * (i + 0.5) / n;
        const [bx, bz] = piece(s, b.dir, i, n);
        solid(bx[0], bx[1], base, top, bz[0], bz[1], b.kind, { ramp: true });
      }
      const k = kindOf(b);
      cover.add(new THREE.Mesh(wedgeGeo({ ...s, dir: b.dir, y0, y1: b.y1, base }, k.tile || 1), material({ ...k, color: b.color ?? k.color })));
    };
    for (const b0 of map.layout) {
      const b = (b0.stairs || b0.ramp) && !b0.dir ? { ...b0, dir: b0.stairs || b0.ramp } : b0;
      const list = [b];
      if (b.mirror ?? map.mirror) list.push({ ...b, x: -b.x, z: -b.z, dir: b.dir ? (b.dir[0] === '+' ? '-' : '+') + b.dir[1] : undefined });
      for (const e of list) (e.stairs ? addStairs : e.ramp ? addRamp : addBox)(e);
    }
    if (map.extra) map.extra(ctx, map);
    if (map.outside) map.outside(ctx, map);
    mergeChunks(cover);
    cover.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(cover);
    mergeChunks(noShadow);
    noShadow.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    scene.add(noShadow);
    mergeChunks(decor, 22, [HX, HZ]);
    decor.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(decor);
    mergeChunks(glowDecor);
    scene.add(glowDecor);

    /* hazards (acid): damage per second while standing in them */
    this.hazards = (map.acid || []).map((a) => ({ minX: a.x - a.w / 2, maxX: a.x + a.w / 2, minZ: a.z - a.d / 2, maxZ: a.z + a.d / 2, dps: a.dps || 34 }));
    this.acidTex = null;
    if (this.hazards.length && map.acidLook) {
      const look = map.acidLook();
      this.acidTex = look.map; this.acidTex2 = look.map2;
      this.acidMat = new THREE.MeshBasicMaterial({ map: look.map, toneMapped: false });
      this.acidMat2 = new THREE.MeshBasicMaterial({ map: look.map2, toneMapped: false, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
      for (const h of this.hazards) {
        const w = h.maxX - h.minX, d = h.maxZ - h.minZ;
        for (const [m, y] of [[this.acidMat, 0.03], [this.acidMat2, 0.05]]) {
          const g = new THREE.PlaneGeometry(w, d);
          const uv = g.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w + h.minX) / 3, (uv.getY(i) * d + h.minZ) / 3);
          const p = new THREE.Mesh(g, m);
          p.rotation.x = -Math.PI / 2; p.position.set((h.minX + h.maxX) / 2, y, (h.minZ + h.maxZ) / 2);
          p.renderOrder = 1;
          p.userData.ownMaterial = true;
          scene.add(p);
        }
      }
    }

    /* falling snow (moved on the GPU) */
    this.snow = null;
    this.rain = null;
    this.atm = { night: false, weather: 'auto', hemi: 1, key: 1, flash: 0, nextFlash: 0 };
    this._makeSnow = () => {
      const n = 2400, pos = new Float32Array(n * 3), rng = mulberry32(5);
      const skip = map.snowSkip || [];
      for (let i = 0; i < n; i++) {
        let x, z, k = 0;
        do { x = (rng() - 0.5) * HX * 2.4; z = (rng() - 0.5) * HZ * 2.4; } while (k++ < 20 && skip.some(([a, b, c, d]) => x > a && x < b && z > c && z < d));
        pos[i * 3] = x; pos[i * 3 + 1] = rng() * 10; pos[i * 3 + 2] = z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, map: softDot(), transparent: true, opacity: 0.9, depthWrite: false });
      const uT = { value: 0 };
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uT = uT;
        sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.y = mod(position.y - uT * 0.9, 10.0);\ntransformed.x += sin(uT * 0.7 + position.z * 3.0) * 0.25;');
      };
      this.snow = new THREE.Points(g, mat);
      this.snow.userData.uT = uT;
      this.snow.frustumCulled = false;
      scene.add(this.snow);
    };
    if (map.snow) this._makeSnow();

    this.holes = new BulletHoles(scene);
    this.holes.setSize(0.03);

    scene.traverse((o) => { if (o.isMesh && o.parent && (o.parent === scene || o.parent.parent === scene || (o.parent.parent && o.parent.parent.parent === scene))) { o.updateMatrixWorld(); o.matrixAutoUpdate = false; } });
    const mirrorSp = (list) => list.map(([x, z, y]) => [-x, -z, y]);
    this.spawns = { A: map.spawns, B: map.spawnsB || mirrorSp(map.spawns) };
    this._buildGrid();
    this._buildNav();
    this._buildCover();
  }

  /* ---------- time of day and weather ---------- */
  // night: dark, moonlit outdoors / lights out indoors (bring a flashlight).
  // weather: 'auto' (the map's own), 'clear', 'rain', 'storm' (rain and lightning), 'snow'.
  // fog: on / off, with any weather. Rain, storms and snow only fall on outdoor maps.
  setAtmosphere(night = false, weather = 'auto', fog = false) {
    const map = this.map, a = this.atm, outdoor = !map.indoor;
    if (weather === 'fog') { weather = 'auto'; fog = true; }
    a.night = !!night; a.weather = weather; a.fog = !!fog;
    const w = weather === 'auto' ? (map.snow ? 'snow' : 'clear') : weather;
    a.w = w;
    const snow = outdoor && w === 'snow', rain = outdoor && (w === 'rain' || w === 'storm');
    if (snow && !this.snow) this._makeSnow();
    if (this.snow) this.snow.visible = snow;
    if (rain && !this.rain) this._makeRain();
    if (this.rain) this.rain.visible = rain;
    // fog and background
    const [fc, fn, ff] = map.fog;
    const col = new THREE.Color(fc);
    let near = fn, far = ff;
    if (a.fog) { near = 0; far = map.indoor ? 16 : 22; col.lerp(new THREE.Color(0xb8bcc0), map.indoor ? 0.3 : 0.6); }
    if (rain) { near = Math.min(near, 12); far = Math.min(far, 60); col.lerp(new THREE.Color(0x6a7078), 0.6); }
    if (a.night) { col.multiplyScalar(map.indoor ? 0.15 : 0.12).lerp(new THREE.Color(0x05070d), 0.5); near = Math.min(near, 4); far = Math.min(far, 45); }
    this.scene.fog.color.copy(col); this.scene.fog.near = near; this.scene.fog.far = far;
    const bg = new THREE.Color(map.background);
    if (rain || a.fog) bg.lerp(col, 0.7);
    if (a.night) bg.copy(col);
    this.scene.background = bg;
    if (this.sky) {
      // In fog the sky is just the fog colour, so everything fades into one grey.
      this.sky.material.map = a.fog ? null : a.night ? nightSky() : rain ? greySky() : this._daySky;
      if (a.fog) this.sky.material.color.copy(col);
      else this.sky.material.color.set(a.night && rain ? 0x8090a0 : 0xffffff);
      this.sky.material.needsUpdate = true;
    }
    // light levels: moonlight outdoors, almost nothing indoors (the lamps and screens still glow)
    a.hemi = (a.night ? (map.indoor ? 0.07 : 0.1) : 1) * (rain ? 0.6 : 1) * (a.fog ? 0.85 : 1);
    a.key = (a.night ? (map.indoor ? 0.03 : 0.12) : 1) * (rain ? 0.35 : 1) * (a.fog ? 0.6 : 1);
    this.key.color.set(a.night ? 0x8aa0ff : map.key[0]);
    this.hemi.color.set(a.night ? 0x6a7aa8 : map.hemi[0]);
    a.nextFlash = 3 + Math.random() * 6;
    if (this.quality) { this._applyLights(); this._fogBanks(); }
  }
  // Drifting fog banks low over the ground: soft sprites, more of them in High / Ultra.
  _fogBanks() {
    const a = this.atm, q = this.quality, w = a.w || 'clear';
    const rain = !this.map.indoor && (w === 'rain' || w === 'storm');
    // Off: every quality uses the plain distance fog (it reads better than the banks did).
    const want = 0;
    if (!this.banks) {
      this.banks = new THREE.Group();
      const rng = mulberry32(91), maxY = this.map.indoor ? this.wallH - 0.6 : 3.2;
      for (let i = 0; i < 70; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fogBlob(), transparent: true, depthWrite: false, opacity: 0.5, fog: true }));
        const sz = 7 + rng() * 9;
        sp.scale.set(sz, sz * 0.45, 1);
        sp.position.set((rng() - 0.5) * this.hx * 2, 0.5 + rng() * Math.min(2.4, maxY), (rng() - 0.5) * this.hz * 2);
        sp.userData = { ownMaterial: true, v: 0.15 + rng() * 0.25, ph: rng() * 6 };
        sp.material.rotation = rng() * Math.PI;
        this.banks.add(sp);
      }
      this.scene.add(this.banks);
    }
    const col = new THREE.Color(a.night ? 0x161a22 : a.fog ? 0xd0d4d8 : 0x8a9098);
    this.banks.children.forEach((sp, i) => {
      sp.visible = i < want;
      sp.material.color.copy(col);
      sp.material.opacity = a.fog ? (a.night ? 0.7 : 0.55) : 0.3;
    });
    this.banks.visible = want > 0;
  }
  _applyLights() {
    const q = this.quality, high = q === 'high' || q === 'ultra', a = this.atm;
    this.hemi.intensity = this._lights.hemi * (high ? 0.6 : q === 'low' ? 1.45 : 1) * a.hemi + a.flash * 3;
    this.key.intensity = this._lights.key * (high ? 1.75 : 1) * a.key + a.flash * 4;
  }
  _makeRain() {
    const n = 5000, pos = new Float32Array(n * 6), off = new Float32Array(n * 2), rng = mulberry32(9);
    for (let i = 0; i < n; i++) {
      const x = (rng() - 0.5) * 36, z = (rng() - 0.5) * 36, y = rng() * 14;
      pos.set([x, y, z, x, y, z], i * 6);
      off[i * 2] = 0; off[i * 2 + 1] = 0.45;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aOff', new THREE.BufferAttribute(off, 1));
    const mat = new THREE.LineBasicMaterial({ color: 0xc8d4e4, transparent: true, opacity: 0.38, depthWrite: false });
    const uT = { value: 0 }, uC = { value: new THREE.Vector2() };
    const sk = (this.map.snowSkip || [])[0] || [0, 0, 0, 0];
    const uS = { value: new THREE.Vector4(sk[0], sk[1], sk[2], sk[3]) };     // no rain under the cabin roof
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = uT; sh.uniforms.uC = uC; sh.uniforms.uS = uS;
      sh.vertexShader = 'uniform float uT;\nuniform vec2 uC;\nuniform vec4 uS;\nattribute float aOff;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.y = mod(position.y - uT * 13.0, 14.0) + aOff;\n' +
        'transformed.x = uC.x + mod(position.x - uC.x + 18.0, 36.0) - 18.0 + aOff * 0.12;\n' +
        'transformed.z = uC.y + mod(position.z - uC.y + 18.0, 36.0) - 18.0;\n' +
        'if (transformed.x > uS.x && transformed.x < uS.y && transformed.z > uS.z && transformed.z < uS.w && transformed.y < 4.5) transformed.y = -50.0;');
    };
    this.rain = new THREE.LineSegments(g, mat);
    this.rain.userData = { uT, uC };
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  // Per-frame animation (snow, rain, lightning, acid, glow flicker). cam: viewer position.
  update(dt, t, cam = null) {
    if (this.snow) this.snow.userData.uT.value = t;
    if (this.rain && this.rain.visible) {
      this.rain.userData.uT.value = t;
      if (cam) this.rain.userData.uC.value.set(cam.x, cam.z);
    }
    const a = this.atm;
    if (this.banks && this.banks.visible) for (const sp of this.banks.children) {
      if (!sp.visible) continue;
      sp.position.x += sp.userData.v * dt;
      if (sp.position.x > this.hx + 6) sp.position.x = -this.hx - 6;
      sp.material.rotation += dt * 0.01;
    }
    if (a.w === 'storm' && !this.map.indoor && dt > 0) {
      a.nextFlash -= dt;
      if (a.nextFlash <= 0) { a.flashT = 0.35; a.nextFlash = 5 + Math.random() * 9; }
      a.flashT = Math.max(0, (a.flashT || 0) - dt);
      const f = a.flashT > 0 ? (Math.sin(a.flashT * 60) > 0 ? 1 : 0.3) * (a.flashT / 0.35) : 0;
      if (f !== a.flash) { a.flash = f; this._applyLights(); }
    }
    if (this.acidTex) {
      this.acidTex.offset.set(t * 0.02, t * 0.013);
      this.acidTex2.offset.set(-t * 0.031, t * 0.024);
      this.acidMat2.opacity = 0.35 + 0.15 * Math.sin(t * 2.3);
    }
    for (const g of this.glows) g.l.intensity = g.base * (0.85 + 0.15 * Math.sin(t * 3.1 + g.ph) - (Math.sin(t * 17 + g.ph * 3) > 0.97 ? 0.3 : 0));
  }

  /* ---------- graphics quality ---------- */
  setGraphics(q, renderer) {
    if (!['low', 'high', 'ultra'].includes(q)) q = 'standard';
    const tier = q === 'low' ? 'low' : (q === 'high' || q === 'ultra') ? 'high' : null;
    if (tier === 'low' && !this._tiers.low.size) {
      this.scene.traverse((o) => { if (o.isMesh && !o.userData.ownMaterial) { const lo = o.userData.loMat || o.material; const f = flatMaterial(lo); if (f) this._tiers.low.set(lo, f); } });
    }
    if (tier === 'high' && !this._tiers.high.size) {
      this.env = this.env || makeEnvMap(renderer);
      for (const [lo, make] of this._spec) this._tiers.high.set(lo, make());
    }
    const map = tier ? this._tiers[tier] : null;
    this.scene.traverse((o) => {
      if (!o.isMesh || o.userData.ownMaterial) return;
      const lo = o.userData.loMat || o.material;
      o.userData.loMat = lo;
      o.material = (map && map.get(lo)) || lo;
    });
    const high = tier === 'high';
    this.key.visible = q !== 'low';
    this.key.castShadow = high;
    for (const g of this.glows) g.l.visible = q !== 'low';
    const ks = q === 'ultra' ? 4096 : 2048;
    if (this.key.shadow.mapSize.x !== ks) { this.key.shadow.mapSize.set(ks, ks); if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; } }
    this.quality = q;
    this._applyLights();
    this._fogBanks();
    this.scene.environment = high && !this.atm.night ? this.env : null;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = high ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = high ? 1.3 : 1;
    this.quality = q;
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
  resolve(p, r = BODY_R) {
    const y = p.y || 0;
    for (const b of this.near(p.x, p.z, r + 0.05, this._rnear || (this._rnear = []))) {
      if (!Arena.blocks(b, y)) continue;
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
  // A callout name for a spot: the nearest landmark and the part of the map, e.g.
  // "by the crates, north-east" or "upstairs by the slots, south".
  placeName(x, z, y = 0) {
    let best = null, bd = 3.5;
    for (const b of this.near(x, z, 3.5, [])) {
      if (!PLACE[b.kind] || b.maxY < y - 0.5 || b.minY > y + 2) continue;
      const d = Math.hypot(x - Math.max(b.minX, Math.min(x, b.maxX)), z - Math.max(b.minZ, Math.min(z, b.maxZ)));
      if (d < bd) { bd = d; best = b; }
    }
    const ns = z > this.hz / 3 ? 'north' : z < -this.hz / 3 ? 'south' : '', ew = x > this.hx / 3 ? 'east' : x < -this.hx / 3 ? 'west' : '';
    const area = ns && ew ? ns + '-' + ew : ns || ew || 'middle';
    return (y > 1.8 ? 'upstairs ' : '') + (best ? 'by the ' + PLACE[best.kind] + ', ' : '') + area;
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
    const r = BODY_R;
    for (const b of this.near(x + dx * 0.8, z + dz * 0.8, 1.2, [])) {
      if (!Arena.blocks(b, y)) continue;
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
      if (Math.hypot(p.x - px, p.z - pz) > 0.08) continue;
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
    const planes = this._planes || (this._planes = [[0, -HX, 1], [0, HX, -1], [2, -HZ, 1], [2, HZ, -1], [1, 0, 1]].concat(this.map.ceiling ? [[1, this.wallH, -1]] : []));
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
    const r = BODY_R + 0.1, list = [];
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
          if (!Arena.blocks(b, y)) continue;
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
      const d = (this.nodeX[k] - x) ** 2 + (this.nodeZ[k] - z) ** 2 + 4 * (this.nodeY[k] - y) ** 2;
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
      if (ok === undefined) { const [x, z] = this.cellCentre(cell); ok = this._freeAt(x, z, y); this._dropOk.set(key, ok); }
      if (!ok) return -1;
    }
    return best;
  }
  // Room for a body at (x, z) with feet at y?
  _freeAt(x, z, y, r = BODY_R + 0.05) {
    for (const b of this.near(x, z, r + 0.05, this._fnear || (this._fnear = []))) {
      if (!Arena.blocks(b, y)) continue;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return false;
    }
    return true;
  }
  // Can a body walk straight from a to b (each [x, z, y]), stepping and dropping as it goes?
  clearWalk(a, b) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / (CELL * 0.25)));
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

  /* ---------- cover spots and spawns ---------- */
  _buildCover() {
    this.coverSpots = [];
    for (const b of this.boxes) {
      if (b.ramp) continue;
      const base = this._baseNear(b);
      if (base === null) continue;
      const hh = b.maxY - base;
      if (hh < 0.9) continue;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, off = BODY_R + 0.25;
      const cand = [];
      const along = (x0, z0, x1, z1, n) => { for (let k = 0; k < n; k++) { const f = (k + 0.5) / n; cand.push([x0 + (x1 - x0) * f, z0 + (z1 - z0) * f]); } };
      const nX = Math.max(1, Math.round((b.maxX - b.minX) / 2)), nZ = Math.max(1, Math.round((b.maxZ - b.minZ) / 2));
      along(b.minX, b.maxZ + off, b.maxX, b.maxZ + off, nX); along(b.minX, b.minZ - off, b.maxX, b.minZ - off, nX);
      along(b.maxX + off, b.minZ, b.maxX + off, b.maxZ, nZ); along(b.minX - off, b.minZ, b.minX - off, b.maxZ, nZ);
      for (const [x, z] of cand) {
        const k = this.nodeAt(x, z, base);
        if (k >= 0 && Math.abs(this.nodeY[k] - base) < 0.2) this.coverSpots.push({ x, z, y: this.nodeY[k], low: hh < 1.4, bx: cx, bz: cz });
      }
    }
  }
  // The level someone stands on beside box b (the floor, or a floor it sits on), or null.
  _baseNear(b) {
    if (b.minY < 0.05) return 0;
    for (const c of this.boxes) if (c !== b && Math.abs(c.maxY - b.minY) < 0.05 && c.minX <= b.minX + 0.01 && c.maxX >= b.maxX - 0.01 && c.minZ <= b.minZ + 0.01 && c.maxZ >= b.maxZ - 0.01) return c.maxY;
    return null;
  }

  // Spawn point farthest from the given enemies (positions {x, y, z}); side 'A' | 'B' | null (any).
  spawnPoint(side, enemies, rng = Math.random) {
    const list = (side ? this.spawns[side] : [...this.spawns.A, ...this.spawns.B]).map((p) => {
      const y = this.groundAt(p[0], p[1], p[2] || 0);
      const k = this.nodeAt(p[0], p[1], y);
      if (k >= 0) return [p[0], p[1], this.nodeY[k]];
      const n = this._nearestNode(p[0], p[1], y);     // a spawn inside cover moves out
      return [this.nodeX[n], this.nodeZ[n], this.nodeY[n]];
    });
    // More places than the authored ones: walkable spots within 9 m of each of them.
    if (!this._spawnPool) this._spawnPool = new Map();
    const key = side || 'any';
    if (!this._spawnPool.has(key)) {
      const pool = list.slice();
      for (let k = 0; k < this.nodeCount; k++) {
        if (!list.some((p) => Math.hypot(this.nodeX[k] - p[0], this.nodeZ[k] - p[1]) < 9 && Math.abs(this.nodeY[k] - p[2]) < 1.5)) continue;
        pool.push([this.nodeX[k], this.nodeZ[k], this.nodeY[k]]);
      }
      this._spawnPool.set(key, pool);
    }
    const pool = this._spawnPool.get(key);
    // A random safe place (no enemy within 14 m and none can see it); else the farthest.
    const eye = [0, 0, 0], at = [0, 0, 0];
    const safe = (p) => {
      for (const e of enemies) {
        const d = Math.hypot(e.x - p[0], e.z - p[1], (e.y || 0) - p[2]);
        if (d < 14) return false;
        if (d < 60) { eye[0] = e.x; eye[1] = (e.y || 0) + 1.6; eye[2] = e.z; at[0] = p[0]; at[1] = p[2] + 1.2; at[2] = p[1]; if (this.sightLine(eye, at)) return false; }
      }
      return true;
    };
    for (let i = 0; i < 40; i++) {
      const p = pool[Math.floor(rng() * pool.length)];
      if (safe(p)) return { x: p[0], z: p[1], y: p[2] };
    }
    let best = list[0], bd = -1;
    for (const p of pool) {
      let d = Infinity;
      for (const e of enemies) d = Math.min(d, Math.hypot(e.x - p[0], e.z - p[1], (e.y || 0) - p[2]));
      d += rng() * 4;
      if (d > bd) { bd = d; best = p; }
    }
    return { x: best[0], z: best[1], y: best[2] };
  }
}
