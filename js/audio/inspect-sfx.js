// Sound for the Legendary (and Black Ice) inspects: a short sound design per skin, scheduled on the
// game's own audio context and played through its master volume. Built from tones and filtered
// noise only (no files). playInspect returns a stop() that fades it out if the inspect is cancelled.
// (Kept apart from js/audio/sfx.js, which is Codex's.)
const KILN_STRIKES = [0.26, 0.31, 0.35, 0.4, 0.43, 0.47, 0.5, 0.53, 0.57, 0.6, 0.63, 0.67, 0.71, 0.76];

export function playInspect(sfx, look, seconds) {
  if (!sfx || !look) return null;
  sfx.unlock?.();
  const ctx = sfx.ctx;
  if (!ctx || !sfx.master) return null;
  const out = ctx.createGain(); out.gain.value = 0.9; out.connect(sfx.master);
  const T0 = ctx.currentTime + 0.02, S = seconds || 8.4, at = (f) => T0 + f * S;
  let rnd = 1234567; const r = () => ((rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0) / 4294967296);
  const env = (g, t, a, d, peak) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const tone = (t, dur, f0, f1, type = 'sine', peak = 0.2, attack = 0.01) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, attack, dur, peak); o.connect(g).connect(out); o.start(t); o.stop(t + attack + dur + 0.05);
  };
  const noise = (t, dur, hz, q = 1, peak = 0.2, type = 'bandpass', attack = 0.01, hzTo = hz) => {
    const n = ctx.createBufferSource(); n.buffer = sfx.noise; n.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(hz, t); if (hzTo !== hz) f.frequency.exponentialRampToValueAtTime(hzTo, t + dur); f.Q.value = q;
    const g = ctx.createGain(); env(g, t, attack, dur, peak);
    n.connect(f).connect(g).connect(out); n.start(t, r()); n.stop(t + attack + dur + 0.05);
  };
  const bell = (t, f, peak = 0.08) => { tone(t, 1.6, f, f, 'sine', peak, 0.004); tone(t, 1.0, f * 2.76, f * 2.76, 'sine', peak * 0.4, 0.003); tone(t, 0.6, f * 5.4, f * 5.4, 'sine', peak * 0.2, 0.002); };
  const whoosh = (t, dur, peak = 0.12) => noise(t, dur, 300, 0.7, peak, 'bandpass', dur * 0.5, 2400);
  whoosh(at(0.02), 0.6, 0.07);                                        // the gun coming up
  const D = {
    porcelain() {   // Storm Kiln: wind and rain, thunder with every strike
      noise(at(0.1), S * 0.75, 4000, 0.4, 0.05, 'highpass', 1.2);
      noise(at(0.12), S * 0.7, 500, 0.6, 0.05, 'bandpass', 1.5);
      for (const s of KILN_STRIKES) { noise(at(s), 0.08, 5000, 0.3, 0.35, 'highpass', 0.002); noise(at(s) + 0.05, 1.6 + r(), 120, 0.7, 0.4, 'lowpass', 0.05, 60); }
    },
    bronze() {      // Abyssal Crown: deep water, bubbles, the shell winding up, the blast
      tone(at(0.05), S * 0.8, 55, 50, 'sine', 0.12, 1.5);
      for (let i = 0; i < 40; i++) { const t = at(0.08 + r() * 0.8), f = 300 + r() * 600; tone(t, 0.08, f, f * 2.4, 'sine', 0.05, 0.003); }
      tone(at(0.4), S * 0.28, 120, 900, 'sawtooth', 0.04, S * 0.25);
      noise(at(0.69), 1.8, 200, 0.6, 0.45, 'lowpass', 0.01, 50); tone(at(0.69), 1.2, 90, 40, 'sine', 0.35, 0.005);
    },
    glass() {       // Vesper Glass: shatter, chimes caught in time, the rewind
      noise(at(0.36), 0.5, 6000, 0.5, 0.25, 'highpass', 0.002); for (let i = 0; i < 10; i++) bell(at(0.36) + r() * 0.4, 1800 + r() * 2400, 0.04);
      for (let i = 0; i < 6; i++) bell(at(0.47 + i * 0.025), 1200 + r() * 1600, 0.03);
      noise(at(0.62), 0.9, 800, 0.8, 0.12, 'bandpass', 0.8, 6000);
    },
    lacquer() {     // Sakura Gilt: wind through blossom, soft chimes
      noise(at(0.15), S * 0.6, 1200, 0.5, 0.04, 'bandpass', 1.5);
      const pent = [523, 587, 659, 784, 880, 1047]; for (let i = 0; i < 12; i++) bell(at(0.25 + i * 0.045), pent[Math.floor(r() * pent.length)], 0.05);
    },
    forge() {       // Forgeheart: a furnace roar, crackling fire, the shards breaking out
      noise(at(0.15), S * 0.7, 180, 0.6, 0.14, 'lowpass', 1.2);
      for (let i = 0; i < 70; i++) noise(at(0.2 + r() * 0.65), 0.03, 2500 + r() * 3000, 2, 0.12, 'bandpass', 0.002);
      for (let i = 0; i < 6; i++) { tone(at(0.4 + i * 0.012), 0.4, 1900 + r() * 900, 1500, 'triangle', 0.06, 0.002); noise(at(0.4 + i * 0.012), 0.15, 900, 1, 0.15, 'bandpass', 0.002); }
    },
    orrery() {      // Midnight Orrery: the portal hums open, a starry shimmer
      tone(at(0.1), S * 0.8, 110, 110, 'sine', 0.08, 1.2); tone(at(0.1), S * 0.8, 165, 165, 'sine', 0.05, 1.5); tone(at(0.1), S * 0.8, 220.5, 220.5, 'sine', 0.04, 1.8);
      for (let i = 0; i < 24; i++) bell(at(0.2 + r() * 0.65), 1500 + r() * 2500, 0.025);
    },
    amber() {       // Amber Reliquary: a buzzing fly, the bonk, the resin gloop
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 190; lfo.frequency.value = 9; lg.gain.value = 22; lfo.connect(lg).connect(o.frequency);
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.4;
      g.gain.setValueAtTime(0.0001, at(0.1)); g.gain.linearRampToValueAtTime(0.06, at(0.14)); g.gain.setValueAtTime(0.06, at(0.68)); g.gain.linearRampToValueAtTime(0.0001, at(0.69));
      o.connect(f).connect(g).connect(out); o.start(at(0.1)); lfo.start(at(0.1)); o.stop(at(0.7)); lfo.stop(at(0.7));
      tone(at(0.69), 0.18, 300, 90, 'sine', 0.3, 0.002); noise(at(0.69), 0.1, 1500, 1, 0.15, 'bandpass', 0.002);
      for (let i = 0; i < 5; i++) tone(at(0.3 + r() * 0.5), 0.25, 180, 70, 'sine', 0.06, 0.01);
    },
    jade() {        // Jade Coil: the dragon's low growl, scales rustling, a sparkle of gold
      tone(at(0.12), 1.4, 70, 55, 'sawtooth', 0.06, 0.3); noise(at(0.12), 1.6, 300, 1, 0.06, 'bandpass', 0.4);
      noise(at(0.2), S * 0.6, 3500, 0.8, 0.03, 'bandpass', 1);
      for (let i = 0; i < 16; i++) bell(at(0.15 + r() * 0.7), 2000 + r() * 2000, 0.025);
    },
    velvet() {      // Velvet Ante: cards whirring, the charge, the chip, the cards falling
      for (let i = 0; i < 30; i++) noise(at(0.08 + r() * 0.4), 0.04, 3000, 2, 0.08, 'bandpass', 0.002);
      tone(at(0.55), S * 0.15, 200, 1200, 'sine', 0.05, S * 0.12);
      tone(at(0.6), 0.2, 2600, 2600, 'triangle', 0.08, 0.002); tone(at(0.61), 0.25, 3400, 3400, 'triangle', 0.05, 0.002);
      for (let i = 0; i < 18; i++) noise(at(0.78 + r() * 0.15), 0.05, 2200, 2, 0.06, 'bandpass', 0.002);
    },
    opal() {        // Opal Overture: the eye opens, a fly, the snap, a prismatic glitter
      tone(at(0.16), 0.9, 80, 140, 'sawtooth', 0.04, 0.4); noise(at(0.16), 0.9, 400, 2, 0.04, 'bandpass', 0.4);
      tone(at(0.42), (0.6 - 0.42) * S, 230, 230, 'sawtooth', 0.025, 0.1);
      noise(at(0.6), 0.08, 1800, 1, 0.3, 'bandpass', 0.002); tone(at(0.6), 0.12, 160, 70, 'square', 0.12, 0.002);
      for (let i = 0; i < 20; i++) bell(at(0.45 + r() * 0.4), 1800 + r() * 3000, 0.02);
    },
    ice() {         // Black Ice: frost creaking and crackling
      for (let i = 0; i < 40; i++) noise(at(0.2 + r() * 0.6), 0.04, 5000 + r() * 4000, 3, 0.07, 'bandpass', 0.002);
      noise(at(0.25), 1.2, 2500, 0.8, 0.04, 'highpass', 0.5);
    },
  };
  (D[look] || (() => {}))();
  return { stop() { const t = ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + 0.15); setTimeout(() => out.disconnect(), 400); } };
}
