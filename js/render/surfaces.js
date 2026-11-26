// Realistic building surfaces for High and up: brick, weathered concrete, plaster, planks, roof shingles and
// rock, each a greyscale picture (the map's colour for that material tints it) and a normal map for depth.
// Made once each, 512 px. Low / Standard keep the simple textures (surface(kind, fallback) picks).
import * as THREE from '../../vendor/three/three.module.min.js?v=9ab81ba-mwx0bk9g';
import { mulberry32 } from '../core/prng.js?v=9ab81ba-mwx0bk9g';
import { normalFromHeight } from '../scene/range-tex.js?v=9ab81ba-mwx0bk9g';
import { gfxLevel } from './quality.js?v=9ab81ba-mwx0bk9g';

const S = 512, made = new Map();
const hiNow = () => gfxLevel.q === 'high' || gfxLevel.q === 'ultra';

function pair() {
  const cv = document.createElement('canvas'), hc = document.createElement('canvas');
  cv.width = cv.height = hc.width = hc.height = S;
  return [cv, cv.getContext('2d'), hc, hc.getContext('2d')];
}
const grey = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
function grain(g, h, r, n, size, lo, hi, a) {           // speckles on both the picture and the height
  for (let i = 0; i < n; i++) { const x = r() * S, y = r() * S, s = size * (0.4 + r()), v = lo + r() * (hi - lo); g.fillStyle = grey(v, a); g.fillRect(x, y, s, s); h.fillStyle = grey(v * 0.6 + 60, a); h.fillRect(x, y, s, s); }
}
function streaks(g, r, n, a) {                           // rain and rust runs down the face
  for (let i = 0; i < n; i++) { const x = r() * S, w = 2 + r() * 10, l = 60 + r() * 260, gr = g.createLinearGradient(0, 0, 0, l); gr.addColorStop(0, grey(40, a)); gr.addColorStop(1, grey(40, 0)); g.fillStyle = gr; g.save(); g.translate(x, r() * S * 0.6); g.fillRect(0, 0, w, l); g.restore(); }
}
function cracks(g, h, r, n) {
  g.strokeStyle = grey(35, 0.7); h.strokeStyle = grey(10, 1); g.lineWidth = h.lineWidth = 1.2;
  for (let i = 0; i < n; i++) { let x = r() * S, y = r() * S; g.beginPath(); h.beginPath(); g.moveTo(x, y); h.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 40; y += (r() - 0.3) * 40; g.lineTo(x, y); h.lineTo(x, y); } g.stroke(); h.stroke(); }
}

const MAKERS = {
  // bricks 0.25 x 0.065 m in a 1 m tile (stretcher bond): each brick a little different, mortar set back
  brick() {
    const [cv, g, hc, h] = pair(), r = mulberry32(11), bw = S / 4, bh = S / 15;
    g.fillStyle = grey(200); g.fillRect(0, 0, S, S); h.fillStyle = grey(40); h.fillRect(0, 0, S, S);
    for (let row = 0; row < 15; row++) for (let c = -1; c < 5; c++) {
      const x = c * bw + (row % 2 ? bw / 2 : 0), y = row * bh, v = 150 + r() * 70, hv = 200 + r() * 40;
      g.fillStyle = grey(v); g.fillRect(x + 3, y + 3, bw - 6, bh - 6); h.fillStyle = grey(hv); h.fillRect(x + 3, y + 3, bw - 6, bh - 6);
      if (r() < 0.12) { g.fillStyle = grey(v - 50, 0.6); g.fillRect(x + 3 + r() * bw * 0.6, y + 3, bw * 0.3, bh - 6); }   // a chipped or burnt brick
    }
    grain(g, h, r, 9000, 2, 90, 230, 0.25); streaks(g, r, 26, 0.35); cracks(g, h, r, 6);
    return [cv, hc, 2.4];
  },
  // board-formed concrete: panel joints, tie holes, stains, cracks
  concrete() {
    const [cv, g, hc, h] = pair(), r = mulberry32(13);
    g.fillStyle = grey(196); g.fillRect(0, 0, S, S); h.fillStyle = grey(150); h.fillRect(0, 0, S, S);
    grain(g, h, r, 16000, 2, 140, 240, 0.22);
    for (let i = 0; i < 40; i++) { g.fillStyle = grey(110 + r() * 60, 0.12); g.beginPath(); g.ellipse(r() * S, r() * S, 20 + r() * 80, 10 + r() * 50, r() * 3, 0, 7); g.fill(); }
    g.fillStyle = grey(120); h.fillStyle = grey(70);
    for (const y of [0, S / 2]) { g.fillRect(0, y, S, 3); h.fillRect(0, y, S, 3); }
    for (const x of [0, S / 2]) { g.fillRect(x, 0, 3, S); h.fillRect(x, 0, 3, S); }
    for (const [x, y] of [[S / 4, S / 4], [3 * S / 4, S / 4], [S / 4, 3 * S / 4], [3 * S / 4, 3 * S / 4]]) { g.fillStyle = grey(90); g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); h.fillStyle = grey(20); h.beginPath(); h.arc(x, y, 6, 0, 7); h.fill(); }
    streaks(g, r, 30, 0.4); cracks(g, h, r, 9);
    return [cv, hc, 1.6];
  },
  // plaster over brick: a fine skim, scuffs, patches where it has fallen off
  plaster() {
    const [cv, g, hc, h] = pair(), r = mulberry32(17);
    g.fillStyle = grey(218); g.fillRect(0, 0, S, S); h.fillStyle = grey(160); h.fillRect(0, 0, S, S);
    grain(g, h, r, 12000, 1.6, 180, 250, 0.2);
    for (let i = 0; i < 7; i++) { const x = r() * S, y = r() * S, w = 40 + r() * 90, hh = 20 + r() * 50; g.fillStyle = grey(150); g.fillRect(x, y, w, hh); h.fillStyle = grey(90); h.fillRect(x, y, w, hh); for (let k = 0; k < 6; k++) { g.fillStyle = grey(120); g.fillRect(x + k * 16, y + (k % 2) * 8, 14, 6); } }
    streaks(g, r, 18, 0.25); cracks(g, h, r, 5);
    return [cv, hc, 1.4];
  },
  // planks: boards with grain lines, knots and nail heads
  planks() {
    const [cv, g, hc, h] = pair(), r = mulberry32(19), n = 6, bw = S / n;
    for (let i = 0; i < n; i++) {
      const v = 150 + r() * 60; g.fillStyle = grey(v); g.fillRect(i * bw, 0, bw, S); h.fillStyle = grey(200); h.fillRect(i * bw, 0, bw, S);
      for (let k = 0; k < 26; k++) { const x = i * bw + r() * bw; g.strokeStyle = grey(v - 30 - r() * 30, 0.5); g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 8, S / 3, x + (r() - 0.5) * 8, 2 * S / 3, x, S); g.stroke(); }
      if (r() < 0.6) { const kx = i * bw + bw / 2, ky = r() * S; g.fillStyle = grey(v - 60); g.beginPath(); g.ellipse(kx, ky, 5, 9, 0, 0, 7); g.fill(); }
      g.fillStyle = grey(60); h.fillStyle = grey(30); g.fillRect(i * bw, 0, 3, S); h.fillRect(i * bw, 0, 3, S);
      for (const y of [S * 0.1, S * 0.9]) { g.fillStyle = grey(70); g.fillRect(i * bw + bw / 2 - 3, y, 6, 6); }
    }
    streaks(g, r, 12, 0.25);
    return [cv, hc, 2];
  },
  // roof: overlapping shingle rows, each tile a shade apart, a shadow under each row
  shingles() {
    const [cv, g, hc, h] = pair(), r = mulberry32(23), rows = 12, rh = S / rows;
    for (let row = 0; row < rows; row++) for (let c = -1; c < 9; c++) {
      const w = S / 8, x = c * w + (row % 2 ? w / 2 : 0), y = row * rh, v = 120 + r() * 60;
      g.fillStyle = grey(v); g.fillRect(x + 1, y, w - 2, rh); h.fillStyle = grey(120); h.fillRect(x + 1, y, w - 2, rh);
      const gr = h.createLinearGradient(0, y, 0, y + rh); gr.addColorStop(0, grey(80)); gr.addColorStop(1, grey(230)); h.fillStyle = gr; h.fillRect(x + 1, y, w - 2, rh);
      g.fillStyle = grey(40, 0.5); g.fillRect(x + 1, y + rh - 3, w - 2, 3);
    }
    grain(g, h, r, 6000, 2, 80, 200, 0.25);
    return [cv, hc, 2.6];
  },
  // rock: layered, fractured stone for the cliffs
  rock() {
    const [cv, g, hc, h] = pair(), r = mulberry32(29);
    g.fillStyle = grey(170); g.fillRect(0, 0, S, S); h.fillStyle = grey(128); h.fillRect(0, 0, S, S);
    for (let i = 0; i < 18; i++) { const y = r() * S, t = 6 + r() * 30, v = 120 + r() * 90; g.fillStyle = grey(v, 0.55); g.fillRect(0, y, S, t); h.fillStyle = grey(100 + r() * 120, 0.7); h.fillRect(0, y, S, t); }
    for (let i = 0; i < 60; i++) { const x = r() * S, y = r() * S, s = 10 + r() * 50; g.fillStyle = grey(110 + r() * 100, 0.35); g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s * 0.3); g.lineTo(x + s * 0.6, y + s); g.closePath(); g.fill(); h.fillStyle = grey(60 + r() * 180, 0.5); h.beginPath(); h.moveTo(x, y); h.lineTo(x + s, y + s * 0.3); h.lineTo(x + s * 0.6, y + s); h.closePath(); h.fill(); }
    grain(g, h, r, 14000, 2, 90, 230, 0.25); cracks(g, h, r, 14);
    return [cv, hc, 3];
  },
};

function build(kind) {
  if (made.has(kind)) return made.get(kind);
  const [cv, hc, strength] = MAKERS[kind]();
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  const normal = normalFromHeight(hc, strength, true);
  const out = { map, normal };
  made.set(kind, out);
  return out;
}
// The picture alone, at any level (maps that want the stone look everywhere).
export const surfacePicture = (kind) => () => build(kind).map;
// A material spec's map and normal: the realistic surface on High and up, else the fallback map.
export function surface(kind, fallback) {
  const fb = () => (typeof fallback === 'function' ? fallback() : fallback);
  return { map: () => (hiNow() ? build(kind).map : fb()), normal: () => (hiNow() ? build(kind).normal : null) };
}
