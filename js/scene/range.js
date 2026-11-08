// The range: an indoor firing hall with one lane. A target carriage runs on a floor rail to
// the selected distance; the backstop sits 1.5 m behind it and both move together.
//
// Original design: tiled concrete floor, steel grating and a "do not cross" ledge at the
// firing line, panelled side walls with lamps, a low concrete ceiling with beams and light
// panels that opens up to a truss roof over the far end, side benches with spent brass, and
// a control screen beside the lane. Standard graphics uses Lambert materials and no shadows;
// high graphics (setGraphics) swaps in textured PBR materials, shadows and tone mapping.
import * as THREE from '../../vendor/three/three.module.min.js?v=3d9f8db-mw7k0mnu';
import { BulletHoles } from './holes.js?v=3d9f8db-mw7k0mnu';
import { buildDummy, raycastDummy } from './dummy.js?v=3d9f8db-mw7k0mnu';
import { DotField } from './dots.js?v=3d9f8db-mw7k0mnu';
import { mergeStatic, makeEnvMap } from './sight-model.js?v=3d9f8db-mw7k0mnu';
import { bakeDetail, bakeNormal, triplanar } from '../render/gpu-tex.js?v=3d9f8db-mw7k0mnu';
import { flatMaterial } from './low.js?v=3d9f8db-mw7k0mnu';
import { mulberry32 } from '../core/prng.js?v=3d9f8db-mw7k0mnu';
import {
  backstopPlate, backstopMaps, duskSky, padTexture, concreteTiles, floorGrate, wallPanels, ceilingConcrete,
  hazardStripes, ledgeFace, paperTarget, drawPanel, withRes, setNormalBaker,
} from './range-tex.js?v=3d9f8db-mw7k0mnu';

export const EYE_HEIGHT = 1.6;
export const ROOM = { halfWidth: 4, height: 3.6, near: 3, far: 24 };
export const WALL_GAP = 1.5;        // backstop distance behind the target plane
export const PAPER_SIZE = 1.0;      // paper target board edge, metres (centred at eye height)
export const LANE_HALF = 1.6;       // grating and ledge half width (your movement box is +/-1.5)
export const LEDGE_Z = -1.1;        // the near face of the firing-line ledge
const CEILING_END = -15;            // the low ceiling stops here; truss roof beyond
export const MAX_CASINGS = 600;

function box(group, mat, w, h, d, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  group.add(m);
  return m;
}
function plane(group, mat, w, h, x, y, z, rx = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0, 'YXZ');
  group.add(m);
  return m;
}

export class Range {
  constructor(scene) {
    this.scene = scene;
    this.high = false;
    this.quality = 'standard';
    this._hiSpec = new Map();     // standard material -> { make(q), detail } for high and ultra
    this._tierMats = { low: new Map(), high: new Map(), ultra: new Map() };
    // Standard material, plus how to build its high / ultra version. make(q) gets 'high' or
    // 'ultra'; detail: [kind, tiles per metre, strength] of the ultra micro-detail layer.
    const L = (lo, make, detail = null) => { if (make) this._hiSpec.set(lo, { make, detail }); return lo; };
    // Ultra: the same procedural texture drawn at k x resolution (normals baked on the GPU),
    // with the standard texture's tiling.
    const up = (q, fn, like, k = 4) => {
      if (q !== 'ultra') return like;
      const t = withRes(k, fn);
      const copy = (a, b) => { if (a && b && b.repeat) a.repeat.copy(b.repeat); };
      if (t.isTexture) copy(t, like); else for (const key of Object.keys(t)) copy(t[key], like[key]);
      return t;
    };
    const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 1.2, ...o });

    scene.background = new THREE.Color(0x14161a);
    scene.fog = new THREE.Fog(0x1a1c20, 25, 80);

    /* ---------- lights ---------- */
    this.hemi = new THREE.HemisphereLight(0xb0b8c8, 0x6a6058, 1.6);
    scene.add(this.hemi);
    // The ceiling lights, as one directional light from above and slightly behind you. Casts
    // the shadows in high graphics.
    const key = new THREE.DirectionalLight(0xfff0dc, 1.1);
    key.target.position.set(0, 0, -10);
    key.position.set(2.5, 12, 5).add(key.target.position);
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 40 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    this.key = key;
    this.fill = new THREE.DirectionalLight(0xbcc8e0, 0.35);
    this.fill.position.set(-2, 3, 6);
    scene.add(this.fill);

    const len = ROOM.far + ROOM.near;
    const midZ = (ROOM.near - ROOM.far) / 2;
    const W = ROOM.halfWidth;

    /* ---------- outside (seen through the open roof at the far end) ---------- */
    this.skyTex = duskSky();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16),
      new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    scene.add(sky);

    /* ---------- floor ---------- */
    const tiles = concreteTiles();
    tiles.map.repeat.set(W, len / 2);
    tiles.normal.repeat.copy(tiles.map.repeat); tiles.rough.repeat.copy(tiles.map.repeat);
    const floorMat = L(new THREE.MeshLambertMaterial({ map: tiles.map }),
      (q) => { const t = up(q, concreteTiles, tiles); return std({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1, metalness: 0 }); },
      ['concrete', 1.5, 0.9]);
    const floor = plane(scene, floorMat, W * 2, len, 0, 0, midZ, -Math.PI / 2);

    // Grating where you stand (between the back wall and the ledge).
    const grate = floorGrate();
    const gz0 = ROOM.near, gz1 = LEDGE_Z - 0.2;
    grate.map.repeat.set(LANE_HALF * 2 / 0.25, (gz0 - gz1) / 0.25);
    grate.normal.repeat.copy(grate.map.repeat);
    const grateMat = L(new THREE.MeshLambertMaterial({ map: grate.map, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      (q) => { const t = up(q, floorGrate, grate, 8); return std({ map: t.map, normalMap: t.normal, roughness: 0.55, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); },
      ['brushed', 3, 0.6]);
    const grating = plane(scene, grateMat, LANE_HALF * 2, gz0 - gz1, 0, 0.004, (gz0 + gz1) / 2, -Math.PI / 2);

    // Hazard stripe along the floor at the firing line.
    const hz = hazardStripes();
    hz.repeat.set(LANE_HALF * 2 / 0.5, 1);
    const hazardMat = L(new THREE.MeshLambertMaterial({ map: hz, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      () => std({ map: hz, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      ['paint', 2, 0.8]);
    const hazardStrip = plane(scene, hazardMat, LANE_HALF * 2, 0.14, 0, 0.006, LEDGE_Z + 0.1, -Math.PI / 2);

    // Steel: one shared dark painted steel for structure.
    const steel = L(new THREE.MeshLambertMaterial({ color: 0x2a2d31 }),
      () => std({ color: 0x2e3135, roughness: 0.55, metalness: 0.7 }), ['paint', 1.5, 1]);
    const bright = L(new THREE.MeshLambertMaterial({ color: 0x70757b }),
      () => std({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.9 }), ['brushed', 4, 0.6]);

    // Target rail down the middle of the lane, with sleepers.
    const rails = new THREE.Group();
    const rz0 = LEDGE_Z - 0.5, rz1 = -ROOM.far + 0.6;
    for (const x of [-0.11, 0.11]) box(rails, bright, 0.035, 0.03, rz0 - rz1, x, 0.015, (rz0 + rz1) / 2);
    for (let z = rz0; z > rz1; z -= 0.6) box(rails, steel, 0.4, 0.012, 0.06, 0, 0.006, z);

    /* ---------- firing line ---------- */
    const ledge = new THREE.Group();
    box(ledge, steel, LANE_HALF * 2, 0.06, 0.3, 0, 0.84, LEDGE_Z - 0.15);           // top
    box(ledge, steel, LANE_HALF * 2, 0.8, 0.04, 0, 0.42, LEDGE_Z - 0.02);            // face towards you
    for (const x of [-LANE_HALF + 0.05, LANE_HALF - 0.05]) box(ledge, steel, 0.06, 0.84, 0.3, x, 0.42, LEDGE_Z - 0.15);
    const faceTex = ledgeFace(LANE_HALF * 2);
    const faceMat = L(new THREE.MeshLambertMaterial({ map: faceTex }), (q) => std({ map: up(q, () => ledgeFace(LANE_HALF * 2), faceTex, 2), roughness: 0.7, metalness: 0.5 }), ['paint', 2, 1]);
    const ledgeFront = plane(scene, faceMat, LANE_HALF * 2, 0.16, 0, 0.75, LEDGE_Z + 0.002);

    /* ---------- side walls, far wall, benches, lamps ---------- */
    const wp = wallPanels();
    wp.map.repeat.set(len / 1.2, 1);
    wp.normal.repeat.copy(wp.map.repeat);
    const wallMat = L(new THREE.MeshLambertMaterial({ map: wp.map }),
      (q) => { const t = up(q, wallPanels, wp); return std({ map: t.map, normalMap: t.normal, roughness: 0.6, metalness: 0.55 }); },
      ['paint', 1.2, 1]);
    // Side, far and back walls share one material; the end walls' UVs are scaled so the
    // panels keep their 1.2 m width. One merged mesh.
    const wallG = new THREE.Group();
    for (const sd of [-1, 1]) plane(wallG, wallMat, len, ROOM.height, sd * W, ROOM.height / 2, midZ, 0, sd * -Math.PI / 2);
    for (const [z, ry] of [[-ROOM.far, 0], [ROOM.near, Math.PI]]) {
      const m = plane(wallG, wallMat, W * 2, ROOM.height, 0, ROOM.height / 2, z, 0, ry);
      const uv = m.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (W * 2) / len);
    }
    mergeStatic(wallG);
    scene.add(wallG);
    const walls = wallG.children;

    // Benches: a long counter along each wall, and shooting tables in the next lanes.
    const benchTop = L(new THREE.MeshLambertMaterial({ color: 0x3b3f44 }), () => std({ color: 0x40454b, roughness: 0.45, metalness: 0.75 }), ['brushed', 2, 0.7]);
    const benches = new THREE.Group();
    const props = [];   // casings on benches: [x, y, z]
    for (const s of [-1, 1]) {
      const bx = s * (W - 0.35);
      box(benches, benchTop, 0.66, 0.05, 9, bx, 1.0, -4.5);
      box(benches, steel, 0.6, 0.94, 0.04, bx, 0.48, -0.02);
      for (let z = -0.5; z > -9; z -= 2.8) { box(benches, steel, 0.05, 1.0, 0.05, bx - s * 0.28, 0.5, z); box(benches, steel, 0.05, 1.0, 0.05, bx + s * 0.28, 0.5, z); }
      box(benches, steel, 0.6, 0.04, 9, bx, 0.3, -4.5);                             // shelf
      // next lane's shooting table, beside the firing line
      const tx = s * 2.45;
      box(benches, benchTop, 1.3, 0.05, 0.75, tx, 0.95, LEDGE_Z - 0.2);
      for (const dx of [-0.6, 0.6]) for (const dz of [-0.3, 0.3]) box(benches, steel, 0.05, 0.95, 0.05, tx + dx, 0.475, LEDGE_Z - 0.2 + dz);
      const rng = mulberry32(s > 0 ? 71 : 73);
      for (let i = 0; i < 26; i++) props.push([tx + (rng() - 0.5) * 1.1, 0.978, LEDGE_Z - 0.2 + (rng() - 0.5) * 0.6]);
      for (let i = 0; i < 30; i++) props.push([bx + (rng() - 0.5) * 0.5, 1.028, -0.5 - rng() * 8]);
    }

    // Ear defenders on the benches (yellow cups on a black band).
    const yellow = L(new THREE.MeshLambertMaterial({ color: 0xd8b020 }), () => std({ color: 0xd8b020, roughness: 0.45, metalness: 0 }), ['paint', 8, 0.5]);
    const black = L(new THREE.MeshLambertMaterial({ color: 0x18191b }), () => std({ color: 0x18191b, roughness: 0.6, metalness: 0 }), ['paint', 8, 0.5]);
    const muffs = new THREE.Group();
    const cupGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14);
    const placeMuff = (x, y, z, ry) => {
      const g = new THREE.Group();
      for (const dx of [-0.07, 0.07]) { const c = new THREE.Mesh(cupGeo, yellow); c.rotation.z = Math.PI / 2; c.position.set(dx, 0.045, 0); g.add(c); }
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 16, Math.PI), black);
      band.position.y = 0.05;
      g.add(band);
      g.position.set(x, y, z); g.rotation.y = ry;
      muffs.add(g);
    };
    placeMuff(-2.2, 0.975, LEDGE_Z - 0.1, 0.3);
    placeMuff(2.75, 0.975, LEDGE_Z - 0.3, -0.5);
    placeMuff(W - 0.35, 1.025, -2.8, 1.2);
    placeMuff(-(W - 0.35), 1.025, -5.6, -0.8);

    // Wall lamps (emissive: cheap and they read as light sources).
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2b8 });
    const lamps = new THREE.Group();
    for (const s of [-1, 1]) for (let z = -1.5; z > -ROOM.far; z -= 4.2) {
      box(lamps, lampMat, 0.05, 0.12, 0.5, s * (W - 0.03), 2.5, z);
      box(lamps, steel, 0.08, 0.04, 0.58, s * (W - 0.05), 2.58, z);
    }

    /* ---------- ceiling ---------- */
    const ceilTex = ceilingConcrete();
    const ceilLen = ROOM.near - CEILING_END;
    ceilTex.repeat.set(W * 2 / 2, ceilLen / 2);
    const ceilMat = L(new THREE.MeshLambertMaterial({ map: ceilTex }), (q) => std({ map: up(q, ceilingConcrete, ceilTex), roughness: 0.95, metalness: 0 }), ['concrete', 1, 0.8]);
    const ceiling = plane(scene, ceilMat, W * 2, ceilLen, 0, ROOM.height, (ROOM.near + CEILING_END) / 2, Math.PI / 2);
    const frame = new THREE.Group();
    for (let z = ROOM.near - 0.5; z > CEILING_END; z -= 3) {
      box(frame, steel, W * 2, 0.4, 0.3, 0, ROOM.height - 0.2, z);                  // beam
      if (z - 1.5 > CEILING_END) for (const x of [-1.7, 1.7]) box(lamps, lampMat, 1.3, 0.02, 0.3, x, ROOM.height - 0.06, z - 1.5);   // light panel
    }
    box(frame, steel, W * 2, 0.9, 0.4, 0, ROOM.height - 0.45, CEILING_END);       // bulkhead where the roof opens up
    // Truss roof over the far end, open to the sky.
    for (let z = CEILING_END - 1.5; z > -ROOM.far - 1; z -= 3) {
      box(frame, steel, W * 2 + 0.3, 0.2, 0.2, 0, ROOM.height + 1.4, z);
      for (const s of [-1, 1]) {
        box(frame, steel, 0.16, 1.5, 0.16, s * (W - 0.08), ROOM.height + 0.7, z);
        const brace = box(frame, steel, 0.08, 0.08, 2.4, s * (W - 1.1), ROOM.height + 0.9, z);
        brace.rotation.set(0, Math.PI / 2, s * 0.5);
      }
    }
    for (const s of [-1, 1]) box(frame, steel, 0.14, 0.14, ROOM.far + CEILING_END + 1, s * 2.2, ROOM.height + 1.4, (CEILING_END - ROOM.far) / 2);
    for (const s of [-1, 1]) box(frame, steel, 0.2, 0.2, len, s * (W - 0.1), ROOM.height, midZ);   // wall plates
    // Upper walls above the open end, so the roof gap shows sky rather than the void.
    const upper = new THREE.Group();
    for (const s of [-1, 1]) box(upper, steel, 0.1, 1.5, ROOM.far + CEILING_END, s * W, ROOM.height + 0.75, (CEILING_END - ROOM.far) / 2);

    /* ---------- control screen beside the lane ---------- */
    this.boardCv = document.createElement('canvas');
    this.boardCv.width = 1024; this.boardCv.height = 640;
    this.boardTex = new THREE.CanvasTexture(this.boardCv);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.boardTex.anisotropy = 8;
    const screen = new THREE.Group();
    plane(screen, new THREE.MeshBasicMaterial({ map: this.boardTex, toneMapped: false }), 1.6, 1.0, 0, 0, 0.021);
    box(screen, steel, 1.72, 1.1, 0.04, 0, 0, 0);
    box(screen, steel, 0.08, 1.5, 0.08, 0, -1.0, -0.06);
    box(screen, steel, 0.5, 0.04, 0.4, 0, -1.73, -0.06);
    screen.position.set(-2.35, 1.75, -2.6);
    screen.rotation.y = 0.55;

    // All static structure in one merge: one draw call per material (steel, rail steel,
    // bench tops, lamps, ear defenders, the screen).
    const yard = new THREE.Group();
    for (const g of [rails, ledge, benches, frame, upper, lamps, muffs, screen]) yard.add(g);
    mergeStatic(yard);
    scene.add(yard);
    this.boardLabel = 'dummy'; this.boardMode = 'dummy';

    /* ---------- spent brass ---------- */
    this.casings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0048, 0.0048, 0.022, 8),
      L(new THREE.MeshLambertMaterial({ color: 0xc89a4a }), () => std({ color: 0xd4a85a, roughness: 0.28, metalness: 1, envMapIntensity: 1.2 })), MAX_CASINGS);
    this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casings.frustumCulled = false;
    this.casings.count = 0;
    this._cn = 0; this._cm = new THREE.Matrix4(); this._cq = new THREE.Quaternion(); this._ce = new THREE.Euler();
    this._cp = new THREE.Vector3(); this._cs = new THREE.Vector3(1, 1, 1);
    this._crng = mulberry32(99);
    scene.add(this.casings);
    const r = this._crng;
    for (let i = 0; i < 70; i++) this.addCasing((r() - 0.5) * 3.0, -0.1 - r() * (-LEDGE_Z - 0.2));      // at your feet
    for (let i = 0; i < 70; i++) this.addCasing((r() - 0.5) * 2.8, LEDGE_Z - 0.4 - r() * r() * 3);  // past the ledge
    for (const p of props) this.addCasing(p[0], p[2], p[1]);
    this._permanentCasings = this._cn;

    /* ---------- the target carriage (moves with the distance) ---------- */
    this.wallGroup = new THREE.Group();
    scene.add(this.wallGroup);
    const bpMaps = backstopMaps();
    const bpTex = backstopPlate();
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, ROOM.height),
      L(new THREE.MeshLambertMaterial({ map: bpTex, color: 0x9a9a9a }), (q) => { const m = up(q, backstopMaps, bpMaps); return std({ map: up(q, backstopPlate, bpTex), color: 0xa0a0a0, normalMap: m.normal, roughnessMap: m.rough, roughness: 1, metalness: 0.6 }); },
        ['paint', 1, 0.8]));
    wall.position.set(0, ROOM.height / 2, -WALL_GAP);
    this.wallGroup.add(wall);
    // Round carriage: hazard-striped rim around a painted top, on the rail.
    const padTex = padTexture();
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.6, 40),
      L(new THREE.MeshLambertMaterial({ map: padTex }), (q) => std({ map: up(q, padTexture, padTex), roughness: 0.7, metalness: 0.2 }), ['paint', 3, 0.8]));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.09;
    this.wallGroup.add(pad);
    const rimTex = hazardStripes(); rimTex.repeat.set(12, 1);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.62, 0.09, 40, 1, true),
      L(new THREE.MeshLambertMaterial({ map: rimTex }), () => std({ map: rimTex, roughness: 0.6, metalness: 0.2 }), ['paint', 4, 0.8]));
    rim.position.y = 0.045;
    this.wallGroup.add(rim);
    // Lamp over the target, so it stands out against the dark backstop.
    this.spot = new THREE.SpotLight(0xfff4e6, 18, 9, 0.6, 0.6, 2);
    this.spot.position.set(0, ROOM.height - 0.3, 2.2);
    this.spot.target.position.set(0, 1.3, 0);
    this.wallGroup.add(this.spot, this.spot.target);

    this.dummy = buildDummy();
    this.dummy.position.y = 0;
    this.wallGroup.add(this.dummy);

    // Paper target: a ringed card on a board, centred at eye height (the aim point).
    this.paper = new THREE.Group();
    const pTex = paperTarget(PAPER_SIZE);
    const paperMat = new THREE.MeshLambertMaterial({ map: pTex });
    paperMat.userData.keepInLow = true;   // the rings are the target
    plane(this.paper, L(paperMat, (q) => std({ map: up(q, () => paperTarget(PAPER_SIZE), pTex), roughness: 0.9, metalness: 0 })),
      PAPER_SIZE, PAPER_SIZE, 0, EYE_HEIGHT, 0);
    box(this.paper, steel, PAPER_SIZE + 0.06, PAPER_SIZE + 0.06, 0.03, 0, EYE_HEIGHT, -0.02);
    box(this.paper, steel, 0.06, EYE_HEIGHT - PAPER_SIZE / 2, 0.06, 0, (EYE_HEIGHT - PAPER_SIZE / 2) / 2, -0.06);
    mergeStatic(this.paper);
    this.paper.visible = false;
    this.wallGroup.add(this.paper);

    this.dots = new DotField(this.wallGroup);
    this.holes = new BulletHoles(this.wallGroup);

    /* ---------- shadows (used only while the key light casts, i.e. high graphics) ---------- */
    for (const o of [floor, grating, hazardStrip, ceiling, ledgeFront, wall, pad, ...walls]) o.receiveShadow = true;
    for (const g of [yard, this.paper]) g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.dummy.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    rim.castShadow = true;

    // Nothing in the hall moves except the target carriage, so skip per-frame matrix rebuilds.
    scene.traverse((o) => {
      if (o.isMesh && o.parent === scene && o !== this.casings) { o.updateMatrix(); o.matrixAutoUpdate = false; }
    });
    this._d = [0, 0, 0]; this._o = [0, 0, 0];
    this._dh = { t: 0, p: [0, 0, 0], n: [0, 0, 0], zone: null };
    this.distance = 10;
    this.setDistance(10);
    this.setGraphicsLights(false);
  }

  setGraphicsLights(q) {
    const high = q === 'high' || q === 'ultra';
    // Low: one hemisphere light only (flat, cheapest).
    this.key.visible = q !== 'low';
    // Standard graphics keeps to two lights (each light is per-pixel work on every surface);
    // high and ultra add the fill and the lamp over the target.
    this.hemi.intensity = high ? 0.9 : q === 'low' ? 2.8 : 2.0;
    this.key.intensity = high ? 2.6 : 1.5;
    this.fill.intensity = 0.5;
    this.spot.intensity = 45;
    this.fill.visible = high;
    this.spot.visible = high;
  }

  // q: 'standard' | 'high' | 'ultra'.
  //   standard: cheap Lambert materials, no shadows (school PCs).
  //   high:     physically based materials with normal and roughness maps, the key light
  //             casting soft shadows (2048), image-based lighting, filmic tone mapping.
  //   ultra:    for a graphics card: every surface texture drawn at 2-8x resolution with
  //             GPU-baked normal maps, 4096 x 4096 micro-detail (concrete pores, paint and
  //             scratches, brushed steel) mapped by 3D position, 4096 shadows and a shadow-
  //             casting lamp over the target.
  // Materials for high / ultra are built the first time that level is used.
  setGraphics(q, renderer) {
    if (q === true) q = 'high';
    if (!['low', 'high', 'ultra'].includes(q)) q = 'standard';
    if (q === 'low' && !this._tierMats.low.size) {
      this.scene.traverse((o) => {
        if (!o.isMesh) return;
        const lo = o.userData.loMat || o.material;
        if (!this._tierMats.low.has(lo)) { const f = flatMaterial(lo); if (f) this._tierMats.low.set(lo, f); }
      });
    }
    if ((q === 'high' || q === 'ultra') && !this._tierMats[q].size) this._build(q, renderer);
    this.quality = q;
    this.high = q === 'high' || q === 'ultra';
    const tier = this._tierMats[q];
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      const lo = o.userData.loMat || o.material;
      o.userData.loMat = lo;
      o.material = (tier && tier.get(lo)) || lo;
    });
    this.key.castShadow = this.high;
    const ks = q === 'ultra' ? 4096 : 2048;
    if (this.key.shadow.mapSize.x !== ks) {
      this.key.shadow.mapSize.set(ks, ks);
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    }
    this.spot.castShadow = q === 'ultra';
    this.spot.shadow.mapSize.set(2048, 2048);
    this.spot.shadow.bias = -0.0005;
    this.setGraphicsLights(q);
    this.scene.environment = this.high ? this.env : null;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = this.high ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = this.high ? 1.5 : 1;
  }

  _build(q, renderer) {
    if (!this.env) this.env = makeEnvMap(renderer);
    const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    const M = this._tierMats[q];
    if (q === 'ultra') {
      setNormalBaker((cv, strength, wrap) => bakeNormal(renderer, cv, strength, wrap));
      this._detail = this._detail || {};
    }
    const detail = (kind) => (this._detail[kind] = this._detail[kind] || bakeDetail(renderer, kind, Range.ULTRA_TEX));
    try {
      for (const [lo, spec] of this._hiSpec) {
        const hi = spec.make(q);
        for (const k of ['map', 'normalMap', 'roughnessMap']) if (hi[k]) { hi[k].anisotropy = aniso; hi[k].needsUpdate = !hi[k].isRenderTargetTexture; }
        if (q === 'ultra' && spec.detail) {
          const [kind, scale, strength] = spec.detail;
          triplanar(hi, { detail: detail(kind), detailScale: scale, detailStrength: strength });
        }
        M.set(lo, hi);
      }
      this.dummy.traverse((o) => {
        if (!o.isMesh || M.has(o.material)) return;
        const m = o.material.vertexColors
          ? new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xd8d0c8, roughness: 0.82, metalness: 0, envMapIntensity: 0.7 })   // painted foam
          : new THREE.MeshStandardMaterial({ color: o.material.color, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.7 });             // steel base
        if (q === 'ultra') triplanar(m, { detail: detail(o.material.vertexColors ? 'concrete' : 'paint'), detailScale: 6, detailStrength: 0.5 });
        M.set(o.material, m);
      });
    } finally {
      setNormalBaker(null);
    }
  }

  setDistance(d) {
    this.distance = d;
    this.wallGroup.position.z = -d;
    this.updateBoard();
  }

  // label: what is on the lane ("dummy", "6 red dots, moving"); mode: dummy | paper | dots.
  setBoardLabel(label, mode = this.boardMode) { this.boardLabel = label; this.boardMode = mode; this.updateBoard(); }
  updateBoard() {
    drawPanel(this.boardCv.getContext('2d'), this.boardCv.width, this.boardCv.height, this.distance, this.boardMode || 'dummy', this.boardLabel || 'dummy');
    this.boardTex.needsUpdate = true;
  }

  // A spent casing on the floor (or a bench top, y) at (x, z), lying at a random angle.
  // The oldest of the ones you fired is recycled; the scenery brass stays.
  addCasing(x, z, y = 0.006) {
    const keep = this._permanentCasings || 0;
    const i = this._cn < MAX_CASINGS ? this._cn : keep + ((this._cn - keep) % (MAX_CASINGS - keep));
    this._cn++;
    this._ce.set(Math.PI / 2, this._crng() * Math.PI * 2, 0, 'YXZ');
    this._cq.setFromEuler(this._ce);
    this._cp.set(x, y, z);
    this._cm.compose(this._cp, this._cq, this._cs);
    this.casings.setMatrixAt(i, this._cm);
    this.casings.count = Math.min(MAX_CASINGS, this._cn);
    this.casings.instanceMatrix.needsUpdate = true;
  }

  // Hitscan from the eye (ex, ey, ez in world metres; default: standing on the firing line)
  // along (yaw, pitch) in degrees, in the target group's frame. Fills hit: plane = [x, y]
  // where the ray crosses the target plane, relative to the aim point (eye height: the
  // dummy's head centre and the paper target's centre), and kind = 'dummy' | 'paper' |
  // 'wall' | null with the surface point p, normal n and dummy zone. Returns hit.kind.
  raycast(yawDeg, pitchDeg, hit, ex = 0, ey = EYE_HEIGHT, ez = 0) {
    const yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
    const cp = Math.cos(pitch);
    const d = this._d, o = this._o;
    d[0] = Math.sin(yaw) * cp; d[1] = Math.sin(pitch); d[2] = -Math.cos(yaw) * cp;
    o[0] = ex; o[1] = ey; o[2] = ez + this.distance;     // eye, in the target frame
    hit.kind = null;
    hit.planeOk = false;
    if (d[2] >= -1e-9) return null;                        // pointing away from the target
    const tp = o[2] / -d[2];
    hit.plane[0] = o[0] + tp * d[0];
    hit.plane[1] = o[1] + tp * d[1] - EYE_HEIGHT;   // relative to the aim point
    hit.planeOk = true;
    if (this.dummy.visible && raycastDummy(o, d, this._dh)) {
      hit.kind = 'dummy'; hit.zone = this._dh.zone;
      hit.p[0] = this._dh.p[0]; hit.p[1] = this._dh.p[1]; hit.p[2] = this._dh.p[2];
      hit.n[0] = this._dh.n[0]; hit.n[1] = this._dh.n[1]; hit.n[2] = this._dh.n[2];
      return hit.kind;
    }
    if (this.paper.visible && Math.abs(hit.plane[0]) <= PAPER_SIZE / 2 && Math.abs(hit.plane[1]) <= PAPER_SIZE / 2) {
      hit.kind = 'paper'; hit.zone = null;
      hit.p[0] = hit.plane[0]; hit.p[1] = hit.plane[1] + EYE_HEIGHT; hit.p[2] = 0;
      hit.n[0] = 0; hit.n[1] = 0; hit.n[2] = 1;
      return hit.kind;
    }
    const tw = (o[2] + WALL_GAP) / -d[2];
    const x = o[0] + tw * d[0], y = o[1] + tw * d[1];
    if (x < -ROOM.halfWidth || x > ROOM.halfWidth || y < 0 || y > ROOM.height) return null;
    hit.kind = 'wall'; hit.zone = null;
    hit.p[0] = x; hit.p[1] = y; hit.p[2] = -WALL_GAP;
    hit.n[0] = 0; hit.n[1] = 0; hit.n[2] = 1;
    return hit.kind;
  }
}
Range.ULTRA_TEX = 4096;   // ultra micro-detail size (tests use less: software rendering)
