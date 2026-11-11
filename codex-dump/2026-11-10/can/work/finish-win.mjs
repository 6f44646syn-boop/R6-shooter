import fs from 'node:fs';const root=process.argv[2];
function edit(path, changes) {
  const p=root+'/'+path;
  let s=fs.readFileSync(p,'utf8');
  for(const [a,b] of changes) { if(!s.includes(a)) throw new Error(path+' '+a); s=s.replace(a,b); }
  fs.writeFileSync(p,s);
}
edit('js/replay/finale.js',[
  ['    const aspect = width / height;', '    const lineupHeight = Math.max(1, Math.floor(height * 0.51));\n    const aspect = width / lineupHeight;'],
  ['this.camera.position.set(0, 1.45, distance);\n    this.camera.lookAt(0, 0.19, 0);','this.camera.position.set(0, 1.35, distance);\n    this.camera.lookAt(0, 0.93, 0);'],
  ['    renderer.clear();\n    renderer.render(this.scene, this.camera);','    renderer.clear();\n    renderer.setViewport(0, height - lineupHeight, width, lineupHeight);\n    renderer.render(this.scene, this.camera);\n    renderer.setViewport(0, 0, width, height);'],
]);
edit('css/style.css',[
  ['.b-row { display: grid; grid-template-columns: 1fr auto auto; gap: 16px; }','.b-row { display: grid; grid-template-columns: minmax(0, 1fr) 76px 76px; gap: 12px; }\n.b-row > .b-name { position: static; overflow-wrap: anywhere; }\n.b-row > :nth-child(n+2) { text-align: right; }'],
  ['.b-end[data-finale="replay"] {', '.battle-hud:has(> .b-end[data-finale]:not([hidden])) > :not(.b-end) { visibility: hidden; }\n.b-end[data-finale="replay"] {'],
]);
edit('js/replay/grenade.js',[
  ['  sample(live, t) {\n    const active', '  sample(live, t) {\n    if (!live.length && !this.tracks.size) return;\n    const active'],
]);
edit('js/modes/game.js',[
  ['this.rec.shots.push({ t: this.m.t, id: e.id','this.rec.shots.push({ t: e.t ?? this.m.t, id: e.id'],
  ['const deathT = this.m.t;','const deathT = event.t ?? this.m.t;'],
  ['frames: frames.filter(frame => frame.t >= from - 1 / 30), shots: shots.filter(shot => shot.t >= from)','frames: frames.filter(frame => frame.t >= from - 1 / 30 && frame.t <= deathT + 1 / 30),\n        shots: shots.filter(shot => shot.t >= from && shot.t <= deathT)'],
  ['    const replayable = clip && (clip.grenade || clip.rec.frames.length);\n    this.kc = replayable ? { ...clip, final: true,','    const replayable = clip?.rec.frames.length;\n    this.kc = replayable ? { ...clip, grenade: null, final: true,'],
  ['const seconds = replayable ? clip.grenade ? this.grenadeView.duration(clip.grenade) + 1 : clip.deathT - clip.from + 0.3 : 0;', 'const seconds = replayable ? clip.deathT - clip.from + 0.3 : 0;'],
]);
edit('js/battle/battle.js',[
  ['this._end(by.team, by, grenade);','this._end(by.team, by);'],
  ['  _end(team, killer = null, grenade = null) {','  _end(team, killer = null) {'],
  ['this._showEnd(title, rows, true, team, this.t, killer, grenade);','this._showEnd(title, rows, true, team, this.t, killer);'],
  ['_showEnd(title, rows, canRestart, team, t, killer, grenade)', '_showEnd(title, rows, canRestart, team, t, killer)'],
  ['this._startKillCam(t, killer, grenade);','this._startKillCam(t, killer);'],
  ['_startKillCam(t, finalKiller = null, finalGrenade = null)', '_startKillCam(t, finalKiller = null)'],
  ['const grenade = finalKiller ? finalGrenade : this.grenadeDeath;', 'const grenade = finalKiller ? null : this.grenadeDeath;'],
]);
edit('tests/finale-browser.mjs',[
  ["G.camOverride === G.grenadeView.camera;\n      const clone","G.camOverride === G.kcCam && !!G.kcPuppet;\n      const clone"],
  ["  const normalFinale = await page.evaluate(() => {\n    const R = __range;", "  const normalFinale = await page.evaluate(() => {\n    const R = __range;\n    R.battleLeave();"],
]);
edit('tests/run.mjs',[
  ['      await A.evaluate(() => window.__range.battleLeave());\n      await run(0.3);',`      await A.evaluate(() => {
        const battle = window.__range.battle(), host = battle.humans[0].f, bot = battle.bots[0].f;
        battle.opts.killsToWin = battle.teamScore[host.team] + 1;
        bot.protectUntil = 0;
        battle._damage(bot, 500, host, 'head', battle.t);
      });
      await B.waitForFunction(() => window.__range.battle().hud.end.dataset.finale === 'replay');
      const finale = await B.evaluate(() => {
        const battle = window.__range.battle();
        const killer = battle.kc?.killer.name;
        battle.hud.end.querySelector('.b-finale-replay button').click();
        return { killer, results: battle.hud.end.dataset.finale === 'results',
          rows: battle.hud.endTable.children.length, lineup: battle.finale.lineup.children.length };
      });
      check('network Battle sends the final kill, winning lineup and leaderboard', finale.killer === 'Host' && finale.results && finale.rows === 3 && finale.lineup === 1, JSON.stringify(finale));
      await A.evaluate(() => window.__range.battleLeave());
      await run(0.3);`],
]);
