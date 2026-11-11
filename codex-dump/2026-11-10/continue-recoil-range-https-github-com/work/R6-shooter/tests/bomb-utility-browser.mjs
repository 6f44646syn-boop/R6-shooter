import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer(8156);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
let n = 0;
const check = (name, v) => {
  assert.ok(v, name);
  n++;
  console.log('PASS ' + name);
};
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'recoilRange.settings.v1',
      JSON.stringify({ graphics: 'low', renderScale: 0.5 }),
    ),
  );
  await page.goto('http://127.0.0.1:8156/index.html?test');
  await page.waitForFunction(() => window.__range?.ready);
  await page.click('[data-first-profile=mouse]');
  await page.click('[data-mode=bomb]');
  check(
    'Bomb setup explains the two-minute attack phase',
    /120 s to plant/.test(await page.locator('#md-note').textContent()),
  );
  await page.selectOption('#md-prep', '45');
  await page.click('#setup-back');
  await page.click('[data-mode=bomb]');
  check(
    'existing preparation selection is preserved independently',
    (await page.locator('#md-prep').inputValue()) === '45',
  );
  const setup = await page.evaluate(async () => {
    __range.manual(true);
    __range.audio.unlock();
    await __range.modeStart('bomb', {
      map: { bomb: 'ranch' },
      side: 'defend',
      seed: 3,
      prepTime: 45,
      op: { bomb: 'kamai' },
    });
    const G = __range.modeGame();
    for (const a of G.m.actors)
      if (a !== G.me) {
        a.brain = null;
        a.x = 36;
        a.z = 27 - a.id;
      }
    const wall = G.m.map.panels.find(
      (p) =>
        p.kind === 'soft' &&
        p.box.minZ < 1.1 &&
        p.box.maxZ > 0.9 &&
        p.box.maxX <= -22.4,
    );
    const x = (wall.box.minX + wall.box.maxX) / 2;
    Object.assign(G.h.f, { x, y: 0, z: 2.75, vx: 0, vy: 0, vz: 0 });
    Object.assign(G.me, { x, y: 0, z: 2.75, protectUntil: 1e9 });
    G.h.camY = 0;
    G.h.look.setAngles(0, 0);
    __range.step(0.2, 60);
    globalThis.__utilityWall = wall;
    return {
      reinforcements: G.me.reinf,
      hp: G.me.hp,
      wire: G.me.wire,
      prep: G.m.rules.phaseEnd,
      policy: G.m.utility,
    };
  });
  check(
    'human defender receives two reinforcements and two wire rolls',
    setup.reinforcements === 2 && setup.wire === 2 && setup.hp === 100,
  );
  await page.keyboard.down('KeyE');
  check(
    'E remains lean and does not start reinforcing',
    await page.evaluate(
      () => !__range.modeGame().me.hold && __range.modeGame().h.in.leanR,
    ),
  );
  await page.keyboard.up('KeyE');
  await page.keyboard.down('KeyF');
  const held = await page.evaluate(() => {
    __range.step(2.4, 60);
    return (
      __range.modeGame().me.hold?.type === 'reinforce' &&
      __utilityWall.kind === 'soft'
    );
  });
  check('F starts reinforcement through the actual controls binding', held);
  const complete = await page.evaluate(() => {
    __range.step(0.2, 60);
    const G = __range.modeGame();
    return __utilityWall.kind === 'reinforced' && G.me.reinf === 1;
  });
  await page.keyboard.up('KeyF');
  check('reinforcement completes at the unchanged setup duration', complete);
  const clock = await page.evaluate(() => {
    const m = __range.modeGame().m;
    m.t = m.rules.phaseEnd;
    m.rules.update();
    return { phase: m.rules.phase, remaining: m.rules.phaseEnd - m.t };
  });
  check(
    'browser simulation gives attackers exactly 120 seconds',
    clock.phase === 'action' && clock.remaining === 120,
  );
  const status = await page.evaluate(() => {
    const G = __range.modeGame(),
      A = __range.audio;
    G.me.shakeUntil = G.m.t + 7;
    G._hud(10);
    const active = {
      ...A.hearing.current,
      veil: +G.hud.disruption.style.opacity,
    };
    G.me.shakeUntil = 0;
    G._hud(10);
    const expired = {
      ...A.hearing.current,
      veil: +G.hud.disruption.style.opacity,
    };
    G.me.shakeUntil = G.m.t + 7;
    G._hud(10);
    G.pause();
    const paused = { ...A.hearing.current };
    G.resume(10);
    G.me.alive = false;
    G._hud(10);
    const dead = {
      ...A.hearing.current,
      veil: +G.hud.disruption.style.opacity,
    };
    G.me.alive = true;
    return { active, expired, paused, dead };
  });
  check(
    'Dread darkens vision and muffles hearing in the live browser',
    status.active.gain === 0.65 &&
      status.active.cutoff === 2400 &&
      status.active.veil === 0.65,
  );
  check(
    'disruption clears on expiry, pause and death',
    status.expired.gain === 1 &&
      status.expired.veil === 0 &&
      status.paused.gain === 1 &&
      status.dead.gain === 1 &&
      status.dead.veil === 0,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.evaluate(() => {
    const G = __range.modeGame();
    G.me.shakeUntil = G.m.t + 7;
    G.me.wobbleUntil = G.m.t + 5;
    const c = G.h.camera,
      before = [c.rotation.x, c.rotation.y, c.rotation.z];
    G._camera(10);
    G._hud(10);
    return {
      stable: before.every(
        (x, i) => x === [c.rotation.x, c.rotation.y, c.rotation.z][i],
      ),
      veil: +G.hud.disruption.style.opacity,
    };
  });
  check(
    'reduced motion avoids camera shake while retaining visual disruption',
    motion.stable && motion.veil > 0,
  );
  const audio = await page.evaluate(async () => {
    const { Hearing } = await import('/js/audio/hearing.js');
    async function render(hz, impaired) {
      const c = new OfflineAudioContext(1, 48000, 48000),
        input = c.createGain(),
        h = new Hearing(c, input, c.destination),
        o = c.createOscillator();
      o.frequency.value = hz;
      input.gain.value = 0.2;
      o.connect(input);
      if (impaired) h.set(0.55, 1600, true);
      o.start();
      o.stop(1);
      const data = (await c.startRendering()).getChannelData(0);
      let energy = 0;
      for (let i = 4800; i < data.length; i++) energy += data[i] * data[i];
      return energy;
    }
    return {
      clear: await render(7000, false),
      muffled: await render(7000, true),
      low: await render(400, true),
    };
  });
  check(
    'real audio filter removes high-frequency detail without silence',
    audio.clear > audio.muffled * 10 && audio.low > 0,
  );
  const other = await page.evaluate(async () => {
    await __range.modeStart('tdm', { map: { tdm: 'containers' }, seed: 3 });
    return __range.modeGame().m.utility;
  });
  check(
    'TDM keeps original utility values after switching modes',
    other.barricadeHp === 100 &&
      other.wireSpeed === 0.4 &&
      other.reinforceReach === 1.6,
  );
  check('browser has no uncaught exceptions', errors.length === 0);
  console.log(n + ' Bomb utility browser checks passed');
} finally {
  await browser.close();
  server.close();
}
