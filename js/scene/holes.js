// Bullet holes: one InstancedMesh (one draw call) with a ring buffer of positions and normals.
// Holes live in the target group's frame (dummy + back wall), so moving the target moves
// them too. Each hole faces along the surface normal it was made on. When the cap is
// reached the oldest hole is recycled.
import * as THREE from '../../vendor/three/three.module.min.js?v=cd68db2-mw4e6311';

export const MAX_HOLES = 300;

function holeTexture() {
  const s = 128, c = s / 2;
  const cv = document.createElement('canvas');
  cv.width = s; cv.height = s;
  const g = cv.getContext('2d');
  // Pale torn ring so the hole reads on dark paint and on the dummy.
  const ring = g.createRadialGradient(c, c, c * 0.55, c, c, c - 1);
  ring.addColorStop(0, '#f4ead0');
  ring.addColorStop(1, 'rgba(244,234,208,0.6)');
  g.fillStyle = ring;
  g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0a0a0a';
  g.beginPath(); g.arc(c, c, c * 0.62, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BulletHoles {
  constructor(parent) {
    this.data = new Float32Array(MAX_HOLES * 6); // x y z nx ny nz
    this.next = 0;     // ring buffer write index
    this.count = 0;
    this.size = 0.03;  // diameter in metres
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.n = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.z = new THREE.Vector3(0, 0, 1);

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
    const d = this.data, k = i * 6;
    this.n.set(d[k + 3], d[k + 4], d[k + 5]);
    this.q.setFromUnitVectors(this.z, this.n);
    // Lift the decal a few millimetres off the surface along its normal.
    this.v.set(d[k] + d[k + 3] * 0.004, d[k + 1] + d[k + 4] * 0.004, d[k + 2] + d[k + 5] * 0.004);
    this.s.set(this.size, this.size, 1);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
  }

  // Position and unit normal in the target frame.
  add(x, y, z, nx = 0, ny = 0, nz = 1) {
    const i = this.next, d = this.data, k = i * 6;
    d[k] = x; d[k + 1] = y; d[k + 2] = z; d[k + 3] = nx; d[k + 4] = ny; d[k + 5] = nz;
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
