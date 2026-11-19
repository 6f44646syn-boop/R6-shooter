// The Mist: overgrown ruins in a marsh wood, in thick fog, laid out as a maze that is new every match
// (from a seed, so everyone online gets the same one). Crumbling stone walls (some low enough to vault,
// some with arches), pillars, dead trees, reed beds and pools with plank walkways, moss and roots.
// mistMap(seed, size): size 'battle' (about 45 m square), 'match' (64 m: TDM / CTF, spawns west and east)
// or 'royale' (160 x 128 m, with chests). Everything sits on the 3.2 m build grid.
import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace } from '../../vendor/three/three.module.min.js?v=8bb16fc-mwnzky3l';
import { mulberry32 } from '../core/prng.js?v=8bb16fc-mwnzky3l';
import { surface, surfacePicture } from '../render/surfaces.js?v=8bb16fc-mwnzky3l';
import { wallPanels } from '../scene/range-tex.js?v=8bb16fc-mwnzky3l';

const G = 3.2, C = 2 * G;                                     // the build grid; a maze cell is two grid cells
const SIZES = { battle: [22.4, 22.4], match: [32, 32], royale: [80, 64] };

function fogSky() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#9aa49f'); gr.addColorStop(0.5, '#c4cbc5'); gr.addColorStop(1, '#8f988f');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; return t;
}
// marsh ground: dark peat and moss, puddles, roots
function marshFloor(hx, hz) {
  return () => {
    const P = 4, w = Math.round(hx * 2 * P), h = Math.round(hz * 2 * P), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), img = g.createImageData(w, h), r = mulberry32(61);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const at = (y * w + x) * 4, n = r() - 0.5, s = 10 * Math.sin(x * 0.07 + y * 0.05) + 6 * Math.cos(x * 0.19 - y * 0.13);
      img.data[at] = 62 + s + n * 20; img.data[at + 1] = 74 + s + n * 22; img.data[at + 2] = 52 + s * 0.6 + n * 14; img.data[at + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '38,46,34' : '96,110,70'},${0.15 + r() * 0.25})`; g.beginPath(); g.ellipse(r() * w, r() * h, 3 + r() * 16, 2 + r() * 10, r() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(48,38,28,.55)'; g.lineWidth = 2;
    for (let i = 0; i < 120; i++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    const map = new CanvasTexture(cv); map.wrapS = map.wrapT = RepeatWrapping; map.colorSpace = SRGBColorSpace;
    return { map, tileX: hx * 2, tileZ: hz * 2, rough: 1, keepInLow: true };
  };
}

export function mistMap(seed = 1, size = 'battle') {
  const [hx, hz] = SIZES[size] || SIZES.battle, r = mulberry32(seed >>> 0 || 1);
  const nx = Math.floor(2 * hx / C), nz = Math.floor(2 * hz / C), x0 = -nx * C / 2, z0 = -nz * C / 2;
  const box = (x, z, w, d, h, kind, y = 0) => ({ x, z, w, d, h, kind, y });
  const layout = [], decor = { pools: [], reeds: [], trees: [], moss: [], arches: [], planks: [] };
  // the maze: a randomised depth-first carve, then more walls knocked through (loops, so fights flow)
  const open = new Set(), key = (a, b) => a < b ? a + '|' + b : b + '|' + a, id = (i, j) => j * nx + i;
  const seen = new Uint8Array(nx * nz), stack = [[Math.floor(r() * nx), Math.floor(r() * nz)]];
  seen[id(...stack[0])] = 1;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1], next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [i + a, j + b]).filter(([a, b]) => a >= 0 && b >= 0 && a < nx && b < nz && !seen[id(a, b)]);
    if (!next.length) { stack.pop(); continue; }
    const [a, b] = next[Math.floor(r() * next.length)];
    open.add(key(id(i, j), id(a, b))); seen[id(a, b)] = 1; stack.push([a, b]);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) for (const [a, b] of [[i + 1, j], [i, j + 1]]) if (a < nx && b < nz && r() < 0.28) open.add(key(id(i, j), id(a, b)));
  // a few open clearings (2 x 2 cells): no walls inside
  const clearings = [];
  for (let k = 0; k < Math.max(1, Math.round(nx * nz / 28)); k++) {
    const i = Math.floor(r() * (nx - 1)), j = Math.floor(r() * (nz - 1)); clearings.push([i, j]);
    for (const [a, b, c, d] of [[i, j, i + 1, j], [i, j + 1, i + 1, j + 1], [i, j, i, j + 1], [i + 1, j, i + 1, j + 1]]) open.add(key(id(a, b), id(c, d)));
  }
  // walls between closed neighbours: a ruined wall, a broken low one (vault it) or an arch you walk through
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) for (const [a, b, alongX] of [[i + 1, j, false], [i, j + 1, true]]) {
    if (a >= nx || b >= nz) continue;
    const cx = x0 + (alongX ? i + 0.5 : i + 1) * C, cz = z0 + (alongX ? j + 1 : j + 0.5) * C, W = alongX ? C : 0.6, D = alongX ? 0.6 : C;
    if (open.has(key(id(i, j), id(a, b)))) { if (r() < 0.12) decor.arches.push([cx, cz, alongX]); continue; }
    const t = r();
    if (t < 0.62) layout.push(box(cx, cz, W, D, 3.2 + r() * 1.4, 'ruin'));
    else if (t < 0.85) layout.push(box(cx, cz, W, D, 1.0 + r() * 0.4, 'ruin'));             // low enough to vault or shoot over
    else {                                                                                    // half a wall still standing
      const h1 = 3.2 + r(), off = (r() < 0.5 ? -1 : 1) * C / 4;
      layout.push(box(cx + (alongX ? off : 0), cz + (alongX ? 0 : off), alongX ? C / 2 : 0.6, alongX ? 0.6 : C / 2, h1, 'ruin'));
      layout.push(box(cx - (alongX ? off : 0), cz - (alongX ? 0 : off), alongX ? C / 2 : 0.6, alongX ? 0.6 : C / 2, 0.6 + r() * 0.5, 'ruin'));
    }
  }
  // arches over some openings: two piers and a lintel (you walk under it)
  for (const [cx, cz, alongX] of decor.arches) {
    for (const s of [-1, 1]) layout.push(box(cx + (alongX ? s * (C / 2 - 0.4) : 0), cz + (alongX ? 0 : s * (C / 2 - 0.4)), 0.8, 0.8, 4.2, 'ruin'));
    layout.push(box(cx, cz, alongX ? C : 0.8, alongX ? 0.8 : C, 0.7, 'ruin', 3.5));
  }
  // pillars at some corners, dead trees, pools with walkways and reeds, in the cells
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) if (r() < 0.16) layout.push(box(x0 + i * C, z0 + j * C, 0.8, 0.8, 4 + r() * 2.5, 'pillar'));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const cx = x0 + (i + 0.5) * C, cz = z0 + (j + 0.5) * C, t = r();
    if (t < 0.16) { const h = 5 + r() * 3; decor.trees.push([cx + (r() - 0.5) * 2, cz + (r() - 0.5) * 2, h]); layout.push(box(decor.trees.at(-1)[0], decor.trees.at(-1)[1], 0.55, 0.55, h, 'deadwood')); }
    else if (t < 0.3) { decor.pools.push([cx, cz, 2.2 + r() * 1.2]); layout.push(box(cx, cz, C * 0.7, 0.9, 0.18, 'plank')); }   // a walkway across it
    else if (t < 0.36) layout.push(box(cx + (r() - 0.5) * 2, cz + (r() - 0.5) * 2, 1.4 + r(), 1.4 + r(), 0.7 + r() * 0.6, 'ruin'));   // fallen masonry
    for (let k = 0; k < 3; k++) decor.reeds.push([cx + (r() - 0.5) * C * 0.8, cz + (r() - 0.5) * C * 0.8]);
  }
  // spawns: FFA round the edge; for matches, team A on the west edge and B on the east
  const edge = (i, j) => [x0 + (i + 0.5) * C, z0 + (j + 0.5) * C];
  const spawns = size === 'match' ? Array.from({ length: 6 }, (_, k) => edge(0, Math.round((k + 0.5) * nz / 6 - 0.5))) : Array.from({ length: 6 }, (_, k) => k < 3 ? edge(Math.round((k + 0.5) * nx / 3 - 0.5), 0) : edge(Math.round((k - 2.5) * nx / 3 - 0.5), nz - 1));
  const spawnsB = size === 'match' ? spawns.map(([x, z]) => [-x, z]) : spawns.map(([x, z]) => [-x, -z]);
  // Battle Royale: drop points round an oval and chests in dead ends, clearings and under arches
  const chests = [];
  if (size === 'royale') {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const links = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => i + a >= 0 && j + b >= 0 && i + a < nx && j + b < nz && open.has(key(id(i, j), id(i + a, j + b)))).length;
      if (links === 1 && r() < 0.55) chests.push(edge(i, j));                       // dead ends: worth the walk
    }
    for (const [i, j] of clearings) chests.push([x0 + (i + 1) * C, z0 + (j + 1) * C]);
  }
  function extra(ctx) {
    const q = mulberry32(seed ^ 0x9e37), cube = new BoxGeometry(1, 1, 1), ball = new IcosahedronGeometry(1, 0), cone = new ConeGeometry(1, 1, 6), can = new CylinderGeometry(1, 1, 1, 7);
    // pools: dark still water (a little see-through), mossy rims
    ctx.scatter(can, { color: 0x1d2a26, opacity: 0.78 }, decor.pools.map(([x, z, rr]) => [x, 0.03, z, rr, 0.02, rr * 0.8]));
    ctx.scatter(can, { color: 0x3c5a34, rough: 1 }, decor.pools.map(([x, z, rr]) => [x, 0.015, z, rr + 0.35, 0.02, rr * 0.8 + 0.35]));
    // reeds: thin cones in clumps, swaying
    ctx.scatter(cone, { color: 0xffffff, rough: 1, sway: 0.18 }, decor.reeds.flatMap(([x, z]) => Array.from({ length: 5 }, () => [x + (q() - 0.5) * 0.8, 0.5, z + (q() - 0.5) * 0.8, 0.05, 1 + q() * 0.8, 0.05, q() * 6, q() < 0.5 ? 0x6b7a3e : 0x8a8a4c])), [0, 400, 900, 2000]);
    // dead trees: bare branches
    ctx.scatter(cube, { color: 0x3a2f26, rough: 1 }, decor.trees.flatMap(([x, z, h]) => [0, 1, 2, 3].map((k) => { const a = q() * 6.3, l = 1.2 + q() * 1.8; return [x + Math.cos(a) * l / 2, h * (0.55 + k * 0.1), z + Math.sin(a) * l / 2, Math.abs(Math.cos(a)) * l + 0.12, 0.14, Math.abs(Math.sin(a)) * l + 0.12, 0]; })));
    // moss and ivy down the walls, roots and ferns on the ground
    ctx.scatter(ball, { color: 0xffffff, rough: 1 }, layout.filter((b) => b.kind === 'ruin' && b.h > 2).map((b) => [b.x + (q() - 0.5) * b.w * 0.6, b.h * (0.3 + q() * 0.6), b.z + (q() - 0.5) * b.d * 0.6, b.w * 0.45 + 0.2, 0.4 + q() * 0.8, b.d * 0.45 + 0.2, 0, q() < 0.5 ? 0x4f6b36 : 0x3e5a2e]));
    const ferns = [];
    for (let k = 0; k < Math.round(hx * hz * 0.9); k++) ferns.push([(q() - 0.5) * hx * 1.9, 0.15, (q() - 0.5) * hz * 1.9, 0.4 + q() * 0.5, 0.25 + q() * 0.25, 0.4 + q() * 0.5, q() * 6, q() < 0.5 ? 0x4a6a34 : 0x6a7d3e]);
    ctx.scatter(ball, { color: 0xffffff, rough: 1, sway: 0.08 }, ferns, [0, ferns.length * 0.25, ferns.length * 0.6, ferns.length]);
  }
  const map = {
    name: 'The Mist', hx, hz, wallH: 5, mist: true, openEdge: false, sight: 16,
    sky: fogSky, background: 0xb6beb8, fog: [0xb9c1bb, 3, 16],                       // thick: about 15 m
    hemi: [0xd6ddd8, 0x4b5243, 1.9], key: [0xe6ebe6, 1.1, [-30, 70, 20]],
    floor: marshFloor(hx, hz),
    wall: () => ({ ...wallPanels(), tileW: 2, tileH: 4 }),
    kinds: {
      ruin: { ...surface('rock', surfacePicture('rock')), color: 0x8c8f84, rough: 1, tile: 1.6 },
      pillar: { ...surface('rock', surfacePicture('rock')), color: 0x9a9b90, rough: 1, tile: 1.6 },
      deadwood: { ...surface('planks', surfacePicture('planks')), color: 0x4a3c30, rough: 1, tile: 1 },
      plank: { ...surface('planks', surfacePicture('planks')), color: 0x7a6248, rough: 0.95, tile: 1.4 },
      wall: { color: 0x707a72, rough: 0.9 },
    },
    spawns, spawnsB, layout, seed, size, extra,
  };
  if (size === 'royale') map.chests = chests;
  return map;
}
