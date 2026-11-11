import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer(8165);
let browser;
function check(label, value, detail = '') { assert.ok(value, label + ' ' + JSON.stringify(detail)); console.log('PASS ' + label); }

try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
  const pages = await Promise.all(Array.from({length:3}, async () => (await browser.newContext()).newPage()));
  const [host, player, watcher] = pages;
  const errors = [];
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8165/index.html?test');
    await page.waitForFunction(() => window.__range?.ready);
    await page.locator('[data-first-profile=mouse]').click();
    await page.evaluate(() => document.querySelector('.mode-card[data-mode=net]').click());
    await page.click('#net-via-lan');
  }
  await host.click('#net-host');
  await watcher.selectOption('#net-watch', 'spectator');
  for (const peer of [player, watcher]) {
    await peer.click('#net-join');
    await peer.waitForFunction(() => document.getElementById('net-out-j').value.startsWith('RR1-'));
    await host.fill('#net-in-h', await peer.inputValue('#net-out-j'));
    const oldCode = await host.inputValue('#net-out-h');
    await host.click('#net-accept');
    await host.waitForFunction(old => { const code = document.getElementById('net-out-h').value; return code.startsWith('RR1-') && code !== old; }, oldCode);
    await peer.fill('#net-in-j', await host.inputValue('#net-out-h'));
    await peer.click('#net-connect');
    await peer.waitForFunction(() => /Connected/.test(document.getElementById('net-status').textContent));
    await host.waitForFunction(() => document.getElementById('net-reply-box').hidden);
  }
  await host.waitForFunction(() => /spectator/.test(document.getElementById('net-players').textContent));
  await host.evaluate(() => {
    __range.manual(true);
    __range.modePrefs({teamSize:2,difficulty:'easy',prepTime:60,abilities:{bomb:false},side:'attack'});
    __range.netGame('bomb');
    document.getElementById('net-ranked').checked = true;
    __range.battleStart({opponent:'net',bots:0});
  });
  await Promise.all([player, watcher].map(p => p.waitForFunction(() => __range.modeGame()?.active)));
  for (const page of pages) await page.evaluate(() => { __range.manual(true); document.getElementById('menu').hidden = true; });
  async function tick(n = 8) {
    for (let i = 0; i < n; i++) {
      for (const page of pages) await page.evaluate(() => __range.step(0.05, 60));
      await new Promise(r => setTimeout(r, 12));
    }
  }
  await tick(12);
  const settings = await host.evaluate(() => {
    const g = __range.modeGame();
    return {prep:g.m.o.prepTime,level:g.m.o.difficulty,abilities:g.m.o.abilitiesOn,humans:g.m.actors.filter(a=>a.human).length};
  });
  check('ranked Bomb uses fixed settings and the watcher occupies no player slot', settings.prep === 30 && settings.level === 'normal' && settings.abilities && settings.humans === 2, settings);

  await host.evaluate(() => {
    const g = __range.modeGame();
    for (const actor of g.m.actors) actor.brain = null;
    g.map.world.sight = () => false;
    g.m.bb[g.me.team].seen.set(99,{id:99,x:3,z:-5,t:g.m.t});
  });
  await tick(5);
  const watching = await watcher.evaluate(() => {
    const g = __range.modeGame(), initial = g.watch.camera.position.toArray();
    const original = g.netClient.link.send;
    const sent = [];
    g.netClient.link.send = msg => sent.push(msg.k);
    const following = g.viewOnly && g.spectator?.alive && g.spectator.team === g.me.team;
    const safe = g.m.actors.filter(a=>a.team !== g.me.team).every(a=>!a.alive) && g.watchMarks.some(m=>m.id===99 && m.x===3);
    g.key('KeyV', true); g.key('KeyW', true); g.key('ShiftLeft', true);
    __range.step(0.2,60); g.key('KeyW',false); g.key('ShiftLeft',false);
    const flown = g.watch.mode === 'free' && g.camOverride === g.watch.camera && g.watch.camera.position.toArray().some((v,i)=>v!==initial[i]);
    g.key('KeyM', true); __range.step(0.1,60); __range.renderFrame();
    const map = g.watch.mode === 'map' && !g.watch.map.hidden && g.watch.map.getContext('2d').getImageData(0,0,1,1).data[3] === 255;
    g.mouseButton(0,true); g.key('KeyG',true); __range.step(0.1,60);
    g.netClient.link.send = original;
    return {following,safe,flown,map,sent};
  });
  check('watcher follows a teammate and sees only the filtered feed and team sightings', watching.following && watching.safe, watching);
  check('watcher can fly and open the overhead map without sending gameplay input', watching.flown && watching.map && watching.sent.length === 0, watching);

  await host.evaluate(() => {
    const m = __range.modeGame().m;
    m.rules.rounds = [{round:1,winner:'A',reason:'test'},{round:2,winner:'A',reason:'test'}];
    m.rules.score.A = 2;
    m.end('A', 'test');
  });
  await tick(10);
  await Promise.all([host, player].map(page => page.waitForFunction(() => __range.profile().rankedHistory.length === 1)));
  const ranks = await Promise.all(pages.map(page => page.evaluate(() => ({
    rating:__range.profile().rating, history:__range.profile().rankedHistory, finale:__range.modeGame().over,
  }))));
  check('host and player apply the same signed match once and the watcher stays unrated',
    ranks[0].rating === 1016 && ranks[1].rating === 984 && ranks[2].rating === 1000
      && ranks[0].history[0].id === ranks[1].history[0].id && ranks[2].history.length === 0 && ranks.every(r=>r.finale), ranks);

  async function stopMatch() {
    await host.evaluate(() => __range.modeGame().stop());
    await Promise.all([player, watcher].map(page => page.waitForFunction(() => !__range.modeGame().active)));
  }
  const rounds = [{round:1,winner:'A',reason:'test'},{round:2,winner:'B',reason:'test'}];
  for (const early of [true, false]) {
    await stopMatch();
    await host.evaluate(() => __range.battleStart({opponent:'net',bots:0}));
    await Promise.all(pages.map(page => page.waitForFunction(() => __range.modeGame()?.active)));
    if (!early) await host.evaluate(rounds => { __range.modeGame().m.rules.rounds = rounds; }, rounds);
    await player.evaluate(() => __range.modeGame().stop());
    await host.waitForFunction(() => __range.modeGame().rankedHost.left.size === 1);
    assert.equal(await host.evaluate(() => __range.modeGame().rankedHost.early), early);
    await host.evaluate(rounds => {
      const g = __range.modeGame();
      g.m.rules.rounds = rounds;
      g.m.end('B', 'test');
    }, rounds);
    await tick(10);
    if (early) {
      check('first-round departure voids the rating', await host.evaluate(() => __range.profile().rankedHistory.length === 1)
        && await player.evaluate(() => __range.profile().rankedHistory.length === 1));
    } else {
      await player.waitForFunction(() => __range.profile().rankedHistory.length === 2);
      const afterLeave = await player.evaluate(() => ({ rating:__range.profile().rating, outcome:__range.profile().rankedHistory[0].outcome }));
      check('departed player takes a rated loss even if their side wins', afterLeave.rating < ranks[1].rating && afterLeave.outcome === 'loss', afterLeave);
    }
  }
  await stopMatch();
  for (const mode of ['tdm', 'ctf']) {
    await host.evaluate(mode => { __range.netGame(mode); __range.battleStart({opponent:'net',bots:0}); }, mode);
    await Promise.all(pages.map(page => page.waitForFunction(mode => __range.modeGame()?.active && __range.modeGame().opts.mode === mode, mode)));
    await tick(5);
    check(mode.toUpperCase() + ' uses the team spectator feed', await watcher.evaluate(() => {
      const g = __range.modeGame();
      return g.viewOnly && g.spectator?.alive && g.spectator.team === g.me.team;
    }));
    await stopMatch();
  }
  await host.evaluate(() => { __range.netGame('battle'); __range.battleStart({opponent:'net',bots:1}); });
  await Promise.all([player,watcher].map(page => page.waitForFunction(() => __range.battle()?.active)));
  for (const page of pages) await page.evaluate(() => { __range.manual(true); document.getElementById('menu').hidden = true; });
  await tick(8);
  const battle = await watcher.evaluate(() => {
    const b = __range.battle();
    const following = b.viewOnly && !!b.watchFocus && b.fighters.length === 3;
    b.key('KeyV',true); __range.step(0.1,60);
    const free = b.watchCam === b.watch.camera;
    b.key('KeyM',true); __range.step(0.1,60); __range.renderFrame();
    return {following,free,map:!b.watch.map.hidden};
  });
  check('Battle supports a separate follow, free camera and overhead spectator slot', battle.following && battle.free && battle.map, battle);
  check('no page errors', errors.length === 0, errors);
} finally {
  await browser?.close();
  server.close();
}
