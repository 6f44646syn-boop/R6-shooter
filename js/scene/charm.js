// A gun charm: a trinket on a short cord, hung from the side of the gun. A damped pendulum in
// the weapon scene: the gun's own movement (sway, kick, strafing, inspect turns) swings it, and
// it always hangs towards the scene's down, whatever the gun's angle.
import * as THREE from '../../vendor/three/three.module.min.js?v=d05ab44-mwg7imxt';

const CORD = 0.03;                 // metres (the viewmodel's scale)
const geo = {};
function g(key, make) { return geo[key] || (geo[key] = make()); }
function heartShape() {
  const s = new THREE.Shape(), k = 0.0075;
  s.moveTo(0, -k); s.bezierCurveTo(k * 1.6, 0, k * 0.9, k * 1.3, 0, k * 0.6); s.bezierCurveTo(-k * 0.9, k * 1.3, -k * 1.6, 0, 0, -k);
  return s;
}
function trinket(def) {
  const metal = def.shape === 'bell' || def.shape === 'tag' || def.shape === 'ring';
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: metal ? 0.9 : 0.05, roughness: metal ? 0.3 : 0.55,
    emissive: def.shape === 'shard' ? 0x1a5866 : 0x000000, transparent: def.shape === 'shard', opacity: def.shape === 'shard' ? 0.85 : 1 });
  const grp = new THREE.Group(), add = (gm, y = 0, m = mat) => { const o = new THREE.Mesh(gm, m); o.position.y = y; grp.add(o); return o; };
  switch (def.shape) {
    case 'bell': add(g('bell', () => new THREE.LatheGeometry([[0, 0.009], [0.003, 0.0085], [0.005, 0.004], [0.0065, -0.002], [0.0075, -0.004], [0, -0.004]].map(([x, y]) => new THREE.Vector2(x, y)), 16)), -0.005); break;
    case 'tag': add(g('tag', () => new THREE.BoxGeometry(0.011, 0.017, 0.0012)), -0.009); break;
    case 'die': {
      add(g('die', () => new THREE.BoxGeometry(0.01, 0.01, 0.01)), -0.006);
      const pip = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6 });
      for (const [x, y] of [[0, 0], [-0.0025, 0.0025], [0.0025, -0.0025]]) { const p = add(g('pip', () => new THREE.SphereGeometry(0.0011, 8, 6)), -0.006 + y, pip); p.position.x = x; p.position.z = 0.005; }
      break;
    }
    case 'ring': add(g('ring', () => new THREE.TorusGeometry(0.0065, 0.0018, 10, 24)), -0.007); break;
    case 'heart': { const h = add(g('heart', () => new THREE.ExtrudeGeometry(heartShape(), { depth: 0.003, bevelEnabled: true, bevelSize: 0.0008, bevelThickness: 0.0008, bevelSegments: 2 })), -0.012); h.position.z = -0.0015; break; }
    case 'crane': { const c = add(g('crane', () => new THREE.OctahedronGeometry(0.0075, 0)), -0.007); c.scale.set(1.6, 0.6, 0.5); break; }
    case 'dummy': {
      add(g('dbody', () => new THREE.CapsuleGeometry(0.0035, 0.007, 4, 10)), -0.012);
      add(g('dhead', () => new THREE.SphereGeometry(0.0032, 12, 10)), -0.004);
      break;
    }
    default: { const s = add(g('shard', () => new THREE.OctahedronGeometry(0.006, 0)), -0.009); s.scale.set(0.7, 1.7, 0.7); }
  }
  return grp;
}

export class Charm {
  constructor(def) {
    this.def = def;
    this.pivot = new THREE.Group();          // at the mount; its world rotation is the swing
    const cord = new THREE.Mesh(g('cord', () => new THREE.CylinderGeometry(0.0006, 0.0006, CORD, 5).translate(0, -CORD / 2, 0)), new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.9 }));
    const t = trinket(def); t.position.y = -CORD;
    this.pivot.add(cord, t);
    this.ax = 0; this.az = 0; this.vx = 0; this.vz = 0;   // swing angles (rad) about X and Z, and their speeds
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3(); this.first = true;
    this._q = new THREE.Quaternion(); this._pq = new THREE.Quaternion(); this._e = new THREE.Euler(); this._w = new THREE.Vector3();
  }
  attach(parent, at) { parent.add(this.pivot); this.pivot.position.copy(at); this.first = true; }
  detach() { this.pivot.removeFromParent(); }
  // dt: seconds. Called after the gun's pose for the frame is set.
  step(dt) {
    const par = this.pivot.parent;
    if (!par || dt <= 0) return;
    par.updateWorldMatrix(true, false);
    this.pivot.getWorldPosition(this._w);
    if (this.first) { this.p.copy(this._w); this.v.set(0, 0, 0); this.first = false; }
    const h = Math.min(dt, 0.05), nv = this._w.clone().sub(this.p).divideScalar(h), acc = nv.clone().sub(this.v).divideScalar(h);
    this.p.copy(this._w); this.v.copy(nv);
    acc.clampLength(0, 60);
    // The mount accelerating one way swings the trinket the other way; gravity pulls it back.
    let rem = h;
    while (rem > 0) {
      const s = Math.min(rem, 1 / 240);
      this.vx += (-140 * Math.sin(this.ax) - 2.2 * this.vx + acc.z * 4) * s;   // the mount speeding forward (-z) swings it back
      this.vz += (-140 * Math.sin(this.az) - 2.2 * this.vz - acc.x * 4) * s;
      this.ax = Math.max(-1.3, Math.min(1.3, this.ax + this.vx * s));
      this.az = Math.max(-1.3, Math.min(1.3, this.az + this.vz * s));
      rem -= s;
    }
    // world swing -> local to the gun
    this._q.setFromEuler(this._e.set(this.ax, 0, this.az));
    par.getWorldQuaternion(this._pq).invert();
    this.pivot.quaternion.copy(this._pq.multiply(this._q));
  }
}
