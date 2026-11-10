// Headless check of the match modes (no rendering, seeded):
//   node tools/check-modes.mjs [tdm,ctf,bomb] [matches per mode]
// Runs bot-only matches fast-forwarded and asserts: every match ends; no bot stuck for more
// than 5 s; CTF produces captures; every Bomb round ends by one of the four rules; no NaN
// positions; the same seed gives the same result. Also unit-tests hitscan against boxes and
// capsules, and the flag and bomb state machines.
import { readFileSync } from 'node:fs';
import { MatchMap } from '../js/modes/map.js';
import { Match, TICK } from '../js/modes/sim.js';
import { rayCapsule, raySphere } from '../js/modes/geom.js';

const root = new URL('../', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const guns = json('data/guns.json').guns, ops = json('data/ops.json'), abilities = json('data/abilities.json');
const MAPS_OF = { tdm: ['containers', 'winter', 'casino', 'school', 'yard'], ctf: ['containers', 'winter', 'casino', 'school', 'yard'], bomb: ['ranch', 'embassy', 'workshop'] };
const maps = {};
for (const id of ['yard', 'depot', ...new Set(Object.values(MAPS_OF).flat())]) maps[id] = json('data/maps/' + id + '.json');

const modes = (process.argv[2] || 'tdm,ctf,bomb').split(',');
const N = +(process.argv[3] || 20);
let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const pass = (msg) => console.log('  PASS ' + msg);
const check = (msg, ok, info = '') => (ok ? pass(msg) : fail(msg + (info ? '\n       ' + info : '')));

/* ---------- unit tests ---------- */
console.log('Hitscan');
{
  // (ray against box, push-out and segment tests are Rust unit tests now: cargo test in rust/core)
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

/* ---------- doors and the knife ---------- */
console.log('\nDoors and the knife');
{
  const m = new Match({ map: new MatchMap(maps.ranch), mode: 'tdm', guns, ops, abilities, teamSize: 3, seed: 4, human: null });
  const [a, b] = [m.actors.find((x) => x.team === 'A'), m.actors.find((x) => x.team === 'B')];
  for (const x of m.actors) if (x !== a && x !== b) { x.x = 30; x.z = 20 + x.id; }
  a.protectUntil = b.protectUntil = 0;
  const door = m.map.panels.find((p) => p.kind === 'door');
  const db = door.box, cx = (db.minX + db.maxX) / 2, cz = (db.minZ + db.maxZ) / 2;
  check('a whole door blocks walking through it', !m.map.walkClear(cx, cz - 1, cx, cz + 1));
  a.x = cx; a.z = cz - 1; a.yaw = 180; a.pitch = 0; a.crouch = 0; b.x = -30; b.z = -20;
  m.knife(a);
  check("one knife hit breaks a door", !door.alive && m.map.walkClear(cx, cz - 1, cx, cz + 0.4));
  m.map.resetPanels();
  m.t += 2;
  for (let k = 0; k < 4; k++) m.shoot(a, m.eye(a), [0, 0, 1]);
  const after4 = door.alive;
  m.shoot(a, m.eye(a), [0, 0, 1]);
  check('bullets break a door after 5 hits', after4 && !door.alive);
  m.map.resetPanels(); m.t += 2;
  b.x = cx + 0.3; b.z = cz - 3; b.yaw = 180; b.hp = 100; b.alive = true; a.x = cx + 0.3; a.z = cz - 4.2; a.yaw = 180;
  m.knife(a);
  check('a knife from behind is lethal', !b.alive);
  b.alive = true; b.hp = 100; b.yaw = 0; m.t += 2; m.knife(a);
  check('a knife from the front does 60', b.alive && b.hp === 40);
  m.t += 2; a.x = 0; a.z = 0; b.x = 0; b.z = 5; m.knife(a);
  check('a knife does not reach 5 m', b.hp === 40);
}

/* ---------- the bomb is yours; jobs ---------- */
console.log('\nBomb: your bomb and the bots\' jobs');
{
  const m = new Match({ map: new MatchMap(maps.ranch), mode: 'bomb', guns, ops, abilities, teamSize: 5, seed: 2, human: { op: 'pace', side: 'attack' } });
  const me = m.human(), R = m.rules;
  check('you carry the bomb when you attack', R.bomb.carrier === me);
  const roles = (att) => m.actors.filter((a) => a.brain && R.isAttacker(a) === att).map((a) => a.role).sort().join(',');
  check('attacker bots each have a job', roles(true) === 'entry,flanker,lurker,support', roles(true));
  check('defenders: anchors, site control and a roamer', roles(false) === 'anchor,anchor,roamer,site control,site control', roles(false));
  check('one bomb site per map', ['ranch', 'embassy', 'workshop'].every((id) => maps[id].sites.length === 1 && maps[id].sites[0].entries.length >= 2));
}

/* ---------- nothing passes through walls, at any frame rate ---------- */
console.log('\nCollision: drones and bodies against every wall, soft wall, reinforced wall and door (Bomb maps)');
{
  const DR = 0.15, BR = 0.32;
  // Drive a circle straight at each thin solid from both sides, at several frame times.
  // step(map, p, dx, dz, r, flyer) is the movement under test.
  function drive(map, step, r, flyer, kinds, frames, speed) {
    let tests = 0, crossed = 0, passed = 0; const where = [];
    for (const b of map.solids) {
      if (!kinds.includes(b.kind) || !b.alive || b.minY > 0.31 || b.maxY < 1.9) continue;
      const w = b.maxX - b.minX, d = b.maxZ - b.minZ, thinX = w < d;
      if (Math.min(w, d) > 0.6) continue;                      // furniture and blocks: not walls
      const len = thinX ? d : w, lo = thinX ? b.minZ : b.minX;
      for (let s = 0.35; s < len - 0.3; s += 0.75) for (const dir of [1, -1]) {
        const face = dir > 0 ? (thinX ? b.minX : b.minZ) : (thinX ? b.maxX : b.maxZ);
        const start = { x: thinX ? face - dir * (r + 0.7) : lo + s, z: thinX ? lo + s : face - dir * (r + 0.7) };
        const probe = { x: start.x, z: start.z };
        map.resolve(probe, r, flyer);
        if (Math.hypot(probe.x - start.x, probe.z - start.z) > 1e-9) continue;         // something stands there
        // must be able to reach the face (nothing else in the way)
        const reach = { x: start.x, z: start.z };
        for (let i = 0; i < 80; i++) map.moveCircle(reach, thinX ? dir * 0.01 : 0, thinX ? 0 : dir * 0.01, r, flyer);
        const gap = Math.abs((thinX ? reach.x : reach.z) - face);
        if (b.kind !== 'door' || !flyer) { if (gap > r + 0.02 || Math.abs((thinX ? reach.z : reach.x) - (lo + s)) > 0.05) continue; }
        for (const dt of frames) {
          const p = { x: start.x, z: start.z };
          for (let t = 0; t < 1.5; t += dt) step(map, p, thinX ? dir * speed * dt : 0, thinX ? 0 : dir * speed * dt, r, flyer);
          const pos = thinX ? p.x : p.z, far = dir > 0 ? pos > (thinX ? b.maxX : b.maxZ) : pos < (thinX ? b.minX : b.minZ);
          tests++;
          if (far) { crossed++; if (where.length < 3) where.push(map.id + ' ' + b.kind + ' at ' + ((b.minX + b.maxX) / 2).toFixed(1) + ',' + ((b.minZ + b.maxZ) / 2).toFixed(1) + ' dt ' + dt.toFixed(3)); }
          else passed++;
        }
      }
    }
    return { tests, crossed, where };
  }
  const now = (map, p, dx, dz, r, flyer) => map.moveCircle(p, dx, dz, r, flyer);
  const old = (map, p, dx, dz, r, flyer) => { p.x += dx; p.z += dz; map.resolve(p, r, flyer); };     // one check per frame (the bug)
  const FR = [1 / 144, 1 / 60, 1 / 30, 1 / 20, 1 / 15, 0.1];
  let oldCross = 0, T = { drone: 0, body: 0, door: 0, doorPass: 0, dash: 0 }, bad = [];
  for (const id of ['ranch', 'embassy', 'workshop', 'depot']) {
    const map = new MatchMap(maps[id]);
    oldCross += drive(map, old, DR, true, ['wall', 'soft', 'reinforced'], [1 / 15, 0.1], 6).crossed;
    let r = drive(map, now, DR, true, ['wall', 'soft', 'reinforced'], FR, 6); T.drone += r.tests; bad.push(...r.where.map((w) => 'drone ' + w));
    r = drive(map, now, DR, true, ['wall', 'soft', 'reinforced'], [1 / 60, 0.1], 30); T.drone += r.tests; bad.push(...r.where.map((w) => 'fast drone ' + w));
    r = drive(map, now, BR, false, ['wall', 'soft', 'reinforced', 'door'], FR, 5.9); T.body += r.tests; bad.push(...r.where.map((w) => 'body ' + w));
    r = drive(map, now, BR, false, ['wall', 'soft', 'reinforced', 'door'], [1 / 60, 0.1], 17.2); T.dash += r.tests; bad.push(...r.where.map((w) => 'dash ' + w));
    // doors: a drone goes under the boards, from both sides
    r = drive(map, now, DR, true, ['door'], [1 / 60, 0.1], 6); T.door += r.tests; T.doorPass += r.crossed;
    // a broken soft wall lets a drone and a body through
    const pn = map.panels.find((q) => q.kind === 'soft');
    if (pn) { const c = [(pn.box.minX + pn.box.maxX) / 2, 1, (pn.box.minZ + pn.box.maxZ) / 2]; map.breakAt(c, 0.1); T.softOpen = (T.softOpen || 0) + (pn.alive ? 0 : 1); }
    if (map.dispose) map.dispose();
  }
  check('the old one-check-per-frame move does tunnel at 10-15 FPS (' + oldCross + ' crossings): the test catches the bug', oldCross > 0);
  check('drones never cross a wall, soft wall or reinforced wall (' + T.drone + ' drives, 6 and 30 m/s, 144 to 10 FPS)', !bad.some((w) => w.includes('drone')), bad.join('; '));
  check('bodies never cross a wall, soft wall, reinforced wall or boarded door (' + T.body + ' drives at sprint speed)', !bad.some((w) => w.startsWith('body')), bad.join('; '));
  check('a Charge Dash (17 m/s) never crosses one either (' + T.dash + ' drives)', !bad.some((w) => w.startsWith('dash')), bad.join('; '));
  check('drones roll under boarded doors (' + T.doorPass + ' of ' + T.door + ' drives got through)', T.doorPass >= T.door * 0.9, T.doorPass + '/' + T.door);
  // knockback and drone deployment stop at walls
  const m = new Match({ map: new MatchMap(maps.ranch), mode: 'bomb', guns, ops, abilities, teamSize: 5, seed: 5, human: null, abilitiesOn: true });
  while (m.rules.phase === 'prep') { m.step(); m.events.length = 0; }
  const onyx = m.actors.find((a) => a.ab.id === 'charge_dash'), foe = m.actors.find((a) => a.team !== onyx.team);
  for (const a of m.actors) { a.brain = null; if (a !== onyx && a !== foe) { a.x = 30; a.z = 20 - a.id; } }
  // the west outer wall of Ranch is at x = -24 (0.4 thick): victim 0.6 m inside it, in the open kitchen corner, dashed at from the east
  foe.x = -23.2; foe.z = -11; onyx.x = -21.6; onyx.z = -11; onyx.yaw = 270; foe.protectUntil = 0; foe.hp = 100; onyx.protectUntil = 0;
  m.ab.startDash(onyx);
  for (let i = 0; i < 40; i++) { m.ab.update(TICK); m.t += TICK; }
  check('Charge Dash knockback stops at the wall (victim stays inside)', foe.x > -23.9 && foe.x < -20, 'victim x ' + foe.x.toFixed(2));
  const att = m.actors.find((a) => m.rules.isAttacker(a) && a.ab.id !== 'spark_drone');
  att.alive = true; att.x = -24.6; att.z = -6; att.yaw = 90;        // outside, nose to the west wall
  const d = m.ab.launchDrone(att, true);
  check('a drone deployed facing a wall stays on your side of it', d.x < -24.2, 'drone x ' + d.x.toFixed(2));
}

/* ---------- grenades ---------- */
console.log('\nGrenades');
{
  const mk = () => new Match({ map: new MatchMap(maps.yard), mode: 'tdm', guns, ops, abilities, teamSize: 3, seed: 6, human: null });
  let m = mk();
  const [a, b] = [m.actors.find((x) => x.team === 'A'), m.actors.find((x) => x.team === 'B')];
  const park = () => { for (const x of m.actors) if (x !== a && x !== b) { x.x = 28; x.z = 18 - x.id; x.brain = null; } a.brain = null; b.brain = null; a.protectUntil = b.protectUntil = 0; };
  park();
  check('everyone starts with 2 grenades', m.actors.every((x) => x.nades === 2));
  // open ground: thrown 8 m in front of b
  a.x = -10; a.z = 15; a.yaw = 90; a.pitch = 10; b.x = -2; b.z = 15; b.hp = 100;
  const n = m.nades.throw(a);
  check('a throw uses one grenade', !!n && a.nades === 1);
  let maxY = 0; while (m.nades.live.length) { if (n.end - m.t < 0.03 && b.z === 15) { b.x = n.x - 2.5; b.z = n.z + 0.01; } m.step(); maxY = Math.max(maxY, n.y); m.events.length = 0; }
  check('it flies in an arc and goes off after 2.5 s', maxY > 1.8 && Math.abs(m.t - 2.5) < 0.2, 'maxY ' + maxY.toFixed(2) + ' t ' + m.t.toFixed(2));
  check('it hurts someone 2.5 m from where it lands (' + Math.round(100 - b.hp) + ')', b.hp < 100 || !b.alive, 'hp ' + b.hp + ' nade at ' + n.x.toFixed(1) + ',' + n.z.toFixed(1));
  // behind a wall: no damage
  m = mk(); const a2 = m.actors.find((x) => x.team === 'A'), b2 = m.actors.find((x) => x.team === 'B');
  for (const x of m.actors) x.brain = null;
  a2.protectUntil = b2.protectUntil = 0;
  const w = m.map.solids.find((s) => s.kind === 'wall' && s.maxY >= 3 && s.maxX - s.minX > 3);
  const wx = (w.minX + w.maxX) / 2, wz = w.maxZ;
  b2.x = wx; b2.z = w.minZ - 1.2; b2.hp = 100;
  m.nades.explode({ x: wx, y: 0.1, z: wz + 1.0, owner: a2.id, team: a2.team });
  check('a wall between you and the blast keeps you safe', b2.hp === 100);
  b2.x = wx; b2.z = wz + 1.6; m.nades.explode({ x: wx, y: 0.1, z: wz + 1.0, owner: a2.id, team: a2.team });
  check('a blast at your feet is lethal', !b2.alive);
  // bots use them
  let thrown = 0;
  for (let s = 1; s <= 4; s++) { const mm = new Match({ map: new MatchMap(maps.ranch), mode: 'bomb', guns, ops, abilities, teamSize: 5, seed: s, human: null }); while (!mm.over && mm.tick < 60 * 600) { mm.step(); for (const e of mm.events) if (e.type === 'nadeThrow') thrown++; mm.events.length = 0; } }
  check('bots throw grenades, but not all the time (' + thrown + ' in 4 matches)', thrown >= 8 && thrown < 160);
}

/* ---------- drones ---------- */
console.log('\nDrones');
{
  const mk = (abilitiesOn) => new Match({ map: new MatchMap(maps.ranch), mode: 'bomb', guns, ops, abilities, teamSize: 5, seed: 9, human: null, abilitiesOn });
  let m = mk(true);
  const att = m.actors.filter((a) => m.rules.isAttacker(a)), plain = att.find((a) => a.ab.id !== 'spark_drone'), glitch = att.find((a) => a.ab.id === 'spark_drone');
  m.step();
  check('every attacker has one prep drone', att.every((a) => a.ab.prepDrones === 1));
  m.ab.q(plain, true);
  const d = plain.ab.drone;
  check('Q in prep sends out the prep drone (any attacker)', !!d && d.basic);
  // under a door: the drone rolls through, a person does not
  const door = m.map.panels.find((p) => p.kind === 'door'), b = door.box, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  d.x = cx; d.z = cz - 0.6; d.yaw = 180;
  for (let i = 0; i < 30; i++) m.ab.droneInput(plain, { fwd: true }, 1 / 60);
  check('a drone rolls under a whole door', door.alive && d.z > cz + 0.5, d.z.toFixed(2));
  const p = { x: cx, z: cz - 0.6 }; for (let i = 0; i < 30; i++) { p.z += 0.05; m.map.resolve(p); }
  check('a person cannot walk under it', p.z < cz);
  while (m.rules.phase === 'prep') { m.step(); m.events.length = 0; }
  m.step();
  check('prep drones shut down when the action phase starts', !plain.ab.drone && !m.ab.gadgets.some((g) => g.type === 'drone' && g.basic));
  check('after prep, Q is not a drone for other attackers', !m.ab.q(plain, true) || !plain.ab.drone || !plain.ab.drone.basic);
  if (glitch) { glitch.ab.drone = null; m.ab.q(glitch, true); check('Glitch can still send his drone mid-round', !!glitch.ab.drone && !glitch.ab.drone.basic); }
  m = mk(false); m.step();
  const a2 = m.actors.find((a) => m.rules.isAttacker(a));
  m.ab.q(a2, true);
  check('prep drones work with abilities off too', !!a2.ab.drone && a2.ab.drone.basic);
}

/* ---------- matches ---------- */
function run(mode, seed, extra = {}) {
  const list = extra.maps || MAPS_OF[mode], mapId = list[seed % list.length];
  const map = new MatchMap(maps[mapId]);
  const diffs = ['easy', 'normal', 'hard'];
  const { maps: _ignore, ...opts } = extra;
  const m = new Match({ map, mode, guns, ops, abilities, seed, human: null, teamSize: seed % 2 ? 5 : 3, difficulty: diffs[seed % 3], abilitiesOn: mode === 'bomb', minutes: 10, ...opts });
  let maxStuck = 0, who = '';
  const cap = (mode === 'bomb' ? 7 * 260 : m.o.minutes * 60 + 660) / TICK;
  while (!m.over && m.tick < cap) {
    m.step();
    if (m.tick % 30 === 0) for (const a of m.actors) if (a.stuckFor > maxStuck) { maxStuck = a.stuckFor; who = mapId + ' ' + a.name + ' ' + (a.brain ? a.brain.state : '') + ' at ' + a.x.toFixed(1) + ',' + a.z.toFixed(1); }
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
