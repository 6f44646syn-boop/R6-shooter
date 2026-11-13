// Battle maps. Each map is data: size, floor, walls, sky or ceiling, lights, cover pieces
// (kinds: how a piece looks, plus decoration that does not block), the layout, spawns for
// each side and extras.
//
//   Container Yard  - a dock (north) and a depot with a raised loading dock (south)
//   Winter Cabin    - a cabin you can walk into, a snowy hill with slopes, a lookout deck
//   Jesse's Casino  - two floors: a VIP mezzanine (stairs) and a back balcony (ramp)
//   School Basement - dark, flickering, with acid pools, catwalks and a boiler room
//
// Each side is laid out differently.
//
// Everything is drawn in code (canvas textures); no image files.
import * as THREE from '../../vendor/three/three.module.min.js?v=b95fbae-mwewwzt6';
import { concreteTiles, wallPanels, duskSky, hazardStripes } from '../scene/range-tex.js?v=b95fbae-mwewwzt6';
import { mulberry32 } from '../core/prng.js?v=b95fbae-mwewwzt6';

/* ---------- texture helpers ---------- */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(cv, repeat = true) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// Enhanced Graphics pack v5: the pack's physically based material for each of these textures
// (tools/hd/matgen.mjs; applied on High / Ultra by js/render/pack-materials.js).
const PACK_SURFACE = {
  crateTex: 'crate', containerTex: 'bContainer', concreteTex: 'concrete', snowTex: 'bSnow', logTex: 'bLogs', plankTex: 'bPlank', barkTex: 'bark',
  carpetTex: 'bCasinocarpet', woodPanelTex: 'bWoodpanel', feltTex: 'bFelt', linoTex: 'bLino', schoolWallTex: 'bSchoolwall', lockerTex: 'bLockers',
  deskTex: 'tableTop', basementFloorTex: 'bBasement', blockWallTex: 'bBlockwall', rustTex: 'bRustmetal', gratingTex: 'bGrating', shelfTex: 'shelf',
};
const memo = (name, fn) => { let v = null; return () => { if (!v) { v = fn(); if (v && v.isTexture && PACK_SURFACE[name]) v.userData.surface = PACK_SURFACE[name]; } return v; }; };
function speckle(g, W, H, n, rng, cols, rMax = 3, aMax = 0.2) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = 0.05 + rng() * aMax; g.fillStyle = cols[(rng() * cols.length) | 0];
    g.beginPath(); g.arc(rng() * W, rng() * H, 0.5 + rng() * rMax, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

/* ---------- Container Yard (original) ---------- */
const crateTex = memo('crateTex', () => {
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
const containerTex = memo('containerTex', () => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(9);
  for (let x = 0; x < S; x++) { const l = 190 + Math.sin((x / S) * Math.PI * 8) * 45; g.fillStyle = 'rgb(' + (l | 0) + ',' + (l | 0) + ',' + (l | 0) + ')'; g.fillRect(x, 0, 1, S); }
  for (let i = 0; i < 40; i++) {
    const x = rng() * S, y = rng() * S * 0.7, h = 20 + rng() * 80, gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, 'rgba(90,50,20,0.35)'); gr.addColorStop(1, 'rgba(90,50,20,0)'); g.fillStyle = gr; g.fillRect(x, y, 2 + rng() * 4, h);
  }
  return tex(cv);
});
const concreteTex = memo('concreteTex', () => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(13);
  g.fillStyle = '#b9b5ad'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 900, rng, ['#8a867e', '#d8d4cc', '#a09a90'], 4, 0.25);
  g.fillStyle = 'rgba(60,58,54,0.5)'; g.fillRect(0, S / 2 - 1, S, 2); g.fillRect(S - 2, 0, 2, S);
  return tex(cv);
});

/* ---------- Winter Cabin ---------- */
const snowTex = memo('snowTex', () => {
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
const logTex = memo('logTex', () => {
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
const plankTex = memo('plankTex', () => {
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
const barkTex = memo('barkTex', () => {
  const W = 128, H = 256, [cv, g] = canvas(W, H), rng = mulberry32(24);
  g.fillStyle = '#4a3322'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(25,16,10,0.6)' : 'rgba(110,80,55,0.4)'; g.fillRect(rng() * W, rng() * H, 2 + rng() * 4, 20 + rng() * 60); }
  return tex(cv);
});
const woodpileTex = memo('woodpileTex', () => {
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
const winterSky = memo('winterSky', () => {
  const W = 512, H = 256, [cv, g] = canvas(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#6f8fb8'); gr.addColorStop(0.45, '#b8cde4'); gr.addColorStop(0.52, '#dfe8f2'); gr.addColorStop(1, '#eef3f8');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const rng = mulberry32(26);
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.1 + rng() * 0.2) + ')'; g.beginPath(); g.ellipse(rng() * W, H * (0.1 + rng() * 0.3), 40 + rng() * 120, 6 + rng() * 10, 0, 0, 6.3); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
});

/* ---------- Jesse's Casino ---------- */
const carpetTex = memo('carpetTex', () => {
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
const woodPanelTex = memo('woodPanelTex', () => {
  const W = 256, H = 512, [cv, g] = canvas(W, H), rng = mulberry32(32);
  g.fillStyle = '#3a1d10'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(' + (rng() < 0.5 ? '20,8,4' : '90,46,24') + ',0.3)'; g.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 40 + rng() * 120); }
  g.strokeStyle = '#c9952e'; g.lineWidth = 4; g.strokeRect(16, 40, W - 32, H * 0.45);
  g.strokeRect(16, H * 0.55, W - 32, H * 0.38);
  g.fillStyle = '#d6a43a'; g.fillRect(0, H * 0.5 - 5, W, 10);
  return tex(cv);
});
const feltTex = memo('feltTex', () => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(33);
  g.fillStyle = '#0d6a3a'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 900, rng, ['#0a5a30', '#118048'], 1.5, 0.3);
  g.strokeStyle = 'rgba(240,220,150,0.7)'; g.lineWidth = 3; g.beginPath(); g.arc(S / 2, S * 0.1, S * 0.6, 0.3, Math.PI - 0.3); g.stroke();
  return tex(cv);
});
const cabinetTex = memo('cabinetTex', () => {
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
// All slot screens on one texture sheet (4 x 4): one material, so every screen in a chunk of
// the map merges into a single draw.
const slotAtlas = memo('slotAtlas', () => {
  const W = 128, H = 160, [cv, g] = canvas(W * 4, H * 4);
  for (let i = 0; i < 16; i++) g.drawImage(slotScreenTex(1000 + i * 37).image, (i % 4) * W, Math.floor(i / 4) * H);
  return tex(cv, false);
});
const slotCell = (seed) => { const i = Math.abs(seed) % 16; return [(i % 4) / 4, 1 - (Math.floor(i / 4) + 1) / 4, (i % 4 + 1) / 4, 1 - Math.floor(i / 4) / 4]; };
const neonSign = memo('neonSign', () => neonTex("JESSE'S CASINO", '#ff2fa8'));
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
const linoTex = memo('linoTex', () => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(41);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#d8d2c2' : '#8e9aa6'; g.fillRect(x * 64, y * 64, 64, 64); }
  speckle(g, S, S, 1200, rng, ['#6a6a6a', '#f4f0e6', '#a8a094'], 1.2, 0.3);
  g.strokeStyle = 'rgba(80,80,80,0.35)'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, S); g.moveTo(0, i * 64); g.lineTo(S, i * 64); g.stroke(); }
  return tex(cv);
});
const schoolWallTex = memo('schoolWallTex', () => {
  const W = 256, H = 512, [cv, g] = canvas(W, H), rng = mulberry32(42);
  g.fillStyle = '#ece4cf'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#3f6a9a'; g.fillRect(0, H * 0.62, W, H * 0.38);
  g.fillStyle = '#e8b530'; g.fillRect(0, H * 0.6, W, H * 0.03);
  speckle(g, W, H, 300, rng, ['#d8d0bb', '#355a84'], 2, 0.15);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(W - 3, 0, 3, H);
  return tex(cv);
});
const lockerTex = memo('lockerTex', () => {
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
const deskTex = memo('deskTex', () => {
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
const vendingTex = memo('vendingTex', () => {
  const W = 128, H = 256, [cv, g] = canvas(W, H);
  g.fillStyle = '#c0202a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#101418'; g.fillRect(10, 20, 80, 180);
  const cols = ['#ff4040', '#40a0ff', '#ffd040', '#40ff80', '#ff80ff'];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) { g.fillStyle = cols[(r + c) % 5]; g.fillRect(16 + c * 19, 28 + r * 28, 12, 20); }
  g.fillStyle = '#e8e8e8'; g.fillRect(96, 40, 24, 60); g.fillStyle = '#202020'; g.fillRect(14, 214, 72, 24);
  return tex(cv, false);
});

/* ---------- School Basement ---------- */
const basementFloorTex = memo('basementFloorTex', () => {
  const S = 512, [cv, g] = canvas(S, S), rng = mulberry32(51);
  g.fillStyle = '#4a4d48'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 3000, rng, ['#3a3c38', '#5a5d57', '#2e302c'], 3, 0.3);
  for (let i = 0; i < 26; i++) {                       // damp stains
    const x = rng() * S, y = rng() * S, r = 20 + rng() * 80, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(20,30,18,0.45)'); gr.addColorStop(1, 'rgba(20,30,18,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(20,20,18,0.6)'; g.lineWidth = 2;
  for (let i = 0; i < 14; i++) { g.beginPath(); let x = rng() * S, y = rng() * S; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 60; y += (rng() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, S / 2 - 1, S, 2); g.fillRect(S / 2 - 1, 0, 2, S);
  return tex(cv);
});
const blockWallTex = memo('blockWallTex', () => {
  const W = 256, H = 512, [cv, g] = canvas(W, H), rng = mulberry32(52);
  for (let y = 0; y < H; y += 32) for (let x = -((y / 32) % 2) * 32; x < W; x += 64) {
    const l = 0.85 + rng() * 0.2, low = y > H * 0.55;
    g.fillStyle = low ? 'rgb(' + ((46 * l) | 0) + ',' + ((84 * l) | 0) + ',' + ((60 * l) | 0) + ')' : 'rgb(' + ((150 * l) | 0) + ',' + ((150 * l) | 0) + ',' + ((140 * l) | 0) + ')';
    g.fillRect(x + 1, y + 1, 62, 30);
  }
  g.fillStyle = '#e8c040'; g.fillRect(0, H * 0.55 - 6, W, 6);
  speckle(g, W, H, 900, rng, ['#202420', '#606860'], 2, 0.3);
  for (let i = 0; i < 10; i++) {                       // drips
    const x = rng() * W, gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(30,40,25,0.5)'); gr.addColorStop(1, 'rgba(30,40,25,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + rng() * 5, H * (0.3 + rng() * 0.6));
  }
  return tex(cv);
});
const rustTex = memo('rustTex', () => {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(53);
  g.fillStyle = '#5a5e60'; g.fillRect(0, 0, S, S);
  speckle(g, S, S, 1400, rng, ['#7a3a1a', '#9a5a2a', '#3a3c3e', '#6a6e70'], 5, 0.35);
  g.fillStyle = 'rgba(0,0,0,0.3)'; for (let y = 0; y < S; y += 64) g.fillRect(0, y, S, 3);
  return tex(cv);
});
const gratingTex = memo('gratingTex', () => {
  const S = 128, [cv, g] = canvas(S, S);
  g.fillStyle = '#2a2c2e'; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#7a7e82'; g.lineWidth = 3;
  for (let i = 0; i <= S; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); }
  g.lineWidth = 2; for (let i = 0; i <= S; i += 32) { g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  return tex(cv);
});
const shelfTex = memo('shelfTex', () => {
  const W = 256, H = 256, [cv, g] = canvas(W, H), rng = mulberry32(54);
  g.fillStyle = '#1a1c1a'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 64) {
    g.fillStyle = '#6a6e70'; g.fillRect(0, y + 58, W, 6);
    for (let x = 6; x < W - 20; x += 14 + rng() * 20) {          // boxes and jars
      const h = 18 + rng() * 34, w = 10 + rng() * 22;
      g.fillStyle = ['#8a6a43', '#a08050', '#3a7a4a', '#c0c0b0', '#6a4a2a', '#2a8a5a'][(rng() * 6) | 0];
      g.fillRect(x, y + 58 - h, w, h);
      if (rng() < 0.3) { g.fillStyle = 'rgba(120,255,140,0.6)'; g.fillRect(x + 2, y + 58 - h * 0.6, w - 4, h * 0.5); }
    }
  }
  return tex(cv);
});
function acidTex(seed, bright) {
  const S = 256, [cv, g] = canvas(S, S), rng = mulberry32(seed);
  g.fillStyle = bright ? '#000000' : '#1f8a1a'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < (bright ? 90 : 160); i++) {
    const x = rng() * S, y = rng() * S, r = bright ? 2 + rng() * 9 : 10 + rng() * 40;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      if (bright) { gr.addColorStop(0, 'rgba(220,255,160,0.9)'); gr.addColorStop(0.5, 'rgba(120,255,80,0.5)'); gr.addColorStop(1, 'rgba(60,255,40,0)'); }
      else { const c = rng() < 0.5 ? '120,255,60' : '20,90,10'; gr.addColorStop(0, 'rgba(' + c + ',0.5)'); gr.addColorStop(1, 'rgba(' + c + ',0)'); }
      g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  const t = tex(cv); return t;
}
const acidLook = memo('acidLook', () => ({ map: acidTex(61, false), map2: acidTex(62, true) }));

/* ---------- layout helpers ---------- */
// A wall from a to b along x (at z) or along z (at x), thickness th, height h, with openings
// [{ from, to, lo, hi }] (doors: lo 0; windows: lo ~1). Returns box layout entries.
function wallWithGaps(axis, a, b, at, th, h, kind, gaps, y = 0) {
  const cuts = [a, b, ...gaps.flatMap((g) => [g.from, g.to])].sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s0 = cuts[i], s1 = cuts[i + 1];
    if (s1 - s0 < 1e-3) continue;
    const mid = (s0 + s1) / 2, g = gaps.find((gg) => mid > gg.from && mid < gg.to);
    const parts = g ? [[0, g.lo], [g.hi, h]] : [[0, h]];
    for (const [lo, hi] of parts) {
      if (hi - lo < 1e-3) continue;
      const e = { w: axis === 'x' ? s1 - s0 : th, d: axis === 'x' ? th : s1 - s0, h: hi - lo, y: y + lo, kind };
      if (axis === 'x') { e.x = mid; e.z = at; } else { e.x = at; e.z = mid; }
      out.push(e);
    }
  }
  return out;
}
// Railing along an edge: a low solid parapet (cover you can shoot over).
const rail = (x, z, w, d, y, kind = 'rail', h = 1.05) => ({ x, z, w, d, h, y, kind });

// A rectangle minus holes, as a few rectangles (for a floor with stairwells and an atrium).
function rectMinus(x0, x1, z0, z1, holes) {
  const xs = [...new Set([x0, x1, ...holes.flatMap((h) => [h[0], h[1]]).filter((v) => v > x0 && v < x1)])].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1], m = (a + b) / 2;
    const cuts = holes.filter((h) => m > h[0] && m < h[1]).map((h) => [Math.max(z0, h[2]), Math.min(z1, h[3])]).sort((p, q) => p[0] - q[0]);
    let z = z0;
    for (const [c0, c1] of cuts) { if (c0 > z + 1e-3) out.push([a, b, z, c0]); z = Math.max(z, c1); }
    if (z1 > z + 1e-3) out.push([a, b, z, z1]);
  }
  return out;
}
// Jesse's Casino: a ground floor split into rooms, and an upper floor over most of it
// (open only over the central atrium and two stairwells).
//   A side (north): bar lounge (west), slot hall (middle), VIP card room (east); back stairs.
//   B side (south): cashier cage (west, windows), high-stakes room (middle), slot alley (east);
//   a long ramp up.
function casinoLayout() {
  const FY = 3.35, FT = 0.25, UP = FY + FT, D = { lo: 0, hi: 2.3 }, W = { lo: 1.0, hi: 2.3 };   // windows tall enough to vault through
  const L = [];
  const wall = (axis, a, b, at, gaps, kind = 'room', h = FY, y = 0, th = 0.25) => L.push(...wallWithGaps(axis, a, b, at, th, h, kind, gaps, y));
  const gap = (from, to, g = D) => ({ from, to, ...g });
  // upper floor: atrium in the middle, the back stairwell (A) and the ramp well (B)
  const ATR = [-8, 8, -5, 5], WELL_A = [-21.6, -15.4, 12, 14.2], WELL_B = [11.9, 21.6, -14.2, -12];
  for (const [a, b, c, d] of rectMinus(-22, 22, -16, 16, [ATR, WELL_A, WELL_B])) L.push({ x: (a + b) / 2, z: (c + d) / 2, w: b - a, d: d - c, h: FT, y: FY, kind: 'slab' });
  // ways up: stairs from the atrium on both sides, back stairs (A), a ramp (B)
  L.push({ stairs: '+z', x: -6.5, z: 2, w: 2, d: 6, y1: UP, kind: 'stairs' });
  L.push({ stairs: '-z', x: 6.5, z: -2, w: 2, d: 6, y1: UP, kind: 'stairs' });
  L.push({ stairs: '+x', x: -18.5, z: 13.1, w: 6.2, d: 2.2, y1: UP, kind: 'stairs' });
  L.push({ ramp: '-x', x: 16.75, z: -13.1, w: 9.7, d: 2.2, y1: UP, kind: 'ramp' });
  // atrium railing on the upper floor (open where the stairs arrive)
  wall('x', -8, 8, 5.07, [gap(-7.6, -5.4, { lo: 0, hi: 9 })], 'rail', 1.05, UP, 0.14);
  wall('x', -8, 8, -5.07, [gap(5.4, 7.6, { lo: 0, hi: 9 })], 'rail', 1.05, UP, 0.14);
  wall('z', -5, 5, -8.07, [], 'rail', 1.05, UP, 0.14);
  wall('z', -5, 5, 8.07, [], 'rail', 1.05, UP, 0.14);
  wall('x', -21.6, -15.4, 11.93, [], 'rail', 1.05, UP, 0.14);
  wall('x', 11.9, 21.6, -11.93, [], 'rail', 1.05, UP, 0.14);
  // ground floor rooms (walls up to the upper floor; doors 2.3 m, cage windows)
  wall('x', -22, -8, 5, [gap(-19, -17.4), gap(-12, -10.4)]);                 // bar lounge
  wall('z', 5, 16, -8, [gap(8, 9.6), gap(12.5, 14.1)]);
  wall('x', 8, 22, 5, [gap(10.4, 12), gap(17.4, 19)]);                       // VIP card room
  wall('z', 5, 16, 8, [gap(10, 11.6)]);
  wall('x', -22, -8, -5, [gap(-20.5, -18.9), gap(-15, -11, W), gap(-10.6, -9)]);   // cashier cage
  wall('z', -16, -5, -8, [gap(-9, -7.4), gap(-13.5, -10.5, W)]);
  wall('x', -8, 8, -8.5, [gap(-5.8, -4.2), gap(2.2, 3.8)]);                  // high-stakes room
  // pillars holding the upper floor round the atrium
  for (const [x, z] of [[-8.3, -5.3], [8.3, -5.3], [-8.3, 5.3], [8.3, 5.3]]) L.push({ x, z, w: 0.6, d: 0.6, h: FY, kind: 'pillar' });
  // --- ground floor contents
  L.push({ x: 0, z: 0, w: 2.6, d: 2.6, h: 1.0, kind: 'roulette' });
  L.push({ x: -2.5, z: -3, w: 2.2, d: 1.2, h: 0.9, kind: 'cardtable' }, { x: 3, z: 3, w: 2.2, d: 1.2, h: 0.9, kind: 'cardtable' });
  L.push({ x: -20.6, z: 9.5, w: 0.9, d: 4, h: 1.15, kind: 'bar' }, { x: -14, z: 13.5, w: 2.4, d: 0.9, h: 0.8, kind: 'couch' }, { x: -12, z: 8.5, w: 1.6, d: 1.6, h: 0.9, kind: 'cardtable' });
  L.push({ x: -3, z: 9, w: 0.9, d: 5, h: 1.9, kind: 'slots' }, { x: 3, z: 11, w: 0.9, d: 5, h: 1.9, kind: 'slots' }, { x: 0, z: 15.3, w: 6, d: 0.9, h: 1.9, kind: 'slots' });
  L.push({ x: 13, z: 10, w: 2.4, d: 1.4, h: 0.9, kind: 'cardtable' }, { x: 18.5, z: 13, w: 2.4, d: 1.4, h: 0.9, kind: 'cardtable' }, { x: 20.8, z: 8, w: 1, d: 2.4, h: 1.9, kind: 'cage' });
  L.push({ x: -14, z: 2, w: 2.4, d: 1.4, h: 0.9, kind: 'cardtable' }, { x: -19, z: -1.5, w: 0.9, d: 4, h: 1.9, kind: 'slots' }, { x: -11, z: -2.5, w: 0.5, d: 0.5, h: FY, kind: 'pillar' });
  L.push({ x: 14, z: -1, w: 5, d: 0.9, h: 1.9, kind: 'slots' }, { x: 19, z: 2.5, w: 2.4, d: 1.4, h: 0.9, kind: 'cardtable' }, { x: 11, z: 2.5, w: 0.5, d: 0.5, h: FY, kind: 'pillar' });
  L.push({ x: -15, z: -9, w: 6, d: 0.9, h: 1.15, kind: 'bar' }, { x: -20.5, z: -13, w: 1, d: 3, h: 2.2, kind: 'cage' }, { x: -12, z: -14, w: 1.2, d: 1.2, h: 1.2, kind: 'cage' });
  L.push({ x: 0, z: -12.5, w: 3.6, d: 1.6, h: 0.9, kind: 'cardtable' }, { x: -5, z: -14.8, w: 2.4, d: 0.9, h: 0.8, kind: 'couch' }, { x: 5.5, z: -11, w: 1.6, d: 1.6, h: 0.9, kind: 'cardtable' });
  L.push({ x: 12, z: -8, w: 0.9, d: 4.5, h: 1.9, kind: 'slots' }, { x: 16, z: -8, w: 0.9, d: 4.5, h: 1.9, kind: 'slots' }, { x: 20, z: -8, w: 0.9, d: 4.5, h: 1.9, kind: 'slots' });
  // --- upper floor: partitions and furniture for cover (different on each side)
  const U = (o) => L.push({ ...o, y: UP });
  U({ x: -13, z: 8.5, w: 0.25, d: 6, h: 2.2, kind: 'partition' }); U({ x: 0, z: 11, w: 9, d: 0.25, h: 2.2, kind: 'partition' });
  U({ x: 13, z: 9, w: 6, d: 0.25, h: 2.2, kind: 'partition' }); U({ x: 18, z: 4, w: 0.9, d: 3, h: 1.9, kind: 'slots' });
  U({ x: -6, z: 14.5, w: 3, d: 0.9, h: 0.8, kind: 'couch' }); U({ x: 7, z: 14, w: 2.4, d: 1.4, h: 0.9, kind: 'cardtable' }); U({ x: -18, z: 6, w: 2.4, d: 1.4, h: 0.9, kind: 'cardtable' });
  U({ x: -14, z: -1, w: 0.9, d: 4, h: 1.9, kind: 'slots' }); U({ x: 14, z: 1, w: 0.25, d: 5, h: 2.2, kind: 'partition' });
  U({ x: -10, z: -9, w: 0.25, d: 5, h: 2.2, kind: 'partition' }); U({ x: 2, z: -11, w: 8, d: 0.9, h: 1.9, kind: 'slots' });
  U({ x: 9, z: -8, w: 1.6, d: 1.6, h: 0.9, kind: 'cardtable' }); U({ x: -18, z: -12, w: 1.2, d: 3, h: 2.2, kind: 'cage' }); U({ x: -4, z: -14.8, w: 3, d: 0.9, h: 0.8, kind: 'couch' });
  U({ x: 19, z: -6, w: 2.6, d: 2.6, h: 1.0, kind: 'roulette' });
  return L;
}

/* ---------- the maps ---------- */
// Layout entries:
//   box:    { x, z, w, d, h, y (base, default 0), kind, color, hidden, noShadow }
//   stairs: { stairs: '+x' | '-x' | '+z' | '-z' (rising towards), x, z, w, d, y1, y (base level), rise }
//   ramp:   { ramp: '+x' | ..., x, z, w, d, y1, y }
// Kinds: { map, color, rough, metal, tile } for the material; decor(ctx, b) adds detail that
// does not block (ctx y is relative to the box base). Spawns: [x, z, y?] for each side.
// Casino light fittings: chandeliers under the high ceiling, downlights under the upper floor,
// wall sconces on the outer walls of both floors ([x, y, z])
const CASINO_CHANDELIERS = [[-4, 0], [4, 0], [-14, -10], [14, 10], [-14, 10], [14, -10]];
const casinoDownlights = () => { const o = []; for (let x = -19; x <= 19; x += 5) for (let z = -13; z <= 13; z += 4.5) if (!(Math.abs(x) < 8.5 && Math.abs(z) < 5.5)) o.push([x, z]); return o; };
const CASINO_SCONCES = [-17, -6, 6, 17].flatMap((x) => [[x, 2.3, -15.9], [x, 2.3, 15.9], [x, 5.9, -15.9], [x, 5.9, 15.9]]);
// School Basement strip lights ([x, z], on the ceiling)
const SCHOOL_LIGHTS = [[-23, 16], [-14, 12], [-4, 16], [6, 12], [16, 16], [24, 9], [-24, 1], [-12, -1], [0, 4], [12, -2], [24, -6], [-16, -10], [-4, -14], [8, -13], [20, -15], [-24, -16]];
const CABIN = { x: 0, z: -1, w: 9, d: 6.6, th: 0.35, h: 3.0 };
// Container Yard floodlight poles (against the fence)
const YARD_LAMPS = [[-25.6, 10], [25.6, -10], [-25.6, -12], [25.6, 12], [0, 19.6], [0, -19.6]];
// up to four drums in a box's footprint
const drumSpots = (b) => { const nx = Math.max(1, Math.round(b.w / 0.65)), nz = Math.max(1, Math.round(b.d / 0.65)), o = []; for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) o.push([(i - (nx - 1) / 2) * 0.62, (k - (nz - 1) / 2) * 0.62]); return o; };
const cabinWalls = (() => {
  const { x, z, w, d, th, h } = CABIN, x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  return [
    ...wallWithGaps('x', x0, x1, z1 - th / 2, th, h, 'logwall', [{ from: x - 2.9, to: x - 1.5, lo: 0, hi: 2.15 }, { from: x + 1.3, to: x + 2.7, lo: 1.0, hi: 2.25 }]),
    ...wallWithGaps('x', x0, x1, z0 + th / 2, th, h, 'logwall', [{ from: x + 1.8, to: x + 3.2, lo: 0, hi: 2.15 }, { from: x - 3.0, to: x - 1.6, lo: 1.0, hi: 2.25 }]),
    ...wallWithGaps('z', z0 + th, z1 - th, x0 + th / 2, th, h, 'logwall', [{ from: z - 0.7, to: z + 0.7, lo: 1.0, hi: 2.25 }]),
    ...wallWithGaps('z', z0 + th, z1 - th, x1 - th / 2, th, h, 'logwall', [{ from: z - 1.4, to: z + 0.2, lo: 1.0, hi: 2.25 }]),
  ];
})();

// What Winter Cabin and the School Basement gained when they grew (the small versions below
// leave these out).
const WINTER_RING = [
  // the outer ring (the map grew): north - a woodshed, woodpile, fence, rocks
  { x: -20, z: 19.5, w: 3.2, d: 2.6, h: 2.4, kind: 'shed' }, { x: -4, z: 19, w: 2.4, d: 0.8, h: 1.0, kind: 'logs' },
  { x: 10, z: 19, w: 5, d: 0.25, h: 1.1, kind: 'fence' }, { x: 22, z: 21, w: 3, d: 1.1, h: 1.0, kind: 'snowbank' },
  { x: -28, z: 20, w: 1.6, d: 1.4, h: 1.1, kind: 'rock' }, { x: 24, z: 17.5, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
  { x: -30, z: 15, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' }, { x: 6, z: 21, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
  // south - a dead truck, the frozen pond's banks, rocks
  { x: -27, z: -18, w: 2.2, d: 5, h: 1.0, kind: 'truck' }, { x: -27, z: -19.7, w: 2.2, d: 1.6, h: 0.9, y: 1.0, kind: 'cab' }, { x: 6, z: -20, w: 3, d: 1.1, h: 1.0, kind: 'snowbank' },
  { x: 22, z: -19, w: 1.6, d: 1.4, h: 1.1, kind: 'rock' }, { x: -2, z: -21, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
  { x: 10.2, z: -21, w: 0.9, d: 3, h: 0.9, kind: 'snowbank' }, { x: 17.8, z: -23.2, w: 3, d: 0.9, h: 0.9, kind: 'snowbank' },
  // west - a hut, a fence line, trees
  { x: -29, z: 4, w: 3.5, d: 3, h: 2.4, kind: 'shed' }, { x: -25, z: -8, w: 0.25, d: 5, h: 1.1, kind: 'fence' },
  { x: -31, z: -6, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' }, { x: -26, z: 12, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
  { x: -30, z: -12, w: 1.6, d: 1.4, h: 1.1, kind: 'rock' }, { x: -27, z: -1, w: 1, d: 2.4, h: 1.0, kind: 'logs' },
  // east - a hunting stand with stairs, rocks, a sled, woodpile
  { x: 29, z: -4, w: 3, d: 3, h: 2.4, kind: 'deck' },
  { stairs: '+x', x: 26.1, z: -4, w: 2.8, d: 1.6, y1: 2.4, kind: 'deck' },
  rail(29, -2.5, 3, 0.12, 2.4), rail(30.5, -4, 0.12, 3, 2.4), rail(29, -5.5, 3, 0.12, 2.4),
  { x: 31, z: 8, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' }, { x: 26, z: -12, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
  { x: 28, z: 3, w: 1.6, d: 1.4, h: 1.1, kind: 'rock' }, { x: 31, z: -12, w: 3, d: 1.1, h: 1.0, kind: 'snowbank' },
  { x: 27, z: 9, w: 1.6, d: 0.9, h: 0.7, kind: 'sled' }, { x: 31, z: 14, w: 1, d: 2.4, h: 1.0, kind: 'logs' },
];
const SCHOOL_MORE = [
  // the outer ring and more cover (the basement grew): concrete columns, half walls,
  // locker rows, shelving, crate stacks, piled desks, stacked mattresses, a vending machine
  { x: -14, z: -3, w: 0.7, d: 0.7, h: 3.4, kind: 'column' }, { x: 14, z: 2, w: 0.7, d: 0.7, h: 3.4, kind: 'column' },
  { x: -6, z: -6.5, w: 0.7, d: 0.7, h: 3.4, kind: 'column' }, { x: 6, z: 7, w: 0.7, d: 0.7, h: 3.4, kind: 'column' },
  { x: -22, z: 6, w: 0.7, d: 0.7, h: 3.4, kind: 'column' }, { x: 22, z: -8, w: 0.7, d: 0.7, h: 3.4, kind: 'column' },
  { x: -22, z: -6, w: 0.7, d: 0.7, h: 3.4, kind: 'column' }, { x: 22, z: 8, w: 0.7, d: 0.7, h: 3.4, kind: 'column' },
  { x: -1, z: 6, w: 3, d: 0.4, h: 1.1, kind: 'wall' }, { x: 1, z: -8, w: 0.4, d: 3, h: 1.1, kind: 'wall' },
  { x: -17, z: 4, w: 3, d: 0.4, h: 1.1, kind: 'wall' }, { x: 17, z: -5, w: 3, d: 0.4, h: 1.1, kind: 'wall' },
  { x: -15, z: 0, w: 1.4, d: 0.8, h: 0.78, kind: 'desk' }, { x: -15, z: 0, w: 1.4, d: 0.8, h: 0.78, y: 0.78, kind: 'desk' },
  { x: 16, z: -1.5, w: 0.8, d: 1.4, h: 0.78, kind: 'desk' }, { x: 16.9, z: -1.5, w: 0.8, d: 1.4, h: 0.78, kind: 'desk' },
  // west flank
  { x: -25, z: 3, w: 0.6, d: 5, h: 2.0, kind: 'lockers' }, { x: -25, z: -6, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: -25, z: -7.2, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' },
  { x: -26, z: 14, w: 0.8, d: 4, h: 2.2, kind: 'shelf' }, { x: -24, z: -12, w: 2, d: 1, h: 0.9, kind: 'mattress' }, { x: -24, z: -12, w: 2, d: 1, h: 0.3, y: 0.9, kind: 'mattress', color: 0x9a8a7a },
  { x: -20, z: 10, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
  // east flank
  { x: 25, z: 8, w: 0.8, d: 5, h: 2.2, kind: 'shelf' }, { x: 25, z: -3, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: 24, z: -12, w: 0.3, d: 4, h: 2.6, kind: 'cage' },
  { x: 26.9, z: 1.5, w: 0.8, d: 0.9, h: 1.9, kind: 'vending' }, { x: 21, z: 14, w: 2, d: 1, h: 1.2, kind: 'mattress' },
  // cover by both spawns
  { x: -6, z: 16.5, w: 4, d: 0.6, h: 2.0, kind: 'lockers' }, { x: 8, z: 17, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: 9.2, z: 17, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' },
  { x: -18, z: 17, w: 3, d: 0.4, h: 1.1, kind: 'wall' },
  { x: -4, z: -17, w: 4, d: 0.8, h: 2.2, kind: 'shelf' }, { x: 6, z: -16.5, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: 18, z: -17, w: 3, d: 0.4, h: 1.1, kind: 'wall' },
];

export const MAPS = {
  yard: {
    name: 'Container Yard', hx: 26, hz: 20, wallH: 5,
    sky: duskSky, background: 0x241a16, fog: [0x5a4038, 45, 130],
    hemi: [0xc0c8dc, 0x4a3a30, 1.8], key: [0xffd8b0, 1.6, [-16, 26, 12]],
    floor: () => { const t = concreteTiles(); t.map.userData.surface = 'bYardfloor'; return { map: t.map, normal: t.normal, rough: t.rough, tile: 2, color: 0xb8b4ae }; },
    wall: () => { const t = wallPanels(); t.map.userData.surface = 'bMetalpanel'; return { map: t.map, normal: t.normal, tileW: 1.2, tileH: 3.6, rough: 0.6, metal: 0.5 }; },
    kinds: {
      container: { map: containerTex, tile: 1, rough: 0.55, metal: 0.6 },
      crate: { map: crateTex, tile: 1.2, rough: 0.85 },
      wall: { map: () => wallPanels().map, color: 0xc4c8cc, rough: 0.6, metal: 0.5, tile: 1 },
      low: { map: concreteTex, rough: 0.95 },
      dock: { map: concreteTex, color: 0xa8a49c, rough: 0.95, tile: 2,
        decor: (ctx, b) => ctx.box({ map: hazardStripes, tile: 0.5, rough: 0.6 }, b.w + 0.02, 0.1, b.d + 0.02, b.x, b.h - 0.05, b.z) },
      steel: { map: gratingTex, color: 0x9aa0a6, rough: 0.5, metal: 0.8, tile: 0.6 },
      plank: { map: plankTex, color: 0xd8c8b0, tile: 1.5, rough: 0.85 },
      barrier: { map: concreteTex, color: 0xe4e0d8, rough: 0.9, decor: (ctx, b) => ctx.box({ map: hazardStripes, tile: 0.5, rough: 0.6 }, b.w + 0.01, 0.12, b.d + 0.01, b.x, b.h - 0.12, b.z) },
      rail: { color: 0xe8b830, rough: 0.5, metal: 0.6 },
      drum: { color: 0x2a5a8a, rough: 0.6, metal: 0.5, hiddenBox: true,
        decor: (ctx, b) => { for (const [dx, dz] of drumSpots(b)) { ctx.cylinder({ color: b.color ?? 0x2a5a8a, rough: 0.55, metal: 0.5 }, 0.29, 0.9, b.x + dx, 0.45, b.z + dz, 14); ctx.cylinder({ color: 0x1a1c1e, rough: 0.5, metal: 0.6 }, 0.3, 0.04, b.x + dx, 0.3, b.z + dz, 14); ctx.cylinder({ color: 0x1a1c1e, rough: 0.5, metal: 0.6 }, 0.3, 0.04, b.x + dx, 0.62, b.z + dz, 14); } } },
      tyres: { color: 0x1c1c1c, rough: 0.9, hiddenBox: true,
        decor: (ctx, b) => { for (let i = 0; i < Math.round(b.h / 0.26); i++) { ctx.cylinder({ color: 0x1a1a1a, rough: 0.92 }, 0.42, 0.24, b.x + Math.sin(i * 2.1) * 0.04, 0.13 + i * 0.26, b.z, 16); ctx.cylinder({ color: 0x0a0a0a, rough: 1 }, 0.2, 0.25, b.x + Math.sin(i * 2.1) * 0.04, 0.13 + i * 0.26, b.z, 12); } } },
      pallet: { map: plankTex, color: 0xc8b090, tile: 1, rough: 0.9,
        decor: (ctx, b) => ctx.box({ color: 0x8a96a0, rough: 0.7 }, b.w * 0.9, 0.5, b.d * 0.9, b.x, b.h + 0.25, b.z) },
    },
    fixtures: () => [...YARD_LAMPS.map(([x, z]) => [x * 0.96, 6.4, z * 0.96, 0xffb870, 40, 20, 0.95])],
    layout: [
      // drums, tyres and pallets (cover)
      { x: -12.6, z: 6.2, w: 1.3, d: 0.7, h: 0.9, kind: 'drum' }, { x: 16.4, z: -8.6, w: 0.7, d: 1.3, h: 0.9, kind: 'drum', color: 0x8a2a1e },
      { x: -22, z: -10, w: 1.3, d: 1.3, h: 0.9, kind: 'drum', color: 0x4a6a2a }, { x: 4.5, z: -3.2, w: 0.7, d: 0.7, h: 0.9, kind: 'drum', color: 0x8a2a1e },
      { x: -6, z: -3, w: 0.9, d: 0.9, h: 1.04, kind: 'tyres' }, { x: 11, z: 8, w: 0.9, d: 0.9, h: 0.78, kind: 'tyres' }, { x: 23.5, z: -1, w: 0.9, d: 0.9, h: 1.3, kind: 'tyres' },
      { x: -2, z: -15.5, w: 1.2, d: 1.0, h: 0.15, kind: 'pallet' }, { x: 12, z: 16, w: 1.2, d: 1.0, h: 0.15, kind: 'pallet' }, { x: -17, z: 1.5, w: 1.0, d: 1.2, h: 0.15, kind: 'pallet' },
      // middle: a container you can reach by a plank ramp, or by vaulting the crate
      { x: 0, z: 0, w: 6.1, d: 2.4, h: 2.6, kind: 'container', color: 0x8a3a2a },
      { ramp: '+x', x: -5.8, z: 0, w: 5.5, d: 1.4, y1: 2.6, kind: 'plank' },
      { x: 3.75, z: 0.5, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
      { x: -10.5, z: -4, w: 2.4, d: 6, h: 2.6, kind: 'container', color: 0x2d4f7a },
      { x: 9, z: 3.5, w: 0.4, d: 5, h: 2.6, kind: 'wall' },
      // A side (north): the dock - long containers, crate stacks, low walls
      { x: -15, z: 10, w: 7, d: 2.4, h: 2.6, kind: 'container', color: 0x3f6a3a },
      { x: 14, z: 10, w: 2.4, d: 7, h: 2.6, kind: 'container', color: 0xb8692a },
      { x: -5, z: 8.5, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' }, { x: -3.8, z: 8.5, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
      { x: 6, z: 13, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: 7.2, z: 13, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: 6.6, z: 13, w: 1.2, d: 1.2, h: 1.2, y: 1.2, kind: 'crate' },
      { x: 1, z: 6.5, w: 5, d: 0.4, h: 1.0, kind: 'low' }, { x: -21, z: 4, w: 4, d: 0.4, h: 1.0, kind: 'low' }, { x: 21, z: 2, w: 0.4, d: 4, h: 1.0, kind: 'low' },
      { x: -8, z: 14.5, w: 3, d: 0.6, h: 1.1, kind: 'barrier' }, { x: 2, z: 15, w: 2.4, d: 0.6, h: 1.1, kind: 'barrier' },
      { x: 20, z: 15, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' }, { x: -20, z: 13, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
      // B side (south): the depot - a raised loading dock with stairs and a ramp
      { x: 9, z: -13, w: 10, d: 5, h: 1.2, kind: 'dock' },
      { stairs: '+x', x: 2.8, z: -12, w: 2.4, d: 2, y1: 1.2, kind: 'steel' },
      { ramp: '-z', x: 12, z: -9, w: 2, d: 3, y1: 1.2, kind: 'steel' },
      { x: 6.5, z: -14, w: 1.2, d: 1.2, h: 1.2, y: 1.2, kind: 'crate' },
      { x: 11, z: -11.2, w: 2.4, d: 0.4, h: 1.0, y: 1.2, kind: 'low' },
      { x: -4, z: -10, w: 0.4, d: 6, h: 3, kind: 'wall' }, { x: -16, z: -12, w: 6, d: 0.4, h: 3, kind: 'wall' },
      { x: -19, z: -4, w: 2.4, d: 6, h: 2.6, kind: 'container', color: 0x6a6a6a },
      { x: 19, z: -4, w: 6, d: 2.4, h: 2.6, kind: 'container', color: 0x7a2a5a },
      { x: -9, z: -15.5, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: -10.2, z: -15.5, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' },
      { x: 1, z: -6, w: 2.4, d: 0.6, h: 1.1, kind: 'barrier' }, { x: -14, z: -7, w: 3, d: 0.6, h: 1.1, kind: 'barrier' },
      { x: 22, z: -14, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' },
    ],
    spawns: [[-18, 18], [-6, 18.5], [6, 18], [18, 17.5], [23, 9]],
    spawnsB: [[-20, -17], [-8, -18], [3, -18], [16, -18], [23, -9]],
    extra: (ctx, map) => {
      // floodlights on poles against the fence, painted bay lines, warning signs, oil stains
      for (const [x, z] of YARD_LAMPS) {
        ctx.cylinder({ color: 0x5a5e62, rough: 0.5, metal: 0.8 }, 0.11, 7, x, 3.5, z, 10);
        const ax = -Math.sign(x) * (Math.abs(x) > 20 ? 0.5 : 0), az = -Math.sign(z) * (Math.abs(x) > 20 ? 0 : 0.5);
        ctx.box({ color: 0x3a3e42, rough: 0.5, metal: 0.8 }, Math.abs(ax) ? 1.1 : 0.08, 0.08, Math.abs(az) ? 1.1 : 0.08, x + ax, 6.9, z + az);
        ctx.box({ color: 0x2a2c2e, rough: 0.5, metal: 0.7 }, 0.6, 0.22, 0.45, x + ax * 2, 6.75, z + az * 2);
        ctx.box({ emissive: 0xffd6a0 }, 0.5, 0.02, 0.36, x + ax * 2, 6.63, z + az * 2);
      }
      for (const z of [-7.5, 7.5]) ctx.floorPlane({ color: 0xd8b030, rough: 0.8 }, 30, 0.12, 0, 0.012, z);
      for (const x of [-15, -5, 5, 15]) ctx.floorPlane({ color: 0xd8b030, rough: 0.8 }, 0.12, 3, x, 0.012, 7.5 + 1.5 * Math.sign(x));
      for (const [x, z, s] of [[-7, 3, 1.4], [6, -9, 1.1], [16, 5, 0.9], [-13, -14, 1.3]]) ctx.floorPlane({ color: 0x15171a, rough: 0.15, metal: 0.3 }, s * 1.6, s, x, 0.013, z);
      for (const [x, z, ry] of [[-map.hx + 0.03, -6, Math.PI / 2], [map.hx - 0.03, 6, -Math.PI / 2], [10, -map.hz + 0.03, 0], [-10, map.hz - 0.03, Math.PI]]) ctx.plane({ map: hazardStripes, rough: 0.6 }, 1.6, 0.6, x, 2.4, z, ry);
    },
  },

  winter: {
    name: 'Winter Cabin', hx: 34, hz: 26, wallH: 1.6,
    sky: winterSky, background: 0xdfe8f2, fog: [0xd6e2ee, 26, 95],
    hemi: [0xdfe9ff, 0x8a96a8, 2.0], key: [0xfff1dc, 1.5, [12, 24, -9]],
    floor: () => ({ map: snowTex(), tile: 6, rough: 0.9 }),
    wall: () => ({ map: plankTex(), tileW: 2, tileH: 1.6, rough: 0.85 }),
    glows: [[0xff9a40, 1.6, CABIN.x - 3.6, 1.0, CABIN.z, 7]],
    snowSkip: [[CABIN.x - CABIN.w / 2 - 0.6, CABIN.x + CABIN.w / 2 + 0.6, CABIN.z - CABIN.d / 2 - 0.6, CABIN.z + CABIN.d / 2 + 0.6]],
    kinds: {
      logwall: { map: logTex, tile: 2.4, rough: 0.85 },
      shed: { map: plankTex, tile: 2, rough: 0.85, decor: (ctx, b) => ctx.box({ color: 0xf2f6fb, rough: 0.8 }, b.w + 0.3, 0.2, b.d + 0.3, b.x, b.h + 0.1, b.z) },
      logs: { map: woodpileTex, tile: 1, rough: 0.9, decor: (ctx, b) => ctx.box({ color: 0xf2f6fb, rough: 0.8 }, b.w, 0.08, b.d, b.x, b.h + 0.04, b.z) },
      snowbank: { map: snowTex, tile: 3, rough: 0.9, color: 0xf6f9fd },
      hill: { map: snowTex, tile: 4, rough: 0.9, color: 0xeef3f9 },
      fence: { map: plankTex, tile: 1.5, rough: 0.85 },
      deck: { map: plankTex, tile: 1.5, color: 0xc8b8a0, rough: 0.85 },
      rail: { map: plankTex, tile: 1, color: 0xa89880, rough: 0.85 },
      table: { map: deskTex, color: 0x9a7048, tile: 1, rough: 0.7 },
      bed: { color: 0x8a2a2a, rough: 0.95, decor: (ctx, b) => ctx.box({ color: 0xe8e4dc, rough: 0.95 }, 0.7, 0.12, 0.45, b.x, b.h + 0.04, b.z - b.d / 2 + 0.3) },
      fireplace: { map: concreteTex, color: 0x8a8580, rough: 0.95,
        decor: (ctx, b) => { ctx.plane({ emissive: 0xff7a20 }, 0.7, 0.45, b.x + b.w / 2 + 0.01, 0.35, b.z, Math.PI / 2); ctx.box({ color: 0x77706a, rough: 0.95 }, 0.6, 2.2, 0.6, b.x, b.h + 1.1, b.z); } },
      crate: { map: crateTex, tile: 1.2, rough: 0.85, decor: (ctx, b) => ctx.box({ color: 0xf2f6fb, rough: 0.8 }, b.w, 0.08, b.d, b.x, b.h + 0.04, b.z) },
      sled: { color: 0xb02a20, rough: 0.6, metal: 0.2 },
      cab: { color: 0x3a5a4a, rough: 0.6, metal: 0.4, decor: (ctx, b) => ctx.box({ color: 0xf2f6fb, rough: 0.8 }, b.w, 0.1, b.d, b.x, b.h + 0.05, b.z) },
      rock: { map: concreteTex, color: 0x7a7c80, tile: 1.5, rough: 0.95, decor: (ctx, b) => ctx.box({ color: 0xf2f6fb, rough: 0.8 }, b.w * 0.8, 0.12, b.d * 0.8, b.x, b.h + 0.04, b.z) },
      truck: { color: 0x3a5a4a, rough: 0.6, metal: 0.4,
        decor: (ctx, b) => {
          const ax = b.w > b.d, L = Math.max(b.w, b.d), W = Math.min(b.w, b.d), at = (u, v) => ax ? [b.x + u, b.z + v] : [b.x + v, b.z + u];
          // the cab is its own solid (kind 'cab') at the front end; here its windscreen
          ctx.box({ color: 0x9ab0c0, rough: 0.1, metal: 0.3 }, ax ? 0.04 : W * 0.85, 0.5, ax ? W * 0.85 : 0.04, ...((p) => [p[0], b.h + 0.5, p[1]])(at(-L / 2 - 0.01, 0)));
          ctx.box({ color: 0xf2f6fb, rough: 0.8 }, ax ? L - 1.8 : W * 0.9, 0.1, ax ? W * 0.9 : L - 1.8, ...((p) => [p[0], b.h + 0.05, p[1]])(at(0.8, 0)));
          for (const u of [-L / 2 + 0.9, L / 2 - 0.9]) for (const v of [-W / 2, W / 2]) { const [x, z] = at(u, v), w = ctx.cylinder({ color: 0x141414, rough: 0.9 }, 0.42, 0.3, x, 0.42, z, 14); w.rotation[ax ? 'x' : 'z'] = Math.PI / 2; }
        } },
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
      // the cabin: walk in through either door, shoot through the windows
      ...cabinWalls,
      { x: CABIN.x + 0.6, z: CABIN.z + 0.2, w: 1.6, d: 0.9, h: 0.78, kind: 'table' },
      { x: CABIN.x - CABIN.w / 2 + 0.65, z: CABIN.z, w: 0.6, d: 1.6, h: 1.2, kind: 'fireplace' },
      { x: CABIN.x + CABIN.w / 2 - 0.9, z: CABIN.z + CABIN.d / 2 - 1.5, w: 1.0, d: 2.0, h: 0.55, kind: 'bed' },
      // B side (south): a snowy hill with two slopes up and pines on top
      { x: -14, z: -14.5, w: 12, d: 9, h: 2.0, kind: 'hill' },
      { ramp: '-z', x: -12, z: -7, w: 4, d: 6, y1: 2.0, kind: 'hill' },
      { ramp: '-x', x: -5, z: -15, w: 6, d: 3.5, y1: 2.0, kind: 'hill' },
      { x: -17, z: -12, w: 3, d: 1.1, h: 0.95, y: 2.0, kind: 'snowbank' }, { x: -11, z: -16.5, w: 2.4, d: 1, h: 0.95, y: 2.0, kind: 'snowbank' },
      { x: -18, z: -17, w: 0.6, d: 0.6, h: 2.0, y: 2.0, kind: 'tree' }, { x: -9, z: -12, w: 0.6, d: 0.6, h: 2.0, y: 2.0, kind: 'tree' },
      { x: 8, z: -10, w: 3, d: 2.4, h: 2.4, kind: 'shed' },
      { x: 14, z: -15, w: 2.4, d: 0.8, h: 1.0, kind: 'logs' }, { x: 3, z: -8, w: 3.5, d: 1.1, h: 1.0, kind: 'snowbank' },
      { x: 20, z: -8, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' }, { x: 1, z: -16, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
      { x: 17, z: -3, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: -21, z: -3, w: 3, d: 1.1, h: 1.0, kind: 'snowbank' },
      // A side (north): a lookout deck with stairs, woodpiles, a sled, fence lines
      { x: 15, z: 12, w: 4, d: 4, h: 2.4, kind: 'deck' },
      { stairs: '+x', x: 11.6, z: 11, w: 2.8, d: 1.6, y1: 2.4, kind: 'deck' },
      rail(15, 14, 4, 0.12, 2.4), rail(17, 12, 0.12, 4, 2.4), rail(15, 10, 4, 0.12, 2.4), rail(13, 13, 0.12, 2, 2.4),
      { x: -6, z: 9, w: 2.4, d: 0.8, h: 1.0, kind: 'logs' }, { x: -18, z: 10, w: 1, d: 3, h: 1.0, kind: 'logs' },
      { x: 4, z: 7.5, w: 4, d: 0.25, h: 1.1, kind: 'fence' }, { x: -12, z: 5, w: 0.25, d: 4, h: 1.1, kind: 'fence' },
      { x: 6, z: 14, w: 1.6, d: 0.9, h: 0.7, kind: 'sled' },
      { x: -10, z: 15, w: 3.5, d: 1.2, h: 1.0, kind: 'snowbank' }, { x: 20, z: 4, w: 3, d: 1.1, h: 0.95, kind: 'snowbank' },
      { x: -22, z: 8, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' }, { x: -3, z: 13, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' }, { x: 9, z: 5, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
      { x: -15, z: 1, w: 0.6, d: 0.6, h: 2.0, kind: 'tree' },
      ...WINTER_RING,
    ],
    spawns: [[-26, 24], [-12, 24.5], [2, 24.5], [16, 24.5], [30, 22]],
    spawnsB: [[-26, -24], [-12, -24.5], [2, -24.5], [16, -24.5], [30, -22]],
    // the cabin's lamp, a lantern at its door and on both decks (on at night too)
    fixtures: (map) => [[CABIN.x, 2.7, CABIN.z, 0xffc070, 8, 7, 1.2], [CABIN.x - 2.2, 2.5, CABIN.z + CABIN.d / 2 + 0.45, 0xffb060, 7, 8, 1.1], [15, 4.4, 12, 0xffb060, 9, 9, 1.1], ...(map.small ? [] : [[29, 4.4, -4, 0xffb060, 9, 9, 1.1]])],
    snow: true,
    extra: (ctx, map) => {
      // Cabin roof (two snowy slopes), chimney, plank floor, door frames, lit windows.
      const { x, z, w, d, h } = CABIN, rh = 1.6, len = Math.hypot(w / 2 + 0.5, rh);
      for (const s of [-1, 1]) {
        const r = ctx.box({ color: 0x3a2a20, rough: 0.9 }, len, 0.16, d + 0.9, x + s * (w / 4 + 0.12), h + rh / 2, z);
        r.rotation.z = -s * Math.atan2(rh, w / 2 + 0.5);
        const sn = ctx.box({ color: 0xf2f6fb, rough: 0.8 }, len, 0.08, d + 0.94, x + s * (w / 4 + 0.12), h + rh / 2 + 0.12, z);
        sn.rotation.z = r.rotation.z;
      }
      for (const s of [-1, 1]) ctx.gable({ map: logTex, tile: 2.4, rough: 0.85 }, w + 0.6, rh + 0.1, 0.3, x, h, z + s * (d / 2 - 0.15));   // gable ends
      ctx.box({ color: 0x77706a, rough: 0.95 }, 0.7, 2.4, 0.7, x - w / 2 + 0.65, h + 0.9, z);
      ctx.floorPlane({ map: plankTex, tile: 1.5, color: 0xb89870, rough: 0.8 }, w - 0.7, d - 0.7, x, 0.015, z);
      ctx.box({ color: 0x2a1a10, rough: 0.8 }, 0.08, 1.4, 0.4, x, h - 0.2, z);      // a beam
      // icicles along both eaves, the cabin's hanging lamp and door lantern, lanterns on the decks
      const rng = mulberry32(31);
      for (const s of [-1, 1]) for (let i = 0; i < 26; i++) { const L = 0.12 + rng() * 0.35; ctx.cone({ color: 0xd8ecfa, rough: 0.1 }, 0.035, L, x - w / 2 + 0.2 + i * (w / 25.6), h - 0.05 - L / 2, z + s * (d / 2 + 0.42), Math.PI); }
      ctx.box({ color: 0x2a1a10, rough: 0.8 }, 0.02, 0.4, 0.02, x, 2.85, z); ctx.cone({ color: 0x3a2a1a, rough: 0.6, metal: 0.3 }, 0.22, 0.18, x, 2.62, z); ctx.cylinder({ emissive: 0xffc070 }, 0.07, 0.08, x, 2.52, z);
      const lantern = (lx, ly, lz) => { ctx.box({ color: 0x1a1a1a, rough: 0.5, metal: 0.7 }, 0.2, 0.3, 0.2, lx, ly, lz); ctx.box({ emissive: 0xffb060 }, 0.14, 0.2, 0.14, lx, ly, lz); };
      lantern(x - 2.2, 2.55, z + d / 2 + 0.45);
      for (const [lx, lz] of map.small ? [[15, 12]] : [[15, 12], [29, -4]]) { ctx.cylinder({ color: 0x5a4a3a, rough: 0.9 }, 0.05, 1.8, lx + 1.8, 2.4 + 0.9, lz + 1.8, 8); lantern(lx + 1.8, 4.3, lz + 1.8); }
      // the frozen pond (walk on it), stumps, a chopping block with an axe
      if (!map.small) {
        ctx.floorPlane({ color: 0xbcd8ea, rough: 0.05, metal: 0.1 }, 7, 4, 14, 0.02, -21);
        ctx.floorPlane({ color: 0x9ac0d8, rough: 0.1, metal: 0.1 }, 5.6, 2.8, 14, 0.025, -21);
      }
      for (const [sx, sz] of [[-8, 18], [18, 6], [-22, -14], ...(map.small ? [] : [[24, -22], [-16, 23]])]) { ctx.cylinder({ map: barkTex, rough: 0.95 }, 0.28, 0.45, sx, 0.22, sz, 10); ctx.cylinder({ color: 0xf2f6fb, rough: 0.8 }, 0.28, 0.04, sx, 0.46, sz, 10); }
      ctx.cylinder({ map: barkTex, rough: 0.95 }, 0.35, 0.6, -6.8, 0.3, 17.5, 10);
      const ax = ctx.box({ color: 0x6a4a2a, rough: 0.8 }, 0.05, 0.7, 0.05, -6.8, 0.85, 17.5); ax.rotation.z = 0.5;
      ctx.box({ color: 0x9aa0a6, rough: 0.3, metal: 0.9 }, 0.18, 0.12, 0.03, -6.62, 0.66, 17.5);
    },
    outside: (ctx, map) => {        // pines beyond the fence
      const rng = mulberry32(77);
      for (let i = 0; i < 46; i++) {
        const a = rng() * Math.PI * 2, r = 1 + rng() * 0.75, x = Math.cos(a) * r * (map.hx + 4), z = Math.sin(a) * r * (map.hz + 4);   // beyond the fence all round
        const h = 5 + rng() * 6;
        ctx.cone({ color: 0x1b3f28, rough: 0.9 }, 1.6 + rng(), h, x, h / 2, z);
        ctx.cone({ color: 0xeef3f8, rough: 0.9 }, 1.0, h * 0.3, x, h * 0.86, z);
      }
    },
  },

  casino: {
    name: "Jesse's Casino", hx: 22, hz: 16, wallH: 8, indoor: true,
    background: 0x0b0710, fog: [0x140a12, 34, 80],
    hemi: [0xffe0c0, 0x50202a, 2.1], key: [0xffe6c0, 1.1, [4, 24, 6]],
    floor: () => ({ map: carpetTex(), tile: 2.5, rough: 0.95 }),
    wall: () => ({ map: woodPanelTex(), tileW: 2, tileH: 5, rough: 0.5, metal: 0.2 }),
    ceiling: { color: 0x1a0c10, lights: 0xfff0d0, lightsAt: [] },
    glows: [[0xff3aa8, 1.2, 0, 5.8, 14.5, 12], [0xffd080, 1.4, 0, 2.6, 0, 12]],
    kinds: {
      slots: { map: cabinetTex, tile: 1, rough: 0.4, metal: 0.5,
        decor: (ctx, b) => {
          const n = Math.max(1, Math.round(Math.max(b.w, b.d) / 1.2)), alongX = b.w >= b.d;
          for (let i = 0; i < n; i++) {
            const f = (i + 0.5) / n, x = alongX ? b.x - b.w / 2 + f * b.w : b.x, z = alongX ? b.z : b.z - b.d / 2 + f * b.d;
            const seed = 1000 + i * 7 + Math.round(b.x * 13 + b.z * 7);
            for (const s of [-1, 1]) {
              const uv = slotCell(seed + (s > 0 ? 3 : 0));
              if (alongX) ctx.plane({ emissiveMap: slotAtlas() }, b.w / n * 0.8, 1.0, x, 1.25, b.z + s * (b.d / 2 + 0.01), s > 0 ? 0 : Math.PI, uv);
              else ctx.plane({ emissiveMap: slotAtlas() }, b.d / n * 0.8, 1.0, b.x + s * (b.w / 2 + 0.01), 1.25, z, s > 0 ? Math.PI / 2 : -Math.PI / 2, uv);
            }
            ctx.cone({ emissive: [0xff3050, 0x30ff80, 0xffd040, 0x40a0ff][i % 4] }, 0.12, 0.25, x, b.h + 0.12, z);
          }
        } },
      cardtable: { map: feltTex, tile: 2.4, rough: 0.95,
        decor: (ctx, b) => {
          ctx.box({ color: 0x4a2412, rough: 0.5, metal: 0.1 }, b.w + 0.16, 0.1, b.d + 0.16, b.x, b.h - 0.03, b.z);
          // chip stacks and a spread of cards
          for (let i = 0; i < 4; i++) { const n = 2 + ((i * 7 + Math.round(b.x * 3)) % 4); ctx.cylinder({ color: [0xc02028, 0x2050c0, 0x20a040, 0x101010][i] }, 0.035, 0.012 * n, b.x - 0.3 + i * 0.12, b.h + 0.006 * n + 0.02, b.z + b.d * 0.22, 10); }
          for (let i = 0; i < 5; i++) { const c = ctx.floorPlane({ color: 0xf4f0e8, rough: 0.6 }, 0.063, 0.088, b.x + 0.2 + i * 0.075, b.h + 0.022, b.z - b.d * 0.15); c.rotation.z = 0.12 * (i - 2); }
        } },
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
      slab: { map: carpetTex, tile: 2.5, rough: 0.95, noShadow: true,
        decor: (ctx, b) => ctx.box({ color: 0x2a1410, rough: 0.8 }, b.w, 0.02, b.d, b.x, -0.01, b.z) },
      room: { map: woodPanelTex, tile: 3.35, rough: 0.5, metal: 0.2 },
      partition: { map: woodPanelTex, color: 0xb08a70, tile: 2.2, rough: 0.5, metal: 0.2 },
      stairs: { map: woodPanelTex, color: 0x9a5a3a, tile: 1, rough: 0.5 },
      ramp: { map: carpetTex, tile: 2.5, rough: 0.95 },
      rail: { color: 0xc9952e, rough: 0.3, metal: 1, map: cabinetTex, tile: 1 },
      couch: { color: 0x5a1020, rough: 0.9 },
    },
    layout: casinoLayout(),
    fixtures: (map) => [
      ...CASINO_CHANDELIERS.map(([x, z]) => [x, map.wallH - 1.1, z, 0xffe2b8, 30, 14, 1.1]),
      ...casinoDownlights().map(([x, z]) => [x, 3.28, z, 0xffd8a8, 9, 7.5, 1.1]),
      ...CASINO_SCONCES.map(([x, y, z]) => [x, y, z, 0xffc890, 5, 5, 1.2]),
    ],
    spawns: [[-18, 9], [0, 14], [18, 9], [-12, 10, 3.6], [14, 13, 3.6]],
    spawnsB: [[-18, -10], [0, -15.2], [18, -9], [-10, -12, 3.6], [4, -13, 3.6]],
    extra: (ctx, map) => {
      for (const [z, ry] of [[-map.hz + 0.02, 0], [map.hz - 0.02, Math.PI]]) ctx.plane({ emissiveMap: neonSign() }, 9, 1.7, 0, 5.8, z, ry);
      for (const [x, z] of CASINO_CHANDELIERS) {
        ctx.cylinder({ color: 0xc9952e, rough: 0.3, metal: 1 }, 0.6, 0.14, x, map.wallH - 0.6, z);
        ctx.cone({ emissive: 0xfff0c0 }, 0.55, 0.6, x, map.wallH - 1.0, z, Math.PI);
      }
      // downlights under the upper floor
      for (const [x, z] of casinoDownlights()) ctx.box({ emissive: 0xffe0b0 }, 0.45, 0.03, 0.45, x, 3.33, z);
      // brass wall sconces (both floors), potted palms, velvet ropes round the roulette, a carpet runner
      for (const [x, y, z] of CASINO_SCONCES) {
        const s = Math.sign(z); ctx.box({ color: 0xc9952e, rough: 0.3, metal: 1 }, 0.3, 0.06, 0.14, x, y + 0.1, z - s * 0.07);
        ctx.cone({ emissive: 0xffd8a0 }, 0.12, 0.22, x, y + 0.24, z - s * 0.12);
      }
      for (const [x, z, y] of [[-21.3, -2, 0], [21.3, 3.5, 0], [-7.4, -15.3, 0], [9.5, 15.3, 0], [-21.3, 3, 3.6], [21.3, -3, 3.6], [-9, 15.4, 3.6], [9, -15.4, 3.6]]) {
        ctx.cylinder({ color: 0x2a1a12, rough: 0.6, metal: 0.2 }, 0.3, 0.5, x, y + 0.25, z, 12);
        ctx.cylinder({ color: 0xc9952e, rough: 0.3, metal: 1 }, 0.32, 0.05, x, y + 0.5, z, 12);
        for (let i = 0; i < 6; i++) { const f = ctx.cone({ color: 0x2a5a2a, rough: 0.8 }, 0.18, 1.1, x + Math.cos(i) * 0.25, y + 1.1, z + Math.sin(i) * 0.25); f.rotation.set(Math.sin(i) * 0.7, 0, -Math.cos(i) * 0.7); }
      }
      for (const [x, z] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) { ctx.cylinder({ color: 0xc9952e, rough: 0.3, metal: 1 }, 0.035, 0.95, x, 0.48, z, 8); ctx.cylinder({ color: 0xc9952e, rough: 0.3, metal: 1 }, 0.1, 0.04, x, 0.02, z, 12); }
      for (const [x0, z0, x1, z1] of [[-1.9, -1.9, 1.9, -1.9], [1.9, 1.9, -1.9, 1.9], [-1.9, -1.9, -1.9, 1.9]]) { if (x0 === x1) ctx.tubeZ({ color: 0x8a1020, rough: 0.9 }, 0.03, 3.8, x0, 0.82, 0) ; else ctx.tubeX({ color: 0x8a1020, rough: 0.9 }, 0.03, 3.8, 0, 0.82, z0); }
      ctx.floorPlane({ color: 0x6a0a18, rough: 0.95 }, 2.2, 10, 0, 0.012, 10.5);
      ctx.floorPlane({ color: 0x6a0a18, rough: 0.95 }, 2.2, 10, 0, 0.012, -10.5);
      // a lit jackpot board over the slot hall
      ctx.plane({ emissiveMap: neonTex('JACKPOT  1,000,000', '#ffd040') }, 5, 0.9, 0, 2.7, 15.98, Math.PI);
    },
  },

  school: {
    name: 'School Basement', hx: 28, hz: 20, wallH: 3.4, indoor: true,
    background: 0x050605, fog: [0x0b120b, 10, 40],
    hemi: [0x8a9a90, 0x1a1c1a, 0.95], key: [0xc8e0cc, 0.4, [-6, 20, 4]],
    floor: () => ({ map: basementFloorTex(), tile: 4, rough: 0.8 }),
    wall: () => ({ map: blockWallTex(), tileW: 2, tileH: 3.4, rough: 0.9 }),
    ceiling: { color: 0x2a2c28, lights: 0xd8e8d0, lightsAt: SCHOOL_LIGHTS },
    fixtures: (map) => map.ceiling.lightsAt.map(([x, z]) => [x, map.wallH - 0.08, z, 0xd8ecd8, 9, 8, 1.15]),
    glows: [[0x40ff50, 2.2, -8, 0.9, 6, 9], [0x40ff50, 2.2, 10, 0.9, -5, 9], [0x40ff50, 1.6, 15, 0.9, 10, 7], [0xffd0a0, 1.2, -1, 2.8, -1, 10]],
    acid: [{ x: -8, z: 6, w: 8, d: 4 }, { x: 10, z: -5, w: 5, d: 7 }, { x: 15, z: 10, w: 4, d: 3 }],
    acidLook,
    kinds: {
      lockers: { map: lockerTex, color: 0x8a9a88, tile: 1, rough: 0.6, metal: 0.6 },
      shelf: { map: shelfTex, tile: 2, rough: 0.8 },
      boiler: { map: rustTex, tile: 1.5, rough: 0.6, metal: 0.7,
        decor: (ctx, b) => {
          ctx.cylinder({ map: rustTex, tile: 1, rough: 0.5, metal: 0.8 }, Math.min(b.w, b.d) * 0.55, b.h + 0.2, b.x, (b.h + 0.2) / 2, b.z);
          ctx.cylinder({ color: 0x3a3c3e, rough: 0.4, metal: 0.9 }, 0.12, 3.4 - b.h, b.x, b.h + (3.4 - b.h) / 2, b.z);
          ctx.box({ emissive: 0xff6a20 }, 0.3, 0.2, 0.02, b.x, 0.6, b.z + Math.min(b.w, b.d) * 0.56);
        } },
      barrel: { map: rustTex, color: 0x3a6a3a, tile: 1, rough: 0.6, metal: 0.6, hiddenBox: true,
        decor: (ctx, b) => { ctx.cylinder({ map: rustTex, color: 0x4a7a3a, rough: 0.6, metal: 0.5 }, b.w / 2, b.h, b.x, b.h / 2, b.z, 14); ctx.cylinder({ emissive: 0x60ff50 }, b.w / 2 - 0.05, 0.02, b.x, b.h + 0.01, b.z, 14); } },
      plank: { map: gratingTex, color: 0xa0a4a8, tile: 0.6, rough: 0.5, metal: 0.8 },
      platform: { map: concreteTex, color: 0x6a6c68, tile: 2, rough: 0.95,
        decor: (ctx, b) => ctx.box({ map: hazardStripes, tile: 0.5, rough: 0.6 }, b.w + 0.02, 0.1, b.d + 0.02, b.x, b.h - 0.05, b.z) },
      steel: { map: gratingTex, color: 0x9aa0a6, rough: 0.5, metal: 0.8, tile: 0.6 },
      crate: { map: crateTex, color: 0x9a9a8a, tile: 1.2, rough: 0.85 },
      desk: { map: deskTex, color: 0x8a7a60, tile: 1, rough: 0.7 },
      cage: { map: gratingTex, color: 0x8a8e92, tile: 0.4, rough: 0.5, metal: 0.8 },
      wall: { map: blockWallTex, tile: 3.4, rough: 0.9 },
      rail: { color: 0xe8c040, rough: 0.5, metal: 0.6 },
      column: { map: concreteTex, color: 0x8a8c88, tile: 1.7, rough: 0.95,
        decor: (ctx, b) => ctx.box({ map: hazardStripes, tile: 0.5, rough: 0.6 }, b.w + 0.02, 0.5, b.d + 0.02, b.x, 0.25, b.z) },
      vending: { map: vendingTex, rough: 0.4, metal: 0.3,
        decor: (ctx, b) => { const f = -Math.sign(b.x) || 1; ctx.plane({ emissiveMap: vendingTex() }, b.d * 0.7, b.h * 0.65, b.x + f * (b.w / 2 + 0.01), b.h * 0.55, b.z, f * Math.PI / 2); } },   // its lit front faces the middle (x)
      mattress: { color: 0x8a8a7a, rough: 0.95 },
    },
    layout: [
      ...SCHOOL_MORE,
      // middle: the boiler and pipes
      { x: 0, z: -1, w: 2.4, d: 2.4, h: 2.2, kind: 'boiler' },
      { x: -3.5, z: 2.5, w: 0.8, d: 0.8, h: 1.0, kind: 'barrel' }, { x: 3.2, z: -4.5, w: 0.8, d: 0.8, h: 1.0, kind: 'barrel' },
      // catwalks over the acid
      { x: -8, z: 6, w: 1.2, d: 4.4, h: 0.35, kind: 'plank' },
      { x: 10, z: -5, w: 5.4, d: 1.2, h: 0.35, kind: 'plank' },
      // A side (north): old classroom storage - lockers, shelves, piled desks, crates
      { x: -15, z: 8.5, w: 6, d: 0.6, h: 2.0, kind: 'lockers' }, { x: 2, z: 9, w: 0.6, d: 5, h: 2.0, kind: 'lockers' },
      { x: -18, z: 13.5, w: 0.8, d: 4, h: 2.2, kind: 'shelf' }, { x: 8, z: 13.5, w: 5, d: 0.8, h: 2.2, kind: 'shelf' },
      { x: -4, z: 12, w: 1.4, d: 0.8, h: 0.78, kind: 'desk' }, { x: -4, z: 12, w: 1.4, d: 0.8, h: 0.78, y: 0.78, kind: 'desk' }, { x: -2.5, z: 12.4, w: 1.4, d: 0.8, h: 0.78, kind: 'desk' },
      { x: 19, z: 5, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: 19, z: 6.2, w: 1.2, d: 1.2, h: 2.4, kind: 'crate' },
      { x: -11, z: 2, w: 0.8, d: 0.8, h: 1.0, kind: 'barrel' }, { x: 7, z: 3, w: 0.8, d: 0.8, h: 1.0, kind: 'barrel' },
      { x: 12, z: 6.5, w: 3, d: 0.3, h: 1.1, kind: 'cage' },
      // B side (south): the boiler room - a raised platform with stairs, a wire cage, shelves
      { x: -17, z: -12, w: 8, d: 7, h: 1.2, kind: 'platform' },
      { stairs: '-x', x: -11.6, z: -10, w: 2.8, d: 2, y1: 1.2, kind: 'steel' },
      rail(-17, -8.6, 8, 0.12, 1.2), rail(-13.06, -13.8, 0.12, 3.4, 1.2),
      { x: -18, z: -13, w: 1.2, d: 1.2, h: 1.2, y: 1.2, kind: 'crate' },
      { x: -5, z: -9, w: 4, d: 0.3, h: 2.6, kind: 'cage' }, { x: -3.15, z: -11.5, w: 0.3, d: 5, h: 2.6, kind: 'cage' },
      { x: 4, z: -12.5, w: 0.8, d: 5, h: 2.2, kind: 'shelf' }, { x: 17, z: -12, w: 5, d: 0.8, h: 2.2, kind: 'shelf' },
      { x: 18, z: -3, w: 0.8, d: 0.8, h: 1.0, kind: 'barrel' }, { x: 18.9, z: -3.4, w: 0.8, d: 0.8, h: 1.0, kind: 'barrel' },
      { x: -20, z: -2, w: 1.2, d: 1.2, h: 1.2, kind: 'crate' }, { x: -8, z: -4, w: 3, d: 0.6, h: 2.6, kind: 'wall' },
      { x: 13, z: -14.5, w: 2.4, d: 1.2, h: 2.2, kind: 'boiler' },
    ],
    spawns: [[-24, 18], [-12, 18.5], [0, 18.5], [12, 18.5], [25, 17]],
    spawnsB: [[-24, -18], [-12, -18.5], [0, -18.5], [12, -18.5], [25, -17]],
    extra: (ctx, map) => {
      // pipes along the ceiling, a door at the top of a blocked stairwell, warning signs
      for (const [z, r] of [[-6.5, 0.12], [-6.1, 0.08], [10.5, 0.15]]) ctx.tubeX({ color: 0x5a5e60, rough: 0.4, metal: 0.9 }, r, map.hx * 2, 0, map.wallH - 0.3, z);
      for (const [x, r] of [[-12.5, 0.1], [16.5, 0.14]]) ctx.tubeZ({ map: rustTex, rough: 0.5, metal: 0.8 }, r, map.hz * 2, x, map.wallH - 0.35, 0);
      for (const a of map.acid) {
        ctx.box({ color: 0x2a2c28, rough: 0.9 }, a.w + 0.3, 0.06, 0.15, a.x, 0.03, a.z - a.d / 2 - 0.07);
        ctx.box({ color: 0x2a2c28, rough: 0.9 }, a.w + 0.3, 0.06, 0.15, a.x, 0.03, a.z + a.d / 2 + 0.07);
        ctx.box({ color: 0x2a2c28, rough: 0.9 }, 0.15, 0.06, a.d, a.x - a.w / 2 - 0.07, 0.03, a.z);
        ctx.box({ color: 0x2a2c28, rough: 0.9 }, 0.15, 0.06, a.d, a.x + a.w / 2 + 0.07, 0.03, a.z);
      }
      for (const [x, z, ry] of [[-map.hx + 0.02, 6, Math.PI / 2], [map.hx - 0.02, -5, -Math.PI / 2]]) ctx.plane({ map: hazardStripes, basic: true }, 2.4, 0.5, x, 2.2, z, ry);
      // light housings round the tubes, a whiteboard, fuse boxes with LEDs, green exit signs,
      // fire extinguishers, a mop bucket, papers and puddles on the floor, wall pipes
      for (const [x, z] of map.ceiling.lightsAt) ctx.box({ color: 0x8a8c88, rough: 0.5, metal: 0.6 }, 2.0, 0.08, 0.62, x, map.wallH - 0.08, z);
      ctx.plane({ map: boardTex('white'), rough: 0.3 }, 3.2, 1.6, -10, 1.7, map.hz - 0.03, Math.PI);
      for (const [x, z, ry] of [[map.hx - 0.06, 11, -Math.PI / 2], [-map.hx + 0.06, -10, Math.PI / 2], [12, -map.hz + 0.06, 0]]) {
        const f = ctx.box({ color: 0x5a5e5a, rough: 0.5, metal: 0.7 }, 0.6, 0.8, 0.12, x, 1.6, z); f.rotation.y = ry;
        const l = ctx.box({ emissive: 0xff3020 }, 0.04, 0.04, 0.02, x + Math.sin(ry) * 0.07, 1.85, z + Math.cos(ry) * 0.07); l.rotation.y = ry;
      }
      for (const [x, z, ry] of [[0, map.hz - 0.03, Math.PI], [0, -map.hz + 0.03, 0], [-map.hx + 0.03, 0, Math.PI / 2], [map.hx - 0.03, 0, -Math.PI / 2]]) ctx.plane({ emissiveMap: neonTex('EXIT', '#40ff70') }, 0.9, 0.3, x, 2.9, z, ry);
      for (const [x, z] of [[-map.hx + 0.2, 9], [map.hx - 0.2, -11], [-3, map.hz - 0.2], [15, -map.hz + 0.2]]) { ctx.cylinder({ color: 0xb01a14, rough: 0.4, metal: 0.3 }, 0.09, 0.5, x, 1.05, z, 10); ctx.box({ color: 0x1a1a1a, rough: 0.5 }, 0.06, 0.1, 0.06, x, 1.35, z); }
      ctx.cylinder({ color: 0xd0b020, rough: 0.5 }, 0.22, 0.35, -9.5, 0.18, -14.5, 12); ctx.box({ color: 0x8a6a40, rough: 0.8 }, 0.03, 1.3, 0.03, -9.4, 0.75, -14.5);
      const rng = mulberry32(53);
      for (let i = 0; i < 38; i++) { const pp = ctx.floorPlane({ color: [0xeeeae0, 0xd8d0c0, 0xe0e8f0][i % 3], rough: 0.85 }, 0.21, 0.297, (rng() - 0.5) * map.hx * 1.9, 0.011 + i * 0.0002, (rng() - 0.5) * map.hz * 1.9); pp.rotation.z = rng() * 6.3; }
      for (const [x, z, sz] of [[-18, 0, 1.4], [20, 4, 1.1], [-2, -14, 1.2], [4, 15, 1.0]]) ctx.floorPlane({ color: 0x0a0e0c, rough: 0.04, metal: 0.2 }, sz * 1.5, sz, x, 0.012, z);
      for (const [x, z] of [[-map.hx + 0.15, -16], [map.hx - 0.15, 16], [-20, map.hz - 0.15], [20, -map.hz + 0.15]]) ctx.cylinder({ map: rustTex, rough: 0.5, metal: 0.8 }, 0.09, map.wallH, x, map.wallH / 2, z, 10);
    },
  },
};
export const MAP_IDS = Object.keys(MAPS);

// Small versions for small fights (2 to 4 fighters, chosen in js/battle/battle.js): Winter Cabin
// and the School Basement at their old size and layout, with the same look and lamps.
export const SMALL = {
  winter: { ...MAPS.winter, small: true, hx: 26, hz: 20, layout: MAPS.winter.layout.filter((e) => !WINTER_RING.includes(e)),
    spawns: [[-20, 18], [-8, 18.5], [3, 18.5], [21, 18], [23, 6]], spawnsB: [[-18, -18, 2], [-11, -18, 2], [4, -18.5], [16, -18], [23, -10]] },
  school: { ...MAPS.school, small: true, hx: 22, hz: 16, layout: MAPS.school.layout.filter((e) => !SCHOOL_MORE.includes(e)),
    ceiling: { ...MAPS.school.ceiling, lightsAt: [[-14, 12], [6, 12], [-6, -1], [12, -2], [-16, -10], [8, -13]] },
    spawns: [[-18, 13], [-8, 14.5], [5, 15], [17, 14], [20, 2]], spawnsB: [[-19, -10.5, 1.2], [-7, -14.5], [8, -14.5], [19, -14.5], [20, -7]] },
};
