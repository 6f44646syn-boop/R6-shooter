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
  const ny = ctx.sampleRate * 0.45;   // partials above this would alias (and warn)
  const bell = (t, f, peak = 0.08) => { tone(t, 1.6, f, f, 'sine', peak, 0.004); if (f * 2.76 < ny) tone(t, 1.0, f * 2.76, f * 2.76, 'sine', peak * 0.4, 0.003); if (f * 5.4 < ny) tone(t, 0.6, f * 5.4, f * 5.4, 'sine', peak * 0.2, 0.002); };
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
      whoosh(at(0.76), 0.5, 0.12); tone(at(0.76), 0.4, 150, 45, 'sine', 0.2, 0.005); noise(at(0.765), 0.9, 300, 0.7, 0.1, 'lowpass', 0.05, 90);   // the kraken lets go: ink
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
    forge() {       // Forgeheart: the furnace, the core cracking, three hammer blows on the anvil, the pour, the quench
      noise(at(0.12), S * 0.75, 180, 0.6, 0.14, 'lowpass', 1.2);
      for (let i = 0; i < 70; i++) noise(at(0.2 + r() * 0.65), 0.03, 2500 + r() * 3000, 2, 0.12, 'bandpass', 0.002);
      tone(at(0.32), 0.9, 70, 35, 'sine', 0.3, 0.004); noise(at(0.32), 0.5, 700, 0.8, 0.25, 'bandpass', 0.002, 200);            // the first blow splits it open
      for (let i = 0; i < 14; i++) noise(at(0.325 + r() * 0.2), 0.05, 1200 + r() * 1500, 2, 0.12, 'bandpass', 0.002);         // ... and it keeps cracking
      [0.32, 0.4, 0.48].forEach((h, i) => {                                                                                       // the hammer on the anvil
        noise(at(h) - 0.06, 0.08, 500, 0.7, 0.05, 'bandpass', 0.05, 1600);                                                         // its swing
        noise(at(h), 0.05, 3500, 0.8, 0.4, 'bandpass', 0.001); tone(at(h), 0.25, 160, 60, 'sine', 0.35, 0.002);
        bell(at(h), 1180 + i * 40, 0.12); bell(at(h), 1720 + i * 60, 0.06);
        for (let k = 0; k < 10; k++) noise(at(h) + r() * 0.4, 0.02, 3500 + r() * 3000, 2, 0.08, 'bandpass', 0.002);              // sparks
      });
      noise(at(0.635), 0.12 * S + 0.6, 4800, 0.6, 0.12, 'highpass', 0.15);                                                     // the steam hissing up
      noise(at(0.84), 1.6, 5200, 0.5, 0.22, 'highpass', 0.01); noise(at(0.84), 0.12, 1800, 1, 0.25, 'bandpass', 0.002);       // the quench: a hiss of steam
      for (let i = 0; i < 24; i++) noise(at(0.84 + r() * 0.06), 0.03, 3000 + r() * 3000, 2, 0.1, 'bandpass', 0.002);
    },
    orrery() {      // Midnight Orrery: the portal hums open, a starry shimmer
      tone(at(0.1), S * 0.8, 110, 110, 'sine', 0.08, 1.2); tone(at(0.1), S * 0.8, 165, 165, 'sine', 0.05, 1.5); tone(at(0.1), S * 0.8, 220.5, 220.5, 'sine', 0.04, 1.8);
      for (let i = 0; i < 24; i++) bell(at(0.2 + r() * 0.65), 1500 + r() * 2500, 0.025);
    },
    amber() {       // Amber Reliquary: a buzzing swarm, each fly plopping into the resin, the gloop
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 190; lfo.frequency.value = 9; lg.gain.value = 22; lfo.connect(lg).connect(o.frequency);
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.4;
      g.gain.setValueAtTime(0.0001, at(0.1)); g.gain.linearRampToValueAtTime(0.06, at(0.14)); g.gain.setValueAtTime(0.06, at(0.68)); g.gain.linearRampToValueAtTime(0.0001, at(0.69));
      o.connect(f).connect(g).connect(out); o.start(at(0.1)); lfo.start(at(0.1)); o.stop(at(0.7)); lfo.stop(at(0.7));
      // the swarm: a second, higher buzz; then each fly plops into the resin, the big one last
      tone(at(0.12), (0.68 - 0.12) * S, 330, 300, 'sawtooth', 0.012, 0.6); tone(at(0.14), (0.66 - 0.14) * S, 410, 380, 'sawtooth', 0.01, 0.6);
      for (const h of [0.585, 0.605, 0.625, 0.645, 0.66, 0.675]) { tone(at(h), 0.14, 420, 140, 'sine', 0.16, 0.002); noise(at(h), 0.06, 1800, 1, 0.08, 'bandpass', 0.002); }
      tone(at(0.69), 0.22, 300, 80, 'sine', 0.3, 0.002); noise(at(0.69), 0.1, 1500, 1, 0.15, 'bandpass', 0.002);
      for (let i = 0; i < 5; i++) tone(at(0.3 + r() * 0.5), 0.25, 180, 70, 'sine', 0.06, 0.01);
    },
    jade() {        // Jade Coil: the dragon's low growl, scales rustling, a sparkle of gold
      tone(at(0.12), 1.4, 70, 55, 'sawtooth', 0.06, 0.3); noise(at(0.12), 1.6, 300, 1, 0.06, 'bandpass', 0.4);
      noise(at(0.2), S * 0.6, 3500, 0.8, 0.03, 'bandpass', 1);
      for (let i = 0; i < 16; i++) bell(at(0.15 + r() * 0.7), 2000 + r() * 2000, 0.025);
      noise(at(0.5), 0.06, 2200, 1, 0.3, 'bandpass', 0.002); tone(at(0.5), 0.1, 180, 80, 'square', 0.1, 0.002);     // the jaws close on the pearl
      for (let i = 0; i < 5; i++) bell(at(0.505 + i * 0.008), 1400 + i * 350, 0.05);
      noise(at(0.54), 0.16 * S, 900, 0.7, 0.05, 'bandpass', 0.12 * S, 300);                                          // it swims to the muzzle ...
      for (let i = 0; i < 16; i++) noise(at(0.66 + i * 0.006), 0.04, 4200 + r() * 1500, 3, 0.05, 'bandpass', 0.002); // ... and the scales click into place, muzzle to stock
      tone(at(0.83), 1.0, 60, 48, 'sawtooth', 0.08, 0.2);                                                            // a growl ...
      noise(at(0.865), (0.1 * S) + 0.4, 700, 0.6, 0.2, 'bandpass', 0.08, 1600);                                     // ... and it breathes fire
      noise(at(0.865), (0.1 * S) + 0.4, 160, 0.8, 0.14, 'lowpass', 0.1);
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
      tone(at(0.645), 0.3, 190, 60, 'sine', 0.22, 0.01);                                                             // the gulp
      for (let i = 0; i < 10; i++) bell(at(0.7 + r() * 0.08), 1600 + r() * 2400, 0.03);                              // the shimmer
      tone(at(0.8), 0.8, 95, 62, 'sawtooth', 0.1, 0.12); noise(at(0.8), 0.8, 450, 0.7, 0.16, 'lowpass', 0.1, 220);   // the roar
      tone(at(0.665), 0.075 * S, 500, 2600, 'sine', 0.05, 0.05); tone(at(0.665), 0.075 * S, 750, 3900, 'sine', 0.03, 0.05);   // the colour wave sweeping back
      for (let i = 0; i < 12; i++) bell(at(0.665 + i * 0.0065), 900 * Math.pow(2, i / 6), 0.03);
      noise(at(0.887), 0.06, 1800, 1, 0.3, 'bandpass', 0.002); tone(at(0.887), 0.1, 160, 70, 'square', 0.12, 0.002); // snapping shut
    },
    ice() {         // Black Ice: frost creaking and crackling
      for (let i = 0; i < 40; i++) noise(at(0.2 + r() * 0.6), 0.04, 5000 + r() * 4000, 3, 0.07, 'bandpass', 0.002);
      noise(at(0.25), 1.2, 2500, 0.8, 0.04, 'highpass', 0.5);
    },
  };
  (D[look] || (() => {}))();
  return { stop() { const t = ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + 0.15); setTimeout(() => out.disconnect(), 400); } };
}
