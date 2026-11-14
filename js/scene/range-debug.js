// Dev-mode overlays for the shooting range: the dummy's exact hit shapes, and a trail of bullet paths.
import * as THREE from '../../vendor/three/three.module.min.js?v=ba75b4c-mwgabqbe';
import { DUMMY_PARTS } from './dummy.js?v=ba75b4c-mwgabqbe';
import { SOLDIER_PARTS } from '../battle/soldier.js?v=ba75b4c-mwgabqbe';

const ZONE_COLOR = { head: 0xff4d4d, body: 0xffd34d, limb: 0x4dd2ff };
const lineMat = (opacity) => new THREE.LineBasicMaterial({ vertexColors: opacity === undefined, color: 0xffffff, depthTest: false, transparent: true, opacity: opacity ?? 0.9 });

// Wireframes of hit shapes (spheres and capsules, as in DUMMY_PARTS and SOLDIER_PARTS), in the body's own frame. Hidden until switched on.
function wire(parts, depthTest) {
  const group = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const p of parts) {
    let g;
    if (p.t === 'sphere') { g = new THREE.SphereGeometry(p.r, 14, 10); g.translate(...p.c); }
    else {
      const a = new THREE.Vector3(...p.a), b = new THREE.Vector3(...p.b), dir = b.clone().sub(a);
      g = new THREE.CapsuleGeometry(p.r, dir.length(), 4, 10);
      q.setFromUnitVectors(up, dir.normalize()); m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)); g.applyMatrix4(m);
    }
    const lines = new THREE.LineSegments(new THREE.WireframeGeometry(g), new THREE.LineBasicMaterial({ color: ZONE_COLOR[p.zone], depthTest, transparent: true, opacity: 0.75 }));
    lines.renderOrder = 20; g.dispose(); group.add(lines);
  }
  group.visible = false;
  return group;
}
export const buildHitboxes = () => wire(DUMMY_PARTS, false);

// The same outlines on fighters (bots and other players). They hide behind walls, so they show nothing you could not already see.
// Fighters draw their body in a frame that is rotated and squashed like the hit test, so the outline is a child of that frame.
export function syncFighterBoxes(fighters, on, mine) {
  for (const f of fighters) {
    if (!f.dbgBox) { if (!on) continue; f.dbgBox = wire(SOLDIER_PARTS, true); f.scaleG.add(f.dbgBox); }
    f.dbgBox.visible = on && f !== mine && f.alive;
  }
}

// The last MAX shots: blue = the real bullet path from your eye, orange = muzzle to where it landed, plus a small cross at the impact.
const MAX = 40, SEG = 5;   // line segments per shot: eye path, muzzle path, three for the cross
export class RayTrail {
  constructor() {
    this.pos = new Float32Array(MAX * SEG * 6); this.col = new Float32Array(MAX * SEG * 6); this.n = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setDrawRange(0, 0);
    this.obj = new THREE.LineSegments(g, lineMat()); this.obj.renderOrder = 21; this.obj.frustumCulled = false; this.obj.visible = false;
  }
  // m: muzzle, o: eye (bullet origin), e: end point; all [x, y, z] in world metres.
  add(m, o, e) {
    const i = (this.n % MAX) * SEG * 6, s = 0.03;
    const seg = (k, a, b, c) => { this.pos.set([...a, ...b], i + k * 6); this.col.set([...c, ...c], i + k * 6); };
    const BLUE = [0.3, 0.7, 1], ORANGE = [1, 0.6, 0.15], WHITE = [1, 1, 1];
    seg(0, o, e, BLUE); seg(1, m, e, ORANGE);
    seg(2, [e[0] - s, e[1], e[2]], [e[0] + s, e[1], e[2]], WHITE); seg(3, [e[0], e[1] - s, e[2]], [e[0], e[1] + s, e[2]], WHITE); seg(4, [e[0], e[1], e[2] - s], [e[0], e[1], e[2] + s], WHITE);
    this.n++;
    const g = this.obj.geometry; g.setDrawRange(0, Math.min(this.n, MAX) * SEG * 2);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
  }
  clear() { this.n = 0; this.obj.geometry.setDrawRange(0, 0); }
}
