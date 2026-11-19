// Ruined City: the second Battle Royale map. City blocks of broken multi-storey buildings you can
// go inside (doors, windows, floors, stairs, holes), streets with wrecked cars, a central plaza.
// Everything structural sits on the 3.2 m build grid, so players' walls, ramps and cones fit flush.
import { BoxGeometry, CylinderGeometry, IcosahedronGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace } from '../../vendor/three/three.module.min.js?v=59bc26c-mwnbwud4';
import { wallPanels, duskSky } from '../scene/range-tex.js?v=59bc26c-mwnbwud4';
import { mulberry32 } from '../core/prng.js?v=59bc26c-mwnbwud4';
import { MAPS } from './maps.js?v=59bc26c-mwnbwud4';

const G = 3.2, H = 3.2, SLAB = 0.3, T = 0.4;                // grid cell, storey height, floor thickness, wall thickness
const box = (x, z, w, d, h, kind, y = 0) => ({ x, z, w, d, h, kind, y });
const BX = [-24, -14, -4, 6, 16], BZ = [-19, -9, 1, 11];      // block corners (grid cells); a block is 7 x 7 cells
const PLAZA = new Set(['2,1', '2,2']);                        // the two middle blocks are an open plaza
const layout = [], chests = [];
const doors = [], facades = [], roofs = [];                    // for the street life (life() below)

// One wall segment (one grid cell long) on floor y0: a solid wall, a window, a door or nothing (ruined).
function segment(x, z, alongX, type, y0, kind, out = 0) {
  if (y0 === 0 && out && type === 'door') doors.push([x, z, alongX, out]);
  if (out && (type === 'wall' || type === 'window')) facades.push([x, z, alongX, out, y0]);
  const w = alongX ? G : T, d = alongX ? T : G;
  if (type === 'wall') layout.push(box(x, z, w, d, H, kind, y0));
  else if (type === 'window') {
    layout.push(box(x, z, w, d, 1, kind, y0), box(x, z, w, d, 0.9, kind, y0 + 2.3));
    if (Math.abs(Math.round(x * 7 + z * 13 + y0 * 3)) % 5 < 2) layout.push(box(x, z, alongX ? G : 0.08, alongX ? 0.08 : G, 1.3, 'glass', y0 + 1));   // (2 in 5 windows glazed)
  }
  else if (type === 'door') layout.push(box(x, z, w, d, 0.7, kind, y0 + 2.5));
  else if (type === 'stub') layout.push(box(x, z, w, d, 0.5 + (Math.abs(x * 7 + z * 3) % 1.4), kind, y0));   // a broken-off wall
}

// A building of nx x nz cells from grid cell (k0x, k0z), `floors` storeys, with stairs up to the roof.
function building(k0x, k0z, nx, nz, floors, rnd, kind) {
  const x0 = k0x * G, z0 = k0z * G, x1 = x0 + nx * G, z1 = z0 + nz * G;
  const door = (i, n) => i === Math.floor(n / 2);
  const ruin = (f) => 0.04 + 0.12 * f / Math.max(1, floors - 1);       // upper floors are more broken
  const pick = (f, front, i, n) => (f === 0 && front && door(i, n)) ? 'door'
    : rnd() < ruin(f) ? (rnd() < 0.5 ? 'stub' : 'none') : rnd() < 0.55 ? 'window' : 'wall';
  for (let f = 0; f <= floors; f++) {
    const y0 = f * H;
    if (f === floors) {                                          // the roof: a low broken parapet
      roofs.push([x0, z0, x1, z1, y0]);
      for (let i = 0; i < nx; i++) for (const z of [z0, z1]) if (rnd() < 0.7) layout.push(box(x0 + (i + 0.5) * G, z, G, T, 0.9, kind, y0));
      for (let i = 0; i < nz; i++) for (const x of [x0, x1]) if (rnd() < 0.7) layout.push(box(x, z0 + (i + 0.5) * G, T, G, 0.9, kind, y0));
      break;
    }
    for (let i = 0; i < nx; i++) { segment(x0 + (i + 0.5) * G, z0, true, pick(f, true, i, nx), y0, kind, -1); segment(x0 + (i + 0.5) * G, z1, true, pick(f, f === 0, i, nx), y0, kind, 1); }
    for (let i = 0; i < nz; i++) { segment(x0, z0 + (i + 0.5) * G, false, pick(f, false, i, nz), y0, kind, -1); segment(x1, z0 + (i + 0.5) * G, false, pick(f, true, i, nz), y0, kind, 1); }
  }
  // Floors and roof, a row of cells at a time, with the stairwell open above each flight. Flight f (floor f
  // to f + 1) runs up +z in column A or B (alternating), cells 1-2 of the building's depth.
  const col = (f) => k0x + 1 + (f % 2);
  for (let f = 1; f <= floors; f++) {
    const y = f * H - SLAB, open = col(f - 1);
    for (let r = 0; r < nz; r++) {
      const kz = k0z + r, hole = (kx) => kx === open && (r === 1 || r === 2) || (f === floors && f > 1 && rnd() < 0.05);
      let run = null;
      const flush = () => { if (run) layout.push(box((run[0] + run[1] + 1) / 2 * G, (kz + 0.5) * G, (run[1] - run[0] + 1) * G, G, SLAB, 'slab', y)); run = null; };
      for (let kx = k0x; kx < k0x + nx; kx++) { if (hole(kx)) flush(); else run = run ? [run[0], kx] : [kx, kx]; }
      flush();
    }
  }
  for (let f = 0; f < floors; f++)
    layout.push({ stairs: '+z', x: (col(f) + 0.5) * G, z: z0 + 2 * G, w: G - 0.2, d: 2 * G, y: f * H, y1: (f + 1) * H, base: f * H, rise: H / 11, kind: 'slab' });
  // Rubble and crates for cover on each floor, and loot: a chest on the ground floor and one upstairs.
  for (let f = 0; f < floors; f++) {
    const y = f * H;
    for (let k = 0; k < 2; k++) {
      const cx = k0x + 3 + Math.floor(rnd() * Math.max(1, nx - 3)), cz = k0z + Math.floor(rnd() * nz);
      if (cx < k0x + nx) layout.push(box((cx + 0.5) * G, (cz + 0.5) * G, 1.2 + rnd(), 1.2 + rnd(), 0.9 + rnd() * 0.5, rnd() < 0.5 ? 'rubble' : 'crate', y));
    }
  }
  chests.push([x1 - 0.5 * G, z1 - 0.5 * G, 0]);
  if (floors > 1) chests.push([x0 + 0.5 * G, z1 - 0.5 * G, H * (1 + Math.floor(rnd() * (floors - 1)))]);
}

// A collapsed building: ground-floor walls and a heap of rubble you can climb onto a broken first floor.
function collapsed(k0x, k0z, rnd) {
  const x0 = k0x * G, z0 = k0z * G;
  for (let i = 0; i < 5; i++) for (const [x, z, ax] of [[x0 + (i + 0.5) * G, z0, true], [x0 + (i + 0.5) * G, z0 + 5 * G, true], [x0, z0 + (i + 0.5) * G, false], [x0 + 5 * G, z0 + (i + 0.5) * G, false]])
    segment(x, z, ax, rnd() < 0.4 ? 'stub' : rnd() < 0.5 ? 'window' : 'none', 0, 'brick');
  layout.push(box(x0 + 3.5 * G, z0 + 2.5 * G, 3 * G, 5 * G, SLAB, 'slab', H - SLAB));
  layout.push({ ramp: '+x', x: x0 + 1 * G, z: z0 + 2.5 * G, w: 2 * G, d: 3 * G, y1: H, kind: 'rubble' });
  chests.push([x0 + 4 * G, z0 + 2.5 * G, H]);
}

const rnd = mulberry32(2207);
BX.forEach((kx, i) => BZ.forEach((kz, j) => {
  if (PLAZA.has(i + ',' + j)) return;
  const kind = (i + j) % 2 ? 'brick' : 'concrete', r = rnd();
  if (r < 0.15) collapsed(kx + 1, kz + 1, rnd);
  else if (r < 0.55) building(kx + 1, kz + 1, 5, 5, 3 + Math.floor(rnd() * 3), rnd, kind);         // one tall block
  else { building(kx, kz + 1, 3, 5, 2 + Math.floor(rnd() * 2), rnd, kind); building(kx + 4, kz + 1, 3, 5, 2 + Math.floor(rnd() * 3), rnd, kind === 'brick' ? 'concrete' : 'brick'); }
}));

// The plaza: a broken monument, low walls and planters, and wrecked cars in the streets.
const px = (BX[2] + 3.5) * G, pz = (BZ[1] + 7 + 1.5) * G;
layout.push(box(px, pz, 2 * G, 2 * G, 1, 'concrete'), box(px, pz, G, G, 3.4, 'concrete', 1), box(px + 0.6, pz - 0.4, 1.4, 1.1, 1.2, 'rubble', 4.4));
for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) layout.push(box(px + dx * G, pz + dz * G, G, T, 1.1, 'concrete'), box(px + dx * G, pz + dz * G, T, G, 1.1, 'concrete'));
chests.push([px - 2 * G, pz, 0], [px + 2 * G, pz, 0], [px, pz - 2 * G, 0], [px, pz + 2 * G, 0]);
const cars = [];
for (let n = 0; n < 26; n++) {
  const alongX = rnd() < 0.5, k = Math.floor(rnd() * 4), s = -70 + rnd() * 140;
  const street = alongX ? (BZ[k] + 8.5) * G : (BX[Math.min(4, k + 1)] - 1.5) * G;
  const x = alongX ? s : street + (rnd() - 0.5) * 3, z = alongX ? street + (rnd() - 0.5) * 3 : s * 0.8;
  if (Math.abs(x) > 76 || Math.abs(z) > 60) continue;
  const bus = n % 9 === 4, L = bus ? 9 : 4.3, W = bus ? 2.5 : 1.9;
  cars.push(box(x, z, alongX ? L : W, alongX ? W : L, bus ? 2.9 : 1.45, bus ? 'bus' : ['car', 'carRed', 'carBlue', 'carWhite'][n % 4]));
}
layout.push(...cars);
// Trees growing out of the courtyards, pavements and plaza (solid trunks).
const trees = [];
for (const [kx, kz] of BX.flatMap((x) => BZ.map((z) => [x, z]))) for (const [dx, dz] of [[-0.6, 2], [7.6, 4], [3, 7.6]]) {
  if (rnd() < 0.45) continue;
  trees.push(box((kx + dx) * G, (kz + dz) * G, 0.5, 0.5, 4 + rnd() * 3, 'tree'));
}
for (const [dx, dz] of [[-2, -1], [2, 1], [-1, 2], [1, -2]]) trees.push(box(px + dx * G, pz + dz * G, 0.5, 0.5, 5 + rnd() * 2, 'tree'));
layout.push(...trees);
// Fires: burning barrels in the streets and a few burning cars, each with a column of smoke.
const barrels = [], smokes = [];
for (let n = 0; n < 14; n++) { const x = -70 + rnd() * 140, z = (BZ[Math.floor(rnd() * 4)] + 8.5) * G + (rnd() < 0.5 ? -3.6 : 3.6); barrels.push([x, z]); }
const burning = cars.filter((c, i) => c.kind !== 'bus' && i % 6 === 1).map((c) => [c.x, c.z]);
for (const [x, z, big] of [...barrels.map(([x, z]) => [x, z, false]), ...burning.map(([x, z]) => [x, z, true])])
  for (let k = 0; k < (big ? 5 : 4); k++) smokes.push([x + k * 0.35, 1.8 + k * 1.4, z - k * 0.25, (big ? 1.5 : 1.1) + k * 0.35]);   // (drifting up and growing)

// Street life, drawn only (nothing to bump into): tree crowns, weeds, vines, graffiti, neon, shop
// awnings, street lamps (about half still lit), rooftop billboards and burning barrels.
function life(ctx) {
  const r = mulberry32(5150), any = (list) => list[Math.floor(r() * list.length)];
  const cube = new BoxGeometry(1, 1, 1), ball = new IcosahedronGeometry(1, 0), can = new CylinderGeometry(1, 1, 1, 10);
  ctx.scatter(cube, { color: 0x4b3a2a, rough: 1 }, trees.map((b) => [b.x, b.h / 2, b.z, 0.45, b.h, 0.45]));
  ctx.scatter(ball, { color: 0xffffff, rough: 1 }, trees.flatMap((b) => [[0, 0, 1.9], [0.8, 0.5, 1.4], [-0.7, 0.3, 1.3]].map(([dx, dy, sz], i) =>
    [b.x + dx, b.h + dy, b.z - dx, sz * 1.2, sz, sz * 1.2, i, [0x4f7a3a, 0x6b8f3e, 0x3d6634][i]])));
  const weeds = [];
  for (let n = 0; n < 1400; n++) { const x = r() * 154 - 77, z = r() * 122 - 61, sz = 0.25 + r() * 0.35; weeds.push([x, sz * 0.4, z, sz, sz * 0.8, sz, r() * 6, any([0x5d7a3a, 0x7d9346, 0x4a6b33, 0x8c8a4a])]); }
  ctx.scatter(ball, { color: 0xffffff, rough: 1 }, weeds, [0, 300, 800, 1400]);
  const along = (x, z, alongX, out, off) => alongX ? [x, z + out * off] : [x + out * off, z];
  const vines = [], graffiti = [], neon = [];
  for (const [x, z, ax, out, y0] of facades) {
    const t = r();
    if (t < 0.12) { const [vx, vz] = along(x + (ax ? (r() - 0.5) * 2 : 0), z + (ax ? 0 : (r() - 0.5) * 2), ax, out, 0.24), h = 1.5 + r() * 4; vines.push([vx, y0 + H - h / 2, vz, ax ? 0.9 : 0.08, h, ax ? 0.08 : 0.9]); }
    else if (t < 0.22 && y0 === 0) { const [gx, gz] = along(x, z, ax, out, 0.22); graffiti.push([gx, 1.3, gz, ax ? 1.8 : 0.03, 0.9, ax ? 0.03 : 1.8, 0, any([0xe0457b, 0x3fc1d9, 0xf2c230, 0x8d5bd6, 0x50c46a])]); }
    else if (t < 0.25 && y0 === H) { const [nx, nz] = along(x, z, ax, out, 0.26); neon.push([nx, y0 + 1.6, nz, ax ? 1.6 : 0.05, 0.35, ax ? 0.05 : 1.6, any([0xff4fa3, 0x4fe3ff, 0xffd34f])]); }
  }
  ctx.scatter(cube, { color: 0x3f6b2f, rough: 1 }, vines);
  ctx.scatter(cube, { color: 0xffffff, rough: 0.9 }, graffiti);
  for (const c of [0xff4fa3, 0x4fe3ff, 0xffd34f]) { const n = neon.filter((v) => v[6] === c).map((v) => v.slice(0, 6)); if (n.length) ctx.scatter(cube, { emissive: c }, n); }
  ctx.scatter(cube, { color: 0xffffff, rough: 0.85 }, doors.map(([x, z, ax, out]) => { const [wx, wz] = along(x, z, ax, out, 0.75); return [wx, 2.75, wz, ax ? G * 0.95 : 1.3, 0.12, ax ? 1.3 : G * 0.95, 0, any([0xb8423a, 0x2f7d5b, 0x2f5f9e, 0xd1a23a])]; }));
  const poles = [], heads = [], lit = [];
  for (const kz of BZ) for (let x = -72; x <= 72; x += 16) { const z = (kz + 7.2) * G; poles.push([x, 2.5, z, 0.09, 5, 0.09]); heads.push([x, 5.05, z + 0.6, 0.3, 0.12, 1.3]); (r() < 0.55 ? lit : heads).push([x, 4.95, z + 1.1, 0.28, 0.08, 0.28]); }
  ctx.scatter(can, { color: 0x30363b, rough: 0.6, metal: 0.5 }, poles);
  ctx.scatter(cube, { color: 0x30363b, rough: 0.6, metal: 0.5 }, heads);
  ctx.scatter(cube, { emissive: 0xffe2a0 }, lit);
  const steel = { color: 0x2b2f33, rough: 0.6, metal: 0.4 };
  for (const [x0, z0, x1, z1, y] of roofs) {
    if (r() < 0.6) continue;
    const x = (x0 + x1) / 2, z = (z0 + z1) / 2 + 1;
    ctx.box(steel, 0.15, 3, 0.15, x - 2.2, y + 1.5, z); ctx.box(steel, 0.15, 3, 0.15, x + 2.2, y + 1.5, z);
    ctx.box({ color: any([0xe04b3b, 0x2c8fd1, 0xf2b630, 0x37b06b]), rough: 0.7 }, 5.4, 2.4, 0.18, x, y + 3.6, z);
    ctx.box({ color: 0xf4f1e8, rough: 0.7 }, 3.8, 0.45, 0.2, x, y + 3.9, z);
  }
  ctx.scatter(can, { color: 0x6b4a36, rough: 0.8, metal: 0.3 }, barrels.map(([x, z]) => [x, 0.5, z, 0.32, 1, 0.32]));
  ctx.scatter(ball, { emissive: 0xff8a2a }, [...barrels.map(([x, z]) => [x, 1.15, z, 0.3, 0.45, 0.3]), ...burning.flatMap(([x, z]) => [[x, 1.7, z, 0.8, 0.6, 1.4], [x + 0.6, 1.9, z - 0.3, 0.5, 0.5, 0.6]])]);
  ctx.scatter(ball, { emissive: 0xffc14d }, burning.map(([x, z]) => [x - 0.3, 1.8, z + 0.4, 0.45, 0.5, 0.45]));
  // smoke: dark grey puffs, a little see-through, the size of the spheres bots can't see through
  for (const [op, col] of [[0.55, 0x3d3f42], [0.35, 0x6a6c70]]) ctx.scatter(ball, { color: col, opacity: op }, smokes.flatMap(([x, y, z, rr], i) =>
    [[0, 0, 0], [0.5, 0.3, -0.4], [-0.45, -0.2, 0.35]].map(([dx, dy, dz]) => [x + dx * rr, y + dy * rr, z + dz * rr, rr * (op > 0.4 ? 0.75 : 0.95), rr * 0.7, rr * 0.8, i])));
}


function asphalt() {
  const canvas = document.createElement('canvas'), w = 640, h = 512;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), px4 = ctx.createImageData(w, h);
  let seed = 19;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const v = 64 + (seed / 4294967296 - 0.5) * 22 + 6 * Math.sin(x * 0.05 + y * 0.03), at = (y * w + x) * 4;
    px4.data[at] = v; px4.data[at + 1] = v + 1; px4.data[at + 2] = v + 3; px4.data[at + 3] = 255;
  }
  ctx.putImageData(px4, 0, 0);
  const m = (v, half) => (v + half) * 4;                       // metres to pixels (4 px a metre)
  ctx.fillStyle = '#8d8a84';                                   // pavements around every block
  for (const kx of BX) for (const kz of BZ) ctx.fillRect(m(kx * G - 1.2, 80), m(kz * G - 1.2, 64), (7 * G + 2.4) * 4, (7 * G + 2.4) * 4);
  ctx.strokeStyle = '#c9b45c'; ctx.lineWidth = 2; ctx.setLineDash([12, 12]);   // worn centre lines
  for (const kz of BZ) { const z = m((kz + 8.5) * G, 64); ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(w, z); ctx.stroke(); }
  for (const kx of BX) { const x = m((kx - 1.5) * G, 80); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.setLineDash([]);
  for (let n = 0; n < 160; n++) { ctx.fillStyle = `rgba(30,28,26,${0.15 + (n % 5) * 0.06})`; ctx.beginPath(); ctx.arc((n * 97) % w, (n * 61) % h, 3 + (n % 7) * 2, 0, 7); ctx.fill(); }   // cracks and stains
  const map = new CanvasTexture(canvas);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.colorSpace = SRGBColorSpace;
  return { map, tileX: 160, tileZ: 128, rough: 0.95, keepInLow: true };
}

const Y = MAPS.yard.kinds;
// spawns: the drop points (shared with Blacktide, royale-map.js).
export const ruins = (spawns) => ({
  name: 'Ruined City', hx: 80, hz: 64, wallH: 5,
  sky: duskSky, background: 0x5d6064, fog: [0x7d8084, 70, 170],
  hemi: [0xd8dde2, 0x4a4540, 2.1], key: [0xffe6c8, 1.9, [38, 80, -26]],
  floor: asphalt,
  wall: () => ({ ...wallPanels(), tileW: 2, tileH: 4 }),
  kinds: {
    concrete: { map: Y.low.map, color: 0xa7a7a3, rough: 0.95, tile: 2 },
    brick: { map: Y.low.map, color: 0x9a6650, rough: 0.95, tile: 1.4 },
    slab: { map: Y.low.map, color: 0x8b8b88, rough: 0.95, tile: 2 },
    rubble: { map: Y.low.map, color: 0x7a7570, rough: 1, tile: 1 },
    crate: Y.crate,
    car: { map: Y.container.map, color: 0x55606b, metal: 0.5, rough: 0.6, tile: 1.5 },
    carRed: { map: Y.container.map, color: 0xa3423a, metal: 0.5, rough: 0.55, tile: 1.5 },
    carBlue: { map: Y.container.map, color: 0x3c6a9c, metal: 0.5, rough: 0.55, tile: 1.5 },
    carWhite: { map: Y.container.map, color: 0xcfcfca, metal: 0.4, rough: 0.6, tile: 1.5 },
    bus: { map: Y.container.map, color: 0xd9a72e, metal: 0.4, rough: 0.6, tile: 2 },
    tree: { hiddenBox: true },
    glass: { color: 0xa9d4e8, opacity: 0.32 },
    wall: { color: 0x707270, rough: 0.9 },
  },
  spawns, spawnsB: [],
  chests: [...spawns.map(([x, z]) => [x * 0.92, z * 0.92]), ...chests],
  layout, smokes,
  extra: (ctx) => life(ctx),
});
