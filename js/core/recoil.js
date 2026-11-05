// Data-driven recoil ("view punch").
//
// sprayPath[i] = [yawDeg, pitchDeg] is where bullet i lands relative to bullet 0 if the player
// does not move the mouse at all (exactly what a traced spray on a wall gives). Positive yaw =
// right, positive pitch = up.
//
// Runtime model, per shot:
//   1. The bullet leaves through the crosshair centre, i.e. along aim + current recoil offset.
//   2. The shot then "kicks" the offset by the step to the next bullet:
//        step(i) = sprayPath[i] - sprayPath[i-1]   (+ Gaussian jitter, sd from the gun data)
//      Past the end of sprayPath the step is the average of the last TAIL_STEPS steps, or zero
//      when the gun has "tail": "hold" (the view stays at the last measured point).
//   3. The offset eases from where it was to (where it was + step) over EASE_FRACTION of the
//      shot interval, so the crosshair climbs smoothly and has arrived before the next shot.
// With zero jitter and no mouse input, bullet i therefore lands exactly at sprayPath[i].
// Jitter is added to each step, so it accumulates along the spray like real per-shot kicks.
//
// After the last shot the offset holds for recovery.delaySeconds (never less than one shot
// interval, so recovery cannot creep in between the shots of a held spray), then returns in a
// straight line to zero at recovery.degPerSecond. shotIndex goes back to 0 once resetSeconds pass
// without a shot.

import { GaussianRng } from './prng.js';

export const TAIL_STEPS = 3;
export const EASE_FRACTION = 0.4;

export function easeOutCubic(x) {
  const u = 1 - x;
  return 1 - u * u * u;
}

// Step (kick) that takes the spray from bullet i-1 to bullet i, for i >= 1. Writes into out.
export function sprayStep(path, i, out, tail = 'extrapolate') {
  const n = path.length;
  if (i >= n && tail === 'hold') { out[0] = 0; out[1] = 0; return out; }
  if (i < n) {
    out[0] = path[i][0] - path[i - 1][0];
    out[1] = path[i][1] - path[i - 1][1];
    return out;
  }
  // Extrapolate: average of the last few steps (path[n-1] - path[n-1-k]) / k.
  const k = Math.min(TAIL_STEPS, n - 1);
  if (k <= 0) { out[0] = 0; out[1] = 0; return out; }
  out[0] = (path[n - 1][0] - path[n - 1 - k][0]) / k;
  out[1] = (path[n - 1][1] - path[n - 1 - k][1]) / k;
  return out;
}

// Uncompensated, jitter-free offset of bullet i from bullet 0 (extrapolated past the end).
export function sprayTarget(path, i, out, tail = 'extrapolate') {
  const n = path.length;
  if (i < n) {
    out[0] = path[i][0] - path[0][0];
    out[1] = path[i][1] - path[0][1];
    return out;
  }
  const tailStep = sprayStep(path, n, [0, 0], tail);
  const extra = i - (n - 1);
  out[0] = path[n - 1][0] - path[0][0] + tailStep[0] * extra;
  out[1] = path[n - 1][1] - path[0][1] + tailStep[1] * extra;
  return out;
}

// Jitter-free offset a fraction f (0..1) of the way through the interval after bullet i was
// fired, i.e. what the view punch shows between bullet i and bullet i+1.
export function sampleSpray(path, i, f, out) {
  const a = sprayTarget(path, i, [0, 0]);
  const b = sprayTarget(path, i + 1, [0, 0]);
  const x = Math.min(1, Math.max(0, f / EASE_FRACTION));
  const e = easeOutCubic(x);
  out[0] = a[0] + (b[0] - a[0]) * e;
  out[1] = a[1] + (b[1] - a[1]) * e;
  return out;
}

export class RecoilEngine {
  constructor() {
    this.rng = new GaussianRng(1);
    this.step = [0, 0];
    this.gun = null;
    this.scale = 1; // per-sight sprayPath multiplier (gun.opticRecoilScale), 1 = unchanged
    this.reset();
  }

  setScale(k) { this.scale = k; }

  setGun(gun) {
    this.gun = gun;
    this.reset();
  }

  reset() {
    this.shotIndex = 0;          // index of the next bullet in the spray
    this.lastShot = -Infinity;
    this.from = [0, 0];
    this.to = [0, 0];
    this.easeStart = -Infinity;
    this.easeDur = 0;
    this.interval = 0;
  }

  // Start a magazine's jitter stream.
  newMagazine(seed) {
    this.rng.reseed(seed);
  }

  // Current recoil offset at time t (seconds), written to out [yawDeg, pitchDeg].
  offsetAt(t, out) {
    const from = this.from, to = this.to;
    if (t < this.easeStart + this.easeDur) {
      const e = easeOutCubic(Math.max(0, (t - this.easeStart) / this.easeDur));
      out[0] = from[0] + (to[0] - from[0]) * e;
      out[1] = from[1] + (to[1] - from[1]) * e;
      return out;
    }
    const rec = this.gun ? this.gun.recovery : null;
    const recStart = this.lastShot + Math.max(this.interval, rec ? rec.delaySeconds : 0);
    if (!rec || rec.degPerSecond <= 0 || t <= recStart) {
      out[0] = to[0]; out[1] = to[1];
      return out;
    }
    const mag = Math.hypot(to[0], to[1]);
    const left = mag - rec.degPerSecond * (t - recStart);
    const s = (mag > 0 && left > 0) ? left / mag : 0;
    out[0] = to[0] * s;
    out[1] = to[1] * s;
    return out;
  }

  // Fire a bullet at time t. Writes the bullet's recoil offset (where it leaves relative to
  // the aim) into out, then applies the kick for the next bullet.
  fire(t, out) {
    const gun = this.gun;
    if (t - this.lastShot > gun.resetSeconds) this.shotIndex = 0;
    this.offsetAt(t, out);

    const i = this.shotIndex + 1;
    sprayStep(gun.sprayPath, i, this.step, gun.tail);
    this.step[0] *= this.scale;
    this.step[1] *= this.scale;
    const jy = gun.jitter.yawDeg, jp = gun.jitter.pitchDeg;
    // Always draw two samples so the stream stays aligned even if one sd is 0.
    const ny = this.rng.next(), np = this.rng.next();
    this.from[0] = out[0];
    this.from[1] = out[1];
    this.to[0] = out[0] + this.step[0] + ny * jy;
    this.to[1] = out[1] + this.step[1] + np * jp;
    this.easeStart = t;
    this.interval = 60 / gun.rpm;
    this.easeDur = EASE_FRACTION * this.interval;
    this.lastShot = t;
    this.shotIndex = i;
    return out;
  }
}
