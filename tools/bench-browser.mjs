// Browser benchmarks (dev only): what each scene costs to update and draw, on every graphics
// setting, plus load times and a leak check. Used as the before/after measurement.
//   node tools/bench-browser.mjs [--json] [--quick]
// Headless Chromium draws with a software renderer here, so "drawMs" is NOT what a real
// graphics card does: use it only to compare one run with another on the same machine.
// Draw calls, triangles, geometry and texture counts, update time and memory are real.
import { createRequire } from 'node:module';
import { startServer } from './serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 8137, BASE = 'http://127.0.0.1:' + PORT + '/';
const asJson = process.argv.includes('--json'), quick = process.argv.includes('--quick');
const server = await startServer(PORT);
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = { load: {}, scenes: [], leak: [] };
const TIERS = quick ? ['standard'] : ['low', 'standard', 'high', 'ultra'];
const SCENES = [
  ['range', null], ['battle', 'yard'], ['battle', 'winter'], ['battle', 'casino'], ['battle', 'school'],
  ['tdm', 'containers'], ['tdm', 'casino'], ['ctf', 'winter'], ['ctf', 'school'], ['ctf', 'yard'],
  ['bomb', 'ranch'], ['bomb', 'embassy'], ['bomb', 'workshop'],
];
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(BASE + 'index.html?test', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__range && window.__range.ready);
  return { page, errors, readyMs: Date.now() - t0 };
}
try {
  // load time (page open to game ready) and first-match start times, cold
  {
    const { page, readyMs } = await open();
    out.load.pageReadyMs = readyMs;
    out.load.firstBombStartMs = await page.evaluate(async () => { const R = window.__range; R.manual(true); const t0 = performance.now(); await R.modeStart('bomb', { map: { tdm: 'containers', ctf: 'yard', bomb: 'ranch' } }); return Math.round(performance.now() - t0); });
    out.load.firstBattleStartMs = await page.evaluate(() => { const R = window.__range; R.battleLeave(); const t0 = performance.now(); R.battleStart({ opponent: 'bots', bots: 3, level: 'medium', kills: 99, map: 'casino' }); return Math.round(performance.now() - t0); });
    await page.close();
  }
  for (const [kind, map] of SCENES) {
    const { page, errors } = await open();
    for (const tier of TIERS) {
      const row = await page.evaluate(async ([kind, map, tier]) => {
        const R = window.__range; R.manual(true);
        R.battleLeave();
        R.setGraphics(tier);
        if (kind === 'battle') R.battleStart({ opponent: 'bots', bots: 3, level: 'medium', kills: 99, map });
        else if (kind !== 'range') { const mp = { tdm: 'containers', ctf: 'yard', bomb: 'ranch' }; mp[kind] = map; await R.modeStart(kind, { map: mp, teamSize: 5, seed: 11, abilities: { tdm: false, ctf: false, bomb: true } }); }
        const G = kind === 'range' ? null : kind === 'battle' ? R.battle() : R.modeGame();
        if (G && G.refreshGraphics) G.refreshGraphics();
        // keep the player alive and still so every tier draws the same thing
        R.step(kind === 'bomb' ? 31 : 2, 60);
        const ren = R.renderer();
        const N = 120;
        let t0 = performance.now(); R.step(N / 60, 60); const updateMs = (performance.now() - t0) / N;
        const gl = ren.getContext();
        R.renderFrame(); gl.finish();
        t0 = performance.now(); for (let i = 0; i < 6; i++) { R.renderFrame(); } gl.finish(); const drawMs = (performance.now() - t0) / 6;
        ren.info.autoReset = false; ren.info.reset(); R.renderFrame();
        const calls = ren.info.render.calls, tris = ren.info.render.triangles;
        // the whole scene from above (every object in view): the same picture on every run
        const scene = kind === 'range' ? R._range.scene : kind === 'battle' ? G.arena.scene : G.scene;
        const T = window.__THREE || (window.__THREE = await import('./vendor/three/three.module.min.js'));
        const hx = G ? (kind === 'battle' ? G.arena.hx : G.map.hx) : 12, hz = G ? (kind === 'battle' ? G.arena.hz : G.map.hz) : 30;
        const cam = new T.PerspectiveCamera(60, 16 / 9, 0.5, 600);
        cam.position.set(hx * 1.5, Math.max(hx, hz) * 1.4, hz * 1.5); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
        ren.setRenderTarget(null); ren.info.reset(); ren.render(scene, cam);
        const allCalls = ren.info.render.calls, allTris = ren.info.render.triangles; ren.info.autoReset = true;
        if (window.gc) window.gc();
        return { scene: kind + (map ? '/' + map : ''), tier, allCalls, allTris, calls, tris, geometries: ren.info.memory.geometries, textures: ren.info.memory.textures, programs: ren.info.programs.length, updateMs: +updateMs.toFixed(3), drawMs: +drawMs.toFixed(1), heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) };
      }, [kind, map, tier]);
      row.errors = errors.length;
      out.scenes.push(row);
      if (!asJson) console.log(JSON.stringify(row));
    }
    await page.close();
  }
  // leak check: the same Bomb match started 6 times in one page
  {
    const { page } = await open();
    for (let i = 0; i < 6; i++) {
      out.leak.push(await page.evaluate(async (i) => {
        const R = window.__range; R.manual(true); R.setGraphics('standard');
        await R.modeStart('bomb', { map: { tdm: 'containers', ctf: 'yard', bomb: ['ranch', 'embassy', 'workshop'][i % 3] } });
        R.step(3, 60); R.renderFrame();
        if (window.gc) { window.gc(); window.gc(); }
        const ren = R.renderer();
        return { start: i + 1, geometries: ren.info.memory.geometries, textures: ren.info.memory.textures, heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) };
      }, i));
    }
    await page.close();
  }
  if (asJson) console.log(JSON.stringify(out, null, 1));
  else { console.log('load', out.load); console.table(out.leak); }
} finally {
  await browser.close();
  server.close();
}
