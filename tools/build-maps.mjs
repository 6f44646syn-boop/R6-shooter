// Builds data/maps/*.json for the match modes: the layout below, plus a waypoint graph and
// cover spots computed from the walls. Run: node tools/build-maps.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { MatchMap } from '../js/modes/map.js';

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

/* ---------- waypoints and cover ---------- */
function finish(data) {
  const m = new MatchMap({ ...data, nodes: [], links: [] });
  const S = 2, nodes = [], index = new Map();
  for (let x = -data.hx + 1; x <= data.hx - 1; x += S) for (let z = -data.hz + 1; z <= data.hz - 1; z += S) {
    if (m.free(x, z, 0.5)) { index.set(x + ',' + z, nodes.length); nodes.push([x, z]); }
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
  console.log(data.id + ': ' + nodes.length + ' nodes, ' + data.links.length + ' links, ' + cover.length + ' cover spots, components ' + JSON.stringify(sizes.slice(0, 5)));
  return data;
}

mkdirSync(new URL('../data/maps/', import.meta.url), { recursive: true });
for (const m of [yard, depot]) writeFileSync(new URL('../data/maps/' + m.id + '.json', import.meta.url), JSON.stringify(finish(m)));
