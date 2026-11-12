import { Hearing } from './hearing.js?v=3884a5c-mwdhrmgv';
import { decodeAudioPack } from './audio-pack.js?v=3884a5c-mwdhrmgv';
// WebAudio output only: sound propagation, surface profiles and step cadence are Rust-owned.
import { cameraPose } from './acoustics.js?v=3884a5c-mwdhrmgv';
const clamp = (v, lo, hi) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
export class Sfx {
  constructor(acoustics = null) {
    this.acoustics = acoustics;
    this.ctx = null;
    this.volume = 0.35;
    this.spatialAudio = true;
    this.samplePack = null;
    this.voices = new Set();
    this.maxVoices = 32;
    this.stats = { played: 0, stolen: 0, culled: 0, peak: 0 };
  }
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AC) this._setup(new AC());
  }
  _setup(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 10;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.15;
    this.hearing = new Hearing(ctx, this.master, this.limiter);
    this.limiter.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      d[i] = seed / 2147483648 - 1;
    }
  }
  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  }
  listen(camera) {
    if (!this.ctx || !this.acoustics || !camera) return;
    const p = cameraPose(camera),
      o = this.acoustics.orientation(p),
      l = this.ctx.listener,
      t = this.ctx.currentTime;
    if (l.positionX) {
      ['X', 'Y', 'Z'].forEach((axis, i) => {
        l['position' + axis].setValueAtTime([p.x, p.y, p.z][i], t);
        l['forward' + axis].setValueAtTime(o.forward[i], t);
        l['up' + axis].setValueAtTime(o.up[i], t);
      });
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(...o.forward, ...o.up);
    }
  }
  locate(kind, source, camera, geometry, arena = null, options = {}) {
    const p = cameraPose(camera);
    this.listen(camera);
    return this.acoustics.locate(kind, source, p, geometry, arena, {
      ...options,
      trace: !!this.ctx && this.volume > 0,
    });
  }
  observeSteps(actors, camera, geometry, time, arena = null, ownId = null) {
    if (!this.ctx || this.volume <= 0 || !this.acoustics || !camera) return;
    this.listen(camera);
    this.acoustics.configure(geometry, arena);
    const team = actors.find((a) => a.id === ownId)?.team;
    for (const a of actors) {
      const range = this.acoustics.e.ma_step(
        a.id ?? 0,
        time,
        a.x,
        a.y || 0,
        a.z,
        +!!a.alive,
        a.crouch || 0,
      );
      if (!range) continue;
      const y = a.y || 0;
      this.stepAt(
        { x: a.x, y: y + 0.12, z: a.z, feetY: y },
        camera,
        geometry,
        arena,
        range,
        a.team === team,
      );
    }
  }
  stepAt(source, camera, geometry, arena, noiseRange, teammate = false) {
    const w = this.locate('step', source, camera, geometry, arena, {
      reach: this.acoustics.e.ma_reach(noiseRange),
      teammate,
    });
    this.step(w.gain, w.route, w.muffle, w.step);
    return w;
  }
  _dispose(v) {
    if (v.disposed) return;
    v.disposed = true;
    for (const s of v.sources) {
      try {
        s.stop();
      } catch {}
      s.onended = null;
    }
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {}
    }
    this.voices.delete(v);
  }
  stopAll() {
    this.hearing?.reset();
    for (const v of [...this.voices]) this._dispose(v);
    this.acoustics?.e.ma_steps_clear();
  }
  _voice(volume, route = 0, muffle = 0, priority = 1) {
    const c = this.ctx;
    if (!c || this.volume <= 0 || !(volume > 0)) return null;
    const spatial = typeof route === 'object' && route !== null;
    priority = spatial ? route.priority : priority;
    if (this.voices.size >= this.maxVoices) {
      let victim = null;
      for (const v of this.voices)
        if (!victim || v.priority < victim.priority) victim = v;
      if (!victim || victim.priority > priority) {
        this.stats.culled++;
        return null;
      }
      this._dispose(victim);
      this.stats.stolen++;
    }
    const input = c.createGain();
    input.gain.value = clamp(volume, 0, 1);
    const v = {
      nodes: [input],
      sources: [],
      input,
      priority,
      ended: 0,
      disposed: false,
    };
    let output = input;
    const cutoff = spatial
      ? route.cutoff
      : 18000 * Math.pow(0.055, clamp(muffle, 0, 1));
    if (cutoff < 17999) {
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      output.connect(filter);
      v.nodes.push(filter);
      output = filter;
    }
    if (spatial && this.spatialAudio && c.createPanner) {
      const p = c.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'linear';
      p.rolloffFactor = 0;
      p.refDistance = 1;
      p.maxDistance = 1000000;
      p.coneInnerAngle = p.coneOuterAngle = 360;
      if (p.positionX)
        ['X', 'Y', 'Z'].forEach(
          (axis, i) => (p['position' + axis].value = route.position[i]),
        );
      else p.setPosition(...route.position);
      output.connect(p);
      v.nodes.push(p);
      output = p;
    } else if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = clamp(spatial ? route.pan : route, -1, 1);
      output.connect(p);
      v.nodes.push(p);
      output = p;
    }
    output.connect(this.master);
    this.voices.add(v);
    this.stats.played++;
    this.stats.peak = Math.max(this.stats.peak, this.voices.size);
    return v;
  }
  async installPack(bytes, accept = () => true) {
    if (!this.ctx)
      throw Error(
        'Unlock audio from a user gesture before installing an optional audio pack.',
      );
    const pack = await decodeAudioPack(bytes, this.ctx);
    if (accept()) this.samplePack = pack;
    return { clips: pack.clipCount, bytes: pack.byteLength };
  }
  removePack() {
    this.samplePack = null;
  }
  _sample(key, volume, route = 0, muffle = 0, priority = 1) {
    const buffer = this.samplePack?.pick(key);
    if (!buffer) return false;
    const v = this._voice(volume, route, muffle, priority);
    if (!v) return true;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(v.input);
    v.nodes.push(src);
    v.sources.push(src);
    src.onended = () => this._ended(v);
    src.start();
    return true;
  }
  _ended(v) {
    v.ended++;
    if (v.ended === v.sources.length) this._dispose(v);
  }
  _noise(
    v,
    t,
    duration,
    {
      hz = 1200,
      to = hz,
      q = 0.9,
      type = 'bandpass',
      peak = 0.5,
      attack = 0.006,
    } = {},
  ) {
    const c = this.ctx,
      src = c.createBufferSource(),
      f = c.createBiquadFilter(),
      g = c.createGain();
    src.buffer = this.noise;
    f.type = type;
    f.frequency.setValueAtTime(hz, t);
    f.Q.value = q;
    if (to !== hz)
      f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    g.gain.setValueAtTime(0.00001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.00002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.00001, t + duration);
    src.connect(f).connect(g).connect(v.input);
    v.nodes.push(src, f, g);
    v.sources.push(src);
    src.onended = () => this._ended(v);
    src.start(t, Math.random() * Math.max(0, 1 - duration), duration);
  }
  _osc(v, t, duration, { hz = 150, to = 45, peak = 0.5, type = 'sine' } = {}) {
    const c = this.ctx,
      o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    o.frequency.exponentialRampToValueAtTime(to, t + duration);
    g.gain.setValueAtTime(Math.max(0.00002, peak), t);
    g.gain.exponentialRampToValueAtTime(0.00001, t + duration);
    o.connect(g).connect(v.input);
    v.nodes.push(o, g);
    v.sources.push(o);
    o.onended = () => this._ended(v);
    o.start(t);
    o.stop(t + duration);
  }
  shot(tone = 0.5, vol = 1, pan = 0, muffle = 0) {
    if (
      this._sample('shot:' + clamp(tone, 0, 1).toFixed(3), vol, pan, muffle, 3)
    )
      return;
    const v = this._voice(vol, pan, muffle, 3);
    if (!v) return;
    const t = this.ctx.currentTime;
    tone = clamp(tone, 0, 1);
    this._noise(v, t, 0.2, {
      type: 'lowpass',
      hz: 5200 - tone * 2400,
      to: 400,
      peak: 0.9,
      attack: 0.002,
    });
    this._osc(v, t, 0.15, { hz: 150 - tone * 60, to: 45, peak: 0.7 });
  }
  step(
    vol = 0.5,
    pan = 0,
    muffle = 0,
    profile = { hz: 650, q: 0.9, duration: 0.1, ring: 0 },
  ) {
    if (
      this.samplePack?.supportsStep(profile) &&
      this._sample('step:' + profile.material, vol, pan, muffle, 1)
    )
      return;
    const v = this._voice(vol, pan, muffle, 1);
    if (!v) return;
    const t = this.ctx.currentTime;
    this._noise(v, t, profile.duration, {
      hz: profile.hz,
      q: profile.q,
      peak: 0.55,
      attack: 0.01,
    });
    if (profile.ring > 0)
      this._osc(v, t, profile.duration, {
        hz: profile.ring,
        to: Math.max(35, profile.ring * 0.8),
        peak: 0.14,
      });
  }
  knife(vol = 1, pan = 0, muffle = 0) {
    if (this._sample('knife', vol, pan, muffle, 2)) return;
    const v = this._voice(vol, pan, muffle, 2);
    if (v)
      this._noise(v, this.ctx.currentTime, 0.16, {
        hz: 1500,
        to: 5000,
        q: 2,
        peak: 0.35,
        attack: 0.05,
      });
  }
  zap(vol = 1, pan = 0, muffle = 0) {
    if (this._sample('zap', vol, pan, muffle, 2)) return;
    const v = this._voice(vol, pan, muffle, 2);
    if (!v) return;
    const t = this.ctx.currentTime;
    this._osc(v, t, 0.32, { hz: 220, to: 90, type: 'square', peak: 0.25 });
    this._noise(v, t, 0.26, { type: 'highpass', hz: 3000, peak: 0.4 });
  }
  // Barbed wire: preserve M4's six metallic ticks within the bounded voice graph.
  wire(vol = 0.5, pan = 0, muffle = 0) {
    if (this._sample('wire', vol, pan, muffle, 2)) return;
    const v = this._voice(vol, pan, muffle, 2);
    if (!v) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++)
      this._noise(v, t + i * 0.025 + Math.random() * 0.02, 0.07, {
        hz: 3200 + Math.random() * 2600,
        q: 12,
        peak: 0.35,
        attack: 0.002,
      });
  }
  crack(vol = 1, pan = 0, muffle = 0) {
    if (this._sample('crack', vol, pan, muffle, 2)) return;
    const v = this._voice(vol, pan, muffle, 2);
    if (!v) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++)
      this._noise(v, t + i * 0.035, 0.13, {
        hz: 700 + Math.random() * 1600,
        q: 3,
        peak: 0.5,
        attack: 0.004,
      });
  }
  jam(vol = 0.5) {
    if (this._sample('jam', vol, 0, 0, 1)) return;
    const v = this._voice(vol);
    if (!v) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++)
      this._noise(v, t + i * 0.06, 0.09, {
        hz: 1500 + Math.random() * 2500,
        peak: 0.3,
      });
  }
  radio() {
    if (this._sample('radio', 1, 0, 0, 1)) return;
    const v = this._voice(1);
    if (v)
      this._noise(v, this.ctx.currentTime, 0.13, {
        hz: 2200,
        q: 1.4,
        peak: 0.25,
        attack: 0.01,
      });
  }
  click() {
    if (this._sample('click', 1, 0, 0, 1)) return;
    const v = this._voice(1);
    if (v)
      this._osc(v, this.ctx.currentTime, 0.04, {
        hz: 1800,
        to: 900,
        type: 'square',
        peak: 0.15,
      });
  }
  reload(vol = 1, pan = 0, muffle = 0) {
    if (this._sample('reload', vol, pan, muffle, 2)) return;
    const v = this._voice(vol, pan, muffle, 2);
    if (!v) return;
    const t = this.ctx.currentTime;
    for (const [dt, hz] of [
      [0, 900],
      [0.09, 600],
    ])
      this._osc(v, t + dt, 0.07, {
        hz,
        to: hz * 0.8,
        type: 'triangle',
        peak: 0.25,
      });
  }
  weaponSwitch() {
    if (this._sample('switch', 0.6, 0, 0, 2)) return;
    const v = this._voice(0.6, 0, 0, 2);
    if (v)
      this._noise(v, this.ctx.currentTime, 0.09, {
        type: 'highpass',
        hz: 1700,
        peak: 0.22,
        attack: 0.012,
      });
  }
  vault(vol = 0.5, pan = 0, muffle = 0) {
    if (this._sample('vault', vol, pan, muffle, 2)) return;
    const v = this._voice(vol, pan, muffle, 2);
    if (!v) return;
    this._noise(v, this.ctx.currentTime, 0.18, {
      hz: 360,
      peak: 0.3,
      attack: 0.02,
    });
  }
}
