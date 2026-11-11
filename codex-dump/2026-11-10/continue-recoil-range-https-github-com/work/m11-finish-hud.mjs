import fs from 'node:fs';
function edit(p,pairs){
 let s=fs.readFileSync(p,'utf8');
 for(const [a,b] of pairs){if(!s.includes(a))throw new Error(a);s=s.replace(a,Array.isArray(b)?b.join('\n'):b);}
 fs.writeFileSync(p,s);
}
edit('js/modes/game.js',[
 ['      if (e.type === \'shot\') this._recShot(e);',[
 "      if (e.type === 'shot') {",
 '        this._recShot(e);',
 '        if (this.spectator?.id === e.id && !this.kc) this.kcPuppet?.rig.kick();',
 '      }']],
 ["      view.classList.toggle('mg-drone', !!d);","      view.classList.toggle('mg-drone', !!d);\n      view.classList.toggle('mg-spectating', !!this.spectator);"],
 ['        if (!this.map.sight(eye, [figure.x, figure.y + 1.1 - 0.3 * figure.crouch, figure.z])) hide(figure.group);',[
 '        const torso = [figure.x, figure.y + 1.1 - 0.3 * figure.crouch, figure.z];',
 '        const head = [figure.x, figure.y + 1.55 - 0.45 * figure.crouch, figure.z];',
 '        if (!this.map.sight(eye, torso) && !this.map.sight(eye, head)) hide(figure.group);']],
 ['    const hp = Math.max(0, Math.ceil(me.hp));','    const hp = Math.max(0, Math.ceil((this.spectator || me).hp));'],
 ["    const spectator = this.spectator ? 'Spectating ' + this.spectator.name + ' · Left / right click or 1–5 to switch' : '';",[
 '    const controls = this.deps.controls;',
 "    const spectator = this.spectator ? 'Spectating ' + this.spectator.name + ' · '",
 "      + (controls?.bindingLabel('fire') || 'Left mouse') + ' / ' + (controls?.bindingLabel('ads') || 'Right mouse')",
 "      + ' or 1–5 to switch' : '';"]],
]);
edit('css/style.css',[
 ['.b-lineup-names { margin: 0; font-size: 13px; }',[
 '.b-lineup-names { margin: 0; font-size: 13px; }',
 '',
 '.mg-spectating .b-dead {',
 '  top: auto; bottom: 14%; width: max-content; max-width: calc(100% - 24px);',
 '  white-space: normal; text-align: center; font-size: 14px;',
 '}',
 '.mg-spectating :is(.b-name, .b-ammo, .mg-ability) { visibility: hidden; }']],
]);
edit('tests/run.mjs',[
 ["      } else check('found a soft wall to reinforce from inside', false, 'none');\n      check('no page errors in either session'",[
 "      } else check('found a soft wall to reinforce from inside', false, 'none');",
 '      await A.evaluate(() => {',
 '        const game = window.__range.modeGame();',
 '        const remote = game.m.actors.find(actor => actor.remote !== null && actor.remote !== undefined);',
 '        game.m.kill(remote, game.me);',
 '      });',
 '      await run(0.6);',
 '      const spectating = await B.evaluate(() => {',
 '        const game = window.__range.modeGame();',
 "        game.key('Space', true); game.key('Space', false);",
 '        window.__range.step(0.1, 60); window.__range.renderFrame();',
 '        return !game.me.alive && game.spectator?.team === game.me.team',
 '          && game.spectator?.alive && game.camOverride === game.spectatorCam;',
 '      });',
 "      check('Bomb online: an eliminated player follows a living teammate in first person', spectating);",
 "      check('no page errors in either session'"]],
]);

