// The Mist: overgrown ruins in a marsh wood, in thick fog, laid out as a maze that is new every match
// (from a seed, so everyone online gets the same one). Crumbling stone walls (some low enough to vault,
// some with arches), pillars, dead trees, reed beds and pools with plank walkways, moss and roots.
// mistMap(seed, size): size 'battle' (about 45 m square), 'match' (64 m: TDM / CTF, spawns west and east)
// or 'royale' (160 x 128 m, with chests). Everything sits on the 3.2 m build grid.
import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace } from '../../vendor/three/three.module.min.js?v=55df10f-mwol65cb';
import { mulberry32 } from '../core/prng.js?v=55df10f-mwol65cb';
import { surface, surfacePicture } from '../render/surfaces.js?v=55df10f-mwol65cb';

const G = 3.2, C = 2 * G;                                     // the build grid; a maze cell is two grid cells
const SIZES = { battle: [22.4, 22.4], match: [32, 32], royale: [80, 64] };
// Each match rolls a theme: how many walls stay, how many pools and trees, the colour of the fog.
const THEMES = [
  { name: 'Drowned', loops: 0.36, tall: 0.5, low: 0.82, arch: 0.08, pillar: 0.1, tree: 0.1, pool: 0.38, fern: 0.6, fog: 0xa9b6be, ground: 0x46525a },
  { name: 'Overgrown', loops: 0.3, tall: 0.58, low: 0.84, arch: 0.1, pillar: 0.12, tree: 0.32, pool: 0.42, fern: 1.5, fog: 0xa9bba2, ground: 0x41553a },
  { name: 'Old Ruins', loops: 0.22, tall: 0.72, low: 0.9, arch: 0.22, pillar: 0.28, tree: 0.1, pool: 0.16, fern: 0.8, fog: 0xc6c3b8, ground: 0x5a5648 },
];
// Landmarks for the clearings (2 x 2 cells): one of each kind before any repeats.
const LANDMARKS = ['shrine', 'tower', 'camp', 'well', 'statue', 'plinth', 'graveyard', 'henge', 'wreck'];

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

// clear: the No mist option (the same maze, a long view, bots see as far as anywhere else)
export function mistMap(seed = 1, size = 'battle', clear = false) {
  const [hx, hz] = SIZES[size] || SIZES.battle, r = mulberry32(seed >>> 0 || 1);
  const nx = Math.floor(2 * hx / C), nz = Math.floor(2 * hz / C), x0 = -nx * C / 2, z0 = -nz * C / 2;
  const box = (x, z, w, d, h, kind, y = 0) => ({ x, z, w, d, h, kind, y });
  const T = THEMES[(seed >>> 0) % THEMES.length];
  const layout = [], decor = { pools: [], reeds: [], trees: [], moss: [], arches: [], planks: [], lanterns: [], fires: [], tents: [], wells: [], mush: [], rubble: [], barrels: [] };
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
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) for (const [a, b] of [[i + 1, j], [i, j + 1]]) if (a < nx && b < nz && r() < T.loops) open.add(key(id(i, j), id(a, b)));
  // a few open clearings (2 x 2 cells): no walls inside
  const clearings = [];
  for (let k = 0; k < Math.max(1, Math.round(nx * nz / 20)); k++) {
    const i = 1 + Math.floor(r() * Math.max(1, nx - 3)), j = 1 + Math.floor(r() * Math.max(1, nz - 3));
    if (clearings.some(([a, b]) => Math.abs(a - i) < 3 && Math.abs(b - j) < 3)) continue;      // (landmarks never overlap)
    clearings.push([i, j]);
    for (const [a, b, c, d] of [[i, j, i + 1, j], [i, j + 1, i + 1, j + 1], [i, j, i, j + 1], [i + 1, j, i + 1, j + 1]]) open.add(key(id(a, b), id(c, d)));
  }
  // walls between closed neighbours: a ruined wall, a broken low one (vault it) or an arch you walk through
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) for (const [a, b, alongX] of [[i + 1, j, false], [i, j + 1, true]]) {
    if (a >= nx || b >= nz) continue;
    const cx = x0 + (alongX ? i + 0.5 : i + 1) * C, cz = z0 + (alongX ? j + 1 : j + 0.5) * C, W = alongX ? C : 0.6, D = alongX ? 0.6 : C;
    if (open.has(key(id(i, j), id(a, b)))) { if (r() < T.arch) decor.arches.push([cx, cz, alongX]); continue; }
    const t = r();
    if (t < T.tall) layout.push(box(cx, cz, W, D, 3.2 + r() * 1.4, 'ruin'));
    else if (t < T.low) layout.push(box(cx, cz, W, D, 1.0 + r() * 0.4, 'ruin'));             // low enough to vault or shoot over
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
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) if (r() < T.pillar) { const h = 4 + r() * 2.5; layout.push(box(x0 + i * C, z0 + j * C, 0.8, 0.8, h, 'pillar')); if (r() < 0.35) decor.lanterns.push([x0 + i * C, h + 0.35, z0 + j * C]); }
  // spawns: FFA round the edge; for matches, team A on the west edge and B on the east
  const edge = (i, j) => [x0 + (i + 0.5) * C, z0 + (j + 0.5) * C];
  const spawns = size === 'match' ? Array.from({ length: 6 }, (_, k) => edge(0, Math.round((k + 0.5) * nz / 6 - 0.5))) : Array.from({ length: 6 }, (_, k) => k < 3 ? edge(Math.round((k + 0.5) * nx / 3 - 0.5), 0) : edge(Math.round((k - 2.5) * nx / 3 - 0.5), nz - 1));
  const spawnsB = size === 'match' ? spawns.map(([x, z]) => [-x, z]) : spawns.map(([x, z]) => [-x, -z]);
  const spawnCell = new Set([...spawns, ...spawnsB].map(([x, z]) => Math.round((x - x0) / C - 0.5) + ',' + Math.round((z - z0) / C - 0.5)));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const cx = x0 + (i + 0.5) * C, cz = z0 + (j + 0.5) * C, t = r();
    if (spawnCell.has(i + ',' + j)) continue;                                                 // keep spawn cells clear
    if (clearings.some(([a, b]) => (i === a || i === a + 1) && (j === b || j === b + 1))) continue;   // (a landmark goes there)
    if (r() < 0.25) decor.mush.push([cx + (r() - 0.5) * C * 0.8, cz + (r() - 0.5) * C * 0.8]);
    if (t < T.tree) { const h = 5 + r() * 3; decor.trees.push([cx + (r() - 0.5) * 2, cz + (r() - 0.5) * 2, h]); layout.push(box(decor.trees.at(-1)[0], decor.trees.at(-1)[1], 0.55, 0.55, h, 'deadwood')); }
    else if (t < T.pool) { decor.pools.push([cx, cz, 2.2 + r() * 1.2]); layout.push(box(cx, cz, C * 0.7, 0.9, 0.18, 'plank')); }   // a walkway across it
    else if (t < T.pool + 0.06) layout.push(box(cx + (r() - 0.5) * 2, cz + (r() - 0.5) * 2, 1.4 + r(), 1.4 + r(), 0.7 + r() * 0.6, 'ruin'));   // fallen masonry
    else if (t < T.pool + 0.11) { const a = r() < 0.5; layout.push(box(cx, cz + (r() - 0.5) * 2, a ? 3.4 : 0.6, a ? 0.6 : 3.4, 0.55, 'deadwood')); }   // a fallen log (vault it)
    else if (t < T.pool + 0.16) {                                                             // a supply cache: crates and a barrel
      const x = cx + (r() - 0.5) * 2.4, z = cz + (r() - 0.5) * 2.4;
      layout.push(box(x, z, 1.1, 1.1, 0.95, 'crate'), box(x + 1.15, z + 0.2, 0.9, 0.9, 0.75, 'crate'));
      decor.barrels.push([x - 0.95, z + 0.5]);
    } else if (t < T.pool + 0.2) for (let k = 0; k < 3; k++) layout.push(box(cx + (k - 1) * 1.4, cz + (r() - 0.5) * 2, 0.6, 0.22, 0.8 + r() * 0.3, 'pillar'));   // old gravestones
    if (r() < 0.5) decor.rubble.push([cx + (r() - 0.5) * C * 0.8, cz + (r() - 0.5) * C * 0.8]);
    for (let k = 0; k < 3; k++) decor.reeds.push([cx + (r() - 0.5) * C * 0.8, cz + (r() - 0.5) * C * 0.8]);
  }
  // landmarks in the clearings (centre: the corner the four cells share)
  clearings.forEach(([i, j], k) => {
    const x = x0 + (i + 1) * C, z = z0 + (j + 1) * C, kind = LANDMARKS[(k + (seed >>> 3)) % LANDMARKS.length];
    if (kind === 'shrine') {                                   // a ring of pillars round an altar, a lantern on it
      for (let a = 0; a < 6; a++) { const t = a * Math.PI / 3; layout.push(box(x + Math.cos(t) * 4.6, z + Math.sin(t) * 4.6, 0.8, 0.8, a % 2 ? 4.5 : 2 + r() * 2, 'pillar')); }
      layout.push(box(x, z, 1.8, 1.2, 1, 'ruin')); decor.lanterns.push([x, 1.35, z]);
    } else if (kind === 'tower') {                             // a broken tower: stairs inside to a lookout floor
      const h = 6.4;
      for (const [dx, dz, w, d] of [[-G, 0, 0.6, 2 * G], [G, 0, 0.6, 2 * G], [0, -G, 2 * G, 0.6]]) layout.push(box(x + dx, z + dz, w, d, h - (dx > 0 ? 1.6 : 0), 'ruin'));
      layout.push(box(x - G / 2 - 0.7, z + G, G - 1.4, 0.6, h, 'ruin'));                        // (the door: the rest of the front, the stairs and a gap beside them)
      layout.push(box(x, z - G / 2, 2 * G - 0.6, G - 0.3, 0.3, 'plank', 3.2));
      layout.push({ stairs: '-z', x: x + G / 2, z: z + G / 2 - 0.15, w: G - 0.6, d: G - 0.3, y: 0, y1: 3.2, base: 0, rise: 0.32, kind: 'plank' });
      decor.lanterns.push([x - G / 2, 4.2, z - G / 2]);
    } else if (kind === 'camp') {                              // tents, crates, a fire (its smoke rises on Max)
      decor.tents.push([x - 3, z - 2.5, 0.4], [x + 3.2, z - 2, -0.6]); decor.fires.push([x, z]);
      layout.push(box(x - 3, z - 2.5, 2.4, 2, 1.1, 'tent'), box(x + 3.2, z - 2, 2.4, 2, 1.1, 'tent'), box(x + 2.5, z + 3, 1.1, 1.1, 0.9, 'crate'), box(x + 3.6, z + 3.4, 0.9, 0.9, 0.7, 'crate'));
    } else if (kind === 'well') {                              // an old well with a little roof
      layout.push(box(x, z, 1.8, 1.8, 0.9, 'ruin')); decor.wells.push([x, z]);
      for (const s of [-1, 1]) layout.push(box(x + s * 0.8, z, 0.18, 0.18, 2.4, 'deadwood'));
    } else if (kind === 'statue') {                            // a fallen statue: the head, an arm, the plinth
      layout.push(box(x, z, 3.2, 3.2, 0.8, 'ruin'), box(x + 3, z + 1.5, 2.4, 2.4, 2.2, 'pillar'), box(x - 3.4, z - 1, 3.6, 0.9, 0.9, 'pillar'));
    } else if (kind === 'graveyard') {                         // rows of headstones in a broken iron fence, a lantern on a post
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b += 2) layout.push(box(x + a * 2.6, z + b * 1.8, 0.7, 0.25, 0.9 + r() * 0.4, 'pillar'));
      for (const [dx, dz] of [[-5, -4], [5, -4], [-5, 4], [5, 4], [0, -4.6], [0, 4.6]]) layout.push(box(x + dx, z + dz, 0.16, 0.16, 1.6, 'iron'));
      layout.push(box(x, z, 2.4, 1.2, 1.1, 'ruin'));                                                 // (a tomb in the middle: cover)
      layout.push(box(x + 4, z, 0.2, 0.2, 2.6, 'deadwood')); decor.lanterns.push([x + 4, 2.8, z]);
    } else if (kind === 'henge') {                             // standing stones in a ring
      for (let a = 0; a < 8; a++) { const t = a * Math.PI / 4; layout.push(box(x + Math.cos(t) * 5, z + Math.sin(t) * 5, 1.1, 1.1, 3.6 + (a % 3) * 0.4, 'pillar')); }
      decor.lanterns.push([x, 0.5, z]);
    } else if (kind === 'wreck') {                             // a broken cart on its side, its load spilled: crates and barrels
      layout.push(box(x, z, 3.2, 1.6, 1.4, 'plank'), box(x + 2.2, z + 1.6, 0.25, 1.4, 1.4, 'deadwood'));
      layout.push(box(x - 2.6, z + 2.4, 1.1, 1.1, 0.95, 'crate'), box(x + 2.8, z - 2.6, 1, 1, 0.85, 'crate'), box(x - 3.2, z - 2.2, 0.9, 0.9, 0.75, 'crate'));
      decor.barrels.push([x - 1.2, z + 2.6], [x + 1, z - 2.4], [x + 3.4, z + 3]);
    } else {                                                   // a raised stone platform, steps up two sides
      layout.push(box(x, z, 2 * G, 2 * G, 1.6, 'ruin'));
      layout.push({ stairs: '+x', x: x - G - 1.2, z, w: 2.4, d: 2.4, y: 0, y1: 1.6, base: 0, rise: 0.32, kind: 'ruin' },
        { stairs: '-x', x: x + G + 1.2, z, w: 2.4, d: 2.4, y: 0, y1: 1.6, base: 0, rise: 0.32, kind: 'ruin' });
      decor.lanterns.push([x, 2.0, z]);
    }
  });
  for (const [x, z] of decor.barrels) layout.push({ ...box(x, z, 0.76, 0.76, 1, 'deadwood'), hidden: true });   // (barrels: solid, drawn in extra)
  // Battle Royale: drop points round an oval and chests in dead ends, clearings and under arches
  const chests = [];
  if (size === 'royale') {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const links = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => i + a >= 0 && j + b >= 0 && i + a < nx && j + b < nz && open.has(key(id(i, j), id(i + a, j + b)))).length;
      if (links === 1) chests.push(edge(i, j));                                     // dead ends: worth the walk
      else if (r() < 0.05 && !spawnCell.has(i + ',' + j)) chests.push(edge(i, j));  // and now and then on the way
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
    for (let k = 0; k < Math.round(hx * hz * 0.9 * T.fern); k++) ferns.push([(q() - 0.5) * hx * 1.9, 0.15, (q() - 0.5) * hz * 1.9, 0.4 + q() * 0.5, 0.25 + q() * 0.25, 0.4 + q() * 0.5, q() * 6, q() < 0.5 ? 0x4a6a34 : 0x6a7d3e]);
    ctx.scatter(ball, { color: 0xffffff, rough: 1, sway: 0.08 }, ferns, [0, ferns.length * 0.25, ferns.length * 0.6, ferns.length]);
    // lanterns: a glowing box in an iron cage, warm through the fog
    if (decor.lanterns.length) {
      ctx.scatter(cube, { emissive: 0xffc46b }, decor.lanterns.map(([x, y, z]) => [x, y, z, 0.26, 0.34, 0.26]));
      ctx.scatter(cube, { color: 0x24221f, rough: 0.6, metal: 0.6 }, decor.lanterns.flatMap(([x, y, z]) => [[x, y + 0.22, z, 0.36, 0.06, 0.36], [x, y - 0.2, z, 0.36, 0.05, 0.36]]));
    }
    // glowing mushrooms in clumps
    if (decor.mush.length) ctx.scatter(ball, { emissive: 0x6fe0c8 }, decor.mush.flatMap(([x, z]) => Array.from({ length: 4 }, () => [x + (q() - 0.5) * 0.6, 0.08, z + (q() - 0.5) * 0.6, 0.07 + q() * 0.06, 0.05, 0.07 + q() * 0.06])));
    // tents: canvas over the low box; the fire: glowing logs
    for (const [x, z, ry] of decor.tents) ctx.cone({ color: 0x7a6a4e, rough: 1 }, 1.7, 2, x, 1.0, z);
    if (decor.fires.length) ctx.scatter(ball, { emissive: 0xff8a2a }, decor.fires.map(([x, z]) => [x, 0.25, z, 0.45, 0.35, 0.45]));
    // barrels (standing, banded) and rubble at the foot of things
    if (decor.barrels.length) {
      ctx.scatter(can, { color: 0x5a4030, rough: 0.9 }, decor.barrels.map(([x, z]) => [x, 0.5, z, 0.38, 1, 0.38]));
      ctx.scatter(can, { color: 0x2a2826, rough: 0.6, metal: 0.6 }, decor.barrels.flatMap(([x, z]) => [[x, 0.25, z, 0.4, 0.06, 0.4], [x, 0.78, z, 0.4, 0.06, 0.4]]));
    }
    if (decor.rubble.length) ctx.scatter(ball, { color: 0x7d7f75, rough: 1 }, decor.rubble.flatMap(([x, z]) => Array.from({ length: 5 }, () => [x + (q() - 0.5) * 1.4, 0.06, z + (q() - 0.5) * 1.4, 0.12 + q() * 0.2, 0.08 + q() * 0.12, 0.12 + q() * 0.2, q() * 6])));
    for (const [x, z] of decor.wells) ctx.box({ ...{ color: 0x4a3c30, rough: 1 } }, 2.2, 0.12, 1.2, x, 2.45, z);
  }
  const map = {
    name: 'The Mist', hx, hz, wallH: 5, mist: !clear, openEdge: false, sight: clear ? 0 : 16,
    sky: fogSky, background: T.fog, fog: clear ? [T.fog, 40, 150] : [T.fog, 3, 16], theme: T.name,             // thick: about 15 m
    hemi: [0xd6ddd8, 0x4b5243, 1.9], key: [0xe6ebe6, 1.1, [-30, 70, 20]],
    floor: marshFloor(hx, hz),
    wall: () => ({ map: surfacePicture('rock')(), tileW: 1.6, tileH: 1.6 }),   // (the edge: the same old stone, not metal panels)
    kinds: {
      ruin: { ...surface('rock', surfacePicture('rock')), color: 0x8c8f84, rough: 1, tile: 1.6 },
      pillar: { ...surface('rock', surfacePicture('rock')), color: 0x9a9b90, rough: 1, tile: 1.6 },
      deadwood: { ...surface('planks', surfacePicture('planks')), color: 0x4a3c30, rough: 1, tile: 1 },
      plank: { ...surface('planks', surfacePicture('planks')), color: 0x7a6248, rough: 0.95, tile: 1.4 },
      tent: { color: 0x6e5f45, rough: 1 },
      crate: { ...surface('planks', surfacePicture('planks')), color: 0x8a6446, rough: 0.9, tile: 1 },
      iron: { color: 0x2a2a2c, rough: 0.6, metal: 0.7 },
      wall: { color: 0x707a72, rough: 0.9 },
    },
    spawns, spawnsB, layout, seed, size, extra,
    fixtures: [...decor.lanterns.map(([x, y, z]) => [x, y + 0.6, z, 0xffc46b, 5, 9, 1.4, 2]), ...decor.fires.map(([x, z]) => [x, 2.6, z, 0xff8a3a, 7, 10, 1.4, 1])],
    fires: decor.fires.map(([x, z]) => [x, z, false]),
  };
  if (size === 'royale') map.chests = chests;
  return map;
}
