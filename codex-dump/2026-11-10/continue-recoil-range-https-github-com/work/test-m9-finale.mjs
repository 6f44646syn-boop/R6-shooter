import fs from 'node:fs';
const path='tests/run.mjs';let s=fs.readFileSync(path,'utf8');
function edit(a,b){if(!s.includes(a))throw new Error(a);s=s.replace(a,Array.isArray(b)?b.join('\n'):b);}
edit("h.look.setAngles(0, 10); Bt.key('KeyG', true); Bt.key('KeyG', false); });\n      let both",[
 "h.look.setAngles(0, 10); Bt.key('KeyG', true); });",
 '      await run(0.4);',
 '      const following = await B.evaluate(() => { const b = window.__range.battle(); return b.grenadeCam === b.grenadeView.camera; });',
 "      await B.evaluate(() => window.__range.battle().key('KeyG', false));",
 '      await run(0.1);',
 "      check('Battle online: hold follows the confirmed throw and release restores first person', following && await B.evaluate(() => !window.__range.battle().grenadeCam));",
 '      let both']);
edit("      await A.evaluate(() => window.__range.battleLeave());\n      await B.waitForFunction(() => !window.__range.battle().active",[
 '      await A.evaluate(() => {',
 '        const battle = window.__range.battle(), thrower = battle.humans[0].f, target = battle.remotes[0].f;',
 '        target.protectUntil = 0;',
 '        const grenade = battle.nadesB.throw(thrower, 0, 0, battle.t);',
 '        Object.assign(grenade, { x: target.x, y: target.y + 0.65, z: target.z, vx: 0, vy: 0, vz: 0, end: battle.t + 0.25 });',
 '      });',
 '      await run(0.55);',
 '      const nadeReplay = await B.evaluate(() => { const battle = window.__range.battle(); return !!battle.kc?.grenade && battle.grenadeCam === battle.grenadeView.camera; });',
 "      check('Battle online: a grenade death replays the host-confirmed projectile', nadeReplay);",
 '      await A.evaluate(() => window.__range.battleLeave());',
 '      await B.waitForFunction(() => !window.__range.battle().active']);
edit("G.h.look.setAngles(90, -10); G.key('KeyG', true); G.key('KeyG', false); });\n      let flying",[
 "G.h.look.setAngles(90, -10); G.key('KeyG', true); });",
 '      await run(0.4);',
 '      const matchFollow = await B.evaluate(() => { const g = window.__range.modeGame(); return g.camOverride === g.grenadeView.camera; });',
 "      await B.evaluate(() => window.__range.modeGame().key('KeyG', false));",
 '      await run(0.1);',
 "      check('Team Deathmatch online: hold follows the confirmed throw and release restores first person', matchFollow && await B.evaluate(() => { const g = window.__range.modeGame(); return g.camOverride !== g.grenadeView.camera; }));",
 '      let flying']);
edit("      await A.evaluate(() => window.__range.modeGame().stop());\n      await B.waitForFunction(() => !window.__range.modeGame().active",[
 '      await A.evaluate(() => {',
 '        const game = window.__range.modeGame();',
 "        game.m.end(game.me.team, 'test');",
 '      });',
 '      await run(0.2);',
 '      const matchFinale = await B.evaluate(() => {',
 '        const game = window.__range.modeGame();',
 "        const replay = game.hud.end.dataset.finale === 'replay' && !!game.kc?.final;",
 "        game.hud.end.querySelector('.b-finale-replay button').click();",
 "        return { replay, results: game.hud.end.dataset.finale === 'results', rows: game.hud.endTable.children.length,",
 '          lineup: game.finale.lineup.children.length };',
 '      });',
 "      check('Team Deathmatch online: client sees the final kill, winning lineup and host leaderboard', matchFinale.replay && matchFinale.results && matchFinale.rows === 6 && matchFinale.lineup === 3, JSON.stringify(matchFinale));",
 '      await A.evaluate(() => window.__range.modeGame().stop());',
 '      await B.waitForFunction(() => !window.__range.modeGame().active']);
fs.writeFileSync(path,s);

