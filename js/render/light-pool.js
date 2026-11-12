// Light from objects: a fixed pool of spot lights handed each few frames to the fixtures
// (ceiling panels, wall lamps) nearest the camera, so rooms get pools of warm light under their
// lamps and dark corners between them. A fixed count keeps the shaders stable (no recompiles
// as you move); fixtures out of reach just stay emissive.
//   fixture: { p: Vector3, dir: Vector3 (where it shines), color, intensity, distance, angle }
import * as THREE from '../../vendor/three/three.module.min.js?v=b021b19-mwd8gat8';

export class LightPool {
  constructor(scene, n) {
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.SpotLight(0xffd9a0, 0, 9, 1.0, 0.65, 1.6);
      l.castShadow = false;
      scene.add(l, l.target);
      this.lights.push(l);
    }
    this.fixtures = []; this._f = 0; this._order = [];
  }
  setFixtures(list) { this.fixtures = list || []; this._f = 0; }
  update(camPos) {
    if (!this.lights.length || (this._f++ % 6)) return;
    const F = this.fixtures, o = this._order;
    o.length = 0;
    for (let i = 0; i < F.length; i++) { const d = F[i].p.distanceToSquared(camPos); if (d < 900) o.push([d, i]); }
    o.sort((a, b) => a[0] - b[0]);
    this.lights.forEach((l, k) => {
      const f = o[k] && F[o[k][1]];
      if (!f) { l.intensity = 0; return; }
      l.position.copy(f.p); l.target.position.copy(f.p).add(f.dir);
      l.color.set(f.color ?? 0xffd9a0); l.intensity = f.intensity ?? 6; l.distance = f.distance ?? 9; l.angle = f.angle ?? 1.0;
      // fade the farthest ones in and out, so swapping a light to another lamp does not pop
      l.intensity *= Math.min(1, Math.max(0, (30 - Math.sqrt(o[k][0])) / 8));
    });
  }
  dispose() { for (const l of this.lights) { l.removeFromParent(); l.target.removeFromParent(); l.dispose(); } this.lights.length = 0; }
}
