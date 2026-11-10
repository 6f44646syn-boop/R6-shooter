// A play-through like a person would do it (dev only): real clicks on the menus, real key and
// mouse events in real time, in every mode. Reports page errors and saves screenshots.
//   node tools/play-through.mjs [screenshot folder]
// It is a smoke test of the whole flow, not a judgement of how the game feels.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { startServer } from './serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 8139, BASE = 'http://127.0.0.1:' + PORT + '/';
const shots = process.argv[2] || 'tests/output/play';
mkdirSync(shots, { recursive: true });
const server = await startServer(PORT);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], log = [];
page.on('pageerror', (e) => errors.push('[page] ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 300)); });
const note = (s) => { log.push(s); console.log(s); };
const wait = (ms) => page.waitForTimeout(ms);
const snap = (name) => page.screenshot({ path: shots + '/' + name + '.png' });
const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null; }, sel);
async function click(sel) { await page.click(sel, { timeout: 5000 }); await wait(150); }
async function key(code, ms = 60) { await page.keyboard.down(code); await wait(ms); await page.keyboard.up(code); }
let mx = 640, my = 360;
async function look(dx, dy) { for (let i = 0; i < 8; i++) { mx += dx / 8; my += dy / 8; if (mx < 100 || mx > 1180) mx = 640; await page.mouse.move(mx, my); await wait(16); } }
// what the browser does when the player presses Esc in a locked game
const esc = async () => { await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); }); await key('Escape'); await wait(300); };
async function fire(ms) { await page.mouse.down(); await wait(ms); await page.mouse.up(); }
async function toMenu() {
  if (!(await visible('#menu'))) await esc();
  if (await visible('#pause-quit')) await click('#pause-quit');
  await wait(200);
}
async function common(tag) {
  // what a player does in any fight: move, look, shoot, reload, aim, lean, crouch, sprint
  await page.keyboard.down('KeyW'); await look(120, 0); await wait(500);
  await page.keyboard.down('ShiftLeft'); await wait(500); await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await fire(500); await key('KeyR'); await wait(300);
  await page.mouse.down({ button: 'right' }); await fire(300); await page.mouse.up({ button: 'right' });
  await key('KeyQ', 200); await key('KeyE', 200); await key('Space', 300);
  await page.keyboard.down('KeyA'); await wait(300); await page.keyboard.up('KeyA');
  await snap(tag);
}
try {
  await page.goto(BASE + 'index.html?test', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__range && window.__range.ready);
  await click('[data-first-profile=mouse]');
  await snap('00-menu');

  note('Range');
  await click('[data-mode="range"]'); await snap('01-range-setup');
  await click('#setup-next'); await wait(400); await snap('02-armory');
  await click('#arm-deploy'); await wait(600);
  await common('03-range');
  for (const k of ['Digit2', 'BracketRight', 'KeyM', 'Minus', 'Equal', 'KeyC', 'KeyI', 'F3', 'F3']) await key(k);
  await fire(800); await snap('04-range-shot');
  await esc(); await snap('05-pause');
  if (await visible('#pause-settings')) { await click('#pause-settings'); await snap('06-settings'); await click('#setup-next'); }
  await toMenu();

  note('Battle vs bots');
  await click('[data-mode="bots"]'); await click('#setup-next'); await wait(300); await click('#arm-deploy'); await wait(1500);
  await common('10-battle');
  await key('KeyC'); await key('CapsLock'); await wait(2800); await key('KeyG'); await wait(500);
  await page.keyboard.down('Tab'); await wait(200); await page.keyboard.up('Tab');
  await snap('11-battle-nade');
  await toMenu();

  for (const mode of ['tdm', 'ctf']) {
    note(mode.toUpperCase());
    await click('[data-mode="' + mode + '"]'); await snap('20-' + mode + '-setup');
    await click('#setup-next'); await wait(300); await snap('21-' + mode + '-ops');
    await click('#ops-go'); await wait(1500);
    await common('22-' + mode);
    await key('KeyK'); await key('CapsLock'); await wait(300); await page.mouse.click(640, 360, { button: 'middle' });
    await page.keyboard.down('Tab'); await wait(300); await snap('23-' + mode + '-board'); await page.keyboard.up('Tab');
    await wait(3000); await snap('24-' + mode + '-later');
    await toMenu();
  }

  for (const [side, op] of [['attack', 'Glitch'], ['defend', 'Muse']]) {
    note('Bomb as ' + op + ' (' + side + ')');
    await click('[data-mode="bomb"]'); await click('#setup-next'); await wait(300);
    await page.evaluate((op) => { const c = [...document.querySelectorAll('.op-card')].find((b) => b.querySelector('b').textContent === op); c.click(); }, op);
    await wait(200); await snap('30-bomb-ops-' + side);
    await click('#ops-go'); await wait(1500);
    await snap('31-bomb-prep-' + side);
    await page.mouse.click(640,360,{button:'middle'}); await wait(300);
    if (side === 'attack') { await page.keyboard.down('KeyW'); await wait(2500); await look(200, 0); await wait(1500); await page.keyboard.up('KeyW'); await page.mouse.click(640,360,{button:'middle'}); await snap('32-bomb-drone'); await key('KeyV'); }
    else { await page.keyboard.down('KeyW'); await wait(800); await page.keyboard.up('KeyW'); await page.mouse.click(640,360,{button:'middle'}); await snap('32-bomb-gadget'); }
    await common('33-bomb-' + side);
    await page.keyboard.down('KeyF'); await wait(400); await page.keyboard.up('KeyF');
    await key('KeyK'); await key('CapsLock');
    await wait(1500);
    await toMenu();
  }

  note('Skins and packs, controls page');
  await click('#go-packs'); await wait(400); await snap('40-packs');
  await page.evaluate(() => { const b = document.querySelector('#page-packs .back-btn'); if (b) b.click(); });
  await click('#go-controls'); await snap('41-controls');
} catch (e) {
  errors.push('[script] ' + String(e.message).split('\n')[0]);
  await snap('99-failure').catch(() => {});
} finally {
  console.log(errors.length ? '\nERRORS (' + errors.length + ')\n' + [...new Set(errors)].join('\n') : '\nNo page errors in the play-through');
  await browser.close(); server.close();
  process.exit(errors.length ? 1 : 0);
}
