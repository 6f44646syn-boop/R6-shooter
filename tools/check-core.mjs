// Parity check for the Rust core (dev only): the JavaScript kernel it was ported from
// (tools/ref-js/) and the Rust core (wasm/recoil_core.wasm, through js/modes/map.js) are asked
// the same seeded questions on every map. Every answer must be identical, bit for bit.
// Also checks that the committed .wasm was built from the current Rust sources.
//   node tools/check-core.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MatchMap } from '../js/modes/map.js';
import { RefMap } from './ref-js/map-ref.mjs';
import { core } from '../js/wasm/core.js';

const root = new URL('../', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
let failures = 0;
const check = (msg, ok, info = '') => { if (ok) console.log('  PASS ' + msg); else { failures++; console.log('  FAIL ' + msg + (info ? '\n       ' + info : '')); } };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

console.log('Rust core build');
{
  const src = new URL('rust/core/', root);
  const files = ['Cargo.toml', ...readdirSync(new URL('src/', src)).filter((f) => f.endsWith('.rs')).sort().map((f) => 'src/' + f)];
  const h = createHash('sha256');
  for (const f of files) h.update(readFileSync(new URL(f, src)));
  const want = h.digest('hex'), have = readFileSync(new URL('wasm/recoil_core.hash', root), 'utf8').trim();
  check('wasm/recoil_core.wasm was built from the current Rust sources', want === have, 'run tools/build-wasm.sh (sources ' + want.slice(0, 12) + ', built from ' + have.slice(0, 12) + ')');
  check('the core loads and reports its interface version', core().e.rc_abi() === 1);
}

const MAPS = ['yard', 'depot', 'containers', 'winter', 'casino', 'school', 'ranch', 'embassy', 'workshop'];
const total = { ray: 0, sight: 0, resolve: 0, move: 0, free: 0, walk: 0, near: 0, node: 0, path: 0, door: 0 };
console.log('\nSame questions to the JavaScript reference and the Rust core (answers must be identical)');
for (const id of MAPS) {
  const data = json('data/maps/' + id + '.json');
  const A = new RefMap(data), B = new MatchMap(data);
  const r = rng(1234 + id.length * 7 + id.charCodeAt(0)), bad = [];
  const note = (what, q, a, b) => { if (bad.length < 4) bad.push(what + ' ' + JSON.stringify(q) + ': ref ' + JSON.stringify(a) + ' core ' + JSON.stringify(b)); };
  const X = () => (r() * 2 - 1) * (A.hx + 1), Z = () => (r() * 2 - 1) * (A.hz + 1);
  const pass = (label) => {
    for (let i = 0; i < 6000; i++) {
      const o = [X(), 0.05 + r() * 3, Z()], a = r() * Math.PI * 2, p = (r() - 0.5) * 1.2;
      const d = [Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p)], maxT = r() < 0.3 ? 5 + r() * 20 : 200;
      const ha = A.raycast(o, d, maxT), hb = B.raycast(o, d, maxT);
      const ia = ha ? (ha.box.ground ? -2 : ha.box.i) : -1, ib = hb ? (hb.box.ground ? -2 : hb.box.i) : -1;
      total.ray++;
      if (ia !== ib || (ha && ha.t !== hb.t)) note(label + 'raycast', [o, d, maxT], ha && [ha.t, ia], hb && [hb.t, ib]);
    }
    for (let i = 0; i < 6000; i++) {
      const a = [X(), 0.1 + r() * 2, Z()], b = [X(), 0.1 + r() * 2, Z()];
      total.sight++;
      if (!!A.sight(a, b) !== B.sight(a, b)) note(label + "sight", [a, b], !!A.sight(a, b), B.sight(a, b));   // the reference answers undefined for "blocked"
    }
    for (let i = 0; i < 6000; i++) {
      const x = X(), z = Z(), rad = [0.15, 0.2, 0.32][i % 3], fly = i % 3 === 0;
      const pa = A.resolve({ x, z }, rad, fly), pb = B.resolve({ x, z }, rad, fly);
      total.resolve++;
      if (pa.x !== pb.x || pa.z !== pb.z) note(label + 'resolve', [x, z, rad, fly], pa, pb);
    }
    for (let i = 0; i < 3000; i++) {
      const x = X(), z = Z(), dx = (r() - 0.5) * 6 * (i % 5 === 0 ? 3 : 1), dz = (r() - 0.5) * 6, fly = i % 2 === 0, rad = fly ? 0.15 : 0.32;
      const pa = A.moveCircle({ x, z }, dx, dz, rad, fly), pb = B.moveCircle({ x, z }, dx, dz, rad, fly);
      total.move++;
      if (pa.x !== pb.x || pa.z !== pb.z) note(label + 'moveCircle', [x, z, dx, dz, rad, fly], pa, pb);
    }
    for (let i = 0; i < 6000; i++) {
      const x = X(), z = Z(), rad = [0.15, 0.32, 0.4, 0.5][i % 4];
      total.free++;
      if (A.free(x, z, rad) !== B.free(x, z, rad)) note(label + 'free', [x, z, rad], A.free(x, z, rad), B.free(x, z, rad));
    }
    for (let i = 0; i < 6000; i++) {
      const ax = X(), az = Z(), L = i % 3 ? 3 : 14, bx = ax + (r() - 0.5) * L, bz = az + (r() - 0.5) * L, rad = [0.4, 0.36, 0.288, 0.2][i % 4];
      total.walk++;
      if (A.walkClear(ax, az, bx, bz, rad) !== B.walkClear(ax, az, bx, bz, rad)) note(label + 'walkClear', [ax, az, bx, bz, rad], A.walkClear(ax, az, bx, bz, rad), B.walkClear(ax, az, bx, bz, rad));
    }
    for (let i = 0; i < 1500; i++) {
      const x = X(), z = Z(), rad = r() * 3;
      const la = A.near(x, z, rad, []).map((b) => b.i), lb = B.near(x, z, rad, []).map((b) => b.i);
      total.near++;
      if (la.length !== lb.length || la.some((v, k) => v !== lb[k])) note(label + 'near', [x, z, rad], la, lb);
    }
    for (let i = 0; i < 1500; i++) {
      const x = X(), z = Z(), s = i % 2 === 0;
      total.node++;
      if (A.nearestNode(x, z, s) !== B.nearestNode(x, z, s)) note(label + 'nearestNode', [x, z, s], A.nearestNode(x, z, s), B.nearestNode(x, z, s));
    }
    const N = A.nodes;
    for (let i = 0; i < 500; i++) {
      const a = N[Math.floor(r() * N.length)], b = N[Math.floor(r() * N.length)];
      const ax = a[0] + (r() - 0.5), az = a[1] + (r() - 0.5), bx = b[0] + (r() - 0.5), bz = b[1] + (r() - 0.5);
      const pa = A.path(ax, az, bx, bz), pb = B.path(ax, az, bx, bz);
      total.path++;
      if (pa.length !== pb.length || pa.some((p, k) => p[0] !== pb[k][0] || p[1] !== pb[k][1])) note(label + 'path', [ax, az, bx, bz], pa.slice(0, 4), pb.slice(0, 4));
    }
    for (let i = 0; i < 1500; i++) {
      const ax = X(), az = Z(), bx = ax + (r() - 0.5) * 4, bz = az + (r() - 0.5) * 4;
      const da = A.doorOn(ax, az, bx, bz, 0.2), db = B.doorOn(ax, az, bx, bz, 0.2);
      total.door++;
      if ((da ? da.i : -1) !== (db ? db.i : -1)) note(label + 'doorOn', [ax, az, bx, bz], da && da.i, db && db.i);
    }
  };
  pass('');
  // break things the same way on both, ask again, then put everything back and ask once more
  let broke = 0;
  for (const pn of A.panels) if (r() < 0.5) {
    const c = [(pn.box.minX + pn.box.maxX) / 2, 1, (pn.box.minZ + pn.box.maxZ) / 2];
    if (pn.kind === 'door') { A.hurtDoor(pn, 100); B.hurtDoor(B.panels[pn.i], 100); } else { A.breakAt(c, 0.1, true); B.breakAt(c, 0.1, true); }
    broke++;
  }
  const same = A.panels.every((pn, k) => pn.alive === B.panels[k].alive);
  if (broke) pass('(broken) ');
  A.resetPanels(); B.resetPanels();
  if (broke) pass('(reset) ');
  check(id + ': identical answers' + (broke ? ', also with ' + broke + ' panels and doors broken, and after a reset' : ''), !bad.length && same, bad.join('\n       '));
  B.dispose();
}
console.log('  (' + Object.entries(total).map(([k, v]) => v.toLocaleString('en-US') + ' ' + k).join(', ') + ')');
check('no worlds left in the core after dispose()', core().e.rc_world_count() === 0, String(core().e.rc_world_count()));
console.log(failures ? '\n' + failures + ' FAILED' : '\nRust core checks passed');
process.exit(failures ? 1 : 0);
