import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer(8167);
let browser;

try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: {width:1280, height:720} });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8167/index.html?test');
  await page.waitForFunction(() => window.__range?.ready);
  await page.locator('[data-first-profile=mouse]').click();
  await page.click('[data-mode=royale]');
  assert.equal(await page.locator('#setup-title').textContent(), 'Battle Royale');
  assert.ok(await page.locator('#b-kills').isHidden());
  await page.selectOption('#b-bots', '3');
  await page.click('#setup-next');
  await page.evaluate(() => {
    __range.manual(true);
    window.restoreRandom = Math.random;
    Math.random = () => 0.5;
  });
  await page.click('#arm-deploy');
  await page.waitForFunction(() => __range.battle()?.royale);
  const started = await page.evaluate(() => {
    Math.random = window.restoreRandom;
    const b = __range.battle(), r = b.royale;
    for (const bot of b.bots) bot.update = () => {};
    __range.step(.1);
    return [new Set(b.fighters.map(f => f.team)).size, r.chests.length, r.chests.filter(c => c.pirate).length];
  });
  assert.deepEqual(started, [4, 8, 0]);
  console.log('PASS menu starts a four-player free-for-all and a normal roll has no Pirate Token');

  const loot = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, h = b.humans[0], chest = r.chests[0];
    const { x, y, z } = chest.group.position;
    Object.assign(h.f, { x, y:y-.31, z });
    return [r.materials, chest.gun.id];
  });
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyF');
  assert.deepEqual(await page.evaluate(() => {
    const b = __range.battle();
    return [b.royale.materials, b.humans[0].gun.id, b.royale.chests[0].opened];
  }), [loot[0] + 2, loot[1], true]);
  console.log('PASS Interact opens a chest once and equips its gun and wall stock');

  const build = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, h = b.humans[0], a = b.arena;
    h.look.yaw = 0;
    for (let i = 0; i < a.nodeCount && !r.walls.length; i += 7) {
      if (a.nodeY[i] > .01) continue;
      Object.assign(h.f, {x:a.nodeX[i], y:a.nodeY[i], z:a.nodeZ[i]});
      b.key('KeyB', true);
    }
    const wall = r.walls[0];
    if (!wall) return null;
    const start = [wall.mesh.position.x, wall.mesh.position.y, wall.box.maxZ + 1];
    const blocked = a.raycast(start, [0,0,-1], 2) < 2 && a.world.hit === a.baseBoxCount;
    const solid = !a.world.free(wall.mesh.position.x, wall.mesh.position.z);
    b.key('KeyB', true);
    const spent = r.materials;
    h.camera.position.set(...start);
    h.camera.lookAt(wall.mesh.position);
    b.key('OperatorAbility', true);
    b.mouseButton(0, true);
    h.camera.lookAt(wall.mesh.position.x, wall.box.minY + .45, wall.mesh.position.z);
    r.previewEdit();
    r.previewEdit();
    b.mouseButton(0, false);
    const preview = r.editing === wall && !h.in.fire && a.raycast(start, [0,0,-1], 2) < 2;
    b.key('OperatorAbility', true);
    const edited = !r.editing && a.raycast(start, [0,0,-1], 1.4) === Infinity
      && a.world.free(wall.mesh.position.x, wall.mesh.position.z);
    b.key('OperatorAbility', true);
    b.key('KeyV', true);
    const original = { x:h.f.x, y:h.f.y, z:h.f.z };
    Object.assign(h.f, { x:wall.mesh.position.x, y:wall.box.minY, z:wall.mesh.position.z });
    b.key('OperatorAbility', true);
    const safeRestore = r.editing === wall && a.world.free(h.f.x, h.f.z);
    Object.assign(h.f, original);
    b.key('OperatorAbility', true);
    const restored = !r.editing && a.raycast(start, [0,0,-1], 2) < 2;
    h.eye = o => { o.splice(0, 3, ...start); };
    h.shotDirection = (_t, d) => { d.splice(0, 3, 0, 0, -1); };
    for (let i = 0; i < 20 && r.walls.length; i++) b.fire(h, b.t);
    delete h.eye;
    delete h.shotDirection;
    return { blocked, solid, spent, preview, edited, safeRestore, restored, removed: r.walls.length === 0 && a.boxes.length === a.baseBoxCount };
  });
  assert.deepEqual(build, {blocked:true, solid:true, spent:loot[0]+1, preview:true, edited:true, safeRestore:true, restored:true, removed:true});
  console.log('PASS wall placement, live edit preview, walkable door, safe reset, and bullet destruction');

  const result = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, h = b.humans[0].f;
    const [first, second, survivor] = b.bots.map(bot => bot.f);
    r.elapsed = 180;
    r.advance(0);
    const old = h.health;
    Object.assign(h, {x:r.x + 6, y:r.y, z:r.z});
    __range.step(.2);
    const shrank = r.radius < r.startRadius && h.health < old;
    second.protectUntil = 0;
    b._damage(second, 200, survivor, 'body', b.t);
    b._acid(h, 200, b.t, 'Zone');
    __range.step(4);
    const stayedOut = !h.alive && !b.over && !!r.focus;
    b._acid(first, 200, b.t, 'Zone');
    __range.step(.1);
    return {
      shrank, stayedOut, over:b.over, winner:b.hud.endTitle.textContent.startsWith(survivor.name),
      replay:b.kc?.pov && b.kc.killer === survivor, placements:b.hud.endTable.textContent.includes('#1 ' + survivor.name)
        && b.hud.endTable.textContent.includes('#3 You'),
    };
  });
  assert.deepEqual(result, {shrank:true, stayedOut:true, over:true, winner:true, replay:true, placements:true});
  console.log('PASS zone damage, permanent elimination, spectating, final-kill POV, and placements');

  const unlock = await page.evaluate(async () => {
    const R = __range, b = R.battle(), opts = b.opts;
    const { CATALOGUE } = await import('/js/core/skins.js?v=9dd0f7b-mwbioun8');
    const { Profile } = await import('/js/core/profile.js?v=battle-royale');
    const blackIce = CATALOGUE.filter(s => s.rarity === 'blackice');
    const oldOwned = blackIce.filter(s => R.profile().has(s.id)).length;
    const random = Math.random;
    try { Math.random = () => 0.0001; b.start(opts); }
    finally { Math.random = random; }
    const r = b.royale, pirate = r.chests.filter(c => c.pirate);
    const p = pirate[0].group.position;
    const h = b.humans[0].f;
    Object.assign(h, {x:p.x, y:p.y-.31, z:p.z});
    b.key('Interact', true);
    const saved = new Profile(localStorage);
    const imported = new Profile();
    imported.loadCode(R.profile().saveCode());
    b.stop();
    return [oldOwned, pirate.length, r.token, blackIce.length,
      blackIce.every(s => saved.has(s.id) && imported.has(s.id)), !b.royale && r.ring.parent === null];
  });
  assert.deepEqual(unlock, [0, 1, true, 9, true, true]);
  const fullMatch = await page.evaluate(() => {
    const r = __range, b = r.battle();
    b.start({ ...b.opts, map:'school' });
    r.step(235, 15);
    return { over:b.over, living:b.fighters.filter(f => f.alive).length };
  });
  assert.deepEqual(fullMatch, {over:true, living:1});
  assert.deepEqual(errors, []);
  console.log('PASS the rare Pirate Token unlocks all nine Black Ice skins in storage and save codes');
  console.log('PASS a full match with active bots ends with exactly one survivor');
} finally {
  await browser?.close();
  server.close();
}
