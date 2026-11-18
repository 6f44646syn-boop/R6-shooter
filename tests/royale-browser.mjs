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
  await page.click('.mode-set[data-mode=royale]');   // (the card's Settings tab opens its options)
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
  // the drop: all 21 start under a parachute, protected; land everyone for the checks below
  const drop = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale;
    const gliding = b.fighters.filter(f => f.drop && f.protectUntil === Infinity && f.y > 30).length;
    for (const f of b.fighters) if (f.drop) { f.y = b.arena.groundAt(f.x, f.z, f.y); r.land(f, b.t); }
    return { gliding, landed: b.fighters.every(f => !f.drop && f.protectUntil > b.t) };
  });
  assert.deepEqual(drop, { gliding: 21, landed: true });
  console.log('PASS all 21 parachute in protected, and keep spawn protection after landing');
  const ghost = await page.evaluate(() => {
    const R = __range, b = R.battle(), r = b.royale, h = b.humans[0], a = b.arena;
    r.materials = 3; h.look.yaw = 0;
    let spot = null;
    for (let i = 0; i < a.nodeCount && !spot; i += 11) { if (a.nodeY[i] > .01) continue; Object.assign(h.f, { x: a.nodeX[i], y: 0, z: a.nodeZ[i] }); const p = r.plan(h.f, 0); if (p && !p.blocked) spot = p; }
    const n = r.walls.length;
    b.key('KeyB', true); R.step(.05);
    const held = { shown: r.ghost.visible, built: r.walls.length - n, at: [r.ghost.position.x, r.ghost.position.z] };
    b.key('KeyB', false); R.step(.05);
    const toggled = { shown: r.ghost.visible, built: r.walls.length - n };          // still in build mode after B is let go
    b.mouseButton(0, true); b.mouseButton(0, false);                                  // fire builds
    b.key('KeyB', true); b.key('KeyB', false); R.step(.05);                          // B again: back to shooting
    const w = r.walls[r.walls.length - 1];
    const out = { held, toggled, built: r.walls.length - n, same: !!w && Math.abs(w.mesh.position.x - held.at[0]) < 1e-6 && Math.abs(w.mesh.position.z - held.at[1]) < 1e-6, hidden: !r.ghost.visible, spent: 3 - r.materials,
      onGrid: !!w && (() => { const g = 3.2, on = (v) => Math.abs(v / g - Math.round(v / g)) < 1e-6, mid = (v) => on(v - g / 2), p = w.mesh.position, longX = w.box.maxX - w.box.minX > 1;
        return longX ? mid(p.x) && on(p.z) && Math.abs(w.box.maxX - w.box.minX - g) < 1e-6 : on(p.x) && mid(p.z); })() };
    if (w) { r.disposePiece(w); r.walls.splice(r.walls.indexOf(w), 1); r.syncWalls(); }   // leave the island as it was for the checks below
    r.materials = 0;
    return out;
  });
  assert.deepEqual(ghost, { held: { shown: true, built: 0, at: ghost.held.at }, toggled: { shown: true, built: 0 }, built: 1, same: true, hidden: true, spent: 1, onGrid: true });
  console.log('PASS B toggles build mode: the ghost shows where the piece goes on the grid, fire builds it, B again goes back to shooting');
  const corner = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, h = b.humans[0], a = b.arena;
    r.materials = 4; const n = r.walls.length;
    for (let i = 0; i < a.nodeCount; i += 13) {
      if (a.nodeY[i] > .01) continue;
      Object.assign(h.f, { x: a.nodeX[i], y: 0, z: a.nodeZ[i] });
      if (!r.plan(h.f, 0, 'wall').blocked && !r.plan(h.f, 90, 'wall').blocked) break;
    }
    const w1 = r.build(h.f, 0, 'wall'), w2 = r.build(h.f, 90, 'wall'), again = r.plan(h.f, 0, 'wall').blocked;
    const out = { both: !!w1 && !!w2, touch: !!w1 && !!w2 && Math.abs(w1.box.maxX - w2.mesh.position.x) < .2 && Math.abs(w2.box.minZ - w1.mesh.position.z) < .2, sameSpotBlocked: again };
    for (const w of r.walls.slice(n)) { r.disposePiece(w); r.walls.splice(r.walls.indexOf(w), 1); } r.syncWalls(); r.materials = 0;
    return out;
  });
  assert.deepEqual(corner, { both: true, touch: true, sameSpotBlocked: true });
  console.log('PASS grid walls meet at a corner, and a second wall on the same edge is refused');
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
  assert.ok(await page.evaluate(() => {
    const R = __range, b = R.battle(), world = b.arena.world, h = b.humans[0];
    const slider = document.getElementById('set-royale-distance');
    const set = value => { slider.value = String(value); slider.dispatchEvent(new Event('input')); R.renderFrame(); };
    set(45);
    const near = h.camera.far === 45 && b.arena.scene.fog.far === 45 && b.arena.world === world;
    set(200);
    return near && h.camera.far === 200 && b.arena.scene.fog.far > 45;
  }));
  console.log('PASS render-distance setting clips the view and preserves collision');

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
    h.f.protectUntil = 0;
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
  }), [loot[0] + 18, loot[1], true]);
  console.log('PASS Interact opens a chest once and equips its gun and wall stock (3x materials)');
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
      b.key('KeyB', true); b.key('KeyB', false); b.mouseButton(0, true); b.mouseButton(0, false); b.key('KeyB', true); b.key('KeyB', false);
    }
    const wall = r.walls[0];
    if (!wall) return null;
    const start = [wall.mesh.position.x, wall.mesh.position.y, wall.box.maxZ + 1];
    const blocked = a.raycast(start, [0,0,-1], 2) < 2 && a.world.hit === a.baseBoxCount;
    const navReused = a.world !== a._baseWorld && a.world.nodeCount === 0;
    const solid = !a.world.free(wall.mesh.position.x, wall.mesh.position.z);
    b.key('KeyB', true); b.key('KeyB', false); b.mouseButton(0, true); b.mouseButton(0, false); b.key('KeyB', true); b.key('KeyB', false);
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
  assert.deepEqual(build, {blocked:true, solid:true, spent:loot[0]+17, preview:true, edited:true, safeRestore:true, restored:true, preset:true, navReused:true, removed:true});
  console.log('PASS wall release-to-edit, window preset, safe reset, and bullet destruction');

  const botCover = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, h = b.humans[0], bot = b.bots[0], f = bot.f;
    const update = Object.getPrototypeOf(bot).update.bind(bot), t = b.t;
    Object.assign(h.f,{x:5.5,y:0,z:1,vx:0,vz:0,protectUntil:0});
    Object.assign(f,{x:5.5,y:0,z:-6,yaw:180,vx:0,vz:0,protectUntil:0});
    bot.ay = 180;
    bot.setGun(b.deps.guns[1]);
    update(t,1/60,b);
    const sawPlayer = bot.visibleContact?.actor === h.f;
    const mats = r.materials;
    const wall = r.build(h.f,0);
    if (!wall) return {missing:'player wall'};
    const hp = wall.hp;
    for (let i = 1; i <= 90 && wall.hp === hp; i++) update(t+i/60,1/60,b);
    const shotCover = wall.hp < hp && !bot.target;
    if (wall.hp > 0) r.damageWall(wall,999);
    Object.assign(f,{x:5.5,y:0,z:-6,vx:0,vz:0,health:67,buildMaterials:2});
    r.piece = 'cone';
    bot.onHurt(h.f,t+2);
    update(t+2,1/60,b);
    const defense = r.walls.at(-1);
    const builtWall = defense?.kind === 'wall' && defense.owner === f && f.buildMaterials === 1
      && r.materials === mats-1 && bot.mode === 'hold';
    if (defense) r.damageWall(defense,999);
    f.health = 100;
    r.piece = 'wall';
    return {sawPlayer,shotCover,builtWall};
  });
  assert.deepEqual(botCover,{sawPlayer:true,shotCover:true,builtWall:true});
  console.log('PASS bots build defensive walls from their own stock and shoot walls after losing sight of a player');

  const platforms = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, h = b.humans[0], a = b.arena;
    const place = (x,z) => {
      Object.assign(h.f,{x,y:0,z});
      h.look.yaw = 0;
      b.key('KeyB', true); b.key('KeyB', false); b.mouseButton(0, true); b.mouseButton(0, false); b.key('KeyB', true); b.key('KeyB', false);
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
      b.key('KeyB', true); b.key('KeyB', false); b.mouseButton(0, true); b.mouseButton(0, false); b.key('KeyB', true); b.key('KeyB', false);
      const ramp = r.walls.at(-1);
      if (r.walls.length !== before+level || ramp.level !== level) return {stuck:level, y:h.f.y, notice:r.notice};
      const top = ramp.box.minZ+.15;
      for (let tick = 0; h.f.z > top+.01 && tick < 85; tick++) {
        a.stepBody(h.f,0,-Math.min(.085,h.f.z-top),1/60);
      }
      if (h.f.z > top+.03 || h.f.y < ramp.box.minY+1.5) return {stuck:level, y:h.f.y,z:h.f.z,top};
    }
    b.key('KeyB', true); b.key('KeyB', false); b.mouseButton(0, true); b.mouseButton(0, false); b.key('KeyB', true); b.key('KeyB', false);
    return {ramps:r.walls.length-before,climbed:h.f.y>16,blockedAtTen:r.notice==='10-ramp height limit',mats:r.materials};
  });
  assert.deepEqual(climb, {ramps:10,climbed:true,blockedAtTen:true,mats:1});
  console.log('PASS connected ramps can be walked up ten levels and refuse an eleventh');

  // build mode on the ramps: snapping, the crank tower, hold-to-build, turbo building, edit resets, the blueprint
  const buildTools = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, a = b.arena, h = b.humans[0], R = __range;
    const clear = () => { for (const w of r.walls.slice()) { r.disposePiece(w); r.walls.splice(r.walls.indexOf(w), 1); } r.syncWalls(); };
    // a flat spot with room for a ramp, and a row of free cells along x (yaw 180: walls ahead on +z)
    const spot = (yaw, kind, along = 0) => {
      for (let i = 0; i < a.nodeCount; i += 7) {
        if (a.nodeY[i] > .01 || Math.abs(a.nodeX[i]) > 45 || Math.abs(a.nodeZ[i]) > 35) continue;       // (clear of the island's edge)
        let ok = true;
        for (let k = 0; k <= along && ok; k++) { Object.assign(h.f, { x: a.nodeX[i] + 3.2 * k, y: 0, z: a.nodeZ[i], vx: 0, vy: 0, vz: 0 }); h.look.yaw = yaw; ok = !r.plan(h.f, yaw, kind).blocked && !r.plan(h.f, yaw, 'ramp').blocked; }
        if (ok) { Object.assign(h.f, { x: a.nodeX[i], y: 0, z: a.nodeZ[i], vx: 0, vy: 0, vz: 0 }); return true; }
      }
      return false;
    };
    const out = {};
    clear(); r.materials = 60; h.look.pitch = 0; r.preview = false;
    // 1. a wall beside the ramp you stand on sits on the ramp's own edges, wherever on it you are
    out.found = spot(0, 'wall'); R.step(.05);
    const ramp = r.build(h.f, 0, 'ramp'), q = ramp.mesh.position;
    out.walls = [-1.4, -.6, 0, .6].map(along => {
      Object.assign(h.f, { x: q.x, z: q.z - along, y: a.groundAt(q.x, q.z - along, 3) }); h.look.yaw = 0;
      const top = r.plan(h.f, 0, 'wall'), side = r.plan(h.f, 90, 'wall');
      return !top.blocked && top.attached && Math.abs(top.z - (q.z - 1.6)) < 1e-6 && Math.abs(top.y - (q.y + 1.7)) < 1e-6
        && !side.blocked && side.attached && Math.abs(side.x - (q.x + 1.6)) < 1e-6 && Math.abs(side.y - q.y) < 1e-6;
    });
    // ... and the next ramp goes on from the middle of this one, not only from its top
    Object.assign(h.f, { x: q.x, z: q.z + 1.2, y: a.groundAt(q.x, q.z + 1.2, 3) }); h.look.yaw = 0;
    const next = r.plan(h.f, 0, 'ramp'); out.nextRamp = !next.blocked && next.previous === ramp && Math.abs(next.y - (q.y + 1.7)) < 1e-6;
    clear();
    // 2. the crank: ramps under your feet, a quarter turn each, lift you onto them (ten, then the limit)
    out.found2 = spot(0, 'ramp'); r.materials = 60; R.step(.05); h.look.pitch = -70;
    const tower = [];
    for (let k = 0; k < 11; k++) {
      const before = h.f.y, piece = r.build(h.f, k * 90, 'ramp', -70);
      tower.push(piece ? [piece.level, +(h.f.y - before).toFixed(2)] : ['none', r.notice]);
      R.step(.05);
    }
    out.tower = { levels: tower.slice(0, 10).map(t => t[0]).join(), lifted: tower.slice(0, 10).every(t => t[1] > .3), eleventh: tower[10].join(), y: +h.f.y.toFixed(1), mats: r.materials };
    R.step(.5); out.stays = h.f.y > 15;
    clear(); h.look.pitch = 0;
    // 3. hold fire: walls go on every new edge as you move; turbo rebuilds a shot-down wall, plain does not
    out.found3 = spot(180, 'wall', 5); h.look.yaw = 180; R.step(.05);
    b.key('KeyB', true); b.key('KeyB', false);
    r.piece = 'wall'; r.materials = 60; const x0 = h.f.x, z0 = h.f.z;
    b.mouseButton(0, true);
    for (let i = 0; i < 40; i++) { Object.assign(h.f, { x: x0 + i * .25, z: z0 }); R.step(.05); }
    b.mouseButton(0, false);
    out.drag = { cells: new Set(r.walls.map(w => w.mesh.position.x.toFixed(1))).size, spent: 60 - r.materials, setting: b.deps.settings.turboBuild };
    const rebuilt = turbo => {
      clear(); b.deps.settings.turboBuild = turbo; r.materials = 20; Object.assign(h.f, { x: x0, z: z0 }); R.step(.05);
      b.mouseButton(0, true); R.step(.2);
      for (const w of r.walls.slice()) r.damageWall(w, 1000);
      const gone = r.walls.length === 0; R.step(.3); b.mouseButton(0, false);
      return gone && r.walls.length;
    };
    out.turbo = rebuilt(true); out.plain = rebuilt(false); b.deps.settings.turboBuild = true;
    clear(); r.materials = 0; b.mouseButton(0, true); R.step(.2); b.mouseButton(0, false); out.dry = r.notice;
    // 4. the reset key: the wall or ramp you aim at goes back to how it was built (no editor needed)
    r.materials = 20; spot(0, 'wall'); R.step(.05);
    const wall = r.build(h.f, 0, 'wall');
    Object.assign(h.f, { z: wall.mesh.position.z + 2.4, x: wall.mesh.position.x }); h.look.yaw = 0; R.step(.1);
    r.editing = wall; r.editMask = 511 ^ 18; r.applyEdit();
    const cut = wall.mask; b.key('KeyV', true); b.key('KeyV', false);
    const reset = wall.mask === 511 && !r.editing && r.notice === 'Edit reset';
    b.key('KeyV', true); b.key('KeyV', false); const again = r.notice;
    out.reset = { cut: cut !== 511, reset, again };
    clear();
    // 5. build mode: the blueprint comes up in your hands (the pickaxe and the gun are down), and goes away again
    r.preview = false; b.key('KeyB', true); b.key('KeyB', false);
    let gunWhileDrawn = true; r.blueprint.children[0].onBeforeRender = () => { gunWhileDrawn = h.rig.root.visible; };   // the gun's state as the blueprint is drawn
    for (let i = 0; i < 30; i++) { R.step(.016); R.renderFrame(); }
    const held = { shown: r.blueprint.visible, pickaxe: r.pickaxe.visible, gun: gunWhileDrawn };
    b.key('KeyB', true); b.key('KeyB', false);
    for (let i = 0; i < 60; i++) { R.step(.016); R.renderFrame(); }
    out.blueprint = { held, away: !r.blueprint.visible };
    return out;
  });
  assert.deepEqual(buildTools, {
    found: true, walls: [true, true, true, true], nextRamp: true, found2: true,
    tower: { levels: '1,2,3,4,5,6,7,8,9,10', lifted: true, eleventh: 'none,10-ramp height limit', y: buildTools.tower.y, mats: 50 }, stays: true,
    found3: true, drag: { cells: buildTools.drag.cells, spent: buildTools.drag.cells, setting: true }, turbo: 1, plain: 0, dry: 'Out of materials',
    reset: { cut: true, reset: true, again: 'Nothing to reset' }, blueprint: { held: { shown: true, pickaxe: false, gun: false }, away: true },
  });
  assert.ok(buildTools.drag.cells >= 3 && buildTools.tower.y > 15);
  console.log('PASS walls snap to the ramp you stand on, ramps under your feet crank a tower, held fire drags and turbo rebuilds, V resets edits, the blueprint is in your hands');

  // sky bases: look up for a wall a level higher, cones off the ground against a wall, collapse, bots shoot the support
  const sky = await page.evaluate(() => {
    const b = __range.battle(), r = b.royale, a = b.arena, h = b.humans[0];
    for (const w of r.walls.slice()) { r.disposePiece(w); r.walls.splice(r.walls.indexOf(w), 1); } r.syncWalls();
    r.materials = 60;
    let found = false;
    for (let i = 0; i < a.nodeCount && !found; i += 7) {
      if (a.nodeY[i] > .01 || Math.abs(a.nodeX[i]) > 40 || Math.abs(a.nodeZ[i]) > 30) continue;
      Object.assign(h.f, { x: a.nodeX[i], y: 0, z: a.nodeZ[i], vx: 0, vy: 0, vz: 0 });
      found = !r.plan(h.f, 0, 'wall').blocked && !r.plan(h.f, 0, 'cone').blocked;
    }
    const out = { found, bare: r.plan(h.f, 0, 'wall', 40).blocked };       // nothing below: no wall up there
    const low = r.build(h.f, 0, 'wall'), up = r.plan(h.f, 0, 'wall', 40);
    out.raised = !up.blocked && Math.abs(up.y - (low.box.minY + 2.7)) < 1e-6;
    const high = r.build(h.f, 0, 'wall', 40);
    h.f.y = low.box.maxY;                                                    // up on the base, level with the wall top
    const cone = r.plan(h.f, 0, 'cone'), lone = r.plan(h.f, 180, 'cone');
    out.cone = !cone.blocked && Math.abs(cone.y - low.box.maxY) < 1e-6;
    out.lone = lone.blocked;                                                 // touches no wall or ramp: refused
    const sky = r.build(h.f, 0, 'cone');
    // a bot below being shot at from the cone: it targets the lowest wall holding it up
    const bot = b.fighters.find(g => g !== h.f && g.alive);
    const save = { x: bot.x, y: bot.y, z: bot.z };
    Object.assign(h.f, { x: sky.mesh.position.x, y: sky.box.maxY, z: sky.mesh.position.z });
    Object.assign(bot, { x: low.mesh.position.x + (low.box.maxX - low.box.minX > 1 ? 0 : -7), y: low.box.minY, z: low.mesh.position.z + (low.box.maxX - low.box.minX > 1 ? 7 : 0) });
    const target = r.supportTarget(bot, h.f, b.t, b.t);
    out.support = target?.support === true && [low, high].includes(target.wall);
    Object.assign(bot, save);
    r.damageWall(low, 999);                                                  // the base's foot goes: the rest falls
    out.collapsed = r.walls.length;
    // on a ramp, a wall on its low edge sits at the ramp's foot; raised, it would float, so it is refused
    Object.assign(h.f, { x: low.mesh.position.x, z: low.mesh.position.z + (low.box.maxX - low.box.minX > 1 ? 1.6 : 0), y: low.box.minY });
    const ramp = r.build(h.f, 0, 'ramp');
    out.ramp = !!ramp;
    if (ramp) {
      Object.assign(h.f, { x: ramp.mesh.position.x, z: ramp.mesh.position.z, y: ramp.mesh.position.y + .9 });
      out.foot = !r.plan(h.f, 180, 'wall').blocked;
      out.floating = r.plan(h.f, 180, 'wall', 40).blocked;
    }
    return out;
  });
  assert.deepEqual(sky, { found: true, bare: true, raised: true, cone: true, lone: true, support: true, collapsed: 0, ramp: true, foot: true, floating: true });
  console.log('PASS looking up raises a wall a level, cones build off the ground against a wall, builds fall when their support goes, and bots shot at from above target the support');

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
  assert.deepEqual(unlock, [0, 1, true, 10, true, true]);
  const fullMatch = await page.evaluate(() => {
    const r = __range, b = r.battle();
    b.start(b.opts);
    r.step(22, 15);                 // about 10 s under the parachute, then looting
    const armedBots = b.bots.filter(bot => bot.gun).length;
    r.step(223, 15);
    return { over:b.over, living:b.fighters.filter(f => f.alive).length, armedBots };
  });
  assert.ok(fullMatch.armedBots >= 15, JSON.stringify(fullMatch));
  assert.equal(fullMatch.over, true);
  assert.equal(fullMatch.living, 1);
  assert.deepEqual(errors, []);
  console.log('PASS the rare Pirate Token unlocks all ten Black Ice skins in storage and save codes');
  console.log('PASS bots find guns in chests and the full match ends with exactly one survivor');
} finally {
  await browser?.close();
  server.close();
}
