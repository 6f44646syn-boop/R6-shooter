// Headless check of the match modes (no rendering, seeded):
//   node tools/check-modes.mjs [tdm,ctf,bomb] [matches per mode]
// Runs bot-only matches fast-forwarded and asserts: every match ends; no bot stuck for more
// than 5 s; CTF produces captures; every Bomb round ends by one of the four rules; no NaN
// positions; the same seed gives the same result. Also unit-tests hitscan against boxes and
// capsules, and the flag and bomb state machines.
import { readFileSync } from 'node:fs';
import { MatchMap } from '../js/modes/map.js';
import { Match, TICK } from '../js/modes/sim.js';
import { rayBox, rayCapsule, raySphere } from '../js/modes/geom.js';

const root = new URL('../', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const guns = json('data/guns.json').guns, ops = json('data/ops.json'), abilities = json('data/abilities.json');
const maps = { yard: json('data/maps/yard.json'), depot: json('data/maps/depot.json') };

const modes = (process.argv[2] || 'tdm,ctf,bomb').split(',');
const N = +(process.argv[3] || 20);
let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const pass = (msg) => console.log('  PASS ' + msg);
const check = (msg, ok, info = '') => (ok ? pass(msg) : fail(msg + (info ? '\n       ' + info : '')));

/* ---------- unit tests ---------- */
console.log('Hitscan');
{
  const b = { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: 4, maxZ: 6 };
  check('ray hits a box face at the right distance', Math.abs(rayBox([0, 1, 0], [0, 0, 1], b) - 4) < 1e-9);
  check('ray beside a box misses', rayBox([1.5, 1, 0], [0, 0, 1], b) === Infinity);
  check('ray over a low box misses', rayBox([0, 2.5, 0], [0, 0, 1], b) === Infinity);
  check('ray from inside a box does not hit it', rayBox([0, 1, 5], [0, 0, 1], b) === Infinity);
  const t = rayCapsule([0, 1, 0], [0, 0, 1], [0, 0.5, 5], [0, 1.5, 5], 0.25);
  check('ray hits a capsule side at 4.75 m', Math.abs(t - 4.75) < 1e-6, String(t));
  check('ray passes a capsule 0.3 m off', rayCapsule([0.3, 1, 0], [0, 0, 1], [0, 0.5, 5], [0, 1.5, 5], 0.25) === Infinity);
  check('ray hits a head sphere', Math.abs(raySphere([0, 1.62, 0], [0, 0, 1], [0, 1.62, 5], 0.13) - 4.87) < 1e-6);
  // a match: a bullet at a body through open ground hits; the same through a wall does not
  const map = new MatchMap(maps.yard);
  const m = new Match({ map, mode: 'tdm', guns, ops, abilities, teamSize: 3, seed: 5, human: null });
  const [a, e] = [m.actors[0], m.actors.find((x) => x.team === 'B')];
  Object.assign(a, { x: -14, z: 3, alive: true, protectUntil: 0 }); Object.assign(e, { x: -14, z: -3, alive: true, protectUntil: 0, hp: 100 });
  // head height aim along -z
  let r = m.shoot(a, [a.x, 1.62, a.z], [0, 0, -1]);
  check('a bullet at a head in the open is a headshot kill (lethal)', r.actor === e && r.zone === 'head' && !e.alive, JSON.stringify({ zone: r.zone, hp: e.hp }));
  Object.assign(e, { alive: true, hp: 100 });
  r = m.shoot(a, [a.x, 1.1, a.z], [0, 0, -1]);
  check('torso hit does the gun damage', r.zone === 'torso' && Math.abs(100 - e.hp - a.gun.damage) < 1e-6, JSON.stringify({ zone: r.zone, hp: e.hp }));
  Object.assign(e, { hp: 100 }); r = m.shoot(a, [a.x, 0.5, a.z], [0, 0, -1]);
  check('limb hit does 0.8x', r.zone === 'limbs' && Math.abs(100 - e.hp - a.gun.damage * 0.8) < 1e-6, JSON.stringify({ zone: r.zone, hp: e.hp }));
  Object.assign(e, { x: 0, z: -4, hp: 100 }); Object.assign(a, { x: 0, z: 4 });
  r = m.shoot(a, [0, 1.2, 4], [0, 0, -1]);
  check('the middle block stops the bullet', !r.actor && e.hp === 100, JSON.stringify(r.box && r.box.kind));
  const mate = m.actors.find((x) => x.team === 'A' && x !== a);
  Object.assign(mate, { x: 0, z: 2.5, alive: true, hp: 100 }); Object.assign(e, { x: 0, z: 1.5 });
  m.map.solids.forEach(() => 0);
  r = m.shoot(a, [0, 1.2, 3.5], [0, 0, -1]);
  check('no friendly fire: bullets pass teammates', mate.hp === 100, String(mate.hp));
}

/* ---------- flag state machine ---------- */
console.log('\nFlag state machine');
{
  const map = new MatchMap(maps.yard);
  const m = new Match({ map, mode: 'ctf', guns, ops, abilities, teamSize: 3, seed: 9, human: null });
  for (const a of m.actors) a.brain = null;                      // scripted
  const R = m.rules, a = m.actors.find((x) => x.team === 'A'), mate = m.actors.find((x) => x.team === 'A' && x !== a), e = m.actors.find((x) => x.team === 'B');
  const park = (x) => { x.x = 0; x.z = (x.id - 5) * 3; };
  for (const x of m.actors) park(x);
  const fB = R.flags.B, fA = R.flags.A;
  a.x = fB.stand[0]; a.z = fB.stand[1]; m.step();
  check('touching the enemy flag picks it up', fB.state === 'carried' && fB.carrier === a && a.carry, fB.state);
  check('the carrier is 10% slower', Math.abs(m.speedOf(a) - a.gun.speed * 0.9) < 1e-9);
  m.kill(a, e); m.step();
  check('the flag drops where the carrier died', fB.state === 'dropped' && Math.abs(fB.x - a.x) < 0.01, fB.state);
  for (let i = 0; i < 14 * 60; i++) { park(e); m.step(); }
  check('a dropped flag is still out after 14 s', fB.state === 'dropped', fB.state);
  for (let i = 0; i < 2 * 60; i++) { park(e); m.step(); }
  check('a dropped flag returns home after 15 s', fB.state === 'home' && fB.x === fB.stand[0], fB.state);
  // enemy takes our flag, drops it; a teammate touching it returns it at once
  e.x = fA.stand[0]; e.z = fA.stand[1]; m.step();
  check('the enemy takes our flag', fA.state === 'carried' && fA.carrier === e, fA.state);
  m.kill(e, mate); m.step();
  mate.x = fA.x; mate.z = fA.z; m.step();
  check('a teammate touching our dropped flag returns it at once', fA.state === 'home', fA.state);
  // capture needs our flag home
  Object.assign(a, { alive: true, hp: 100 }); a.x = fB.stand[0]; a.z = fB.stand[1]; m.step();
  Object.assign(e, { alive: true, hp: 100, respawnAt: 0 }); e.x = fA.stand[0]; e.z = fA.stand[1]; m.step();
  a.x = fA.stand[0]; a.z = fA.stand[1] + 0.5; e.x = 5; e.z = 15; m.step();
  check('no capture while our own flag is away', R.score.A === 0 && fB.state === 'carried', 'score ' + R.score.A + ' ' + fA.state);
  m.kill(e, a); mate.x = fA.x; mate.z = fA.z; m.step();
  a.x = fA.stand[0]; a.z = fA.stand[1]; m.step();
  check('bringing the enemy flag to our stand with our flag home captures', R.score.A === 1 && fB.state === 'home' && !a.carry, 'score ' + R.score.A + ' ' + fB.state);
}

/* ---------- bomb state machine ---------- */
console.log('\nBomb state machine');
{
  const mk = () => {
    const m = new Match({ map: new MatchMap(maps.depot), mode: 'bomb', guns, ops, abilities, teamSize: 3, seed: 3, human: null, abilitiesOn: false });
    for (const a of m.actors) a.brain = null;
    return m;
  };
  const run = (m, s) => { for (let i = 0; i < s * 60; i++) m.step(); };
  let m = mk(), R = m.rules;
  const att = () => m.actors.filter((a) => R.isAttacker(a)), def = () => m.actors.filter((a) => !R.isAttacker(a));
  check('round 1: prep, one attacker carries the bomb', R.phase === 'prep' && R.bomb.state === 'carried' && att().includes(R.bomb.carrier));
  const c = R.bomb.carrier, site = R.sites[0];
  c.x = site.x; c.z = site.z;
  check('no planting during prep', !R.setHold(c, true));
  run(m, 31);
  check('the action phase starts after 30 s', R.phase === 'action');
  check('hold E inside a site starts planting', R.setHold(c, true) && c.hold.type === 'plant');
  run(m, 2); m.hit(c, 10, def()[0]);
  check('damage cancels the plant', !c.hold && R.bomb.state === 'carried');
  R.setHold(c, true); run(m, 5.2);
  check('a 5 s hold plants the bomb', R.bomb.state === 'planted' && R.phase === 'planted');
  const d = def()[0]; d.x = R.bomb.x + 0.5; d.z = R.bomb.z;
  check('hold E beside the bomb starts defusing', R.setHold(d, true) && d.hold.type === 'defuse');
  run(m, 6.2);
  check('a 6 s hold defuses: the defenders win the round', R.rounds.length === 1 && R.rounds[0].reason === 'defused' && R.rounds[0].winner === d.team);
  run(m, 5.5);
  check('5 s later round 2 starts with everyone alive', R.round === 2 && m.actors.every((a) => a.alive));
  // detonation
  m = mk(); R = m.rules; run(m, 31);
  let c2 = R.bomb.carrier; c2.x = R.sites[1].x; c2.z = R.sites[1].z; R.setHold(c2, true); run(m, 5.2);
  run(m, 40.5);
  check('the bomb goes off 40 s after the plant: attackers win', R.rounds[0] && R.rounds[0].reason === 'detonated' && R.rounds[0].winner === R.attackTeam());
  // the carrier dies: the bomb drops, another attacker picks it up
  m = mk(); R = m.rules; run(m, 31);
  c2 = R.bomb.carrier; m.kill(c2, def()[0]); m.step();
  check('the bomb drops when the carrier dies', R.bomb.state === 'dropped');
  const other = att().find((a) => a.alive); other.x = R.bomb.x; other.z = R.bomb.z; m.step();
  check('another attacker picks it up', R.bomb.state === 'carried' && R.bomb.carrier === other);
  // time out with no plant
  m = mk(); R = m.rules; run(m, 30 + 151);
  check('time runs out with no plant: the defenders win', R.rounds[0] && R.rounds[0].reason === 'time' && R.rounds[0].winner !== R.attackTeam());
  // elimination; planted with all attackers dead goes on until the bomb
  m = mk(); R = m.rules; run(m, 31);
  for (const a of def()) m.kill(a, att()[0]); m.step();
  check('all defenders dead: the attackers win', R.rounds[0] && R.rounds[0].reason === 'eliminated' && R.rounds[0].winner === R.attackTeam());
  m = mk(); R = m.rules; run(m, 31);
  c2 = R.bomb.carrier; c2.x = R.sites[0].x; c2.z = R.sites[0].z; R.setHold(c2, true); run(m, 5.2);
  for (const a of att()) m.kill(a, def()[0]); m.step();
  check('after a plant, the round goes on with all attackers dead', !R.rounds.length && R.bomb.state === 'planted');
  // sides swap after round 3
  m = mk(); R = m.rules; const first = R.attackTeam();
  for (let r = 0; r < 3; r++) { run(m, 31); for (const a of def()) m.kill(a, att()[0]); run(m, 5.5); }
  check('sides swap after round 3 (ops change side too)', R.round === 4 && R.attackTeam() !== first && m.actors.filter((a) => R.isAttacker(a)).every((a) => ops.attackers.some((o) => o.id === a.op.id)));
}

/* ---------- matches ---------- */
function run(mode, seed, extra = {}) {
  const mapId = mode === 'bomb' ? 'depot' : 'yard';
  const map = new MatchMap(maps[mapId]);
  const diffs = ['easy', 'normal', 'hard'];
  const m = new Match({ map, mode, guns, ops, abilities, seed, human: null, teamSize: seed % 2 ? 5 : 3, difficulty: diffs[seed % 3], abilitiesOn: mode === 'bomb', minutes: 10, ...extra });
  let maxStuck = 0, who = '';
  const cap = (mode === 'bomb' ? 7 * 260 : m.o.minutes * 60 + 660) / TICK;
  while (!m.over && m.tick < cap) {
    m.step();
    if (m.tick % 30 === 0) for (const a of m.actors) if (a.stuckFor > maxStuck) { maxStuck = a.stuckFor; who = a.name + ' ' + (a.brain ? a.brain.state : '') + ' at ' + a.x.toFixed(1) + ',' + a.z.toFixed(1); }
    m.events.length = 0;
  }
  const hash = m.actors.map((a) => a.x.toFixed(3) + ',' + a.z.toFixed(3) + ',' + a.kills).join('|');
  return { m, maxStuck, who, hash, ended: m.over, nan: !!m.nan };
}
for (const mode of modes) {
  console.log('\n' + mode.toUpperCase() + ': ' + N + ' bot-only matches');
  const t0 = Date.now();
  const res = [];
  for (let s = 1; s <= N; s++) res.push(run(mode, s));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const notEnded = res.filter((r) => !r.ended);
  check('every match ends (' + secs + ' s for ' + N + ')', !notEnded.length, notEnded.map((r) => 'seed ' + r.m.o.seed + ' t=' + r.m.t.toFixed(0)).join(', '));
  const stuck = res.filter((r) => r.maxStuck > 5);
  check('no bot stuck for more than 5 s (worst ' + Math.max(...res.map((r) => r.maxStuck)).toFixed(1) + ' s)', !stuck.length, stuck.slice(0, 4).map((r) => 'seed ' + r.m.o.seed + ': ' + r.who + ' ' + r.maxStuck.toFixed(1) + ' s').join('; '));
  check('no NaN positions', !res.some((r) => r.nan));
  const a = run(mode, 7), b = run(mode, 7);
  check('the same seed gives the same result', a.hash === b.hash && a.m.winner === b.m.winner && a.m.tick === b.m.tick);
  const summary = res.map((r) => r.m.rules.summary ? r.m.rules.summary() : r.m.winner + ' ' + JSON.stringify(r.m.rules.score)).slice(0, 6).join(' | ');
  console.log('  e.g. ' + summary);
  if (mode === 'tdm') {
    const killsOk = res.every((r) => r.m.rules.score.A + r.m.rules.score.B > 0);
    check('every TDM match has kills; endings by kill limit or time', killsOk && res.every((r) => ['kills', 'time'].includes(r.m.endReason)), res.map((r) => r.m.endReason + ':' + r.m.rules.score.A + '-' + r.m.rules.score.B).join(' '));
  }
  if (mode === 'ctf') {
    const caps = res.map((r) => r.m.rules.score.A + r.m.rules.score.B);
    check('CTF produces captures (' + caps.reduce((p, q) => p + q, 0) + ' in ' + N + ' matches; matches without: ' + caps.filter((c) => !c).length + ')', caps.filter((c) => c > 0).length >= N * 0.8, caps.join(','));
  }
  if (mode === 'bomb') {
    const rounds = res.flatMap((r) => r.m.rules.rounds || []);
    const okReasons = ['eliminated', 'detonated', 'defused', 'time'];
    check('every Bomb round ends by one of the four rules (' + rounds.length + ' rounds: ' + okReasons.map((k) => k + ' ' + rounds.filter((x) => x.reason === k).length).join(', ') + ')', rounds.length > 0 && rounds.every((x) => okReasons.includes(x.reason)), JSON.stringify(rounds.filter((x) => !okReasons.includes(x.reason)).slice(0, 3)));
  }
}
// abilities in every mode (on by default only in Bomb): a few matches each with them on
if (modes.includes('bomb')) {
  console.log('\nAbilities on in TDM and CTF (6 matches each)');
  for (const mode of ['tdm', 'ctf']) {
    const res = [];
    for (let s = 1; s <= 6; s++) res.push(run(mode, 100 + s, { abilitiesOn: true }));
    check(mode.toUpperCase() + ' with abilities: matches end, nobody stuck over 5 s, no NaN', res.every((r) => r.ended && r.maxStuck <= 5 && !r.nan), res.map((r) => (r.ended ? 'ok' : 'not ended') + ' ' + r.maxStuck.toFixed(1) + 's ' + r.who).join('; '));
  }
}
if (typeof globalThis.__extraChecks === 'function') await globalThis.__extraChecks({ check, json, guns, ops, abilities, maps });
console.log(failures ? '\n' + failures + ' FAILED' : '\nAll mode checks passed');
process.exit(failures ? 1 : 0);
