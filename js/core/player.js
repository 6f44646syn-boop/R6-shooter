// Player movement: WASD inside a small box behind the firing line, hold Shift to sprint,
// hold Space to crouch.
// Frame-rate independent (velocity eases towards the target with exp(-k dt)).
//
// Coordinates: metres, x right, z towards the player. The firing line is z = 0 and you can
// never step past it (z >= 0). The box is BOX.halfWidth either side and BOX.depth behind.

export const STAND_EYE = 1.6;
export const CROUCH_EYE = 1.05;
export const BOX = { halfWidth: 1.5, depth: 2.0 };
const WALK = 3.0, SPRINT = 5.5, CROUCH_WALK = 1.5;   // m/s (no sprinting while crouched or aiming)
const ACCEL = 14;                      // 1/s, how fast velocity reaches the target
const CROUCH_RATE = 16;                // 1/s, eye height easing (snappy: ~95% in 0.2 s)

export class Player {
  constructor() {
    this.x = 0; this.z = 0;
    this.vx = 0; this.vz = 0;
    this.eye = STAND_EYE;
    this.crouched = false;
    this.sprint = false;     // Shift held
    this.keys = { w: false, a: false, s: false, d: false };
  }

  reset() {
    this.x = this.z = this.vx = this.vz = 0;
  }

  toggleCrouch() { this.crouched = !this.crouched; }

  releaseKeys() { this.keys.w = this.keys.a = this.keys.s = this.keys.d = false; this.sprint = false; }

  // yawDeg: where the player faces (positive = right). Moves relative to that heading.
  get sprinting() { return this.sprint && !this.crouched && !this._aiming && this.speed > 0.1; }

  update(dt, yawDeg, aiming = false) {
    this._aiming = aiming;
    const fwd = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0);
    const side = (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0);
    let tx = 0, tz = 0;
    if (fwd || side) {
      const y = yawDeg * Math.PI / 180;
      // forward = (sin y, -cos y), right = (cos y, sin y) in (x, z)
      tx = fwd * Math.sin(y) + side * Math.cos(y);
      tz = -fwd * Math.cos(y) + side * Math.sin(y);
      const l = Math.hypot(tx, tz);
      const sp = this.crouched ? CROUCH_WALK : (this.sprint && !aiming ? SPRINT : WALK);
      tx = tx / l * sp; tz = tz / l * sp;
    }
    const k = 1 - Math.exp(-ACCEL * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    // Small box behind the firing line; stop at the edges.
    if (this.x < -BOX.halfWidth) { this.x = -BOX.halfWidth; this.vx = 0; }
    if (this.x > BOX.halfWidth) { this.x = BOX.halfWidth; this.vx = 0; }
    if (this.z < 0) { this.z = 0; this.vz = 0; }
    if (this.z > BOX.depth) { this.z = BOX.depth; this.vz = 0; }
    const target = this.crouched ? CROUCH_EYE : STAND_EYE;
    this.eye += (target - this.eye) * (1 - Math.exp(-CROUCH_RATE * dt));
    if (Math.abs(target - this.eye) < 1e-4) this.eye = target;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
}
