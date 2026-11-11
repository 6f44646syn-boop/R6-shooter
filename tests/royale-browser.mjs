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
  assert.ok(await page.locator('#b-bots').isHidden());
  assert.ok(await page.locator('#b-map').isHidden());
  await page.evaluate(() => {
    __range.manual(true);
    window.restoreRandom = Math.random;
    Math.random = () => 0.5;
  });
  await page.click('#setup-next');
  await page.waitForFunction(() => __range.battle()?.royale);
  const started = await page.evaluate(() => {
    Math.random = window.restoreRandom;
    const b = __range.battle(), r = b.royale;
    for (const bot of b.bots) bot.update = () => {};
    __range.step(.1);
    return {
      teams:new Set(b.fighters.map(f => f.team)).size, chests:r.chests.length, pirate:r.chests.filter(c => c.pirate).length,
      map:b.arena.mapId, size:[b.arena.hx*2,b.arena.hz*2], unarmed:b.fighters.every(f => !f.gun && f.nades === 0),
      skippedArmory:document.getElementById('armory').hidden,
    };
  });
  assert.deepEqual(started, {teams:21, chests:33, pirate:0, map:'blacktide', size:[160,128], unarmed:true, skippedArmory:true});
  console.log('PASS deploy skips weapon selection and starts Blacktide Island with 20 unarmed rivals');
  assert.ok(await page.evaluate(() => {
    const a = __range.battle().arena;
    return a.boxes.filter(b => b.kind === 'tree').length === 42
      && a.groundAt(-42,0,2.5) > 2
      && a.findPath(-55,0,-42,0,0,2.5).length > 0;
  }));
  console.log('PASS solid trees and navigable hills are present on Blacktide');
  const tiers = await page.evaluate(() => {
    const b = __range.battle(), a = b.arena, world = a.world;
    const counts = ['low','standard','high','ultra'].map(q => {
      a.setGraphics(q,b.deps.renderer);
      return a.detailBatches.reduce((sum,batch) => sum + (batch.mesh.visible ? batch.mesh.count : 0), 0);
    });
    a.setGraphics('standard',b.deps.renderer);
    return { counts, sharedCollision:world === a.world };
  });
  assert.deepEqual(tiers, {counts:[32,860,2200,4140],sharedCollision:true});
  console.log('PASS all graphics presets scale map detail with shared collision');

  const pickaxe = await page.evaluate(() => {
    const R = __range, b = R.battle(), r = b.royale, h = b.humans[0], a = b.arena;
    const prop = a.boxes.find(box => box.maxY > 2 && box.minY === 0);
    const x = (prop.minX + prop.maxX) / 2;
    h.camera.position.set(x, 1.5, prop.maxZ + 1);
    h.camera.lookAt(x, 1.5, prop.maxZ);
    b.mouseButton(0, true);
    b.mouseButton(0, false);
    b.mouseButton(0, true);
    b.mouseButton(0, false);
    R.renderFrame();
    const visible = r.pickaxe.visible;
    R.step(.7);
    const target = b.bots[0].f;
    Object.assign(target, {x:-74, y:0, z:-59, protectUntil:0});
    h.camera.position.set(-74, 1.25, -57.2);
    h.camera.lookAt(-74, 1.25, -59);
    b.mouseButton(0, true);
    b.mouseButton(0, false);
    return { walls:r.materials, gun:h.gun, visible, shots:b.rec?.shots.length || 0, damage:100-target.health };
  });
  assert.deepEqual(pickaxe, {walls:1, gun:null, visible:true, shots:0, damage:40});
  console.log('PASS the starting pickaxe harvests materials, hits nearby rivals, and fires no bullets');

  const loot = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, h = b.humans[0], chest = r.chests[0];
    const { x, y, z } = chest.position;
    Object.assign(h.f, { x, y:y-.31, z });
    return [r.materials, chest.gun.id];
  });
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyF');
  assert.deepEqual(await page.evaluate(() => {
    const b = __range.battle();
    return [b.royale.materials, b.humans[0].gun.id, b.royale.chests[0].opened];
  }), [loot[0] + 6, loot[1], true]);
  console.log('PASS Interact opens a chest once and equips its gun and wall stock');
  assert.ok(await page.evaluate(() => {
    const b = __range.battle(), h = b.humans[0], r = b.royale, gun = h.gun;
    h.weapon.ammo = 2;
    r.lootGun(b.deps.guns.find(g => g.id !== gun.id));
    b.key('Digit1',true);
    const pickaxe = !h.gun;
    b.key('Digit2',true);
    return pickaxe && h.gun === gun && h.weapon.ammo === 2
      && r.hotbar.textContent.includes(gun.name) && r.matCount.textContent.includes('mats');
  }));
  console.log('PASS inventory retains guns, ammunition and the pickaxe across slot changes');

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
    const navReused = a.world !== a._baseWorld && a.world.nodeCount === 0;
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
    const preview = r.editing === wall && !h.in.fire && a.raycast(start, [0,0,-1], 2) < 2;
    b.mouseButton(0, false);
    const edited = !r.editing && a.raycast(start, [0,0,-1], 1.4) === Infinity
      && a.world.free(wall.mesh.position.x, wall.mesh.position.z);
    b.key('OperatorAbility', true);
    const original = { x:h.f.x, y:h.f.y, z:h.f.z };
    Object.assign(h.f, { x:wall.mesh.position.x, y:wall.box.minY, z:wall.mesh.position.z });
    b.key('KeyV', true);
    const safeRestore = r.editing === wall && a.world.free(h.f.x, h.f.z);
    Object.assign(h.f, original);
    b.key('KeyV', true);
    const restored = !r.editing && a.raycast(start, [0,0,-1], 2) < 2;
    b.key('OperatorAbility', true);
    b.key('Digit2',true);
    const preset = !r.editing && wall.mask === (511 ^ 16) && !a.world.free(wall.mesh.position.x,wall.mesh.position.z);
    b.key('OperatorAbility', true);
    b.key('KeyV',true);
    h.eye = o => { o.splice(0, 3, ...start); };
    h.shotDirection = (_t, d) => { d.splice(0, 3, 0, 0, -1); };
    for (let i = 0; i < 20 && r.walls.length; i++) b.fire(h, b.t);
    delete h.eye;
    delete h.shotDirection;
    return { blocked, solid, spent, preview, edited, safeRestore, restored, preset, navReused, removed: r.walls.length === 0 && a.boxes.length === a.baseBoxCount };
  });
  assert.deepEqual(build, {blocked:true, solid:true, spent:loot[0]+5, preview:true, edited:true, safeRestore:true, restored:true, preset:true, navReused:true, removed:true});
  console.log('PASS wall release-to-edit, window preset, safe reset, and bullet destruction');

  const platforms = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, h = b.humans[0], a = b.arena;
    const place = (x,z) => {
      Object.assign(h.f,{x,y:0,z});
      h.look.yaw = 0;
      b.key('KeyB',true);
      return r.walls.at(-1);
    };
    const aimTile = (piece,x,z) => {
      h.camera.position.set(piece.mesh.position.x + x, 4, piece.mesh.position.z + z);
      h.camera.lookAt(piece.mesh.position.x + x, 0, piece.mesh.position.z + z);
    };
    b.key('KeyZ',true);
    const ramp = place(14,16);
    if (ramp?.kind !== 'ramp') return {missing:'ramp'};
    const at = ramp.mesh.position;
    const rampSlope = a.groundAt(at.x+.5,at.z-1,2) > a.groundAt(at.x+.5,at.z+1,2);
    aimTile(ramp,-.7,-.7);
    b.key('OperatorAbility',true);
    if (r.editing !== ramp) return {missing:'ramp edit'};
    b.mouseButton(0,true); b.mouseButton(0,false);
    aimTile(ramp,.7,-.7);
    b.key('OperatorAbility',true);
    b.key('KeyR',true);
    const rampEdited = !r.editing && ramp.mask === 14 && ramp.dir === 1;
    b.key('KeyZ',true);
    const cone = place(-14,16);
    if (cone?.kind !== 'cone') return {missing:'cone'};
    const cp = cone.mesh.position;
    const raised = a.groundAt(cp.x-.4,cp.z-.4,2);
    aimTile(cone,-.4,-.4);
    b.key('OperatorAbility',true);
    if (r.editing !== cone) return {missing:'cone edit'};
    b.mouseButton(0,true); b.mouseButton(0,false);
    const coneEdited = !r.editing && cone.mask === 14 && a.groundAt(cp.x-.4,cp.z-.4,2) < raised;
    return {rampSlope,rampEdited,coneEdited};
  });
  assert.deepEqual(platforms, {rampSlope:true,rampEdited:true,coneEdited:true});
  console.log('PASS ramps and cones build and update collision after 2×2 edits');

  const climb = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, a = b.arena, h = b.humans[0];
    Object.assign(h.f,{x:-73,y:0,z:38,vx:0,vy:0,vz:0});
    h.look.yaw = 0;
    b.key('KeyZ',true);
    b.key('KeyZ',true);
    r.materials = 11;
    const before = r.walls.length;
    for (let level = 1; level <= 10; level++) {
      b.key('KeyB',true);
      const ramp = r.walls.at(-1);
      if (r.walls.length !== before+level || ramp.level !== level) return {stuck:level, y:h.f.y, notice:r.notice};
      const top = ramp.box.minZ+.15;
      for (let tick = 0; h.f.z > top+.01 && tick < 85; tick++) {
        a.stepBody(h.f,0,-Math.min(.085,h.f.z-top),1/60);
      }
      if (h.f.z > top+.03 || h.f.y < ramp.box.minY+1.5) return {stuck:level, y:h.f.y,z:h.f.z,top};
    }
    b.key('KeyB',true);
    return {ramps:r.walls.length-before,climbed:h.f.y>16,blockedAtTen:r.notice==='10-ramp height limit',mats:r.materials};
  });
  assert.deepEqual(climb, {ramps:10,climbed:true,blockedAtTen:true,mats:1});
  console.log('PASS connected ramps can be walked up ten levels and refuse an eleventh');

  const result = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, h = b.humans[0].f;
    const [first, second, survivor] = b.bots.map(bot => bot.f);
    for (const bot of b.bots.slice(3)) b._acid(bot.f, 200, b.t, 'Zone');
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
    const p = pirate[0].position;
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
    b.start(b.opts);
    r.step(10, 15);
    const armedBots = b.bots.filter(bot => bot.gun).length;
    r.step(235, 15);
    return { over:b.over, living:b.fighters.filter(f => f.alive).length, armedBots };
  });
  assert.ok(fullMatch.armedBots >= 15, JSON.stringify(fullMatch));
  assert.equal(fullMatch.over, true);
  assert.equal(fullMatch.living, 1);
  assert.deepEqual(errors, []);
  console.log('PASS the rare Pirate Token unlocks all nine Black Ice skins in storage and save codes');
  console.log('PASS bots find guns in chests and the full match ends with exactly one survivor');
} finally {
  await browser?.close();
  server.close();
}
