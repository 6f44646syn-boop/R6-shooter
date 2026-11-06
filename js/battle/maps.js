// Battle maps. Each map is data: size, floor, walls, sky or ceiling, lights, cover pieces
// (kinds: how a piece looks, plus decoration that does not block), the cover layout for one
// half (mirrored through the centre so both sides are equal), spawns and extras.
//
//   Container Yard - the original walled yard (containers, crates, walls, barriers)
//   Winter Cabin   - a snowy clearing: log cabin, shed, pines, woodpiles, snowbanks, falling snow
//   Jesse's Casino - casino floor: slot machine rows, card tables, roulette, bar, gold pillars
//   School         - classrooms and hall: lockers, desks, cafeteria tables, trophy case
//
// Everything is drawn in code (canvas textures); no image files.
import * as THREE from '../../vendor/three/three.module.min.js?v=2156b86-mw4poxh9';
import { concreteTiles, wallPanels, duskSky, hazardStripes } from '../scene/range-tex.js?v=2156b86-mw4poxh9';
import { mulberry32 } from '../core/prng.js?v=2156b86-mw4poxh9';

/* ---------- texture helpers ---------- */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(cv, repeat = true) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const memo = (fn) => { let v = null; return () => (v = v || fn()); };
function speckle(g, W, H, n, rng, cols, rMax = 3, aMax = 0.2) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = 0.05 + rng() * aMax; g.fillStyle = cols[(rng() * cols.length) | 0];
    g.beginPath(); g.arc(rng() * W, rng() * H, 0.5 + rng() * rMax, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

/* ---------- Container Yard (original) ---------- */
const crateTex = memo(() => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(5);
  g.fillStyle = '#8a6a43'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 32) { g.fillStyle = 'rgba(0,0,0,' + (0.05 + rng() * 0.1) + ')'; g.fillRect(0, y, S, 32); g.fillStyle = 'rgba(40,25,10,0.6)'; g.fillRect(0, y, S, 2); }
  for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(60,40,20,0.15)'; g.fillRect(rng() * S, rng() * S, 1 + rng() * 30, 1); }
  g.strokeStyle = '#5a4128'; g.lineWidth = 22; g.strokeRect(11, 11, S - 22, S - 22);
  g.beginPath(); g.moveTo(16, 16); g.lineTo(S - 16, S - 16); g.stroke();
  g.fillStyle = '#2a2a2a';
  for (const [x, y] of [[11, 11], [S - 11, 11], [11, S - 11], [S - 11, S - 11]]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
  return tex(cv);
});
const containerTex = memo(() => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(9);
  for (let x = 0; x < S; x++) { const l = 190 + Math.sin((x / S) * Math.PI * 8) * 45; g.fillStyle = 'rgb(' + (l | 0) + ',' + (l | 0) + ',' + (l | 0) + ')'; g.fillRect(x, 0, 1, S); }
  for (let i = 0; i < 40; i++) {
    const x = rng() * S, y = rng() * S * 0.7, h = 20 + rng() * 80, gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, 'rgba(90,50,20,0.35)'); gr.addColorStop(1, 'rgba(90,50,20,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + rng() * 4, h);
  }
  return tex(cv);
});
const concreteTex = memo(() => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(13);
  g.fillStyle = '#b9b5ad'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 900, rng, ['#8a867e', '#d8d4cc', '#a09a90'], 4, 0.25);
  g.fillStyle = 'rgba(60,58,54,0.5)'; g.fillRect(0, S / 2 - 1, S, 2); g.fillRect(S - 2, 0, 2, S);
  return tex(cv);
});

/* ---------- Winter Cabin ---------- */
const snowTex = memo(() => {
  const S = 512, [cv, g] = canvas(S, S), rng = mulberry32(21);
  g.fillStyle = '#e9eff6'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {                       // soft drifts
    const x = rng() * S, y = rng() * S, r = 30 + rng() * 90, gr = g.createRadialGradient(x, y, 0, x, y, r);
    const c = rng() < 0.5 ? '200,214,232' : '255,255,255';
    gr.addColorStop(0, 'rgba(' + c + ',0.35)'); gr.addColorStop(1, 'rgba(' + c + ',0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  speckle(g, S, S, 2500, rng, ['#ffffff', '#cdd9e8', '#b9c8db'], 1.6, 0.35);
  for (let i = 0; i < 40; i++) {                       // footprints
    const x = rng() * S, y = rng() * S;
    g.fillStyle = 'rgba(150,170,195,0.35)';
    for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x + k * 14 + (k % 2) * 6, y + k * 9, 4, 7, 0.6, 0, Math.PI * 2); g.fill(); }
  }
  return tex(cv);
});
const logTex = memo(() => {
  const W = 256, H = 256, [cv, g] = canvas(W, H), rng = mulberry32(22);
  const n = 8, h = H / n;
  for (let i = 0; i < n; i++) {
    const y = i * h, gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#3a2414'); gr.addColorStop(0.2, '#8a5a32'); gr.addColorStop(0.5, '#a06a3c'); gr.addColorStop(0.85, '#6a4222'); gr.addColorStop(1, '#2a180c');
    g.fillStyle = gr; g.fillRect(0, y, W, h);
    for (let k = 0; k < 30; k++) { g.fillStyle = 'rgba(40,24,10,0.25)'; g.fillRect(rng() * W, y + 4 + rng() * (h - 8), 10 + rng() * 60, 1); }
    g.fillStyle = 'rgba(240,248,255,0.85)'; g.fillRect(0, y + 1, W, 2 + rng() * 2);   // snow on each log
  }
  return tex(cv);
});
const plankTex = memo(() => {
  const W = 256, H = 256, [cv, g] = canvas(W, H), rng = mulberry32(23);
  for (let x = 0; x < W; x += 32) {
    const l = 0.85 + rng() * 0.3;
    g.fillStyle = 'rgb(' + ((110 * l) | 0) + ',' + ((78 * l) | 0) + ',' + ((52 * l) | 0) + ')'; g.fillRect(x, 0, 32, H);
    for (let k = 0; k < 20; k++) { g.fillStyle = 'rgba(40,26,14,0.3)'; g.fillRect(x + rng() * 30, rng() * H, 1, 20 + rng() * 80); }
    g.fillStyle = '#2a1c10'; g.fillRect(x, 0, 2, H);
    g.fillStyle = '#555'; for (const y of [30, H - 30]) { g.beginPath(); g.arc(x + 16, y, 2.5, 0, 6.3); g.fill(); }
  }
  g.fillStyle = 'rgba(250,252,255,0.9)'; g.fillRect(0, 0, W, 10);
  return tex(cv);
});
const barkTex = memo(() => {
  const W = 128, H = 256, [cv, g] = canvas(W, H), rng = mulberry32(24);
  g.fillStyle = '#4a3322'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(25,16,10,0.6)' : 'rgba(110,80,55,0.4)'; g.fillRect(rng() * W, rng() * H, 2 + rng() * 4, 20 + rng() * 60); }
  return tex(cv);
});
const woodpileTex = memo(() => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(25);
  g.fillStyle = '#2a1a10'; g.fillRect(0, 0, S, S);
  for (let y = 16; y < S; y += 30) for (let x = 16 + ((y / 30) % 2) * 15; x < S; x += 30) {
    const r = 12 + rng() * 3;
    g.fillStyle = '#6a4424'; g.beginPath(); g.arc(x, y, r + 2, 0, 6.3); g.fill();
    g.fillStyle = '#c89a62'; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
    g.strokeStyle = 'rgba(120,80,40,0.6)'; g.lineWidth = 1;
    for (let k = 3; k < r; k += 3) { g.beginPath(); g.arc(x, y, k, 0, 6.3); g.stroke(); }
  }
  return tex(cv);
});
const winterSky = memo(() => {
  const W = 512, H = 256, [cv, g] = canvas(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#6f8fb8'); gr.addColorStop(0.45, '#b8cde4'); gr.addColorStop(0.52, '#dfe8f2'); gr.addColorStop(1, '#eef3f8');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const rng = mulberry32(26);
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.1 + rng() * 0.2) + ')'; g.beginPath(); g.ellipse(rng() * W, H * (0.1 + rng() * 0.3), 40 + rng() * 120, 6 + rng() * 10, 0, 0, 6.3); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
});

/* ---------- Jesse's Casino ---------- */
const carpetTex = memo(() => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(31);
  g.fillStyle = '#6e0f1c'; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(232,180,70,0.85)'; g.lineWidth = 3;
  for (let y = 0; y <= S; y += 64) for (let x = 0; x <= S; x += 64) {
    g.beginPath(); g.moveTo(x, y - 24); g.lineTo(x + 24, y); g.lineTo(x, y + 24); g.lineTo(x - 24, y); g.closePath(); g.stroke();
    g.fillStyle = '#1f2a5a'; g.beginPath(); g.arc(x, y, 6, 0, 6.3); g.fill();
  }
  g.strokeStyle = 'rgba(232,180,70,0.4)'; g.lineWidth = 1.5;
  for (let y = 32; y < S; y += 64) for (let x = 32; x < S; x += 64) { g.beginPath(); g.arc(x, y, 10, 0, 6.3); g.stroke(); }
  speckle(g, S, S, 500, rng, ['#4a0a12', '#8a1a2a'], 2, 0.3);
  return tex(cv);
});
const woodPanelTex = memo(() => {
  const W = 256, H = 512, [cv, g] = canvas(W, H), rng = mulberry32(32);
  g.fillStyle = '#3a1d10'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(' + (rng() < 0.5 ? '20,8,4' : '90,46,24') + ',0.3)'; g.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 40 + rng() * 120); }
  g.strokeStyle = '#c9952e'; g.lineWidth = 4; g.strokeRect(16, 40, W - 32, H * 0.45);
  g.strokeRect(16, H * 0.55, W - 32, H * 0.38);
  g.fillStyle = '#d6a43a'; g.fillRect(0, H * 0.5 - 5, W, 10);
  return tex(cv);
});
const feltTex = memo(() => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(33);
  g.fillStyle = '#0d6a3a'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 900, rng, ['#0a5a30', '#118048'], 1.5, 0.3);
  g.strokeStyle = 'rgba(240,220,150,0.7)'; g.lineWidth = 3; g.beginPath(); g.arc(S / 2, S * 0.1, S * 0.6, 0.3, Math.PI - 0.3); g.stroke();
  return tex(cv);
});
const cabinetTex = memo(() => {
  const S = 128, [cv, g] = canvas(S, S);
  const gr = g.createLinearGradient(0, 0, S, 0); gr.addColorStop(0, '#1a1c24'); gr.addColorStop(0.5, '#2c2f3a'); gr.addColorStop(1, '#1a1c24');
  g.fillStyle = gr; g.fillRect(0, 0, S, S); g.fillStyle = '#c9952e'; g.fillRect(0, 0, S, 4); g.fillRect(0, S - 4, S, 4);
  return tex(cv);
});
// One slot machine screen: three reels of symbols in a lit frame.
function slotScreenTex(seed) {
  const W = 128, H = 160, [cv, g] = canvas(W, H), rng = mulberry32(seed);
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#ff3a8a'); gr.addColorStop(1, '#7a2aff');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff6d8'; g.fillRect(10, 36, W - 20, 70);
  const sym = ['7', '$', 'BAR', '♥', '★', '♦'], cols = ['#d4142a', '#0a8a3a', '#1a1a1a', '#d4142a', '#e8a800', '#2a5ad4'];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k < 3; k++) {
    const i = (rng() * sym.length) | 0;
    g.fillStyle = cols[i]; g.font = 'bold ' + (sym[i].length > 1 ? 16 : 30) + 'px sans-serif';
    g.fillText(sym[i], 10 + (W - 20) * (k + 0.5) / 3, 71);
    if (k) { g.fillStyle = '#999'; g.fillRect(10 + (W - 20) * k / 3 - 1, 38, 2, 66); }
  }
  g.fillStyle = '#ffe680'; g.font = 'bold 18px sans-serif'; g.fillText('JACKPOT', W / 2, 20);
  for (let i = 0; i < 5; i++) { g.fillStyle = ['#ff5050', '#50ff80', '#5080ff', '#ffe050', '#ff80ff'][i]; g.beginPath(); g.arc(18 + i * 23, 128, 7, 0, 6.3); g.fill(); }
  const t = tex(cv, false); return t;
}
function neonTex(text, color) {
  const W = 1024, H = 192, [cv, g] = canvas(W, H);
  g.fillStyle = '#05030a'; g.fillRect(0, 0, W, H);
  g.font = 'bold 110px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 40; g.fillStyle = color; g.fillText(text, W / 2, H / 2 + 6);
  g.shadowBlur = 12; g.fillStyle = '#fff'; g.fillText(text, W / 2, H / 2 + 6);
  g.lineWidth = 6; g.strokeStyle = color; g.shadowBlur = 30; g.strokeRect(14, 14, W - 28, H - 28);
  return tex(cv, false);
}

/* ---------- School ---------- */
const linoTex = memo(() => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(41);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#d8d2c2' : '#8e9aa6'; g.fillRect(x * 64, y * 64, 64, 64); }
  speckle(g, S, S, 1200, rng, ['#6a6a6a', '#f4f0e6', '#a8a094'], 1.2, 0.3);
  g.strokeStyle = 'rgba(80,80,80,0.35)'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, S); g.moveTo(0, i * 64); g.lineTo(S, i * 64); g.stroke(); }
  return tex(cv);
});
const schoolWallTex = memo(() => {
  const W = 256, H = 512, [cv, g] = canvas(W, H), rng = mulberry32(42);
  g.fillStyle = '#ece4cf'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3f6a9a'; g.fillRect(0, H * 0.62, W, H * 0.38);
  g.fillStyle = '#e8b530'; g.fillRect(0, H * 0.6, W, H * 0.03);
  speckle(g, W, H, 300, rng, ['#d8d0bb', '#355a84'], 2, 0.15);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(W - 3, 0, 3, H);
  return tex(cv);
});
const lockerTex = memo(() => {
  const W = 256, H = 256, [cv, g] = canvas(W, H);
  for (let x = 0; x < W; x += 64) {
    g.fillStyle = '#2e6fb0'; g.fillRect(x, 0, 64, H);
    g.fillStyle = '#1d4c7c'; g.fillRect(x, 0, 3, H);
    g.fillStyle = '#163a60'; for (let y = 16; y < 64; y += 8) g.fillRect(x + 16, y, 32, 3);   // vents
    g.fillStyle = '#c8ccd2'; g.fillRect(x + 50, H * 0.5, 6, 22);                              // handle
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 6, 0, 8, H);
  }
  return tex(cv);
});
const deskTex = memo(() => {
  const S = 128, [cv, g] = canvas(S, S), rng = mulberry32(43);
  g.fillStyle = '#c8a070'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(120,80,40,0.2)'; g.fillRect(0, rng() * S, S, 1); }
  return tex(cv);
});
function boardTex(kind) {
  const W = 512, H = 256, [cv, g] = canvas(W, H), rng = mulberry32(kind === 'white' ? 44 : 45);
  if (kind === 'white') {
    g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, W, H); g.strokeStyle = '#9aa0a6'; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
    g.fillStyle = '#2a4a9a'; g.font = '30px sans-serif'; g.fillText('a² + b² = c²', 40, 70); g.fillText('Recoil = sprayPath x 1.8', 40, 120);
    g.fillStyle = '#c0282a'; g.fillText('Test on Friday!', 40, 190);
  } else {
    g.fillStyle = '#b07a46'; g.fillRect(0, 0, W, H); speckle(g, W, H, 800, rng, ['#8a5a30', '#c89060'], 2, 0.4);
    for (let i = 0; i < 9; i++) { g.fillStyle = ['#fff7a0', '#a0e0ff', '#ffb0c0', '#ffffff'][i % 4]; const x = 20 + (i % 5) * 96, y = 20 + Math.floor(i / 5) * 116; g.fillRect(x, y, 80, 96); g.fillStyle = '#d02020'; g.beginPath(); g.arc(x + 40, y + 6, 5, 0, 6.3); g.fill(); }
  }
  return tex(cv, false);
}
const vendingTex = memo(() => {
  const W = 128, H = 256, [cv, g] = canvas(W, H);
  g.fillStyle = '#c0202a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#101418'; g.fillRect(10, 20, 80, 180);
  const cols = ['#ff4040', '#40a0ff', '#ffd040', '#40ff80', '#ff80ff'];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) { g.fillStyle = cols[(r + c) % 5]; g.fillRect(16 + c * 19, 28 + r * 28, 12, 20); }
  g.fillStyle = '#e8e8e8'; g.fillRect(96, 40, 24, 60); g.fillStyle = '#202020'; g.fillRect(14, 214, 72, 24);
  return tex(cv, false);
});

/* ---------- the maps ---------- */
// Layout entries: { x, z, w, d, h, kind, mirror (default true) }. Kinds: { map, color, rough,
// metal, tile } for the box material; decor(ctx, b) adds non-blocking detail.
export const MAPS = {
  yard: {
    name: 'Container Yard', hx: 18, hz: 14, wallH: 4.5,
    sky: duskSky, background: 0x241a16, fog: [0x5a4038, 40, 110],
    hemi: [0xc0c8dc, 0x4a3a30, 1.8], key: [0xffd8b0, 1.6, [-14, 22, 10]],
    floor: () => { const t = concreteTiles(); return { map: t.map, normal: t.normal, rough: t.rough, tile: 2, color: 0xb8b4ae }; },
    wall: () => { const t = wallPanels(); return { map: t.map, normal: t.normal, tileW: 1.2, tileH: 3.6, rough: 0.6, metal: 0.5 }; },
    kinds: {
      container: { map: containerTex, tile: 1, rough: 0.55, metal: 0.6 },
      crate: { map: crateTex, tile: 1.2, rough: 0.85 },
      wall: { map: () => wallPanels().map, color: 0xc4c8cc, rough: 0.6, metal: 0.5, tile: 1 },
      low: { map: concreteTex, rough: 0.95 },
      barrier: { map: concreteTex, color: 0xe4e0d8, rough: 0.9, decor: (ctx, b) => ctx.box({ map: hazardStripes, tile: 0.5, rough: 0.6 }, b.w + 0.01, 0.12, b.d + 0.01, b.x, b.h - 0.12, b.z) },
    },
    layout: [
      { x: 0, z: 0, w: 6, d: 2.4, h: 2.6, kind: 'container', color: 0x8a3a2a, mirror: false },
      { x: -4.5, z: 3.5, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' }, { x: -3.3, z: 3.5, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
      { x: 7.5, z: 1.5, w: 0.4, d: 4, h: 2.6, kind: 'wall' },
      { x: -9, z: 6.5, w: 4, d: 0.4, h: 1.0, kind: 'low' }, { x: 9, z: 6.5, w: 4, d: 0.4, h: 1.0, kind: 'low' }, { x: 0, z: 8, w: 5, d: 0.4, h: 1.0, kind: 'low' },
      { x: -12.5, z: 9.5, w: 2.4, d: 6, h: 2.6, kind: 'container', color: 0x2d4f7a },
      { x: 13.5, z: 2.5, w: 0.4, d: 5, h: 2.6, kind: 'wall' },
      { x: 14, z: 11, w: 3, d: 0.6, h: 1.1, kind: 'barrier' }, { x: 5, z: 11, w: 2, d: 0.6, h: 1.1, kind: 'barrier' },
      { x: 2.5, z: 11, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: 9, z: 3, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
      { x: -7, z: 10.5, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' }, { x: -15.5, z: 2, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
      { x: 3.5, z: 4.8, w: 2.4, d: 0.6, h: 1.1, kind: 'barrier' },
    ],
    spawns: [[-10, 12.5], [0, 12.8], [10, 12.5], [16, 8], [-16, 6]],
  },

  winter: {
    name: 'Winter Cabin', hx: 18, hz: 14, wallH: 1.6,
    sky: winterSky, background: 0xdfe8f2, fog: [0xd6e2ee, 22, 80],
    hemi: [0xdfe9ff, 0x8a96a8, 2.0], key: [0xfff1dc, 1.5, [10, 20, -8]],
    floor: () => ({ map: snowTex(), tile: 6, rough: 0.9 }),
    wall: () => ({ map: plankTex(), tileW: 2, tileH: 1.6, rough: 0.85 }),
    kinds: {
      cabin: { map: logTex, tile: 2.4, rough: 0.85,
        decor: (ctx, b) => {
          // Roof: two slopes with snow, and a stone chimney.
          const rh = b.w * 0.32, len = Math.hypot(b.w / 2 + 0.4, rh);
          for (const s of [-1, 1]) {
            const r = ctx.box({ color: 0x3a2a20, rough: 0.9 }, len, 0.14, b.d + 0.8, b.x + s * (b.w / 4 + 0.1), b.h + rh / 2, b.z);
            r.rotation.z = -s * Math.atan2(rh, b.w / 2 + 0.4);
            const sn = ctx.box({ color: 0xf2f6fb, rough: 0.8 }, len, 0.08, b.d + 0.84, b.x + s * (b.w / 4 + 0.1), b.h + rh / 2 + 0.1, b.z);
            sn.rotation.z = r.rotation.z;
          }
          ctx.box({ color: 0x77706a, rough: 0.95 }, 0.7, 1.8, 0.7, b.x + b.w * 0.28, b.h + rh * 0.6, b.z + b.d * 0.2);
          // A door and lit windows.
          ctx.plane({ color: 0x4a2c18 }, 1.0, 2.0, b.x, 1.0, b.z + b.d / 2 + 0.01);
          for (const s of [-1, 1]) ctx.plane({ emissive: 0xffc070 }, 0.9, 0.7, b.x + s * b.w * 0.3, 1.5, b.z + b.d / 2 + 0.01);
          for (const s of [-1, 1]) ctx.plane({ emissive: 0xffc070 }, 0.9, 0.7, b.x + s * b.w * 0.3, 1.5, b.z - b.d / 2 - 0.01, Math.PI);
        } },
      shed: { map: plankTex, tile: 2, rough: 0.85, decor: (ctx, b) => ctx.box({ color: 0xf2f6fb, rough: 0.8 }, b.w + 0.3, 0.2, b.d + 0.3, b.x, b.h + 0.1, b.z) },
      logs: { map: woodpileTex, tile: 1, rough: 0.9, decor: (ctx, b) => ctx.box({ color: 0xf2f6fb, rough: 0.8 }, b.w, 0.08, b.d, b.x, b.h + 0.04, b.z) },
      snowbank: { map: snowTex, tile: 3, rough: 0.9, color: 0xf6f9fd },
      fence: { map: plankTex, tile: 1.5, rough: 0.85 },
      crate: { map: crateTex, tile: 1.2, rough: 0.85, decor: (ctx, b) => ctx.box({ color: 0xf2f6fb, rough: 0.8 }, b.w, 0.08, b.d, b.x, b.h + 0.04, b.z) },
      tree: { map: barkTex, tile: 1, rough: 0.95,
        decor: (ctx, b) => {
          for (let i = 0; i < 4; i++) {
            const r = 1.6 - i * 0.32, h = 1.5 - i * 0.15, y = b.h - 0.6 + i * 1.0;
            ctx.cone({ color: 0x1e4a2c, rough: 0.9 }, r, h, b.x, y + h / 2, b.z);
            ctx.cone({ color: 0xf2f6fb, rough: 0.85 }, r * 0.75, h * 0.35, b.x, y + h * 0.82, b.z);
          }
        } },
    },
    layout: [
      { x: 0, z: 0, w: 7, d: 4.5, h: 3.0, kind: 'cabin', mirror: false },
      { x: 5.5, z: 4.2, w: 2.4, d: 0.8, h: 1.0, kind: 'logs' },
      { x: -8, z: 6, w: 3.5, d: 1.2, h: 1.0, kind: 'snowbank' }, { x: 9, z: 8, w: 3, d: 1.1, h: 0.95, kind: 'snowbank' },
      { x: -12, z: 3, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' }, { x: 12.5, z: 1.5, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
      { x: -4, z: 10, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' }, { x: 15, z: 10.5, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
      { x: 2.5, z: 9, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
      { x: -2.5, z: 6.5, w: 4, d: 0.25, h: 1.1, kind: 'fence' },
      { x: 12, z: 6, w: 3, d: 2.4, h: 2.4, kind: 'shed' },
      { x: -14, z: 8, w: 1, d: 3, h: 1.0, kind: 'logs' },
    ],
    spawns: [[-10, 12.5], [0, 12.8], [8, 12.5], [16, 4], [-16, 5]],
    snow: true,
    outside: (ctx) => {             // pines beyond the fence
      const rng = mulberry32(77);
      for (let i = 0; i < 40; i++) {
        const a = rng() * Math.PI * 2, r = 24 + rng() * 25, x = Math.cos(a) * r * 1.1, z = Math.sin(a) * r;
        const h = 5 + rng() * 6;
        ctx.cone({ color: 0x1b3f28, rough: 0.9 }, 1.6 + rng(), h, x, h / 2, z);
        ctx.cone({ color: 0xeef3f8, rough: 0.9 }, 1.0, h * 0.3, x, h * 0.86, z);
      }
    },
  },

  casino: {
    name: "Jesse's Casino", hx: 16, hz: 12, wallH: 5, indoor: true,
    background: 0x0b0710, fog: [0x140a12, 30, 70],
    hemi: [0xffe0c0, 0x40101a, 1.7], key: [0xffe6c0, 1.2, [4, 20, 6]],
    floor: () => ({ map: carpetTex(), tile: 2.5, rough: 0.95 }),
    wall: () => ({ map: woodPanelTex(), tileW: 2, tileH: 5, rough: 0.5, metal: 0.2 }),
    ceiling: { color: 0x1a0c10 },
    kinds: {
      slots: { map: cabinetTex, tile: 1, rough: 0.4, metal: 0.5,
        decor: (ctx, b) => {
          // a row of machines: lit screens on both long sides, a light on top of each
          const n = Math.max(1, Math.round(b.w / 1.2));
          for (let i = 0; i < n; i++) {
            const x = b.x - b.w / 2 + (i + 0.5) * b.w / n;
            for (const s of [-1, 1]) ctx.plane({ emissiveMap: slotScreenTex(1000 + i * 7 + (s > 0 ? 3 : 0) + Math.round(b.x * 13 + b.z * 7)) }, b.w / n * 0.8, 1.0, x, 1.25, b.z + s * (b.d / 2 + 0.01), s > 0 ? 0 : Math.PI);
            ctx.cone({ emissive: [0xff3050, 0x30ff80, 0xffd040, 0x40a0ff][i % 4] }, 0.12, 0.25, x, b.h + 0.12, b.z);
          }
        } },
      cardtable: { map: feltTex, tile: 2.4, rough: 0.95,
        decor: (ctx, b) => ctx.box({ color: 0x4a2412, rough: 0.5, metal: 0.1 }, b.w + 0.16, 0.1, b.d + 0.16, b.x, b.h - 0.03, b.z) },
      roulette: { map: feltTex, tile: 2.6, rough: 0.95,
        decor: (ctx, b) => {
          ctx.cylinder({ color: 0x5a2a12, rough: 0.4, metal: 0.2 }, 0.8, 0.12, b.x, b.h + 0.06, b.z);
          ctx.cylinder({ color: 0xc9952e, rough: 0.25, metal: 1 }, 0.55, 0.14, b.x, b.h + 0.1, b.z);
          ctx.cylinder({ color: 0x8a1020, rough: 0.4 }, 0.45, 0.15, b.x, b.h + 0.11, b.z);
        } },
      bar: { map: woodPanelTex, tile: 2, rough: 0.4, metal: 0.2,
        decor: (ctx, b) => ctx.box({ color: 0x14100c, rough: 0.15, metal: 0.3 }, b.w + 0.2, 0.08, b.d + 0.2, b.x, b.h, b.z) },
      pillar: { color: 0xc9952e, rough: 0.25, metal: 1, map: cabinetTex, tile: 5 },
      cage: { color: 0xc9952e, rough: 0.3, metal: 1, map: cabinetTex, tile: 1 },
    },
    layout: [
      { x: 0, z: 0, w: 2.6, d: 2.6, h: 1.0, kind: 'roulette', mirror: false },
      { x: -8, z: 5, w: 4.8, d: 0.9, h: 1.9, kind: 'slots' }, { x: 8, z: 5, w: 4.8, d: 0.9, h: 1.9, kind: 'slots' },
      { x: -3, z: 8.5, w: 2.4, d: 1.4, h: 0.9, kind: 'cardtable' }, { x: 5, z: 9, w: 2.4, d: 1.4, h: 0.9, kind: 'cardtable' },
      { x: -14.4, z: 7, w: 0.9, d: 4, h: 1.15, kind: 'bar' },
      { x: 5, z: 2.5, w: 0.9, d: 0.9, h: 5, kind: 'pillar' }, { x: -5, z: 2.5, w: 0.9, d: 0.9, h: 5, kind: 'pillar' },
      { x: 12.5, z: 1, w: 1, d: 3, h: 2.4, kind: 'cage' },
      { x: 11, z: 9, w: 1.2, d: 1.2, h: 1.9, kind: 'slots' },
    ],
    spawns: [[-10, 10.8], [0, 11], [10, 11], [14.5, 6], [-11, 5.5]],
    extra: (ctx, map) => {
      // Neon signs on both end walls, chandeliers.
      for (const [z, ry] of [[-map.hz + 0.02, 0], [map.hz - 0.02, Math.PI]]) ctx.plane({ emissiveMap: neonTex("JESSE'S CASINO", '#ff2fa8') }, 8, 1.5, 0, 3.6, z, ry);
      for (const [x, z] of [[-6, 0], [6, 0], [0, 7], [0, -7], [-10, -6], [10, 6]]) {
        ctx.cylinder({ color: 0xc9952e, rough: 0.3, metal: 1 }, 0.5, 0.12, x, map.wallH - 0.5, z);
        ctx.cone({ emissive: 0xfff0c0 }, 0.45, 0.5, x, map.wallH - 0.85, z, Math.PI);
      }
    },
  },

  school: {
    name: 'School', hx: 17, hz: 12, wallH: 3.6, indoor: true,
    background: 0x20242a, fog: [0x30343a, 40, 90],
    hemi: [0xfafcff, 0x8a8278, 2.0], key: [0xffffff, 1.0, [-6, 20, 4]],
    floor: () => ({ map: linoTex(), tile: 2, rough: 0.55 }),
    wall: () => ({ map: schoolWallTex(), tileW: 2, tileH: 3.6, rough: 0.8 }),
    ceiling: { color: 0xd8d8d2, lights: 0xf4f8ff },
    kinds: {
      lockers: { map: lockerTex, tile: 1, rough: 0.5, metal: 0.6 },
      desk: { map: deskTex, tile: 1, rough: 0.6,
        decor: (ctx, b) => ctx.box({ color: 0x2a5a8a, rough: 0.6 }, 0.42, 0.45, 0.42, b.x, 0.22, b.z + b.d / 2 + 0.35) },   // a chair
      bigdesk: { map: deskTex, tile: 1.8, rough: 0.6 },
      cafetable: { map: deskTex, tile: 1.5, color: 0xd8d0c0, rough: 0.5,
        decor: (ctx, b) => { for (const s of [-1, 1]) ctx.box({ color: 0x6a7480, rough: 0.5, metal: 0.4 }, b.w, 0.06, 0.32, b.x, 0.45, b.z + s * (b.d / 2 + 0.3)); } },
      case: { color: 0x6a4a2a, map: deskTex, tile: 1, rough: 0.5,
        decor: (ctx, b) => { for (let i = 0; i < 4; i++) ctx.cylinder({ color: 0xd8b040, rough: 0.25, metal: 1 }, 0.09, 0.3, b.x - b.w / 2 + 0.4 + i * (b.w - 0.8) / 3, b.h + 0.15, b.z); } },
      vending: { color: 0xc0202a, rough: 0.4, metal: 0.3, map: cabinetTex, tile: 2,
        decor: (ctx, b) => { for (const s of [-1, 1]) ctx.plane({ emissiveMap: vendingTex() }, b.w * 0.9, b.h * 0.9, b.x, b.h / 2, b.z + s * (b.d / 2 + 0.01), s > 0 ? 0 : Math.PI); } },
    },
    layout: [
      { x: 0, z: 0, w: 2, d: 0.9, h: 2, kind: 'vending', mirror: false },
      { x: -7, z: 5.5, w: 5, d: 0.6, h: 2.0, kind: 'lockers' }, { x: 7, z: 3.5, w: 5, d: 0.6, h: 2.0, kind: 'lockers' },
      { x: -13, z: 9, w: 1.2, d: 0.7, h: 0.78, kind: 'desk' }, { x: -11, z: 9, w: 1.2, d: 0.7, h: 0.78, kind: 'desk' }, { x: -9, z: 9, w: 1.2, d: 0.7, h: 0.78, kind: 'desk' },
      { x: -13, z: 7, w: 1.2, d: 0.7, h: 0.78, kind: 'desk' }, { x: -11, z: 7, w: 1.2, d: 0.7, h: 0.78, kind: 'desk' },
      { x: 3, z: 9, w: 1.8, d: 0.9, h: 0.8, kind: 'bigdesk' },
      { x: 10, z: 9, w: 3, d: 1, h: 0.8, kind: 'cafetable' }, { x: 13, z: 6.5, w: 3, d: 1, h: 0.8, kind: 'cafetable' },
      { x: 0, z: 4.5, w: 3, d: 0.6, h: 1.9, kind: 'case' },
      { x: 15.5, z: 1.5, w: 0.6, d: 4, h: 2.0, kind: 'lockers' },
    ],
    spawns: [[-6, 11], [0, 11], [7, 11], [15, 9.5], [-15.5, 4]],
    extra: (ctx, map) => {
      // Whiteboards and noticeboards on the walls.
      for (const [x, z, ry, k] of [[-8, -map.hz + 0.02, 0, 'white'], [8, map.hz - 0.02, Math.PI, 'white'], [6, -map.hz + 0.02, 0, 'cork'], [-6, map.hz - 0.02, Math.PI, 'cork']]) {
        ctx.plane({ map: boardTex(k), basic: true }, 4, 1.6, x, 1.8, z, ry);
      }
    },
  },
};
export const MAP_IDS = Object.keys(MAPS);
