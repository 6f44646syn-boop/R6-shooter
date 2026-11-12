// Reticle textures for the lens pass, drawn from optics.json reticle shapes.
//   texture: lit (emissive) shapes on black, added on top of the view, with a soft glow
//   etch:    etched marks ("c": "dark") in alpha, which darken the view
// Drawn at devicePixelRatio and at least 1024 px square. Shapes are in 1080p pixels; the
// texture covers +/- `half` 1080p pixels around the centre, so on screen it is drawn
// 2 * half * (screen height / 1080) pixels wide when fully aimed.
// Iron sights skip their "dark" shapes: the front post is real geometry.
import * as THREE from '../../vendor/three/three.module.min.js?v=7d32aaa-mwd4tpe8';

const cache = new Map();

function extent(optic) {
  let e = 8;
  for (const s of optic.reticle.shapes) {
    if (s.t === 'dot' || s.t === 'ring') e = Math.max(e, s.r + (s.w || 2));
    else if (s.t === 'line') e = Math.max(e, Math.abs(s.x1), Math.abs(s.y1), Math.abs(s.x2), Math.abs(s.y2));
    else if (s.t === 'poly') for (const [x, y] of s.pts) e = Math.max(e, Math.abs(x), Math.abs(y));
  }
  return e + 14; // room for the glow
}

function lighten(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v + (255 - v) * k);
  return 'rgb(' + c(n >> 16) + ',' + c((n >> 8) & 255) + ',' + c(n & 255) + ')';
}

function drawShapes(g, optic, scale, c, color, wantDark) {
  for (const s of optic.reticle.shapes) {
    const dark = s.c === 'dark';
    if (dark !== wantDark) continue;
    g.lineWidth = Math.max(1, (s.w || 2) * scale);
    g.lineCap = 'butt';
    g.beginPath();
    if (s.t === 'dot') {
      g.arc(c, c, Math.max(0.8, s.r * scale), 0, Math.PI * 2);
      g.fillStyle = wantDark ? '#fff' : lighten(color, 0.35);
      g.fill();
    } else if (s.t === 'ring') {
      g.arc(c, c, s.r * scale, 0, Math.PI * 2);
      g.strokeStyle = wantDark ? '#fff' : color;
      g.stroke();
    } else if (s.t === 'line') {
      g.moveTo(c + s.x1 * scale, c + s.y1 * scale);
      g.lineTo(c + s.x2 * scale, c + s.y2 * scale);
      g.strokeStyle = wantDark ? '#fff' : color;
      g.stroke();
    } else if (s.t === 'poly') {
      s.pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, c + x * scale, c + y * scale));
      g.closePath();
      g.fillStyle = g.strokeStyle = wantDark ? '#fff' : color;
      if (s.fill) g.fill(); else g.stroke();
    }
  }
}

// Returns { texture, etch, half } (half: 1080p pixels from centre to edge).
export function reticleTextures(optic, color, screenH) {
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const half = extent(optic);
  // Texture pixels per 1080p pixel: at least the screen's own density, and >= 1024 px total.
  const need = 2 * half * (screenH / 1080) * dpr;
  const size = Math.min(4096, Math.max(1024, 1 << Math.ceil(Math.log2(need))));
  const key = optic.id + color + size;
  if (cache.has(key)) return cache.get(key);
  const scale = size / (2 * half), c = size / 2;

  const lit = document.createElement('canvas');
  lit.width = lit.height = size;
  const g = lit.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const glow = optic.reticle.glow;
  // Glow pass (blurred), then the crisp shape on top.
  if (glow > 0) {
    g.shadowColor = color;
    g.shadowBlur = (4 + 4 * glow) * scale;
    drawShapes(g, optic, scale, c, color, false);
    g.shadowBlur = 0;
  }
  drawShapes(g, optic, scale, c, color, false);

  const et = document.createElement('canvas');
  et.width = et.height = size;
  if (optic.group !== 'iron') drawShapes(et.getContext('2d'), optic, scale, c, color, true);

  const texture = new THREE.CanvasTexture(lit);
  texture.colorSpace = THREE.SRGBColorSpace;
  const etch = new THREE.CanvasTexture(et);
  for (const t of [texture, etch]) { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; }
  const out = { texture, etch, half, size };
  cache.set(key, out);
  return out;
}
