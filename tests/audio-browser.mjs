import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error(
    'External Playwright tooling is required. Set NODE_PATH as described in the handoff.',
  );
  process.exit(2);
}
const server = await startServer(8151);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let checks = 0;
const check = (name, value) => {
  assert.ok(value, name);
  checks++;
  console.log('PASS ' + name);
};
try {
  await page.goto('http://127.0.0.1:8151/tests/unit.html');
  const rendered = await page.evaluate(async () => {
    const { createAcoustics } =
      await import('/js/audio/acoustics.js?v=m8-audio-1');
    const { Sfx } = await import('/js/audio/sfx.js?v=m8-audio-1');
    const audio = await createAcoustics();
    const camera = {
      position: { x: 0, y: 1.6, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const energy = (data, from = 0, to = data.length) => {
      let e = 0;
      for (let i = from; i < Math.min(to, data.length); i++)
        e += data[i] * data[i];
      return e;
    };
    async function shot(x) {
      const c = new OfflineAudioContext(2, 48000, 48000),
        s = new Sfx(audio);
      s._setup(c);
      const w = s.locate('shot', { x, y: 1.6, z: -3 }, camera, null);
      s.shot(0.5, w.gain, w.route, w.muffle);
      const hrtf = [...s.voices][0].nodes.some(
        (n) => n instanceof PannerNode && n.panningModel === 'HRTF',
      );
      const b = await c.startRendering();
      return {
        left: energy(b.getChannelData(0)),
        right: energy(b.getChannelData(1)),
        hrtf,
        voices: s.voices.size,
      };
    }
    const right = await shot(3),
      left = await shot(-3);
    async function step(kind) {
      const c = new OfflineAudioContext(2, 48000, 48000),
        s = new Sfx(audio);
      s._setup(c);
      const geometry = {
        data: { id: 'yard' },
        solids: [{ kind }],
        world: {
          hit: 0,
          raycast() {
            return 0.08;
          },
          sight() {
            return true;
          },
        },
      };
      const w = audio.locate(
        'step',
        { x: 0, y: 0.12, z: -1, feetY: 0 },
        { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 },
        geometry,
        null,
        { reach: 20 },
      );
      s.step(0.7, 0, 0, w.step);
      const b = await c.startRendering();
      return {
        total: energy(b.getChannelData(0)),
        late: energy(b.getChannelData(0), 6800, 9000),
        material: w.material,
        voices: s.voices.size,
      };
    }
    const wood = await step('wood'),
      metal = await step('metal');
    const c = new OfflineAudioContext(2, 48000, 48000),
      s = new Sfx(audio);
    s._setup(c);
    for (let i = 0; i < 300; i++) s.shot(0.5);
    s.step(0.7);
    const bounded = s.voices.size,
      stats = { ...s.stats };
    await c.startRendering();
    const drained = s.voices.size;
    const muted = new Sfx(audio);
    muted._setup(new OfflineAudioContext(2, 48000, 48000));
    muted.setVolume(0);
    muted.shot();
    return {
      right,
      left,
      wood,
      metal,
      bounded,
      stats,
      drained,
      muted: muted.voices.size,
    };
  });
  check(
    'actual HRTF graph renders a right source louder in the right channel',
    rendered.right.hrtf && rendered.right.right > rendered.right.left * 1.05,
  );
  check(
    'actual HRTF graph renders a left source louder in the left channel',
    rendered.left.hrtf && rendered.left.left > rendered.left.right * 1.05,
  );
  check(
    'ended positional voices release their nodes',
    rendered.left.voices === 0 && rendered.right.voices === 0,
  );
  check(
    'wood and metal syntheses both render audible samples',
    rendered.wood.total > 0 &&
      rendered.metal.total > 0 &&
      rendered.wood.material === 'wood' &&
      rendered.metal.material === 'metal',
  );
  check(
    'metal ringing has a longer tail than wood',
    rendered.metal.late > rendered.wood.late + 1e-12,
  );
  check(
    '300 simultaneous shots keep at most 32 voice graphs',
    rendered.bounded === 32 &&
      rendered.stats.peak === 32 &&
      rendered.stats.stolen === 268,
  );
  check(
    'lower-priority footsteps cannot evict full-priority gunfire',
    rendered.stats.culled === 1,
  );
  check(
    'all remaining voice graphs drain after rendering',
    rendered.drained === 0,
  );
  check('muting creates no audio voice graph', rendered.muted === 0);
  await page.addInitScript(() => {
    if (!localStorage.getItem('recoilRange.settings.v1'))
      localStorage.setItem(
        'recoilRange.settings.v1',
        JSON.stringify({ graphics: 'low', renderScale: 0.5 }),
      );
  });
  await page.goto('http://127.0.0.1:8151/index.html?test');
  await page.waitForFunction(() => window.__range?.ready);
  await page.click('[data-first-profile=mouse]');
  await page.click('#go-settings');
  await page.click('#m7-settings-5-tab');
  check(
    'dedicated Audio settings tab is operational',
    await page.locator('#set-spatial-audio').isVisible(),
  );
  await page.uncheck('#set-spatial-audio');
  check(
    'stereo preference applies immediately',
    await page.evaluate(() => !__range.audio.spatialAudio),
  );
  await page.reload();
  await page.waitForFunction(() => window.__range?.ready);
  check(
    'stereo preference survives reload',
    await page.evaluate(() => !__range.audio.spatialAudio),
  );
  await page.evaluate(async () => {
    __range.manual(true);
    __range.audio.unlock();
    await __range.modeStart('tdm', { map: { tdm: 'containers' }, seed: 7 });
  });
  const mode = await page.evaluate(() => {
    const G = __range.modeGame(),
      A = __range.audio;
    __range.step(0.1, 60);
    const c = G.h.camera,
      w = G._where(G.me.x + 5, G.me.z, G.me.y + 7);
    return {
      abi: A.acoustics.e.ma_abi(),
      height: w.route.position[1],
      expected: G.me.y + 7,
      listenerY: A.ctx.listener.positionY.value,
      cameraY: c.position.y,
    };
  });
  check(
    'match shot propagation preserves emitter height',
    mode.abi === 1 && mode.height === mode.expected,
  );
  check(
    'listener follows the actual match camera height',
    Math.abs(mode.listenerY - mode.cameraY) < 1e-5,
  );
  const silence = await page.evaluate(() => {
    const G = __range.modeGame(),
      A = __range.audio,
      noise = G.m.noises,
      stepTime = G._stepT;
    const enemy = G.m.actors.find((a) => a.id !== G.me.id),
      start = A.stats.played;
    G.m.noises = [
      {
        id: enemy.id,
        kind: 'steps',
        range: 0,
        x: enemy.x,
        y: enemy.y,
        z: enemy.z,
        t: 1,
        team: enemy.team,
      },
    ];
    G._stepT = 0;
    G._steps();
    G.m.noises = noise;
    G._stepT = stepTime;
    return A.stats.played === start;
  });
  check('engine silent footsteps remain silent in match playback', silence);
  const battle = await page.evaluate(() => {
    __range.battleLeave();
    __range.battleStart({ opponent: 'bots', bots: 1, map: 'yard', kills: 99 });
    const B = __range.battle(),
      A = __range.audio,
      f = B.bots[0].f;
    const old = A.shot;
    let captured = null;
    A.shot = (tone, gain, route) => (captured = { gain, route });
    B._shotSound(f, B.t, [5, 9, -4]);
    A.shot = old;
    return captured;
  });
  check(
    'Battle remote-shot playback uses the full trace origin',
    battle.route.position.join(',') === '5,9,-4',
  );
  const cadence = await page.evaluate(() => {
    const A = __range.audio,
      camera = {
        position: { x: 0, y: 1.6, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      };
    A.stopAll();
    const start = A.stats.played;
    for (let i = 0; i <= 60; i++)
      A.observeSteps(
        [
          {
            id: 99,
            x: i * 0.05,
            y: 0,
            z: -3,
            crouch: 0,
            alive: true,
            team: 'remote',
          },
        ],
        camera,
        null,
        i / 60,
        null,
        1,
      );
    const emitted = A.stats.played - start;
    A.stopAll();
    return { emitted, left: A.voices.size };
  });
  check(
    'shared actor-pose path generates positional steps',
    cadence.emitted === 2 && cadence.left === 0,
  );
  check('no browser exceptions', errors.length === 0);
  console.log(`${checks} audio browser checks passed`);
} finally {
  await browser.close();
  server.close();
}
