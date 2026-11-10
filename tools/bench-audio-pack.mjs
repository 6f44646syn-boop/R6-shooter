// Measures audio-node construction and OfflineAudioContext rendering, not game FPS.
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { startServer } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startServer(8154);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8154/tests/unit.html');
  const result = await page.evaluate(async () => {
    const { Sfx } = await import('/js/audio/sfx.js?v=m8-audio-1');
    const bytes = await (
      await fetch('/packs/audio/recoil-range-audio-v1.rra')
    ).arrayBuffer();
    const prepare = new Sfx();
    prepare._setup(new OfflineAudioContext(2, 48000, 48000));
    const begin = performance.now();
    await prepare.installPack(bytes);
    const decodeMs = performance.now() - begin,
      pack = prepare.samplePack;
    const route = {
      position: [5, 1.6, -5],
      cutoff: 3000,
      pan: 0.7,
      priority: 3,
    };
    const median = (a) =>
      [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
    function construct(sampled, count) {
      const s = new Sfx();
      s._setup(new OfflineAudioContext(2, 48000, 48000));
      if (sampled) s.samplePack = pack;
      const start = performance.now();
      for (let i = 0; i < count; i++) s.shot(0.5, 0.7, route);
      const ms = performance.now() - start;
      const nodesPerVoice = [...s.voices][0].nodes.length,
        sourcesPerVoice = [...s.voices][0].sources.length;
      s.stopAll();
      return { ms, nodesPerVoice, sourcesPerVoice };
    }
    construct(false, 200);
    construct(true, 200);
    const synthetic = [],
      sampled = [];
    let a, b;
    for (let i = 0; i < 9; i++) {
      if (i % 2) {
        b = construct(true, 400);
        a = construct(false, 400);
      } else {
        a = construct(false, 400);
        b = construct(true, 400);
      }
      synthetic.push(a.ms);
      sampled.push(b.ms);
      await new Promise((r) => setTimeout(r, 0));
    }
    async function render(sampled) {
      const c = new OfflineAudioContext(2, 48000, 48000),
        s = new Sfx();
      s._setup(c);
      if (sampled) s.samplePack = pack;
      for (let i = 0; i < 32; i++) s.shot(0.5, 0.7, route);
      const t = performance.now();
      await c.startRendering();
      return performance.now() - t;
    }
    await render(false);
    await render(true);
    const synthRender = [],
      sampleRender = [];
    for (let i = 0; i < 5; i++) {
      if (i % 2) {
        sampleRender.push(await render(true));
        synthRender.push(await render(false));
      } else {
        synthRender.push(await render(false));
        sampleRender.push(await render(true));
      }
    }
    return {
      method:
        'Nine interleaved batches of 400 shots for graph construction/voice recycling; five interleaved one-second offline renders with 32 HRTF+lowpass voices. Warm-up excluded. No game FPS measurement.',
      browser: navigator.userAgent,
      packBytes: bytes.byteLength,
      clipCount: pack.clipCount,
      decodedPcmBytes: pack.manifest.clips.reduce(
        (n, c) => n + c.frames * 4,
        0,
      ),
      decodeWallMs: decodeMs,
      procedural: {
        nodesPerVoice: a.nodesPerVoice,
        sourcesPerVoice: a.sourcesPerVoice,
        constructionMedianMs: median(synthetic),
        constructionRunsMs: synthetic,
        offlineRenderMedianMs: median(synthRender),
        offlineRenderRunsMs: synthRender,
      },
      packed: {
        nodesPerVoice: b.nodesPerVoice,
        sourcesPerVoice: b.sourcesPerVoice,
        constructionMedianMs: median(sampled),
        constructionRunsMs: sampled,
        offlineRenderMedianMs: median(sampleRender),
        offlineRenderRunsMs: sampleRender,
      },
    };
  });
  writeFileSync(
    'packs/audio/benchmark.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        packBytes: result.packBytes,
        clips: result.clipCount,
        decodedPcmBytes: result.decodedPcmBytes,
        decodeWallMs: result.decodeWallMs,
        procedural: result.procedural,
        packed: result.packed,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  server.close();
}
