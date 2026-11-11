// Bomb drones fly at the drone's speed whatever the operator's own ability is (a bug: an
// ability's unrelated "speed", Breach Rounds' 40 m/s round, made that operator's prep drone
// fly at up to 40 m/s). node tests/drone-speed.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MatchMap } from '../js/modes/map.js';
import { Match } from '../js/modes/sim.js';
const j = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url)));
const ops = j('data/ops.json');
let n = 0;
for (const op of ops.attackers) {
  const m = new Match({ map: new MatchMap(j('data/maps/ranch.json')), mode: 'bomb', guns: j('data/guns.json').guns, ops, abilities: j('data/abilities.json'), abilitiesOn: true, teamSize: 3, seed: 3, human: { op: op.id, side: 'attack' } });
  const me = m.human();
  for (let i = 0; i < 30; i++) m.step();
  m.ab.launchDrone(me, true);
  const d = me.ab.drone, x0 = d.x, z0 = d.z;
  for (let i = 0; i < 60; i++) { m.ab.droneInput(me, { fwd: true }, 1 / 60); m.step(); }
  const moved = Math.hypot(d.x - x0, d.z - z0);
  assert.ok(moved <= 6.05, op.id + ' (' + op.ability + '): prep drone moved ' + moved.toFixed(2) + ' m in 1 s');
  console.log('PASS ' + op.id + ' (' + op.ability + '): prep drone ' + moved.toFixed(2) + ' m/s');
  n++;
}
console.log(n + ' drone speed checks passed');
