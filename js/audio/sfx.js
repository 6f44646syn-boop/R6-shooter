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

  // tone 0..1 shifts the pitch a little so guns sound different.
  shot(tone = 0.5) {
    const c = this.ctx;
    if (!c || this.volume <= 0) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200 - tone * 2400, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.7, 0.2);

    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150 - tone * 60, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const og = c.createGain();
    og.gain.setValueAtTime(0.7, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
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
