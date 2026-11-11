// Builds data/maps/*.json for the match modes: the layout below, plus places to go and cover
// spots computed from the walls with the game's own collision and pathfinding (the Rust core).
// Run: node tools/build-maps.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { MatchMap } from '../js/modes/map.js';
import { MAPS as BATTLE } from '../js/battle/maps.js';
import { layoutSolids } from '../js/battle/solids.js';

const H = 3.2;
const wall = (x0, z0, x1, z1, h = H, look) => (look ? { x0, z0, x1, z1, h, look } : { x0, z0, x1, z1, h });
const box = (x, z, w, d, h, look) => wall(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h, look);
// A wall along x (at z) or along z (at x) with open gaps [[from, to]].
function line(axis, a, b, at, gaps = [], t = 0.4, h = H) {
  const cuts = [a, ...gaps.flat(), b], out = [];
  for (let i = 0; i < cuts.length; i += 2) {
    const s0 = cuts[i], s1 = cuts[i + 1];
    if (s1 - s0 < 0.05) continue;
    out.push(axis === 'x' ? wall(s0, at - t / 2, s1, at + t / 2, h) : wall(at - t / 2, s0, at + t / 2, s1, h));
  }
  return out;
}
const pt = (w) => ({ ...w, x0: -w.x1, x1: -w.x0, z0: -w.z1, z1: -w.z0 });   // point mirror

/* ---------- Yard: symmetric arena for TDM and CTF (A west, B east) ---------- */
const yardHalf = [
  ...line('z', -9, -3, -21), ...line('z', 3, 9, -21),               // base walls round the flag
  ...line('x', -16, -5, 7), ...line('x', -16, -5, -7),                // lane dividers (mid lane between)
  box(-9, 2.6, 2.2, 1, 1.1), box(-12, -1.8, 1, 2.2, 1.1),            // mid cover
  box(-12, 14, 2.5, 2.5, 2.6), box(-6, 12, 3, 0.8, 1.1), box(-17, 17, 1.2, 1.2, 1.2),   // north flank
  box(-18, -14, 2, 4, 2.6), box(-8, -15, 1.2, 1.2, 1.2), box(-4, -11, 0.8, 3, 1.1),       // south flank
  box(-25, 3.5, 0.6, 2.5, 1.1), box(-25, -3.5, 0.6, 2.5, 1.1),       // flag cover
  box(-27, 12, 3, 0.8, 2.6), box(-27, -12, 3, 0.8, 2.6),
];
const yard = {
  id: 'yard', name: 'Yard', hx: 30, hz: 20, wallH: H,
  walls: [...yardHalf, ...yardHalf.map(pt), box(0, 0, 3, 3, H)],
  soft: [], reinforced: [],
  // spawns in the back corners of each base, away from the flag
  spawns: { A: [[-28.5, -16, 90], [-28.5, 16, 90], [-25, -18.5, 90], [-25, 18.5, 90], [-28.5, -10, 90], [-28.5, 10, 90]], B: [[28.5, 16, -90], [28.5, -16, -90], [25, 18.5, -90], [25, -18.5, -90], [28.5, 10, -90], [28.5, -10, -90]] },
  flags: { A: [-26, 0], B: [26, 0] },
  sites: [],
  gadgets: { mine: [[-21, 0], [21, 0], [-14, 9], [14, -9]], jammer: [[-23, 6], [23, -6]], catcher: [[-23, -6], [23, 6]] },
  callouts: [
    { name: 'West base', x0: -30, z0: -20, x1: -20, z1: 20 }, { name: 'East base', x0: 20, z0: -20, x1: 30, z1: 20 },
    { name: 'North flank', x0: -20, z0: 7, x1: 20, z1: 20 }, { name: 'South flank', x0: -20, z0: -20, x1: 20, z1: -7 },
    { name: 'Mid', x0: -20, z0: -7, x1: 20, z1: 7 },
  ],
};

/* ---------- Depot: a building with two bomb sites (attack from the south) ---------- */
// Building x -16..16, z -6..12; hallway x -2..2 between Site A (west) and Site B (east).
const depot = {
  id: 'depot', name: 'Depot', hx: 22.5, hz: 17.5, wallH: H, building: [-16, -6, 16, 12],
  walls: [
    ...line('x', -16, 16, -6, [[-12.5, -10.5], [-8, -5], [-1, 1], [5, 8], [10.5, 12.5]]),   // south wall: doors and soft gaps
    ...line('x', -16, 16, 12, [[-10, -8], [-1, 1], [8, 10]]),                           // north wall with doors
    ...line('z', -6, 12, -16, [[2, 5]]), ...line('z', -6, 12, 16, [[2, 5]]),            // side walls (soft gaps)
    ...line('z', -6, 12, -2, [[1, 4], [7, 9]]), ...line('z', -6, 12, 2, [[1, 4], [7, 9]]),   // hallway walls (reinforced gap, door)
    // Site A inside
    box(-12, 0, 1.5, 1.5, 1.1), box(-6, 8.5, 3, 0.6, 2), box(-13.5, 9.5, 1.2, 1.2, 1.2),
    // Site B inside (different)
    box(12, 1, 1.5, 1.5, 1.1), box(7, 8.5, 0.6, 3, 2), box(13.5, -3.5, 1.2, 1.2, 1.2), box(9.5, 5.5, 1.2, 1.2, 1.1),
    // hallway
    box(0, 3, 1, 1, 1.1),
    // south yard (attackers' approach)
    box(-12, -11, 5, 2.4, 2.6), box(0, -10, 4, 0.6, 1.1), box(10, -12.5, 2.4, 5, 2.6), box(-4, -14, 1.2, 1.2, 1.2), box(6, -8.5, 1.2, 1.2, 1.2), box(-18.5, -9, 1.2, 3, 1.1), box(18.5, -8, 1.2, 1.2, 1.2),
    // north court
    box(-12, 15, 3, 0.6, 1.1), box(12, 15, 3, 0.6, 1.1), box(0, 15, 1.2, 1.2, 1.2), box(-19, 6, 1.2, 4, 2.6), box(19, 4, 1.2, 1.2, 1.2),
  ],
  soft: [
    { x0: -8, z0: -6, x1: -5, z1: -6 }, { x0: -16, z0: 2, x1: -16, z1: 5 },     // Site A: south and west
    { x0: 5, z0: -6, x1: 8, z1: -6 }, { x0: 16, z0: 2, x1: 16, z1: 5 },         // Site B: south and east
  ],
  reinforced: [
    { x0: -2, z0: 1, x1: -2, z1: 4 }, { x0: 2, z0: 1, x1: 2, z1: 4 },          // each site's hallway wall
  ],
  spawns: { A: [[-16, -16, 180], [-7, -16, 180], [0, -16.2, 180], [7, -16, 180], [16, -16, 180]], B: [[0, 6, 0], [0, 10, 0], [-14, 10.5, 0], [14, 10.5, 0], [0, 15.5, 0]] },
  flags: {},
  sites: [{ name: 'A', x: -9, z: 3, r: 3.2 }, { name: 'B', x: 9, z: 3, r: 3.2 }],
  gadgets: {
    mine: [[-11.5, -4.6, 'A'], [-9, 10.6, 'A'], [-3.4, 8, 'A'], [11.5, -4.6, 'B'], [9, 10.6, 'B'], [3.4, 8, 'B']],
    jammer: [[-6.5, -4.8, 'A'], [-14.6, 3.5, 'A'], [6.5, -4.8, 'B'], [14.6, 3.5, 'B']],
    catcher: [[-7.5, -4.6, 'A'], [-14.6, 1.8, 'A'], [7.5, -4.6, 'B'], [14.6, 1.8, 'B']],
  },
  callouts: [
    { name: 'A site', x0: -16, z0: -6, x1: -2, z1: 12 }, { name: 'B site', x0: 2, z0: -6, x1: 16, z1: 12 }, { name: 'Hallway', x0: -2, z0: -6, x1: 2, z1: 12 },
    { name: 'South yard', x0: -22.5, z0: -17.5, x1: 22.5, z1: -6 }, { name: 'North court', x0: -22.5, z0: 12, x1: 22.5, z1: 17.5 },
    { name: 'West side', x0: -22.5, z0: -6, x1: -16, z1: 12 }, { name: 'East side', x0: 16, z0: -6, x1: 22.5, z1: 12 },
  ],
};

/* ---------- Bomb buildings: attackers start outside ---------- */
// A storey is H (3.2 m) high; an upper floor stands on a 0.2 m slab whose top is at H.
// spec.lines(wl): wall lines, wl(axis, a, b, at, openings, y0 = 0, h = H, upperOpenings), each opening
//   [from, to, type]:
//   'gap'   open
//   'door'  a boarded door (breakable; outside doors start boarded)
//   'idoor' an open doorway defenders can barricade in prep
//   'win'   a window: a 1 m sill (vault over it) and an opening up to 2.3 m; boarded up at
//           the start in an outside wall, open inside (defenders can board it)
//   'soft'  a breakable wall (defenders can reinforce it)
//   'reinf' a wall only a charge opens
// spec.slabs:  [[x0, z0, x1, z1, floor]]       upper floor at H (floor: its look)
// spec.stairs: [[x0, z0, x1, z1, dir, y0, y1]]  ten steps rising along dir ('+x', '-z', ...)
// spec.rails:  [[x0, z0, x1, z1, y0]]           1 m railings (vault them; not a floor)
// Wall tops, sills and rails cannot be stood on (ns: 1).
const SILL = 1.0, WIN_TOP = 2.3;
function building(spec) {
  const walls = [], doors = [], soft = [], reinforced = [], openings = [];
  // (h > H: a double-height wall; its upper storey gets the openings upOpen)
  const wl = (axis, a, b, at, open = [], y0 = 0, h = H, upOpen = []) => {
    if (h > H) wl(axis, a, b, at, upOpen, y0 + H, h - H);
    const sorted = open.slice().sort((p, q) => p[0] - q[0]);
    walls.push(...line(axis, a, b, at, sorted.map((o) => [o[0], o[1]])).map((w) => ({ ...w, look: 'house', ns: 1, ...(y0 ? { y0 } : {}) })));
    for (const [f, t, type] of sorted) {
      const seg = axis === 'x' ? { x0: f, z0: at, x1: t, z1: at } : { x0: at, z0: f, x1: at, z1: t };
      const y = y0 ? { y0 } : {};
      if (type === 'door') doors.push({ ...seg, ...y });
      else if (type === 'idoor') doors.push({ ...seg, ...y, slot: 1 });
      else if (type === 'win') {
        walls.push(...line(axis, f, t, at, [], 0.4, SILL).map((w) => ({ ...w, look: 'house', ns: 1, kind: 'sill', ...(y0 ? { y0 } : {}) })));
        // windows in the outside walls start boarded up, as outside doors do (attackers break
        // in); windows inside the building start open (defenders may board them)
        const B = spec.data.building, outer = B && (axis === 'x' ? at === B[1] || at === B[3] : at === B[0] || at === B[2]);
        doors.push({ ...seg, ...y, lo: SILL, hi: WIN_TOP, ...(outer ? {} : { slot: 1 }) });
      } else if (type === 'soft') soft.push({ ...seg, ...y });
      else if (type === 'reinf') reinforced.push({ ...seg, ...y });
      if (type !== 'soft' && type !== 'reinf') openings.push({ axis, at, c: (f + t) / 2, y0, type });
    }
  };
  spec.lines(wl);
  for (const [x0, z0, x1, z1, floor] of spec.slabs || []) walls.push({ x0, z0, x1, z1, y0: H - 0.2, h: 0.2, kind: 'floor', look: 'slab-' + (floor || 'wood') });
  for (const [x0, z0, x1, z1, dir, y0 = 0, y1 = H] of spec.stairs || []) {
    const n = 10, along = dir[1] === 'x' ? x1 - x0 : z1 - z0;
    for (let i = 0; i < n; i++) {
      const k = dir[0] === '+' ? i : n - 1 - i, a0 = along * k / n, a1 = along * (k + 1) / n;
      const top = +(y0 + (y1 - y0) * (i + 1) / n).toFixed(3);
      walls.push(dir[1] === 'x' ? { x0: x0 + a0, z0, x1: x0 + a1, z1, y0, h: +(top - y0).toFixed(3), kind: 'stair', look: 'stair' } : { x0, z0: z0 + a0, x1, z1: z0 + a1, y0, h: +(top - y0).toFixed(3), kind: 'stair', look: 'stair' });
    }
  }
  for (const [x0, z0, x1, z1, y0 = H] of spec.rails || []) walls.push({ x0, z0, x1, z1, y0, h: 1.0, kind: 'rail', look: 'rail', ns: 1 });
  walls.push(...roofs(spec));
  // the ways into each site: doorways, windows and openings of its room (ground floor)
  const sites = spec.data.sites.map((st) => ({ ...st, entries: openings.filter((o) => !o.y0).map((o) => (o.axis === 'x' ? [o.c, o.at] : [o.at, o.c])).filter((e) => {
    const room = (spec.data.callouts || []).find((c) => c.floor && !c.y && st.x > c.x0 && st.x < c.x1 && st.z > c.z0 && st.z < c.z1);
    return room ? e[0] >= room.x0 - 0.6 && e[0] <= room.x1 + 0.6 && e[1] >= room.z0 - 0.6 && e[1] <= room.z1 + 0.6 : Math.hypot(e[0] - st.x, e[1] - st.z) < 11;
  }) }));
  // the defenders' area: the rooms (callouts with a floor), both storeys
  const inside = (spec.data.callouts || []).filter((c) => c.floor).map((c) => [c.x0, c.z0, c.x1, c.z1]);
  return { ...spec.data, open: true, sites, inside, wallH: H, walls: [...walls, ...spec.data.walls], doors, soft, reinforced, openings };
}

// Roofs: every room indoors gets one on top of its walls. Rooms under an upper storey, and
// double-height rooms (spec.roof.tall), get it at 2H; the others at H. Open-air rooms
// (spec.roof.open, e.g. a courtyard), balconies and decks stay open. The roof is solid (it stops
// bullets and grenades) and cannot be stood on. At the building's outside walls it overhangs.
const ROOF_T = 0.25, EAVE = 0.45;
function roofs(spec) {
  const d = spec.data, B = d.building, opt = spec.roof || {}, C = d.callouts || [];
  const rooms = C.filter((c) => c.floor && !c.y && !(opt.open || []).includes(c.name));
  const uppers = C.filter((c) => c.y >= H - 0.01 && c.x0 >= B[0] && c.x1 <= B[2] && c.z0 >= B[1] && c.z1 <= B[3]);
  // tall: room names, or [x0, z0, x1, z1] parts of rooms (both storeys)
  const tall = (opt.tall || []).map((t) => (Array.isArray(t) ? { x0: t[0], z0: t[1], x1: t[2], z1: t[3] } : C.find((c) => c.name === t))).filter(Boolean);
  const xs = [...new Set([...rooms, ...uppers, ...tall].flatMap((c) => [c.x0, c.x1]))].sort((a, b) => a - b);
  const zs = [...new Set([...rooms, ...uppers, ...tall].flatMap((c) => [c.z0, c.z1]))].sort((a, b) => a - b);
  const inside = (c, x, z) => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
  // height of each cell (0: no roof)
  const hgt = xs.slice(0, -1).map((x0, i) => zs.slice(0, -1).map((z0, j) => {
    const x = (x0 + xs[i + 1]) / 2, z = (z0 + zs[j + 1]) / 2;
    if (!rooms.some((c) => inside(c, x, z))) return 0;
    return uppers.some((c) => inside(c, x, z)) || tall.some((c) => inside(c, x, z)) ? 2 * H : H;
  }));
  // merge cells into rectangles: runs along z, then equal runs along x
  const used = hgt.map((col) => col.map(() => false)), out = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const y = hgt[i][j];
    if (!y || used[i][j]) continue;
    let j1 = j; while (j1 + 1 < zs.length - 1 && hgt[i][j1 + 1] === y && !used[i][j1 + 1]) j1++;
    let i1 = i; while (i1 + 1 < xs.length - 1 && [...Array(j1 - j + 1).keys()].every((k) => hgt[i1 + 1][j + k] === y && !used[i1 + 1][j + k])) i1++;
    for (let a = i; a <= i1; a++) for (let b = j; b <= j1; b++) used[a][b] = true;
    let x0 = xs[i], x1 = xs[i1 + 1], z0 = zs[j], z1 = zs[j1 + 1];
    // over the outside walls: eaves
    if (x0 === B[0]) x0 -= EAVE; if (x1 === B[2]) x1 += EAVE; if (z0 === B[1]) z0 -= EAVE; if (z1 === B[3]) z1 += EAVE;
    out.push({ x0, z0, x1, z1, y0: y, h: ROOF_T, kind: 'roof', look: 'roof', ns: 1 });
  }
  return out;
}

// Ranch: a long single-storey house with a loft. A hallway runs east-west between the south
// rooms (dining, kitchen, laundry, entry) and the north rooms (master bedroom = the site,
// living room, study); a garage and workshop at the east end. Upstairs (stairs in the study
// corner of the living room) a loft and a bedroom, reached from outside too, by the back
// stairs to a balcony. A barn, a corral and a trailer in the yards.
const ranch = building({
  lines: (wl) => {
    // outside walls
    wl('x', -28, 24, -14, [[-24, -22, 'win'], [-10, -8, 'win'], [6, 7.4, 'door'], [15, 21, 'soft'], [22, 23.4, 'door']]);
    wl('x', -28, 24, 14, [[-22, -20, 'win'], [-6, -4.6, 'door'], [0, 2, 'win'], [9, 11, 'win'], [17, 18.4, 'door']]);
    wl('z', -14, 14, -28, [[-9, -7.6, 'door'], [-1.7, -0.3, 'door'], [5, 7, 'win'], [9, 12, 'soft']]);
    wl('z', -14, 14, 24, [[-10, -7, 'soft'], [6, 8, 'win']]);
    // hallway
    wl('x', -28, 10, -3, [[-21, -19.6, 'idoor'], [-10, -8.6, 'idoor'], [-6, -3, 'soft'], [0, 1.4, 'idoor'], [6, 7.4, 'gap']]);
    wl('x', -28, 24, 1, [[-25, -22, 'soft'], [-17, -15.6, 'idoor'], [-4, -1, 'gap'], [7, 8.4, 'idoor'], [18, 19.4, 'idoor']]);
    // south rooms
    wl('z', -14, -3, -16, [[-10, -8, 'gap']]);
    wl('z', -14, -3, -2, [[-8, -6.6, 'idoor']]);
    wl('z', -14, -3, 4, [[-10, -7, 'soft']]);
    wl('z', -14, 1, 10, [[-9, -7.6, 'idoor'], [-2, -0.6, 'idoor']]);
    // north rooms
    wl('z', 1, 14, -12, [[3, 6, 'soft'], [9, 10.4, 'idoor']]);
    wl('z', 1, 14, 6, [[7, 10, 'soft'], [10.6, 12, 'idoor']]);
    wl('z', 1, 14, 14, [[5, 8, 'soft'], [10, 11.4, 'idoor']]);
    // upstairs: the loft (west) and a bedroom (east), a door out to the balcony
    wl('x', -12, 14, 1, [], H);
    wl('x', -12, 14, 14, [[-8, -6, 'win'], [7, 8.4, 'door']], H);
    wl('z', 1, 14, -12, [], H);
    wl('z', 1, 14, 14, [], H);
    wl('z', 1, 14, 2, [[8, 9.4, 'idoor'], [10.5, 13, 'soft']], H);
    // the barn (open on the south)
    wl('x', -9, 3, 26, []);
    wl('z', 20, 26, -9, [[22, 23.4, 'gap']]);
    wl('z', 20, 26, 3, []);
    wl('x', -9, -6, 20, []); wl('x', 0, 3, 20, []);
  },
  slabs: [[-12, 1, 4.4, 14, 'wood'], [4.4, 5.7, 14, 14, 'carpet2'], [6, 1, 14, 5.7, 'carpet2'], [4, 14, 13.6, 16.6, 'deck']],
  stairs: [[4.6, 1.2, 5.8, 5.7, '+z']],
  rails: [[4.3, 1.2, 4.4, 5.7], [5.9, 1.2, 6.0, 5.7], [4, 16.5, 12.4, 16.6], [3.9, 14, 4, 16.6]],
  data: {
    id: 'ranch', name: 'Ranch', hx: 40, hz: 30, building: [-28, -14, 24, 14], ground: 'grass',
    walls: [
      // the back stairs up to the balcony (outside: an attackers' way upstairs)
      ...Array.from({ length: 10 }, (_, i) => ({ x0: 12.4, z0: 16.6 + 0.6 * (9 - i), x1: 13.6, z1: 16.6 + 0.6 * (10 - i), y0: 0, h: +(0.32 * (i + 1)).toFixed(2), kind: 'stair', look: 'stair' })),
      // bedroom (the site)
      box(-24.5, 10.5, 2.4, 3, 0.75, 'bed'), box(-27.3, 3.5, 0.9, 2.4, 2, 'shelf'), box(-17, 13.3, 2.4, 0.6, 1.1, 'desk'), box(-14, 4, 1, 1, 0.9, 'crate'),
      // living room: sofas, a table, a fireplace
      box(-6, 6, 4, 1, 0.9, 'sofa'), box(-6, 9, 2.4, 1.2, 0.75, 'table'), box(0.5, 13.3, 3, 0.6, 1.3, 'counter'), box(-10.6, 12, 1, 2.4, 0.9, 'sofa'),
      // study
      box(10, 11.5, 2.4, 1, 1.1, 'desk'), box(13.3, 3, 0.6, 2.4, 2, 'shelf'),
      // kitchen and dining
      box(-9, -8.5, 3.2, 1.2, 1.0, 'counter'), box(-15.4, -12, 0.8, 3.4, 1.0, 'counter'), box(-22, -8.5, 3, 1.4, 0.8, 'table'), box(-27.3, -12.5, 0.8, 2, 2, 'shelf'),
      // laundry, entry
      box(1, -13.3, 2.4, 0.8, 1.0, 'counter'), box(8.6, -10, 1.2, 1.2, 1.2, 'crate'),
      // garage and workshop
      box(16, -6, 2.2, 4.6, 1.5, 'car'), box(23.3, -2, 0.6, 3, 2, 'shelf'), box(11, -12.5, 1.6, 1.2, 1.2, 'crate'), box(20, 4, 3, 0.9, 1.0, 'bench'), box(22.8, 12, 1.2, 1.2, 1.2, 'crate'),
      // upstairs: a bed and a sofa in the loft
      { ...box(-8, 11.6, 2.4, 2.6, 0.75, 'bed'), y0: H }, { ...box(-3, 3, 3, 1, 0.9, 'sofa'), y0: H }, { ...box(11, 12, 2, 1, 1.1, 'desk'), y0: H },
      // outside: cars, the corral (low fence), hay, a trailer
      box(-14, -20, 4.5, 2, 1.5, 'car'), box(8, -21, 2, 4.5, 1.5, 'car'), box(-2, -18, 1.2, 1.2, 1.2, 'crate'), box(20, -20, 3, 0.8, 1.1, 'barrier'),
      wall(-30, 18, -16, 18.15, 1.1, 'fence'), wall(-30, 18, -29.85, 26, 1.1, 'fence'), wall(-30, 25.85, -20, 26, 1.1, 'fence'),
      box(-25, 22, 1.4, 1.4, 1.2, 'crate'), box(-19, 21, 1.4, 1.4, 1.2, 'crate'), box(-4, 23, 3, 1.4, 1.2, 'crate'),
      box(30, 6, 2.6, 6, 2.6, 'container'), box(-34, -4, 2, 4.5, 1.5, 'car'), box(32, -10, 1.2, 3, 1.1, 'barrier'), box(-35, 12, 1.2, 1.2, 1.2, 'crate'),
    ],
    spawns: { A: [[-36, -26, 180], [0, -27, 180], [30, -26, 180], [-37, 6, 90], [36, 14, -90], [16, 27, 0]], B: [[-6, -1, 0], [-2, 9, 0], [-12, -8, 0], [16, 3, 0], [10, 7, 0]] },
    flags: {},
    sites: [{ name: 'A', x: -20, z: 7.5, r: 3.6 }],
    gadgets: {
      mine: [[-15.5, 2.6, 'A'], [-13, 9.7, 'A'], [-26.5, 6, 'A'], [-23.5, 2.4, 'A'], [-26.5, 8.5, 'A']],
      jammer: [[-20, 12.8, 'A'], [-14, 6.5, 'A']],
      catcher: [[-26.5, 13, 'A'], [-13.2, 12.8, 'A']],
    },
    callouts: [
      { name: 'Master bedroom (site)', x0: -28, z0: 1, x1: -12, z1: 14, floor: 'wood' }, { name: 'Living room', x0: -12, z0: 1, x1: 6, z1: 14, floor: 'carpet' }, { name: 'Study', x0: 6, z0: 1, x1: 14, z1: 14, floor: 'carpet2' },
      { name: 'Workshop', x0: 14, z0: 1, x1: 24, z1: 14, floor: 'concrete' }, { name: 'Hallway', x0: -28, z0: -3, x1: 10, z1: 1, floor: 'tiles' },
      { name: 'Dining room', x0: -28, z0: -14, x1: -16, z1: -3, floor: 'wood' }, { name: 'Kitchen', x0: -16, z0: -14, x1: -2, z1: -3, floor: 'tiles2' }, { name: 'Laundry', x0: -2, z0: -14, x1: 4, z1: -3, floor: 'tiles' },
      { name: 'Entry', x0: 4, z0: -14, x1: 10, z1: -3, floor: 'wood' }, { name: 'Garage', x0: 10, z0: -14, x1: 24, z1: 1, floor: 'concrete' },
      { name: 'Loft', x0: -12, z0: 1, x1: 2, z1: 14, floor: 'wood', y: H }, { name: 'Upstairs bedroom', x0: 2, z0: 1, x1: 14, z1: 14, floor: 'carpet2', y: H },
      { name: 'Front yard', x0: -40, z0: -30, x1: 40, z1: -14 }, { name: 'Back yard', x0: -40, z0: 14, x1: 40, z1: 30 }, { name: 'West side', x0: -40, z0: -14, x1: -28, z1: 14 }, { name: 'East side', x0: 24, z0: -14, x1: 40, z1: 14 },
      { name: 'Balcony', x0: 4, z0: 14, x1: 14, z1: 17, y: H },
    ],
  },
});

// Embassy: two storeys round an open courtyard. The site is the archives (north-west,
// ground floor), under the ambassador's office. Stairs in the west and east halls lead up to
// the north wing, whose windows look down into the courtyard; a fire escape outside the east
// end is the attackers' way upstairs. The vault (south-east) has reinforced walls.
const embassy = building({
  lines: (wl) => {
    // outside walls
    wl('x', -28, 28, -18, [[-24, -22, 'win'], [-12, -10, 'win'], [-1.2, 1.2, 'door'], [10, 12, 'win'], [20, 23, 'reinf']]);
    wl('x', -28, 28, 18, [[-26, -24, 'win'], [-20, -18.6, 'door'], [2, 4, 'win'], [14, 17, 'soft'], [20, 21.4, 'door']]);
    wl('z', -18, 18, -28, [[-15, -13.6, 'door'], [-3, -1, 'win'], [2, 5, 'soft'], [10, 12, 'win'], [14, 17, 'soft']]);
    wl('z', -18, 18, 28, [[-15, -12, 'reinf'], [-4, -2.6, 'door'], [2, 4, 'win'], [12, 14, 'win']]);
    // the south wing, the courtyard and the north wing
    wl('x', -28, 28, -7, [[-22, -20.6, 'idoor'], [-12, -10.6, 'idoor'], [-1.5, 1.5, 'gap'], [11, 12.4, 'idoor'], [20, 23, 'reinf']]);
    wl('x', -28, 28, 7, [[-26, -23, 'soft'], [-19, -17.6, 'idoor'], [-14.5, -13.1, 'idoor'], [-1, 1, 'gap'], [9, 10.4, 'idoor'], [20, 23, 'soft']]);
    wl('z', -18, -7, -16, [[-12, -10.6, 'idoor']]);
    wl('z', -18, -7, -8, [[-13, -11.6, 'idoor']]);
    wl('z', -18, -7, 8, [[-12, -10.6, 'idoor']]);
    wl('z', -18, -7, 16, [[-15, -12, 'reinf'], [-9.5, -8.1, 'idoor']]);
    wl('z', -7, 7, -16, [[1.5, 4.5, 'soft'], [5, 6.4, 'idoor']]);
    wl('z', -7, 7, -8, [[2, 3.4, 'idoor']]);
    wl('z', -7, 7, 8, [[-1.5, 1.5, 'gap']]);
    wl('z', -7, 7, 16, [[-6.4, -5, 'idoor'], [-4, -1, 'soft']]);
    wl('z', 7, 18, -12, [[9, 12, 'soft'], [14, 15.4, 'idoor']]);
    wl('z', 7, 18, -4, [[9, 10.4, 'idoor']]);
    wl('z', 7, 18, 12, [[14, 15.4, 'idoor']]);
    // upstairs: the west and east landings, and the north wing (office, gallery, records)
    wl('x', -16, -8, -7, [], H);
    wl('z', -7, 7, -16, [], H);
    wl('z', -7, 7, -8, [[-4, -2, 'win'], [3, 5, 'win']], H);
    wl('x', 8, 16, -7, [], H);
    wl('z', -7, 7, 8, [[-5, -3, 'win'], [2, 4, 'win']], H);
    wl('z', -7, 7, 16, [], H);
    wl('x', -28, 28, 7, [[-11, -9.6, 'idoor'], [-5, -3, 'win'], [3, 5, 'win'], [9.5, 10.9, 'idoor']], H);
    wl('x', -28, 28, 18, [[-22, -20, 'win'], [0, 2, 'win'], [20, 22, 'win']], H);
    wl('z', 7, 18, -28, [], H);
    wl('z', 7, 18, 28, [[8, 9.4, 'door']], H);
    wl('z', 7, 18, -12, [[12, 13.4, 'idoor'], [15, 17.5, 'soft']], H);
    wl('z', 7, 18, 12, [[10, 11.4, 'idoor']], H);
  },
  slabs: [[-28, 7, 28, 18, 'wood'], [-14, -7, -8, 7, 'carpet'], [-16, 0.5, -14, 7, 'carpet'], [-16, -7, -14, -5.5, 'carpet'], [8, -7, 14, 7, 'carpet'], [14, 5.5, 16, 7, 'carpet'], [14, -7, 16, -0.5, 'carpet'], [28, 3.5, 31.2, 10.5, 'deck']],
  stairs: [[-15.8, -5.5, -14.4, 0.5, '+z'], [14.4, -0.5, 15.8, 5.5, '-z'], [29.8, -2.5, 31.2, 3.5, '+z']],
  roof: { open: ['Courtyard'] },
  rails: [[-14.1, -5.5, -14, 0.5], [-15.8, -5.6, -14, -5.5], [14, -0.5, 14.1, 5.5], [14, 5.5, 15.8, 5.6], [28, 10.4, 31.2, 10.5], [31.2, 3.5, 31.3, 10.5], [28.2, 3.5, 29.8, 3.6]],
  data: {
    id: 'embassy', name: 'Embassy', hx: 42, hz: 32, building: [-28, -18, 28, 18], ground: 'lawn',
    walls: [
      // archives (the site): rows of shelves, a reading table
      box(-24, 12, 4, 0.7, 2, 'shelf'), box(-17, 12, 4, 0.7, 2, 'shelf'), box(-20.5, 15.8, 3, 1.2, 0.8, 'table'), box(-14, 9, 1, 1, 1.1, 'crate'),
      // library, dining, kitchen
      box(-8, 15, 0.7, 4, 2, 'shelf'), box(-8, 9.5, 2, 1, 0.8, 'table'), box(2, 12.5, 4, 1.4, 0.8, 'table'), box(-2.5, 16.8, 2, 0.6, 1.1, 'counter'),
      box(20, 9, 4, 1.2, 1.0, 'counter'), box(27.3, 16, 0.8, 3, 1.0, 'counter'), box(14, 16.8, 2.4, 0.8, 1.1, 'counter'),
      // courtyard: the fountain, planters
      box(0, 0, 2.6, 2.6, 1.0, 'fountain'), box(-5, 4.5, 1.2, 1.2, 0.9, 'planter'), box(5, -4.5, 1.2, 1.2, 0.9, 'planter'), box(-5, -4.5, 1.2, 1.2, 0.9, 'planter'), box(5, 4.5, 1.2, 1.2, 0.9, 'planter'),
      // south wing: reception desk, waiting room, security, mail room, the vault
      box(0, -12.5, 4, 0.9, 1.1, 'counter'), box(-12, -15, 3, 1, 0.9, 'sofa'), box(-22, -12, 2.4, 1.2, 1.1, 'desk'), box(-27.3, -10, 0.8, 3, 2, 'shelf'),
      box(14.2, -12.5, 0.7, 3, 2, 'shelf'), box(22, -11, 1.4, 1.4, 1.2, 'crate'), box(25, -15.5, 1.4, 1.4, 1.2, 'crate'),
      // west offices, conference room
      box(-23, -2, 2.4, 1.2, 1.1, 'desk'), box(-21, 3, 2.4, 1.2, 1.1, 'desk'), box(22, 0, 5, 1.8, 0.8, 'table'), box(27.3, -6, 0.8, 1.6, 2, 'shelf'),
      // upstairs: the ambassador's desk, gallery sofas, records shelves
      { ...box(-20, 12, 3, 1.2, 1.1, 'desk'), y0: H }, { ...box(-6, 12, 3, 1, 0.9, 'sofa'), y0: H }, { ...box(5, 14, 3, 1, 0.9, 'sofa'), y0: H }, { ...box(20, 16.8, 4, 0.7, 2, 'shelf'), y0: H }, { ...box(18, 11, 1.4, 1.4, 1.2, 'crate'), y0: H },
      // outside: cars, barriers, a guard booth, hedges
      box(-12, -24, 4.5, 2, 1.5, 'car'), box(10, -25, 2, 4.5, 1.5, 'car'), box(-34, 0, 2, 4.5, 1.5, 'car'), box(36, -8, 1.2, 3, 1.1, 'barrier'), box(-14, 24, 3, 0.8, 1.1, 'barrier'),
      box(14, 25, 4.5, 2, 1.5, 'car'), box(4, -22, 2.4, 2.4, 2.6, 'container'), box(-30, -24, 6, 0.9, 1.2, 'planter'), box(30, 24, 6, 0.9, 1.2, 'planter'), box(-36, 22, 1.2, 1.2, 1.2, 'crate'),
    ],
    spawns: { A: [[-36, -27, 180], [0, -29, 180], [34, -27, 180], [-39, 10, 90], [39, -14, -90], [0, 29, 0]], B: [[0, -12, 0], [-12, 0, 0], [12, 0, 0], [0, 12, 0], [-20, -12, 0]] },
    flags: {},
    sites: [{ name: 'A', x: -20.5, z: 12.5, r: 3.6 }],
    gadgets: {
      mine: [[-13, 8.2, 'A'], [-18.3, 8.2, 'A'], [-24.5, 8.2, 'A'], [-26.8, 11, 'A'], [-19.3, 17, 'A'], [-13, 14.7, 'A']],
      jammer: [[-20.5, 9, 'A'], [-13.2, 11, 'A']],
      catcher: [[-27, 16.8, 'A'], [-13, 16.8, 'A']],
    },
    callouts: [
      { name: 'Archives (site)', x0: -28, z0: 7, x1: -12, z1: 18, floor: 'wood' }, { name: 'Library', x0: -12, z0: 7, x1: -4, z1: 18, floor: 'carpet' }, { name: 'Dining room', x0: -4, z0: 7, x1: 12, z1: 18, floor: 'carpet2' },
      { name: 'Kitchen', x0: 12, z0: 7, x1: 28, z1: 18, floor: 'tiles2' }, { name: 'Courtyard', x0: -8, z0: -7, x1: 8, z1: 7, floor: 'stone' },
      { name: 'West offices', x0: -28, z0: -7, x1: -16, z1: 7, floor: 'carpet2' }, { name: 'West hall', x0: -16, z0: -7, x1: -8, z1: 7, floor: 'marble' },
      { name: 'East hall', x0: 8, z0: -7, x1: 16, z1: 7, floor: 'marble' }, { name: 'Conference room', x0: 16, z0: -7, x1: 28, z1: 7, floor: 'carpet' },
      { name: 'Security', x0: -28, z0: -18, x1: -16, z1: -7, floor: 'tiles' }, { name: 'Waiting room', x0: -16, z0: -18, x1: -8, z1: -7, floor: 'carpet2' }, { name: 'Reception', x0: -8, z0: -18, x1: 8, z1: -7, floor: 'marble' },
      { name: 'Mail room', x0: 8, z0: -18, x1: 16, z1: -7, floor: 'tiles' }, { name: 'Vault', x0: 16, z0: -18, x1: 28, z1: -7, floor: 'concrete' },
      { name: "Ambassador's office", x0: -28, z0: 7, x1: -12, z1: 18, floor: 'wood', y: H }, { name: 'Gallery', x0: -12, z0: 7, x1: 12, z1: 18, floor: 'wood', y: H }, { name: 'Records', x0: 12, z0: 7, x1: 28, z1: 18, floor: 'wood', y: H },
      { name: 'West landing', x0: -16, z0: -7, x1: -8, z1: 7, floor: 'carpet', y: H }, { name: 'East landing', x0: 8, z0: -7, x1: 16, z1: 7, floor: 'carpet', y: H },
      { name: 'Front', x0: -42, z0: -32, x1: 42, z1: -18 }, { name: 'Back', x0: -42, z0: 18, x1: 42, z1: 32 }, { name: 'West lawn', x0: -42, z0: -18, x1: -28, z1: 18 }, { name: 'East lawn', x0: 28, z0: -18, x1: 42, z1: 18 },
      { name: 'Fire escape', x0: 28, z0: -3, x1: 32, z1: 11, y: H },
    ],
  },
});

// Workshop: a double-height garage (the site) with a catwalk on its north side; storage
// rooms west of it, a paint shop east; a long maintenance corridor along the north of all
// three; offices, a break room, a server room, lockers and a loading bay beyond it. Upstairs
// over the offices: the manager's office and a drafting room, joined to the catwalk by a
// bridge over the corridor; outside stairs on the west end lead up to the manager's office.
const workshop = building({
  lines: (wl) => {
    // outside walls (the garage's are two storeys high)
    wl('x', -30, -6, -20, [[-26, -24, 'win'], [-13, -11.6, 'door']]);
    wl('x', -6, 16, -20, [[-2, 4, 'soft'], [8, 12, 'soft'], [13, 14.4, 'door']], 0, 2 * H);
    wl('x', 16, 26, -20, [[20, 22, 'win']]);
    wl('x', -30, 26, 14, [[-26, -24, 'win'], [-18, -16.6, 'door'], [-8, -6, 'win'], [11, 13, 'win'], [18, 24, 'soft']]);
    wl('z', -20, 14, -30, [[-16, -14.6, 'door'], [-3.7, -2.3, 'door'], [2, 4, 'win'], [7, 10, 'soft']]);
    wl('z', -20, 14, 26, [[-16, -14.6, 'door'], [-10, -7, 'soft'], [-3.7, -2.3, 'door'], [4, 5.4, 'door']]);
    // the maintenance corridor (z -4..-2) and the rooms either side
    wl('x', -30, -6, -4, [[-25, -23.6, 'idoor'], [-12, -10.6, 'idoor']]);
    wl('x', -6, 16, -4, [[-4, -2.6, 'idoor'], [3, 6, 'soft'], [11, 12.4, 'idoor']], 0, 2 * H, [[0.3, 1.7, 'idoor']]);
    wl('x', 16, 26, -4, [[20, 21.4, 'idoor']]);
    wl('x', -30, 26, -2, [[-22, -20.6, 'idoor'], [-16, -13, 'soft'], [-8, -6.6, 'gap'], [1, 4, 'reinf'], [5, 6.4, 'idoor'], [10, 11.4, 'idoor'], [20, 21.4, 'idoor']]);
    wl('z', -20, -4, -18, [[-15, -12, 'soft'], [-9, -7.6, 'idoor']]);
    wl('z', -20, -4, -6, [[-16, -13, 'soft'], [-9, -7.6, 'idoor']], 0, 2 * H);
    wl('z', -20, -4, 16, [[-16, -14.6, 'idoor'], [-10, -7, 'soft']], 0, 2 * H);
    wl('z', -2, 14, -12, [[8, 9.4, 'idoor'], [10.5, 13.5, 'soft']]);
    wl('z', -2, 14, -2, [[8, 11, 'reinf']]);
    wl('z', -2, 14, 8, [[9, 10.4, 'idoor']]);
    wl('z', -2, 14, 16, [[5, 7, 'gap']]);
    // upstairs over the offices: the manager's office (west) and the drafting room
    wl('x', -30, 8, -2, [[-24, -22, 'win'], [-8, -6, 'win'], [0.3, 1.7, 'idoor']], H);
    wl('x', -30, 8, 14, [[-20, -18, 'win'], [0, 2, 'win']], H);
    wl('z', -2, 14, -30, [[9, 10.4, 'door']], H);
    wl('z', -2, 14, 8, [[5, 7, 'win']], H);
    wl('z', -2, 14, -14, [[3, 4.4, 'idoor'], [8, 11, 'soft']], H);
  },
  slabs: [[-30, -2, -14, 14, 'wood'], [-14, -2, 8, 1, 'carpet2'], [-14, 7, 8, 14, 'carpet2'], [-10.2, 1, 8, 7, 'carpet2'], [-14, 1, -12, 7, 'carpet2'],
    [0, -4.2, 2, -2, 'concrete'], [-5.8, -6.6, 15.8, -4.2, 'concrete'], [-33.2, 4, -30, 12, 'deck']],
  stairs: [[-11.8, 1, -10.4, 7, '+z'], [14, -13, 15.4, -6.6, '+z'], [-32.8, -2, -31.6, 4, '+z']],
  // the corridor between the garage's tall wall and the upstairs offices: up to the high roof
  roof: { tall: ['Garage (site)', [-6, -4, 8, -2]] },
  rails: [[-10.2, 1, -10.1, 7], [-11.8, 0.9, -10.2, 1], [-0.1, -4.2, 0, -2], [2, -4.2, 2.1, -2], [-5.8, -6.7, 13.9, -6.6], [-33.3, 4, -33.2, 12], [-31.6, 4, -30, 4.1], [-33.2, 11.9, -30, 12]],
  data: {
    id: 'workshop', name: 'Workshop', hx: 42, hz: 32, building: [-30, -20, 26, 14], ground: 'dirt',
    walls: [
      // the garage (the site): cars, a lift, workbenches, tool chests
      box(1, -14, 2.2, 4.6, 1.5, 'car'), box(9, -11, 2.2, 4.6, 1.5, 'car'), box(-4.8, -11, 1, 3, 1.0, 'bench'), box(5, -6.9, 3, 0.8, 1.0, 'bench'), box(12, -18.8, 2.4, 0.8, 2, 'shelf'), box(-3, -18.6, 1.2, 1.2, 1.2, 'crate'),
      // storage rooms: shelves and crates
      box(-27, -12, 0.8, 5, 2, 'shelf'), box(-22, -16, 1.4, 1.4, 1.2, 'crate'), box(-21, -8, 1.4, 1.4, 1.2, 'crate'), box(-14, -16, 3, 0.8, 2, 'shelf'), box(-10, -10, 1.4, 1.4, 1.2, 'crate'), box(-8, -17.5, 1.4, 1.4, 1.2, 'crate'),
      // paint shop
      box(21, -12, 2.2, 4.6, 1.5, 'car'), box(25.3, -6, 0.8, 3, 2, 'shelf'), box(18, -18.6, 1.4, 1.2, 1.2, 'crate'),
      // offices, break room, server room, lockers, loading bay
      box(-25, 5, 2.4, 1.2, 1.1, 'desk'), box(-19, 5, 2.4, 1.2, 1.1, 'desk'), box(-22, 10, 2.4, 1.2, 1.1, 'desk'), box(-6, 10, 2.4, 1.2, 0.8, 'table'), box(-3, 13.3, 2, 0.6, 1.0, 'counter'),
      box(1, 5, 0.8, 4, 2, 'shelf'), box(5, 5, 0.8, 4, 2, 'shelf'), box(15.3, 9, 0.8, 4, 2, 'shelf'), box(10, 2, 2, 0.6, 1.1, 'bench'),
      box(21, 8, 2.6, 6, 2.6, 'container'), box(24, 1, 1.4, 1.4, 1.2, 'crate'),
      // upstairs: the manager's desk, drafting tables
      { ...box(-24, 8, 3, 1.2, 1.1, 'desk'), y0: H }, { ...box(-4, 4, 2.4, 1.2, 1.0, 'table'), y0: H }, { ...box(3, 10, 2.4, 1.2, 1.0, 'table'), y0: H }, { ...box(-20, 1, 2.6, 0.7, 2, 'shelf'), y0: H },
      // outside: trucks, pallets, a fuel tank, fences
      box(-14, -26, 2.6, 7, 2.8, 'container'), box(8, -27, 7, 2.6, 2.8, 'container'), box(-36, -6, 2, 4.5, 1.5, 'car'), box(34, -10, 2.4, 6, 2.8, 'container'), box(36, 6, 1.2, 3, 1.1, 'barrier'),
      box(-6, 22, 1.4, 1.4, 1.2, 'crate'), box(-4.4, 22, 1.4, 1.4, 1.2, 'crate'), box(14, 21, 4.5, 2, 1.5, 'car'), box(-24, 22, 3, 0.8, 1.1, 'barrier'), box(28, 22, 1.4, 1.4, 1.2, 'crate'),
    ],
    spawns: { A: [[-38, -27, 180], [0, -29, 180], [34, -28, 180], [-39, 8, 90], [39, 8, -90], [0, 27, 0]], B: [[-24, 2, 0], [-7, 4, 0], [3, 10, 0], [12, 6, 0], [-24, -12, 0]] },
    flags: {},
    sites: [{ name: 'A', x: 5, z: -12, r: 3.8 }],
    gadgets: {
      mine: [[-2.6, -5.2, 'A'], [11.7, -5.2, 'A'], [-5, -7.5, 'A'], [14.8, -15, 'A'], [13.7, -18.8, 'A'], [5, -18.8, 'A']],
      jammer: [[5, -9.5, 'A'], [12, -15, 'A']],
      catcher: [[-5, -18.8, 'A'], [12.5, -8.5, 'A']],
    },
    callouts: [
      { name: 'Garage (site)', x0: -6, z0: -20, x1: 16, z1: -4, floor: 'concrete' }, { name: 'Storage A', x0: -30, z0: -20, x1: -18, z1: -4, floor: 'concrete' }, { name: 'Storage B', x0: -18, z0: -20, x1: -6, z1: -4, floor: 'concrete' },
      { name: 'Paint shop', x0: 16, z0: -20, x1: 26, z1: -4, floor: 'concrete' }, { name: 'Maintenance corridor', x0: -30, z0: -4, x1: 26, z1: -2, floor: 'tiles' },
      { name: 'Offices', x0: -30, z0: -2, x1: -12, z1: 14, floor: 'carpet2' }, { name: 'Break room', x0: -12, z0: -2, x1: -2, z1: 14, floor: 'tiles2' }, { name: 'Server room', x0: -2, z0: -2, x1: 8, z1: 14, floor: 'tiles' },
      { name: 'Lockers', x0: 8, z0: -2, x1: 16, z1: 14, floor: 'tiles' }, { name: 'Loading bay', x0: 16, z0: -2, x1: 26, z1: 14, floor: 'concrete' },
      { name: "Manager's office", x0: -30, z0: -2, x1: -14, z1: 14, floor: 'wood', y: H }, { name: 'Drafting room', x0: -14, z0: -2, x1: 8, z1: 14, floor: 'carpet2', y: H },
      { name: 'Catwalk', x0: -6, z0: -6.6, x1: 16, z1: -4, y: H }, { name: 'Bridge', x0: 0, z0: -4.2, x1: 2, z1: -2, y: H },
      { name: 'Front lot', x0: -42, z0: -32, x1: 42, z1: -20 }, { name: 'Back lot', x0: -42, z0: 14, x1: 42, z1: 32 }, { name: 'West lot', x0: -42, z0: -20, x1: -30, z1: 14 }, { name: 'East lot', x0: 26, z0: -20, x1: 42, z1: 14 },
    ],
  },
});

/* ---------- the Battle maps, for Team Deathmatch and Capture the Flag ---------- */
// Same layouts and the same solids as Battle (js/battle/maps.js, js/battle/solids.js): the
// floors, stairs, ramps and upper levels all work in the match modes.
const yawTo = (dx, dz) => Math.atan2(dx, -dz) * 180 / Math.PI;
function fromBattle(id, key, name) {
  const M = BATTLE[key];
  const walls = layoutSolids(M).map((b) => ({ x0: b.minX, z0: b.minZ, x1: b.maxX, z1: b.maxZ, y0: b.minY, h: b.maxY - b.minY }));
  const mirror = (l) => l.map((p) => [-p[0], -p[1], p[2]]);
  const raw = { A: M.spawns, B: M.spawnsB || mirror(M.spawns) };
  const hazards = (M.acid || []).map((a) => ({ minX: a.x - a.w / 2, maxX: a.x + a.w / 2, minZ: a.z - a.d / 2, maxZ: a.z + a.d / 2, dps: a.dps || 34 }));
  return { id, name, arena: key, hx: M.hx, hz: M.hz, wallH: M.wallH, open: !M.ceiling, ceil: M.ceiling ? M.wallH : 0, hazards, walls, soft: [], reinforced: [], doors: [], openings: [], rawSpawns: raw, sites: [], flags: {}, gadgets: {}, callouts: [] };
}
// After the places exist: spawns and flags on reachable ground near Battle's spawns, gadget
// spots from cover, facing the middle.
function placeBattle(data) {
  const N = data.nodes;
  const near = (x, z, y, ok = () => true) => { let b = null, bd = Infinity; for (const n of N) { if (!ok(n)) continue; const d = Math.hypot(n[0] - x, n[1] - z, 2 * (n[2] - y)); if (d < bd) { bd = d; b = n; } } return b; };
  data.spawns = {};
  for (const T of ['A', 'B']) {
    const used = new Set();
    data.spawns[T] = data.rawSpawns[T].map((p) => {
      const n = near(p[0], p[1], p[2] || 0, (q) => !used.has(q));
      used.add(n);
      return [n[0], n[1], Math.round(yawTo(-n[0], -n[1])), n[2]];
    });
    const cx = data.spawns[T].reduce((s, p) => s + p[0], 0) / data.spawns[T].length, cz = data.spawns[T].reduce((s, p) => s + p[1], 0) / data.spawns[T].length;
    // the flag on the ground, a little in front of the spawns, toward the middle
    const f = near(cx * 0.82, cz * 0.82, 0, (q) => q[2] < 0.5);
    data.flags[T] = [f[0], f[1], f[2]];
  }
  const cov = data.cover.filter((c, i) => i % 3 === 0);
  data.gadgets = { mine: cov.slice(0, 8), jammer: cov.slice(8, 12), catcher: cov.slice(12, 16) };
  data.callouts = [
    { name: 'North', x0: -data.hx, z0: data.hz / 3, x1: data.hx, z1: data.hz }, { name: 'South', x0: -data.hx, z0: -data.hz, x1: data.hx, z1: -data.hz / 3 },
    { name: 'West', x0: -data.hx, z0: -data.hz / 3, x1: -data.hx / 3, z1: data.hz / 3 }, { name: 'East', x0: data.hx / 3, z0: -data.hz / 3, x1: data.hx, z1: data.hz / 3 },
    { name: 'Middle', x0: -data.hx / 3, z0: -data.hz / 3, x1: data.hx / 3, z1: data.hz / 3 },
  ];
  delete data.rawSpawns;
}

/* ---------- places and cover ---------- */
// Paths are found at run time by the core, on every level (no baked waypoint graph). What is
// baked here: "places" (spots about 2 m apart on every level that a body can walk to from
// the spawns and back, for patrols and spawn points) and cover spots.
function finish(data) {
  // doors count as open for paths (bots knife through them)
  const m = new MatchMap({ ...data, doors: [], nodes: [] });
  const nav = m.world.navNodes(), hx = data.hx, hz = data.hz;
  const s0 = (data.rawSpawns ? data.rawSpawns.A : data.spawns.A)[0];
  const seed = m.nearestSpot(s0[0], s0[1], data.rawSpawns ? s0[2] || 0 : 0);
  const both = (x, z, y) => m.path(seed[0], seed[1], x, z, seed[2], y).length > 0 && m.path(x, z, seed[0], seed[1], y, seed[2]).length > 0;
  const nodes = [];
  let all = 0, levels = new Set();
  for (let k = 0; k < m.world.nodeCount; k++) {
    const i = Math.round((nav.x[k] + hx) / 0.5 - 0.5), j = Math.round((nav.z[k] + hz) / 0.5 - 0.5);
    if (i % 4 !== 2 || j % 4 !== 2) continue;
    all++;
    const x = nav.x[k], z = nav.z[k], y = +nav.y[k].toFixed(3);
    if (!m.free(x, z, 0.5, y) || !both(x, z, y)) continue;
    nodes.push([x, z, y]); levels.add(y);
  }
  data.nodes = nodes;
  delete data.links;
  // cover: beside solid boxes taller than a crouched body, on the ground
  const cover = [];
  for (const b of m.solids) {
    if (b.kind === 'edge' || b.maxY < 1.0 || b.minY > 0) continue;
    const off = 0.75;
    const cand = [];
    const along = (x0, z0, x1, z1, n) => { for (let k = 0; k < n; k++) { const f = (k + 0.5) / n; cand.push([x0 + (x1 - x0) * f, z0 + (z1 - z0) * f]); } };
    const nX = Math.max(1, Math.round((b.maxX - b.minX) / 2.5)), nZ = Math.max(1, Math.round((b.maxZ - b.minZ) / 2.5));
    along(b.minX, b.maxZ + off, b.maxX, b.maxZ + off, nX); along(b.minX, b.minZ - off, b.maxX, b.minZ - off, nX);
    along(b.maxX + off, b.minZ, b.maxX + off, b.maxZ, nZ); along(b.minX - off, b.minZ, b.minX - off, b.maxZ, nZ);
    for (const [x, z] of cand) {
      if (!m.free(x, z, 0.4) || m.groundAt(x, z, 0) > 0.01 || cover.some((c) => Math.hypot(c[0] - x, c[1] - z) < 1.2)) continue;
      // only where a body can walk to it from the spawns
      const n = m.nearestSpot(x, z, 0);
      if (!n || n[2] > 0.01 || Math.hypot(n[0] - x, n[1] - z) > 0.6 || !both(n[0], n[1], 0)) continue;
      cover.push([+x.toFixed(2), +z.toFixed(2)]);
    }
  }
  data.cover = cover;
  console.log(data.id + ': ' + m.world.nodeCount + ' path nodes, ' + nodes.length + ' places of ' + all + ' on ' + levels.size + ' levels, ' + cover.length + ' cover spots');
  if (data.rawSpawns) placeBattle(data);
  // every authored spot must be on reachable ground
  const reach = (x, z, y = 0) => { const n = m.nearestSpot(x, z, y); return !!n && Math.hypot(n[0] - x, n[1] - z) < 0.8 && Math.abs(n[2] - y) < 0.3 && both(n[0], n[1], n[2]); };
  for (const T of ['A', 'B']) for (const p of data.spawns[T]) if (!reach(p[0], p[1], p[3] || 0)) console.log('  WARN ' + data.id + ' spawn ' + T + ' ' + p);
  for (const T of Object.keys(data.flags || {})) if (!reach(data.flags[T][0], data.flags[T][1], data.flags[T][2] || 0)) console.log('  WARN ' + data.id + ' flag ' + T);
  for (const [k, list] of Object.entries(data.gadgets)) for (const p of list) if (!m.free(p[0], p[1], 0.15)) console.log('  WARN ' + data.id + ' gadget ' + k + ' ' + p);
  for (const st of data.sites) { if (!reach(st.x, st.z)) console.log('  WARN ' + data.id + ' site ' + st.name); for (const e of st.entries || []) if (!m.nearestSpot(e[0], e[1], 0) || !both(...m.nearestSpot(e[0], e[1], 0))) console.log('  WARN ' + data.id + ' site entry ' + e); }
  // every doorway and opening has a way through it
  for (const o of data.openings || []) { if (o.type === 'win') continue; const x = o.axis === 'x' ? o.c : o.at, z = o.axis === 'x' ? o.at : o.c; if (!m.standable(x, z, o.y0 || 0)) console.log('  WARN ' + data.id + ' no path node in the opening at ' + x + ', ' + z + (o.y0 ? ' (upstairs)' : '')); }
  delete data.openings;
  m.dispose();
  return data;
}

mkdirSync(new URL('../data/maps/', import.meta.url), { recursive: true });
const battle = [fromBattle('containers', 'yard', 'Container Yard'), fromBattle('winter', 'winter', 'Winter Cabin'), fromBattle('casino', 'casino', "Jesse's Casino"), fromBattle('school', 'school', 'School Basement')];
for (const m of [yard, depot, ranch, embassy, workshop, ...battle]) writeFileSync(new URL('../data/maps/' + m.id + '.json', import.meta.url), JSON.stringify(finish(m)));
