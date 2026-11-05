// Moving red dot: slides left to right across the back wall at eye height, then starts again
// from the left. Its position is a pure function of time, so hit tests at a shot's exact time
// are frame-rate independent.
import * as THREE from '../../vendor/three/three.module.min.js';
import { EYE_HEIGHT } from './range.js';

export const DOT_RADIUS = 0.1;   // metres (20 cm disc)
export const DOT_TRAVEL = 3;     // runs from x = -3 m to +3 m on the wall

export class MovingDot {
  constructor(wallGroup) {
    this.speed = 1.5; // metres per second along the wall
    this.enabled = false;
    this.t0 = 0;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CircleGeometry(DOT_RADIUS, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(DOT_RADIUS * 0.85, 32), new THREE.MeshBasicMaterial({ color: 0xe0201b }));
    dot.position.z = 0.001;
    g.add(ring, dot);
    g.position.set(-DOT_TRAVEL, EYE_HEIGHT, 0.02);
    g.visible = false;
    wallGroup.add(g);
    this.mesh = g;
  }

  setEnabled(on, t) {
    this.enabled = on;
    this.mesh.visible = on;
    this.t0 = t; // restart from the left edge
  }

  // Wall-local x of the dot centre at time t (y is always EYE_HEIGHT).
  xAt(t) {
    const span = 2 * DOT_TRAVEL;
    let d = ((t - this.t0) * this.speed) % span;
    if (d < 0) d += span;
    return -DOT_TRAVEL + d;
  }

  update(t) {
    if (this.enabled) this.mesh.position.x = this.xAt(t);
  }
}
