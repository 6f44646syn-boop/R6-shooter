// Synthesised sounds (WebAudio): no audio files, no network.
// The AudioContext is created on the first user gesture, as browsers require.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.35;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // One shared second of white noise; each shot plays a slice of it.
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) >>> 0; d[i] = seed / 2147483648 - 1; }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // Where a sound goes: pan -1 (left) .. 1 (right); muffle 0..1 (behind you or through walls:
  // a low-pass filter takes the top off).
  _out(pan = 0, muffle = 0) {
    const c = this.ctx;
    let node = this.master;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(node); node = p; }
    if (muffle > 0.01) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 9000 * Math.pow(0.12, muffle); f.connect(node); node = f; }
    return node;
  }

  // tone 0..1 shifts the pitch a little so guns sound different.
  // vol 0..1: quieter for distant shooters; pan / muffle: where it came from (see _out).
  shot(tone = 0.5, vol = 1, pan = 0, muffle = 0) {
    const c = this.ctx;
    if (!c || this.volume <= 0) return;
    const t = c.currentTime, out = this._out(pan, muffle);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200 - tone * 2400, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.9 * vol), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(lp).connect(g).connect(out);
    src.start(t, Math.random() * 0.7, 0.2);

    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150 - tone * 60, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const og = c.createGain();
    og.gain.setValueAtTime(Math.max(0.0002, 0.7 * vol), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.15);
  }

  // A footstep: a soft thud and a scuff.
  step(vol = 0.5, pan = 0, muffle = 0) {
    const c = this.ctx;
    if (!c || this.volume <= 0 || vol < 0.01) return;
    const t = c.currentTime, out = this._out(pan, muffle);
    const src = c.createBufferSource(); src.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 300; bp.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.55 * vol), t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 0.8, 0.1);
  }
  // The knife: a quick swish.
  knife(vol = 1, pan = 0, muffle = 0) {
    const c = this.ctx;
    if (!c || this.volume <= 0) return;
    const t = c.currentTime, out = this._out(pan, muffle);
    const src = c.createBufferSource(); src.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(1500, t); bp.frequency.exponentialRampToValueAtTime(5000, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 0.7, 0.16);
  }
  // Wood splintering (a door breaking).
  crack(vol = 1, pan = 0, muffle = 0) {
    const c = this.ctx;
    if (!c || this.volume <= 0) return;
    const t = c.currentTime, out = this._out(pan, muffle);
    for (let i = 0; i < 4; i++) {
      const s = t + i * 0.035 + Math.random() * 0.02;
      const src = c.createBufferSource(); src.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700 + Math.random() * 1600; bp.Q.value = 3;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.5 * vol, s + 0.004); g.gain.exponentialRampToValueAtTime(0.001, s + 0.12);
      src.connect(bp).connect(g).connect(out);
      src.start(s, Math.random() * 0.7, 0.13);
    }
  }

  // Radio squelch: a short burst of band-passed noise before a bot speaks.
  radio() {
    const c = this.ctx;
    if (!c || this.volume <= 0) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.4;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.7, 0.13);
  }

  click() {
    const c = this.ctx;
    if (!c || this.volume <= 0) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1800, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.04);
  }

  reload() {
    const c = this.ctx;
    if (!c || this.volume <= 0) return;
    const t = c.currentTime;
    for (const [dt, f] of [[0, 900], [0.09, 600]]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t + dt);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.06);
      o.connect(g).connect(this.master);
      o.start(t + dt);
      o.stop(t + dt + 0.07);
    }
  }
}
