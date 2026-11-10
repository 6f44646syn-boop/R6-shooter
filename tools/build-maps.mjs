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
// A wall line with openings: [from, to, type] where type is 'gap' (open), 'door' (boarded,
// breakable), 'soft' (breakable wall) or 'reinf' (reinforced wall).
function building(spec) {
  const walls = [], doors = [], soft = [], reinforced = [], openings = [];
  const wl = (axis, a, b, at, open = []) => {
    const sorted = open.slice().sort((p, q) => p[0] - q[0]);
    walls.push(...line(axis, a, b, at, sorted.map((o) => [o[0], o[1]])).map((w) => ({ ...w, look: 'house' })));
    for (const [f, t, type] of sorted) {
      const seg = axis === 'x' ? { x0: f, z0: at, x1: t, z1: at } : { x0: at, z0: f, x1: at, z1: t };
      if (type === 'door') doors.push(seg); else if (type === 'soft') soft.push(seg); else if (type === 'reinf') reinforced.push(seg);
      if (type === 'door' || type === 'gap') openings.push({ axis, at, c: (f + t) / 2 });
    }
  };
  spec.lines(wl);
  // the ways into each site: doorways and openings near it
  const sites = spec.data.sites.map((st) => ({ ...st, entries: openings.map((o) => (o.axis === 'x' ? [o.c, o.at] : [o.at, o.c])).filter((e) => {
    const room = (spec.data.callouts || []).find((c) => c.floor && st.x > c.x0 && st.x < c.x1 && st.z > c.z0 && st.z < c.z1);
    return room ? e[0] >= room.x0 - 0.6 && e[0] <= room.x1 + 0.6 && e[1] >= room.z0 - 0.6 && e[1] <= room.z1 + 0.6 : Math.hypot(e[0] - st.x, e[1] - st.z) < 11;
  }) }));
  // the defenders' area: the rooms (callouts with a floor)
  const inside = (spec.data.callouts || []).filter((c) => c.floor).map((c) => [c.x0, c.z0, c.x1, c.z1]);
  return { ...spec.data, sites, inside, wallH: H, walls: [...walls, ...spec.data.walls], doors, soft, reinforced, openings };
}

// Ranch: one long house; a hallway runs east-west between the south rooms (kitchen, lobby,
// garage) and the north rooms (bedroom = A, lounge, office = B).
const ranch = building({
  lines: (wl) => {
    wl('x', -24, 20, -12, [[-19, -17.6, 'door'], [-2, 0.4, 'door'], [13, 14.4, 'door']]);
    wl('x', -24, 20, 12, [[-21, -18, 'soft'], [-11, -9.6, 'door'], [9, 10.4, 'door'], [14, 17, 'soft']]);
    wl('z', -12, 12, -24, [[-1.4, 0, 'door'], [5, 8, 'reinf']]);
    wl('z', -12, 12, 20, [[-0.7, 0.7, 'door'], [5, 8, 'reinf']]);
    wl('x', -24, 20, -2, [[-17, -15.6, 'door'], [-4, -2.6, 'gap'], [9, 10.4, 'door']]);
    wl('x', -24, 20, 2, [[-14, -12.6, 'door'], [-9.5, -6.5, 'soft'], [-3, -1.6, 'gap'], [10, 11.4, 'door'], [15, 18, 'soft']]);
    wl('z', 2, 12, -6, [[6, 7.4, 'door']]);
    wl('z', 2, 12, 8, [[5, 6.4, 'door']]);
    wl('z', -12, -2, -12, [[-8, -6.6, 'door']]);
    wl('z', -12, -2, 4, [[-7, -5.6, 'gap']]);
  },
  data: {
    id: 'ranch', name: 'Ranch', hx: 34, hz: 24, building: [-24, -12, 20, 12], ground: 'grass',
    walls: [
      box(-18, -10.3, 4, 0.8, 1.1, 'counter'), box(-23.3, -7, 0.8, 4, 1.1, 'counter'), box(-4, -8, 3, 1, 1.1, 'desk'), box(12, -7, 2.2, 4.4, 1.5, 'car'), box(17.5, -10, 1.2, 1.2, 1.2, 'crate'),
      box(-19, 8, 2.2, 3, 0.8, 'bed'), box(-6.6, 9.4, 0.8, 2, 1.8, 'shelf'), box(12, 9.5, 2, 1, 1.1, 'desk'), box(16.5, 4.5, 1.2, 1.2, 1.2, 'crate'),
      box(1, 7, 4, 1, 0.9, 'sofa'), box(1, 11.5, 3, 0.6, 2, 'shelf'), box(-20, 0, 1.2, 1.2, 1.2, 'crate'), box(14, 0, 1, 1, 1.1, 'crate'), box(-15, 4.5, 1.6, 1, 0.8, 'table'),
      box(-14, -18, 4.5, 2, 1.5, 'car'), box(6, -19, 2, 4.5, 1.5, 'car'), box(-2, -16, 1.2, 1.2, 1.2, 'crate'), box(18, -17, 3, 0.8, 1.1, 'barrier'),
      box(-15, 17, 3, 1, 1.1, 'barrier'), box(4, 18, 4.5, 2, 1.5, 'car'), box(16, 16, 1.2, 1.2, 1.2, 'crate'),
      box(-29, -6, 2, 4, 1.5, 'car'), box(-28, 8, 1.2, 1.2, 1.2, 'crate'), box(26, -8, 1.2, 3, 1.1, 'barrier'), box(27, 9, 2, 4.5, 1.5, 'car'),
    ],
    spawns: { A: [[-20, -21, 180], [0, -22, 180], [16, -21, 180], [-31, -10, 90], [31, 12, -90]], B: [[-1, 6, 0], [3, 9.5, 0], [-15, -9, 0], [8, -9, 0], [0, -6, 0]] },
    flags: {},
    sites: [{ name: 'A', x: -15, z: 7.5, r: 3.5 }],
    gadgets: {
      mine: [[-13.3, 3.2, 'A'], [-7, 6.7, 'A'], [-10.3, 10.6, 'A'], [-20, 10.8, 'A'], [-17.5, 3.2, 'A']],
      jammer: [[-15, 10.8, 'A'], [-8.5, 3.5, 'A']],
      catcher: [[-22.5, 4.5, 'A'], [-7.5, 10.8, 'A']],
    },
    callouts: [
      { name: 'Bedroom (site)', x0: -24, z0: 2, x1: -6, z1: 12, floor: 'wood' }, { name: 'Lounge', x0: -6, z0: 2, x1: 8, z1: 12, floor: 'carpet' }, { name: 'Office', x0: 8, z0: 2, x1: 20, z1: 12, floor: 'carpet2' },
      { name: 'Hallway', x0: -24, z0: -2, x1: 20, z1: 2, floor: 'tiles' }, { name: 'Kitchen', x0: -24, z0: -12, x1: -12, z1: -2, floor: 'tiles2' }, { name: 'Lobby', x0: -12, z0: -12, x1: 4, z1: -2, floor: 'wood' }, { name: 'Garage', x0: 4, z0: -12, x1: 20, z1: -2, floor: 'concrete' },
      { name: 'Front yard', x0: -34, z0: -24, x1: 34, z1: -12 }, { name: 'Back yard', x0: -34, z0: 12, x1: 34, z1: 24 }, { name: 'West side', x0: -34, z0: -12, x1: -24, z1: 12 }, { name: 'East side', x0: 20, z0: -12, x1: 34, z1: 12 },
    ],
  },
});

// Embassy: rooms round an open courtyard. A in the north-west wing, B in the south-east.
const embassy = building({
  lines: (wl) => {
    wl('x', -22, 22, -14, [[-16, -14.6, 'door'], [-1.2, 1.2, 'door'], [9, 12, 'soft'], [14.6, 16, 'door']]);
    wl('x', -22, 22, 14, [[-15, -12, 'soft'], [-1, 0.4, 'door'], [12, 13.4, 'door']]);
    wl('z', -14, 14, -22, [[-9, -7.6, 'door'], [8, 11, 'reinf']]);
    wl('z', -14, 14, 22, [[-11, -8, 'reinf'], [7, 8.4, 'door']]);
    wl('z', -5, 5, -6, [[-1, 0.4, 'door']]);
    wl('z', -5, 5, 6, [[-0.4, 1, 'door']]);
    wl('x', -6, 6, -5, [[-0.7, 0.7, 'gap']]);
    wl('x', -6, 6, 5, [[2, 3.4, 'door']]);
    wl('x', -22, -6, 5, [[-19, -16, 'soft'], [-12, -10.6, 'door']]);
    wl('x', -22, -6, -5, [[-14, -12.6, 'door'], [-8, -6.6, 'gap']]);
    wl('z', 5, 14, -6, [[9, 10.4, 'door']]);
    wl('z', -14, -5, -6, [[-10, -8.6, 'door']]);
    wl('x', 6, 22, -5, [[11, 12.4, 'door'], [16, 19, 'soft']]);
    wl('x', 6, 22, 5, [[14, 15.4, 'door']]);
    wl('z', 5, 14, 6, [[8, 9.4, 'door']]);
    wl('z', -14, -5, 6, [[-9, -7.6, 'door']]);
  },
  data: {
    id: 'embassy', name: 'Embassy', hx: 33, hz: 25, building: [-22, -14, 22, 14], ground: 'lawn',
    walls: [
      box(-18, 11.5, 2, 1, 1.1, 'desk'), box(-10, 8, 1, 2.4, 1.8, 'shelf'), box(-14, 13.4, 4, 0.6, 2, 'shelf'), box(10, -12, 2.4, 1, 1.1, 'desk'), box(18, -7.5, 1.2, 1.2, 1.2, 'crate'),
      box(0, 0, 2.4, 2.4, 1.0, 'fountain'), box(-3.5, 3, 1, 1, 0.9, 'planter'), box(3.5, -3, 1, 1, 0.9, 'planter'),
      box(0, -9, 3, 0.8, 1.1, 'counter'), box(0, 9.5, 2.4, 1.2, 0.9, 'table'), box(-14, -9, 4, 0.6, 2, 'shelf'), box(14, 10, 3, 0.8, 1.1, 'desk'), box(19, 7, 1.2, 1.2, 1.2, 'crate'),
      box(-10, -19, 4.5, 2, 1.5, 'car'), box(8, -20, 2, 4.5, 1.5, 'car'), box(-27, 0, 2, 4.5, 1.5, 'car'), box(27, -2, 1.2, 3, 1.1, 'barrier'), box(-12, 19, 3, 0.8, 1.1, 'barrier'),
      box(10, 19, 4.5, 2, 1.5, 'car'), box(0, -18, 1.2, 1.2, 1.2, 'planter'), box(26, 15, 1.2, 1.2, 1.2, 'planter'), box(-27, -16, 1.2, 1.2, 1.2, 'planter'),
    ],
    spawns: { A: [[-12, -22, 180], [6, -22.5, 180], [-30, -4, 90], [30, 4, -90], [0, 22, 0]], B: [[-3, 0, 0], [3, 0, 0], [-14, -11.5, 0], [14, 11.5, 0], [0, -11, 0]] },
    flags: {},
    sites: [{ name: 'A', x: -14, z: 9.5, r: 3.4 }],
    gadgets: {
      mine: [[-11.3, 6.3, 'A'], [-6.8, 9.7, 'A'], [-13.5, 12.4, 'A'], [-17.5, 6.3, 'A'], [-20.5, 11, 'A']],
      jammer: [[-16, 7.5, 'A'], [-9, 12.5, 'A']],
      catcher: [[-20.5, 6.5, 'A'], [-8, 6.5, 'A']],
    },
    callouts: [
      { name: 'Archive (site)', x0: -22, z0: 5, x1: -6, z1: 14, floor: 'wood' }, { name: 'Vault', x0: 6, z0: -14, x1: 22, z1: -5, floor: 'concrete' }, { name: 'Courtyard', x0: -6, z0: -5, x1: 6, z1: 5, floor: 'stone' },
      { name: 'Reception', x0: -6, z0: -14, x1: 6, z1: -5, floor: 'marble' }, { name: 'Dining', x0: -6, z0: 5, x1: 6, z1: 14, floor: 'carpet' }, { name: 'West wing', x0: -22, z0: -14, x1: -6, z1: 5, floor: 'carpet2' }, { name: 'East wing', x0: 6, z0: -5, x1: 22, z1: 14, floor: 'tiles' },
      { name: 'Front', x0: -33, z0: -25, x1: 33, z1: -14 }, { name: 'Back', x0: -33, z0: 14, x1: 33, z1: 25 }, { name: 'West lawn', x0: -33, z0: -14, x1: -22, z1: 14 }, { name: 'East lawn', x0: 22, z0: -14, x1: 33, z1: 14 },
    ],
  },
});

// Workshop: offices to the north-west (A), a big garage to the south (B), an annex east.
const workshop = building({
  lines: (wl) => {
    wl('x', -24, 8, 12, [[-18, -16.6, 'door'], [-12, -9, 'soft'], [2, 3.4, 'door']]);
    wl('z', -2, 12, -24, [[0, 1.4, 'door'], [7, 10, 'reinf']]);
    wl('z', -2, 12, -8, [[1, 2.4, 'door'], [7, 10, 'soft']]);
    wl('x', -24, -8, 4, [[-14, -12.6, 'door']]);
    wl('x', -8, 8, 5, [[-4, -2.6, 'door'], [3, 4.4, 'gap']]);
    wl('x', -24, -4, -2, [[-19, -17.6, 'door']]);
    wl('x', -4, 8, -2, [[-2.5, -1.1, 'door'], [3.5, 6.5, 'reinf']]);
    wl('z', -16, -2, -4, [[-11, -8, 'soft'], [-5, -3.6, 'door']]);
    wl('x', -4, 14, -16, [[0, 2.4, 'door'], [6, 9, 'soft']]);
    wl('z', -16, -2, 14, [[-13, -11.6, 'door']]);
    wl('x', 8, 14, -2, [[10, 11.4, 'door']]);
    wl('z', -2, 8, 18, [[2, 3.4, 'door']]);
    wl('x', 8, 18, 8, [[12, 13.4, 'door']]);
    wl('x', 14, 18, -2, []);
    wl('z', -2, 12, 8, [[1, 2.4, 'door'], [9.5, 10.9, 'door']]);
  },
  data: {
    id: 'workshop', name: 'Workshop', hx: 34, hz: 24, building: [-24, -16, 18, 12], ground: 'dirt',
    walls: [
      box(9, -9, 2.2, 4.4, 1.5, 'car'), box(-0.5, -12, 1.2, 1.2, 1.2, 'crate'), box(12.5, -14, 2.4, 0.8, 2, 'shelf'), box(3, -4.5, 3, 0.8, 1, 'bench'),
      box(-20, 10, 2.4, 1, 1.1, 'desk'), box(-13, 7, 1, 2, 1.8, 'shelf'), box(-2, 8.5, 2.4, 1, 1.1, 'desk'), box(4, 8.5, 2.4, 1, 1.1, 'desk'),
      box(-16, 1, 3, 0.8, 1.1, 'crate'), box(13, 3, 2, 2, 1.2, 'crate'), box(0, 1.5, 1.2, 1.2, 1.2, 'crate'),
      box(-14, -10, 4.5, 2, 1.5, 'car'), box(-18, -19, 1.2, 1.2, 1.2, 'crate'), box(4, -20, 3, 0.8, 1.1, 'barrier'), box(21, -14, 2, 4.5, 1.5, 'car'),
      box(-10, 17, 4.5, 2, 1.5, 'car'), box(4, 17, 1.2, 1.2, 1.2, 'crate'), box(16, 15, 3, 0.8, 1.1, 'barrier'), box(-29, 4, 2, 4, 1.5, 'car'), box(25, 2, 1.2, 3, 1.1, 'barrier'), box(24, -8, 1.2, 1.2, 1.2, 'crate'),
    ],
    spawns: { A: [[-16, -21, 180], [4, -22, 180], [28, -12, -90], [-30, -8, 90], [-4, 20, 0]], B: [[-2, 10.5, 0], [2, 6.5, 0], [-16, -0.5, 0], [12, 0, 0], [6, -6, 0]] },
    flags: {},
    sites: [{ name: 'A', x: 4, z: -10, r: 3.6 }],
    gadgets: {
      mine: [[-1.8, -2.8, 'A'], [1.2, -15.2, 'A'], [-3.2, -4.3, 'A'], [13.2, -12.3, 'A'], [10.7, -2.8, 'A']],
      jammer: [[3, -7.5, 'A'], [7, -14.5, 'A']],
      catcher: [[12, -5.5, 'A'], [-2.5, -14.5, 'A']],
    },
    callouts: [
      { name: 'Drafting', x0: -24, z0: 4, x1: -8, z1: 12, floor: 'wood' }, { name: 'Garage (site)', x0: -4, z0: -16, x1: 14, z1: -2, floor: 'concrete' }, { name: 'Offices', x0: -8, z0: -2, x1: 8, z1: 12, floor: 'carpet2' },
      { name: 'Storeroom', x0: -24, z0: -2, x1: -8, z1: 4, floor: 'concrete' }, { name: 'Annex', x0: 8, z0: -2, x1: 18, z1: 12, floor: 'tiles' },
      { name: 'Front lot', x0: -34, z0: -24, x1: 34, z1: -16 }, { name: 'Back lot', x0: -34, z0: 12, x1: 34, z1: 24 }, { name: 'West lot', x0: -34, z0: -16, x1: -24, z1: 12 }, { name: 'East lot', x0: 14, z0: -16, x1: 34, z1: 12 },
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
  for (const o of data.openings || []) { const x = o.axis === 'x' ? o.c : o.at, z = o.axis === 'x' ? o.at : o.c; if (!m.standable(x, z, 0)) console.log('  WARN ' + data.id + ' no path node in the opening at ' + x + ', ' + z); }
  delete data.openings;
  m.dispose();
  return data;
}

mkdirSync(new URL('../data/maps/', import.meta.url), { recursive: true });
const battle = [fromBattle('containers', 'yard', 'Container Yard'), fromBattle('winter', 'winter', 'Winter Cabin'), fromBattle('casino', 'casino', "Jesse's Casino"), fromBattle('school', 'school', 'School Basement')];
for (const m of [yard, depot, ranch, embassy, workshop, ...battle]) writeFileSync(new URL('../data/maps/' + m.id + '.json', import.meta.url), JSON.stringify(finish(m)));
