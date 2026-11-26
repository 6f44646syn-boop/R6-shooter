// Ruined City: the second Battle Royale map. City blocks of broken multi-storey buildings you can go
// inside (doors, windows, rooms and furniture, stairs, holes), a landmark tower, rubble you can climb into
// upper floors, streets with wrecked cars, a plaza, and under the streets a subway that runs everywhere:
// stations with stairs down, and chasms in the road you can drop through.
// The streets are a deck DECK metres up; the tunnels are under every street (the ground under each block is
// solid). Everything structural sits on the 3.2 m build grid, so players' walls, ramps and cones fit flush.
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace } from '../../vendor/three/three.module.min.js?v=8bf57aa-mwwtkd1t';
import { wallPanels, duskSky } from '../scene/range-tex.js?v=8bf57aa-mwwtkd1t';
import { mulberry32 } from '../core/prng.js?v=8bf57aa-mwwtkd1t';
import { gfxLevel } from '../render/quality.js?v=8bf57aa-mwwtkd1t';
import { surface } from '../render/surfaces.js?v=8bf57aa-mwwtkd1t';
import { MAPS } from './maps.js?v=8bf57aa-mwwtkd1t';

const G = 3.2, H = 3.2, SLAB = 0.3, T = 0.4;                // grid cell, storey height, floor thickness, wall thickness
export const DECK = 4;                                         // street level (the subway is below it)
const box = (x, z, w, d, h, kind, y = 0) => ({ x, z, w, d, h, kind, y: y + DECK });   // on the street (y from street level)
const under = (x, z, w, d, h, kind, y = 0) => ({ x, z, w, d, h, kind, y });           // in the subway (y from its floor)
const BX = [-24, -14, -4, 6, 16], BZ = [-19, -9, 1, 11];      // block corners (grid cells); a block is 7 x 7 cells
const PLAZA = new Set(['2,2']), TOWER = '2,1';                 // an open plaza, and the landmark tower beside it
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

// Furniture for a room: a desk, shelves, a sofa or a table with chairs (solid: cover).
function furniture(x, z, rnd, y0) {
  const t = rnd();
  if (t < 0.3) layout.push(box(x, z, 1.6, 0.8, 0.75, 'wood', y0), box(x, z + 0.75, 0.5, 0.5, 0.5, 'fabric', y0));
  else if (t < 0.55) layout.push(box(x, z, 2, 0.45, 2, 'wood', y0));
  else if (t < 0.8) layout.push(box(x, z, 2.1, 0.9, 0.5, 'fabric', y0), box(x, z - 0.35, 2.1, 0.2, 0.9, 'fabric', y0));
  else layout.push(box(x, z, 1.2, 1.2, 0.75, 'wood', y0), box(x + 0.9, z, 0.45, 0.45, 0.5, 'fabric', y0), box(x - 0.9, z, 0.45, 0.45, 0.5, 'fabric', y0));
}

// A building of nx x nz cells from grid cell (k0x, k0z), `floors` storeys, with stairs up to the roof.
// Wide buildings have two rooms a floor (a wall with a doorway) and furniture; some have rubble heaped
// against the front so you can climb from the street into the first floor.
function building(k0x, k0z, nx, nz, floors, rnd, kind, { rubble = false, glassy = false } = {}) {
  const x0 = k0x * G, z0 = k0z * G, x1 = x0 + nx * G, z1 = z0 + nz * G;
  const door = (i, n) => i === Math.floor(n / 2);
  const ruin = (f) => 0.04 + 0.12 * f / Math.max(1, floors - 1);       // upper floors are more broken
  const climb = rubble && floors >= 2 ? nx - 1 : -1;                    // (the column the rubble reaches)
  const pick = (f, front, i, n, face) => face === 'z0' && i === climb && f <= 1 ? (f === 0 ? 'wall' : 'none')
    : (f === 0 && front && door(i, n)) ? 'door'
    : rnd() < ruin(f) ? (rnd() < 0.5 ? 'stub' : 'none') : rnd() < (glassy ? 0.85 : 0.55) ? 'window' : 'wall';
  for (let f = 0; f <= floors; f++) {
    const y0 = f * H;
    if (f === floors) {                                          // the roof: a low broken parapet
      roofs.push([x0, z0, x1, z1, y0]);
      for (let i = 0; i < nx; i++) for (const z of [z0, z1]) if (rnd() < 0.7) layout.push(box(x0 + (i + 0.5) * G, z, G, T, 0.9, kind, y0));
      for (let i = 0; i < nz; i++) for (const x of [x0, x1]) if (rnd() < 0.7) layout.push(box(x, z0 + (i + 0.5) * G, T, G, 0.9, kind, y0));
      break;
    }
    for (let i = 0; i < nx; i++) { segment(x0 + (i + 0.5) * G, z0, true, pick(f, true, i, nx, 'z0'), y0, kind, -1); segment(x0 + (i + 0.5) * G, z1, true, pick(f, f === 0, i, nx, 'z1'), y0, kind, 1); }
    for (let i = 0; i < nz; i++) { segment(x0, z0 + (i + 0.5) * G, false, pick(f, false, i, nz, 'x0'), y0, kind, -1); segment(x1, z0 + (i + 0.5) * G, false, pick(f, true, i, nz, 'x1'), y0, kind, 1); }
    if (nx >= 5) {                                               // two rooms: a wall at column 3 with a doorway on row 3
      for (let i = 0; i < nz; i++) segment(x0 + 3 * G, z0 + (i + 0.5) * G, false, i === 3 ? 'door' : rnd() < ruin(f) ? 'stub' : 'wall', y0, 'plaster');
      for (const [cx, cz] of [[0, 0], [4, 1], [3, 4], [4, 3], [0, 4]]) if (rnd() < 0.55) furniture(x0 + (cx + 0.5) * G, z0 + (cz + 0.5) * G, rnd, y0);
    }
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
    layout.push({ stairs: '+z', x: (col(f) + 0.5) * G, z: z0 + 2 * G, w: G - 0.2, d: 2 * G, y: DECK + f * H, y1: DECK + (f + 1) * H, base: DECK + f * H, rise: H / 11, kind: 'slab' });
  if (climb >= 0) layout.push({ ramp: '+z', x: x0 + (climb + 0.5) * G, z: z0 - G, w: G, d: 2 * G, y: DECK, y1: DECK + H, base: DECK, kind: 'rubble' });
  // Rubble and crates for cover on each floor, and loot: a chest on the ground floor and one upstairs.
  for (let f = 0; f < floors; f++) {
    const y = f * H;
    for (let k = 0; k < 2; k++) {
      const cx = k0x + 3 + Math.floor(rnd() * Math.max(1, nx - 3)), cz = k0z + Math.floor(rnd() * nz);
      if (cx < k0x + nx && nx < 5) layout.push(box((cx + 0.5) * G, (cz + 0.5) * G, 1.2 + rnd(), 1.2 + rnd(), 0.9 + rnd() * 0.5, rnd() < 0.5 ? 'rubble' : 'crate', y));
    }
  }
  chests.push([x1 - 0.5 * G, z1 - 0.5 * G, DECK]);
  if (floors > 1) chests.push([x0 + 0.5 * G, z1 - 0.5 * G, DECK + H * (1 + Math.floor(rnd() * (floors - 1)))]);
  if (floors > 6) chests.push([x1 - 0.5 * G, z0 + 0.5 * G, DECK + H * floors]);   // (the tower: one on the roof)
}

// A collapsed building: ground-floor walls and a heap of rubble you can climb onto a broken first floor.
function collapsed(k0x, k0z, rnd) {
  const x0 = k0x * G, z0 = k0z * G;
  for (let i = 0; i < 5; i++) for (const [x, z, ax] of [[x0 + (i + 0.5) * G, z0, true], [x0 + (i + 0.5) * G, z0 + 5 * G, true], [x0, z0 + (i + 0.5) * G, false], [x0 + 5 * G, z0 + (i + 0.5) * G, false]])
    segment(x, z, ax, rnd() < 0.4 ? 'stub' : rnd() < 0.5 ? 'window' : 'none', 0, 'brick');
  layout.push(box(x0 + 3.5 * G, z0 + 2.5 * G, 3 * G, 5 * G, SLAB, 'slab', H - SLAB));
  layout.push({ ramp: '+x', x: x0 + 1 * G, z: z0 + 2.5 * G, w: 2 * G, d: 3 * G, y: DECK, y1: DECK + H, base: DECK, kind: 'rubble' });
  chests.push([x0 + 4 * G, z0 + 2.5 * G, DECK + H]);
}

const rnd = mulberry32(2207);
BX.forEach((kx, i) => BZ.forEach((kz, j) => {
  if (PLAZA.has(i + ',' + j)) return;
  if (i + ',' + j === TOWER) { building(kx + 1, kz + 1, 5, 5, 9, rnd, 'concrete', { glassy: true }); return; }   // the landmark: 9 floors, roof chest
  const kind = (i + j) % 2 ? 'brick' : 'concrete', r = rnd(), rubble = rnd() < 0.4;
  if (r < 0.15) collapsed(kx + 1, kz + 1, rnd);
  else if (r < 0.55) building(kx + 1, kz + 1, 5, 5, 3 + Math.floor(rnd() * 3), rnd, kind, { rubble });         // one tall block
  else { building(kx, kz + 1, 3, 5, 2 + Math.floor(rnd() * 2), rnd, kind, { rubble }); building(kx + 4, kz + 1, 3, 5, 2 + Math.floor(rnd() * 3), rnd, kind === 'brick' ? 'concrete' : 'brick'); }
}));

// The plaza: a broken monument, low walls and planters, and wrecked cars in the streets.
const px = (BX[2] + 3.5) * G, pz = (BZ[2] + 3.5) * G;
layout.push(box(px, pz, 2 * G, 2 * G, 1, 'concrete'), box(px, pz, G, G, 3.4, 'concrete', 1), box(px + 0.6, pz - 0.4, 1.4, 1.1, 1.2, 'rubble', 4.4));
for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) layout.push(box(px + dx * G, pz + dz * G, G, T, 1.1, 'concrete'), box(px + dx * G, pz + dz * G, T, G, 1.1, 'concrete'));
chests.push([px - 2 * G, pz, DECK], [px + 2 * G, pz, DECK], [px, pz - 2 * G, DECK], [px, pz + 2 * G, DECK]);

/* ---------- the subway: solid ground under the blocks, tunnels under the streets ---------- */
const inBlock = (kx, kz) => BX.some((bx) => kx >= bx && kx <= bx + 6) && BZ.some((bz) => kz >= bz && kz <= bz + 6);
// Chasms: 2 x 2 cells of broken road you can drop through. Stations: stairs down (3 cells along a street).
const CHASMS = [[-21, -12], [10, -12], [-11, 9], [20, 18], [-16, -6]];
const STATIONS = [[-12, -11, 'Old Town'], [7, -1, 'Central'], [-20, 9, 'Harbour Rd'], [16, 9, 'Ironworks']];
const holes = new Set();
for (const [kx, kz] of CHASMS) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) holes.add((kx + a) + ',' + (kz + b));
for (const [sx, sz] of STATIONS) for (let a = 0; a < 3; a++) holes.add((sx + a) + ',' + sz);
const keepClear = new Set(holes);                               // (cars, trees and barrels stay off the holes and station exits)
for (const [sx, sz] of STATIONS) for (let a = -1; a <= 5; a++) for (let b = -1; b <= 1; b++) keepClear.add((sx + a) + ',' + (sz + b));
for (const bx of BX) for (const bz of BZ) layout.push(under((bx + 3.5) * G, (bz + 3.5) * G, 7 * G, 7 * G, DECK, 'ground'));
for (let kz = -20; kz < 20; kz++) {                             // the street deck, a row of cells at a time, with its holes
  let run = null;
  const flush = () => { if (run) layout.push(under((run[0] + run[1] + 1) / 2 * G, (kz + 0.5) * G, (run[1] - run[0] + 1) * G, G, 0.4, 'deck', DECK - 0.4)); run = null; };
  for (let kx = -25; kx < 25; kx++) { if (inBlock(kx, kz) || holes.has(kx + ',' + kz)) flush(); else run = run ? [run[0], kx] : [kx, kx]; }
  flush();
}
for (const [kx, kz] of CHASMS) {                               // broken edges round each chasm, a heap of rubble below
  const cx = (kx + 1) * G, cz = (kz + 1) * G;
  layout.push(under(cx - 0.6, cz + 0.4, 2.4, 1.8, 1.1, 'rubble'), under(cx + 1.1, cz - 0.9, 1.4, 1.4, 0.6, 'rubble'));
  for (const [dx, dz, w, d] of [[-G - 0.3, 0, 0.6, 2 * G], [G + 0.3, 0, 0.6, 2 * G], [0, -G - 0.3, 2 * G, 0.6]]) layout.push(box(cx + dx, cz + dz, w, d, 0.35, 'rubble'));
}
const stationLights = [];
for (const [sx, sz] of STATIONS) {
  const x0 = sx * G, z = (sz + 0.5) * G;
  layout.push({ stairs: '+x', x: x0 + 1.5 * G, z, w: 3 * G, d: G - 0.3, y: 0, y1: DECK, base: 0, rise: DECK / 14, kind: 'deck' });
  for (const dz of [-G / 2, G / 2]) layout.push(box(x0 + 1.5 * G, z + dz, 3 * G, 0.1, 1, 'steel'));   // railings round the opening
  layout.push(box(x0, z, 0.1, G, 1, 'steel'));
  // the platform: benches, a ticket booth, a chest; lights on the ceiling
  layout.push(under(x0 - 2 * G, z - 1.1, 2.2, 0.5, 0.45, 'wood'), under(x0 - 2 * G, z + 1.1, 2.2, 0.5, 0.45, 'wood'), under(x0 - 3.5 * G, z, 1.6, 2.4, 2.4, 'booth'));
  chests.push([x0 - 1.2 * G, z, 0]);
  stationLights.push([x0 - 2 * G, z], [x0 - 0.5 * G, z]);
}

// Two abandoned trains in the tunnels: solid carriages beside the platform-less lines, cover down there.
export const TRAINS = [[31, (BZ[0] + 8.5) * G, true], [(BX[1] - 1.5) * G, 30, false]];
for (const [x, z, alongX] of TRAINS) for (const k of [-1, 1]) layout.push(under(x + (alongX ? k * 9.4 : 0), z + (alongX ? 0 : k * 9.4), alongX ? 9 : 2.8, alongX ? 2.8 : 9, 3.1, 'train', 0.1));
chests.push([TRAINS[0][0], TRAINS[0][1] + 3, 0], [TRAINS[1][0] + 3, TRAINS[1][1], 0]);
const cars = [];
for (let n = 0; n < 26; n++) {
  const alongX = rnd() < 0.5, k = Math.floor(rnd() * 4), s = -70 + rnd() * 140;
  const street = alongX ? (BZ[k] + 8.5) * G : (BX[Math.min(4, k + 1)] - 1.5) * G;
  const x = alongX ? s : street + (rnd() - 0.5) * 3, z = alongX ? street + (rnd() - 0.5) * 3 : s * 0.8;
  if (Math.abs(x) > 76 || Math.abs(z) > 60 || [-2.2, 0, 2.2].some((d) => keepClear.has(Math.floor((x + (alongX ? d : 0)) / G) + ',' + Math.floor((z + (alongX ? 0 : d)) / G)))) continue;
  const bus = n % 9 === 4, L = bus ? 9 : 4.3, W = bus ? 2.5 : 1.9;
  cars.push(box(x, z, alongX ? L : W, alongX ? W : L, bus ? 2.9 : 1.45, bus ? 'bus' : ['car', 'carRed', 'carBlue', 'carWhite'][n % 4]));
}
layout.push(...cars);
// Trees growing out of the courtyards, pavements and plaza (solid trunks).
const trees = [];
for (const [kx, kz] of BX.flatMap((x) => BZ.map((z) => [x, z]))) for (const [dx, dz] of [[-0.6, 2], [7.6, 4], [3, 7.6]]) {
  if (rnd() < 0.45 || keepClear.has(Math.floor(kx + dx) + ',' + Math.floor(kz + dz))) continue;
  trees.push(box((kx + dx) * G, (kz + dz) * G, 0.5, 0.5, 4 + rnd() * 3, 'tree'));
}
for (const [dx, dz] of [[-2, -1], [2, 1], [-1, 2], [1, -2]]) trees.push(box(px + dx * G, pz + dz * G, 0.5, 0.5, 5 + rnd() * 2, 'tree'));
layout.push(...trees);
// Fires: burning barrels in the streets and a few burning cars, each with a column of smoke.
const barrels = [], smokes = [];
for (let n = 0; n < 14; n++) {
  const x = -70 + rnd() * 140, z = (BZ[Math.floor(rnd() * 4)] + 8.5) * G + (rnd() < 0.5 ? -3.6 : 3.6);
  if (!keepClear.has(Math.floor(x / G) + ',' + Math.floor(z / G))) barrels.push([x, z]);
}
const burning = cars.filter((c, i) => c.kind !== 'bus' && i % 6 === 1).map((c) => [c.x, c.z]);
for (const [x, z, big] of [...barrels.map(([x, z]) => [x, z, false]), ...burning.map(([x, z]) => [x, z, true])])
  for (let k = 0; k < (big ? 5 : 4); k++) smokes.push([x + k * 0.35, DECK + 1.8 + k * 1.4, z - k * 0.25, (big ? 1.5 : 1.1) + k * 0.35]);   // (drifting up and growing)

// Street lamps along the roads; about half still lit (some of those failing).
const lamps = [];
{ const lr = mulberry32(5151); for (const kz of BZ) for (let x = -72; x <= 72; x += 16) { const z = (kz + 7.2) * G, u = lr(); lamps.push([x, z, u < 0.55 ? (u < 0.12 ? 2 : 1) : 0]); } }
// Tunnel lights: along the middle of every street, under the deck.
const tunnelLights = [];
for (const bz of BZ) for (let x = -76; x <= 76; x += 9.6) tunnelLights.push([x, (bz + 8.5) * G]);
for (const bx of BX) for (let z = -60; z <= 60; z += 9.6) tunnelLights.push([(bx - 1.5) * G, z]);
const lit = (x, z) => !inBlock(Math.floor(x / G), Math.floor(z / G));

// The street surface: one sheet over the whole deck (with the holes cut out), the street texture
// laid on it at the same scale everywhere.
function deckSurface() {
  const pos = [], uv = [];
  for (let kz = -20; kz < 20; kz++) for (let kx = -25; kx < 25; kx++) {
    if (holes.has(kx + ',' + kz)) continue;
    const xa = kx * G, xb = xa + G, za = kz * G, zb = za + G, u = (x) => (x + 80) / 160, v = (z) => 1 - (z + 64) / 128;
    pos.push(xa, 0, za, xa, 0, zb, xb, 0, zb, xa, 0, za, xb, 0, zb, xb, 0, za);
    uv.push(u(xa), v(za), u(xa), v(zb), u(xb), v(zb), u(xa), v(za), u(xb), v(zb), u(xb), v(za));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Street life, drawn only (nothing to bump into): tree crowns, weeds, vines, graffiti, neon, shop
// awnings, street lamps, rooftop billboards and burning barrels; in the subway rails, sleepers,
// ceiling lights and station signs.
function life(ctx0) {
  // everything above ground is placed from street level
  const ctx = {
    scatter: (g, m, list, counts) => ctx0.scatter(g, m, list.map((p) => { const q = p.slice(); q[1] += DECK; return q; }), counts),
    box: (m, w, h, d, x, y, z) => ctx0.box(m, w, h, d, x, y + DECK, z),
  };
  const r = mulberry32(5150), any = (list) => list[Math.floor(r() * list.length)];
  const cube = new BoxGeometry(1, 1, 1), ball = new IcosahedronGeometry(1, 0), can = new CylinderGeometry(1, 1, 1, 10);
  const street = asphalt();
  ctx0.scatter(deckSurface(), { map: street.map, rough: 0.95 }, [[0, DECK + 0.012, 0, 1, 1, 1, 0]]);
  ctx.scatter(cube, { color: 0x4b3a2a, rough: 1 }, trees.map((b) => [b.x, b.h / 2, b.z, 0.45, b.h, 0.45]));
  ctx.scatter(ball, { color: 0xffffff, rough: 1, sway: 0.12 }, trees.flatMap((b) => [[0, 0, 1.9], [0.8, 0.5, 1.4], [-0.7, 0.3, 1.3]].map(([dx, dy, sz], i) =>
    [b.x + dx, b.h + dy, b.z - dx, sz * 1.2, sz, sz * 1.2, i, [0x4f7a3a, 0x6b8f3e, 0x3d6634][i]])));
  const weeds = [];
  for (let n = 0; n < 1400; n++) { const x = r() * 154 - 77, z = r() * 122 - 61, sz = 0.25 + r() * 0.35; if (!holes.has(Math.floor(x / G) + ',' + Math.floor(z / G))) weeds.push([x, sz * 0.4, z, sz, sz * 0.8, sz, r() * 6, any([0x5d7a3a, 0x7d9346, 0x4a6b33, 0x8c8a4a])]); }
  ctx.scatter(ball, { color: 0xffffff, rough: 1, sway: 0.06 }, weeds, [0, 300, 800, 1400]);
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
  const poles = [], heads = [], on = [];
  for (const [x, z, o] of lamps) { poles.push([x, 2.5, z, 0.09, 5, 0.09]); heads.push([x, 5.05, z + 0.6, 0.3, 0.12, 1.3]); (o ? on : heads).push([x, 4.95, z + 1.1, 0.28, 0.08, 0.28]); }
  ctx.scatter(can, { color: 0x30363b, rough: 0.6, metal: 0.5 }, poles);
  ctx.scatter(cube, { color: 0x30363b, rough: 0.6, metal: 0.5 }, heads);
  ctx.scatter(cube, { emissive: 0xffe2a0 }, on);
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
  for (const [op, col] of [[0.55, 0x3d3f42], [0.35, 0x6a6c70]]) {
    const still = ctx0.scatter(ball, { color: col, opacity: op }, smokes.flatMap(([x, y, z, rr], i) =>
      [[0, 0, 0], [0.5, 0.3, -0.4], [-0.45, -0.2, 0.35]].map(([dx, dy, dz]) => [x + dx * rr, y + dy * rr, z + dz * rr, rr * (op > 0.4 ? 0.75 : 0.95), rr * 0.7, rr * 0.8, i])));
    if (still) still.userData.smoke = true;                      // (on Max the moving smoke takes over)
  }
  // the subway: twin rails and sleepers down every tunnel, strip lights on the ceiling, station signs
  const rails = [], sleepers = [];
  for (const bz of BZ) { const z = (bz + 8.5) * G; for (const dz of [-0.72, 0.72]) rails.push([0, 0.08, z + dz, 160, 0.12, 0.08]); for (let x = -78; x <= 78; x += 0.9) sleepers.push([x, 0.04, z, 0.25, 0.08, 2.1]); }
  for (const bx of BX) { const x = (bx - 1.5) * G; for (const dx of [-0.72, 0.72]) rails.push([x + dx, 0.08, 0, 0.08, 0.12, 128]); for (let z = -62; z <= 62; z += 0.9) sleepers.push([x, 0.04, z, 2.1, 0.08, 0.25]); }
  ctx0.scatter(cube, { color: 0x6c7176, rough: 0.4, metal: 0.8 }, rails);
  ctx0.scatter(cube, { color: 0x4a3b2e, rough: 1 }, sleepers);
  ctx0.scatter(cube, { emissive: 0xd8efff }, tunnelLights.filter(([x, z]) => lit(x, z)).map(([x, z]) => [x, DECK - 0.45, z, 1.6, 0.06, 0.18]));
  // graffiti all down the tunnel walls (the faces of the solid ground under each block): big pieces and tags
  const art = [], tags = [], junk = [], wet = [], cables = [];
  const COLS = [0xe0457b, 0x3fc1d9, 0xf2c230, 0x8d5bd6, 0x50c46a, 0xff7a33, 0xf4f1e8, 0x1d1d22];
  for (const bx of BX) for (const bz of BZ) {
    const x0 = bx * G, x1 = (bx + 7) * G, z0 = bz * G, z1 = (bz + 7) * G;
    for (const [fx, fz, alongX, out] of [[null, z0, true, -1], [null, z1, true, 1], [x0, null, false, -1], [x1, null, false, 1]]) for (let k = 0; k < 4; k++) {
      const u = (alongX ? x0 : z0) + 2 + r() * (7 * G - 4), x = alongX ? u : fx + out * 0.04, z = alongX ? fz + out * 0.04 : u;
      const w = 1.6 + r() * 2.6, h = 0.7 + r() * 1.2, y = 0.5 + r() * 1.4, c = any(COLS);
      art.push([x, y + h / 2, z, alongX ? w : 0.02, h, alongX ? 0.02 : w, 0, c]);                       // a piece's background
      for (let j = 0; j < 3; j++) tags.push([x + (alongX ? (r() - 0.5) * w * 0.7 : out * 0.01), y + h * (0.25 + r() * 0.5), z + (alongX ? out * 0.01 : (r() - 0.5) * w * 0.7), alongX ? w * (0.2 + r() * 0.3) : 0.02, 0.08 + r() * 0.12, alongX ? 0.02 : w * (0.2 + r() * 0.3), 0, any(COLS)]);
      if (r() < 0.6) junk.push([x + (alongX ? (r() - 0.5) * 3 : -out * 0.5), 0.25, z + (alongX ? -out * 0.5 : (r() - 0.5) * 3), 0.6 + r() * 0.6, 0.35 + r() * 0.3, 0.5 + r() * 0.5, r() * 3, any([0x26282b, 0x3a3226, 0x2e3b2f])]);
    }
    for (const [x, z, alongX] of [[(x0 + x1) / 2, z0 - 0.08, true], [(x0 + x1) / 2, z1 + 0.08, true], [x0 - 0.08, (z0 + z1) / 2, false], [x1 + 0.08, (z0 + z1) / 2, false]])
      cables.push([x, 3.1, z, alongX ? 7 * G : 0.06, 0.06, alongX ? 0.06 : 7 * G], [x, 3.25, z, alongX ? 7 * G : 0.05, 0.05, alongX ? 0.05 : 7 * G]);
  }
  for (let n = 0; n < 40; n++) { const t = any(tunnelLights); wet.push([t[0] + (r() - 0.5) * 6, 0.012, t[1] + (r() - 0.5) * 6, 1 + r() * 2.5, 0.01, 0.8 + r() * 2, r() * 3]); }
  ctx0.scatter(cube, { color: 0xffffff, rough: 0.85 }, art);
  ctx0.scatter(cube, { color: 0xffffff, rough: 0.7 }, tags);
  ctx0.scatter(cube, { color: 0xffffff, rough: 1 }, junk);
  ctx0.scatter(cube, { color: 0x10161c, opacity: 0.55 }, wet);
  ctx0.scatter(cube, { color: 0x1a1a1c, rough: 0.6 }, cables);
  // the trains: windows and a red stripe down each side, a dim light left on inside
  for (const [x, z, alongX] of TRAINS) for (const k of [-1, 1]) {
    const cx = x + (alongX ? k * 9.4 : 0), cz = z + (alongX ? 0 : k * 9.4);
    for (const side of [-1, 1]) {
      ctx0.box({ color: 0xb8332e, rough: 0.6 }, alongX ? 9.02 : 0.02, 0.25, alongX ? 0.02 : 9.02, cx + (alongX ? 0 : side * 1.41), 1.1, cz + (alongX ? side * 1.41 : 0));
      for (let j = -3; j <= 3; j++) ctx0.box({ emissive: 0x9fb4c0 }, alongX ? 0.9 : 0.02, 0.7, alongX ? 0.02 : 0.9, cx + (alongX ? j * 1.2 : side * 1.42), 2.1, cz + (alongX ? side * 1.42 : j * 1.2));
    }
  }
  for (const [sx, sz, name] of STATIONS) {
    { const x0 = sx * G, z = (sz + 0.5) * G;                                                          // white tiles on the station walls, posters, a green EXIT sign
      for (const dz of [-1.55 * G, 1.55 * G]) ctx0.box({ color: 0xd9dcd8, rough: 0.35 }, 4 * G, 2.4, 0.04, x0 - 2 * G, 1.4, z + dz);
      for (const [dx, dz, c] of [[-2.6, -1.53, 0xd9b44a], [-1.2, -1.53, 0x2c8fd1], [-2.2, 1.53, 0xe04b3b]]) ctx0.box({ color: c, rough: 0.8 }, 1.1, 1.5, 0.03, x0 + dx * G, 1.6, z + dz * G);
      ctx0.box({ emissive: 0x35d66a }, 0.06, 0.32, 0.9, x0 - 0.2, 3.1, z); }
    const x0 = sx * G, z = (sz + 0.5) * G;
    ctx0.box({ color: 0x1c4f9c, rough: 0.5 }, 0.08, 0.7, 2.6, x0 - 4.4 * G + 0.06, 2.3, z);           // the station's name board
    ctx0.box({ emissive: 0xf4f6f8 }, 0.02, 0.36, 2.2, x0 - 4.4 * G + 0.11, 2.3, z);
    ctx.box({ emissive: 0x2f7bff }, 0.12, 0.5, 0.5, x0 - 0.3, 1.6, z + G / 2 + 0.1);                   // the blue station sign at the top of the stairs
    void name;
  }
}

// The streets. Low / Standard: 4 px a metre. High and up: 16 px a metre with grain, patched and
// cracked asphalt, potholes, oil stains, manhole covers, kerbs, paving slabs and crisp lane lines.
function asphalt() {
  const hi = gfxLevel.q === 'high' || gfxLevel.q === 'ultra', P = hi ? 16 : 4;
  const canvas = document.createElement('canvas'), w = 160 * P, h = 128 * P;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), px4 = ctx.createImageData(w, h), r = mulberry32(19);
  let seed = 19;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const grain = (seed / 4294967296 - 0.5) * (hi ? 30 : 22), stone = hi && (seed & 63) === 0 ? 26 : 0;   // (bright chips in the tar)
    const v = 62 + grain + stone + 6 * Math.sin(x * 0.05 * 4 / P + y * 0.03 * 4 / P), at = (y * w + x) * 4;
    px4.data[at] = v; px4.data[at + 1] = v + 1; px4.data[at + 2] = v + 3; px4.data[at + 3] = 255;
  }
  ctx.putImageData(px4, 0, 0);
  const m = (v, half) => (v + half) * P;                       // metres to pixels
  const blocks = BX.flatMap((kx) => BZ.map((kz) => [m(kx * G - 1.2, 80), m(kz * G - 1.2, 64), (7 * G + 2.4) * P]));
  if (hi) {                                                    // patched asphalt and potholes, under the paint
    for (let n = 0; n < 90; n++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '40,40,42' : '84,84,86'},0.55)`; ctx.fillRect(r() * w, r() * h, (2 + r() * 6) * P, (1 + r() * 3) * P); }
    for (let n = 0; n < 70; n++) { const x = r() * w, y = r() * h, s = (0.3 + r() * 0.6) * P; ctx.fillStyle = 'rgba(22,21,20,.9)'; ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.7, r() * 3, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(120,118,112,.5)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  ctx.fillStyle = '#8d8a84';                                   // pavements around every block
  for (const [x, y, s] of blocks) ctx.fillRect(x, y, s, s);
  if (hi) {
    ctx.strokeStyle = 'rgba(70,68,64,.55)'; ctx.lineWidth = 1;   // paving slabs, 1.6 m
    for (const [x, y, s] of blocks) { ctx.beginPath(); for (let k = 0; k <= s; k += 1.6 * P) { ctx.moveTo(x + k, y); ctx.lineTo(x + k, y + s); ctx.moveTo(x, y + k); ctx.lineTo(x + s, y + k); } ctx.stroke(); }
    ctx.strokeStyle = '#b8b4aa'; ctx.lineWidth = 0.25 * P;       // kerb stones
    for (const [x, y, s] of blocks) ctx.strokeRect(x + 0.12 * P, y + 0.12 * P, s - 0.24 * P, s - 0.24 * P);
  }
  ctx.strokeStyle = hi ? '#d8c25e' : '#c9b45c'; ctx.lineWidth = hi ? 0.15 * P : 2; ctx.setLineDash(hi ? [3 * P, 3 * P] : [12, 12]);   // centre lines
  for (const kz of BZ) { const z = m((kz + 8.5) * G, 64); ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(w, z); ctx.stroke(); }
  for (const kx of BX) { const x = m((kx - 1.5) * G, 80); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.setLineDash([]);
  if (hi) {
    ctx.strokeStyle = 'rgba(236,234,226,.8)'; ctx.lineWidth = 0.12 * P;   // white edge lines
    for (const kz of BZ) for (const d of [-1.3, 1.3]) { const z = m((kz + 8.5 + d) * G, 64); ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(w, z); ctx.stroke(); }
    for (const kx of BX) for (const d of [-1.3, 1.3]) { const x = m((kx - 1.5 + d) * G, 80); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(18,17,16,.85)'; ctx.lineWidth = 1.2;           // cracks across everything
    for (let n = 0; n < 260; n++) { let x = r() * w, y = r() * h; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 3 * P; y += (r() - 0.5) * 3 * P; ctx.lineTo(x, y); } ctx.stroke(); }
    for (let n = 0; n < 40; n++) { const x = m((BX[n % 5] - 1.5) * G + (r() - 0.5) * 4, 80), y = r() * h; ctx.fillStyle = '#3a3b3d'; ctx.beginPath(); ctx.arc(x, y, 0.4 * P, 0, 7); ctx.fill(); ctx.strokeStyle = '#55575a'; ctx.lineWidth = 2; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(x - 0.3 * P, y + k * 0.12 * P); ctx.lineTo(x + 0.3 * P, y + k * 0.12 * P); ctx.stroke(); } }   // manholes
  }
  for (let n = 0; n < 160; n++) { const s = (0.75 + (n % 7) * 0.5) * P; ctx.fillStyle = `rgba(30,28,26,${0.15 + (n % 5) * 0.06})`; ctx.beginPath(); ctx.arc((n * 97 * P / 4) % w, (n * 61 * P / 4) % h, s, 0, 7); ctx.fill(); }   // oil and burn stains
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = hi ? 8 : 1;
  return { map };
}

// The subway floor: dark concrete with tiles and grime.
function subwayFloor() {
  const canvas = document.createElement('canvas'), w = 640, h = 512;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), r = mulberry32(23);
  ctx.fillStyle = '#3d3e40'; ctx.fillRect(0, 0, w, h);
  for (let n = 0; n < 900; n++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '20,20,22' : '90,90,92'},${0.08 + r() * 0.12})`; ctx.fillRect(r() * w, r() * h, 2 + r() * 14, 2 + r() * 14); }
  ctx.strokeStyle = 'rgba(15,15,16,.6)'; ctx.lineWidth = 1;
  for (let k = 0; k <= w; k += 8) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, h); ctx.stroke(); }
  for (let k = 0; k <= h; k += 8) { ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(w, k); ctx.stroke(); }
  const map = new CanvasTexture(canvas);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.colorSpace = SRGBColorSpace;
  return { map, tileX: 160, tileZ: 128, rough: 0.9, keepInLow: true };
}

const Y = MAPS.yard.kinds;
// spawns: the drop points (shared with Blacktide, royale-map.js).
export const ruins = (spawns) => ({
  name: 'Ruined City', hx: 80, hz: 64, wallH: 5, deckY: DECK,
  sky: duskSky, background: 0x5d6064, fog: [0x7d8084, 70, 170],
  hemi: [0xd8dde2, 0x4a4540, 2.1], key: [0xffe6c8, 1.9, [38, 80, -26]],
  floor: subwayFloor,
  wall: () => ({ ...wallPanels(), tileW: 2, tileH: 4 }),
  kinds: {
    concrete: { ...surface('concrete', Y.low.map), color: 0xa7a7a3, rough: 0.95, tile: 2 },
    brick: { ...surface('brick', Y.low.map), color: 0x9a6650, rough: 0.95, tile: 1.4 },
    plaster: { ...surface('plaster', Y.low.map), color: 0xc9c2b4, rough: 0.95, tile: 2 },
    slab: { ...surface('concrete', Y.low.map), color: 0x8b8b88, rough: 0.95, tile: 2 },
    rubble: { ...surface('rock', Y.low.map), color: 0x7a7570, rough: 1, tile: 1 },
    ground: { ...surface('rock', Y.low.map), color: 0x55524d, rough: 1, tile: 2 },
    deck: { ...surface('concrete', Y.low.map), color: 0x5e5f61, rough: 0.95, tile: 2 },
    steel: { color: 0x3b4146, rough: 0.5, metal: 0.7 },
    train: { map: Y.container.map, color: 0x9aa3a8, metal: 0.5, rough: 0.5, tile: 2 },
    booth: { map: Y.container.map, color: 0x2f5e8e, metal: 0.4, rough: 0.6, tile: 1.5 },
    wood: { ...surface('planks', Y.plank.map), color: 0x8a6446, rough: 0.85, tile: 1.2 },
    fabric: { color: 0x5b6a7a, rough: 1 },
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
  chests: [...spawns.map(([x, z]) => [x * 0.92, z * 0.92, DECK]), ...chests],
  fixtures: [...lamps.filter(([, , o]) => o).map(([x, z, o]) => [x, DECK + 4.9, z + 1.1, 0xffd29a, 7, 13, 1.0, o === 2 ? 2 : 0]),
    ...barrels.map(([x, z]) => [x, DECK + 3.2, z, 0xff8a3a, 6, 9, 1.35, 1]), ...burning.map(([x, z]) => [x, DECK + 3.6, z, 0xff7a2a, 9, 12, 1.4, 1]),
    ...stationLights.map(([x, z]) => [x, DECK - 0.5, z, 0xdcecff, 6, 7, 1.3, 0]),
    ...tunnelLights.filter(([x, z], i) => i % 3 === 0 && lit(x, z)).map(([x, z]) => [x, DECK - 0.5, z, 0xcfe4ff, 4, 6, 1.2, 2])],
  mist: true,
  layout, smokes, fires: [...barrels.map(([x, z]) => [x, z, false, DECK]), ...burning.map(([x, z]) => [x, z, true, DECK])],
  extra: (ctx) => life(ctx),
});
