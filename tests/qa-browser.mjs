// Regressions found in the human-style QA pass (docs/QA_REPORT.md), played with real key and
// mouse events in the browser. Low graphics, game time stepped.
//   node tests/qa-browser.mjs
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startServer(8150);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
let failures = 0;
const check = (name, ok, detail = '') => { console.log((ok ? '  PASS ' : '  FAIL ') + name); if (!ok) { failures++; if (detail) console.log('       ' + detail); } };
async function openPage(query = '', pickProfile = true) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { if (!localStorage.getItem('recoilRange.settings.v1')) localStorage.setItem('recoilRange.settings.v1', JSON.stringify({ graphics: 'low', renderScale: 0.5 })); });
  await page.goto('http://127.0.0.1:8150/index.html?test' + query, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__range?.ready); if (pickProfile) await page.click('[data-first-profile=mouse]');
  return { page, errors };
}
const deploy = async (page) => { for (let i = 0; i < 6; i++) { if (await page.evaluate(() => document.getElementById('menu').hidden && document.getElementById('armory').hidden)) return; await page.locator('#menu button.primary:visible, #armory button.primary:visible').last().click(); await page.waitForTimeout(500); } };
const step = (page, s) => page.evaluate((s) => window.__range.step(s, 30), s);
try {
  console.log('\nQA regressions (real input)');
  // 1. Bomb prep: holding the trigger spends no rounds
  {
    const { page, errors } = await openPage();
    await page.click('[data-mode=bomb]'); await page.selectOption('#md-size', '3');
    await page.locator('#menu button.primary:visible').last().click(); await page.waitForTimeout(300); await page.click('[data-side=defend]'); await page.click('#ops-go');
    await page.waitForFunction(() => window.__range.modeGame()?.active && document.getElementById('menu').hidden, null, { timeout: 40000 });
    await page.mouse.move(1, 1); await page.evaluate(() => window.__range.manual(true)); await step(page, 0.3);
    const a0 = await page.evaluate(() => window.__range.modeGame().h.weapon.ammo);
    await page.mouse.down(); await step(page, 1); await page.mouse.up(); await step(page, 0.2);
    const a1 = await page.evaluate(() => ({ ammo: window.__range.modeGame().h.weapon.ammo, phase: window.__range.modeGame().m.rules.phase }));
    check('Bomb prep: holding the trigger spends no rounds', a1.phase === 'prep' && a1.ammo === a0, JSON.stringify({ a0, a1 }));
    check('no page errors (Bomb)', !errors.length, errors.join('\n'));
    await page.close();
  }
  // 1b. Bomb kill cam: a bot kills you with real gunfire; the replay shows their view with their
  //     inputs lit (fire, ADS...) and their ammo, and your own HP / ammo are hidden
  {
    const { page, errors } = await openPage();
    await page.click('[data-mode=bomb]'); await page.selectOption('#md-size', '3'); await page.selectOption('#md-diff', 'hard');
    await page.locator('#menu button.primary:visible').last().click(); await page.waitForTimeout(300); await page.click('#ops-go');
    await page.waitForFunction(() => window.__range.modeGame()?.active && document.getElementById('menu').hidden, null, { timeout: 40000 });
    await page.mouse.move(1, 1);
    const died = await page.evaluate(() => { const R = window.__range, g = R.modeGame(), m = g.m; R.manual(true); for (let i = 0; i < 400 && m.rules.phase === 'prep'; i++) R.step(0.1, 30);
      // stand 6 m from each enemy in turn (some spots are behind a wall) until one kills you
      for (const en of m.actors.filter((a) => a.team !== g.me.team)) {
        if (!g.me.alive || !en.alive) continue;
        const f = g.h.f; f.x = g.me.x = en.x + 6; f.z = g.me.z = en.z; f.y = g.me.y = en.y;
        for (let i = 0; i < 1200 && g.me.alive; i++) R.step(0.05, 60);
      }
      return !g.me.alive && !!g.kc; });
    const seen = new Set(); let hudHidden = false, ammo = '';
    for (let k = 0; k < 120 && died; k++) { const r = await page.evaluate(() => { const R = window.__range, g = R.modeGame(); R.step(1 / 30, 60); return { on: [...g.hud.kcKeys.querySelectorAll('span.on')].map((e) => e.textContent), cam: g.camOverride === g.kcCam, hid: g.hud.view.classList.contains('mg-killcam'), ammo: g.hud.kcKeys.lastChild.textContent }; }); if (r.cam) { r.on.forEach((x) => seen.add(x)); hudHidden ||= r.hid; ammo ||= r.ammo; } }
    check('Bomb kill cam: plays the killer\'s view after a bot kills you', died, 'not killed in time');
    const leaned = await page.evaluate(() => { const g = window.__range.modeGame(); return (g.kc?.rec.frames || g.rec.frames).some((fr) => { for (let i = 0; i * fr.stride < fr.s.length; i++) if (Math.abs(fr.s[i * fr.stride + 8]) > 0.3) return true; return false; }); });
    check('bots lean while aiming, so kill cams show it', leaned, 'no lean in the recorded frames');
    check('Bomb kill cam: shows the killer\'s inputs (fire and ADS, or knife / grenade, lit) and ammo, hides your own HUD', (seen.has('Fire') ? seen.has('ADS') : seen.has('Knife') || seen.has('G')) && hudHidden && / \/ /.test(ammo), JSON.stringify({ seen: [...seen], hudHidden, ammo }));
    await page.close();
  }
  // 2. Battle: a C tap shorter than a frame still vaults
  {
    const { page, errors } = await openPage();
    await page.click('[data-mode=bots]'); await page.selectOption('#b-bots', '1'); await deploy(page);
    await page.mouse.move(1, 1); await page.evaluate(() => window.__range.manual(true)); await step(page, 0.3);
    const spot = await page.evaluate(() => { const B = window.__range.battle(), a = B.arena, h = B.humans[0], f = h.f; for (const x of B.bots) { x.f.x = 999; x.update = () => {}; }
      const b = a.boxes.find((b) => b.minY < 0.05 && b.maxY > 0.8 && b.maxY < 1.3 && (b.maxX - b.minX) > (b.maxZ - b.minZ)); f.x = (b.minX + b.maxX) / 2; f.z = b.minZ - 0.5; f.y = 0; h.look.setAngles(180, 0); return b.maxZ; });
    await page.keyboard.press('KeyC'); await step(page, 1);
    const z = await page.evaluate(() => window.__range.battle().humans[0].f.z);
    check('Battle: a quick C tap vaults over low cover', z > spot, `ended at z ${z.toFixed(2)}, cover ends at ${spot.toFixed(2)}`);
    check('no page errors (Battle)', !errors.length, errors.join('\n'));
    await page.close();
  }
  // 3. Battle Royale: no errors after you are eliminated
  {
    const { page, errors } = await openPage();
    await page.click('[data-mode=royale]'); await deploy(page); await page.mouse.move(1, 1);
    await page.evaluate(() => { const R = window.__range; R.manual(true); const b = R.battle(), r = b.royale, f = b.humans[0].f; f.x = r.x + r.radius + 15; f.z = r.z; f.protectUntil = 0; });
    for (let i = 0; i < 60 && await page.evaluate(() => window.__range.battle().humans[0].f.alive); i++) await step(page, 1);
    await step(page, 3);
    const dead = await page.evaluate(() => !window.__range.battle().humans[0].f.alive);
    check('Battle Royale: eliminated by the zone, the game runs on without errors', dead && !errors.length, errors.slice(0, 2).join('\n'));
    const watching = await page.evaluate(() => { const b = window.__range.battle(); b.kc = null; window.__range.step(0.5, 30); const f = b.royale.focus; return { skip: !b.hud.skip.hidden && b.hud.skip.textContent, puppet: !!(f && f.gun ? b.puppet : true) }; });
    await page.evaluate(() => window.__range.battle().hud.skip.click());
    const out = await page.evaluate(() => { const b = window.__range.battle(); return { over: b.over, title: b.hud.endTitle.textContent, again: !b.hud.again.hidden }; });
    check('Battle Royale: when you are out, Skip goes to your results with Play again', /Skip to results/.test(watching.skip) && watching.puppet && out.over && /You placed #\d+/.test(out.title) && out.again, JSON.stringify({ watching, out }));
    const relock = await page.evaluate(() => { let asked = false; const c = document.querySelector('canvas'); c.requestPointerLock = () => { asked = true; return Promise.resolve(); }; c.click(); return asked; });
    check('after the match ends, a click on the game does not capture the mouse again (Play again stays clickable)', !relock, 'the click asked for pointer lock');
    await page.close();
  }
  // 4. First launch goes through the steps in order: controls, graphics, settings, mode
  {
    const { page, errors } = await openPage('&wizard', false);
    const on = () => page.evaluate(() => document.querySelector('.steps button.on')?.dataset.step || '');
    await page.click('[data-first-profile=trackpad]');
    const gfx = await page.locator('#gfx').isVisible();
    await page.locator('#gfx .pk-skip button.primary').click();
    const settingsStep = await on(), onlySettings = await page.locator('#q-sens').isVisible() && await page.locator('#q-dpi').isVisible();
    await page.fill('#q-dpi', '800'); const dpi = await page.evaluate(() => JSON.parse(localStorage.getItem('recoilRange.settings.v1')).dpi);
    await page.click('#quick-next');
    const shopStep = await on(), shop = await page.locator('#shop-open').isVisible();
    await page.click('#shop-next');
    const modeStep = await on(), modes = await page.locator('#page-mode').isVisible();
    check('first launch: controls, graphics, quick setup (saved), packs, then the mode', gfx && settingsStep === '3' && onlySettings && dpi === 800 && shopStep === '4' && shop && modeStep === '5' && modes && !errors.length, JSON.stringify({ gfx, settingsStep, onlySettings, shopStep, shop, modeStep, modes, errors }));
    await page.close();
  }
  // 5. Ranked against bots (quitting is a loss) and the optional mini map in a match and in Battle
  {
    const { page, errors } = await openPage();
    await page.evaluate(() => document.getElementById('set-minimap').click());
    await page.click('#go-play'); await page.click('[data-mode=tdm]'); await page.selectOption('#md-rank', 'on');
    const note = await page.locator('#md-note').textContent();
    await page.click('#setup-next'); await page.waitForTimeout(300); await page.click('#ops-go');
    await page.waitForFunction(() => window.__range.modeGame()?.active && document.getElementById('menu').hidden, null, { timeout: 40000 });
    await page.mouse.move(1, 1); await page.evaluate(() => window.__range.manual(true)); await step(page, 1);
    const mapMatch = await page.locator('.minimap:visible').count();
    const before = await page.evaluate(() => window.__range.profile().rating);
    await page.evaluate(() => window.__range.modeGame().stop());
    const after = await page.evaluate(() => { const P = window.__range.profile(); return { rating: P.rating, last: P.rankedHistory[0]?.outcome }; });
    check('ranked vs bots: the menu shows your rank, and leaving a ranked match costs Elo', /Ranked: you are/.test(note) && after.rating < before && after.last === 'loss', JSON.stringify({ note: note.slice(-80), before, after }));
    await page.evaluate(() => window.__range.battleStart({ opponent: 'bots', bots: 2, ranked: true })); await step(page, 1);
    const mapBattle = await page.locator('.minimap:visible').count();
    const battleRank = await page.evaluate(() => { const P = window.__range.profile(), r0 = P.rating; window.__range.battle().stop(); return { r0, r1: P.rating, n: P.rankedHistory.length }; });
    check('ranked Battle vs bots: leaving costs Elo too', battleRank.r1 < battleRank.r0 && battleRank.n === 2, JSON.stringify(battleRank));
    check('mini map: shown in a match and in Battle when turned on', mapMatch === 1 && mapBattle === 1 && !errors.length, JSON.stringify({ mapMatch, mapBattle, errors }));
    await page.close();
  }
  // 6. Packs: the Packs menu opens a pack, and the pause menu links to it
  {
    const { page, errors } = await openPage();
    await page.evaluate(() => window.__range.profile().addPoints(150));
    await page.click('#go-shop');
    const before = await page.evaluate(() => window.__range.profile().points);
    await page.click('#shop-open'); await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__range.profile().points);
    const reel = await page.locator('.pk-modal:not([hidden]) .pk-reel').count();
    const inPause = await page.locator('#pause-shop').count();
    check('Packs menu: opening a pack spends 100 points and spins the reel; the pause menu has Open packs', after < before && reel === 1 && inPause === 1 && !errors.length, JSON.stringify({ before, after, reel, inPause, errors }));
    await page.close();
  }
  // 7. Controller: menus with the D-pad and A, then play a battle (move, look, fire) and pause with Start
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      localStorage.setItem('recoilRange.settings.v1', JSON.stringify({ graphics: 'low', renderScale: 0.5 }));
      const pad = { id: 'Test pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      window.__pad = pad;
      window.__press = (i, on) => { pad.buttons[i].pressed = on; pad.buttons[i].value = on ? 1 : 0; };
      navigator.getGamepads = () => [pad];
    });
    await page.goto('http://127.0.0.1:8150/index.html?test', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__range?.ready); await page.click('[data-first-profile=mouse]');
    const tap = async (i) => { await page.evaluate((i) => window.__press(i, true), i); await page.waitForTimeout(150); await page.evaluate((i) => window.__press(i, false), i); await page.waitForTimeout(150); };
    await page.evaluate(() => document.activeElement?.blur());
    await tap(0); const f1 = await page.evaluate(() => document.activeElement?.textContent);
    await tap(13); const f2 = await page.evaluate(() => document.activeElement?.textContent);
    await page.evaluate(() => document.querySelector('[data-mode=bots]').focus()); await tap(0);
    const setup = await page.locator('#page-setup').isVisible();
    await page.selectOption('#b-bots', '1');
    await page.evaluate(() => document.getElementById('setup-next').focus()); await tap(0); await page.waitForTimeout(400);
    await page.evaluate(() => [...document.querySelectorAll('#armory button.primary')].filter((b) => b.offsetParent).at(-1).focus()); await tap(0);
    await page.waitForFunction(() => window.__range.battle()?.active && document.getElementById('menu').hidden, null, { timeout: 40000 });
    const s0 = await page.evaluate(() => { const h = window.__range.battle().humans[0]; for (const b of window.__range.battle().bots) { b.f.x = 999; b.update = () => {}; } return { yaw: h.look.yaw, x: h.f.x, z: h.f.z, ammo: h.weapon.ammo }; });
    await page.evaluate(() => { window.__pad.axes = [0, -1, 1, 0]; window.__press(7, true); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; window.__press(7, false); });
    await page.waitForTimeout(200);
    const s1 = await page.evaluate(() => { const h = window.__range.battle().humans[0]; return { yaw: h.look.yaw, x: h.f.x, z: h.f.z, ammo: h.weapon.ammo, reloading: h.weapon.reloading }; });
    await tap(9); const paused = await page.locator('#page-pause').isVisible();
    await tap(9); const resumed = await page.evaluate(() => document.getElementById('menu').hidden);
    check('controller: D-pad and A work the menus', !!f1 && f1 !== f2 && setup, JSON.stringify({ f1, f2, setup }));
    check('controller: left stick moves, right stick looks, RT fires; Start pauses and resumes', Math.abs(s1.yaw - s0.yaw) > 20 && Math.hypot(s1.x - s0.x, s1.z - s0.z) > 0.3 && (s1.ammo < s0.ammo || s1.reloading) && paused && resumed && !errors.length, JSON.stringify({ s0, s1, paused, resumed, errors }));
    await page.close();
  }
} catch (e) { failures++; console.log('  FAIL ' + (e.stack || e)); }
await browser.close(); server.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nQA regression checks passed');
process.exit(failures ? 1 : 0);
