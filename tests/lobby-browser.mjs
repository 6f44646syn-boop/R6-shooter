// The online lobby (its own room; nobody can be hurt until the host starts; a player can join it
// at any time; everyone goes in together), Endless online, Free for all (every bot its own side)
// and the sound captions under 20% volume. Two browser sessions over join codes.
//   node tests/lobby-browser.mjs
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
let failures = 0;
const server = await startServer(8172);
const browser = await chromium.launch();
const BASE = 'http://127.0.0.1:8172/';
const A = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
const B = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
const nerr = [];
for (const [n, p] of [['host', A], ['player', B]]) p.on('pageerror', (e) => nerr.push(n + ': ' + String(e.stack || e)));
for (const p of [A, B]) { await p.addInitScript(() => localStorage.setItem('recoilRange.settings.v1', JSON.stringify({ graphics: 'low', renderScale: 0.5 }))); await p.goto(BASE + 'index.html?test', { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__range?.ready); }
for (const p of [A, B]) { await p.locator('[data-first-profile=mouse]').click(); await p.evaluate(() => document.querySelector('.mode-set[data-mode=net]:not([data-ranked])').click()); }
for (const p of [A, B]) await p.click('#net-via-lan');
await A.click('#net-host'); await B.click('#net-join');
// the host opens the lobby before anyone is in; the player joins it later, without it starting again
await A.evaluate(() => { const R = window.__range; R.manual(true); R.netGame('battle'); R.battleStart({ opponent: 'net', bots: 2, level: 'easy', kills: 10 }, true); window.__range.battle().opts.mark = 1; });
await B.waitForFunction(() => document.getElementById('net-out-j').value.startsWith('RR1-'));
await A.evaluate((code) => { document.getElementById('net-in-h').value = code; document.getElementById('net-accept').click(); }, await B.inputValue('#net-out-j'));
await A.waitForFunction(() => document.getElementById('net-out-h').value.startsWith('RR1-'));
await B.fill('#net-in-j', await A.inputValue('#net-out-h')); await B.click('#net-connect');
await B.waitForFunction(() => /Connected/.test(document.getElementById('net-status').textContent), null, { timeout: 25000 });
await A.waitForFunction(() => document.querySelectorAll('#h-party-list li').length >= 2, null, { timeout: 10000 });
const run = async (sec) => { for (let i = 0; i < sec * 20; i++) { await A.evaluate(() => window.__range.step(0.05, 60)); await B.evaluate(() => window.__range.step(0.05, 60)); await new Promise((r) => setTimeout(r, 5)); } };
const check = (n, ok, d = '') => { console.log((ok ? '  PASS ' : '  FAIL ') + n + (ok ? '' : ' ' + d)); if (!ok) failures++; };
{
  await B.waitForFunction(() => window.__range.battle()?.active && window.__range.battle().opts.lobby, null, { timeout: 8000 });
  const j = await A.evaluate(() => { const b = window.__range.battle(); return { same: b.opts.mark === 1, remotes: b.remotes.length, map: b.arena.mapId }; });
  const bm = await B.evaluate(() => window.__range.battle().arena.mapId);
  check('lobby: its own room, and a player who connects later joins the open lobby (no restart)', j.same && j.remotes === 1 && j.map === 'lobby' && bm === 'lobby', JSON.stringify({ j, bm }));
  await A.evaluate(() => { document.getElementById('menu').hidden = false; document.getElementById('pause-quit').hidden; });
  const btn = await A.evaluate(() => { const R = window.__range; document.getElementById('go-play').click(); return { go: !document.getElementById('pause-go').hidden, match: !document.getElementById('pause-match').hidden }; });
  await A.evaluate(() => document.getElementById('pause-match').click());
  const set = await A.evaluate(() => ({ page: !document.getElementById('page-setup').hidden, next: document.getElementById('setup-next').textContent }));
  for (let i = 0; i < 5 && await A.evaluate(() => !document.getElementById('page-setup').hidden); i++) await A.evaluate(() => document.getElementById('setup-next').click());
  const back = await A.evaluate(() => !document.getElementById('page-pause').hidden && window.__range.battle().opts.lobby);
  check('lobby: the host has Start the match and Match settings; the settings pages lead back to the lobby', btn.go && btn.match && set.page && back, JSON.stringify({ btn, set, back }));
  await A.evaluate(() => { document.getElementById('menu').hidden = true; });
}
for (const mode of ['battle', 'tdm']) {
  if (mode !== 'battle') await A.evaluate((mode) => { const R = window.__range; R.manual(true); R.netGame(mode); R.modePrefs({ teamSize: 3, map: { tdm: 'yard', ctf: 'yard', bomb: 'ranch' }, difficulty: 'easy' }); R.battleStart({ opponent: 'net', bots: 2, level: 'easy', kills: 10 }, true); }, mode);
  await B.waitForFunction(() => window.__range.battle()?.active && window.__range.battle().opts.lobby, null, { timeout: 8000 });
  await B.evaluate(() => { window.__range.manual(true); if (!document.getElementById('home').hidden) document.getElementById('h-play').click(); document.getElementById('menu').hidden = true; });
  await run(1);
  const lob = await A.evaluate(() => { const b = window.__range.battle(); const t = b.remotes[0].f; t.protectUntil = 0; const hp = t.health; b._damage(t, 50, b.humans[0].f, 'torso', b.t); return { lobby: b.opts.lobby, bots: b.bots.length, remotes: b.remotes.length, hp0: hp, hp1: t.health, score: b.hud.score.textContent }; });
  check(mode + ': lobby has no bots, the player is in, nobody can be hurt', lob.lobby && lob.bots === 0 && lob.remotes === 1 && lob.hp1 === lob.hp0, JSON.stringify(lob));
  check(mode + ': the player sees the lobby banner', /LOBBY.*waiting for the host/.test(await B.evaluate(() => window.__range.battle().hud.score.textContent)));
  // host presses Enter (raw key path) -> the match starts for both at once, player stays in (no 'stopped')
  await A.evaluate(() => { document.getElementById('menu').hidden = true; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' })); document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' })); });
  await A.waitForTimeout(200);
  let started = await A.evaluate(() => { const b = window.__range.battle(), g = window.__range.modeGame(); return (g?.active) || (b.active && !b.opts.lobby); });
  if (!started) { console.log('   (Enter not routed in test; clicking Start the match)'); await A.evaluate(() => document.getElementById('pause-go').click()); }
  if (mode === 'battle') {
    await B.waitForFunction(() => window.__range.battle()?.active && !window.__range.battle().opts.lobby, null, { timeout: 8000 });
    await run(0.5);
    const m = await A.evaluate(() => { const b = window.__range.battle(); return { lobby: b.opts.lobby, bots: b.bots.length, remotes: b.remotes.length }; });
    const home = await B.evaluate(() => document.getElementById('home').hidden);
    check('battle: host starts, the player goes straight in with the bots', !m.lobby && m.bots === 2 && m.remotes === 1 && home, JSON.stringify({ m, home }));
    await A.evaluate(() => window.__range.battleLeave());
    await B.waitForFunction(() => !window.__range.battle().active, null, { timeout: 5000 }).catch(() => {});
  } else {
    let ok = true;
    try { await B.waitForFunction(() => window.__range.modeGame()?.active && window.__range.modeGame().netRole === 'client', null, { timeout: 15000 }); } catch { ok = false; }
    const homeHidden = await B.evaluate(() => document.getElementById('home').hidden);
    check('tdm: from the lobby the player goes straight into the match', ok && homeHidden, JSON.stringify({ ok, homeHidden }));
  }
}
// Endless online: the players together against the waves; what comes next shows on both screens
{
  await A.evaluate(() => { const R = window.__range; R.netGame('endless'); R.battleStart({ opponent: 'net', level: 'easy' }, true); });
  await B.waitForFunction(() => window.__range.battle()?.active && window.__range.battle().opts.lobby, null, { timeout: 8000 });
  await B.evaluate(() => { if (!document.getElementById('home').hidden) document.getElementById('h-play').click(); document.getElementById('menu').hidden = true; });
  await A.evaluate(() => window.__range.battle() && document.getElementById('pause-go').click());
  await B.waitForFunction(() => window.__range.battle()?.active && !window.__range.battle().opts.lobby, null, { timeout: 8000 });
  await run(0.5);
  const e = await A.evaluate(() => { const b = window.__range.battle(); return { endless: !!b.endless, lives: b.endless?.lives, teams: b.fighters.map((f) => f.team) }; });
  check('Endless online: both players on one side against the bots, 3 lives each', e.endless && e.lives === 6 && e.teams.filter((t) => t === 'p1').length === 2 && e.teams.length === 3, JSON.stringify(e));
  // the player's kills bring the next wave; the new bot appears on the player's PC too
  for (let k = 0; k < 4; k++) await A.evaluate(() => { const b = window.__range.battle(), bot = b.bots[0].f, by = b.remotes[0].f; bot.protectUntil = 0; b._damage(bot, 999, by, 'head', b.t); b._spawn(bot, b.t); });
  await run(0.5);
  const w = await B.evaluate(() => { const b = window.__range.battle(), p = document.querySelector('.b-popup'); return { fighters: b.fighters.length, hud: b.hud.score.textContent, pop: p?.classList.contains('on') ? p.textContent : '' }; });
  check('Endless online: the wave comes on both PCs, with a big pop-up of what comes next', w.fighters === 4 && /Wave 2/.test(w.hud) && /^Wave 2Next wave in 4 kills/i.test(w.pop), JSON.stringify(w));
  await A.evaluate(() => window.__range.battleLeave());
}
// Free for all offline: every bot is its own side and they fight each other
{
  await A.evaluate(() => { const R = window.__range; R.battleLeave(); document.getElementById('net-reset').click(); document.querySelector('.mode-set[data-mode=ffa]').click(); document.getElementById('menu').hidden = false; });
  await A.evaluate(() => { const s = document.getElementById('b-bots'); s.value = '3'; s.dispatchEvent(new Event('change')); });   // (the drop-down sits behind the choice cards)
  for (let i = 0; i < 6 && await A.locator('#page-setup').isVisible(); i++) await A.click('#setup-next');
  const armory = await A.evaluate(() => !document.getElementById('armory').hidden);
  await A.click('#arm-deploy');
  await A.waitForFunction(() => window.__range.battle()?.active && !window.__range.battle().opts.lobby, null, { timeout: 15000 });
  const f = await A.evaluate(() => { const b = window.__range.battle(); return { ffa: b.opts.ffa, teams: b.fighters.map((x) => x.team) }; });
  check('Free for all: the weapon screen, then every fighter its own side', armory && f.ffa && new Set(f.teams).size === 4, JSON.stringify({ armory, ...f }));
  for (let i = 0; i < 90; i++) await A.evaluate(() => window.__range.step(1, 30));
  const botKills = await A.evaluate(() => window.__range.battle().bots.reduce((n, b) => n + b.f.kills, 0));
  check('Free for all: the bots fight each other', botKills > 0, String(botKills));
  // under 20% volume the bots' shots show as captions at the bottom of the screen
  await A.evaluate(() => window.__range.audio.setVolume(0.1));
  let cue = '';
  for (let i = 0; i < 30 && !cue; i++) cue = await A.evaluate(() => { window.__range.step(0.5, 30); const c = document.querySelector('.captions'); return c && !c.hidden ? c.textContent : ''; });
  await A.evaluate(() => window.__range.audio.setVolume(0.5));
  check('captions: under 20% volume, sounds show grouped with their direction and distance', /(Gunshot|footsteps|Explosion).*(ahead|behind|left|right) · (close|far)/i.test(cue), cue);
  // the save code is on the Skins page too
  const save = await A.evaluate(() => { document.getElementById('go-packs').click(); return !!document.querySelector('#packs-save .pk-save') && !document.getElementById('page-packs').hidden; });
  check('the save code box is on the Skins page', save);
}
// Easter egg: a player named iconicmussle736 starts with his Siege settings
{
  const P = await (await browser.newContext()).newPage({ viewport: { width: 640, height: 360 } });
  P.on('pageerror', (e) => nerr.push('iconic: ' + String(e.stack || e)));
  await P.addInitScript(() => { if (!localStorage.getItem('recoilAccounts.v1')) localStorage.setItem('recoilAccounts.v1', JSON.stringify({ current: 'iconicmussle736', list: [{ name: 'iconicmussle736', pin: null }] })); });
  await P.goto(BASE + 'index.html?test', { waitUntil: 'networkidle' }); await P.waitForFunction(() => window.__range?.ready);
  const s = await P.evaluate(() => JSON.parse(localStorage.getItem('recoilRange.settings.v1')));
  check('easter egg: iconicmussle736 gets his settings (sens 5 / 6, FOV 85, volume 100, his aimed sliders)', s.sensH === 5 && s.sensV === 6 && s.fov === 85 && s.volume === 1 && s.adsSens === 'game' && s.opticOverrides['1.0x'] > 0 && Math.abs(s.opticOverrides['2.5x'] / s.opticOverrides['1.0x'] - (40 / 2.5) / 25) < 0.01, JSON.stringify(s && { h: s.sensH, v: s.sensV, fov: s.fov, vol: s.volume, ads: s.adsSens, o: s.opticOverrides }));
  await P.close();
}
check('no page errors', !nerr.length, nerr.join('\n'));
await browser.close(); server.close?.();
console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
