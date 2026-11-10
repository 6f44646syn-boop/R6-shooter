// Checks of the Rust core (dev only). The JavaScript it replaced is kept under tools/ref-js/;
// both are asked the same seeded questions.
//
//   1. the committed .wasm was built from the current Rust sources
//   2. Battle's maps: floors, stairs, ramps, raycasts, line of sight and pathfinding against
//      the old arena code (identical answers); movement and vaulting against it (the core
//      uses a sturdier two-pass push-out, so: the same in nearly every step, and never worse)
//   3. the match maps' ground floor against the old map code (identical answers)
//   node tools/check-core.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MatchMap } from '../js/modes/map.js';
import { RefMap } from './ref-js/map-ref.mjs';
import { RefArena } from './ref-js/arena-ref.mjs';
import { MAPS as BATTLE } from '../js/battle/maps.js';
import { layoutSolids, edgeSolids } from '../js/battle/solids.js';
import { CoreWorld } from '../js/wasm/world.js';
import { core } from '../js/wasm/core.js';

const root = new URL('../', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
let failures = 0;
const check = (msg, ok, info = '') => { if (ok) console.log('  PASS ' + msg); else { failures++; console.log('  FAIL ' + msg + (info ? '\n       ' + info : '')); } };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const num = (n) => n.toLocaleString('en-US');

console.log('Rust core build');
{
  const src = new URL('rust/core/', root);
  const files = ['Cargo.toml', ...readdirSync(new URL('src/', src)).filter((f) => f.endsWith('.rs')).sort().map((f) => 'src/' + f)];
  const h = createHash('sha256');
  for (const f of files) h.update(readFileSync(new URL(f, src)));
  const want = h.digest('hex'), have = readFileSync(new URL('wasm/recoil_core.hash', root), 'utf8').trim();
  check('wasm/recoil_core.wasm was built from the current Rust sources', want === have, 'run tools/build-wasm.sh (sources ' + want.slice(0, 12) + ', built from ' + have.slice(0, 12) + ')');
  check('the core loads and reports its interface version', core().e.rc_abi() === 4);
}

/* ---------- Battle's maps: every level ---------- */
console.log('\nBattle maps, every level: the old arena code and the Rust core (the body radius and limits the old code had)');
const exact = {}, soft = { steps: 0, same: 0, oldInside: 0, coreInside: 0, vault: 0, vaultYes: 0, vaultDiff: 0, vaultBad: 0 };
const count = (k, n = 1) => { exact[k] = (exact[k] || 0) + n; };
for (const id of Object.keys(BATTLE)) {
  const M = BATTLE[id], R = 0.35, A = new RefArena(M, R);
  const B = new CoreWorld({ hx: M.hx, hz: M.hz, wallH: M.wallH, ceil: M.ceiling ? M.wallH : 0, solids: [...layoutSolids(M), ...edgeSolids(M.hx, M.hz)], hazards: A.hazards, bodyR: R, careful: false, vaults: false });
  const r = rng(77 + id.length), X = () => (r() * 2 - 1) * (M.hx - 0.4), Z = () => (r() * 2 - 1) * (M.hz - 0.4);
  const levels = [...new Set(Array.from(A.nodeY))], Y = () => (r() < 0.5 ? 0 : levels[Math.floor(r() * levels.length)]);
  const bad = [];
  const miss = (what, q, a, b) => { if (bad.length < 4) bad.push(what + ' ' + JSON.stringify(q) + ': old ' + JSON.stringify(a) + ' core ' + JSON.stringify(b)); else if (bad.length === 4) bad.push('...'); };
  const nb = B.navNodes();
  count('nodes', A.nodeCount);
  if (A.nodeCount !== B.nodeCount) miss('node count', id, A.nodeCount, B.nodeCount);
  else for (let k = 0; k < A.nodeCount; k++) if (A.nodeX[k] !== nb.x[k] || A.nodeZ[k] !== nb.z[k] || A.nodeY[k] !== nb.y[k]) { miss('node', k, [A.nodeX[k], A.nodeZ[k], A.nodeY[k]], [nb.x[k], nb.z[k], nb.y[k]]); break; }
  for (let i = 0; i < 20000; i++) { const x = X(), z = Z(), y = Y() + (r() - 0.5) * 0.2, a = A.groundAt(x, z, y), b = B.groundAt(x, z, y); count('ground'); if (a !== b) miss('groundAt', [x, z, y], a, b); }
  for (let i = 0; i < 20000; i++) {
    const o = [X(), 0.05 + r() * M.wallH, Z()], a = r() * Math.PI * 2, p = (r() - 0.5) * 1.6;
    const d = [Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p)], maxT = r() < 0.3 ? 5 + r() * 20 : 200, out = { t: 0, n: [0, 0, 0] };
    const ta = A.raycast(o, d, maxT, out), tb = B.raycast(o, d, maxT), nB = [0, 0, 0];
    if (tb >= 0) nB[B.axis] = -Math.sign(d[B.axis]);
    count('raycast');
    if ((ta === Infinity) !== (tb < 0) || (ta !== Infinity && (ta !== tb || out.n.some((v, k) => v !== nB[k])))) miss('raycast', [o, d, maxT], [ta, out.n], [tb, nB]);
  }
  for (let i = 0; i < 10000; i++) { const a = [X(), 0.1 + r() * 3, Z()], b = [X(), 0.1 + r() * 3, Z()]; count('sight'); if (A.sightLine(a, b) !== B.sight(a, b)) miss('sight', [a, b], A.sightLine(a, b), B.sight(a, b)); }
  for (let i = 0; i < 20000; i++) { const x = X(), z = Z(), y = Y(); count('nodeAt'); if (A.nodeAt(x, z, y) !== B.nodeAt(x, z, y)) miss('nodeAt', [x, z, y], A.nodeAt(x, z, y), B.nodeAt(x, z, y)); }
  for (let i = 0; i < 3000; i++) { const x = X(), z = Z(), y = Y(); count('nearest node'); if (A._nearestNode(x, z, y) !== B.nearestNode(x, z, y)) miss('nearestNode', [x, z, y], A._nearestNode(x, z, y), B.nearestNode(x, z, y)); }
  for (let i = 0; i < 6000; i++) { const k = Math.floor(r() * A.nodeCount), a = [A.nodeX[k], A.nodeZ[k], A.nodeY[k]], L = i % 3 ? 4 : 16, b = [a[0] + (r() - 0.5) * L, a[1] + (r() - 0.5) * L, Y()]; count('clearWalk'); if (A.clearWalk(a, b) !== B.clearWalk(a, b)) miss('clearWalk', [a, b], A.clearWalk(a, b), B.clearWalk(a, b)); }
  for (let i = 0; i < 1500; i++) {
    const k = Math.floor(r() * A.nodeCount), j = Math.floor(r() * A.nodeCount);
    const ax = A.nodeX[k] + (r() - 0.5) * 0.6, az = A.nodeZ[k] + (r() - 0.5) * 0.6, ay = A.nodeY[k], bx = A.nodeX[j] + (r() - 0.5) * 0.6, bz = A.nodeZ[j] + (r() - 0.5) * 0.6, by = A.nodeY[j];
    const pa = A.findPath(ax, az, bx, bz, ay, by), pb = B.path(ax, az, ay, bx, bz, by);
    count('path');
    if (pa.length !== pb.length || pa.some((p, q) => p[0] !== pb[q][0] || p[1] !== pb[q][1] || p[2] !== pb[q][2])) miss('path', [ax, az, ay, bx, bz, by], pa.slice(0, 3), pb.slice(0, 3));
  }
  check(id + ': identical floors, raycasts (with the face hit), sight lines, path nodes and paths', !bad.length, bad.join('\n       '));

  // movement: walks from standing spots at 60, 30 and 15 FPS; the old human loop (one-pass
  // push-out, then stand or fall) against the core's body step
  const inside = (p) => { let w = 0; for (const b of A.boxes) { if (!RefArena.blocks(b, p.y)) continue; const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ)), d = Math.hypot(p.x - cx, p.z - cz); if (R - d > w) w = R - d; } return w > 1e-6; };
  for (let w = 0; w < 400; w++) {
    const k = Math.floor(r() * A.nodeCount), a = { x: A.nodeX[k], y: A.nodeY[k], z: A.nodeZ[k], vy: 0 }, b = { ...a };
    let ang = r() * Math.PI * 2;
    const fps = [60, 30, 15][w % 3], dt = 1 / fps, sp = w % 2 ? 5.6 : 3.4;
    for (let i = 0; i < 4 * fps; i++) {
      if (r() < 0.03) ang = r() * Math.PI * 2;
      const vx = Math.sin(ang) * sp, vz = -Math.cos(ang) * sp;
      const dist = Math.hypot(vx, vz) * dt, n = Math.min(60, Math.max(1, Math.ceil(dist / 0.15)));
      for (let s = 0; s < n; s++) { const p = A.resolve({ x: a.x + vx * dt / n, y: a.y, z: a.z + vz * dt / n }, R); a.x = p.x; a.z = p.z; if (n > 1) { const gs = A.groundAt(a.x, a.z, a.y); if (gs > a.y) a.y = gs; } }
      const g = A.groundAt(a.x, a.z, a.y);
      if (g >= a.y - 1e-4) { a.y = g; a.vy = 0; } else { a.vy -= 22 * dt; a.y = Math.max(g, a.y + a.vy * dt); if (a.y === g) a.vy = 0; }
      B.stepBody(b, vx * dt, vz * dt, dt, R);
      soft.steps++;
      if (inside(a)) soft.oldInside++;
      if (inside(b)) soft.coreInside++;
      if (Math.hypot(a.x - b.x, a.z - b.z, a.y - b.y) > 1e-6) { b.x = a.x; b.y = a.y; b.z = a.z; b.vy = a.vy; } else soft.same++;
    }
  }
  // vaulting: from standing spots in every direction; where the answers differ the core's
  // landing spot must be somewhere a body fits
  for (let i = 0; i < 20000; i++) {
    const k = Math.floor(r() * A.nodeCount), a = r() * Math.PI * 2, dx = Math.sin(a), dz = -Math.cos(a), x = A.nodeX[k] + (r() - 0.5) * 0.4, z = A.nodeZ[k] + (r() - 0.5) * 0.4, y = A.nodeY[k];
    const va = A.vaultTarget(x, y, z, dx, dz), vb = B.vaultTarget(x, y, z, dx, dz, R);
    soft.vault++; if (vb) soft.vaultYes++;
    if (!!va !== !!vb || (va && (va.x !== vb.x || va.y !== vb.y || va.z !== vb.z || va.top !== vb.top))) soft.vaultDiff++;
    if (vb && (!B.free(vb.x, vb.z, R - 1e-6, vb.y) || Math.abs(B.groundAt(vb.x, vb.z, vb.y) - vb.y) > 1e-9 || vb.top - y > 1.5 + 1e-9)) soft.vaultBad++;
  }
  B.dispose();
}
console.log('  (' + Object.entries(exact).map(([k, v]) => num(v) + ' ' + k).join(', ') + ')');
check('movement: the same position as the old code in ' + (100 * soft.same / soft.steps).toFixed(2) + '% of ' + num(soft.steps) + ' steps (the rest are corners, where the core pushes out twice)', soft.same / soft.steps > 0.98);
check('movement: left overlapping a wall after a step less often than the old code (old ' + soft.oldInside + ', core ' + soft.coreInside + ')', soft.coreInside <= soft.oldInside);
check('vaulting: the same answer as the old code in all but ' + soft.vaultDiff + ' of ' + num(soft.vault) + ' tries (' + num(soft.vaultYes) + ' vaults)', soft.vaultDiff / soft.vault < 0.002);
check('vaulting: every landing spot is free, on the ground there, and no higher than 1.5 m up', soft.vaultBad === 0, String(soft.vaultBad));

/* ---------- the match maps: the ground floor ---------- */
const MAPS = ['yard', 'depot', 'containers', 'winter', 'casino', 'school', 'ranch', 'embassy', 'workshop'];
const FLAT = new Set(['yard', 'depot']);       // no stairs: moves stay on the floor
const total = { ray: 0, sight: 0, resolve: 0, move: 0, free: 0, walk: 0, near: 0, door: 0 };
console.log('\nMatch maps, ground floor: the old map code and the Rust core (answers must be identical)');
for (const id of MAPS) {
  const data = { ...json('data/maps/' + id + '.json'), ceil: 0 };
  const B = new MatchMap(data), A = new RefMap(data, B.solids);
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
      if (!!A.sight(a, b) !== B.sight(a, b)) note(label + 'sight', [a, b], !!A.sight(a, b), B.sight(a, b));   // the reference answers undefined for "blocked"
    }
    for (let i = 0; i < 6000; i++) {
      const x = X(), z = Z(), rad = [0.15, 0.2, 0.32][i % 3], fly = i % 3 === 0;
      const pa = A.resolve({ x, z }, rad, fly), pb = B.resolve({ x, y: 0, z }, rad, fly);
      total.resolve++;
      if (pa.x !== pb.x || pa.z !== pb.z) note(label + 'resolve', [x, z, rad, fly], pa, pb);
    }
    if (FLAT.has(id)) for (let i = 0; i < 3000; i++) {
      const x = X(), z = Z(), dx = (r() - 0.5) * 6 * (i % 5 === 0 ? 3 : 1), dz = (r() - 0.5) * 6, fly = i % 2 === 0, rad = fly ? 0.15 : 0.32;
      const pa = A.moveCircle({ x, z }, dx, dz, rad, fly), pb = B.moveCircle({ x, y: 0, z }, dx, dz, rad, fly);
      total.move++;
      if (pa.x !== pb.x || pa.z !== pb.z || pb.y !== 0) note(label + 'moveCircle', [x, z, dx, dz, rad, fly], pa, pb);
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
      const ax = X(), az = Z(), bx = ax + (r() - 0.5) * 4, bz = az + (r() - 0.5) * 4;
      const da = A.doorOn(ax, az, bx, bz, 0.2), db = B.doorOn(ax, az, bx, bz, 0.2);
      total.door++;
      if ((da ? da.i : -1) !== (db ? db.i : -1)) note(label + 'doorOn', [ax, az, bx, bz], da && da.i, db && db.i);
    }
  };
  pass('');
  // break things the same way on both, ask again, then put everything back and ask once more
  // break things in the game's map (whole panels, single cells, doors; barricades up), copy
  // the state across, ask again; then put everything back and ask once more
  const copy = () => { for (let k = 0; k < B.solids.length; k++) A.solids[k].alive = B.solids[k].alive; };
  let broke = 0;
  for (const pn of B.panels) if (r() < 0.5) {
    if (pn.kind === 'door') { if (pn.alive) B.hurtDoor(pn, 100); else B.barricade(pn); }
    else if (r() < 0.5) B.breakPanel(pn); else B.hurtCell(pn.cells[Math.floor(r() * pn.cells.length)], 999);
    broke++;
  }
  copy();
  const same = B.solids.every((b, k) => b.alive === A.solids[k].alive);
  if (broke) pass('(broken) ');
  B.resetPanels(); copy();
  if (broke) pass('(reset) ');
  check(id + ': identical answers' + (broke ? ', also with ' + broke + ' panels and doors broken, and after a reset' : ''), !bad.length && same, bad.join('\n       '));
  B.dispose();
}
console.log('  (' + Object.entries(total).map(([k, v]) => num(v) + ' ' + k).join(', ') + ')');
check('no worlds left in the core after dispose()', core().e.rc_world_count() === 0, String(core().e.rc_world_count()));
console.log(failures ? '\n' + failures + ' FAILED' : '\nRust core checks passed');
process.exit(failures ? 1 : 0);
