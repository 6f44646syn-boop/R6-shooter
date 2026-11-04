// The range: a single lane with a back wall that slides to the selected distance.
// Low poly, Lambert/basic materials, no shadows. Roughly 12 draw calls in total.
import * as THREE from '../../vendor/three/three.module.min.js';
import { TARGET, drawTargetCanvas } from './target.js';
import { BulletHoles } from './holes.js';

export const EYE_HEIGHT = 1.6;
export const ROOM = { halfWidth: 4, height: 3.6, near: 3, far: 24 };

function floorTexture() {
  // 8 m wide x 27 m long floor; 32 px per metre. Painted distance lines at 5/10/15/20 m.
  const ppm = 32, W = ROOM.halfWidth * 2 * ppm, L = (ROOM.far + ROOM.near) * ppm;
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
  g.font = 'bold 22px sans-serif';
  for (const d of [5, 10, 15, 20]) {
    g.fillRect(0, rowFor(d) - 2, W, 4);
    g.fillText(d + ' m', W / 2, rowFor(d) + 26);
  }
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, rowFor(0) - 3, W, 6); // firing line
  // Lane edges
  g.fillStyle = '#e0a53a';
  g.fillRect(ppm * 0.6, 0, 4, L);
  g.fillRect(W - ppm * 0.6 - 4, 0, 4, L);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
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

    // Back wall group: wall, target paper and bullet holes all live in its local frame.
    this.wallGroup = new THREE.Group();
    scene.add(this.wallGroup);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfWidth * 2, ROOM.height),
      new THREE.MeshLambertMaterial({ color: 0x6d675d }));
    wall.position.y = ROOM.height / 2;
    this.wallGroup.add(wall);

    const b = TARGET.board;
    const tTex = new THREE.CanvasTexture(drawTargetCanvas());
    tTex.colorSpace = THREE.SRGBColorSpace;
    tTex.anisotropy = 4;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0, b.y1 - b.y0),
      new THREE.MeshLambertMaterial({ map: tTex }));
    paper.position.set((b.x0 + b.x1) / 2, EYE_HEIGHT + (b.y0 + b.y1) / 2, 0.006);
    this.wallGroup.add(paper);

    this.holes = new BulletHoles(this.wallGroup);
    this.distance = 10;
    this.setDistance(10);
  }

  setDistance(d) {
    this.distance = d;
    this.wallGroup.position.z = -d;
  }

  // Hitscan from the eye along (yaw, pitch) in degrees against the back wall plane.
  // Writes the wall-local hit point into out {x, y} (y measured from the floor) and returns
  // true if the ray reaches the wall inside the room.
  raycastWall(yawDeg, pitchDeg, out) {
    const yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
    if (dz >= -1e-9) return false;          // pointing away from the wall
    const t = this.distance / -dz;           // eye at z = 0, wall at z = -distance
    const x = t * dx, y = EYE_HEIGHT + t * dy;
    if (x < -ROOM.halfWidth || x > ROOM.halfWidth || y < 0 || y > ROOM.height) return false;
    out.x = x;
    out.y = y;
    return true;
  }
}
