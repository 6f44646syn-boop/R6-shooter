// The range: a single lane. A training dummy stands at the selected distance with the back
// wall 1.5 m behind it; both slide together. Low poly, Lambert/basic materials, no shadows.
import * as THREE from '../../vendor/three/three.module.min.js';
import { BulletHoles } from './holes.js';
import { buildDummy, raycastDummy } from './dummy.js';
import { DotField } from './dots.js';

export const EYE_HEIGHT = 1.6;
export const ROOM = { halfWidth: 4, height: 3.6, near: 3, far: 24 };
export const WALL_GAP = 1.5; // back wall distance behind the target plane

function floorTexture() {
  // 8 m wide x 27 m long floor; 64 px per metre. Painted distance lines at 5/10/15/20 m.
  const ppm = 64, W = ROOM.halfWidth * 2 * ppm, L = (ROOM.far + ROOM.near) * ppm;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = L;
  const g = cv.getContext('2d');
  g.fillStyle = '#3b3d40';
  g.fillRect(0, 0, W, L);
  // Concrete slab joints every 2 m
  g.strokeStyle = '#323437';
  g.lineWidth = 2;
  for (let z = 0; z <= ROOM.far + ROOM.near; z += 2) { g.beginPath(); g.moveTo(0, z * ppm); g.lineTo(W, z * ppm); g.stroke(); }
  for (let x = 0; x <= ROOM.halfWidth * 2; x += 2) { g.beginPath(); g.moveTo(x * ppm, 0); g.lineTo(x * ppm, L); g.stroke(); }
  // Row 0 of the canvas is the far end (z = -far).
  const rowFor = (dist) => (ROOM.far - dist) * ppm;
  g.fillStyle = '#e0a53a';
  g.textAlign = 'center';
  g.font = 'bold 44px sans-serif';
  for (const d of [5, 10, 15, 20]) {
    g.fillRect(0, rowFor(d) - 2, W, 4);
    g.fillText(d + ' m', W / 2, rowFor(d) + 52);
  }
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, rowFor(0) - 3, W, 6); // firing line
  // Lane edges
  g.fillStyle = '#e0a53a';
  g.fillRect(ppm * 0.6, 0, 4, L);
  g.fillRect(W - ppm * 0.6 - 4, 0, 4, L);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Range {
  constructor(scene) {
    this.scene = scene;
    scene.background = new THREE.Color(0x15171a);

    scene.add(new THREE.HemisphereLight(0xf2f0ea, 0x3a3833, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1.5, 3, 2);
    scene.add(sun);

    const len = ROOM.far + ROOM.near;
    const midZ = (ROOM.near - ROOM.far) / 2;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfWidth * 2, len),
      new THREE.MeshLambertMaterial({ map: floorTexture() }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = midZ;
    scene.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfWidth * 2, len),
      new THREE.MeshBasicMaterial({ color: 0x2c2f33 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, ROOM.height, midZ);
    scene.add(ceil);

    const sideMat = new THREE.MeshLambertMaterial({ color: 0x55585c });
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(len, ROOM.height), sideMat);
      side.rotation.y = s * -Math.PI / 2;
      side.position.set(s * ROOM.halfWidth, ROOM.height / 2, midZ);
      scene.add(side);
    }

    // Ceiling light strips: one merged-looking set of boxes sharing a basic material.
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfaf6e8 });
    const strip = new THREE.BoxGeometry(0.12, 0.04, len - 2);
    for (const x of [-1.6, 1.6]) {
      const m = new THREE.Mesh(strip, lightMat);
      m.position.set(x, ROOM.height - 0.02, midZ);
      scene.add(m);
    }

    // Target group at the selected distance: dummy (z = 0), red dots (z = 0), back wall
    // (z = -WALL_GAP) and bullet holes all live in its local frame and move together.
    this.wallGroup = new THREE.Group();
    scene.add(this.wallGroup);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfWidth * 2, ROOM.height),
      new THREE.MeshLambertMaterial({ color: 0x6d675d }));
    wall.position.set(0, ROOM.height / 2, -WALL_GAP);
    this.wallGroup.add(wall);
    this.dummy = buildDummy();
    this.wallGroup.add(this.dummy);
    this.dots = new DotField(this.wallGroup);

    this.holes = new BulletHoles(this.wallGroup);

    // Nothing in the room moves except the wall group, so skip per-frame matrix rebuilds.
    scene.traverse((o) => {
      if (o !== this.wallGroup && o.isMesh && o.parent === scene) { o.updateMatrix(); o.matrixAutoUpdate = false; }
    });
    this._d = [0, 0, 0]; this._o = [0, 0, 0];
    this._dh = { t: 0, p: [0, 0, 0], n: [0, 0, 0], zone: null };
    this.distance = 10;
    this.setDistance(10);
  }

  setDistance(d) {
    this.distance = d;
    this.wallGroup.position.z = -d;
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
