// The range: a single lane. A training dummy stands at the selected distance with the
// backstop 1.5 m behind it; both slide together. Low poly, Lambert/basic materials, no shadows.
import * as THREE from '../../vendor/three/three.module.min.js';
import { BulletHoles } from './holes.js';
import { buildDummy, raycastDummy } from './dummy.js';
import { DotField } from './dots.js';
import { mergeStatic } from './sight-model.js';
import { mulberry32 } from '../core/prng.js';
import { treadPlate, laneMarkings, corrugatedWall, backstopPlate, duskSky, padTexture, drawBoard,
  treadPlateMaps, corrugatedMaps, backstopMaps } from './range-tex.js';

export const EYE_HEIGHT = 1.6;
export const ROOM = { halfWidth: 4, height: 3.6, near: 3, far: 24 };
export const WALL_GAP = 1.5; // back wall distance behind the target plane

// Original industrial-yard look: steel tread-plate floor, corrugated side walls with a safety
// band, guard rails, an open truss roof under a dusk sky, a riveted backstop, a distance board
// and spent brass at the firing line. Static parts that share a material are merged.
const MERGE_COLOR = (group) => mergeStatic(group);

function box(group, mat, w, h, d, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  group.add(m);
  return m;
}

export const MAX_CASINGS = 400;

export class Range {
  constructor(scene) {
    this.scene = scene;
    scene.background = new THREE.Color(0x241a16);
    scene.fog = new THREE.Fog(0x7a5546, 30, 95);

    this.hemi = new THREE.HemisphereLight(0xa8b4d0, 0x3a2a20, 1.25);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffb478, 1.3);      // low sun down range
    sun.position.set(-2, 2.5, -8);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc8d4ff, 0.7);    // cool fill from behind you
    fill.position.set(1.5, 3, 4);
    scene.add(fill);
    this.sun = sun; this.fill = fill;
    // High graphics only: a warm key light from behind your left shoulder that casts shadows
    // (the truss roof, rails and dummy throw them across the floor and backstop).
    const key = new THREE.DirectionalLight(0xffe2c0, 0);
    key.target.position.set(0, 0, -11);
    key.position.set(-6, 9, 4).add(key.target.position);
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.visible = false;
    scene.add(key, key.target);
    this.key = key;
    this.high = false;
    this._hiMats = new Map();       // standard material -> its high-graphics replacement (built on first use)

    const len = ROOM.far + ROOM.near;
    const midZ = (ROOM.near - ROOM.far) / 2;

    // Sky dome and the ground around the lane.
    this.skyTex = duskSky();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16),
      new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    scene.add(sky);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ color: 0x2e2420 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    scene.add(ground);

    // Floor: tread plate, plus painted markings on a transparent sheet just above it.
    const tread = treadPlate();
    tread.repeat.set(ROOM.halfWidth * 2 / 0.5, len / 0.5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfWidth * 2, len), new THREE.MeshLambertMaterial({ map: tread }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = midZ;
    scene.add(floor);
    const marks = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfWidth * 2, len),
      new THREE.MeshLambertMaterial({ map: laneMarkings(ROOM.halfWidth, ROOM.near, ROOM.far), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    marks.rotation.x = -Math.PI / 2;
    marks.position.set(0, 0.002, midZ);
    scene.add(marks);

    // Corrugated side walls.
    const wallTex = corrugatedWall();
    wallTex.repeat.set(len / 2, 1);
    const sideMat = new THREE.MeshLambertMaterial({ map: wallTex });
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(len, ROOM.height), sideMat);
      side.rotation.y = s * -Math.PI / 2;
      side.position.set(s * ROOM.halfWidth, ROOM.height / 2, midZ);
      scene.add(side);
    }

    // Steel: wall caps, open truss roof, posts. One merged mesh.
    const steel = new THREE.MeshLambertMaterial({ color: 0x2c2e31 });
    const frame = new THREE.Group();
    for (const s of [-1, 1]) {
      box(frame, steel, 0.16, 0.16, len, s * ROOM.halfWidth, ROOM.height + 0.08, midZ);
      box(frame, steel, 0.12, 0.12, len, s * 2.4, ROOM.height + 0.55, midZ);
    }
    for (let z = ROOM.near - 0.5; z > -ROOM.far; z -= 3) {
      box(frame, steel, ROOM.halfWidth * 2 + 0.3, 0.18, 0.18, 0, ROOM.height + 0.6, z);      // cross beam
      for (const s of [-1, 1]) {
        box(frame, steel, 0.14, ROOM.height + 0.7, 0.14, s * (ROOM.halfWidth - 0.08), (ROOM.height + 0.7) / 2, z);  // post
        const brace = box(frame, steel, 0.08, 0.08, 1.9, s * (ROOM.halfWidth - 0.9), ROOM.height + 0.3, z);
        brace.rotation.set(0, Math.PI / 2, s * 0.45);
      }
    }
    MERGE_COLOR(frame);
    scene.add(frame);

    // Guard rails along both sides of the lane, and a waist-high rail at the firing line
    // (visual only: bullets pass over and through it).
    const railMat = new THREE.MeshLambertMaterial({ color: 0x6a6f74 });
    const rails = new THREE.Group();
    const railX = ROOM.halfWidth - 0.45, railFrom = -0.8, railTo = -ROOM.far + 1;
    for (const s of [-1, 1]) {
      for (const h of [0.55, 1.0]) box(rails, railMat, 0.05, 0.05, railFrom - railTo, s * railX, h, (railFrom + railTo) / 2);
      for (let z = railFrom; z >= railTo; z -= 2) box(rails, railMat, 0.06, 1.02, 0.06, s * railX, 0.51, z);
    }
    for (const h of [0.6, 1.02]) box(rails, railMat, railX * 2, 0.05, 0.05, 0, h, -0.75);
    for (const x of [-railX, -railX / 3, railX / 3, railX]) box(rails, railMat, 0.06, 1.05, 0.06, x, 0.52, -0.75);
    MERGE_COLOR(rails);
    scene.add(rails);

    // Distant silhouettes in the haze.
    const far = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a2c2a });
    const rng = mulberry32(21);
    for (let i = 0; i < 26; i++) {
      const a = (rng() - 0.5) * Math.PI * 1.6 - Math.PI / 2;  // mostly down range and to the sides
      const r = 40 + rng() * 40, w = 4 + rng() * 12, h = 4 + rng() * 18;
      box(far, dark, w, h, 4 + rng() * 10, Math.cos(a) * r, h / 2 - 0.5, Math.sin(a) * r, rng() * 3);
    }
    MERGE_COLOR(far);
    scene.add(far);

    // Distance board on the left, angled towards the firing line.
    this.boardCv = document.createElement('canvas');
    this.boardCv.width = 512; this.boardCv.height = 300;
    this.boardTex = new THREE.CanvasTexture(this.boardCv);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.boardTex.anisotropy = 4;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0), new THREE.MeshBasicMaterial({ map: this.boardTex, fog: false, toneMapped: false }));
    board.position.set(-ROOM.halfWidth + 1.0, 2.15, -4.2);
    board.rotation.y = 0.42;
    scene.add(board);
    this.boardPost = box(scene, steel, 0.08, 2.1, 0.08, -ROOM.halfWidth + 1.0, 1.05, -4.25);
    this.boardLabel = 'dummy';

    // Spent brass at the firing line (instanced; new casings are added as you shoot).
    this.casings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0048, 0.0048, 0.022, 8),
      new THREE.MeshLambertMaterial({ color: 0xc89a4a }), MAX_CASINGS);
    this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casings.frustumCulled = false;
    this.casings.count = 0;
    this._cn = 0; this._cm = new THREE.Matrix4(); this._cq = new THREE.Quaternion(); this._ce = new THREE.Euler();
    this._cp = new THREE.Vector3(); this._cs = new THREE.Vector3(1, 1, 1);
    this._crng = mulberry32(99);
    scene.add(this.casings);
    // Between your feet and the firing-line rail, where you can see them by looking down.
    for (let i = 0; i < 90; i++) this.addCasing((this._crng() - 0.5) * 3.0, -0.15 - this._crng() * 0.5);

    // Target group at the selected distance: dummy on its pad, red dots, the backstop
    // (WALL_GAP behind) and bullet holes, all in one frame that moves together.
    this.wallGroup = new THREE.Group();
    scene.add(this.wallGroup);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfWidth * 2, ROOM.height),
      new THREE.MeshLambertMaterial({ map: backstopPlate() }));
    wall.position.set(0, ROOM.height / 2, -WALL_GAP);
    this.wallGroup.add(wall);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.6, 40), new THREE.MeshLambertMaterial({ map: padTexture() }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.006;
    this.wallGroup.add(pad);
    this.dummy = buildDummy();
    this.wallGroup.add(this.dummy);
    this.dots = new DotField(this.wallGroup);

    this.holes = new BulletHoles(this.wallGroup);

    // Nothing in the yard moves except the target group, so skip per-frame matrix rebuilds.
    scene.traverse((o) => {
      if (o !== this.wallGroup && o !== this.casings && o.isMesh && o.parent === scene) { o.updateMatrix(); o.matrixAutoUpdate = false; }
    });
    // Shadow flags (used only while the key light casts, i.e. high graphics).
    for (const o of [ground, floor, marks, wall, pad]) o.receiveShadow = true;
    scene.traverse((o) => { if (o.isMesh && o.material === sideMat) o.receiveShadow = true; });
    for (const o of [...frame.children, ...rails.children, this.boardPost]) o.castShadow = true;
    this.dummy.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this._parts = { ground, floor, marks, sideMat, wall, pad, steel, railMat, dark, tread, wallTex };

    this._d = [0, 0, 0]; this._o = [0, 0, 0];
    this._dh = { t: 0, p: [0, 0, 0], n: [0, 0, 0], zone: null };
    this.distance = 10;
    this.setDistance(10);
  }

  // High graphics: physically based materials with normal and roughness maps, a shadow-casting
  // key light, image-based lighting from the sky and filmic tone mapping. Standard graphics
  // is the original cheap Lambert look. Materials for high are built the first time it is used.
  setGraphics(high, renderer) {
    high = !!high;
    if (!this._hiReady && high) this._buildHigh(renderer);
    this.high = high;
    const swap = (o) => {
      if (!o.isMesh) return;
      if (high) {
        const hi = this._hiMats.get(o.material);
        if (hi) { o.userData.loMat = o.material; o.material = hi; }
      } else if (o.userData.loMat) { o.material = o.userData.loMat; o.userData.loMat = null; }
    };
    this.scene.traverse(swap);
    this.key.visible = high;
    this.key.castShadow = high;
    this.key.intensity = high ? 2.6 : 0;
    this.hemi.intensity = high ? 0.35 : 1.25;
    this.sun.intensity = high ? 1.4 : 1.3;
    this.fill.intensity = high ? 0.25 : 0.7;
    this.scene.environment = high ? this.env : null;
    this.scene.fog.color.set(high ? 0x6d4c40 : 0x7a5546);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = high ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = high ? 1.15 : 1;
  }

  _buildHigh(renderer) {
    const P = this._parts, M = this._hiMats;
    const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    // Image-based lighting: the dusk sky, prefiltered once.
    const pm = new THREE.PMREMGenerator(renderer);
    this.env = pm.fromEquirectangular(this.skyTex).texture;
    pm.dispose();

    const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.6, ...o });
    const tp = treadPlateMaps(), cw = corrugatedMaps(), bp = backstopMaps();
    for (const m of [tp, cw]) for (const t of [m.normal, m.rough]) t.anisotropy = aniso;
    tp.normal.repeat.copy(P.tread.repeat); tp.rough.repeat.copy(P.tread.repeat);
    cw.normal.repeat.set(P.wallTex.repeat.x, 3.6 / 2 * 7); cw.rough.repeat.copy(P.wallTex.repeat);
    P.tread.anisotropy = aniso; P.wallTex.anisotropy = aniso;
    P.tread.needsUpdate = P.wallTex.needsUpdate = true;

    M.set(P.floor.material, std({ map: P.tread, normalMap: tp.normal, normalScale: new THREE.Vector2(1, 1),
      roughnessMap: tp.rough, roughness: 1, metalness: 0.55 }));
    M.set(P.marks.material, std({ map: P.marks.material.map, transparent: true, depthWrite: false, roughness: 0.7, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    M.set(P.sideMat, std({ map: P.wallTex, normalMap: cw.normal, normalScale: new THREE.Vector2(1, 1),
      roughnessMap: cw.rough, roughness: 1, metalness: 0.3 }));
    M.set(P.wall.material, std({ map: P.wall.material.map, normalMap: bp.normal, roughnessMap: bp.rough, roughness: 1, metalness: 0.6 }));
    M.set(P.pad.material, std({ map: P.pad.material.map, roughness: 0.75, metalness: 0.1 }));
    M.set(P.ground.material, std({ color: 0x2e2420, roughness: 1, metalness: 0 }));
    M.set(P.steel, std({ color: 0x34373b, roughness: 0.55, metalness: 0.75, envMapIntensity: 0.8 }));
    M.set(P.railMat, std({ color: 0x8a9096, roughness: 0.35, metalness: 0.85, envMapIntensity: 0.9 }));
    M.set(P.dark, std({ color: 0x3a2c2a, roughness: 1, metalness: 0 }));
    M.set(this.casings.material, std({ color: 0xd4a85a, roughness: 0.28, metalness: 1, envMapIntensity: 1.2 }));
    this.dummy.traverse((o) => {
      if (!o.isMesh || M.has(o.material)) return;
      M.set(o.material, o.material.vertexColors
        ? std({ vertexColors: true, color: 0xd8d0c8, roughness: 0.82, metalness: 0 })              // painted foam
        : std({ color: o.material.color, roughness: 0.5, metalness: 0.7 }));     // steel base
    });
    this._hiReady = true;
  }

  setDistance(d) {
    this.distance = d;
    this.wallGroup.position.z = -d;
    this.updateBoard();
  }

  // label: what is on the lane ("dummy", "6 red dots, moving").
  setBoardLabel(label) { this.boardLabel = label; this.updateBoard(); }
  updateBoard() {
    drawBoard(this.boardCv.getContext('2d'), this.boardCv.width, this.boardCv.height, this.distance, this.boardLabel || 'dummy');
    this.boardTex.needsUpdate = true;
  }

  // A spent casing on the floor at (x, z), lying at a random angle. Oldest is recycled.
  addCasing(x, z) {
    const i = this._cn % MAX_CASINGS;
    this._cn++;
    this._ce.set(Math.PI / 2, this._crng() * Math.PI * 2, 0, 'YXZ');
    this._cq.setFromEuler(this._ce);
    this._cp.set(x, 0.006, z);
    this._cm.compose(this._cp, this._cq, this._cs);
    this.casings.setMatrixAt(i, this._cm);
    this.casings.count = Math.min(MAX_CASINGS, this._cn);
    this.casings.instanceMatrix.needsUpdate = true;
  }

  // Hitscan from the eye (ex, ey, ez in world metres; default: standing on the firing line)
  // along (yaw, pitch) in degrees, in the target group's frame. Fills hit: plane = [x, y]
  // where the ray crosses the target plane, relative to the aim point (the dummy's head
  // centre, 1.6 m up), and kind = 'dummy' | 'wall' | null with the surface point p, normal n
  // and dummy zone. Returns hit.kind.
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
    hit.plane[1] = o[1] + tp * d[1] - EYE_HEIGHT;   // relative to the head / aim point
    hit.planeOk = true;
    if (this.dummy.visible && raycastDummy(o, d, this._dh)) {
      hit.kind = 'dummy'; hit.zone = this._dh.zone;
      hit.p[0] = this._dh.p[0]; hit.p[1] = this._dh.p[1]; hit.p[2] = this._dh.p[2];
      hit.n[0] = this._dh.n[0]; hit.n[1] = this._dh.n[1]; hit.n[2] = this._dh.n[2];
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
