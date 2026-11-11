// Hip-fire spread: bullets leave in a random direction inside a cone around the crosshair.
// The cone starts at a per-gun-type size, blooms with every shot while you keep firing,
// shrinks back when you stop, is wider while moving and tighter crouched, and fades out as
// you aim in (none at all when aimed: aimed sprays stay exactly as measured).

// Base cone half-angle, degrees.
export const HIP_CONE = { smg: 2.4, carbine: 2.8, rifle: 3.0, lmg: 3.8, marksman: 3.4 };
const BLOOM_PER_SHOT = 0.35, BLOOM_MAX = 3.5, BLOOM_DECAY = 6;   // deg, deg, deg/s
const BLOOM_HOLD = 0.15;        // s: bloom only shrinks once you pause this long (full auto keeps it)
const MOVING = 1.5, CROUCHED = 0.75;

export class Spread {
  constructor() { this.bloom = 0; this.last = -1e9; }
  reset() { this.bloom = 0; this.last = -1e9; }
  _bloomAt(t) { return Math.max(0, this.bloom - Math.max(0, t - this.last - BLOOM_HOLD) * BLOOM_DECAY); }

  // Cone half-angle (degrees) right now. aimE: 0 hip .. 1 aimed.
  cone(t, gun, moving, crouched, aimE = 0) {
    const b = this._bloomAt(t);
    const base = (HIP_CONE[gun.model] || 3) * (gun.hipCone || 1) + b;   // hipCone: attachments (laser)
    const k = (moving ? MOVING : 1) * (crouched ? CROUCHED : 1);
    const hip = (1 - aimE) * (1 - aimE);
    return base * k * hip;
  }

  // Offset for a bullet fired at t, written to out [yawDeg, pitchDeg] (uniform in the cone).
  shot(t, gun, moving, crouched, aimE, rng = Math.random, out = [0, 0]) {
    const c = this.cone(t, gun, moving, crouched, aimE);
    const r = c * Math.sqrt(rng()), a = rng() * Math.PI * 2;
    out[0] = r * Math.cos(a); out[1] = r * Math.sin(a);
    this.bloom = Math.min(BLOOM_MAX, this._bloomAt(t) + BLOOM_PER_SHOT);
    this.last = t;
    return out;
  }
}
