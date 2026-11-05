// F3 debug overlay. Text is rebuilt at most 10 times a second to keep the DOM cheap.

export class DebugHud {
  constructor(el) {
    this.el = el;
    this.visible = false;
    this.lastUpdate = 0;
    this.frameTimes = new Float32Array(120);
    this.frameIdx = 0;
    this.frameCount = 0;
  }

  setVisible(v) {
    this.visible = v;
    this.el.hidden = !v;
  }

  recordFrame(dtMs) {
    this.frameTimes[this.frameIdx] = dtMs;
    this.frameIdx = (this.frameIdx + 1) % this.frameTimes.length;
    if (this.frameCount < this.frameTimes.length) this.frameCount++;
  }

  // info: plain object filled by main.js each frame (reused, not reallocated).
  update(nowMs, info) {
    if (!this.visible || nowMs - this.lastUpdate < 100) return;
    this.lastUpdate = nowMs;
    let sum = 0, worst = 0;
    for (let i = 0; i < this.frameCount; i++) {
      const v = this.frameTimes[i];
      sum += v;
      if (v > worst) worst = v;
    }
    const avg = this.frameCount ? sum / this.frameCount : 0;
    const L = info.look;
    const lines = [
      'DEBUG (F3 hides, Z zeroes counters)',
      'yaw unwrapped  ' + L.unwrappedYaw.toFixed(6) + ' deg  (' + (L.unwrappedYaw / 360).toFixed(6) + ' turns)',
      'yaw / pitch    ' + L.yaw.toFixed(4) + ' / ' + L.pitch.toFixed(4) + ' deg',
      'counts x / y   ' + L.countsX + ' / ' + L.countsY,
      'events         ' + L.events + '   discarded >2000: ' + L.discarded,
      'deg/count now  ' + info.dpc.toPrecision(10) + (info.ads ? '  (ADS)' : '  (hip)'),
      'counts / 360   ' + (360 / info.dpc).toFixed(3),
      'raw input      ' + (info.raw ? 'yes' : 'no'),
      'fov h / v      ' + info.fovH.toFixed(3) + ' / ' + info.fovV.toFixed(3) + ' deg',
      'recoil offset  ' + info.recoilYaw.toFixed(3) + ', ' + info.recoilPitch.toFixed(3) + ' deg  shot ' + info.shotIndex,
      'sight          ' + info.optic + '  zoom ' + info.zoom.toFixed(2) + '  sens key ' + info.sensKey,
      'ADS FOV        ' + info.adsFov.toFixed(3) + ' deg v   ADS ' + info.adsCm360.toFixed(2) + ' cm/360',
      'seed           ' + info.seed,
      'frame          ' + avg.toFixed(2) + ' ms avg, ' + worst.toFixed(1) + ' ms worst, ' + (avg ? (1000 / avg).toFixed(0) : '-') + ' fps',
      'render         ' + info.renderW + 'x' + info.renderH + '  calls ' + info.calls + '  tris ' + info.tris,
    ];
    this.el.textContent = lines.join('\n');
  }
}
