// Bomb bot report (dev only): plays bot-only Bomb matches and explains the result, so bot
// tactics can be tuned against numbers rather than guesses.
//   node tools/bomb-ai-report.mjs [matches per map = 6] [maps = ranch,embassy,workshop] [difficulty = normal]
// For each map: round wins by side and how rounds ended, plants, the first kill of a round,
// and every kill: the killer's and the victim's side, role and state (holding a spot, moving,
// crouched), whether the victim was looking at the killer, and how far from the site it died.
import { readFileSync } from 'node:fs';
import { MatchMap } from '../js/modes/map.js';
import { Match, TICK } from '../js/modes/sim.js';
import { initCore } from '../js/wasm/core.js';

await initCore();
const root = new URL('../', import.meta.url), json = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const guns = json('data/guns.json').guns, ops = json('data/ops.json'), abilities = json('data/abilities.json');
const N = +(process.argv[2] || 6);
const MAPS = (process.argv[3] || 'ranch,embassy,workshop').split(',');
const DIFF = process.argv[4] || 'normal';
const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '-');
const total = { att: 0, def: 0 };
for (const id of MAPS) {
  const data = json('data/maps/' + id + '.json');
  const R = { att: 0, def: 0, reasons: {}, plants: 0, defused: 0, firstAtt: 0, first: 0, kills: [], ms: 0, worst: 0 };
  for (let s = 1; s <= N; s++) {
    const m = new Match({ map: new MatchMap(data), mode: 'bomb', guns, ops, abilities, seed: s * 7, human: null, teamSize: 5, difficulty: DIFF, abilitiesOn: true });
    let first = false, roundStart = 0;
    while (!m.over && m.tick < 7 * 260 / TICK) {
      const t0 = performance.now();
      m.step();
      const dt = performance.now() - t0; R.ms += dt; if (dt > R.worst) R.worst = dt;
      for (const e of m.events) {
        if (e.type === 'round') { first = false; roundStart = m.t; }
        else if (e.type === 'msg' && /planted/i.test(e.text)) R.plants++;
        else if (e.type === 'msg' && /defused/i.test(e.text)) R.defused++;
        else if (e.type === 'kill') {
          const v = m.actors.find((a) => a.id === e.id), k = m.actors.find((a) => a.id === e.by);
          if (!v) continue;
          const vAtt = m.rules.isAttacker(v);
          if (!first) { first = true; R.first++; if (!vAtt) R.firstAtt++; }
          const site = m.rules.bomb.site || m.rules.target || m.rules.sites[0];
          const st = (a) => (!a ? '?' : !a.brain ? 'human' : a.brain.holding ? 'holding' : Math.hypot(a.vx, a.vz) > 0.5 ? 'moving' : 'still') + (a && a.crouch > 0.5 ? '+crouch' : '');
          R.kills.push({
            vAtt, vRole: v.role, kRole: k && k.role, vState: st(v), kState: st(k),
            vSaw: !!(v.brain && v.brain.target === k), vDist: Math.round(Math.hypot(v.x - site.x, v.z - site.z)),
            t: Math.round(m.t - roundStart), kind: e.kind,
          });
        }
      }
      m.events.length = 0;
    }
    for (const r of m.rules.rounds) { if (r.side === 'attack') R.att++; else R.def++; R.reasons[r.side + ':' + r.reason] = (R.reasons[r.side + ':' + r.reason] || 0) + 1; }
    m.map.dispose();
  }
  total.att += R.att; total.def += R.def;
  const K = R.kills, dK = K.filter((k) => !k.vAtt), aK = K.filter((k) => k.vAtt);
  const by = (arr, f) => { const o = {}; for (const x of arr) { const key = f(x); o[key] = (o[key] || 0) + 1; } return Object.entries(o).sort((p, q) => q[1] - p[1]).map(([a, b]) => a + ' ' + b).join(', '); };
  console.log(`\n${id}: defenders win ${R.def}/${R.att + R.def} (${pct(R.def, R.att + R.def)}); plants ${R.plants}, defused ${R.defused}; first kill by attackers ${pct(R.firstAtt, R.first)}`);
  console.log('  rounds end: ' + Object.entries(R.reasons).map(([a, b]) => a + ' ' + b).join(', '));
  console.log(`  defenders died ${dK.length}, attackers died ${aK.length} (trade ${(aK.length / Math.max(1, dK.length)).toFixed(2)} attackers per defender)`);
  console.log('  defender deaths by role: ' + by(dK, (k) => k.vRole));
  console.log('  defender deaths by state: ' + by(dK, (k) => k.vState) + '; was looking at the killer ' + pct(dK.filter((k) => k.vSaw).length, dK.length));
  console.log('  defender deaths by distance from site: ' + by(dK, (k) => (k.vDist < 6 ? 'on site' : k.vDist < 14 ? 'near' : 'far')));
  console.log('  defender deaths by time from round start: ' + by(dK, (k) => (k.t < 30 ? 'prep (<30 s)' : k.t < 45 ? 'first 15 s of action' : k.t < 90 ? 'mid' : 'late')));
  console.log('  defender deaths by cause: ' + by(dK, (k) => k.kind || 'gun') + '; attacker deaths by cause: ' + by(aK, (k) => k.kind || 'gun'));
  console.log('  killers of defenders by state: ' + by(dK, (k) => k.kState) + '; by role: ' + by(dK, (k) => k.kRole));
  console.log('  attacker deaths by state: ' + by(aK, (k) => k.vState) + '; killers (defenders) by state: ' + by(aK, (k) => k.kState) + '; by role: ' + by(aK, (k) => k.kRole));
  console.log(`  sim: ${(R.ms / 1000).toFixed(1)} s, worst step ${R.worst.toFixed(2)} ms`);
}
console.log(`\nall maps: defenders win ${total.def}/${total.att + total.def} (${pct(total.def, total.att + total.def)})`);
