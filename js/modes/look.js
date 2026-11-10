// How the match maps look (the Battle maps keep Battle's own scenery). Everything is drawn in
// code on small canvases; no image files. Boxes are merged per look into a few meshes:
// walls and floors tile in world space, furniture is fitted per face.
import * as THREE from '../../vendor/three/three.module.min.js?v=2bc20c5-mwb9w9ii';

/* ---------- textures ---------- */
const cache = new Map();
let bakeScale = 1;
function canvasTex(key, w, h, draw, repeat = true) {
  if (bakeScale === 1 && cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas'); cv.width = w * bakeScale; cv.height = h * bakeScale;
  const g = cv.getContext('2d'); g.scale(bakeScale, bakeScale);
  let seed = 0;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  draw(g, w, h, rnd);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.surface = key;
  if (bakeScale === 1) cache.set(key, t);
  return t;
}
const noise = (g, w, h, rnd, n, cols, size = 2, alpha = 0.15) => {
  for (let i = 0; i < n; i++) { g.globalAlpha = rnd() * alpha; g.fillStyle = cols[(rnd() * cols.length) | 0]; const s = 0.5 + rnd() * size; g.fillRect(rnd() * w, rnd() * h, s, s); }
  g.globalAlpha = 1;
};
const fill = (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); };

const TEX = {
  grass: () => canvasTex('grass', 256, 256, (g, w, h, r) => { fill(g, w, h, '#5d7a3a'); noise(g, w, h, r, 5000, ['#4a6630', '#6f8c45', '#7a9a4c', '#3f5a28'], 2.5, 0.5); }),
  lawn: () => canvasTex('lawn', 256, 256, (g, w, h, r) => { fill(g, w, h, '#62873f'); g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, w / 2, h); noise(g, w, h, r, 4000, ['#557a35', '#6f9648', '#4b6e2f'], 2, 0.45); }),
  dirt: () => canvasTex('dirt', 256, 256, (g, w, h, r) => { fill(g, w, h, '#8a7458'); noise(g, w, h, r, 4500, ['#76624a', '#9c8566', '#6a5640', '#a8916f'], 3, 0.5); }),
  asphalt: () => canvasTex('asphalt', 256, 256, (g, w, h, r) => { fill(g, w, h, '#55565a'); noise(g, w, h, r, 5000, ['#45464a', '#68696d', '#3c3d40'], 1.5, 0.6); }),
  concrete: () => canvasTex('concrete', 256, 256, (g, w, h, r) => { fill(g, w, h, '#9a968e'); noise(g, w, h, r, 3000, ['#8a867e', '#aaa69e', '#7c786f'], 3, 0.35); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); }),
  wood: () => canvasTex('wood', 256, 256, (g, w, h, r) => {
    for (let y = 0; y < h; y += 32) { const l = 120 + r() * 30; g.fillStyle = 'rgb(' + (l + 40 | 0) + ',' + (l | 0) + ',' + (l - 45 | 0) + ')'; g.fillRect(0, y, w, 32); g.fillStyle = 'rgba(40,25,10,0.45)'; g.fillRect(0, y, w, 2); const cut = r() * w; g.fillRect(cut, y, 2, 32); }
    for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(60,35,15,' + r() * 0.12 + ')'; g.fillRect(r() * w, r() * h, 10 + r() * 40, 1); }
  }),
  carpet: () => canvasTex('carpet', 128, 128, (g, w, h, r) => { fill(g, w, h, '#6e2a2e'); noise(g, w, h, r, 3000, ['#5a1f22', '#82363a'], 1.2, 0.5); g.strokeStyle = 'rgba(220,180,90,0.25)'; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16); }),
  carpet2: () => canvasTex('carpet2', 128, 128, (g, w, h, r) => { fill(g, w, h, '#45505e'); noise(g, w, h, r, 3000, ['#3a4452', '#525e6e'], 1.2, 0.5); }),
  tiles: () => canvasTex('tiles', 128, 128, (g, w, h, r) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? '#d8d4ca' : '#bcb6aa'; g.fillRect(x * 64, y * 64, 64, 64); } g.strokeStyle = 'rgba(80,70,60,0.5)'; g.lineWidth = 2; for (let i = 0; i <= 128; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); } noise(g, w, h, r, 600, ['#000', '#fff'], 1.5, 0.08); }),
  tiles2: () => canvasTex('tiles2', 128, 128, (g, w, h, r) => { fill(g, w, h, '#e6e6e2'); g.strokeStyle = 'rgba(90,100,110,0.55)'; g.lineWidth = 2; for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); } noise(g, w, h, r, 500, ['#000'], 1.5, 0.06); }),
  marble: () => canvasTex('marble', 256, 256, (g, w, h, r) => { fill(g, w, h, '#e8e4dc'); for (let i = 0; i < 30; i++) { g.strokeStyle = 'rgba(120,110,100,' + (0.05 + r() * 0.12) + ')'; g.lineWidth = 1 + r() * 2; g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 80; y += (r() - 0.5) * 80; g.lineTo(x, y); } g.stroke(); } g.strokeStyle = 'rgba(80,70,60,0.3)'; g.strokeRect(0, 0, w, h); }),
  stone: () => canvasTex('stone', 256, 256, (g, w, h, r) => { fill(g, w, h, '#8f8a80'); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const l = 130 + r() * 30; g.fillStyle = 'rgb(' + (l | 0) + ',' + (l - 4 | 0) + ',' + (l - 12 | 0) + ')'; g.fillRect(x * 64 + 2 + (y % 2) * 32, y * 64 + 2, 60, 60); } noise(g, w, h, r, 1500, ['#000', '#fff'], 2, 0.08); }),
  // walls: plaster with a skirting board and a top trim (the texture spans the wall height)
  house: () => canvasTex('house', 128, 256, (g, w, h, r) => {
    fill(g, w, h, '#ddd5c4'); noise(g, w, h, r, 2500, ['#cfc6b4', '#e8e0d0', '#c4bba8'], 2, 0.35);
    g.fillStyle = '#6a5440'; g.fillRect(0, h - 14, w, 14); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 15, w, 2);
    g.fillStyle = '#b8ad98'; g.fillRect(0, 0, w, 8); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, h * 0.55, w, 2);
  }),
  walltop: () => canvasTex('walltop', 64, 64, (g, w, h, r) => { fill(g, w, h, '#a49c8c'); noise(g, w, h, r, 300, ['#8a8270'], 2, 0.4); }),
  block: () => canvasTex('block', 256, 256, (g, w, h, r) => { fill(g, w, h, '#a9a49a'); for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { const l = 150 + r() * 25; g.fillStyle = 'rgb(' + (l | 0) + ',' + (l - 3 | 0) + ',' + (l - 8 | 0) + ')'; g.fillRect(x * 64 + (y % 2) * 32 + 2, y * 32 + 2, 60, 28); } }),
  crate: () => canvasTex('crate', 128, 128, (g, w, h, r) => { fill(g, w, h, '#8a6a43'); for (let y = 0; y < h; y += 16) { g.fillStyle = 'rgba(40,25,10,' + (0.2 + r() * 0.2) + ')'; g.fillRect(0, y, w, 2); } g.strokeStyle = '#5a4128'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12); g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.stroke(); }, false),
  carSide: () => canvasTex('carSide', 256, 128, (g, w, h) => {
    fill(g, w, h, '#ffffff');
    g.fillStyle = '#20262c'; g.beginPath(); g.moveTo(40, 10); g.lineTo(200, 10); g.lineTo(230, 50); g.lineTo(20, 50); g.closePath(); g.fill();
    g.fillStyle = 'rgba(160,200,230,0.5)'; g.fillRect(50, 16, 70, 28); g.fillRect(126, 16, 70, 28);
    g.fillStyle = '#111'; for (const x of [60, 196]) { g.beginPath(); g.arc(x, 112, 24, 0, Math.PI * 2); g.fill(); g.fillStyle = '#888'; g.beginPath(); g.arc(x, 112, 10, 0, Math.PI * 2); g.fill(); g.fillStyle = '#111'; }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 70, w, 3); g.fillStyle = '#ffd88a'; g.fillRect(w - 10, 62, 10, 10); g.fillStyle = '#c03020'; g.fillRect(0, 62, 8, 10);
  }, false),
  carTop: () => canvasTex('carTop', 128, 256, (g, w, h) => { fill(g, w, h, '#ffffff'); g.fillStyle = '#20262c'; g.fillRect(10, 60, w - 20, 130); g.fillStyle = 'rgba(160,200,230,0.4)'; g.fillRect(16, 66, w - 32, 30); g.fillRect(16, 156, w - 32, 28); }, false),
  shelf: () => canvasTex('shelf', 128, 256, (g, w, h, r) => {
    fill(g, w, h, '#5a4430');
    for (let y = 10; y < h - 10; y += 60) { g.fillStyle = '#3a2a1c'; g.fillRect(6, y, w - 12, 52); let x = 8; while (x < w - 12) { const bw = 6 + r() * 10; g.fillStyle = ['#a33', '#36a', '#3a5', '#aa3', '#777', '#a63'][(r() * 6) | 0]; g.fillRect(x, y + 8 + r() * 10, bw - 1, 44 - r() * 10); x += bw; } g.fillStyle = '#6a5038'; g.fillRect(4, y + 52, w - 8, 6); }
  }, false),
  bedTop: () => canvasTex('bedTop', 128, 256, (g, w, h) => { fill(g, w, h, '#3d5c8a'); g.fillStyle = '#e8e4da'; g.fillRect(14, 10, w - 28, 50); g.fillStyle = 'rgba(255,255,255,0.15)'; for (let y = 70; y < h; y += 24) g.fillRect(0, y, w, 6); }, false),
  fabric: () => canvasTex('fabric', 128, 128, (g, w, h, r) => { fill(g, w, h, '#6b5a4a'); noise(g, w, h, r, 2000, ['#5a4a3c', '#7c6a58'], 1.2, 0.5); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, h * 0.45, w, 3); }, false),
  tableTop: () => canvasTex('tableTop', 128, 128, (g, w, h, r) => { for (let y = 0; y < h; y += 16) { const l = 135 + r() * 20; g.fillStyle = 'rgb(' + (l + 30 | 0) + ',' + (l | 0) + ',' + (l - 40 | 0) + ')'; g.fillRect(0, y, w, 16); } g.strokeStyle = 'rgba(40,25,10,0.5)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4); }, false),
  cabinet: () => canvasTex('cabinet', 128, 128, (g, w, h) => { fill(g, w, h, '#7a6248'); g.strokeStyle = 'rgba(30,20,10,0.6)'; g.lineWidth = 3; g.strokeRect(8, 18, w / 2 - 12, h - 26); g.strokeRect(w / 2 + 4, 18, w / 2 - 12, h - 26); g.fillStyle = '#c8b070'; g.fillRect(w / 2 - 10, h / 2, 4, 12); g.fillRect(w / 2 + 6, h / 2, 4, 12); g.fillStyle = '#5a4430'; g.fillRect(0, 0, w, 12); }, false),
  barrier: () => canvasTex('barrier', 128, 128, (g, w, h, r) => { fill(g, w, h, '#d8d4cc'); noise(g, w, h, r, 800, ['#a8a49c'], 2, 0.4); for (let x = -h; x < w; x += 32) { g.fillStyle = '#d63a22'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 16 + 24, 24); g.lineTo(x + 24, 24); g.fill(); } }, false),
  planterTop: () => canvasTex('planterTop', 128, 128, (g, w, h, r) => { fill(g, w, h, '#3d5a28'); for (let i = 0; i < 60; i++) { g.fillStyle = ['#4f7a30', '#2f4a1e', '#6a9a3c', '#d06a8a'][(r() * 4) | 0]; g.beginPath(); g.arc(r() * w, r() * h, 4 + r() * 10, 0, 7); g.fill(); } }, false),
  water: () => canvasTex('water', 128, 128, (g, w, h, r) => { fill(g, w, h, '#3a7aa8'); for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(255,255,255,' + r() * 0.3 + ')'; g.beginPath(); g.arc(r() * w, r() * h, 4 + r() * 18, 0, 7); g.stroke(); } g.strokeStyle = '#9a968e'; g.lineWidth = 14; g.strokeRect(0, 0, w, h); }, false),
  softWall: () => canvasTex('softWall', 128, 256, (g, w, h, r) => { fill(g, w, h, '#d6cbb2'); noise(g, w, h, r, 1500, ['#c4b89e', '#e2d8c0'], 2, 0.35); g.strokeStyle = 'rgba(120,100,70,0.35)'; g.lineWidth = 2; g.strokeRect(4, 4, w - 8, h - 8); g.fillStyle = '#6a5440'; g.fillRect(0, h - 12, w, 12); }),
  metal: () => canvasTex('metal', 128, 256, (g, w, h, r) => { fill(g, w, h, '#6b7480'); noise(g, w, h, r, 2500, ['#5a626e', '#7c8590'], 1.5, 0.45); g.fillStyle = '#3c434c'; for (const y of [10, h / 2, h - 10]) for (let x = 10; x < w; x += 27) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); } g.fillStyle = 'rgba(255,200,40,0.6)'; g.fillRect(0, h - 30, w, 6); }),
  boards: () => canvasTex('boards', 128, 256, (g, w, h, r) => {
    fill(g, w, h, '#000'); for (let x = 0; x < w; x += 32) { const l = 110 + r() * 30; g.fillStyle = 'rgb(' + (l + 30 | 0) + ',' + (l | 0) + ',' + (l - 40 | 0) + ')'; g.fillRect(x + 1, 0, 30, h); }
    g.fillStyle = '#5a4128'; g.save(); g.translate(w / 2, h / 2); g.rotate(-1.1); g.fillRect(-150, -9, 300, 18); g.restore();
    g.fillStyle = '#4a3420'; g.fillRect(0, 24, w, 16); g.fillRect(0, h - 40, w, 16);
  }),
  fence: () => canvasTex('fence', 128, 128, (g, w, h, r) => { fill(g, w, h, '#b4aea2'); noise(g, w, h, r, 1500, ['#9a948a', '#c4beb2'], 2, 0.4); g.fillStyle = 'rgba(0,0,0,0.15)'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h); }),
  deck: () => canvasTex('deck', 256, 256, (g, w, h, r) => { for (let x = 0; x < w; x += 32) { const l = 150 + r() * 25; g.fillStyle = 'rgb(' + (l + 20 | 0) + ',' + (l | 0) + ',' + (l - 35 | 0) + ')'; g.fillRect(x, 0, 30, h); g.fillStyle = 'rgba(40,25,10,0.5)'; g.fillRect(x + 30, 0, 2, h); } noise(g, w, h, r, 600, ['#6a5030'], 2, 0.25); }),
  barn: () => canvasTex('barn', 128, 256, (g, w, h, r) => { for (let x = 0; x < w; x += 21) { const l = 120 + r() * 25; g.fillStyle = 'rgb(' + (l + 40 | 0) + ',' + (l * 0.35 | 0) + ',' + (l * 0.3 | 0) + ')'; g.fillRect(x, 0, 20, h); g.fillStyle = 'rgba(30,10,5,0.5)'; g.fillRect(x + 20, 0, 1, h); } g.fillStyle = '#e8e0d0'; g.fillRect(0, 0, w, 6); }),
  rust: () => canvasTex('rust', 256, 256, (g, w, h, r) => { fill(g, w, h, '#7a3a28'); for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x + 8, 0, 2, h); } noise(g, w, h, r, 1500, ['#5a2a1c', '#9a5a3a', '#4a3a30'], 3, 0.5); }),
  ceiling: () => canvasTex('ceiling', 128, 128, (g, w, h, r) => { fill(g, w, h, '#d9d4c8'); noise(g, w, h, r, 900, ['#c8c2b4', '#e4e0d6'], 2, 0.3); g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); }),
  railTex: () => canvasTex('railTex', 64, 64, (g, w, h) => { fill(g, w, h, '#4a3a2a'); g.fillStyle = '#6a5440'; g.fillRect(0, 0, w, 10); for (let x = 4; x < w; x += 12) g.fillRect(x, 10, 4, h - 10); }, false),
  bark: () => canvasTex('bark', 32, 64, (g, w, h, r) => { fill(g, w, h, '#5a4230'); noise(g, w, h, r, 300, ['#3a2a1c', '#6a5038'], 3, 0.6); }),
  leaves: () => canvasTex('leaves', 64, 64, (g, w, h, r) => { fill(g, w, h, '#3c6428'); noise(g, w, h, r, 800, ['#2a4a1c', '#4e7c34', '#5c8a3c'], 4, 0.7); }),
};

// Looks: side and top textures; 'tile' [w, h] metres in world space, or fitted per face.
// tint: multiplies the texture (cars get a paint colour each).
const LOOKS = {
  house: { side: 'house', top: 'walltop', tile: [2.4, 3.2] },
  wall: { side: 'block', top: 'walltop', tile: [2, 2] },
  edge: { side: 'fence', top: 'walltop', tile: [2, 2] },
  low: { side: 'concrete', top: 'concrete', tile: [1.5, 1.5] },
  upper: { side: 'concrete', top: 'concrete', tile: [2, 2] },
  crate: { side: 'crate', top: 'crate', fit: true },
  car: { side: 'carSide', top: 'carTop', fit: true, paint: true, frontColor: 0x2a2a2a },
  shelf: { side: 'shelf', top: 'walltop', fit: true },
  bed: { side: 'fabric', top: 'bedTop', fit: true },
  sofa: { side: 'fabric', top: 'fabric', fit: true },
  table: { side: 'cabinet', top: 'tableTop', fit: true },
  desk: { side: 'cabinet', top: 'tableTop', fit: true },
  counter: { side: 'cabinet', top: 'marble', fit: true },
  bench: { side: 'cabinet', top: 'concrete', fit: true },
  barrier: { side: 'barrier', top: 'concrete', fit: true },
  planter: { side: 'stone', top: 'planterTop', fit: true },
  fountain: { side: 'stone', top: 'water', fit: true },
  fence: { side: 'fence', top: 'walltop', tile: [2, 1.1] },
  container: { side: 'rust', top: 'rust', tile: [2.6, 2.6] },
  barn: { side: 'barn', top: 'walltop', tile: [2.4, 3.2] },
  stair: { side: 'wood', top: 'wood', tile: [1.2, 1.2] },
  rail: { side: 'railTex', top: 'tableTop', fit: true },
};
// upper floors: the room's floor on top, a ceiling underneath
for (const f of ['wood', 'carpet', 'carpet2', 'tiles', 'tiles2', 'concrete', 'marble', 'stone', 'deck']) LOOKS['slab-' + f] = { side: 'walltop', top: f, bottom: 'ceiling', tile: [f === 'wood' || f === 'deck' ? 3 : f.startsWith('carpet') ? 2 : 1.6, 1.6] };
const PAINTS = [0xb03a2e, 0x2e5ea8, 0xe8e4dc, 0x2a2c30, 0x6a7a3a, 0xc8a040, 0x707880];
const GROUND = { grass: 'grass', lawn: 'lawn', dirt: 'dirt', asphalt: 'asphalt' };

// A box as quads (no bottom face) with UVs: world-tiled or fitted per face.
function addBox(acc, b, look, tint) {
  const x0 = b.minX, x1 = b.maxX, y0 = Math.max(0, b.minY), y1 = b.maxY, z0 = b.minZ, z1 = b.maxZ;
  const [tw, th] = look.tile || [1, 1];
  const fit = !!look.fit;
  const quad = (part, p, n, uv) => {
    const a = acc[part] || (acc[part] = { pos: [], nor: [], uv: [], col: [] });
    for (const i of [0, 1, 2, 0, 2, 3]) { a.pos.push(...p[i]); a.nor.push(...n); a.uv.push(...uv[i]); a.col.push(tint.r, tint.g, tint.b); }
  };
  const side = (p, n, alongA, alongB) => {
    // world tiled: u along the face, v = height / tile (the skirting sits at the floor)
    quad('side', p, n, fit ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[alongA / tw, y0 / th], [alongB / tw, y0 / th], [alongB / tw, y1 / th], [alongA / tw, y1 / th]]);
  };
  side([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], x0, x1);
  side([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], -x1, -x0);
  side([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], -z1, -z0);
  side([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], z0, z1);
  const tu = fit ? [[0, 1], [1, 1], [1, 0], [0, 0]] : [[x0 / tw, z1 / tw], [x1 / tw, z1 / tw], [x1 / tw, z0 / tw], [x0 / tw, z0 / tw]];
  // fitted tops run along the long side (cars, beds)
  const long = (x1 - x0) > (z1 - z0);
  const fitTop = long ? [[0, 0], [0, 1], [1, 1], [1, 0]] : tu;
  quad('top', [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], fit ? fitTop : tu);
  // a box off the floor (an upper floor, a lintel): its underside too
  if (y0 > 0.05) quad('bottom', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], fit ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[x0 / tw, z0 / tw], [x1 / tw, z0 / tw], [x1 / tw, z1 / tw], [x0 / tw, z1 / tw]]);
}
function meshFrom(a, map, shadow) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map, vertexColors: true }));
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

// Which look a solid box gets.
function lookOf(b) {
  if (b.look && LOOKS[b.look]) return b.look;
  if (b.kind === 'edge') return 'edge';
  if (b.kind === 'upper') return 'upper';
  if (b.kind === 'low' || b.maxY < 1.4) return 'low';
  if (b.kind === 'soft-top' || b.kind === 'reinforced-top') return 'house';
  return 'wall';
}

/* ---------- the scene ---------- */
// Builds the ground, room floors, walls and furniture, and some trees and a fence outside.
export function buildMapLook(scene, map, L) {
  const data = map.data, group = new THREE.Group();
  // sky: a vertical gradient on a big sphere
  const sky = canvasTex('sky' + L.sky, 4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5a86c0'); gr.addColorStop(0.55, '#' + new THREE.Color(L.sky).getHexString()); gr.addColorStop(1, '#e8ecef'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -1;
  group.add(dome);
  // ground (the area around), then each room's floor
  const gt = TEX[GROUND[data.ground] || (data.building ? 'grass' : 'concrete')]().clone();
  gt.needsUpdate = true; gt.userData.own = true; gt.repeat.set(map.hx / 3, map.hz / 3);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.hx * 2 + 40, map.hz * 2 + 40), new THREE.MeshLambertMaterial({ map: gt }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  gt.repeat.set((map.hx * 2 + 40) / 6, (map.hz * 2 + 40) / 6);
  group.add(ground);
  for (const c of data.callouts || []) {
    if (!c.floor || !TEX[c.floor] || c.y) continue;           // (upper floors: the slab's top)
    const w = c.x1 - c.x0, d = c.z1 - c.z0, t = TEX[c.floor]().clone();
    t.needsUpdate = true; t.userData.own = true;
    const tile = c.floor === 'wood' ? 3 : c.floor.startsWith('carpet') ? 2 : c.floor === 'marble' || c.floor === 'stone' ? 3 : 1.6;
    t.repeat.set(w / tile, d / tile);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    f.rotation.x = -Math.PI / 2; f.position.set((c.x0 + c.x1) / 2, 0.004, (c.z0 + c.z1) / 2); f.receiveShadow = true;
    group.add(f);
  }
  // solids by look
  const acc = {}, col = new THREE.Color();
  let k = 0;
  for (const b of map.solids) {
    if (b.panel !== undefined) continue;
    const name = lookOf(b), look = LOOKS[name];
    col.setRGB(1, 1, 1);
    if (look.paint) col.setHex(PAINTS[k++ % PAINTS.length]);
    else col.multiplyScalar(0.94 + ((b.i * 7) % 5) * 0.025);
    const a = acc[name] || (acc[name] = {});
    addBox(a, b, look, col);
  }
  for (const [name, parts] of Object.entries(acc)) {
    const look = LOOKS[name];
    for (const [part, a] of Object.entries(parts)) group.add(meshFrom(a, TEX[part === 'top' ? look.top : part === 'bottom' ? look.bottom || 'ceiling' : look.side](), name !== 'edge'));
  }
  // outside: trees and bushes where nothing is in the way, a fence round the edge
  if (data.building) {
    const [bx0, bz0, bx1, bz1] = data.building;
    let s = 99;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const trees = [], bushes = [];
    for (let i = 0; i < 400 && trees.length < 26; i++) {
      const x = (rnd() * 2 - 1) * (map.hx - 1.5), z = (rnd() * 2 - 1) * (map.hz - 1.5);
      if (x > bx0 - 4 && x < bx1 + 4 && z > bz0 - 4 && z < bz1 + 4) continue;
      if (!map.free(x, z, 1.2)) continue;
      // only near the edges (keep the yards open), away from spawns
      const edge = Math.min(map.hx - Math.abs(x), map.hz - Math.abs(z));
      if (edge > 4.5) { if (rnd() < 0.5 && bushes.length < 30) bushes.push([x, z]); continue; }
      if ((data.spawns.A || []).some((p) => Math.hypot(p[0] - x, p[1] - z) < 3)) continue;
      trees.push([x, z, 0.8 + rnd() * 0.5]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.26, 2.6, 7), new THREE.MeshLambertMaterial({ map: TEX.bark() }), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.8, 1), new THREE.MeshLambertMaterial({ map: TEX.leaves(), flatShading: true }), trees.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    trees.forEach(([x, z, s1], i) => {
      trunk.setMatrixAt(i, mtx.compose(p.set(x, 1.3 * s1, z), q, sc.set(s1, s1, s1)));
      crown.setMatrixAt(i, mtx.compose(p.set(x, 3.6 * s1, z), q.setFromEuler(new THREE.Euler(0, i, 0)), sc.set(s1 * 1.1, s1 * 1.25, s1 * 1.1)));
    });
    q.identity();
    trunk.castShadow = crown.castShadow = true;
    const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshLambertMaterial({ map: TEX.leaves(), flatShading: true }), bushes.length);
    bushes.forEach(([x, z], i) => bush.setMatrixAt(i, mtx.compose(p.set(x, 0.35, z), q, sc.set(1.2, 0.7, 1.2))));
    group.add(trunk, crown, bush);
  }
  scene.add(group);
  return group;
}

// Textures for the breakable panels (soft walls, reinforced walls, boarded doors).
export function panelTextures() { return { soft: TEX.softWall(), reinforced: TEX.metal(), door: TEX.boards() }; }

// Offline authoring: rerun the original vector patterns at higher resolution.
export function bakeMapSurface(name, scale = 4) { bakeScale = scale; try { return TEX[name](); } finally { bakeScale = 1; } }
