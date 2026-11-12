// Battle arena, built from a map description (maps.js).
//
// Provides the scene, movement collision with heights (solid boxes, box tops you stand on,
// stairs, ramps, upper floors), bullet and sight-line raycasts, a layered navigation graph
// with A* for the bots (they use stairs, ramps and upper floors), cover spots, spawn points
// and hazards (acid).
//
// Coordinates: metres, x right, y up, z towards the "A" side. Same yaw convention as the
// range: yaw 0 looks along -z, positive turns right.
import { applyPackMaterials, revertPackMaterials } from '../render/pack-materials.js?v=d449e87-mwdhjwml';
import { maxMode } from '../render/quality.js?v=d449e87-mwdhjwml';
import * as THREE from '../../vendor/three/three.module.min.js?v=d449e87-mwdhjwml';
import { MAPS, SMALL } from './maps.js?v=d449e87-mwdhjwml';
import { mergeStatic, makeEnvMap } from '../scene/sight-model.js?v=d449e87-mwdhjwml';
import { flatMaterial } from '../scene/low.js?v=d449e87-mwdhjwml';
import { BulletHoles } from '../scene/holes.js?v=d449e87-mwdhjwml';
import { LightPool } from '../render/light-pool.js?v=d449e87-mwdhjwml';
import { mulberry32 } from '../core/prng.js?v=d449e87-mwdhjwml';
import { layoutSolids, layoutPieces, edgeSolids, span, piece, stairCount, rampCount } from './solids.js?v=d449e87-mwdhjwml';
import { CoreWorld, BODY_R, STEP, BODY_H, VAULT_MAX } from '../wasm/world.js?v=d449e87-mwdhjwml';
import { BLACKTIDE, ROYALE_MAP_ID } from './royale-map.js?v=d449e87-mwdhjwml';

export const HALF_X = 18, HALF_Z = 14, WALL_H = 4.5;
// Landmark names for callouts, by kind of cover.
const PLACE = {
  container: 'container', crate: 'crates', wall: 'wall', low: 'low wall', barrier: 'barrier', dock: 'loading dock', steel: 'stairs', plank: 'ramp',
  logwall: 'cabin', shed: 'shed', logs: 'woodpile', snowbank: 'snowbank', hill: 'hill', fence: 'fence', deck: 'lookout', tree: 'trees', sled: 'sled', table: 'table', bed: 'bed', fireplace: 'fireplace',
  slots: 'slots', cardtable: 'tables', roulette: 'roulette', bar: 'bar', pillar: 'pillar', cage: 'cage', room: 'rooms', partition: 'partition', stairs: 'stairs', ramp: 'ramp', rail: 'railing', couch: 'couches',
  lockers: 'lockers', shelf: 'shelves', boiler: 'boiler', barrel: 'barrels', platform: 'platform', desk: 'desks',
};   // the old Container Yard size (tests)
export { BODY_R, STEP, BODY_H, VAULT_MAX };      // body size and step heights: the same in every mode (js/wasm/world.js)

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
  // mapId: a key of MAPS (maps.js). small: its small version if it has one (SMALL, for 2 to 4 fighters).
  constructor(mapId = 'yard', small = false) {
    this.small = !!(small && SMALL[mapId]);
    const map = this.map = mapId === ROYALE_MAP_ID ? BLACKTIDE : this.small ? SMALL[mapId] : MAPS[mapId] || MAPS.yard;
    this.mapId = map === BLACKTIDE || MAPS[mapId] ? mapId : 'yard';
    this.hx = map.hx; this.hz = map.hz; this.wallH = map.wallH;
    const HX = this.hx, HZ = this.hz, WH = this.wallH;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(map.background);
    scene.fog = new THREE.Fog(...map.fog);
    this.quality = null;
    this.detailBatches = [];
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
    Object.assign(key.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: Math.max(100, 2 * S) });
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
    for (const t of [fl.map, fl.normal, roughTex]) if (t) {
      t.repeat.set(HX * 2 / (fl.tileX || fl.tile || 2), HZ * 2 / (fl.tileZ || fl.tile || 2));
      t.needsUpdate = true;
    }
    const floorMat = L(new THREE.MeshLambertMaterial({ map: fl.map, color: fl.color ?? 0xffffff }),
      () => std({ map: fl.map, color: fl.color ?? 0xffffff, normalMap: fl.normal || null, roughnessMap: roughTex, roughness: roughTex ? 1 : (typeof fl.rough === 'number' ? fl.rough : 0.9), metalness: 0 }));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), floorMat);
    floorMat.userData.keepInLow = !!fl.keepInLow;
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
      scatter: (geometry, m, placements, counts) => {
        const mesh = new THREE.InstancedMesh(geometry, material(m), placements.length);
        const transform = new THREE.Matrix4();
        const scale = new THREE.Vector3(), tint = new THREE.Color();
        placements.forEach(([x,y,z,sx,sy,sz,yaw=0,color], i) => {
          mesh.setMatrixAt(i, transform.makeRotationY(yaw).scale(scale.set(sx,sy,sz)).setPosition(x,y + yo,z));
          if (color !== undefined) mesh.setColorAt(i, tint.setHex(color));
        });
        mesh.computeBoundingSphere();
        mesh.castShadow = !!m.castShadow;
        mesh.receiveShadow = true;
        scene.add(mesh);
        if (counts) this.detailBatches.push({mesh,counts});
      },
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

    /* solids: boxes, stair steps, ramp slices (js/battle/solids.js); here, how they look */
    this.boxes = layoutSolids(map);
    this.baseBoxCount = this.boxes.length;
    const cover = new THREE.Group(), noShadow = new THREE.Group();
    const kindOf = (b) => map.kinds[b.kind] || {};
    const addBox = (b) => {
      const y0 = b.y || 0;
      if (b.hidden) return;
      const k = kindOf(b);
      if (!k.hiddenBox) {
        const m = new THREE.Mesh(boxGeo(b.w, b.h, b.d, k.tile || 1), material({ ...k, color: b.color ?? k.color }));
        m.position.set(b.x, y0 + b.h / 2, b.z);
        ((b.noShadow || k.noShadow) ? noShadow : cover).add(m);
      }
      if (k.decor) k.decor(makeCtx(y0), b);
    };
    // Stairs: n solid steps rising along dir (each from the base up to its tread).
    const addStairs = (b) => {
      const s = span(b), y0 = b.y || 0, n = stairCount(b);
      const k = kindOf(b), base = b.base ?? y0;
      for (let i = 0; i < n; i++) {
        const top = y0 + (b.y1 - y0) * (i + 1) / n;
        const [bx, bz] = piece(s, b.dir, i, n);
        const m = new THREE.Mesh(boxGeo(bx[1] - bx[0], top - base, bz[1] - bz[0], k.tile || 1), material({ ...k, color: b.color ?? k.color }));
        m.position.set((bx[0] + bx[1]) / 2, (base + top) / 2, (bz[0] + bz[1]) / 2);
        cover.add(m);
      }
    };
    // Ramps: a smooth wedge to look at (thin steps for collision, standing and bullets).
    const addRamp = (b) => {
      const s = span(b), y0 = b.y || 0, base = b.base ?? 0;
      const k = kindOf(b);
      cover.add(new THREE.Mesh(wedgeGeo({ ...s, dir: b.dir, y0, y1: b.y1, base }, k.tile || 1), material({ ...k, color: b.color ?? k.color })));
    };
    for (const e of layoutPieces(map)) (e.stairs ? addStairs : e.ramp ? addRamp : addBox)(e);
    if (map.extra) map.extra(ctx, map, this.boxes);
    // light from objects (js/render/light-pool.js): [x, y, z, color, intensity, distance, angle], shining down
    this._fixtures = (typeof map.fixtures === 'function' ? map.fixtures(map) : map.fixtures || []).map(([x, y, z, color, intensity, distance, angle]) =>
      ({ p: new THREE.Vector3(x, y, z), dir: new THREE.Vector3(0, -1, 0), color, intensity, distance, angle }));
    this.pool = null;
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
      const n = Math.round(2400 * HX * HZ / 520), pos = new Float32Array(n * 3), rng = mulberry32(5);
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
    this._world = null;         // the map inside the Rust core, made on first use (see world)
    this._cover = null;
  }

  /* ---------- time of day and weather ---------- */
  // night: dark, moonlit outdoors / lights out indoors (bring a flashlight).
  // weather: 'auto' (the map's own), 'clear', 'rain', 'storm' (rain and lightning), 'snow'.
  // fog: on / off, with any weather. Rain, storms and snow only fall on outdoor maps.
  setAtmosphere(night = false, weather = 'auto', fog = false) {
    const map = this.map, a = this.atm, outdoor = !map.indoor;
    if (weather === 'fog') { weather = 'auto'; fog = true; }
    a.night = !!night; a.weather = weather; a.fog = !!fog;
    if (this.pool) this.pool.setFixtures(a.night && map.indoor ? [] : this._fixtures);   // power cut indoors; lanterns stay lit outside
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
    a.fogNear = near; a.fogFar = far;
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
    if (this.quality) { this._applyLights(); this._fogBanks(); this._maxEnv(); }
  }
  // Max graphics: the sun and fog for the post passes, and wet surfaces in rain (glossier, a
  // little darker; the floor reflections get stronger in world-post.js).
  _maxEnv() {
    const a = this.atm, wet = maxMode.on && (a.w === 'rain' || a.w === 'storm') && !this.map.indoor ? 1 : 0;
    this.scene.userData.maxEnv = maxMode.on ? { sun: a.night ? null : this.key, fog: this.scene.fog ? this.scene.fog.color : null, fogK: a.fog ? 0.03 : 0.006, wet } : null;
    if (wet === this._wet) return;
    this._wet = wet;
    this.scene.traverse((o) => {
      const m = o.isMesh && o.material;
      if (!m || !m.isMeshStandardMaterial) return;
      const u = m.userData;
      if (wet && u.dry === undefined) { u.dry = [m.roughness, m.color.getHex(), m.envMapIntensity]; m.roughness *= 0.35; m.color.multiplyScalar(0.8); m.envMapIntensity *= 1.8; }
      else if (!wet && u.dry !== undefined) { [m.roughness] = u.dry; m.color.setHex(u.dry[1]); m.envMapIntensity = u.dry[2]; delete u.dry; }
    });
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
    if (this.pool && cam) this.pool.update(cam);
    for (const g of this.glows) g.l.intensity = g.base * (0.85 + 0.15 * Math.sin(t * 3.1 + g.ph) - (Math.sin(t * 17 + g.ph * 3) > 0.97 ? 0.3 : 0));
  }

  /* ---------- graphics quality ---------- */
  setGraphics(q, renderer) {
    if (!['low', 'high', 'ultra'].includes(q)) q = 'standard';
    const detail = ['low','standard','high','ultra'].indexOf(q);
    for (const {mesh,counts} of this.detailBatches) {
      mesh.count = Math.min(counts[detail], mesh.instanceMatrix.count);
      mesh.visible = mesh.count > 0;
    }
    const tier = q === 'low' ? 'low' : (q === 'high' || q === 'ultra') ? 'high' : null;
    if (tier === 'low' && !this._tiers.low.size) {
      this.scene.traverse((o) => { if (o.isMesh && !o.userData.ownMaterial) { const lo = o.userData.loMat || o.material; const f = flatMaterial(lo); if (f) this._tiers.low.set(lo, f); } });
    }
    if (tier === 'high' && !this._tiers.high.size) {
      this.env = this.env || makeEnvMap(renderer);
      for (const [lo, make] of this._spec) this._tiers.high.set(lo, make());
    }
    const map = tier ? this._tiers[tier] : null;
    revertPackMaterials(this.scene);
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
    const want = this._fixtures.length && high ? (maxMode.on ? 12 : q === 'ultra' ? 8 : 6) : 0;
    if ((this.pool ? this.pool.lights.length : 0) !== want) {
      if (this.pool) this.pool.dispose();
      this.pool = want ? new LightPool(this.scene, want) : null;
      if (this.pool) this.pool.setFixtures(this.atm.night && this.map.indoor ? [] : this._fixtures);
    }
    const ks = q === 'ultra' ? 4096 : 2048;
    if (this.key.shadow.mapSize.x !== ks) { this.key.shadow.mapSize.set(ks, ks); if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; } }
    this.quality = q;
    // Enhanced Graphics pack v5: physically based materials and the map's baked light (the
    // match-mode copies of these maps share their geometry and coordinates)
    const scene = this.scene;
    const lightId = { yard: 'containers', winter: 'winter', casino: 'casino', school: 'school' }[this.mapId];
    applyPackMaterials(scene, q, renderer, { light: lightId && lightId + (this.small ? 'Small' : '') }).then(() => { if (this.scene === scene) { this._wet = undefined; this._maxEnv(); } }).catch((e) => console.warn('pack materials', e));
    this._applyLights();
    this._fogBanks();
    this.scene.environment = high && !this.atm.night ? this.env : null;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = high ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = high ? 1.3 : 1;
    this.quality = q;
    this._wet = undefined; this._maxEnv();
  }

  /* ---------- the map inside the Rust core ---------- */
  setBuilds(boxes) {
    void this.world;
    this.boxes.splice(this.baseBoxCount, this.boxes.length, ...boxes);
    if (this._world !== this._baseWorld) this._world.dispose();
    this._world = boxes.length ? this._makeWorld(false) : this._baseWorld;
  }

  // Collision, standing, vaulting, raycasts and pathfinding are answered by the core
  // (rust/core, through js/wasm/world.js): the same code the match modes use. Made on first
  // use, so an arena that is only looked at (a match mode's backdrop) never needs one.
  get world() {
    if (this._world) return this._world;
    this._world = this._baseWorld = this._makeWorld(true);
    const n = this._world.navNodes();
    this.nodeX = n.x; this.nodeZ = n.z; this.nodeY = n.y; this.nodeCount = this._world.nodeCount;
    return this._world;
  }
  _makeWorld(nav) {
    const map = this.map;
    const code = (b) => ({ minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, minZ: b.minZ, maxZ: b.maxZ });
    // Nothing is stood on within 1.6 m of a ceiling; outdoors there is no such limit.
    return new CoreWorld({ hx: this.hx, hz: this.hz, wallH: map.ceiling ? this.wallH : Infinity,
      ceil: map.ceiling ? this.wallH : 0, solids: [...this.boxes.map(code), ...edgeSolids(this.hx, this.hz)], hazards: this.hazards, nav });
  }
  // Boxes in the grid cells within r of a point (each once).
  near(x, z, r, out = []) {
    const idx = this.world.near(x, z, r, this._ni || (this._ni = []));
    out.length = 0;
    for (const k of idx) if (k < this.boxes.length) out.push(this.boxes[k]);
    return out;
  }

  /* ---------- standing and collision ---------- */
  // Does box b block a body whose feet are at y?
  static blocks(b, y) { return b.maxY > y + STEP + 1e-4 && b.minY < y + BODY_H; }
  // Height of what you stand on at (x, z) with feet near y: the floor or a top you can step to.
  groundAt(x, z, y) { return this.world.groundAt(x, z, y); }
  // Push a circle (x, z, radius r, feet at p.y) out of every box that blocks it, and keep it
  // inside the walls.
  resolve(p, r = BODY_R) { return this.world.resolve(p, r); }
  // One step of a body p { x, y, z, vy }: move by (dx, dz) in steps too short to pass through
  // anything, up stairs as it goes, then stand on what is underneath or fall. True on the ground.
  stepBody(p, dx, dz, dt, r = BODY_R) { return this.world.stepBody(p, dx, dz, dt, r); }
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
  vaultTarget(x, y, z, dx, dz) { return this.world.vaultTarget(x, y, z, dx, dz, BODY_R); }

  /* ---------- raycast ---------- */
  // Nearest hit of the ray o + t d (d unit) with solids, walls, floor or ceiling, up to maxT.
  // Fills out = { t, n: [x, y, z] } and returns t (Infinity if nothing).
  raycast(o, d, maxT = 200, out = null) {
    const w = this.world, t = w.raycast(o, d, maxT);
    if (out) {
      out.t = t < 0 ? maxT : t; out.n[0] = out.n[1] = out.n[2] = 0;
      if (t >= 0) out.n[w.axis] = d[w.axis] > 0 ? -1 : 1;
    }
    return t < 0 ? Infinity : t;
  }
  // Clear line between two points (arrays [x, y, z])?
  sightLine(a, b) { return this.world.sight(a, b); }

  /* ---------- navigation ---------- */
  // The core keeps one node per 0.5 m cell and level you can stand on (the floor, a box top,
  // a stair tread, a ramp, an upper floor); nodeX / nodeZ / nodeY are copies of them.
  // The node at (x, z) you would stand on with feet near y (or -1).
  nodeAt(x, z, y = 0) { void this.world; return this._baseWorld.nodeAt(x, z, y); }
  walkable(x, z, y = 0) { return this.nodeAt(x, z, y) >= 0; }
  _nearestNode(x, z, y = 0) { return this.world.nearestNode(x, z, y); }
  // Can a body walk straight from a to b (each [x, z, y]), stepping and dropping as it goes?
  clearWalk(a, b) { return this.world.clearWalk(a, b); }
  // A* over the nodes, then string-pulled. Returns waypoints [[x, z, y], ...] ending at the
  // goal (or [] if unreachable).
  findPath(ax, az, bx, bz, ay = 0, by = 0) {
    const world = this.world;
    if (this.mapId !== ROYALE_MAP_ID) return world.path(ax, az, ay, bx, bz, by);
    const base = this._baseWorld;
    if (base.clearWalk([ax, az, ay], [bx, bz, by]) &&
      (world === base || (Math.abs(ay - by) < .1 && world.walkClear(ax, az, bx, bz, BODY_R + .08, ay)))) return [[bx,bz,by,0]];
    if (world.nodeCount) return world.path(ax, az, ay, bx, bz, by);
    const path = base.path(ax, az, ay, bx, bz, by);
    const builds = this.boxes.slice(this.baseBoxCount);
    let from = [ax,az,ay];
    for (const to of path) {
      const [x,z,y] = from;
      const crossesBuild = builds.some(b =>
        b.minX < Math.max(x,to[0]) + BODY_R && b.maxX > Math.min(x,to[0]) - BODY_R &&
        b.minZ < Math.max(z,to[1]) + BODY_R && b.maxZ > Math.min(z,to[1]) - BODY_R &&
        b.minY < Math.max(y,to[2]) + BODY_H && b.maxY > Math.min(y,to[2]) + STEP);
      if (crossesBuild) {
        // Keep edits cheap. Build fresh navigation only when an actual route may cross a piece.
        world.buildNavigation();
        return world.path(ax, az, ay, bx, bz, by);
      }
      from = to;
    }
    return path;
  }

  /* ---------- cover spots and spawns ---------- */
  // Spots beside cover a bot can stand at: { x, z, y, low (crouch-high cover), bx, bz }.
  get coverSpots() { return this._cover || (this._cover = this._buildCover()); }
  _buildCover() {
    this.world;      // the node heights come with it
    const spots = [];
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
        if (k >= 0 && Math.abs(this.nodeY[k] - base) < 0.2) spots.push({ x, z, y: this.nodeY[k], low: hh < 1.4, bx: cx, bz: cz });
      }
    }
    return spots;
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
