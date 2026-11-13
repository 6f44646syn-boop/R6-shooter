import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer(8159);
let browser;
function check(label, condition, detail) {
  assert.ok(condition, label + ' ' + JSON.stringify(detail ?? ''));
  console.log('PASS ' + label);
}
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: {width: 1280, height: 720} });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8159/index.html?test');
  await page.waitForFunction(() => window.__range?.ready);
  await page.locator('[data-first-profile=mouse]').click();

  const battle = await page.evaluate(() => {
    const R = __range;
    R.manual(true);
    R.battleStart({opponent:'bots', bots:2, level:'easy', kills:99, map:'yard'});
    const B = R.battle(), h = B.humans[0], k = B.bots[0].f;
    for (const bot of B.bots) bot.update = () => {};
    R.step(0.1, 60);
    B.key('KeyG', true); R.step(0.1, 60);
    const tap = !B.grenadeCam;                     // a tap throws without the grenade camera
    R.step(0.3, 60);
    const held = tap && B.grenadeCam === B.grenadeView.camera;
    B.key('KeyG', false); R.step(0.05, 60);
    const released = !B.grenadeCam;
    const n = B.nadesB.throw(k, k.yaw, 0, B.t);
    R.step(0.15, 60);
    Object.assign(n, {x:h.f.x, y:h.f.y + 0.65, z:h.f.z, vx:0, vy:0, vz:0, end:B.t + 0.025});
    h.f.protectUntil = 0;
    R.step(0.08, 60);
    const track = B.kc?.grenade;
    const death = !!track && B.grenadeCam === B.grenadeView.camera && !h.f.alive;
    R.step(0.5, 60);
    const blast = !!track && B.grenadeView.marker?.visible && B.grenadeView.marker.position.distanceTo(h.f.group.position) < 1;
    B.key('Space', true); R.step(0.05, 60);
    const skipped = !B.kc && !B.grenadeView.marker?.visible;
    R.battleLeave();
    return {held,released,death,blast,skipped};
  });
  for (const [name, pass] of Object.entries(battle)) check('Battle grenade ' + name, pass, battle);

  for (const mode of ['tdm','ctf','bomb']) {
    const result = await page.evaluate(async mode => {
      const R = __range;
      await R.modeStart(mode, {map:{tdm:'yard',ctf:'yard',bomb:'ranch'},teamSize:2,seed:3,side:'attack'});
      const G = R.modeGame(), m = G.m, me = G.me, foe = m.actors.find(a => a.team !== me.team);
      for (const actor of m.actors) actor.brain = null;
      if (mode === 'bomb') m.rules.phase = 'action';
      me.protectUntil = foe.protectUntil = 0;
      R.step(0.12,60);
      G.key('KeyG',true); R.step(0.4,60);
      const held = G.camOverride === G.grenadeView.camera;
      G.key('KeyG',false); R.step(0.05,60);
      const released = G.camOverride !== G.grenadeView.camera;
      // Put the thrown projectile beside the enemy and let the simulation detonate it.
      const n = m.nades.live.find(nade => nade.owner === me.id);
      Object.assign(n,{x:foe.x,y:foe.y+0.65,z:foe.z,vx:0,vy:0,vz:0,end:m.t+0.025});
      R.step(0.10,60);
      const attributed = !foe.alive && !!G.lastKill?.grenade && G.lastKill.by === me.id;
      m.end(me.team, 'test');
      R.step(0.05,60); R.renderFrame();
      const replay = G.hud.end.dataset.finale === 'replay' && G.kc?.by === me.id && G.camOverride === G.kcCam && !!G.kcPuppet;
      const clone = G.finale.lineup.children.length;
      R.step(3,60); R.step(9,60); R.renderFrame();   // (the replay, then the win flex: an inspect of at most 8 s)
      const results = G.hud.end.dataset.finale === 'results' && !G.kc && !G.grenadeView.marker?.visible;
      const leaderboard = G.hud.endTable.children.length === m.actors.length;
      return {held,released,attributed,replay,results,leaderboard,clone,expected:m.actors.filter(a=>a.team===me.team).length};
    }, mode);
    for (const name of ['held','released','attributed','replay','results','leaderboard']) check(mode + ' ' + name, result[name], result);
    check(mode + ' winning lineup has the team', result.clone === result.expected, result);
  }
  if (process.env.FINALE_QA) await page.screenshot({path: process.env.FINALE_QA});

  const normalFinale = await page.evaluate(() => {
    const R = __range;
    R.battleLeave();
    R.battleStart({opponent:'bots', bots:2, level:'easy', kills:99, map:'yard'});
    const B = R.battle(), h = B.humans[0], k = B.bots[0].f;
    for (const bot of B.bots) bot.update = () => {};
    R.step(0.3,60);
    B.opts.killsToWin = 1;
    k.fired = true; k.ads = 1; k.lean = 1;
    h.f.protectUntil = 0;
    B._damage(h.f, 200, k, 'head', B.t);
    R.step(0.1,60); R.renderFrame();
    const replay = B.hud.end.dataset.finale === 'replay' && B.kc?.killer === k && !!B.puppet;
    const lineup = B.finale.lineup.children.length;
    const rows = B.hud.endTable.children.length;
    B.hud.end.querySelector('.b-finale-replay button').click();
    R.step(0.05,60); R.renderFrame();
    const skipped = B.hud.end.dataset.finale === 'results' && !B.kc;
    R.battleLeave();
    const reset = !B.finale.active && B.finale.lineup.children.length === 0;
    return {replay,lineup,rows,skipped,reset};
  });
  check('Battle final kill, winner lineup and leaderboard', normalFinale.replay && normalFinale.lineup === 2 && normalFinale.rows === 3, normalFinale);
  check('Battle can skip finale and leave cleanly', normalFinale.skipped && normalFinale.reset, normalFinale);
  const draw = await page.evaluate(async () => {
    const R = __range;
    await R.modeStart('ctf', {teamSize:2,seed:3});
    const G = R.modeGame();
    for (const a of G.m.actors) a.brain = null;
    G.m.end('draw','time');
    R.step(0.1,60); R.renderFrame();
    return G.hud.endTitle.textContent === 'Draw' && G.hud.end.dataset.finale === 'results' && G.finale.lineup.children.length === G.m.actors.length;
  });
  check('Draw with no kills shows lineup and scores immediately', draw);
  // Endless: a wave every 4 kills (one more bot, tougher), three lives, the run ends and is logged.
  const endless = await page.evaluate(() => {
    const R = __range;
    R.battleLeave();
    R.battleStart({opponent:'bots', bots:1, level:'easy', kills:99, map:'yard'});
    const B = R.battle(), h = B.humans[0];
    B.start({ ...B.opts, endless: true, p1Gun: h.gun });
    const me = B.humans[0].f, start = { bots: B.bots.length, level: B.bots[0].level, wave: B.endless.wave };
    R.step(0.1, 60);
    for (let i = 0; i < 8; i++) B._endlessKill(me, B.bots[0].f, B.t);
    const after = { bots: B.bots.length, level: B.bots[0].level, wave: B.endless.wave, inScene: B.bots.every((b) => b.f.group.parent) };
    for (let i = 0; i < 3; i++) B._endlessKill(B.bots[0].f, me, B.t);
    return { start, after, over: B.over, title: B.hud.endTitle.textContent, score: B.hud.score.textContent };
  });
  check('Endless: waves add bots and toughen them, three lives end the run', endless.start.bots === 1 && endless.start.level === 'easy' && endless.after.wave === 3 && endless.after.bots === 3 && endless.after.level === 'medium' && endless.after.inScene && endless.over && /Run over: 8 kills, wave 3/.test(endless.title), endless);
  // MVP card: your best stat of the match on the results.
  const mvp = await page.evaluate(() => {
    const R = __range;
    R.battleLeave();
    R.battleStart({opponent:'bots', bots:1, level:'easy', kills:99, map:'yard'});
    const B = R.battle(), me = B.humans[0].f, g = B.bots[0].f;
    for (const bot of B.bots) bot.update = () => {};
    R.step(0.1, 60);
    me.protectUntil = g.protectUntil = 0;
    g.x = me.x + 30; g.z = me.z;
    B._damage(g, 500, me, 'body', B.t);
    g.alive = true; g.health = 100; g.protectUntil = 0;
    B._damage(g, 500, me, 'head', B.t + 0.4);
    B._end('p1', me);
    const card = B.hud.end.querySelector('.mvp-card');
    return { card: card?.textContent || '', kills: B.mvp.kills, double: B.mvp.double, longest: Math.round(B.mvp.longest) };
  });
  check('MVP card shows your standout stat (fastest double here)', mvp.kills === 2 && Math.abs(mvp.double - 0.4) < 1e-6 && mvp.longest === 30 && /Fastest double/.test(mvp.card) && /0\.40 s/.test(mvp.card), mvp);
  // Match presets: save a lobby on the options page, start it from the mode page in one click.
  const preset = await page.evaluate(async () => {
    const R = __range, $ = (id) => document.getElementById(id);
    R.battleLeave();
    document.querySelector('.mode-card[data-mode=bots]').click();
    $('b-bots').value = '3'; $('b-bots').dispatchEvent(new Event('change', { bubbles: true }));
    $('preset-name').value = 'Three bots'; $('preset-save').click();
    $('setup-back').click();
    const btn = [...document.querySelectorAll('#presets .preset button.primary')].find((b) => /Three bots/.test(b.textContent));
    R.battleStart({ bots: 1 }); R.battleLeave();      // something else in between
    btn.click();
    await new Promise((r) => setTimeout(r, 300));
    return { found: !!btn, active: R.battle()?.active, bots: R.battle()?.bots.length };
  });
  check('a saved preset starts its match in one click', preset.found && preset.active && preset.bots === 3, preset);
  check('No page errors', errors.length === 0, errors);
} finally {
  await browser?.close();
  server.close();
}
