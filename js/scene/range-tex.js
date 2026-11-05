// Procedural textures for the range (canvas drawing only, no image files).
import * as THREE from '../../vendor/three/three.module.min.js';
import { mulberry32 } from '../core/prng.js';

function tex(cv, repeat) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')];
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

// Steel tread plate, tiles every 0.5 m. Worn copper-rust tint, raised diagonal bars.
export function treadPlate() {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(11);
  const base = g.createLinearGradient(0, 0, S, S);
  base.addColorStop(0, '#6e4a37'); base.addColorStop(0.5, '#5f4a40'); base.addColorStop(1, '#6a4634');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 260, rng, ['#2b1d16', '#8a5b40', '#4a4642', '#9a6a4a']);
  const cell = 32;
  for (let y = 0; y < S; y += cell) {
    for (let x = 0; x < S; x += cell) {
      const a = ((x + y) / cell) % 2 ? Math.PI / 4 : -Math.PI / 4;
      g.save();
      g.translate(x + cell / 2, y + cell / 2);
      g.rotate(a);
      // shadow, then the raised bar, then its lit edge
      g.fillStyle = 'rgba(20,12,8,0.55)';
      g.beginPath(); g.ellipse(1.5, 1.5, 11, 2.6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#8b6a56';
      g.beginPath(); g.ellipse(0, 0, 11, 2.6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,230,200,0.25)';
      g.beginPath(); g.ellipse(-0.6, -0.8, 9, 1.1, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
  speckle(g, S, S, 120, rng, ['#1d1410', '#3a2a22']);
  return tex(cv, true);
}

// Painted lane markings on a transparent sheet: distance lines and numbers, firing line,
// lane edges. ppm px per metre; the sheet covers halfWidth x 2 by (near + far) metres.
export function laneMarkings(halfWidth, near, far, ppm = 48) {
  const W = halfWidth * 2 * ppm, L = (near + far) * ppm, [cv, g] = canvas(W, L);
  const row = (dist) => (far - dist) * ppm;
  g.fillStyle = 'rgba(232,176,58,0.85)';
  g.textAlign = 'center';
  g.font = 'bold ' + Math.round(ppm * 0.6) + 'px sans-serif';
  for (const d of [5, 10, 15, 20]) {
    g.fillRect(ppm * 0.9, row(d) - 3, W - ppm * 1.8, 6);
    g.fillText(d + ' m', W / 2, row(d) + ppm * 0.8);
  }
  g.fillStyle = 'rgba(235,235,230,0.9)';
  g.fillRect(0, row(0) - 4, W, 8);                          // firing line
  g.fillStyle = 'rgba(232,176,58,0.7)';
  g.fillRect(ppm * 0.9 - 6, 0, 6, row(0));                  // lane edges, downrange only
  g.fillRect(W - ppm * 0.9, 0, 6, row(0));
  const t = tex(cv, false);
  return t;
}

// Corrugated metal wall, 2 m wide x 3.6 m tall per tile, with a safety stripe band.
export function corrugatedWall() {
  const W = 256, H = 460, [cv, g] = canvas(W, H), rng = mulberry32(7);
  for (let x = 0; x < W; x++) {
    const v = Math.sin((x / W) * Math.PI * 2 * 16);        // 16 ridges per tile
    const l = 58 + v * 14;
    g.fillStyle = 'rgb(' + (l - 6) + ',' + (l + 2) + ',' + (l + 4) + ')';
    g.fillRect(x, 0, 1, H);
  }
  // Lower 0.9 m: painted darker; safety stripe 0.9-1.1 m.
  const y = (m) => H - (m / 3.6) * H;
  g.fillStyle = 'rgba(30,36,34,0.55)';
  g.fillRect(0, y(0.9), W, H - y(0.9));
  g.save();
  g.beginPath(); g.rect(0, y(1.1), W, y(0.9) - y(1.1)); g.clip();
  g.fillStyle = '#d9a72e'; g.fillRect(0, y(1.1), W, y(0.9) - y(1.1));
  g.fillStyle = '#1b1b1b';
  for (let x = -40; x < W + 40; x += 32) { g.beginPath(); g.moveTo(x, y(0.9)); g.lineTo(x + 16, y(0.9)); g.lineTo(x + 40, y(1.1)); g.lineTo(x + 24, y(1.1)); g.closePath(); g.fill(); }
  g.restore();
  // grime streaks
  for (let i = 0; i < 40; i++) {
    const x = rng() * W, h = 20 + rng() * 120;
    const gr = g.createLinearGradient(0, y(3.4), 0, y(3.4) + h);
    gr.addColorStop(0, 'rgba(25,18,12,0.25)'); gr.addColorStop(1, 'rgba(25,18,12,0)');
    g.fillStyle = gr; g.fillRect(x, y(3.4), 2 + rng() * 4, h);
  }
  speckle(g, W, H, 140, rng, ['#1c1f20', '#6a6f72']);
  return tex(cv, true);
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

// The distance board: lane name, selected distance and target type.
export function drawBoard(g, W, H, distance, label) {
  g.fillStyle = '#16191d'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#3a4048'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
  g.fillStyle = '#e8b03a'; g.font = 'bold 44px sans-serif'; g.textAlign = 'left';
  g.fillText('LANE 1', 28, 62);
  g.fillStyle = '#9aa3ae'; g.font = '26px sans-serif';
  g.fillText(label.toUpperCase(), 28, 100);
  const ds = [5, 10, 15, 20];
  ds.forEach((d, i) => {
    const x = 28 + i * ((W - 56) / 4), y = 130, w = (W - 56) / 4 - 12, h = 90;
    const on = d === distance;
    g.fillStyle = on ? '#e8b03a' : '#252a31';
    g.fillRect(x, y, w, h);
    g.fillStyle = on ? '#16191d' : '#c9ced6';
    g.font = 'bold 40px sans-serif'; g.textAlign = 'center';
    g.fillText(d + ' m', x + w / 2, y + 60);
  });
  g.fillStyle = '#6b737d'; g.font = '22px sans-serif'; g.textAlign = 'left';
  g.fillText('-  /  +  change distance       M  change target', 28, H - 26);
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
  const W = hc.width, H = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, W, H).data;
  const [cv, g] = canvas(W, H);
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

// Tread plate: same bar layout as treadPlate(). Bars are raised and worn smooth.
export function treadPlateMaps() {
  const S = 256, rng = mulberry32(12);
  const [hc, hg] = canvas(S, S);
  const [rc, rg] = canvas(S, S);
  hg.fillStyle = '#404040'; hg.fillRect(0, 0, S, S);
  noiseField(hg, S, S, rng, 500, 0.5, 2, 0.15);
  rg.fillStyle = 'rgb(0,190,0)'; rg.fillRect(0, 0, S, S);
  for (let i = 0; i < 300; i++) {   // grime and rust: rougher patches
    const v = 170 + rng() * 85;
    rg.fillStyle = 'rgba(0,' + (v | 0) + ',0,0.25)';
    rg.beginPath(); rg.arc(rng() * S, rng() * S, 2 + rng() * 10, 0, Math.PI * 2); rg.fill();
  }
  const cell = 32;
  hg.filter = 'blur(1px)';
  for (let y = 0; y < S; y += cell) {
    for (let x = 0; x < S; x += cell) {
      const a = ((x + y) / cell) % 2 ? Math.PI / 4 : -Math.PI / 4;
      for (const [g, col] of [[hg, '#e8e8e8'], [rg, 'rgb(0,105,0)']]) {
        g.save(); g.translate(x + cell / 2, y + cell / 2); g.rotate(a);
        g.fillStyle = col;
        g.beginPath(); g.ellipse(0, 0, 11, 2.6, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }
  }
  hg.filter = 'none';
  return { normal: normalFromHeight(hc, 3), rough: dataTex(rc, true) };
}

// Corrugated wall: 16 rounded ridges per 2 m tile (matches corrugatedWall()).
export function corrugatedMaps() {
  const W = 256, H = 64, rng = mulberry32(8);
  const [hc, hg] = canvas(W, H);
  for (let x = 0; x < W; x++) {
    const v = Math.sin((x / W) * Math.PI * 2 * 16) * 0.5 + 0.5;
    const l = (v * 200 + 28) | 0;
    hg.fillStyle = 'rgb(' + l + ',' + l + ',' + l + ')'; hg.fillRect(x, 0, 1, H);
  }
  noiseField(hg, W, H, rng, 120, 0.5, 1.5, 0.08);
  const [rc, rg] = canvas(W, 460);
  rg.fillStyle = 'rgb(0,175,0)'; rg.fillRect(0, 0, W, 460);
  for (let i = 0; i < 200; i++) {
    const v = 120 + rng() * 120;
    rg.fillStyle = 'rgba(0,' + (v | 0) + ',0,0.3)';
    rg.fillRect(rng() * W, rng() * 460, 2 + rng() * 6, 10 + rng() * 80);
  }
  // Painted lower band and stripe: satin paint, a bit smoother.
  rg.fillStyle = 'rgba(0,120,0,0.6)'; rg.fillRect(0, 460 - (1.1 / 3.6) * 460, W, (1.1 / 3.6) * 460);
  return { normal: normalFromHeight(hc, 2), rough: dataTex(rc, true) };
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
