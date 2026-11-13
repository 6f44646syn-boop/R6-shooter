// FPS counter and frame-time monitor (Graphics > FPS counter): frames per second, average and
// worst frame time, the 1% low, CPU time per frame, GPU time per frame where the browser
// allows measuring it (WebGL timer queries), the render resolution and draw calls, and a
// frame-time graph. Text is rebuilt at most 4 times a second.
export class PerfHud {
  constructor(root, renderer) {
    this.el = document.createElement('div');
    this.el.id = 'perf';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'off');
    this.text = document.createElement('pre');
    this.graph = document.createElement('canvas');
    this.graph.width = 180; this.graph.height = 40;
    this.el.append(this.text, this.graph);
    root.append(this.el);
    this.frames = new Float32Array(240); this.cpu = new Float32Array(240); this.upd = new Float32Array(240); this.n = 0; this.i = 0;
    this.spikes = [];             // hitches (frames over 50 ms): { at, ms, update, render } over the last minute
    this.gpuMs = -1; this.last = 0;
    const gl = renderer.getContext();
    this.gl = gl;
    this.ext = gl.getExtension && (gl.getExtension('EXT_disjoint_timer_query_webgl2') || null);
    this.queries = []; this.active = null;
  }
  get visible() { return !this.el.hidden; }
  setVisible(v) { this.el.hidden = !v; }
  // GPU timing around the frame's drawing (results arrive a few frames later).
  beginGpu() {
    if (!this.visible || !this.ext || this.active) return;
    const gl = this.gl, q = gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }
  endGpu() {
    const gl = this.gl;
    if (this.active) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.queries.push(this.active); this.active = null; }
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (!disjoint) this.gpuMs = this.gpuMs < 0 ? ns / 1e6 : this.gpuMs * 0.9 + ns / 1e6 * 0.1;
      gl.deleteQuery(q); this.queries.shift();
    }
    if (this.queries.length > 8) { for (const q of this.queries) gl.deleteQuery(q); this.queries.length = 0; }
  }
  record(frameMs, cpuMs, updateMs = 0, now = performance.now()) {
    this.frames[this.i] = frameMs; this.cpu[this.i] = cpuMs; this.upd[this.i] = updateMs;
    if (frameMs > 50) this.spikes.push({ at: now, ms: frameMs, update: updateMs, render: cpuMs - updateMs });
    while (this.spikes.length && now - this.spikes[0].at > 60000) this.spikes.shift();
    this.i = (this.i + 1) % this.frames.length;
    if (this.n < this.frames.length) this.n++;
  }
  // info: { w, h, scale, calls, tris, target, hz }
  update(now, info) {
    if (!this.visible || now - this.last < 250 || !this.n) return;
    this.last = now;
    const f = Array.from(this.frames.subarray(0, this.n)).sort((a, b) => a - b);
    let sum = 0, cs = 0;
    for (let k = 0; k < this.n; k++) { sum += this.frames[k]; cs += this.cpu[k]; }
    const avg = sum / this.n, low = f[Math.min(f.length - 1, Math.floor(f.length * 0.99))];
    let w = 0; for (let k = 1; k < this.n; k++) if (this.frames[k] > this.frames[w]) w = k;
    const sp = this.spikes.at(-1);
    this.text.textContent =
      (1000 / avg).toFixed(0) + ' fps   ' + avg.toFixed(1) + ' ms   1% low ' + (1000 / low).toFixed(0) + ' fps\n' +
      'CPU ' + (cs / this.n).toFixed(1) + ' ms   GPU ' + (this.gpuMs >= 0 ? this.gpuMs.toFixed(1) + ' ms' : 'n/a') + '\n' +
      info.w + '×' + info.h + (info.scale !== 1 ? ' (' + Math.round(info.scale * 100) + '%)' : '') + '   ' + info.calls + ' draws   ' + (info.tris / 1000).toFixed(0) + 'k tris\n' +
      'target ' + info.target + ' fps' + (info.hz ? '   screen ' + info.hz + ' Hz' : '') + '\n' +
      'worst ' + this.frames[w].toFixed(0) + ' ms (update ' + this.upd[w].toFixed(0) + ', draw ' + (this.cpu[w] - this.upd[w]).toFixed(0) + ')\n' +
      'hitches >50 ms last min: ' + this.spikes.length + (sp ? '   last ' + sp.ms.toFixed(0) + ' ms (' + (sp.update > sp.render ? 'update' : sp.render > 8 ? 'draw' : 'outside the game: GPU or browser') + ')' : '');
    const g = this.graph.getContext('2d'), W = this.graph.width, H = this.graph.height;
    g.clearRect(0, 0, W, H);
    const budget = 1000 / info.target, top = Math.max(budget * 2.5, 20);
    g.strokeStyle = 'rgba(242,179,61,0.6)'; g.beginPath(); g.moveTo(0, H - budget / top * H); g.lineTo(W, H - budget / top * H); g.stroke();
    g.strokeStyle = '#9fe0ff'; g.beginPath();
    for (let k = 0; k < this.n && k < W; k++) {
      const v = this.frames[(this.i - 1 - k + this.frames.length * 2) % this.frames.length];
      const y = H - Math.min(1, v / top) * H;
      if (k) g.lineTo(W - k, y); else g.moveTo(W - k, y);
    }
    g.stroke();
  }
}
