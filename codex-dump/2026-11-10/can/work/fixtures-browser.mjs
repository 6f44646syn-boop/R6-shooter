// Headless Chrome test runner (dev only).
//   node tests/run.mjs            unit tests + magazine simulation + frame-time check
//
// Needs Playwright with a Chromium build available to Node. Playwright is NOT a dependency of
// the site: the published folder never loads it. If it is not installed globally, run
// `npm i -D playwright` in a scratch folder or use your own Chrome via PLAYWRIGHT_CHROMIUM.
import { createRequire } from 'node:module';
import { startServer } from 'file:///C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/continue-recoil-range-https-github-com/work/R6-shooter/tools/serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Playwright is not installed. See the comment at the top of tests/run.mjs.'); process.exit(2); }

const PORT = 8163;
const BASE = 'http://127.0.0.1:' + PORT + '/';
const EYE = 1.6;
let failures = 0;
const ok = (name) => console.log('  PASS ' + name);
const fail = (name, msg) => { failures++; console.log('  FAIL ' + name + '\n       ' + msg); };
function check(name, cond, msg) { cond ? ok(name) : fail(name, msg); }

const server = await startServer(PORT);
const browser = await chromium.launch({
  args: ['--js-flags=--expose-gc', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'],
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
});

async function openPage(path, viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport });
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE)) external.push(r.url()); });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  if (path.startsWith('index')) { await page.waitForFunction(() => window.__range?.ready); await page.locator('[data-first-profile=mouse]').click(); }
  return { page, errors, external };
}

try {
  /* ---------- 3. frame-time check ---------- */
  console.log('\nFrame time at 1920x1080 (headless, software GPU: treat fps as a lower bound)');
  {
    const { page, errors } = await openPage('index.html?test', { width: 1920, height: 1080 });
    await page.waitForFunction(() => window.__range && window.__range.ready, null, { timeout: 10000 });
    const r = await page.evaluate(async () => {
      const R = window.__range;
      R.selectGun(4); // 50-round gun
      document.getElementById('menu').hidden = true;
      // Fill the wall with holes first so the instanced mesh is at its cap.
      R.manual(true); R.setAim(0, 0);
      for (let m = 0; m < 3; m++) { R.trigger(true); R.step(10); R.trigger(false); R.reload(); R.step(6); }
      R.manual(false);
      await new Promise((ok) => setTimeout(ok, 500));
      if (window.gc) window.gc();
      const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const intervals = [];
      let last = 0;
      R.trigger(true);
      await new Promise((ok) => {
        const t0 = performance.now();
        function f(now) {
          if (last) intervals.push(now - last);
          last = now;
          if (now - t0 < 5000) requestAnimationFrame(f); else ok();
        }
        requestAnimationFrame(f);
      });
      R.trigger(false);
      if (window.gc) window.gc();
      const heap1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const gl = document.getElementById('view').getContext('webgl2');
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return {
        intervals, cpu: R.cpuFrameMs(), heapDelta: heap1 - heap0, info: R.renderInfo(),
        gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?',
      };
    });
    const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    const avgInt = r.intervals.reduce((a, b) => a + b, 0) / r.intervals.length;
    console.log('  GPU: ' + r.gpu);
    console.log('  render ' + r.info.w + 'x' + r.info.h + ', ' + r.info.calls + ' draw calls, ' + r.info.tris + ' triangles');
    console.log('  frames: ' + r.intervals.length + ', avg ' + avgInt.toFixed(2) + ' ms (' + (1000 / avgInt).toFixed(0) + ' fps), p99 ' + pct(r.intervals, 0.99).toFixed(2) + ' ms');
    console.log('  CPU per frame (update + render submit): median ' + pct(r.cpu, 0.5).toFixed(3) + ' ms, p95 ' + pct(r.cpu, 0.95).toFixed(3) + ' ms');
    console.log('  JS heap change over 5 s of firing (after GC): ' + (r.heapDelta / 1024).toFixed(1) + ' KB');
    check('draw calls <= 38 (indoor hall, target, 3D weapon model and sight)', r.info.calls <= 38, 'calls ' + r.info.calls);
    check('render size 1920x1080 at devicePixelRatio 1', r.info.w === 1920 && r.info.h === 1080, r.info.w + 'x' + r.info.h);
    // Median = our JavaScript per frame. The p95 is dominated by the software renderer
    // blocking on GPU work, so it is reported, not checked.
    check('CPU median under 3 ms', pct(r.cpu, 0.5) < 3, 'median ' + pct(r.cpu, 0.5));

    // Scope overlay cost: 4 s at hip, then 4 s aimed with the 2.5x sight with the overlay shown
    // and with it hidden. Aimed vs aimed isolates the overlay from the cost of the zoomed view.
    const cmp = await page.evaluate(async () => {
      const R = window.__range;
      R.selectGun(1); R.setOptic('mag_a');
      const measure = async (ads, quality) => {
        R.setAds(ads);
        R.setLensQuality(quality);
        await new Promise((ok) => setTimeout(ok, 800)); // let the ADS blend finish
        const ints = []; let last = 0;
        await new Promise((ok) => {
          const t0 = performance.now();
          function f(now) { if (last) ints.push(now - last); last = now; if (now - t0 < 4000) requestAnimationFrame(f); else ok(); }
          requestAnimationFrame(f);
        });
        const avg = ints.reduce((a, b) => a + b, 0) / ints.length;
        return { fps: 1000 / avg, lens: R.overlayVisible(), calls: R.renderInfo().calls };
      };
      const hip = await measure(false, '3');
      const ads = await measure(true, '3');
      const adsLow = await measure(true, '0');
      R.setLensQuality('auto');
      R.setAds(false);
      return { hip, ads, adsLow };
    });
    console.log('  hip (no lens pass):       ' + cmp.hip.fps.toFixed(1) + ' fps, ' + cmp.hip.calls + ' draw calls');
    console.log('  aimed, lens quality 3:    ' + cmp.ads.fps.toFixed(1) + ' fps, ' + cmp.ads.calls + ' draw calls');
    console.log('  aimed, lens quality 0:    ' + cmp.adsLow.fps.toFixed(1) + ' fps, ' + cmp.adsLow.calls + ' draw calls');
    check('lens pass only while aiming', !cmp.hip.lens && cmp.ads.lens, JSON.stringify(cmp));
    // The scene is drawn once: aiming adds only the post passes (copy, 2 blur, composite).
    check('aiming adds at most 4 draw calls (no second scene render)', cmp.ads.calls - cmp.hip.calls <= 4 && cmp.adsLow.calls - cmp.hip.calls <= 1, JSON.stringify(cmp));
    // Graphics quality: high swaps to PBR + shadows + tone mapping and back without errors,
    // and the hip frame keeps the same draw calls plus the shadow pass.
    // High and Ultra need the Enhanced Graphics pack: install it from the test server.
    const inst = await page.evaluate(() => window.__range.hdInstall());
    check('Enhanced Graphics pack installs (for High / Ultra)', inst.ok && inst.guns, JSON.stringify(inst));
    const gq = await page.evaluate(() => {
      const R = window.__range;
      R.setAds(false); R.step(0.5); R.renderFrame();
      const std = R.renderInfo().calls;
      R.setGraphics('high'); R.renderFrame();
      const hi = { calls: R.renderInfo().calls, tone: R.toneMapping(), shadows: R.shadowCasters() };
      R.setAds(true); R.step(0.5); R.renderFrame(); R.setAds(false); R.step(0.5);
      R.setGraphics('standard'); R.renderFrame();
      return { std, hi, back: R.renderInfo().calls, toneBack: R.toneMapping() };
    });
    check('high graphics: tone mapping on, shadows cast (' + gq.hi.calls + ' calls vs ' + gq.std + ')', gq.hi.tone !== 0 && gq.hi.shadows > 0, JSON.stringify(gq));
    check('back to standard graphics restores the original look', gq.toneBack === 0 && gq.back === gq.std, JSON.stringify(gq));

    // Ultra: GPU-baked skins and detail (small sizes here: software rendering), the slot's
    // skin named in the HUD, and back to standard without errors.
    const uq = await page.evaluate(() => {
      const R = window.__range;
      R.setGraphics('ultra'); R.selectGun(5); R.step(1); R.renderFrame();
      const info = document.getElementById('gun-info').textContent;
      R.selectGun(8); R.step(1); R.renderFrame();
      const info2 = document.getElementById('gun-info').textContent;
      R.setGraphics('standard'); R.selectGun(0); R.step(1); R.renderFrame();
      return { info, info2, tone: R.toneMapping() };
    });
    check('ultra graphics: each slot has its own skin (' + uq.info.split(' · ').pop() + ', ' + uq.info2.split(' · ').pop() + ')',
      /Teal Hexcore/.test(uq.info) && /Carbon Weave/.test(uq.info2) && uq.tone === 0, JSON.stringify(uq));

    // Weapon animations: a shot shows the muzzle flash, kicks the bolt and ejects brass; a
    // reload drops the magazine out of sight and puts it back; switching guns draws the new one.
    const an = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.setAnimations(true); R.selectGun(2); R.step(1); R.clear();
      R.trigger(true); R.step(0.01, 1000); R.trigger(false);
      const shot = R.rig();
      R.step(0.6);
      const after = R.rig();
      R.reload();
      const seen = { minY: 0, hidden: false };
      for (let i = 0; i < 400 && R.state().reloading; i++) { R.step(0.01); const r = R.rig(); seen.minY = Math.min(seen.minY, r.magY); seen.hidden = seen.hidden || !r.magVisible; }
      R.step(0.1);
      const done = R.rig();
      R.selectGun(3); const draw0 = R.rig().drawT; R.step(1); const draw1 = R.rig().drawT;
      R.setAnimations(false); R.trigger(true); R.step(0.01, 1000); R.trigger(false); const off = R.rig(); R.setAnimations(true);
      R.step(1);
      return { shot, after, seen, done, draw0, draw1, off };
    });
    check('animations: shot -> flash, bolt back, brass; all gone 0.6 s later', an.shot.flash && an.shot.boltZ > 0.01 && an.shot.brass === 1 && !an.after.flash && an.after.brass === 0, JSON.stringify(an));
    check('animations: reload drops the magazine and puts it back', an.seen.minY < -0.2 && an.seen.hidden && an.done.magY === 0 && an.done.magVisible, JSON.stringify(an.seen) + JSON.stringify(an.done));
    check('animations: a new gun is drawn (0 -> 1); animations off -> no flash or brass', an.draw0 === 0 && an.draw1 === 1 && !an.off.flash && an.off.brass === 0, JSON.stringify(an));

    // Low graphics: flat materials, one light, cheapest lens path; back to standard after.
    const lw = await page.evaluate(() => {
      const R = window.__range;
      R.setGraphics('low'); R.step(0.1); R.renderFrame();
      const out = { lens: R.lensQuality(), tone: R.toneMapping(), key: R._range.key.visible, textured: 0 };
      R._range.scene.traverse((o) => { if (o.isMesh && o.material.map && o.material.isMeshLambertMaterial && !o.material.userData.keepInLow) out.textured++; });
      R.setGraphics('standard'); R.renderFrame();
      out.keyBack = R._range.key.visible;
      return out;
    });
    check('low graphics: flat colours (no decorative textures), one light, lens quality 0', lw.lens === 0 && lw.tone === 0 && !lw.key && lw.textured === 0 && lw.keyBack, JSON.stringify(lw));

    // Battle mode.
    const bt = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true);
      const out = {};
      R.battleStart({ opponent: 'bots', bots: 3, level: 'easy', kills: 30 });
      const B = R.battle(), A = B.arena;
      out.path = A.findPath(-10, 12.5, 10, -12.5).length;
      out.wallBlocks = !A.sightLine([12, 1.5, 3.5], [6, 1.5, 3.5]);       // tall wall at x = 9
      out.lowWallCrouch = !A.sightLine([1, 0.9, 7.5], [1, 0.9, 5.5]);      // low wall at z = 6.5 hides a crouched head
      out.lowWallStand = A.sightLine([1, 1.6, 7.5], [1, 1.6, 5.5]);        // ...but not a standing one
      const p0 = B.bots.map((b) => [b.f.x, b.f.z]);
      R.step(8, 30);
      out.botsMoved = B.bots.filter((b, i) => Math.hypot(b.f.x - p0[i][0], b.f.z - p0[i][1]) > 1).length;
      out.inBounds = B.fighters.every((f) => Math.abs(f.x) < A.hx && Math.abs(f.z) < A.hz);
      out.notInCover = B.fighters.every((f) => !A.boxes.some((b) => b.maxY > f.y + 0.46 && b.minY < f.y + 1.75 && f.x > b.minX && f.x < b.maxX && f.z > b.minZ && f.z < b.maxZ));
      // Your shots: a frozen bot in the open lane, tapped at the chest from 10 m.
      const h = B.humans[0], bot = B.bots[0];
      for (const b of B.bots) b.update = () => {};
      // (bots may have shot you while roaming above: start the feed and score clean)
      B.feed.length = 0; B._renderFeed(); h.f.kills = 0; B.teamScore.p1 = 0;
      for (const b of B.bots.slice(1)) { b.f.x = -16; b.f.z = -12; }
      h.respawn(16, 12, B.t, 0);
      h.f.protectUntil = 0; h.f.health = 100; h.f.alive = true;
      bot.f.x = 16; bot.f.z = 2; bot.f.protectUntil = 0; bot.f.health = 100; bot.f.alive = true; bot.f.crouch = 0;
      let taps = 0;
      while (bot.f.alive && taps < 40) {
        h.look.setAngles(0, Math.atan2(1.18 - 1.6, 10) * 180 / Math.PI);
        B.mouseButton(0, true); R.step(1 / 60, 60); B.mouseButton(0, false); R.step(0.5, 60); taps++;   // spray resets after 0.4 s
      }
      out.killed = !bot.f.alive; out.taps = taps; out.kills = h.f.kills; out.score = B.teamScore.p1;
      out.feed = B.hud.feed.children.length;
      R.step(3.2, 30);
      out.respawned = bot.f.alive && bot.f.health === 100;
      R.battleLeave();
      // Win: first to 1.
      R.battleStart({ opponent: 'bots', bots: 1, level: 'easy', kills: 5 });
      const B2 = R.battle();
      B2.opts.killsToWin = 1;
      const b2 = B2.bots[0]; b2.update = () => {}; b2.f.protectUntil = 0;
      B2._damage(b2.f, 500, B2.humans[0].f, 'head', R.now ? R.now() : 0);
      out.over = B2.over; out.endShown = !B2.hud.end.hidden; out.endTitle = B2.hud.endTitle.textContent;
      R.battleLeave();
      out.rangeBack = !document.getElementById('hud').hidden && !B2.active;
      return out;
    });
    check('battle: paths across the arena; a tall wall blocks sight, a low wall hides a crouched head only',
      bt.path > 1 && bt.wallBlocks && bt.lowWallCrouch && bt.lowWallStand, JSON.stringify(bt));
    check('battle: bots roam on their own, stay in bounds and never inside cover', bt.botsMoved >= 2 && bt.inBounds && bt.notInCover, JSON.stringify(bt));
    check('battle: tapping a bot at 10 m kills it (' + bt.taps + ' taps), scores, shows in the kill feed, it respawns at full health',
      bt.killed && bt.kills === 1 && bt.score === 1 && bt.feed === 1 && bt.respawned, JSON.stringify(bt));
    check('battle: first to the kill target wins, end screen shown, leaving returns to the range', bt.over && bt.endShown && /You win/.test(bt.endTitle) && bt.rangeBack, JSON.stringify(bt));

    // Maps: every map builds, bots roam it, nobody stands inside cover, paths cross it.
    const mp = await page.evaluate(() => {
      const R = window.__range;
      const out = {};
      for (const map of ['yard', 'winter', 'casino', 'school']) {
        R.battleStart({ opponent: 'bots', bots: 3, level: 'easy', kills: 99, map });
        const B = R.battle(), A = B.arena;
        const p0 = B.bots.map((b) => [b.f.x, b.f.z]);
        R.step(6, 30);
        out[map] = {
          id: A.mapId, cover: A.boxes.length,
          path: A.findPath(-A.hx + 2, A.hz - 1.5, A.hx - 2, -A.hz + 1.5).length,
          moved: B.bots.filter((b, i) => Math.hypot(b.f.x - p0[i][0], b.f.z - p0[i][1]) > 1).length,
          inCover: B.fighters.filter((f) => A.boxes.some((b) => b.maxY > f.y + 0.46 && b.minY < f.y + 1.75 && f.x > b.minX && f.x < b.maxX && f.z > b.minZ && f.z < b.maxZ)).length,
        };
        R.battleLeave();
      }
      return out;
    });
    check('maps: Container Yard, Winter Cabin, Jesse\'s Casino and School Basement build; bots roam; paths cross; nobody inside cover',
      Object.entries(mp).every(([k, v]) => v.id === k && v.cover > 10 && v.path > 1 && v.moved >= 2 && v.inCover === 0), JSON.stringify(mp));

    // Bot levels: time for one bot to kill you standing in the open at 12 m.
    const lv = await page.evaluate(() => {
      const R = window.__range;
      const out = {};
      for (const level of ['easy', 'hard', 'terminator']) {
        const times = [];
        for (let trial = 0; trial < 9; trial++) {
          R.battleStart({ opponent: 'bots', bots: 1, level, kills: 99 });
          const B = R.battle(), h = B.humans[0], bot = B.bots[0];
          R.step(0.1);
          h.f.x = 16; h.f.z = 12; h.f.protectUntil = 0;
          bot.f.x = 16; bot.f.z = 0; bot.f.yaw = 180; bot.f.protectUntil = 0; bot.target = null; bot.nextLook = 0;
          let t = 0;
          while (h.f.alive && t < 15) { R.step(0.05, 60); t += 0.05; }
          times.push(t);
          R.battleLeave();
        }
        times.sort((a, b) => a - b);
        out[level] = +times[4].toFixed(2);      // median of 9 (a strafing bot can briefly duck behind cover)
      }
      return out;
    });
    check('bot levels: easy takes longer to kill you than hard (median ' + lv.easy + ' s vs ' + lv.hard + ' s)', lv.easy > lv.hard * 1.3 && lv.hard < 3, JSON.stringify(lv));
    check('Terminator kills faster than Hard (median ' + lv.terminator + ' s)', lv.terminator < lv.hard, JSON.stringify(lv));

    // Hip fire: spread cone that blooms, stronger recoil; aimed stays exact. Auto reload.
    const hp = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(4); R.setTarget('dummy'); R.setDistance(10); R.clear(); R.setAds(false); R.step(1);
      const shoot = (n) => { R.clear(); R.clearShotPoints(); R.setAim(0, 0); R.trigger(true); R.step(n * 60 / 850 + 0.01, 1000); R.trigger(false); R.step(0.6); return R.shotPoints(); };
      R.setHip(false, 1);
      const exact = shoot(8);
      R.setHip(false, 1.8);
      const strong = shoot(8);                 // hip recoil alone (no spread): the climb
      R.setHip(true, 1.8);
      const c0 = R.spreadCone();
      const hip = shoot(8);
      // spread: first shots scatter around the crosshair; recoil: the climb is bigger
      const firstDev = Math.hypot(hip[0][0] - exact[0][0], hip[0][1] - exact[0][1]);
      const climbExact = exact[7][1] - exact[0][1], climbHip = strong[7][1] - strong[0][1];
      R.trigger(true); R.step(0.3, 1000);
      const bloomed = R.spreadCone();
      R.trigger(false); R.step(2);
      const recovered = R.spreadCone();
      R.setAds(true); R.step(1);
      const aimedCone = R.spreadCone();
      R.setAds(false); R.step(1);
      // auto reload: empty the magazine; the reload starts by itself, then the gun is full
      R.setSetting('autoReload', true);
      R.trigger(true);
      for (let i = 0; i < 400 && R.state().ammo > 0; i++) R.step(0.02, 500);
      R.trigger(false); R.step(0.05);
      const reloading = R.state().reloading;
      R.step(5);
      const refilled = R.state().ammo;
      R.setSetting('autoReload', false);
      R.setHip(false, 1);
      return { c0, firstDev, climbExact, climbHip, bloomed, recovered, aimedCone, reloading, refilled };
    });
    check('hip fire: a spread cone (' + hp.c0.toFixed(1) + ' deg) that blooms while firing (' + hp.bloomed.toFixed(1) + ') and recovers; none when aimed',
      hp.c0 > 2 && hp.bloomed > hp.c0 + 1 && Math.abs(hp.recovered - hp.c0) < 0.01 && hp.aimedCone === 0, JSON.stringify(hp));
    check('hip fire recoil 1.8x the measured climb (' + hp.climbHip.toFixed(2) + ' m vs ' + hp.climbExact.toFixed(2) + ' m at 10 m)',
      Math.abs(hp.climbHip / hp.climbExact - 1.8) < 0.2, JSON.stringify(hp));
    check('auto reload: an empty magazine reloads by itself', hp.reloading && hp.refilled > 0, JSON.stringify(hp));

    // Skins, packs, points and save codes.
    const pk = await page.evaluate(() => {
      const R = window.__range, P = R.profile(), U = R.packs();
      const out = {};
      out.catalogue = document.querySelectorAll('#packs-root').length === 1;
      P.reset(); P.save();
      out.cantOpen = U.open() === null;
      P.addPoints(250);
      const res = U.open();
      out.spinning = !U.modal.hidden && U.strip.children.length > 40;
      out.winCard = U.strip.children[50].textContent === res.skin.name;
      U._finish();
      out.revealed = !U.reveal.hidden && U.reveal.textContent.includes(res.skin.name);
      U.close();
      out.points = P.points;
      out.owned = P.ownedCount;
      // equip on the selected gun: the gun model rebuilds with the skin; HUD names it
      const skinSlot = res.skin.guns?.[0] ?? 2;
      R.selectGun(skinSlot);
      P.equip(skinSlot, res.skin.id); U.onEquip(skinSlot);
      out.hud = document.getElementById('gun-info').textContent;
      out.skinName = res.skin.name;
      // save code round trip, and a damaged code is refused
      const code = P.saveCode();
      out.codeLen = code.length;
      const snap = JSON.stringify([P.points, P.ownedIds(), P.equipped]);
      P.reset();
      P.loadCode(code);
      out.roundTrip = JSON.stringify([P.points, P.ownedIds(), P.equipped]) === snap;
      try { P.loadCode(code.slice(0, -4) + (code.at(-4) === 'A' ? 'B' : 'A') + code.slice(-3)); out.badAccepted = true; } catch (e) { out.badAccepted = false; }
      // an old version-1 save code (200 skins) still loads
      const v1 = 'RRS1-AR4AAAAAAAAACAAAAQAQiAJAAAAAgAIAAAAAAEAA____I________wEAAAAKACa0';
      try { P.loadCode(v1); out.v1 = P.points === 30 && P.ownedCount === 10; } catch (e) { out.v1 = 'ERR ' + e.message; }
      // a battle kill earns points (and a win)
      const before = P.points;
      R.battleStart({ opponent: 'bots', bots: 1, level: 'easy', kills: 1 });
      const Bt = R.battle(); Bt.bots[0].update = () => {}; Bt.bots[0].f.protectUntil = 0;
      Bt._damage(Bt.bots[0].f, 500, Bt.humans[0].f, 'head', R.now());
      out.earned = P.points - before;
      out.endNote = Bt.hud.endNote.textContent;
      R.battleLeave();
      P.reset(); P.save(); U.refresh(); R.selectGun(0);
      return out;
    });
    check('packs: need ' + 100 + ' points; the reel lands on the won skin; reveal shows it', pk.cantOpen && pk.spinning && pk.winCard && pk.revealed && pk.owned === 1 && pk.points >= 150, JSON.stringify(pk));
    check('equipped skin is on the gun and named in the HUD (' + pk.skinName + ')', pk.hud.includes(pk.skinName), JSON.stringify(pk));
    check('save code (' + pk.codeLen + ' characters) restores everything; a damaged code is refused; old codes load', pk.roundTrip && !pk.badAccepted && pk.v1 === true, JSON.stringify(pk));
    check('a headshot kill (+30) and the win (+50) earn points, shown on the end screen', pk.earned === 80 && /earned 80 points/.test(pk.endNote), JSON.stringify(pk));


    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }


} finally { await browser.close(); server.close(); }
process.exit(failures ? 1 : 0);
