// 2D sight drawings for the small loadout previews (the in-game sights are 3D models,
// js/scene/sight-model.js, with the lens pass in js/render/lens-post.js).
//
// Units: housing numbers are fractions of the canvas HEIGHT; reticle shapes are pixels at
// 1080p (scaled by height / 1080), origin at the centre, y down.
//
// Realism, all 2D and cheap:
// - Glass: lens-coating tint, darker edges, and for magnified sights an eye-box "scope shadow"
//   that slides when the scope moves relative to your eye.
// - Housing: machined metal shading with a lit upper-left edge, rubber eyecup, turrets and a
//   screwed mount on magnified sights, darkened surroundings outside the tube.
// - Lens glare and a faint colour fringe at the edge of magnified glass.
// - In game the housing sways (mouse lag, recoil kick, breathing) and rises into view when
//   you aim. Only CSS transforms change per frame; the canvases are redrawn only when the
//   sight, colour or window size changes.

export const RETICLE_COLORS = {
  red: '#ff3b30', green: '#4dff5e', cyan: '#3fe6ff', magenta: '#ff3df2', white: '#f4f4f4', yellow: '#ffd93a',
};
const ETCH = '#0d0f12';          // etched (black) reticle lines and iron sight posts

// Lighter version of a #rrggbb colour, for the brighter centre dot.
function lighten(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v + (255 - v) * k);
  return 'rgb(' + c(n >> 16) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
}

function shapePath(g, shape, cx, cy, w, h, r) {
  if (shape === 'round') g.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  else g.roundRect(cx - w / 2, cy - h / 2, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

const isMagnified = (o) => o.zoom > 1;

// Geometry of a sight on a canvas of height H centred at (cx, cy).
function geom(optic, H) {
  const hs = optic.housing;
  const w = hs.w * H, h = hs.h * H, b = hs.bezel * H, r = (hs.radius || 0) * H;
  const eyecup = isMagnified(optic) ? Math.max(0.018 * H, b * 0.35) : 0;
  return { hs, w, h, b, r, ow: w + 2 * b, oh: h + 2 * b, eyecup, px: H / 1080 };
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

/* ---------------------------------------------------------------- glass */

// Glass tint, coating colour and eye-box vignette. (ox, oy) shifts the vignette centre
// relative to the window: a misaligned eye sees a dark crescent on one side.
// clip: true limits drawing to the window (gallery); the in-game shadow layer is unclipped
// and fades out beyond the bezel so it can slide under the housing.
export function drawGlass(g, cx, cy, optic, H, ox = 0, oy = 0, clip = true) {
  const { hs, w, h, r } = geom(optic, H);
  const mag = isMagnified(optic);
  g.save();
  if (clip) { g.beginPath(); shapePath(g, hs.shape, cx, cy, w, h, r); g.clip(); }

  // Lens coating: magnified glass reads faintly green-blue, open sights faintly blue (rect
  // windows) or amber (round tubes); plus the sight's own tint from the data.
  const R = Math.max(w, h) / 2;
  const coat = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
  const edge = mag ? 'rgba(40,90,90,0.16)' : (hs.shape === 'rect' ? 'rgba(60,120,190,0.10)' : 'rgba(200,140,60,0.10)');
  coat.addColorStop(0, 'rgba(8,16,18,' + (hs.tint || 0) + ')');
  coat.addColorStop(1, edge);
  g.fillStyle = coat;
  if (clip) g.fillRect(cx - w / 2, cy - h / 2, w, h);
  else { g.beginPath(); shapePath(g, hs.shape, cx, cy, w, h, r); g.fill(); }

  if (!mag) {
    // Open sights have no eye box: just a soft inner shadow that follows the window shape.
    g.save();
    g.beginPath(); shapePath(g, hs.shape, cx, cy, w, h, r); g.clip();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 0.03 * H;
    g.lineWidth = 0.03 * H;
    g.strokeStyle = '#000';
    g.beginPath(); shapePath(g, hs.shape, cx, cy, w + g.lineWidth, h + g.lineWidth, r + g.lineWidth / 2); g.stroke();
    g.restore();
    g.restore();
    return;
  }

  // Eye-box vignette (magnified). Scaled so it follows an elliptical window.
  const rx = w / 2, ry = h / 2, k = ry / rx;
  g.save();
  g.translate(cx + ox, cy + oy);
  g.scale(1, k);
  const vg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.76, 'rgba(0,0,0,0)');
  vg.addColorStop(0.93, 'rgba(0,0,0,0.5)');
  vg.addColorStop(1.0, 'rgba(0,0,0,0.96)');
  g.fillStyle = vg;
  if (clip) {
    g.fillRect(-rx * 1.6, -rx * 1.6, rx * 3.2, rx * 3.2);
  } else {
    g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
    {
      // Opaque band past the glass edge (hidden under the bezel at rest) that fades out
      // further away, so the layer can slide without showing an edge.
      const band = g.createRadialGradient(0, 0, rx, 0, 0, rx * 1.45);
      band.addColorStop(0, 'rgba(0,0,0,0.96)');
      band.addColorStop(0.55, 'rgba(0,0,0,0.96)');
      band.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = band;
      g.beginPath(); g.arc(0, 0, rx * 1.45, 0, Math.PI * 2); g.arc(0, 0, rx, 0, Math.PI * 2, true); g.fill();
    }
  }
  g.restore();
  g.restore();
}

/* ---------------------------------------------------------------- reticle */

// Reticle, clipped to the glass, with a soft glow (shadowBlur) on lit elements only.
// Shapes with "c": "dark" are etched black lines (iron sight posts, magnified range marks).
export function drawReticle(g, cx, cy, optic, H, color) {
  const { hs, w, h, r, px } = geom(optic, H);
  g.save();
  g.beginPath();
  shapePath(g, hs.shape, cx, cy, w, h, r);
  g.clip();
  const glow = optic.reticle.glow;
  for (const s of optic.reticle.shapes) {
    const dark = s.c === 'dark';
    const col = dark ? ETCH : color;
    g.shadowBlur = !dark && glow > 0 ? (4 + 4 * glow) * Math.max(px, 0.5) : 0;
    g.shadowColor = color;
    g.lineWidth = Math.max(1, (s.w || 2) * px);
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    g.beginPath();
    if (s.t === 'dot') {
      g.arc(cx, cy, Math.max(0.8, s.r * px), 0, Math.PI * 2);
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
}

/* ---------------------------------------------------------------- housing */

function screw(g, x, y, rad) {
  const sg = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
  sg.addColorStop(0, '#4a4f57');
  sg.addColorStop(1, '#16181c');
  g.fillStyle = sg;
  g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#08090a';
  g.lineWidth = Math.max(1, rad * 0.3);
  g.beginPath(); g.moveTo(x - rad * 0.6, y + rad * 0.2); g.lineTo(x + rad * 0.6, y - rad * 0.2); g.stroke();
}

// A knurled cylinder seen side-on: a turret cap. Horizontal when vertical === false.
function turret(g, x, y, tw, th, vertical) {
  const grad = vertical ? g.createLinearGradient(x, 0, x + tw, 0) : g.createLinearGradient(0, y, 0, y + th);
  grad.addColorStop(0, '#0b0c0e');
  grad.addColorStop(0.35, '#3a3f47');
  grad.addColorStop(0.55, '#24272c');
  grad.addColorStop(1, '#08090a');
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(x, y, tw, th, Math.min(tw, th) * 0.18); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 1;
  const n = 14;
  g.beginPath();
  for (let i = 1; i < n; i++) {
    if (vertical) { const xx = x + (tw * i) / n; g.moveTo(xx, y + th * 0.25); g.lineTo(xx, y + th); }
    else { const yy = y + (th * i) / n; g.moveTo(x, yy); g.lineTo(x + tw * 0.75, yy); }
  }
  g.stroke();
}

// Housing on top of glass and reticle. W is the full canvas width (for the darkened
// surroundings of magnified sights).
export function drawHousing(g, cx, cy, optic, W, H) {
  const { hs, w, h, b, r, ow, oh, eyecup, px } = geom(optic, H);
  const mag = isMagnified(optic);
  const iron = optic.group === 'iron';
  g.save();
  g.shadowBlur = 0;

  // 1. Surroundings: magnified sights block most of the view outside the tube.
  if (mag) {
    g.beginPath();
    g.rect(0, 0, W, H);
    shapePath(g, hs.shape, cx, cy, ow + 2 * eyecup, oh + 2 * eyecup, r + b + eyecup);
    g.fillStyle = 'rgba(4,5,6,0.6)';
    g.fill('evenodd');
    // Soft falloff hugging the tube, like the out-of-focus scope body.
    const R = Math.max(ow, oh) / 2 + eyecup;
    const fall = g.createRadialGradient(cx, cy, R, cx, cy, R * 1.7);
    fall.addColorStop(0, 'rgba(4,5,6,0.55)');
    fall.addColorStop(1, 'rgba(4,5,6,0)');
    g.beginPath();
    g.arc(cx, cy, R * 1.7, 0, Math.PI * 2);
    shapePath(g, hs.shape, cx, cy, ow + 2 * eyecup, oh + 2 * eyecup, r + b + eyecup);
    g.fillStyle = fall;
    g.fill('evenodd');
  }

  // 2. Mount / base under the window, with rail grooves and screws.
  if (hs.base > 0) {
    const bw = ow * 0.78, top = cy + oh / 2 - b * 0.5, bh = hs.base * H + b * 0.5;
    const bg = g.createLinearGradient(0, top, 0, top + Math.min(bh, 0.12 * H));
    bg.addColorStop(0, '#2a2e34');
    bg.addColorStop(1, '#0d0e10');
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(cx - bw / 2 + bw * 0.06, top);
    g.lineTo(cx + bw / 2 - bw * 0.06, top);
    g.lineTo(cx + bw / 2, top + Math.min(bh, 0.05 * H));
    g.lineTo(cx + bw / 2, top + bh);
    g.lineTo(cx - bw / 2, top + bh);
    g.lineTo(cx - bw / 2, top + Math.min(bh, 0.05 * H));
    g.closePath();
    g.fill();
    if (!iron) {
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = Math.max(1, 1.5 * px);
      g.beginPath();
      for (let i = 1; i <= 3; i++) {
        const yy = top + Math.min(bh, 0.05 * H) + i * 0.012 * H;
        if (yy < top + bh) { g.moveTo(cx - bw / 2, yy); g.lineTo(cx + bw / 2, yy); }
      }
      g.stroke();
      const sr = Math.max(2, 0.008 * H);
      screw(g, cx - bw * 0.32, top + Math.min(bh, 0.05 * H) * 0.55, sr);
      screw(g, cx + bw * 0.32, top + Math.min(bh, 0.05 * H) * 0.55, sr);
    }
  }

  // 3. Hood over the window.
  if (hs.hood > 0) {
    const hw = ow * 0.9, bottom = cy - oh / 2 + b * 0.5;
    const hg = g.createLinearGradient(0, bottom - hs.hood * H, 0, bottom);
    hg.addColorStop(0, '#30343b');
    hg.addColorStop(1, '#0e1012');
    g.fillStyle = hg;
    g.beginPath(); g.roundRect(cx - hw / 2, bottom - hs.hood * H, hw, hs.hood * H, [hs.hood * H * 0.4, hs.hood * H * 0.4, 0, 0]); g.fill();
  }

  // 4. Turrets on magnified sights (elevation on top, windage on the right).
  if (mag) {
    const R = Math.max(ow, oh) / 2 + eyecup;
    const tw = 0.11 * H, th = 0.05 * H;
    turret(g, cx - tw / 2, cy - oh / 2 - eyecup - th * 0.9, tw, th, true);
    turret(g, cx + ow / 2 + eyecup - th * 0.1, cy - tw / 2, th, tw, false);
    void R;
  }

  // 5. Eyecup: matte rubber ring with ridges (magnified only).
  if (eyecup > 0) {
    g.beginPath();
    shapePath(g, hs.shape, cx, cy, ow + 2 * eyecup, oh + 2 * eyecup, r + b + eyecup);
    shapePath(g, hs.shape, cx, cy, ow, oh, r + b);
    g.fillStyle = '#0a0b0c';
    g.fill('evenodd');
    if (hs.shape === 'round') {
      g.strokeStyle = 'rgba(40,44,50,0.55)';
      g.lineWidth = Math.max(1, px * 1.5);
      g.beginPath();
      const n = 56;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        g.moveTo(cx + c * (ow / 2 + eyecup * 0.25), cy + s * (oh / 2 + eyecup * 0.25));
        g.lineTo(cx + c * (ow / 2 + eyecup * 0.8), cy + s * (oh / 2 + eyecup * 0.8));
      }
      g.stroke();
    }
  }

  // 6. Bezel: machined metal. Shaded so it reads as a tube wall seen from behind.
  if (b > 0) {
    g.save();
    g.beginPath();
    shapePath(g, hs.shape, cx, cy, ow, oh, r + b);
    shapePath(g, hs.shape, cx, cy, w, h, r);
    g.clip('evenodd');
    if (hs.shape === 'round') {
      g.translate(cx, cy);
      g.scale(1, oh / ow);
      const ri = w / 2, ro = ow / 2;
      const rg = g.createRadialGradient(0, 0, ri, 0, 0, ro);
      rg.addColorStop(0, '#050607');
      rg.addColorStop(0.08, '#3d434b');   // machined inner lip catching light
      rg.addColorStop(0.2, '#121417');
      rg.addColorStop(0.75, '#1d2026');
      rg.addColorStop(1, '#0b0c0e');
      g.fillStyle = rg;
      g.fillRect(-ro, -ro * 2, ro * 2, ro * 4);
      // Light from the upper left on the outer surface.
      const lg = g.createLinearGradient(-ro, -ro, ro, ro);
      lg.addColorStop(0, 'rgba(255,255,255,0.10)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0)');
      lg.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = lg;
      g.fillRect(-ro, -ro * 2, ro * 2, ro * 4);
    } else {
      const lg = g.createLinearGradient(cx - ow / 2, cy - oh / 2, cx + ow / 2, cy + oh / 2);
      lg.addColorStop(0, '#3a3f47');
      lg.addColorStop(0.35, '#1b1e23');
      lg.addColorStop(1, '#08090b');
      g.fillStyle = lg;
      g.fillRect(cx - ow / 2, cy - oh / 2, ow, oh);
    }
    g.restore();
    // Inner lip highlight and outer edge line.
    g.lineWidth = Math.max(1, 1.5 * px);
    g.strokeStyle = 'rgba(120,130,140,0.35)';
    g.beginPath(); shapePath(g, hs.shape, cx, cy, w + g.lineWidth, h + g.lineWidth, r); g.stroke();
    g.strokeStyle = '#050506';
    g.beginPath(); shapePath(g, hs.shape, cx, cy, ow, oh, r + b); g.stroke();
  }

  // 7. On the glass: glare streak and, on magnified sights, a faint colour fringe at the edge.
  if (!iron) {
    g.save();
    g.beginPath(); shapePath(g, hs.shape, cx, cy, w, h, r); g.clip();
    const gl = g.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
    const a = mag ? 0.07 : 0.05;
    gl.addColorStop(0.18, 'rgba(255,255,255,0)');
    gl.addColorStop(0.27, 'rgba(255,255,255,' + a + ')');
    gl.addColorStop(0.36, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    const sp = g.createRadialGradient(cx - w * 0.28, cy - h * 0.3, 0, cx - w * 0.28, cy - h * 0.3, h * 0.12);
    sp.addColorStop(0, 'rgba(255,255,255,' + a * 1.4 + ')');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sp;
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    if (mag) {
      g.lineWidth = Math.max(1, 2 * px);
      g.strokeStyle = 'rgba(255,70,40,0.22)';
      g.beginPath(); shapePath(g, hs.shape, cx + px, cy, w - 4 * px, h - 4 * px, r); g.stroke();
      g.strokeStyle = 'rgba(40,200,255,0.22)';
      g.beginPath(); shapePath(g, hs.shape, cx - px, cy, w - 6 * px, h - 6 * px, r); g.stroke();
    }
    g.restore();
  }
  g.restore();
}

// Everything at rest on one canvas: for previews and the F4 gallery.
export function drawScope(g, W, H, optic, color) {
  const cx = W / 2, cy = H / 2;
  drawGlass(g, cx, cy, optic, H, 0, 0, true);
  drawReticle(g, cx, cy, optic, H, color);
  drawHousing(g, cx, cy, optic, W, H);
}
