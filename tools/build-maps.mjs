// Builds data/maps/*.json for the match modes: the layout below, plus a waypoint graph and
// cover spots computed from the walls. Run: node tools/build-maps.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { MatchMap } from '../js/modes/map.js';
import { MAPS as BATTLE } from '../js/battle/maps.js';

const H = 3.2;
const wall = (x0, z0, x1, z1, h = H) => ({ x0, z0, x1, z1, h });
const box = (x, z, w, d, h) => wall(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h);
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
  id: 'depot', name: 'Depot', hx: 22.5, hz: 17.5, wallH: H,
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
    walls.push(...line(axis, a, b, at, sorted.map((o) => [o[0], o[1]])));
    for (const [f, t, type] of sorted) {
      const seg = axis === 'x' ? { x0: f, z0: at, x1: t, z1: at } : { x0: at, z0: f, x1: at, z1: t };
      if (type === 'door') doors.push(seg); else if (type === 'soft') soft.push(seg); else if (type === 'reinf') reinforced.push(seg);
      if (type === 'door' || type === 'gap') openings.push({ axis, at, c: (f + t) / 2 });
    }
  };
  spec.lines(wl);
  return { ...spec.data, wallH: H, walls: [...walls, ...spec.data.walls], doors, soft, reinforced, openings };
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
    id: 'ranch', name: 'Ranch', hx: 34, hz: 24,
    walls: [
      box(-18, -7, 4, 0.8, 1.1), box(-4, -8, 3, 1, 1.1), box(12, -7, 2.2, 4.4, 1.5), box(17.5, -10, 1.2, 1.2, 1.2),
      box(-19, 8, 2.2, 3, 0.8), box(-10, 10.8, 2, 0.8, 1.8), box(12, 9.5, 2, 1, 1.1), box(16.5, 4.5, 1.2, 1.2, 1.2),
      box(1, 7, 4, 1, 0.9), box(1, 11.5, 3, 0.6, 2), box(-20, 0, 1.2, 1.2, 1.2), box(14, 0, 1, 1, 1.1),
      box(-14, -18, 4.5, 2, 1.5), box(6, -19, 2, 4.5, 1.5), box(-2, -16, 1.2, 1.2, 1.2), box(18, -17, 3, 0.8, 1.1),
      box(-15, 17, 3, 1, 1.1), box(4, 18, 4.5, 2, 1.5), box(16, 16, 1.2, 1.2, 1.2),
      box(-29, -6, 2, 4, 1.5), box(-28, 8, 1.2, 1.2, 1.2), box(26, -8, 1.2, 3, 1.1), box(27, 9, 2, 4.5, 1.5),
    ],
    spawns: { A: [[-20, -21, 180], [0, -22, 180], [16, -21, 180], [-31, -10, 90], [31, 12, -90]], B: [[-1, 6, 0], [3, 9.5, 0], [-15, -9, 0], [8, -9, 0], [0, -6, 0]] },
    flags: {},
    sites: [{ name: 'A', x: -15, z: 7, r: 3.2 }, { name: 'B', x: 14, z: 7, r: 3.2 }],
    gadgets: {
      mine: [[-13.3, 3.2, 'A'], [-7, 6.7, 'A'], [-20, 10.5, 'A'], [10.7, 3.2, 'B'], [9.2, 5.7, 'B'], [17, 10.5, 'B']],
      jammer: [[-15, 10.5, 'A'], [14, 10.8, 'B']],
      catcher: [[-22.5, 4.5, 'A'], [18.5, 3.5, 'B']],
    },
    callouts: [
      { name: 'Bedroom (A)', x0: -24, z0: 2, x1: -6, z1: 12 }, { name: 'Lounge', x0: -6, z0: 2, x1: 8, z1: 12 }, { name: 'Office (B)', x0: 8, z0: 2, x1: 20, z1: 12 },
      { name: 'Hallway', x0: -24, z0: -2, x1: 20, z1: 2 }, { name: 'Kitchen', x0: -24, z0: -12, x1: -12, z1: -2 }, { name: 'Lobby', x0: -12, z0: -12, x1: 4, z1: -2 }, { name: 'Garage', x0: 4, z0: -12, x1: 20, z1: -2 },
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
    id: 'embassy', name: 'Embassy', hx: 33, hz: 25,
    walls: [
      box(-18, 11.5, 2, 1, 1.1), box(-10, 8, 1, 2.4, 1.8), box(10, -12, 2.4, 1, 1.1), box(18, -7.5, 1.2, 1.2, 1.2),
      box(0, 0, 2.4, 2.4, 1.0), box(-3.5, 3, 1, 1, 0.9), box(3.5, -3, 1, 1, 0.9),
      box(0, -9, 3, 0.8, 1.1), box(0, 9.5, 2.4, 1.2, 0.9), box(-14, -9, 4, 0.6, 2), box(14, 10, 3, 0.8, 1.1), box(19, 7, 1.2, 1.2, 1.2),
      box(-10, -19, 4.5, 2, 1.5), box(8, -20, 2, 4.5, 1.5), box(-27, 0, 2, 4.5, 1.5), box(27, -2, 1.2, 3, 1.1), box(-12, 19, 3, 0.8, 1.1),
      box(10, 19, 4.5, 2, 1.5), box(0, -18, 1.2, 1.2, 1.2), box(26, 15, 1.2, 1.2, 1.2), box(-27, -16, 1.2, 1.2, 1.2),
    ],
    spawns: { A: [[-12, -22, 180], [6, -22.5, 180], [-30, -4, 90], [30, 4, -90], [0, 22, 0]], B: [[-3, 0, 0], [3, 0, 0], [-14, -11.5, 0], [14, 11.5, 0], [0, -11, 0]] },
    flags: {},
    sites: [{ name: 'A', x: -14, z: 9.5, r: 3 }, { name: 'B', x: 14, z: -9.5, r: 3 }],
    gadgets: {
      mine: [[-11.3, 6.3, 'A'], [-6.8, 9.7, 'A'], [-13.5, 12.8, 'A'], [11.7, -5.8, 'B'], [6.8, -8.3, 'B'], [10.5, -12.8, 'B']],
      jammer: [[-16, 7.5, 'A'], [16, -11, 'B']],
      catcher: [[-20.5, 6.5, 'A'], [20.5, -12.5, 'B']],
    },
    callouts: [
      { name: 'Archive (A)', x0: -22, z0: 5, x1: -6, z1: 14 }, { name: 'Vault (B)', x0: 6, z0: -14, x1: 22, z1: -5 }, { name: 'Courtyard', x0: -6, z0: -5, x1: 6, z1: 5 },
      { name: 'Reception', x0: -6, z0: -14, x1: 6, z1: -5 }, { name: 'Dining', x0: -6, z0: 5, x1: 6, z1: 14 }, { name: 'West wing', x0: -22, z0: -14, x1: -6, z1: 5 }, { name: 'East wing', x0: 6, z0: -5, x1: 22, z1: 14 },
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
    id: 'workshop', name: 'Workshop', hx: 34, hz: 24,
    walls: [
      box(9, -9, 2.2, 4.4, 1.5), box(-0.5, -12, 1.2, 1.2, 1.2), box(12.5, -14, 2.4, 0.8, 2),
      box(-20, 10, 2.4, 1, 1.1), box(-13, 7, 1, 2, 1.8), box(-2, 8.5, 2.4, 1, 1.1), box(4, 8.5, 2.4, 1, 1.1),
      box(-16, 1, 3, 0.8, 1.1), box(13, 3, 2, 2, 1.2), box(0, 1.5, 1.2, 1.2, 1.2),
      box(-14, -10, 4.5, 2, 1.5), box(-18, -19, 1.2, 1.2, 1.2), box(4, -20, 3, 0.8, 1.1), box(21, -14, 2, 4.5, 1.5),
      box(-10, 17, 4.5, 2, 1.5), box(4, 17, 1.2, 1.2, 1.2), box(16, 15, 3, 0.8, 1.1), box(-29, 4, 2, 4, 1.5), box(25, 2, 1.2, 3, 1.1), box(24, -8, 1.2, 1.2, 1.2),
    ],
    spawns: { A: [[-16, -21, 180], [4, -22, 180], [28, -12, -90], [-30, -8, 90], [-4, 20, 0]], B: [[-2, 10.5, 0], [2, 6.5, 0], [-16, -0.5, 0], [12, 0, 0], [6, -6, 0]] },
    flags: {},
    sites: [{ name: 'A', x: -16, z: 8, r: 3 }, { name: 'B', x: 4, z: -10, r: 3.2 }],
    gadgets: {
      mine: [[-13.3, 4.8, 'A'], [-8.8, 8.5, 'A'], [-10.5, 11.2, 'A'], [-1.8, -2.8, 'B'], [1.2, -15.2, 'B'], [-3.2, -4.3, 'B']],
      jammer: [[-18, 6, 'A'], [3, -7, 'B']],
      catcher: [[-22.5, 9, 'A'], [12, -5.5, 'B']],
    },
    callouts: [
      { name: 'Drafting (A)', x0: -24, z0: 4, x1: -8, z1: 12 }, { name: 'Garage (B)', x0: -4, z0: -16, x1: 14, z1: -2 }, { name: 'Offices', x0: -8, z0: -2, x1: 8, z1: 12 },
      { name: 'Storeroom', x0: -24, z0: -2, x1: -8, z1: 4 }, { name: 'Annex', x0: 8, z0: -2, x1: 18, z1: 12 },
      { name: 'Front lot', x0: -34, z0: -24, x1: 34, z1: -16 }, { name: 'Back lot', x0: -34, z0: 12, x1: 34, z1: 24 }, { name: 'West lot', x0: -34, z0: -16, x1: -24, z1: 12 }, { name: 'East lot', x0: 14, z0: -16, x1: 34, z1: 12 },
    ],
  },
});

/* ---------- the Battle maps, for Team Deathmatch and Capture the Flag ---------- */
// Same layouts as Battle (js/battle/maps.js); the match modes play on the ground floor:
// stairs and ramps are cover, upper floors are overhead (they still stop bullets).
const yawTo = (dx, dz) => Math.atan2(dx, -dz) * 180 / Math.PI;
function fromBattle(id, key, name) {
  const M = BATTLE[key], walls = [];
  const solid = (x0, x1, y0, y1, z0, z1) => { if (y1 - y0 > 0.02) walls.push({ x0, z0, x1, z1, y0: +y0.toFixed(3), h: +(y1 - y0).toFixed(3) }); };
  const span = (b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, along: b.dir[1] === 'x' ? b.w : b.d });
  const piece = (s, dir, i, n) => {
    let a0 = i * s.along / n, a1 = (i + 1) * s.along / n;
    if (dir[0] === '-') { const t0 = s.along - a1; a1 = s.along - a0; a0 = t0; }
    return [dir[1] === 'x' ? [s.minX + a0, s.minX + a1] : [s.minX, s.maxX], dir[1] === 'z' ? [s.minZ + a0, s.minZ + a1] : [s.minZ, s.maxZ]];
  };
  const addBox = (b) => { const y0 = b.y || 0; solid(b.x - b.w / 2, b.x + b.w / 2, y0, y0 + b.h, b.z - b.d / 2, b.z + b.d / 2); };
  const addStairs = (b) => {
    const s = span(b), y0 = b.y || 0, n = Math.max(1, Math.round((b.y1 - y0) / (b.rise || 0.3))), base = b.base ?? y0;
    for (let i = 0; i < n; i++) { const [bx, bz] = piece(s, b.dir, i, n); solid(bx[0], bx[1], base, y0 + (b.y1 - y0) * (i + 1) / n, bz[0], bz[1]); }
  };
  const addRamp = (b) => {
    const s = span(b), y0 = b.y || 0, base = b.base ?? 0, n = Math.max(1, Math.ceil(s.along / 0.5));
    for (let i = 0; i < n; i++) { const [bx, bz] = piece(s, b.dir, i, n); solid(bx[0], bx[1], base, y0 + (b.y1 - y0) * (i + 0.5) / n, bz[0], bz[1]); }
  };
  for (const b0 of M.layout) {
    const b = (b0.stairs || b0.ramp) && !b0.dir ? { ...b0, dir: b0.stairs || b0.ramp } : b0;
    const list = [b];
    if (b.mirror ?? M.mirror) list.push({ ...b, x: -b.x, z: -b.z, dir: b.dir ? (b.dir[0] === '+' ? '-' : '+') + b.dir[1] : undefined });
    for (const e of list) (e.stairs ? addStairs : e.ramp ? addRamp : addBox)(e);
  }
  const mirror = (l) => l.map((p) => [-p[0], -p[1]]);
  const raw = { A: M.spawns, B: M.spawnsB || mirror(M.spawns) };
  return { id, name, arena: key, hx: M.hx, hz: M.hz, wallH: Math.max(2.4, M.wallH), walls, soft: [], reinforced: [], doors: [], openings: [], rawSpawns: raw, sites: [], flags: {}, gadgets: {}, callouts: [] };
}
// After the waypoints exist: spawns and flags on reachable ground near Battle's spawns,
// gadget spots from cover, facing the middle.
function placeBattle(data) {
  const N = data.nodes, near = (x, z) => { let b = null, bd = Infinity; for (const n of N) { const d = Math.hypot(n[0] - x, n[1] - z); if (d < bd) { bd = d; b = n; } } return b; };
  data.spawns = {};
  for (const T of ['A', 'B']) {
    const used = new Set();
    data.spawns[T] = data.rawSpawns[T].map((p) => {
      let n = near(p[0], p[1]);
      if (used.has(n)) n = N.filter((q) => !used.has(q)).sort((a, b) => Math.hypot(a[0] - p[0], a[1] - p[1]) - Math.hypot(b[0] - p[0], b[1] - p[1]))[0];
      used.add(n);
      return [n[0], n[1], Math.round(yawTo(-n[0], -n[1]))];
    });
    const cx = data.spawns[T].reduce((s, p) => s + p[0], 0) / data.spawns[T].length, cz = data.spawns[T].reduce((s, p) => s + p[1], 0) / data.spawns[T].length;
    // the flag a little in front of the spawns, toward the middle
    const f = near(cx * 0.82, cz * 0.82);
    data.flags[T] = [f[0], f[1]];
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

/* ---------- waypoints and cover ---------- */
function finish(data) {
  // doors count as open for the waypoints (bots knife through them)
  const m = new MatchMap({ ...data, doors: [], nodes: [], links: [] });
  const S = 2, nodes = [], index = new Map();
  for (let x = -data.hx + 1; x <= data.hx - 1; x += S) for (let z = -data.hz + 1; z <= data.hz - 1; z += S) {
    if (m.free(x, z, 0.5)) { index.set(x + ',' + z, nodes.length); nodes.push([x, z]); }
  }
  // a waypoint in each doorway and one on each side of it
  for (const o of data.openings || []) for (const k of [-1.1, 0, 1.1]) {
    const x = o.axis === 'x' ? o.c : o.at + k, z = o.axis === 'x' ? o.at + k : o.c;
    if (m.free(x, z, 0.36) && !nodes.some((n) => Math.hypot(n[0] - x, n[1] - z) < 0.5)) nodes.push([+x.toFixed(2), +z.toFixed(2)]);
  }
  // extra nodes in every doorway and gap (centre of openings), so narrow doors are linked
  const links = new Set();
  const link = (a, b) => links.add(Math.min(a, b) + ',' + Math.max(a, b));
  for (let k = 0; k < nodes.length; k++) {
    const [x, z] = nodes[k];
    for (const [dx, dz] of [[S, 0], [0, S], [S, S], [S, -S], [2 * S, 0], [0, 2 * S]]) {
      const j = index.get((x + dx) + ',' + (z + dz));
      if (j !== undefined && m.walkClear(x, z, x + dx, z + dz, 0.42)) link(k, j);
    }
  }
  // connect each node to nearby nodes it can walk to straight (handles 1-2 m doors on the grid)
  for (let k = 0; k < nodes.length; k++) for (let j = k + 1; j < nodes.length; j++) {
    const d = Math.hypot(nodes[k][0] - nodes[j][0], nodes[k][1] - nodes[j][1]);
    if (d > 3.1 || d < 0.1) continue;
    if (m.walkClear(nodes[k][0], nodes[k][1], nodes[j][0], nodes[j][1], 0.36)) link(k, j);
  }
  data.nodes = nodes;
  data.links = [...links].map((s) => s.split(',').map(Number));
  // cover: beside solid boxes taller than a crouched body
  const cover = [];
  for (const b of m.solids) {
    if (b.kind === 'edge' || b.maxY < 1.0 || b.minY > 0) continue;
    const off = 0.75;
    const cand = [];
    const along = (x0, z0, x1, z1, n) => { for (let k = 0; k < n; k++) { const f = (k + 0.5) / n; cand.push([x0 + (x1 - x0) * f, z0 + (z1 - z0) * f]); } };
    const nX = Math.max(1, Math.round((b.maxX - b.minX) / 2.5)), nZ = Math.max(1, Math.round((b.maxZ - b.minZ) / 2.5));
    along(b.minX, b.maxZ + off, b.maxX, b.maxZ + off, nX); along(b.minX, b.minZ - off, b.maxX, b.minZ - off, nX);
    along(b.maxX + off, b.minZ, b.maxX + off, b.maxZ, nZ); along(b.minX - off, b.minZ, b.minX - off, b.maxZ, nZ);
    for (const [x, z] of cand) if (m.free(x, z, 0.4) && !cover.some((c) => Math.hypot(c[0] - x, c[1] - z) < 1.2)) cover.push([+x.toFixed(2), +z.toFixed(2)]);
  }
  data.cover = cover;
  // report connectivity
  const adj = nodes.map(() => []);
  for (const [a, b] of data.links) { adj[a].push(b); adj[b].push(a); }
  const comp = new Int32Array(nodes.length).fill(-1);
  let nc = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] >= 0) continue;
    const st = [s]; comp[s] = nc;
    while (st.length) { const c = st.pop(); for (const k of adj[c]) if (comp[k] < 0) { comp[k] = nc; st.push(k); } }
    nc++;
  }
  const sizes = Array.from({ length: nc }, (_, i) => comp.filter((c) => c === i).length).sort((a, b) => b - a);
  // keep only the biggest connected part (cut-off pockets, the space under stairs)
  if (nc > 1) {
    const big = Array.from({ length: nc }, (_, i) => i).sort((p, q) => comp.filter((c) => c === q).length - comp.filter((c) => c === p).length)[0];
    const remap = new Int32Array(nodes.length).fill(-1), keep = [];
    nodes.forEach((n, i) => { if (comp[i] === big) { remap[i] = keep.length; keep.push(n); } });
    data.nodes = keep;
    data.links = data.links.filter(([a, b]) => remap[a] >= 0 && remap[b] >= 0).map(([a, b]) => [remap[a], remap[b]]);
  }
  console.log(data.id + ': ' + data.nodes.length + ' nodes, ' + data.links.length + ' links, ' + cover.length + ' cover spots, components ' + JSON.stringify(sizes.slice(0, 5)));
  if (data.rawSpawns) placeBattle(data);
  // every authored spot must be on reachable ground
  const full = new MatchMap({ ...data, nodes: [], links: [] });
  const reach = (x, z) => data.nodes.some((n) => Math.hypot(n[0] - x, n[1] - z) < 2.2) && full.free(x, z, 0.3);
  for (const T of ['A', 'B']) for (const p of data.spawns[T]) if (!reach(p[0], p[1])) console.log('  WARN ' + data.id + ' spawn ' + T + ' ' + p);
  for (const [k, list] of Object.entries(data.gadgets)) for (const p of list) if (!full.free(p[0], p[1], 0.15)) console.log('  WARN ' + data.id + ' gadget ' + k + ' ' + p);
  for (const st of data.sites) if (!reach(st.x, st.z)) console.log('  WARN ' + data.id + ' site ' + st.name);
  delete data.openings;
  return data;
}

mkdirSync(new URL('../data/maps/', import.meta.url), { recursive: true });
const battle = [fromBattle('containers', 'yard', 'Container Yard'), fromBattle('winter', 'winter', 'Winter Cabin'), fromBattle('casino', 'casino', "Jesse's Casino"), fromBattle('school', 'school', 'School Basement')];
for (const m of [yard, depot, ranch, embassy, workshop, ...battle]) writeFileSync(new URL('../data/maps/' + m.id + '.json', import.meta.url), JSON.stringify(finish(m)));
