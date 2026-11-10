import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer(8155);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
let n = 0;
const check = (name, v) => {
  assert.ok(v, name);
  n++;
  console.log('PASS ' + name);
};
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8155/tests/unit.html');
  const result = await page.evaluate(async () => {
    const { Sfx } = await import('/js/audio/sfx.js?v=m8-audio-1');
    const { createAcoustics } =
      await import('/js/audio/acoustics.js?v=m8-audio-1');
    const audio = await createAcoustics();
    const bytes = await (
      await fetch('/packs/audio/recoil-range-audio-v1.rra')
    ).arrayBuffer();
    const c = new OfflineAudioContext(2, 48000, 48000),
      s = new Sfx(audio);
    s._setup(c);
    const installed = await s.installPack(bytes);
    const bank = s.samplePack,
      a = bank.pick('shot:0.500'),
      b = bank.pick('shot:0.500'),
      d = bank.pick('shot:0.500'),
      again = bank.pick('shot:0.500');
    let badRejected = false;
    try {
      await s.installPack(bytes.slice(0, -1));
    } catch {
      badRejected = true;
    }
    const atomic = s.samplePack === bank;
    const camera = {
      position: { x: 0, y: 1.6, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const w = s.locate('shot', { x: 3, y: 1.6, z: -3 }, camera, null);
    s.shot(0.5, w.gain, w.route, w.muffle);
    const voice = [...s.voices][0],
      nodes = voice.nodes.length,
      sources = voice.sources.length;
    const profile = { material: 'metal', ...bank.manifest.profiles.metal };
    const supports = bank.supportsStep(profile);
    s.step(0.4, 0, 0, profile);
    const stepSources = [...s.voices][1].sources.length;
    s.shot(0.333);
    const fallbackSources = [...s.voices][2].sources.length;
    const before = s.locate('shot', { x: 3, y: 1.6, z: -3 }, camera, null);
    s.removePack();
    const after = s.locate('shot', { x: 3, y: 1.6, z: -3 }, camera, null);
    const rendered = await c.startRendering();
    const energy = (data) => data.reduce((s, x) => s + x * x, 0);
    const checkCtx = new OfflineAudioContext(2, 48000, 48000),
      verify = new Sfx(audio);
    verify._setup(checkCtx);
    await verify.installPack(bytes);
    const clip = verify.samplePack.manifest.clips.find(
        (c) => c.key === 'shot:0.500',
      ),
      decoded = verify.samplePack.pick('shot:0.500');
    let peak = 0;
    for (const x of decoded.getChannelData(0))
      peak = Math.max(peak, Math.abs(x));
    const loadShape = {
      clips: installed.clips,
      byteLength: installed.bytes,
      decodedPeak: peak,
      expectedPeak: clip.gain * 0.98,
    };
    return {
      loadShape,
      variation: a !== b && b !== d && again === a,
      badRejected,
      atomic,
      nodes,
      sources,
      supports,
      stepSources,
      fallbackSources,
      liveRules: JSON.stringify(before) === JSON.stringify(after),
      left: energy(rendered.getChannelData(0)),
      right: energy(rendered.getChannelData(1)),
      voices: s.voices.size,
      removed: s.samplePack === null,
    };
  });
  check(
    'optional pack loads all clips only on explicit install',
    result.loadShape.clips === 81 && result.loadShape.byteLength > 0,
  );
  check('sample bank rotates three shot variations', result.variation);
  check(
    'corrupt replacement is rejected without losing the current pack',
    result.badRejected && result.atomic,
  );
  check(
    'unoccluded packed spatial gunfire uses one source and three graph nodes',
    result.sources === 1 && result.nodes === 3,
  );
  check(
    'matching material profiles use cached footstep buffers',
    result.supports && result.stepSources === 1,
  );
  check(
    'unknown future gun tones retain procedural fallback',
    result.fallbackSources === 2,
  );
  check(
    'switching sound assets does not change acoustic rules',
    result.liveRules,
  );
  check(
    'packed audio renders audible samples',
    result.left > 0 && result.right > 0,
  );
  check(
    'cached voices release after playback and pack removal',
    result.voices === 0 && result.removed,
  );
  check(
    'PCM normalization restores source headroom',
    Math.abs(result.loadShape.decodedPeak - result.loadShape.expectedPeak) <
      0.0002,
  );
  console.log(`${n} optional audio pack browser checks passed`);
} finally {
  await browser.close();
  server.close();
}
