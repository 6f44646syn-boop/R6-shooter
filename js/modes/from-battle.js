// Battle maps for the match modes (TDM, CTF): a Battle map's solids, plus places to go, cover spots,
// spawns, flags and gadget spots worked out with the game's own collision and paths (the Rust core).
// Used by tools/build-maps.mjs (the baked maps) and at run time (the Mist: a new maze each match).
import { MatchMap } from './map.js?v=8bf57aa-mwwtkd1t';
import { layoutSolids } from '../battle/solids.js?v=8bf57aa-mwwtkd1t';
import { MAPS as BATTLE } from '../battle/maps.js?v=8bf57aa-mwwtkd1t';

const yawTo = (dx, dz) => Math.atan2(dx, -dz) * 180 / Math.PI;
export function fromBattle(id, key, name, M = BATTLE[key]) {
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
export function finish(data, quiet = false) {
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
  if (!quiet) console.log(data.id + ': ' + m.world.nodeCount + ' path nodes, ' + nodes.length + ' places of ' + all + ' on ' + levels.size + ' levels, ' + cover.length + ' cover spots');
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


// A match map from a Battle map object M, ready for MatchMap.
export const matchFromBattle = (id, key, name, M) => finish(fromBattle(id, key, name, M), true);
