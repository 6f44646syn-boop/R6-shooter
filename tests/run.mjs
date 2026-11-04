// Headless Chrome test runner (dev only).
//   node tests/run.mjs            unit tests + magazine simulation + frame-time check
//
// Needs Playwright with a Chromium build available to Node. Playwright is NOT a dependency of
// the site: the published folder never loads it. If it is not installed globally, run
// `npm i -D playwright` in a scratch folder or use your own Chrome via PLAYWRIGHT_CHROMIUM.
import { createRequire } from 'node:module';
import { startServer } from '../tools/serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('Playwright is not installed. See the comment at the top of tests/run.mjs.'); process.exit(2); }

const PORT = 8123;
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
  return { page, errors, external };
}

try {
  /* ---------- 1. unit tests ---------- */
  console.log('Unit tests (tests/unit.html)');
  {
    const { page, errors } = await openPage('tests/unit.html');
    await page.waitForFunction(() => window.__results, null, { timeout: 10000 });
    const results = await page.evaluate(() => window.__results);
    for (const r of results) r.ok ? ok(r.name) : fail(r.name, r.msg);
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

  /* ---------- 2. full-magazine simulation ---------- */
  console.log('\nMagazine simulation (index.html?test&seed=1234)');
  {
    const { page, errors, external } = await openPage('index.html?test&seed=1234');
    await page.waitForFunction(() => window.__range && window.__range.ready, null, { timeout: 10000 });

    // Fire one full magazine of gun `idx`, aim fixed at (0, 0), no compensation.
    const fireMag = (idx, opts = {}) => page.evaluate(([idx, opts]) => {
      const R = window.__range;
      R.manual(true);
      R.selectGun(idx);
      R.setDistance(opts.distance || 10);
      R.clear();
      R.setAim(0, 0);
      if (opts.noJitter) { R.guns[idx]._j = R.guns[idx].jitter; R.guns[idx].jitter = { yawDeg: 0, pitchDeg: 0 }; }
      R.trigger(true);
      const g = R.guns[idx];
      R.step(g.magSize * 60 / g.rpm + 0.5, opts.fps || 60);
      R.trigger(false);
      if (opts.noJitter) R.guns[idx].jitter = R.guns[idx]._j;
      return { holes: R.holes(), state: R.state(), gun: { sprayPath: g.sprayPath, magSize: g.magSize, jitter: g.jitter } };
    }, [idx, opts]);

    // a) jitter off: every hole must sit exactly where sprayPath says.
    for (const idx of [0, 3, 7]) {
      const d = 10;
      const r = await fireMag(idx, { noJitter: true, distance: d });
      const p = r.gun.sprayPath;
      let worst = 0;
      r.holes.forEach(([x, y], i) => {
        // extrapolate like the engine past the end of sprayPath
        let yaw, pitch;
        if (i < p.length) { [yaw, pitch] = p[i]; }
        else {
          const n = p.length, k = Math.min(3, n - 1);
          const sy = (p[n - 1][0] - p[n - 1 - k][0]) / k, sp = (p[n - 1][1] - p[n - 1 - k][1]) / k;
          yaw = p[n - 1][0] + sy * (i - n + 1); pitch = p[n - 1][1] + sp * (i - n + 1);
        }
        const yr = yaw * Math.PI / 180, pr = pitch * Math.PI / 180;
        const ex = d * Math.tan(yr), ey = EYE + d * Math.tan(pr) / Math.cos(yr);
        worst = Math.max(worst, Math.hypot(x - ex, y - ey));
      });
      check('gun ' + (idx + 1) + ': ' + r.holes.length + ' holes = magSize ' + r.gun.magSize, r.holes.length === r.gun.magSize, 'got ' + r.holes.length);
      check('gun ' + (idx + 1) + ': holes match sprayPath (worst error ' + (worst * 1000).toFixed(4) + ' mm)', worst < 1e-5, 'worst error ' + worst + ' m');
    }

    // b) fixed seed: identical sprays; jitter actually moves holes.
    const s1 = await fireMag(0), s2 = await fireMag(0);
    check('seed 1234 used', s1.state.seed === 1234, 'seed ' + s1.state.seed);
    check('same seed -> identical hole positions', JSON.stringify(s1.holes) === JSON.stringify(s2.holes), 'sprays differ');
    const clean = await fireMag(0, { noJitter: true });
    const moved = s1.holes.some(([x, y], i) => Math.hypot(x - clean.holes[i][0], y - clean.holes[i][1]) > 1e-4);
    check('jitter changes the spray', moved, 'no hole moved');

    // c) frame-rate independence: 30 fps vs 144 fps give the same holes.
    const f30 = await fireMag(1, { fps: 30 }), f144 = await fireMag(1, { fps: 144 });
    let wf = 0;
    f30.holes.forEach(([x, y], i) => { wf = Math.max(wf, Math.hypot(x - f144.holes[i][0], y - f144.holes[i][1])); });
    check('30 fps and 144 fps sprays match (worst ' + (wf * 1000).toFixed(4) + ' mm)', f30.holes.length === f144.holes.length && wf < 1e-5, 'worst ' + wf);

    // d) rate of fire: 750 rpm held for exactly 1 s from the first shot = 13 shots (0 ... 0.96 s).
    const rate = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(0); R.clear(); R.setAim(0, 0);
      R.trigger(true); R.step(1.0 + 1e-6, 1000); R.trigger(false);
      return R.state().shots;
    });
    check('750 rpm for 1 s = 13 shots', rate === 13, 'got ' + rate);

    // e) recovery returns the offset to zero; shotIndex resets on the next shot.
    const rec = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(0); R.clear(); R.setAim(0, 0);
      R.trigger(true); R.step(0.5); R.trigger(false);
      const during = R.state().offset[1];
      R.step(3);
      return { during, after: R.state().offset };
    });
    check('recoil offset climbs while firing (' + rec.during.toFixed(3) + ' deg)', rec.during > 0.5, 'offset ' + rec.during);
    check('offset recovers to zero', Math.abs(rec.after[0]) < 1e-9 && Math.abs(rec.after[1]) < 1e-9, JSON.stringify(rec.after));

    // f) hole cap: 4 magazines of the 100-round gun -> 300 holes kept.
    const cap = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(5); R.clear(); R.setAim(0, 0);
      for (let m = 0; m < 4; m++) { R.trigger(true); R.step(10); R.trigger(false); R.reload(); R.step(6); }
      return { holes: R.holes().length, shots: R.state().shots };
    });
    check('hole cap 300 (shots ' + cap.shots + ')', cap.holes === 300 && cap.shots === 400, JSON.stringify(cap));

    // g) ADS FOV through a 2.0x optic, and look counts with the glitch guard.
    const ads = await page.evaluate(() => {
      const R = window.__range;
      R.selectGun(2); R.setAds(true);
      const f = R.state().fovH; R.setAds(false);
      return f;
    });
    const expect = 2 * Math.atan(Math.tan(Math.PI / 4) / 2) * 180 / Math.PI;
    check('ADS FOV at 90 hip, 2.0x = ' + expect.toFixed(4), Math.abs(ads - expect) < 1e-9, 'got ' + ads);

    check('no page errors', errors.length === 0, errors.join('\n'));
    check('no third-party requests', external.length === 0, external.join('\n'));
    await page.close();
  }

  /* ---------- 3. frame-time check ---------- */
  console.log('\nFrame time at 1920x1080 (headless, software GPU: treat fps as a lower bound)');
  {
    const { page, errors } = await openPage('index.html?test', { width: 1920, height: 1080 });
    await page.waitForFunction(() => window.__range && window.__range.ready, null, { timeout: 10000 });
    const r = await page.evaluate(async () => {
      const R = window.__range;
      R.selectGun(5); // 100-round gun so it keeps firing
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
    check('draw calls <= 20', r.info.calls <= 20, 'calls ' + r.info.calls);
    check('render size 1920x1080 at devicePixelRatio 1', r.info.w === 1920 && r.info.h === 1080, r.info.w + 'x' + r.info.h);
    check('CPU p95 under 4 ms', pct(r.cpu, 0.95) < 4, 'p95 ' + pct(r.cpu, 0.95));
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? '\n' + failures + ' FAILED' : '\nAll checks passed');
process.exit(failures ? 1 : 0);
