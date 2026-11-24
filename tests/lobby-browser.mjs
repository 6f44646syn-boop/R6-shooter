// The online lobby (nobody can be hurt until the host starts; everyone goes in together) and
// Free for all (every bot its own side). Two browser sessions over join codes.
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
await B.waitForFunction(() => document.getElementById('net-out-j').value.startsWith('RR1-'));
await A.fill('#net-in-h', await B.inputValue('#net-out-j')); await A.click('#net-accept');
await A.waitForFunction(() => document.getElementById('net-out-h').value.startsWith('RR1-'));
await B.fill('#net-in-j', await A.inputValue('#net-out-h')); await B.click('#net-connect');
await B.waitForFunction(() => /Connected/.test(document.getElementById('net-status').textContent), null, { timeout: 25000 });
await A.waitForFunction(() => document.querySelectorAll('#h-party-list li').length >= 2, null, { timeout: 10000 });
const run = async (sec) => { for (let i = 0; i < sec * 20; i++) { await A.evaluate(() => window.__range.step(0.05, 60)); await B.evaluate(() => window.__range.step(0.05, 60)); await new Promise((r) => setTimeout(r, 5)); } };
const check = (n, ok, d = '') => { console.log((ok ? '  PASS ' : '  FAIL ') + n + (ok ? '' : ' ' + d)); if (!ok) failures++; };
for (const mode of ['battle', 'tdm']) {
  await A.evaluate((mode) => { const R = window.__range; R.manual(true); R.netGame(mode); R.modePrefs({ teamSize: 3, map: { tdm: 'yard', ctf: 'yard', bomb: 'ranch' }, difficulty: 'easy' }); R.battleStart({ opponent: 'net', bots: 2, level: 'easy', kills: 10 }, true); }, mode);
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
// Free for all offline: every bot is its own side and they fight each other
{
  await A.evaluate(() => { const R = window.__range; R.battleLeave(); document.getElementById('net-reset').click(); document.querySelector('.mode-set[data-mode=ffa]').click(); document.getElementById('menu').hidden = false; });
  await A.evaluate(() => { const s = document.getElementById('b-bots'); s.value = '3'; s.dispatchEvent(new Event('change')); });   // (the drop-down sits behind the choice cards)
  for (let i = 0; i < 6 && await A.locator('#page-setup').isVisible(); i++) await A.click('#setup-next');
  await A.waitForFunction(() => window.__range.battle()?.active && !window.__range.battle().opts.lobby, null, { timeout: 15000 });
  const f = await A.evaluate(() => { const b = window.__range.battle(); return { ffa: b.opts.ffa, teams: b.fighters.map((x) => x.team), armory: document.getElementById('armory').hidden }; });
  check('Free for all: no weapon select, every fighter its own side', f.ffa && new Set(f.teams).size === 4 && f.armory, JSON.stringify(f));
  for (let i = 0; i < 90; i++) await A.evaluate(() => window.__range.step(1, 30));
  const botKills = await A.evaluate(() => window.__range.battle().bots.reduce((n, b) => n + b.f.kills, 0));
  check('Free for all: the bots fight each other', botKills > 0, String(botKills));
}
check('no page errors', !nerr.length, nerr.join('\n'));
await browser.close(); server.close?.();
console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
