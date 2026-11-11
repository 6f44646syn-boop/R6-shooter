// Footprints: every player leaves boot prints on the ground as they walk (left, right, along
// their heading). One InstancedMesh (one draw), a ring buffer of 480 prints; each fades out over
// LIFE seconds. Drawn with multiply blending, so a print darkens whatever floor it is on.
import * as THREE from '../../vendor/three/three.module.min.js?v=189fea0-mwc1zla2';

const N = 480, LIFE = 30;

function bootTexture() {
  const W = 64, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  // a right boot sole seen from above (toe at the top): lugs in the forefoot and the heel
  const sole = new Path2D();
  sole.moveTo(30, 6); sole.bezierCurveTo(50, 6, 56, 30, 54, 52); sole.bezierCurveTo(52, 70, 44, 76, 44, 86);
  sole.bezierCurveTo(46, 104, 46, 122, 32, 123); sole.bezierCurveTo(18, 122, 16, 104, 18, 88);
  sole.bezierCurveTo(16, 74, 8, 64, 8, 46); sole.bezierCurveTo(8, 22, 14, 6, 30, 6); sole.closePath();
  g.fillStyle = '#b7aea4'; g.fill(sole);
  g.save(); g.clip(sole);
  g.fillStyle = '#6f665d';
  for (let y = 12; y < 74; y += 9) for (let x = 6 + (y % 18 ? 4 : 0); x < 58; x += 10) { g.save(); g.translate(x, y); g.rotate(0.5); g.fillRect(-3.5, -2, 7, 4); g.restore(); }
  for (let y = 92; y < 122; y += 8) for (let x = 18; x < 48; x += 9) g.fillRect(x - 3, y - 2, 6, 4);
  g.fillStyle = '#d4cdc4'; g.fillRect(10, 78, 44, 6);                            // the arch barely touches
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Footprints {
  constructor(parent) {
    const mat = new THREE.MeshBasicMaterial({ map: bootTexture(), transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, fog: false, side: THREE.DoubleSide });   // (double: the left sole is mirrored)
    const geo = new THREE.PlaneGeometry(0.13, 0.28).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.born = new Float32Array(N).fill(-1e9);
    this.dark = new Float32Array(N);
    this.next = 0; this.side = new Map();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color(); this._y = new THREE.Vector3(0, 1, 0);
    parent.add(this.mesh);
  }
  // A step by actor id at its feet (x, y, z), heading yaw in degrees (the game's: 0 = facing -z,
  // 90 = facing +x), now t.
  // dark: how strongly the print shows (0..1; deeper in snow, mud or rain).
  add(id, x, y, z, yaw, t, dark = 0.45) {
    const left = !this.side.get(id); this.side.set(id, left);
    const i = this.next; this.next = (i + 1) % N;
    const a = yaw * Math.PI / 180, off = left ? -0.1 : 0.1;          // right of the heading: (cos a, sin a)
    this._p.set(x + Math.cos(a) * off, y + 0.012, z + Math.sin(a) * off);
    this._q.setFromAxisAngle(this._y, -a);
    this._s.set(left ? -1 : 1, 1, 1);                               // a mirrored sole for the left foot
    this.mesh.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
    this.born[i] = t; this.dark[i] = dark;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  // Fade the prints (only the instance colours change; cheap).
  update(t) {
    if (!this.mesh.count) return;
    for (let i = 0; i < this.mesh.count; i++) {
      const a = Math.max(0, 1 - (t - this.born[i]) / LIFE) * this.dark[i];
      this.mesh.setColorAt(i, this._c.setScalar(1 - a));             // white = no change under multiply
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.mesh.count = 0; this.next = 0; this.born.fill(-1e9); this.side.clear(); }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.map.dispose(); this.mesh.material.dispose(); }
}
