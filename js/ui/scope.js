// Draws a sight (glass tint, reticle, housing) on a 2D canvas from its optics.json spec.
// One function serves the ADS overlay, the loadout previews and the F4 gallery, so what you
// see in the gallery is exactly what you get in game. Everything is canvas primitives.
//
// Units: housing numbers are fractions of the canvas HEIGHT; reticle shapes are pixels at
// 1080p (scaled by height / 1080), origin at the canvas centre, y down.

export const RETICLE_COLORS = {
  red: '#ff3b30', green: '#4dff5e', cyan: '#3fe6ff', white: '#f4f4f4', yellow: '#ffd93a',
};
const HOUSING = '#121418';
const HOUSING_EDGE = '#2c3138';

// Lighter version of a #rrggbb colour, for the brighter centre dot.
function lighten(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v + (255 - v) * k);
  return 'rgb(' + c(n >> 16) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
}

function windowPath(g, shape, cx, cy, w, h, r) {
  if (shape === 'round') g.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  else g.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(r, w / 2, h / 2));
}

// Plain backdrop for previews and the gallery (no world behind the sight).
export function drawBackdrop(g, W, H) {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#7d8794');
  grad.addColorStop(0.55, '#5f6773');
  grad.addColorStop(1, '#3d434b');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

// Draw `optic` centred on a W x H canvas. color: reticle colour (#rrggbb).
// Draw order: glass tint, reticle (clipped to the glass), housing on top.
export function drawScope(g, W, H, optic, color) {
  const cx = W / 2, cy = H / 2;
  const hs = optic.housing;
  const w = hs.w * H, h = hs.h * H, b = hs.bezel * H, r = (hs.radius || 0) * H;
  const px = H / 1080;

  // 1. Glass tint
  if (hs.tint > 0) {
    g.beginPath();
    windowPath(g, hs.shape, cx, cy, w, h, r);
    g.fillStyle = 'rgba(8,16,18,' + hs.tint + ')';
    g.fill();
  }

  // 2. Reticle, clipped to the glass, with a soft glow from shadowBlur (reticle only).
  g.save();
  g.beginPath();
  windowPath(g, hs.shape, cx, cy, w, h, r);
  g.clip();
  const glow = optic.reticle.glow;
  for (const s of optic.reticle.shapes) {
    const dark = s.c === 'dark';
    const col = dark ? HOUSING : color;
    g.shadowBlur = !dark && glow > 0 ? (4 + 4 * glow) * Math.max(px, 0.5) : 0;
    g.shadowColor = color;
    g.lineWidth = Math.max(1, (s.w || 2) * px);
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    g.beginPath();
    if (s.t === 'dot') {
      g.arc(cx, cy + 0, Math.max(0.8, s.r * px), 0, Math.PI * 2);
      g.fillStyle = dark ? col : lighten(color, 0.35); // slightly brighter centre dot
      g.fill();
    } else if (s.t === 'ring') {
      g.arc(cx, cy, s.r * px, 0, Math.PI * 2);
      g.strokeStyle = col;
      g.stroke();
    } else if (s.t === 'line') {
      g.moveTo(cx + s.x1 * px, cy + s.y1 * px);
      g.lineTo(cx + s.x2 * px, cy + s.y2 * px);
      g.strokeStyle = col;
      g.stroke();
    } else if (s.t === 'poly') {
      s.pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, cx + x * px, cy + y * px));
      g.closePath();
      if (s.fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.stroke(); }
    }
  }
  g.restore();

  // 3. Housing: bezel ring, then base bar under and hood bar over the window.
  g.shadowBlur = 0;
  g.fillStyle = HOUSING;
  const ow = w + 2 * b, oh = h + 2 * b;
  if (b > 0) {
    g.beginPath();
    windowPath(g, hs.shape, cx, cy, ow, oh, r + b);
    windowPath(g, hs.shape, cx, cy, w, h, r);
    g.fill('evenodd');
    g.strokeStyle = HOUSING_EDGE;
    g.lineWidth = Math.max(1, 1.5 * px);
    g.beginPath();
    windowPath(g, hs.shape, cx, cy, w + g.lineWidth, h + g.lineWidth, r);
    g.stroke();
  }
  if (hs.base > 0) {
    const bw = ow * 0.78, top = cy + oh / 2 - b * 0.5;
    g.fillRect(cx - bw / 2, top, bw, hs.base * H + b * 0.5);
  }
  if (hs.hood > 0) {
    const hw = ow * 0.9, bottom = cy - oh / 2 + b * 0.5;
    g.fillRect(cx - hw / 2, bottom - hs.hood * H, hw, hs.hood * H);
  }
}

// ADS overlay canvas: redrawn only when the sight, colour, size or fade changes.
export class ScopeOverlay {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.key = '';
  }

  // alpha 0 hides the overlay; 0..1 fades it in at the end of the ADS blend.
  draw(optic, color, alpha) {
    const W = window.innerWidth, H = window.innerHeight;
    const a = Math.round(alpha * 20) / 20;
    const key = a === 0 ? 'off' : optic.id + color + W + 'x' + H + a;
    if (key === this.key) return;
    this.key = key;
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    this.g.clearRect(0, 0, W, H);
    this.cv.hidden = a === 0;
    if (a === 0) return;
    this.g.globalAlpha = a;
    drawScope(this.g, W, H, optic, color);
    this.g.globalAlpha = 1;
  }
}
