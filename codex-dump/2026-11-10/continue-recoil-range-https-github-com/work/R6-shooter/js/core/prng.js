// Small seeded PRNG so a magazine's jitter can be replayed exactly.

// mulberry32: 32-bit state, uniform floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal samples (mean 0, sd 1) via Box-Muller, using a mulberry32 stream.
export class GaussianRng {
  constructor(seed) { this.reseed(seed); }

  reseed(seed) {
    this.seed = seed >>> 0;
    this.u = mulberry32(this.seed);
    this.spare = NaN;
  }

  next() {
    if (!Number.isNaN(this.spare)) { const s = this.spare; this.spare = NaN; return s; }
    let u1 = this.u();
    if (u1 < 1e-12) u1 = 1e-12; // avoid log(0)
    const u2 = this.u();
    const r = Math.sqrt(-2 * Math.log(u1));
    this.spare = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  }
}

export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}
