// Bullet holes: one InstancedMesh (one draw call) with a ring buffer of positions.
// Positions are in the wall's local frame (x right, y up, metres), so moving the wall moves
// the holes with it. When the cap is reached the oldest hole is recycled.
import * as THREE from '../../vendor/three/three.module.min.js';

export const MAX_HOLES = 300;

function holeTexture() {
  const s = 64, c = s / 2;
  const cv = document.createElement('canvas');
  cv.width = s; cv.height = s;
  const g = cv.getContext('2d');
  // Pale torn ring so the hole reads on dark paint and on the paper target.
  g.fillStyle = '#f4ead0';
  g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0a0a0a';
  g.beginPath(); g.arc(c, c, c * 0.68, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(cv);
}

export class BulletHoles {
  constructor(parent) {
    this.xy = new Float32Array(MAX_HOLES * 2);
    this.next = 0;     // ring buffer write index
    this.count = 0;
    this.size = 0.03;  // diameter in metres
    this.m = new THREE.Matrix4();

    const mat = new THREE.MeshBasicMaterial({
      map: holeTexture(), alphaTest: 0.5, transparent: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX_HOLES);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // bounding sphere would only cover the first quad
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
  }

  _write(i) {
    const s = this.size;
    this.m.makeScale(s, s, 1);
    this.m.setPosition(this.xy[i * 2], this.xy[i * 2 + 1], 0.012);
    this.mesh.setMatrixAt(i, this.m);
  }

  add(x, y) {
    const i = this.next;
    this.xy[i * 2] = x;
    this.xy[i * 2 + 1] = y;
    this._write(i);
    this.next = (i + 1) % MAX_HOLES;
    if (this.count < MAX_HOLES) this.count++;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setSize(diameterMetres) {
    this.size = diameterMetres;
    for (let i = 0; i < this.count; i++) this._write(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.next = 0;
    this.mesh.count = 0;
  }
}
