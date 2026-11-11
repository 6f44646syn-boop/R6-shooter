import fs from 'node:fs';
const p='tests/run.mjs';
let s=fs.readFileSync(p,'utf8');
const a="      check('a grenade thrown on the player\\'s PC flies on the host and both see it', flying >= 1, 'flying ' + flying + ', effects ' + booms);";
if(!s.includes(a))throw new Error('missing network fixture');
s=s.replace(a,a+'\n'+[
 '      await A.evaluate(pid => {',
 '        const m = window.__range.modeGame().m, target = m.actors.find(actor => actor.id === pid);',
 '        const thrower = m.actors.find(actor => actor.alive && actor.team !== target.team);',
 '        target.protectUntil = 0;',
 '        thrower.nades = 2; thrower.nadeAt = 0;',
 '        const nade = m.nades.throw(thrower, 0, 0);',
 '        Object.assign(nade, { x: target.x, y: target.y + 0.65, z: target.z, vx: 0, vy: 0, vz: 0, end: m.t + 0.35 });',
 '      }, ids.pl);',
 '      await run(1);',
 '      const matchDeath = await B.evaluate(() => { const g = window.__range.modeGame(); return !!g.kc?.grenade && g.camOverride === g.grenadeView.camera; });',
 "      check('Team Deathmatch online: a grenade death follows the host-confirmed trajectory', matchDeath);",
].join('\n'));
fs.writeFileSync(p,s);

