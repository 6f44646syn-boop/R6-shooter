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
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { if (!localStorage.getItem('recoilRange.settings.v1')) localStorage.setItem('recoilRange.settings.v1', JSON.stringify({ graphics: 'low', renderScale: 0.5 })); });
  await page.goto('http://127.0.0.1:8150/index.html?test', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__range?.ready); await page.click('[data-first-profile=mouse]');
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
    await page.close();
  }
} catch (e) { failures++; console.log('  FAIL ' + (e.stack || e)); }
await browser.close(); server.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nQA regression checks passed');
process.exit(failures ? 1 : 0);
