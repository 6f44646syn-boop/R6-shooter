// Procedural textures for the range (canvas drawing only, no image files).
import * as THREE from '../../vendor/three/three.module.min.js?v=47bc4b7-mwdas1g3';
import { mulberry32 } from '../core/prng.js?v=47bc4b7-mwdas1g3';

function tex(cv, repeat) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
// Resolution multiplier (ultra graphics draws the same textures at 2-4x: withRes). The
// drawing code works in the base pixel units; the context is scaled.
let RES = 1;
let NORMAL_BAKER = null;     // (heightCanvas, strength, wrap) => texture, on the GPU (ultra)
export function setNormalBaker(fn) { NORMAL_BAKER = fn; }
export function withRes(k, fn) {
  const prev = RES;
  RES = k;
  try { return fn(); } finally { RES = prev; }
}
function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * RES); cv.height = Math.round(h * RES);
  const g = cv.getContext('2d');
  if (RES !== 1) g.scale(RES, RES);
  return [cv, g];
}
function speckle(g, w, h, n, rng, colors) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(rng() * colors.length) | 0];
    g.globalAlpha = 0.08 + rng() * 0.12;
    const r = 1 + rng() * 6;
    g.beginPath(); g.arc(rng() * w, rng() * h, r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

// Riveted steel backstop plate with rust streaks.
export function backstopPlate() {
  const W = 512, H = 230, [cv, g] = canvas(W, H), rng = mulberry32(5);
  g.fillStyle = '#3f4144'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 400, rng, ['#2a2b2d', '#55585b', '#5a3a28']);
  g.strokeStyle = 'rgba(15,15,15,0.7)'; g.lineWidth = 2;
  for (let x = 0; x <= W; x += W / 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  for (let x = 6; x < W; x += W / 4) for (let yy = 8; yy < H; yy += 22) {
    for (const xx of [x, x + W / 4 - 12]) {
      g.fillStyle = '#5c5f63'; g.beginPath(); g.arc(xx, yy, 2.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(xx + 0.8, yy + 0.8, 2.4, 0, Math.PI * 2); g.fill();
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = rng() * W, y0 = rng() * H * 0.6;
    const gr = g.createLinearGradient(0, y0, 0, y0 + 60);
    gr.addColorStop(0, 'rgba(140,70,30,0.35)'); gr.addColorStop(1, 'rgba(140,70,30,0)');
    g.fillStyle = gr; g.fillRect(x, y0, 3, 60);
  }
  return tex(cv, false);
}

// Dusk sky for an inside-out sphere (equirectangular): deep blue overhead, warm orange
// horizon, a low sun glow straight down range (u = 0.75 is -z on three's SphereGeometry).
export function duskSky() {
  const W = 1024, H = 512, [cv, g] = canvas(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#34477a');
  gr.addColorStop(0.25, '#5a5a8a');
  gr.addColorStop(0.4, '#b0707a');
  gr.addColorStop(0.45, '#d88a6a');
  gr.addColorStop(0.5, '#f0a060');
  gr.addColorStop(0.53, '#6a4a3a');
  gr.addColorStop(1, '#241a16');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const sx = W * 0.75, sy = H * 0.485;
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.35);
  sun.addColorStop(0, 'rgba(255,220,160,0.95)');
  sun.addColorStop(0.06, 'rgba(255,190,110,0.7)');
  sun.addColorStop(0.3, 'rgba(240,130,70,0.25)');
  sun.addColorStop(1, 'rgba(240,130,70,0)');
  g.fillStyle = sun; g.fillRect(0, 0, W, H);
  // thin cloud bands
  const rng = mulberry32(3);
  for (let i = 0; i < 26; i++) {
    const y = H * (0.3 + rng() * 0.16), w = 80 + rng() * 260, x = rng() * W;
    g.fillStyle = 'rgba(255,180,140,' + (0.05 + rng() * 0.08) + ')';
    g.beginPath(); g.ellipse(x, y, w, 3 + rng() * 5, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Painted hazard ring for the dummy's pad.
export function padTexture() {
  const S = 256, [cv, g] = canvas(S, S), c = S / 2;
  g.fillStyle = '#4a4744'; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.arc(c, c, c * 0.78, 0, Math.PI * 2, true); g.clip();
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    g.fillStyle = (Math.round(a / (Math.PI / 12)) % 2) ? '#d9a72e' : '#1b1b1b';
    g.beginPath(); g.moveTo(c, c); g.arc(c, c, c, a, a + Math.PI / 12); g.closePath(); g.fill();
  }
  g.restore();
  g.fillStyle = '#5a5652'; g.beginPath(); g.arc(c, c, c * 0.74, 0, Math.PI * 2); g.fill();
  return tex(cv, false);
}

/* ---------- High graphics: height-derived normal maps and roughness maps ----------
   Each surface is described once as a greyscale height field drawn on a canvas; the normal
   map is its gradient (Sobel), computed once on the CPU at start-up. Roughness maps put the
   value in green (three.js reads roughness from G). Everything stays procedural. */

function dataTex(cv, repeat, srgb = false) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

// Height canvas (grey = height) -> tangent-space normal map. wrap: tile seamlessly.
export function normalFromHeight(hc, strength = 2, wrap = true) {
  // At RES x the same slope spans RES times more pixels: scale the strength to match.
  if (NORMAL_BAKER && RES !== 1) {
    const t = NORMAL_BAKER(hc, strength * RES, wrap);
    if (t) return t;
  }
  const W = hc.width, H = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, W, H).data;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const out = g.createImageData(W, H), o = out.data;
  const h = (x, y) => {
    if (wrap) { x = (x + W) % W; y = (y + H) % H; } else { x = Math.min(W - 1, Math.max(0, x)); y = Math.min(H - 1, Math.max(0, y)); }
    return src[(y * W + x) * 4] / 255;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
      // Canvas y runs down, texture v runs up: flip dy.
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * W + x) * 4;
      o[i] = (nx / l * 0.5 + 0.5) * 255; o[i + 1] = (ny / l * 0.5 + 0.5) * 255; o[i + 2] = (nz / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return dataTex(cv, wrap);
}

function noiseField(g, W, H, rng, n, rMin, rMax, a) {
  for (let i = 0; i < n; i++) {
    const v = (rng() * 255) | 0;
    g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + a + ')';
    const r = rMin + rng() * (rMax - rMin);
    g.beginPath(); g.arc(rng() * W, rng() * H, r, 0, Math.PI * 2); g.fill();
  }
}

// Backstop: panel seams, rivet heads and pitting from old hits (matches backstopPlate()).
export function backstopMaps() {
  const W = 512, H = 230, rng = mulberry32(6);
  const [hc, hg] = canvas(W, H);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, W, H);
  noiseField(hg, W, H, rng, 900, 0.6, 2.2, 0.05);
  // A few shallow dents only: deep dark pits would read as bullet holes.
  for (let i = 0; i < 45; i++) {
    const x = rng() * W, y = rng() * H, r = 3 + rng() * 7;
    const gr = hg.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(90,90,90,0.5)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
    hg.fillStyle = gr; hg.beginPath(); hg.arc(x, y, r, 0, Math.PI * 2); hg.fill();
  }
  hg.fillStyle = '#202020';
  for (let x = 0; x <= W; x += W / 4) hg.fillRect(x - 1.5, 0, 3, H);
  hg.fillRect(0, H / 2 - 1.5, W, 3);
  for (let x = 6; x < W; x += W / 4) for (let yy = 8; yy < H; yy += 22) {
    for (const xx of [x, x + W / 4 - 12]) {
      const gr = hg.createRadialGradient(xx, yy, 0, xx, yy, 3);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#808080');
      hg.fillStyle = gr; hg.beginPath(); hg.arc(xx, yy, 3, 0, Math.PI * 2); hg.fill();
    }
  }
  const [rc, rg] = canvas(W, H);
  rg.fillStyle = 'rgb(0,140,0)'; rg.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const x = rng() * W, y0 = rng() * H * 0.6;
    rg.fillStyle = 'rgba(0,235,0,0.4)'; rg.fillRect(x, y0, 4, 60);   // rust runs are rough
  }
  return { normal: normalFromHeight(hc, 1.2, false), rough: dataTex(rc, false) };
}

// Gun finishes. Box and cylinder faces map 0..1, so the edges of the UV square are the
// edges of each part: that is where the coating wears through to bright, smoother metal.
// kind 'metal': anodised/cerakote finish with edge wear. 'polymer': stippled plastic.
const GUN_CACHE = {};
export function gunMaps(kind) {
  if (GUN_CACHE[kind]) return GUN_CACHE[kind];
  const S = 256, rng = mulberry32(kind === 'metal' ? 31 : 37);
  const [mc, mg] = canvas(S, S);     // albedo multiplier (white = finish colour as set)
  const [rc, rg] = canvas(S, S);     // roughness in G, metalness in B
  const [hc, hg] = canvas(S, S);     // height for the normal map
  const metal = kind === 'metal';
  mg.fillStyle = '#ffffff'; mg.fillRect(0, 0, S, S);
  rg.fillStyle = metal ? 'rgb(0,120,190)' : 'rgb(0,200,10)'; rg.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
  if (metal) {
    // Fine machining lines along u, and faint blotches in the coating.
    for (let y = 0; y < S; y++) {
      const v = 128 + (rng() - 0.5) * 30;
      hg.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + (v | 0) + ',0.6)'; hg.fillRect(0, y, S, 1);
    }
    for (let i = 0; i < 120; i++) {
      const v = 225 + rng() * 30;
      mg.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + (v | 0) + ',0.5)';
      mg.beginPath(); mg.arc(rng() * S, rng() * S, 4 + rng() * 18, 0, Math.PI * 2); mg.fill();
    }
    // Edge wear: a ragged band along the UV border, brighter and smoother.
    const band = (x, y, w, h) => {
      mg.fillStyle = 'rgba(255,240,225,0.9)'; mg.fillRect(x, y, w, h);
      rg.fillStyle = 'rgba(0,70,255,0.9)'; rg.fillRect(x, y, w, h);
    };
    for (let i = 0; i < 260; i++) {
      const t = rng() * S, d = Math.pow(rng(), 3) * 9, l = 2 + rng() * 10, th = 1 + rng() * 1.5;
      const side = (rng() * 4) | 0;
      if (side === 0) band(t, d, l, th); else if (side === 1) band(t, S - d - th, l, th);
      else if (side === 2) band(d, t, th, l); else band(S - d - th, t, th, l);
    }
    // Scratches.
    rg.lineWidth = mg.lineWidth = 0.8;
    for (let i = 0; i < 40; i++) {
      const x = rng() * S, y = rng() * S, a = rng() * Math.PI, l = 6 + rng() * 30;
      for (const [g, c] of [[mg, 'rgba(255,245,235,0.35)'], [rg, 'rgba(0,80,230,0.6)']]) {
        g.strokeStyle = c; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    }
  } else {
    noiseField(hg, S, S, rng, 5000, 0.6, 1.6, 0.5);      // stipple
    for (let i = 0; i < 80; i++) {                        // handling polish: smoother, slightly lighter
      rg.fillStyle = 'rgba(0,150,10,0.25)';
      rg.beginPath(); rg.arc(rng() * S, rng() * S, 6 + rng() * 20, 0, Math.PI * 2); rg.fill();
    }
  }
  const map = dataTex(mc, true, true);
  const out = { map, rough: dataTex(rc, true), normal: normalFromHeight(hc, metal ? 0.8 : 2.2) };
  GUN_CACHE[kind] = out;
  return out;
}

/* ---------- Indoor range surfaces (each returns { map, normal, rough }) ----------
   The normal and roughness maps are built once and used only by high graphics, but they
   are cheap (a few hundred kB of canvas work at start-up). */

// Concrete floor tiles: one texture covers 2 x 2 m, 4 x 4 tiles of 0.5 m with dark grout,
// stains and scuffs.
export function concreteTiles() {
  const S = 512, T = S / 4, rng = mulberry32(41);
  const [cv, g] = canvas(S, S), [hc, hg] = canvas(S, S), [rc, rg] = canvas(S, S);
  hg.fillStyle = '#c0c0c0'; hg.fillRect(0, 0, S, S);
  rg.fillStyle = 'rgb(0,215,0)'; rg.fillRect(0, 0, S, S);
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
    const l = 150 + rng() * 26, w = 3 + rng() * 6;
    g.fillStyle = 'rgb(' + (l | 0) + ',' + ((l - 3) | 0) + ',' + ((l - 10) | 0) + ')';
    g.fillRect(tx * T, ty * T, T, T);
    // soft light/dark patches inside each tile
    for (let i = 0; i < 6; i++) {
      const x = tx * T + rng() * T, y = ty * T + rng() * T, r = 10 + rng() * 40;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const d = rng() < 0.5 ? '40,34,28' : '230,225,215';
      gr.addColorStop(0, 'rgba(' + d + ',' + (0.05 + rng() * 0.08) + ')'); gr.addColorStop(1, 'rgba(' + d + ',0)');
      g.fillStyle = gr; g.fillRect(tx * T, ty * T, T, T);
    }
    void w;
  }
  speckle(g, S, S, 1400, rng, ['#5a534a', '#d8d2c6', '#7a7064', '#3a342e']);
  // oil and rust stains (rougher), scuff marks (smoother)
  for (let i = 0; i < 14; i++) {
    const x = rng() * S, y = rng() * S, r = 14 + rng() * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(70,52,36,' + (0.15 + rng() * 0.2) + ')'); gr.addColorStop(1, 'rgba(70,52,36,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    rg.fillStyle = 'rgba(0,150,0,0.4)'; rg.beginPath(); rg.arc(x, y, r * 0.7, 0, Math.PI * 2); rg.fill();
  }
  g.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    const x = rng() * S, y = rng() * S, a = rng() * Math.PI, l = 8 + rng() * 40;
    g.strokeStyle = 'rgba(40,36,30,0.25)';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // grout
  g.fillStyle = '#3c3833'; hg.fillStyle = '#202020'; rg.fillStyle = 'rgb(0,250,0)';
  for (let i = 0; i <= 4; i++) {
    for (const [c, ww] of [[g, 4], [hg, 6], [rg, 6]]) { c.fillRect(i * T - ww / 2, 0, ww, S); c.fillRect(0, i * T - ww / 2, S, ww); }
  }
  noiseField(hg, S, S, rng, 2500, 0.5, 1.5, 0.12);
  return { map: tex(cv, true), normal: normalFromHeight(hc, 2), rough: dataTex(rc, true) };
}

// Steel floor grating where you stand: 0.25 m per tile, square openings over a dark void.
export function floorGrate() {
  const S = 128, rng = mulberry32(43), n = 8, c = S / n;
  const [cv, g] = canvas(S, S), [hc, hg] = canvas(S, S);
  g.fillStyle = '#0d0e10'; g.fillRect(0, 0, S, S);
  hg.fillStyle = '#000'; hg.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) {
    for (const [cc, col] of [[g, '#4a4d52'], [hg, '#fff']]) {
      cc.fillStyle = col;
      cc.fillRect(i * c - 1.5, 0, 3, S); cc.fillRect(0, i * c - 2, S, 4);
    }
  }
  speckle(g, S, S, 120, rng, ['#2a2622', '#6a5a48']);
  return { map: tex(cv, true), normal: normalFromHeight(hc, 3) };
}

// Side wall: 1.2 m modules, 3.6 m tall. Dark painted steel panels with louvred vents, seams
// and a grey kick band at the bottom.
export function wallPanels() {
  const W = 256, H = 768, rng = mulberry32(47);
  const [cv, g] = canvas(W, H), [hc, hg] = canvas(W, H);
  const y = (m) => H - (m / 3.6) * H;
  g.fillStyle = '#4a4d51'; g.fillRect(0, 0, W, H);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, W, H);
  g.fillStyle = '#4a4c4e'; g.fillRect(0, y(0.4), W, H - y(0.4));                         // kick band
  hg.fillStyle = '#a0a0a0'; hg.fillRect(0, y(0.4), W, H - y(0.4));
  // vertical louvre column in the middle of the module, 0.6 to 2.8 m
  const lx = W * 0.3, lw = W * 0.4;
  g.fillStyle = '#26282b'; g.fillRect(lx, y(2.8), lw, y(0.6) - y(2.8));
  for (let yy = y(2.8) + 4; yy < y(0.6) - 4; yy += 9) {
    g.fillStyle = '#121315'; g.fillRect(lx + 6, yy, lw - 12, 4);
    g.fillStyle = '#4f5256'; g.fillRect(lx + 6, yy + 4, lw - 12, 1.5);
    hg.fillStyle = '#303030'; hg.fillRect(lx + 6, yy, lw - 12, 4);
    hg.fillStyle = '#d0d0d0'; hg.fillRect(lx + 6, yy + 4, lw - 12, 2);
  }
  // seams at the module edges and a horizontal seam
  for (const [c, col] of [[g, '#151618'], [hg, '#101010']]) {
    c.fillStyle = col; c.fillRect(0, 0, 3, H); c.fillRect(W - 3, 0, 3, H); c.fillRect(0, y(3.0), W, 3);
  }
  speckle(g, W, H, 500, rng, ['#202224', '#55595d', '#4a3d30']);
  for (let i = 0; i < 30; i++) {                   // grime runs
    const x = rng() * W, y0 = rng() * H * 0.8, h = 30 + rng() * 120;
    const gr = g.createLinearGradient(0, y0, 0, y0 + h);
    gr.addColorStop(0, 'rgba(20,16,12,0.25)'); gr.addColorStop(1, 'rgba(20,16,12,0)');
    g.fillStyle = gr; g.fillRect(x, y0, 2 + rng() * 5, h);
  }
  return { map: tex(cv, true), normal: normalFromHeight(hc, 2) };
}

// Ceiling: dark board-formed concrete.
export function ceilingConcrete() {
  const S = 256, rng = mulberry32(53), [cv, g] = canvas(S, S);
  g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 16) { g.fillStyle = 'rgba(0,0,0,' + (0.1 + rng() * 0.15) + ')'; g.fillRect(x, 0, 2, S); }
  speckle(g, S, S, 500, rng, ['#1a1b1d', '#3a3b3e']);
  return tex(cv, true);
}

// Yellow and black hazard stripes (diagonal), tiles along u.
export function hazardStripes() {
  const W = 128, H = 32, [cv, g] = canvas(W, H);
  g.fillStyle = '#d9a72e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#18181a';
  for (let x = -H; x < W + H; x += 32) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 16, H); g.lineTo(x + 16 + H, 0); g.lineTo(x + H, 0); g.closePath(); g.fill(); }
  return tex(cv, true);
}

// Front face of the firing-line ledge: worn grey steel with a stencilled warning.
export function ledgeFace(widthM) {
  const W = 1024, H = 96, [cv, g] = canvas(W, H), rng = mulberry32(59);
  g.fillStyle = '#3d4044'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 400, rng, ['#2a2c2f', '#5a5e63']);
  g.fillStyle = 'rgba(200,205,210,0.55)';
  g.font = 'bold 54px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const text = 'D O   N O T   C R O S S';
  g.fillText(text, W / 2, H / 2 + 2);
  // stencil bridges
  g.fillStyle = '#3d4044';
  for (let x = 0; x < W; x += 11) if (rng() < 0.2) g.fillRect(x, H / 2 - 3, 2, 6);
  void widthM;
  return tex(cv, false);
}

// Paper target: light card, concentric scoring rings (RING_STEP apart, 10 rings), red
// centre, alignment ticks. size: board edge in metres (the texture covers the board).
export const RING_STEP = 0.04;      // metres between rings (score 10 inside the first)
export function paperTarget(size) {
  const S = 1024, [cv, g] = canvas(S, S), ppm = S / size, c = S / 2, rng = mulberry32(61);
  g.fillStyle = '#cfcdc7'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 300, rng, ['#bdbab3', '#dddbd5']);
  const R = (k) => k * RING_STEP * ppm;
  g.fillStyle = '#2b2b2d'; g.beginPath(); g.arc(c, c, R(10), 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3a3a3d'; g.beginPath(); g.arc(c, c, R(6), 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(220,220,215,0.75)';
  for (let k = 1; k <= 10; k++) { g.lineWidth = k % 2 ? 2 : 3.5; g.beginPath(); g.arc(c, c, R(k), 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = '#9b2b2b'; g.beginPath(); g.arc(c, c, R(1) - 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3a3a3d';
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const r0 = R(10) + 10, r1 = R(10) + 40;
    g.fillRect(c + dx * r0 - (dx ? 0 : 3) - (dx < 0 ? r1 - r0 : 0), c + dy * r0 - (dy ? 0 : 3) - (dy < 0 ? r1 - r0 : 0), dx ? r1 - r0 : 6, dy ? r1 - r0 : 6);
  }
  g.font = 'bold 22px sans-serif'; g.fillStyle = 'rgba(220,220,215,0.8)'; g.textAlign = 'center';
  for (let k = 2; k <= 9; k++) g.fillText(String(11 - k), c, c - R(k) + R(1) * 0.65);
  g.strokeStyle = '#8a8882'; g.lineWidth = 8; g.strokeRect(4, 4, S - 8, S - 8);
  const t = tex(cv, false);
  t.anisotropy = 8;
  return t;
}

// The lane's control screen. distance: selected metres; mode: 'dummy' | 'paper' | 'dots';
// label: what is on the lane.
export function drawPanel(g, W, H, distance, mode, label) {
  g.fillStyle = '#0f1318'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2b3440'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8);
  const sx = W * 0.36;
  g.fillStyle = '#1f2a36'; g.fillRect(sx, 24, 3, H - 48);
  // distances
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = '#7f8b99'; g.font = '600 26px sans-serif'; g.fillText('DISTANCE', 36, 52);
  [5, 10, 15, 20].forEach((d, i) => {
    const y = 120 + i * 98, on = d === distance;
    g.strokeStyle = on ? '#6fb7ff' : '#46505c'; g.lineWidth = 3;
    g.strokeRect(40, y - 30, 60, 60);
    if (on) { g.fillStyle = 'rgba(80,160,255,0.35)'; g.fillRect(46, y - 24, 48, 48); }
    g.fillStyle = on ? '#cfe6ff' : '#c9d0d8'; g.font = 'bold 44px sans-serif';
    g.fillText(d + ' M', 124, y + 2);
  });
  g.fillStyle = '#6fb7ff'; g.font = '600 24px sans-serif'; g.fillText('-  /  +', 40, H - 46);
  // target
  const cx = sx + (W - sx) / 2;
  g.textAlign = 'center';
  g.fillStyle = '#7f8b99'; g.font = '600 26px sans-serif'; g.fillText('TARGET', cx, 52);
  const modes = ['dummy', 'paper', 'dots'];
  modes.forEach((m, i) => {
    const x = cx + (i - 1) * 110, y = 112, on = m === mode;
    g.strokeStyle = on ? '#6fb7ff' : '#46505c'; g.lineWidth = 3; g.strokeRect(x - 34, y - 34, 68, 68);
    if (on) { g.fillStyle = 'rgba(80,160,255,0.3)'; g.fillRect(x - 28, y - 28, 56, 56); }
    g.fillStyle = on ? '#e6f1ff' : '#9aa6b4'; g.strokeStyle = g.fillStyle; g.lineWidth = 3;
    if (m === 'dummy') { g.beginPath(); g.arc(x, y - 14, 8, 0, Math.PI * 2); g.fill(); g.fillRect(x - 10, y - 4, 20, 26); }
    else if (m === 'paper') { for (const r of [22, 14, 6]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); } }
    else { for (const [dx, dy] of [[-12, -10], [12, -4], [-2, 14]]) { g.fillStyle = '#e0201b'; g.beginPath(); g.arc(x + dx, y + dy, 7, 0, Math.PI * 2); g.fill(); } }
  });
  // preview of what is on the lane
  const py = 300;
  if (mode === 'paper') {
    g.fillStyle = '#2b2b2d'; g.beginPath(); g.arc(cx, py, 110, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#9aa0a8'; g.lineWidth = 2;
    for (let k = 1; k <= 10; k++) { g.beginPath(); g.arc(cx, py, k * 11, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#9b2b2b'; g.beginPath(); g.arc(cx, py, 9, 0, Math.PI * 2); g.fill();
  } else if (mode === 'dummy') {
    g.fillStyle = '#c99550';
    g.beginPath(); g.arc(cx, py - 80, 24, 0, Math.PI * 2); g.fill();
    g.fillRect(cx - 40, py - 50, 80, 110); g.fillRect(cx - 34, py + 60, 26, 70); g.fillRect(cx + 8, py + 60, 26, 70);
  } else {
    g.strokeStyle = '#46505c'; g.lineWidth = 2; g.strokeRect(cx - 150, py - 100, 300, 200);
    for (const [dx, dy] of [[-90, -40], [60, -60], [-20, 30], [100, 50], [-110, 70]]) {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + dx, py + dy, 15, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e0201b'; g.beginPath(); g.arc(cx + dx, py + dy, 11, 0, Math.PI * 2); g.fill();
    }
  }
  g.fillStyle = '#9aa6b4'; g.font = '24px sans-serif'; g.fillText(label.toUpperCase(), cx, py + 150);
  // clear button
  g.strokeStyle = '#46505c'; g.lineWidth = 3; g.strokeRect(cx - 120, H - 76, 240, 54);
  g.fillStyle = '#c9d0d8'; g.font = 'bold 28px sans-serif'; g.fillText('CLEAR  (C)', cx, H - 48);
  g.fillStyle = '#6fb7ff'; g.font = '600 24px sans-serif'; g.textAlign = 'right'; g.fillText('M', W - 40, 52);
}
