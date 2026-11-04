// Magazine plot: where each bullet of the last magazine landed relative to the aim point
// (the bullseye centre), drawn to scale in centimetres with the target outline behind it.
import { TARGET } from '../scene/target.js';

export class MagPlot {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
  }

  // xy: Float64Array of [x0, y0, x1, y1, ...] in metres relative to the bullseye centre.
  // n: number of points. shots: bullets fired (some may have missed the wall). hits: on silhouette.
  draw(xy, n, shots, hits, gunName, distance) {
    const g = this.g, W = this.cv.width, H = this.cv.height;
    const plotH = W; // square plot, text underneath
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,12,14,0.9)';
    g.fillRect(0, 0, W, H);

    // Scale: fit every point, at least +/-30 cm, rounded up to 10 cm.
    let ext = 0.3;
    for (let i = 0; i < n; i++) ext = Math.max(ext, Math.abs(xy[i * 2]), Math.abs(xy[i * 2 + 1]));
    ext = Math.ceil(ext * 10 + 0.5) / 10;
    const s = (W / 2 - 8) / ext;           // px per metre
    const cx = W / 2, cy = plotH / 2;
    const X = (x) => cx + x * s, Y = (y) => cy - y * s;

    // Target outline
    g.strokeStyle = 'rgba(120,150,190,0.55)';
    g.lineWidth = 1;
    const t = TARGET.torso, h = TARGET.head;
    g.beginPath();
    g.roundRect(X(t.x0), Y(t.y1), (t.x1 - t.x0) * s, (t.y1 - t.y0) * s, t.r * s);
    g.stroke();
    g.beginPath(); g.arc(X(h.cx), Y(h.cy), h.r * s, 0, Math.PI * 2); g.stroke();
    for (const r of TARGET.rings) { g.beginPath(); g.arc(cx, cy, r * s, 0, Math.PI * 2); g.stroke(); }
    // Aim point cross
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.beginPath(); g.moveTo(cx - 6, cy); g.lineTo(cx + 6, cy); g.moveTo(cx, cy - 6); g.lineTo(cx, cy + 6); g.stroke();

    // Spray order line, then dots fading from bright (first) to dim (last)
    if (n > 1) {
      g.strokeStyle = 'rgba(242,179,61,0.35)';
      g.beginPath();
      g.moveTo(X(xy[0]), Y(xy[1]));
      for (let i = 1; i < n; i++) g.lineTo(X(xy[i * 2]), Y(xy[i * 2 + 1]));
      g.stroke();
    }
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 0;
      g.fillStyle = 'rgb(' + Math.round(255 - 60 * k) + ',' + Math.round(220 - 140 * k) + ',' + Math.round(80 - 40 * k) + ')';
      g.beginPath(); g.arc(X(xy[i * 2]), Y(xy[i * 2 + 1]), i === 0 ? 3.5 : 2.2, 0, Math.PI * 2); g.fill();
    }

    // Stats: mean point of impact and spread around it
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += xy[i * 2]; my += xy[i * 2 + 1]; }
    if (n) { mx /= n; my /= n; }
    let sr = 0;
    for (let i = 0; i < n; i++) { const dx = xy[i * 2] - mx, dy = xy[i * 2 + 1] - my; sr += dx * dx + dy * dy; }
    sr = n ? Math.sqrt(sr / n) : 0;

    g.fillStyle = '#9aa3ae';
    g.font = '11px ui-monospace, Consolas, monospace';
    g.textAlign = 'left';
    g.fillText('scale +/-' + Math.round(ext * 100) + ' cm  @' + distance + ' m', 6, plotH + 14);
    g.fillStyle = '#e7e9ec';
    g.fillText(gunName, 6, plotH + 28);
    g.fillText('hits ' + hits + '/' + shots + '  mean ' + (mx * 100).toFixed(0) + ',' + (my * 100).toFixed(0) +
      ' cm  sd ' + (sr * 100).toFixed(0), 6, plotH + 42 > H - 2 ? H - 4 : plotH + 42);
  }
}
