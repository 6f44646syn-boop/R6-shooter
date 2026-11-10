// Two shared browser audio nodes; targets come from the Rust status-effect policy.
// This never raises sound above the user's master volume.
export class Hearing {
  constructor(context, input, output) {
    this.ctx = context;
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.gain = context.createGain();
    this.filter.frequency.value = 22000;
    this.gain.gain.value = 1;
    input.connect(this.filter).connect(this.gain).connect(output);
    this.current = { gain: 1, cutoff: 22000 };
  }
  set(gain = 1, cutoff = 22000, immediate = false) {
    gain = Number.isFinite(gain) ? Math.max(0.55, Math.min(1, gain)) : 1;
    cutoff = Number.isFinite(cutoff)
      ? Math.max(1600, Math.min(22000, cutoff))
      : 22000;
    if (
      !immediate &&
      gain === this.current.gain &&
      cutoff === this.current.cutoff
    )
      return;
    const t = this.ctx.currentTime;
    for (const [param, value] of [
      [this.gain.gain, gain],
      [this.filter.frequency, cutoff],
    ]) {
      param.cancelScheduledValues(t);
      if (immediate) param.setValueAtTime(value, t);
      else param.setTargetAtTime(value, t, 0.025);
    }
    this.current = { gain, cutoff };
  }
  reset() {
    this.set(1, 22000, true);
  }
}
