import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  utilityFor,
  abilitiesFor,
  sensoryFor,
} from '../js/balance/bomb-utility.js';
import { MatchMap } from '../js/modes/map.js';
import { Match } from '../js/modes/sim.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url));
const json = (p) => JSON.parse(read(p));
const source = createHash('sha256');
for (const p of ['Cargo.toml', 'src/lib.rs'])
  source.update(read('rust/bomb_utility/' + p));
assert.equal(
  source.digest('hex'),
  read('wasm/bomb_utility.hash').toString().trim(),
  'WASM source freshness',
);
let checks = 0;
const check = (name, condition) => {
  assert.ok(condition, name);
  checks++;
  console.log('PASS ' + name);
};
const profiles = {
  bomb: utilityFor('bomb'),
  tdm: utilityFor('tdm'),
  ctf: utilityFor('ctf'),
};
check(
  'non-Bomb modes retain original policy',
  JSON.stringify(profiles.tdm) ===
    JSON.stringify({
      reinforceSeconds: 2.5,
      barricadeSeconds: 1.5,
      barricadeHp: 100,
      wireHp: 3,
      wireSpeed: 0.4,
      actionSeconds: 150,
      reinforceReach: 1.6,
    }) && profiles.tdm === profiles.ctf,
);
const make = (mode = 'bomb') => {
  const m = new Match({
    map: new MatchMap(
      json('data/maps/' + (mode === 'bomb' ? 'ranch' : 'yard') + '.json'),
    ),
    mode,
    guns: json('data/guns.json').guns,
    ops: json('data/ops.json'),
    abilities: json('data/abilities.json'),
    abilitiesOn: true,
    teamSize: 3,
    seed: 3,
    human: null,
  });
  for (const a of m.actors) a.brain = null;
  return m;
};
const run = (m, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) m.step();
};
const near = (a, pn, reach = 0.9) => {
  const b = pn.box;
  a.x = (b.minX + b.maxX) / 2 + (pn.alongX ? 0 : reach);
  a.z = (b.minZ + b.maxZ) / 2 + (pn.alongX ? reach : 0);
  a.y = pn.y0 || 0;
};
{
  const m = make(),
    r = m.rules,
    d = m.actors.find((a) => !r.isAttacker(a));
  const wall = m.map.panels.find((p) => p.kind === 'soft');
  near(d, wall, 1.75);
  d.yaw = wall.alongX ? 0 : -90;
  check(
    'reinforcement can start from the extended placement reach',
    r.workAt(d) === wall,
  );

  assert.ok(r.setHold(d, true, wall));
  run(m, 2.4);
  check(
    'reinforcement cannot finish before 2.5 seconds',
    wall.kind === 'soft' && d.hold?.type === 'reinforce',
  );
  run(m, 0.2);
  check(
    'reinforcement finishes and consumes one of two charges',
    wall.kind === 'reinforced' && d.reinf === 1 && !d.hold,
  );
  check(
    'bullets still cannot chip a reinforced wall',
    !m.map.hurtCell(wall.cells[0], 999),
  );
  const b = wall.box;
  m.map.breakAt(
    [(b.minX + b.maxX) / 2, 1.1 + wall.y0, (b.minZ + b.maxZ) / 2],
    3,
    true,
  );
  check('breaching still opens reinforced walls', !wall.alive);
  const door = m.map.panels.find((p) => p.kind === 'door' && p.slot);
  near(d, door);
  assert.ok(r.setHold(d, true, door));
  run(m, 1.4);
  check(
    'barricade cannot finish before 1.5 seconds',
    !door.alive && d.hold?.type === 'barricade',
  );
  run(m, 0.2);
  check(
    'completed Bomb barricade has 150 health',
    door.alive && door.hp === 150,
  );
  m.map.hurtDoor(door, 100);
  check('Bomb barricade survives one knife hit', door.alive && door.hp === 50);
  m.map.hurtDoor(door, 100);
  check('second knife hit clears the barricade', !door.alive);
  assert.ok(m.map.barricade(door));
  m.map.resetPanels();
  check(
    'round reset restores the same durability on boarded entries',
    m.map.panels
      .filter((p) => p.kind === 'door' && !p.slot)
      .every((p) => p.hp === 150),
  );
  m.map.dispose();
}
{
  const m = make(),
    r = m.rules,
    d = m.actors.find((a) => !r.isAttacker(a)),
    a = m.actors.find((a) => r.isAttacker(a));
  Object.assign(d, { x: -20, y: 0, z: 3.5, yaw: 0, pitch: -30 });
  const wire = m.ab.placeWire(d);
  check(
    'wire still costs one of two rolls and now takes four bullets',
    wire?.hp === 4 && d.wire === 1,
  );
  for (let i = 0; i < 3; i++) m.ab.hurtGadget(wire, a);
  check('wire survives three bullet impacts', wire.alive && wire.hp === 1);
  m.ab.hurtGadget(wire, a);
  check('fourth bullet clears wire', !wire.alive);
  a.wireAt = m.t;
  d.wireAt = -9;
  check(
    'enemy wire applies 35% movement without changing unaffected defenders',
    Math.abs(m.speedOf(a) / a.gun.speed - 0.35) < 1e-12 &&
      m.speedOf(d) === d.gun.speed,
  );
  const other = m.ab.placeWire(d);
  d.x = -25;
  d.z = 10;
  for (const e of m.actors)
    if (e !== a && e !== d) {
      e.x = -25;
      e.z = 13;
    }
  Object.assign(a, {
    x: other.x - 1.3,
    y: other.floor,
    z: other.z,
    yaw: 90,
    pitch: 0,
    knifeAt: 0,
  });
  r.phase = 'action';
  m.knife(a);
  check('one close-range knife still clears wire', !other.alive);
  const wasDefender = d;
  r.round = 4;
  r.newRound();
  check(
    'side swap moves defensive utility to the new defenders',
    r.isAttacker(wasDefender) &&
      wasDefender.wire === 0 &&
      m.actors
        .filter((a) => !r.isAttacker(a))
        .every((a) => a.wire === 2 && a.reinf === 2),
  );
  m.map.dispose();
}
{
  const m = make(),
    r = m.rules;
  m.t = r.phaseEnd;
  r.update();
  check(
    'attack phase starts with exactly 120 seconds',
    r.phase === 'action' && r.phaseEnd - m.t === 120,
  );
  m.t = r.phaseEnd - 0.001;
  r.update();
  r.check();
  check('defenders do not win before the deadline', r.rounds.length === 0);
  m.t = r.phaseEnd;
  r.update();
  r.check();
  check(
    'unplanted bomb times out for a defender win at the deadline',
    r.rounds[0]?.side === 'defend' && r.rounds[0]?.reason === 'time',
  );
  m.map.dispose();
}
{
  const m = make(),
    r = m.rules;
  m.t = r.phaseEnd;
  r.update();
  const actionEnd = r.phaseEnd,
    c = r.bomb.carrier,
    site = r.sites[0];
  c.x = site.x;
  c.z = site.z;
  m.t = actionEnd - 5.1;
  assert.ok(r.setHold(c, true));
  check('plant duration remains five seconds', c.hold.need === 5);
  m.t += 5.01;
  r.update();
  check(
    'late successful plant still gets the full forty-second fuse',
    r.phase === 'planted' && r.bomb.fuseEnd - m.t === 40,
  );
  m.t = actionEnd + 1;
  r.update();
  r.check();
  check(
    'old attack deadline does not cut short a planted bomb',
    r.phase === 'planted' && r.rounds.length === 0,
  );
  const d = m.actors.find((a) => !r.isAttacker(a));
  d.x = r.bomb.x;
  d.z = r.bomb.z;
  assert.ok(r.setHold(d, true));
  check('defuse duration remains six seconds', d.hold.need === 6);
  m.map.dispose();
}
{
  const source = json('data/abilities.json'),
    original = JSON.stringify(source),
    tuned = abilitiesFor('bomb', source);
  check(
    'all five defender abilities gain coverage or uptime',
    tuned.jolt_mines.slowTime === 5 &&
      tuned.dread_mines.shakeTime === 7 &&
      tuned.static_jammer.radius === 10 &&
      tuned.catcher.recharge === 8 &&
      tuned.charge_dash.distance === 6.5,
  );
  check(
    'ability damage, charges and attacker abilities stay unchanged',
    [
      'jolt_mines',
      'dread_mines',
      'static_jammer',
      'catcher',
      'charge_dash',
    ].every(
      (k) =>
        tuned[k].damage === source[k].damage &&
        tuned[k].charges === source[k].charges,
    ) &&
      [
        'spark_drone',
        'breach_rounds',
        'wall_charge',
        'pulse_scanner',
        'underbarrel',
      ].every((k) => tuned[k] === source[k]),
  );
  check(
    'shared ability catalogue is never mutated',
    JSON.stringify(source) === original,
  );
  check(
    'TDM and CTF keep their original ability configurations',
    JSON.stringify(abilitiesFor('tdm', source)) === original &&
      JSON.stringify(abilitiesFor('ctf', source)) === original,
  );
}
{
  const m = make(),
    r = m.rules,
    d = m.actors.find((a) => !r.isAttacker(a)),
    a = m.actors.find((a) => r.isAttacker(a));
  m.t = 1;
  a.protectUntil = 0;
  Object.assign(a, { x: -20, y: 0, z: 5.3 });
  m.ab.add({
    type: 'mine',
    kind: 'jolt',
    team: d.team,
    owner: d.id,
    x: -20,
    y: 0.05,
    z: 3,
    r: 0.2,
    trigAt: 0,
  });
  m.ab.update(1 / 60);
  check(
    'Jolt triggers beyond the old 2.2 m radius',
    m.ab.gadgets.some((g) => g.trigAt === 1.5),
  );
  m.t = 1.5;
  m.ab.update(1 / 60);
  check(
    'Jolt applies five-second disruption without added damage',
    a.hp === 75 && a.slowUntil === 6.5 && a.wobbleUntil === 6.5,
  );
  m.ab.clearAll();
  a.hp = 100;
  m.ab.add({
    type: 'mine',
    kind: 'dread',
    team: d.team,
    owner: d.id,
    x: -20,
    y: 0.05,
    z: 3,
    r: 0.2,
    trigAt: 2,
  });
  m.t = 2;
  m.ab.update(1 / 60);
  check(
    'Dread applies seven-second shake/reveal and six-second cloud',
    a.hp === 90 &&
      a.shakeUntil === 9 &&
      a.revealedUntil === 9 &&
      m.ab.clouds[0]?.until === 8 &&
      m.ab.clouds[0]?.r === 3.5,
  );
  m.ab.clearAll();
  m.ab.add({
    type: 'jammer',
    team: d.team,
    owner: d.id,
    x: -20,
    y: 1,
    z: 3,
    r: 0.22,
  });
  check(
    'jammer covers enemies at nine metres and spares its team',
    m.ab.jammed(-11, 3, a.team, 1) && !m.ab.jammed(-11, 3, d.team, 1),
  );
  m.ab.clearAll();
  const cat = m.ab.add({
    type: 'catcher',
    team: d.team,
    owner: d.id,
    x: -20,
    y: 1,
    z: 3,
    r: 0.2,
    readyAt: 0,
  });
  const projectile = {
    alive: true,
    team: a.team,
    owner: a.id,
    x: -14.5,
    y: 1,
    z: 3,
  };
  m.ab.projectiles.push(projectile);
  m.ab.update(1 / 60);
  check(
    'catcher intercepts at 5.5 metres and recharges in eight seconds',
    !projectile.alive && cat.readyAt === m.t + 8,
  );
  const stacked = sensoryFor('bomb', 15);
  check(
    'overlapping disruption stays audible and avoids full blackout',
    stacked.gain === 0.55 && stacked.cutoff === 1600 && stacked.veil === 0.65,
  );
  check(
    'expired or non-Bomb disruption restores normal perception',
    sensoryFor('bomb', 0).gain === 1 &&
      sensoryFor('bomb', 0).veil === 0 &&
      sensoryFor('tdm', 15).gain === 1 &&
      sensoryFor('tdm', 15).veil === 0,
  );
  m.map.dispose();
}
for (const mode of ['tdm', 'ctf']) {
  const m = make(mode),
    a = m.actors[0];
  a.wireAt = m.t;
  check(
    mode + ' retains original wire movement and barricade health',
    Math.abs(m.speedOf(a) / a.gun.speed - 0.4) < 1e-12 &&
      m.map.barricadeHp === 100,
  );
  m.map.dispose();
}
console.log(checks + ' Bomb utility integration checks passed');
