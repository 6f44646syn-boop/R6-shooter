// Red dot targets: several discs on the target plane (the dummy's distance). They can stay
// still or slide left to right (wrapping round). Shooting one scores points and respawns it
// somewhere else. Positions are a pure function of time, so hit tests at a shot's exact time
// are frame-rate independent. Two draw calls (instanced discs + rings) whatever the count.
import * as THREE from '../../vendor/three/three.module.min.js?v=3884a5c-mwdhrmgv';
import { mulberry32 } from '../core/prng.js?v=3884a5c-mwdhrmgv';

export const MAX_DOTS = 12;
export const DOT_POINTS = 100;
const X_RANGE = 2.4;            // dots spawn within +/- this many metres of the centre line
const Y_MIN = 0.5, Y_MAX = 2.7; // and between these heights
const WRAP = 2.8;               // moving dots wrap from +WRAP back to -WRAP

export class DotField {
  constructor(parent) {
    this.count = 0;
    this.radius = 0.1;
    this.moving = false;
    this.speed = 1.5;
    this.t0 = 0;
    this.x0 = new Float64Array(MAX_DOTS);
    this.y = new Float64Array(MAX_DOTS);
    this.rng = mulberry32(1);
    this.m = new THREE.Matrix4();

    const disc = new THREE.CircleGeometry(1, 32);
    this.ring = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_DOTS);
    this.dot = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0xe0201b }), MAX_DOTS);
    for (const im of [this.ring, this.dot]) {
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(im);
    }
    this.visible = false;
    this.setVisible(false);
  }

  setVisible(v) {
    this.visible = v;
    this.ring.visible = v;
    this.dot.visible = v;
  }

  // count, radius (m), moving, speed (m/s), t: now, seed: layout seed.
  configure({ count, radius, moving, speed }, t, seed) {
    this.count = Math.max(1, Math.min(MAX_DOTS, count));
    this.radius = radius;
    this.moving = moving;
    this.speed = speed;
    this.t0 = t;
    this.rng = mulberry32(seed >>> 0);
    for (let i = 0; i < this.count; i++) this._place(i, t);
    this.ring.count = this.dot.count = this.count;
    this.update(t, true);
  }

  // Wall-plane x of dot i at time t.
  xAt(i, t) {
    if (!this.moving) return this.x0[i];
    const span = 2 * WRAP;
    let x = (this.x0[i] + WRAP + (t - this.t0) * this.speed) % span;
    if (x < 0) x += span;
    return x - WRAP;
  }

  // Put dot i at a random free spot, at least a dot and a half away from the others.
  _place(i, t) {
    const minGap = this.radius * 3 + 0.15;
    let x = 0, y = 0;
    for (let tries = 0; tries < 40; tries++) {
      x = (this.rng() * 2 - 1) * X_RANGE;
      y = Y_MIN + this.rng() * (Y_MAX - Y_MIN);
      let ok = true;
      for (let j = 0; j < this.count && ok; j++) {
        if (j === i) continue;
        if (Math.hypot(this.xAt(j, t) - x, this.y[j] - y) < minGap) ok = false;
      }
      if (ok) break;
    }
    // Store the start position so that xAt(i, t) === x right now.
    this.x0[i] = this.moving ? x - (t - this.t0) * this.speed : x;
    this.y[i] = y;
  }

  // Index of the dot hit at plane point (px, py) at time t, or -1.
  hitTest(px, py, t) {
    if (!this.visible) return -1;
    const r2 = this.radius * this.radius;
    for (let i = 0; i < this.count; i++) {
      const dx = px - this.xAt(i, t), dy = py - this.y[i];
      if (dx * dx + dy * dy <= r2) return i;
    }
    return -1;
  }

  // Dot i was shot: move it somewhere new.
  pop(i, t) {
    this._place(i, t);
    this.update(t, true);
  }

  update(t, force) {
    if (!this.visible || (!this.moving && !force)) return;
    const r = this.radius;
    for (let i = 0; i < this.count; i++) {
      const x = this.xAt(i, t), y = this.y[i];
      this.m.makeScale(r, r, 1).setPosition(x, y, 0.01);
      this.ring.setMatrixAt(i, this.m);
      this.m.makeScale(r * 0.82, r * 0.82, 1).setPosition(x, y, 0.012);
      this.dot.setMatrixAt(i, this.m);
    }
    this.ring.instanceMatrix.needsUpdate = true;
    this.dot.instanceMatrix.needsUpdate = true;
  }
}
