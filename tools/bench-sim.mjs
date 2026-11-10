// Simulation benchmarks (dev only): how fast the match kernel and whole bot matches run.
// Used as the before/after measurement for engine changes.
//   node tools/bench-sim.mjs            all maps, prints a table
//   node tools/bench-sim.mjs --json     the same numbers as JSON (for docs/BASELINE.md)
// Queries are seeded, so two runs ask exactly the same questions.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { MatchMap } from '../js/modes/map.js';
import { Match, TICK } from '../js/modes/sim.js';

const root = new URL('../', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const guns = json('data/guns.json').guns, ops = json('data/ops.json'), abilities = json('data/abilities.json');
const MAPS = ['yard', 'containers', 'winter', 'casino', 'school', 'ranch', 'embassy', 'workshop'];
const asJson = process.argv.includes('--json');
if (globalThis.__benchInit) await globalThis.__benchInit();

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Best of 3 runs of fn (n operations): operations per second.
function rate(n, fn) { let best = Infinity; for (let k = 0; k < 3; k++) { const t0 = performance.now(); fn(); best = Math.min(best, performance.now() - t0); } return n / (best / 1000); }

const out = { node: process.version, kernel: {}, matches: {} };
for (const id of MAPS) {
  const map = new MatchMap(json('data/maps/' + id + '.json'));
  const N = map.nodes, r = rng(42);
  const pts = Array.from({ length: 4000 }, () => N[Math.floor(r() * N.length)]);
  const dirs = Array.from({ length: 4000 }, () => { const a = r() * Math.PI * 2, p = (r() - 0.5) * 0.4; return [Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p)]; });
  let sink = 0;
  const ray = rate(4000, () => { for (let i = 0; i < 4000; i++) { const h = map.raycast([pts[i][0], (pts[i][2] || 0) + 1.6, pts[i][1]], dirs[i], 200); sink += h ? h.t : 0; } });
  const sight = rate(4000, () => { for (let i = 0; i < 4000; i++) { const a = pts[i], b = pts[(i * 7 + 13) % 4000]; sink += map.sight([a[0], (a[2] || 0) + 1.6, a[1]], [b[0], (b[2] || 0) + 1.2, b[1]]) ? 1 : 0; } });
  const path = rate(300, () => { for (let i = 0; i < 300; i++) { const a = pts[i], b = pts[(i * 11 + 5) % 4000]; sink += map.path(a[0], a[1], b[0], b[1], a[2] || 0, b[2] || 0).length; } });
  const resolve = rate(4000, () => { const p = { x: 0, y: 0, z: 0 }; for (let i = 0; i < 4000; i++) { p.x = pts[i][0] + 0.7; p.z = pts[i][1] + 0.7; p.y = pts[i][2] || 0; map.resolve(p); sink += p.x; } });
  const walk = rate(4000, () => { for (let i = 0; i < 4000; i++) { const a = pts[i], b = pts[(i * 3 + 1) % 4000]; sink += map.walkClear(a[0], a[1], a[0] + (b[0] - a[0]) * 0.1, a[1] + (b[1] - a[1]) * 0.1) ? 1 : 0; } });
  out.kernel[id] = { solids: map.solids.length, nodes: N.length, raycastPerSec: Math.round(ray), sightPerSec: Math.round(sight), pathPerSec: Math.round(path), resolvePerSec: Math.round(resolve), walkClearPerSec: Math.round(walk) };
  if (map.dispose) map.dispose();
  if (sink === -1) console.log(sink);
}
// Whole matches: 5v5 bots, 60 simulated seconds each (Bomb: abilities on), time per step.
for (const [mode, id] of [['tdm', 'containers'], ['tdm', 'casino'], ['ctf', 'winter'], ['ctf', 'yard'], ['bomb', 'ranch'], ['bomb', 'embassy'], ['bomb', 'workshop']]) {
  const map = new MatchMap(json('data/maps/' + id + '.json'));
  const m = new Match({ map, mode, guns, ops, abilities, seed: 7, human: null, teamSize: 5, difficulty: 'normal', abilitiesOn: mode === 'bomb', minutes: 10 });
  const times = [];
  const steps = Math.round(60 / TICK);
  for (let i = 0; i < steps && !m.over; i++) { const t0 = performance.now(); m.step(); times.push(performance.now() - t0); m.events.length = 0; }
  times.sort((a, b) => a - b);
  const sum = times.reduce((s, v) => s + v, 0);
  out.matches[mode + '/' + id] = { steps: times.length, avgMs: +(sum / times.length).toFixed(4), p99Ms: +times[Math.floor(times.length * 0.99)].toFixed(4), maxMs: +times[times.length - 1].toFixed(3), realtimeX: Math.round((times.length * TICK * 1000) / sum) };
  if (map.dispose) map.dispose();
}
if (asJson) console.log(JSON.stringify(out, null, 1));
else {
  console.log('Kernel (operations per second, best of 3)');
  console.table(out.kernel);
  console.log('Bot matches, 5v5, 60 s simulated (ms per 60 Hz step; realtimeX = how many times faster than real time)');
  console.table(out.matches);
}
