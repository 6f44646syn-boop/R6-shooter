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
  if (path.startsWith('index')) { await page.waitForFunction(() => window.__range?.ready); await page.locator('[data-first-profile=mouse]').click(); }
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

  /* ---------- 1b. measured sprays vs their hole pixels ---------- */
  console.log('\nMeasured sprays (data/guns.json) vs bullet-hole pixels at the aimed FOV');
  {
    const { refit } = await import('../tools/fit-lib.mjs');
    const { readFileSync } = await import('node:fs');
    const guns = JSON.parse(readFileSync(new URL('../data/guns.json', import.meta.url), 'utf8')).guns;
    for (const [i, g] of guns.entries()) {
      if (!g.measurement) continue;
      const fit = refit(g.measurement.holesPx, g.measuredAtVFov);
      const worst = fit.reduce((w, p, k) => Math.max(w, Math.abs(p[0] - g.sprayPath[k][0]), Math.abs(p[1] - g.sprayPath[k][1])), 0);
      check('slot ' + (i + 1) + ' (' + g.measuredSight + ', vFOV ' + g.measuredAtVFov + '): spray = pixels, ends ' + JSON.stringify(g.sprayPath[g.sprayPath.length - 1]),
        g.measuredAiming === true && fit.length === g.sprayPath.length && worst <= 0.011, 'worst ' + worst);
    }
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
      R.clear(); R.clearShotPoints();
      R.setAim(0, opts.pitch || 0);
      if (opts.noJitter) { R.guns[idx]._j = R.guns[idx].jitter; R.guns[idx].jitter = { yawDeg: 0, pitchDeg: 0 }; }
      R.trigger(true);
      const g = R.guns[idx];
      R.step((g.magSize + 1) * 60 / g.rpm + 0.5, opts.fps || 60);
      R.trigger(false);
      if (opts.noJitter) R.guns[idx].jitter = R.guns[idx]._j;
      // Where each shot crossed the target plane, relative to the aim point.
      return { holes: R.shotPoints(), state: R.state(), gun: { sprayPath: g.sprayPath, magSize: g.magSize, capacity: g.magSize + (g.chambered ? 1 : 0), tail: g.tail, placeholder: g.placeholder, jitter: g.jitter } };
    }, [idx, opts]);

    // a) jitter off: every hole must sit exactly where sprayPath says.
    // Slot 1 is a placeholder (extrapolated tail); slots 4 and 8 are measured ("tail": "hold",
    // chambered). Measured sprays climb ~30 deg, so aim 14 deg low at 5 m to keep every hole on the wall.
    for (const idx of [0, 3, 7]) {
      const d = 5, aimPitch = -14;
      const r = await fireMag(idx, { noJitter: true, distance: d, pitch: aimPitch });
      const p = r.gun.sprayPath;
      let worst = 0;
      r.holes.forEach(([x, y], i) => {
        let yaw, pitch;
        const n = p.length;
        if (i < n) { [yaw, pitch] = p[i]; }
        else if (r.gun.tail === 'hold') { [yaw, pitch] = p[n - 1]; }   // hold the last measured point
        else {                                                        // extrapolate like the engine
          const k = Math.min(3, n - 1);
          const sy = (p[n - 1][0] - p[n - 1 - k][0]) / k, sp = (p[n - 1][1] - p[n - 1 - k][1]) / k;
          yaw = p[n - 1][0] + sy * (i - n + 1); pitch = p[n - 1][1] + sp * (i - n + 1);
        }
        const yr = yaw * Math.PI / 180, pr = (pitch + aimPitch) * Math.PI / 180;
        const ex = d * Math.tan(yr), ey = d * Math.tan(pr) / Math.cos(yr);
        worst = Math.max(worst, Math.hypot(x - ex, y - ey));
      });
      const label = 'slot ' + (idx + 1) + (r.gun.placeholder ? ' (placeholder)' : ' (measured, tail ' + r.gun.tail + ')');
      check(label + ': ' + r.holes.length + ' holes = full magazine ' + r.gun.capacity, r.holes.length === r.gun.capacity, 'got ' + r.holes.length);
      check(label + ': holes match sprayPath (worst error ' + (worst * 1000).toFixed(4) + ' mm)', worst < 1e-5, 'worst error ' + worst + ' m');
    }

    // Chambered round: a reload with rounds left gives magSize + 1, from empty gives magSize.
    const ch = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(7); R.clear(); R.setAim(0, -14); R.setDistance(5);
      const g = R.guns[7], out = { mag: g.magSize, start: R.state().ammo };
      R.trigger(true); R.step(0.2); R.trigger(false);   // fire a few
      R.reload(); R.step(g.reloadSeconds + 0.1); out.tactical = R.state().ammo;
      R.trigger(true); R.step(10); R.trigger(false);    // empty it
      R.reload(); R.step(g.reloadSeconds + 0.1); out.empty = R.state().ammo;
      return out;
    });
    const rl = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(7); R.clear(); R.setAim(0, 0); R.setDistance(10);
      R.trigger(true); R.step(0.3); R.trigger(false);
      const g = R.guns[7];
      R.reload(); R.step(g.reloadSeconds / 2 + 0.02); const done = !R.state().reloading;
      const holesBefore = R.holes().length, statsBefore = R.state().shots;
      R.clear();
      return { done, holesBefore, statsBefore, holes: R.holes().length, pts: R.shotPoints().length, st: R.state() };
    });
    check('reload at the default 2x speed finishes in half the gun\'s reloadSeconds', rl.done, JSON.stringify(rl));
    check('clear removes every hole and all shot data (' + rl.holesBefore + ' holes, ' + rl.statsBefore + ' shots before)',
      rl.holesBefore > 0 && rl.holes === 0 && rl.pts === 0 && rl.st.shots === 0 && rl.st.hits === 0 && rl.st.headshots === 0 && rl.st.score === 0 && rl.st.shotIndex === 0, JSON.stringify(rl));
    check('chambered gun: starts ' + ch.start + ', tactical reload ' + ch.tactical + ', empty reload ' + ch.empty + ' (mag ' + ch.mag + ')',
      ch.start === ch.mag + 1 && ch.tactical === ch.mag + 1 && ch.empty === ch.mag, JSON.stringify(ch));

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
      return { shots: R.state().shots, rpm: R.guns[0].rpm };
    });
    const wantShots = Math.floor(1 / (60 / rate.rpm) + 1e-9) + 1;   // shots at t = 0, 1 interval, ... <= 1 s
    check(rate.rpm + ' rpm for 1 s = ' + wantShots + ' shots', rate.shots === wantShots, 'got ' + rate.shots);

    // e) no recovery: after you stop firing the view stays where the recoil left it.
    const rec = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(0); R.clear(); R.setAim(0, 0);
      R.trigger(true); R.step(0.5); R.trigger(false);
      const during = R.state().offset[1];
      R.step(0.1);                                   // let the last kick finish
      const stopped = R.state().viewPitch;
      R.step(3);
      const st = R.state();
      return { during, stopped, after: st.viewPitch, offset: st.offset };
    });
    check('recoil offset climbs while firing (' + rec.during.toFixed(3) + ' deg)', rec.during > 0.5, 'offset ' + rec.during);
    check('view does not drift back after firing (' + rec.stopped.toFixed(3) + ' deg up, still ' + rec.after.toFixed(3) + ' after 3 s)', Math.abs(rec.after - rec.stopped) < 1e-9 && rec.after > 0.5, JSON.stringify(rec));
    check('leftover recoil is folded into the aim after the spray', rec.offset[0] === 0 && rec.offset[1] === 0, JSON.stringify(rec));

    // Aiming: the spray follows the smoothed path (and the aimed strength); hip-fire stays exact.
    const aimSm = await page.evaluate(() => {
      const R = window.__range;
      const run = (ads, smooth) => {
        R.setAimSmooth(smooth);
        R.manual(true); R.selectGun(1); R.setOptic('mag_a'); R.setDistance(10); R.clear(); R.clearShotPoints();
        R.setAim(0, -14); R.setAds(ads); R.step(1);
        R.trigger(true); R.step(3); R.trigger(false); R.setAds(false); R.step(1);
        return R.shotPoints();
      };
      const g = R.guns[1];
      const out = { ads: run(true, false), adsSm: run(true, true), hip: run(false, true), smooth: g.sprayPathSmooth, raw: g.sprayPath };
      R.setAimSmooth(false);
      return out;
    });
    const toPlane = ([yaw, pitch]) => { const yr = yaw * Math.PI / 180, pr = (pitch - 14) * Math.PI / 180; return [10 * Math.tan(yr), 10 * Math.tan(pr) / Math.cos(yr)]; };
    const worstVs = (pts, path) => pts.slice(0, path.length).reduce((w, [x, y], i) => { const [ex, ey] = toPlane(path[i]); return Math.max(w, Math.hypot(x - ex, y - ey)); }, 0);
    check('aimed spray follows the measured path exactly by default (sprays were measured aimed)', worstVs(aimSm.ads, aimSm.raw) < 1e-5, '');
    check('optional smoothing: aimed spray follows the smoothed path', worstVs(aimSm.adsSm, aimSm.smooth) < 1e-5, '');
    check('hip-fire spray follows the measured path exactly (smoothing never applies)', worstVs(aimSm.hip, aimSm.raw) < 1e-5, '');
    const endS = aimSm.smooth[aimSm.smooth.length - 1], endR = aimSm.raw[aimSm.raw.length - 1];
    check('smoothing keeps the measured end point', Math.abs(endS[0] - endR[0]) < 1e-9 && Math.abs(endS[1] - endR[1]) < 1e-9, JSON.stringify([endS, endR]));

    // f) hole cap: 11 magazines of 30 rounds, recoil compensated -> 300 holes kept.
    const cap = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(0); R.clear(); R.setAim(0, 0); R.setDistance(10);
      // Pull down against the recoil like a player, so every bullet lands on the dummy or wall.
      for (let m = 0; m < 11; m++) {
        R.trigger(true);
        for (let i = 0; i < 100; i++) { R.step(0.05); const o = R.state().offset; R.setAim(-o[0], -o[1]); }
        R.trigger(false); R.reload(); R.step(6); R.setAim(0, 0);
      }
      return { holes: R.holes().length, shots: R.state().shots };
    });
    check('hole cap 300 (shots ' + cap.shots + ')', cap.holes === 300 && cap.shots === 330, JSON.stringify(cap));

    // g) sights: defaults, ADS zoom/FOV/sens key/speed, overlay, picker counts, gallery.
    const sc = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true);
      const out = {};
      R.selectGun(0); out.defaultDef = R.state().optic; out.rowDef = R.sightRowCount();
      R.selectGun(1); out.defaultAtt = R.state().optic; out.rowAtt = R.sightRowCount();
      out.overlayHip = R.overlayVisible();
      R.setAds(true); R.step(1);
      out.mag = R.state(); out.overlayAds = R.overlayVisible();
      R.setAds(false); R.step(1);
      R.setOptic('holo_a');
      R.setAds(true); R.step(1);
      out.holo = R.state();
      R.setAds(false); R.step(1);
      R.setOptic('mag_a');
      R.toggleGallery(true); out.gallery = R.galleryCount(); R.toggleGallery(false);
      return out;
    });
    const magFov = 83 * 0.42, holoFov = 83 * 0.9;   // data/sens.json model.adsVFovMultipliers
    check('defender slot 1 starts on holo_a, attacker slot 2 on mag_a', sc.defaultDef === 'holo_a' && sc.defaultAtt === 'mag_a', sc.defaultDef + ' / ' + sc.defaultAtt);
    check('picker lists 11 sights for a defender slot, 14 for an attacker slot', sc.rowDef === 11 && sc.rowAtt === 14, sc.rowDef + ' / ' + sc.rowAtt);
    check('mag_a: zoom 2.5, sens key 2.5x, vertical ADS FOV ' + sc.mag.fovV.toFixed(3) + ' = 83 x 0.42',
      sc.mag.zoom === 2.5 && sc.mag.sensKey === '2.5x' && Math.abs(sc.mag.fovV - magFov) < 1e-9, JSON.stringify(sc.mag));
    check('holo_a: zoom 1, vertical ADS FOV ' + sc.holo.fovV.toFixed(3) + ' = 83 x 0.9 (wider than mag_a)', sc.holo.zoom === 1 && Math.abs(sc.holo.fovV - holoFov) < 1e-9 && sc.holo.fovV > sc.mag.fovV, JSON.stringify(sc.holo));
    check('ADS ease 120-180 ms (mag ' + (sc.mag.adsTime * 1000).toFixed(0) + ' ms, holo ' + (sc.holo.adsTime * 1000).toFixed(0) + ' ms)',
      [sc.mag.adsTime, sc.holo.adsTime].every((x) => x >= 0.12 && x <= 0.18), '');

    // Sensitivity follows the FOV mid-ease, and the ease is ease-out (more than half way at half time).
    const mid = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(1); R.setOptic('mag_a'); R.setAds(false); R.step(1);
      const hip = R.state().dpc;
      R.setAds(true); R.step(1); const ads = R.state().dpc;
      R.setAds(false); R.step(1);
      R.setAds(true);
      const half = R.state().adsTime / 2;
      R.step(half, 2 / half);               // two frames, together exactly half the ease time
      const s = R.state();
      R.setAds(false); R.step(1);
      return { hip, ads, s };
    });
    const tH = Math.tan(83 * Math.PI / 360), tA = Math.tan(83 * 0.42 * Math.PI / 360), tC = Math.tan(mid.s.fovV * Math.PI / 360);
    const pf = (tH - tC) / (tH - tA);
    // Focal-length scaling (default): sensitivity = hip x tan(current FOV / 2) / tan(83 / 2).
    const want = mid.hip * tC / tH; void pf;
    check('mid-ease: FOV ' + mid.s.fovV.toFixed(2) + ' deg, eased ' + mid.s.adsE.toFixed(3) + ' at half time (snappy ease-out: 87.5%)', Math.abs(mid.s.adsE - 0.875) < 1e-9 && mid.s.fovV < 83 && mid.s.fovV > 83 * 0.42, JSON.stringify(mid.s));
    check('mid-ease sensitivity matches the FOV (' + (mid.s.dpc / mid.hip).toFixed(4) + ' x hip)', Math.abs(mid.s.dpc - want) < 1e-12, 'want ' + want + ' got ' + mid.s.dpc);

    // Auto quality: slow frames (> 20 ms average) for 2 s while aiming step down one level at a time.
    const aq = await page.evaluate(() => {
      const R = window.__range;
      R.setLensQuality('auto'); R.setAutoLevel(3);
      R.setAds(true); R.step(1);
      const levels = [R.lensQuality()];
      let now = 100000;
      for (let k = 0; k < 4; k++) { for (let i = 0; i < 100; i++) { now += 25; R.qualityTick(now, 25); } levels.push(R.lensQuality()); }
      for (let i = 0; i < 200; i++) { now += 10; R.qualityTick(now, 10); }
      levels.push(R.lensQuality());
      // Hip-relative: 18 ms aimed frames on a machine that does 10 ms at hip (> 25% slower, < 58 fps).
      R.setAutoLevel(3); R.setHipMs(10);
      for (let i = 0; i < 120; i++) { now += 18; R.qualityTick(now, 18); }
      levels.push(R.lensQuality());
      R.setAds(false); R.step(1); R.setAutoLevel(3);
      return levels;
    });
    check('auto quality: 3 -> 2 (blur off) -> 1 (fringing off) -> 0 (glare off), stays down; also drops when aiming is >25% slower than hip: ' + aq.join(' > '), aq.join(',') === '3,2,1,0,0,0,2', aq.join(','));

    check('ADS slower with mag_a (' + sc.mag.adsTime.toFixed(4) + ' s) than holo_a (' + sc.holo.adsTime.toFixed(4) + ' s)', sc.mag.adsTime > sc.holo.adsTime, '');
    const tanH = (v) => Math.tan(v * Math.PI / 360);
    check('focal sens: 2.5x / 1x = tan(34.86/2) / tan(74.7/2)', Math.abs(sc.mag.dpc / sc.holo.dpc - tanH(83 * 0.42) / tanH(83 * 0.9)) < 1e-12, 'ratio ' + sc.mag.dpc / sc.holo.dpc);
    const gameSens = await page.evaluate(() => {
      const R = window.__range;
      R.setSetting('adsSens', 'game'); R.manual(true); R.selectGun(1);
      const get = (o) => { R.setOptic(o); R.setAds(true); R.step(1); const d = R.state().dpc; R.setAds(false); R.step(1); return d; };
      const out = { mag: get('mag_a'), holo: get('holo_a') };
      R.setOptic('mag_a'); R.setSetting('adsSens', 'focal');
      return out;
    });
    check('game-values sens: 2.5x / 1.0x = 11.8 / 22.3 cm', Math.abs(gameSens.mag / gameSens.holo - 11.8 / 22.3) < 1e-12, JSON.stringify(gameSens));

    // Acceptance: uniform screen distance, no sensitivity stepping, frame-one centred reticle,
    // zero parallax.
    const acc = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(1); R.setOptic('mag_a'); R.setAim(0, 0); R.setAds(false); R.step(1); R.renderFrame();
      const camHip = R.lensParams();
      const measure = () => { const a = R.look(); R.applyCounts(0, -40); const b = R.look(); R.setAim(a.yaw, a.pitch); return b.pitch - a.pitch; };
      const out = { hipFov: R.state().fovV, hipDeg: measure(), hipDpc: R.state().dpc };
      // frame one of aiming
      R.setAds(true); R.step(1 / 60); R.renderFrame();
      out.f1 = R.lensParams(); out.f1.adsE = R.state().adsE;
      // sensitivity through the whole raise at 240 fps
      R.setAds(false); R.step(1); R.setAds(true);
      const series = [R.state().dpc];
      for (let i = 0; i < 80; i++) { R.step(1 / 240, 240); series.push(R.state().dpc); }
      out.series = series;
      out.adsFov = R.state().fovV; out.adsDeg = measure(); out.adsDpc = R.state().dpc;
      R.renderFrame(); out.camAds = R.lensParams();
      // monitor distance 100%: matched at the top edge of the screen
      R.setSetting('mdm', 1); out.adsDpcEdge = R.state().dpc; R.setAds(false); R.step(1); out.hipDpcEdge = R.state().dpc; R.setSetting('mdm', 0);
      R.setAds(false); R.step(1);
      out.camHip = camHip;
      return out;
    });
    const px = (deg, fov) => 540 * Math.tan(deg * Math.PI / 180) / Math.tan(fov * Math.PI / 360);
    const pxHip = px(acc.hipDeg, acc.hipFov), pxAds = px(acc.adsDeg, acc.adsFov);
    check('0% monitor distance: 40 counts move the view ' + pxHip.toFixed(2) + ' px at hip and ' + pxAds.toFixed(2) + ' px aimed (1080p)', Math.abs(pxAds / pxHip - 1) < 0.002, JSON.stringify({ pxHip, pxAds }));
    const edgeHip = (acc.hipFov / 2) / acc.hipDpcEdge, edgeAds = (acc.adsFov / 2) / acc.adsDpcEdge;
    check('100% monitor distance: counts to reach the screen edge equal (' + edgeHip.toFixed(1) + ' vs ' + edgeAds.toFixed(1) + ')', Math.abs(edgeAds / edgeHip - 1) < 1e-9, '');
    const ser = acc.series, range = ser[0] - ser[ser.length - 1];
    let maxStep = 0, mono = true;
    for (let i = 1; i < ser.length; i++) { const d = ser[i - 1] - ser[i]; maxStep = Math.max(maxStep, Math.abs(d)); if (d < -1e-15) mono = false; }
    const firstStep = (ser[0] - ser[1]) / range;
    check('sensitivity follows the zoom continuously: monotonic, largest 240 fps step ' + (100 * maxStep / range).toFixed(2) + '% of the change, responds on frame one (' + (100 * firstStep).toFixed(1) + '%)',
      mono && maxStep / range < 0.12 && firstStep > 0.01 && Math.abs(ser[ser.length - 1] - acc.adsDpc) < 1e-12, JSON.stringify({ maxStep, range, firstStep }));
    check('frame one of aiming (blend ' + acc.f1.adsE.toFixed(4) + '): reticle fully on at the exact screen centre', acc.f1.retOn === 1 && acc.f1.retX === acc.f1.w / 2 && acc.f1.retY === acc.f1.h / 2, JSON.stringify(acc.f1));
    check('zero parallax: camera position unchanged by aiming (zoom is FOV only)', acc.camHip.camX === acc.camAds.camX && acc.camHip.camY === acc.camAds.camY && acc.camHip.camZ === acc.camAds.camZ, JSON.stringify([acc.camHip, acc.camAds]));
    check('lens pass off at hip, on when aimed', !sc.overlayHip && sc.overlayAds, sc.overlayHip + ' / ' + sc.overlayAds);
    check('F4 gallery shows 15 sights', sc.gallery === 15, 'got ' + sc.gallery);

    // j) movement: WASD in a small box behind the firing line; Space crouches.
    const mv = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(9); R.setDistance(10); R.clear(); R.setAim(0, 0);
      const out = {};
      R.move({ w: true }); R.step(1); R.move({ w: false }); R.step(0.5); out.forward = R.player();
      R.move({ s: true }); R.step(2); R.move({ s: false }); R.step(0.5); out.back = R.player();
      R.move({ a: true }); R.step(2); R.move({ a: false }); R.step(0.5); out.left = R.player();
      R.move({ d: true }); R.step(0.5); R.move({ d: false }); R.step(0.5);
      R.move({ w: true }); R.step(3); R.move({ w: false }); R.step(0.5); out.home = R.player();
      R.crouch(true); R.step(1); out.crouched = R.player();
      R.crouch(false); R.step(1);
      // Sprint: hold Shift while walking back; not while crouched.
      R.setSprint(true); R.move({ s: true }); R.step(0.15); out.sprintSpeed = R.player().speed; R.move({ s: false }); R.setSprint(false); R.step(0.5);
      R.move({ s: true }); R.step(0.15); out.walkSpeed = R.player().speed; R.move({ s: false }); R.step(0.5);
      R.move({ w: true }); R.step(2); R.move({ w: false }); R.step(0.5);
      R.crouch(true); R.step(1);
      R.clear(); R.setAim(0, 0); R.trigger(true); R.step(0.01, 1000); R.trigger(false); R.step(1);
      out.crouchShot = R.state();
      R.crouch(false); R.step(1); out.stand = R.player();
      return out;
    });
    check('W cannot move past the firing line (z stays ' + mv.forward.z.toFixed(3) + ')', mv.forward.z === 0, JSON.stringify(mv.forward));
    check('S / A stop at the box edge (2 m back, 1.5 m left)', Math.abs(mv.back.z - 2) < 1e-9 && Math.abs(mv.left.x + 1.5) < 1e-9, JSON.stringify([mv.back, mv.left]));
    check('W walks back up to the line and stops there', mv.home.z === 0, JSON.stringify(mv.home));
    check('Space crouch lowers the eye to 1.05 m, standing back to 1.6', Math.abs(mv.crouched.eye - 1.05) < 1e-3 && Math.abs(mv.stand.eye - 1.6) < 1e-3, JSON.stringify([mv.crouched, mv.stand]));
    check('Shift sprint is faster than walking (' + mv.sprintSpeed.toFixed(2) + ' vs ' + mv.walkSpeed.toFixed(2) + ' m/s after 0.15 s)', mv.sprintSpeed > mv.walkSpeed * 1.4, JSON.stringify(mv));
    check('a level shot while crouched hits the dummy body, not the head', mv.crouchShot.hits === 1 && mv.crouchShot.headshots === 0, JSON.stringify(mv.crouchShot));

    // Real gameplay inputs are active after the menu closes.
    await page.evaluate(() => { document.getElementById('menu').hidden = true; });
    // Space is hold-to-crouch (real key events).
    await page.keyboard.down('Space');
    const holdDown = await page.evaluate(() => { window.__range.step(0.5); return window.__range.player(); });
    await page.keyboard.up('Space');
    const holdUp = await page.evaluate(() => { window.__range.step(0.5); return window.__range.player(); });
    check('holding Space crouches, releasing stands', holdDown.crouched && !holdUp.crouched && Math.abs(holdUp.eye - 1.6) < 1e-3, JSON.stringify([holdDown, holdUp]));

    // Lean: hold E (right) / Q (left). The eye moves 0.32 m sideways and the view tilts; a level
    // shot leaves from the leaned eye. Distance keys are - and +.
    await page.evaluate(() => { const R = window.__range; R.manual(true); R.selectGun(9); R.setDistance(10); R.clear(); R.clearShotPoints(); R.setAim(0, 0); R.step(1); });
    await page.keyboard.down('KeyE');
    const leanR = await page.evaluate(() => { const R = window.__range; R.step(0.6); R.trigger(true); R.step(0.01, 1000); R.trigger(false); return { p: R.lean(), shot: R.shotPoints()[0] }; });
    await page.keyboard.up('KeyE');
    await page.keyboard.down('KeyQ');
    const leanL = await page.evaluate(() => { window.__range.step(0.6); return window.__range.lean(); });
    await page.keyboard.up('KeyQ');
    const leanOff = await page.evaluate(() => { window.__range.step(0.6); return window.__range.lean(); });
    check('E leans right: eye 0.32 m right, view tilted 11 deg; the shot leaves from there (x ' + leanR.shot[0].toFixed(3) + ' m)',
      Math.abs(leanR.p.ex - 0.32) < 1e-3 && Math.abs(leanR.p.roll - 11) < 0.05 && Math.abs(leanR.shot[0] - 0.32) < 0.01, JSON.stringify(leanR));
    check('Q leans left, releasing returns upright', Math.abs(leanL.ex + 0.32) < 1e-3 && leanL.roll < -10.9 && Math.abs(leanOff.ex) < 1e-3 && Math.abs(leanOff.roll) < 0.05, JSON.stringify([leanL, leanOff]));
    await page.keyboard.press('Minus');
    const dMinus = await page.evaluate(() => window.__range.state().distance);
    await page.keyboard.press('Equal');
    await page.keyboard.press('Equal');
    const dPlus = await page.evaluate(() => window.__range.state().distance);
    await page.keyboard.press('Minus');
    check('- / + change the target distance (10 -> ' + dMinus + ' -> ' + dPlus + ')', dMinus === 5 && dPlus === 15, '');

    // k) Siege-style sensitivity: vertical slider scales pitch only; aim assist pulls gently.
    const sv = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(9); R.setAim(0, 0);
      R.setSetting('sensH', 7); R.setSetting('sensV', 14);
      const a = R.look(); R.applyCounts(100, -100); const b = R.look();
      R.setSetting('sensV', 7);
      const yawDeg = b.yaw - a.yaw, pitchDeg = b.pitch - a.pitch;
      R.setAim(1.2, 0.3); R.setSetting('aimAssist', 0); R.step(0.5); const off = R.look();
      R.setAim(1.2, 0.3); R.setSetting('aimAssist', 1); R.step(0.5); const on = R.look();
      R.setSetting('aimAssist', 0); R.setAim(0, 0);
      return { yawDeg, pitchDeg, off, on, dpc: R.dpc() };
    });
    check('vertical sens 14 vs horizontal 7: same counts turn pitch twice as far', Math.abs(sv.pitchDeg / sv.yawDeg - 2) < 1e-9, JSON.stringify(sv));
    check('sens 7 at 1600 DPI = 14.25 cm/360 (' + (360 * 2.54 / (1600 * sv.dpc)).toFixed(3) + ')', Math.abs(360 * 2.54 / (1600 * sv.dpc) - 14.25) < 0.01, '');
    check('aim assist off: aim stays put; on: pulled towards the head (' + sv.on.yaw.toFixed(3) + ' deg left)',
      Math.abs(sv.off.yaw - 1.2) < 1e-9 && sv.on.yaw < 1.1 && sv.on.yaw > 0.4, JSON.stringify(sv));

    // h) red dots: several at once, still or moving; a hit scores 100 and the dot respawns.
    const dt = await page.evaluate(() => {
      const R = window.__range, d = 10;
      R.manual(true); R.selectGun(9); R.setDistance(d); R.clear();
      R.setTarget('dots', { dotCount: 6, dotMoving: false, dotSizeCm: 20 });
      const before = R.dots();
      const aimAt = (x, y) => {   // y measured from the floor
        const yaw = Math.atan(x / d);
        R.setAim(yaw * 180 / Math.PI, Math.atan((y - 1.6) * Math.cos(yaw) / d) * 180 / Math.PI);
      };
      const shoot = () => { R.trigger(true); R.step(0.01, 1000); R.trigger(false); R.step(1); };
      aimAt(before.x[2], before.y[2]); shoot();
      const afterHit = R.dots();
      aimAt(0, 3.4); shoot();                             // above every dot: a miss
      const st = R.state();
      R.setTarget('dots', { dotCount: 12, dotMoving: true, dotSpeed: 1.5 });
      const t0 = R.now(), x0 = R.dotX(0, t0), x2 = R.dotX(0, t0 + 2);
      const n12 = R.dots().count, dummyHidden = !R.dummyVisible();
      R.setTarget('dummy');
      return { count: before.count, moved: afterHit.x[2] !== before.x[2] || afterHit.y[2] !== before.y[2],
        others: afterHit.x.every((x, i) => i === 2 || x === before.x[i]), shots: st.shots, hits: st.hits, score: st.score,
        step: ((x2 - x0) + 5.6) % 5.6, n12, dummyHidden, dummyBack: R.dummyVisible() };
    });
    check('6 still dots; shooting one scores 100 and respawns only that dot', dt.count === 6 && dt.moved && dt.others && dt.score === 100, JSON.stringify(dt));
    check('a shot away from every dot misses', dt.shots === 2 && dt.hits === 1, JSON.stringify(dt));
    check('12 moving dots travel 1.5 m/s to the right; dummy hidden in dot mode, back after', dt.n12 === 12 && Math.abs(dt.step - 3) < 1e-9 && dt.dummyHidden && dt.dummyBack, JSON.stringify(dt));

    // h2) paper target: ring score (10 at the centre, 0 on the card outside the rings), and
    // a shot past the card is a miss.
    const pp = await page.evaluate(() => {
      const R = window.__range, d = 10;
      R.manual(true); R.selectGun(9); R.setDistance(d); R.clear();
      R.setTarget('paper');
      const shoot = (x, y) => {
        const yaw = Math.atan(x / d);
        R.setAim(yaw * 180 / Math.PI, Math.atan(y * Math.cos(yaw) / d) * 180 / Math.PI);
        R.clear();   // restart the spray so every shot is a first shot
        R.trigger(true); R.step(0.01, 1000); R.trigger(false); R.step(1);
        const st = R.state(); return { hits: st.hits, score: st.score };
      };
      const out = { centre: shoot(0, 0), ring5: shoot(0.18, 0), card: shoot(0.46, 0.0), off: shoot(0.7, 0), visible: R.paperVisible(), dummy: R.dummyVisible() };
      R.setTarget('dummy');
      return out;
    });
    check('paper target: centre scores 10, 0.18 m scores 6, card outside the rings 0, off the card misses',
      pp.centre.score === 10 && pp.ring5.score === 6 && pp.card.hits === 1 && pp.card.score === 0 && pp.off.hits === 0 && pp.visible && !pp.dummy, JSON.stringify(pp));

    // i) dummy: a level shot at 10 m is a headshot; a lower one hits the body.
    const dm = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(9); R.setDistance(10); R.clear();
      // Wait for the previous spray to settle (its recoil folds into the aim), then aim and fire.
      const shoot = (pitch) => { R.step(1); R.setAim(0, pitch); R.trigger(true); R.step(0.01, 1000); R.trigger(false); };
      shoot(0); shoot(Math.atan(-0.45 / 10) * 180 / Math.PI); shoot(Math.atan(0.5 / 10) * 180 / Math.PI);
      return R.state();
    });
    check('dummy: head shot, chest shot, shot over the head = 2 hits, 1 headshot', dm.shots === 3 && dm.hits === 2 && dm.headshots === 1, JSON.stringify(dm));

    check('no page errors', errors.length === 0, errors.join('\n'));
    check('no third-party requests', external.length === 0, external.join('\n'));
    await page.close();
  }

  /* ---------- 2b. sight choice persistence and data-only additions ---------- */
  console.log('\nSights: saved choice and a test sight added through data only');
  {
    const { page, errors } = await openPage('index.html?test');
    await page.waitForFunction(() => window.__range && window.__range.ready);
    await page.evaluate(() => { window.__range.selectGun(0); window.__range.setOptic('reflex_a'); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__range && window.__range.ready);
    const kept = await page.evaluate(() => { window.__range.selectGun(0); return window.__range.state().optic; });
    check('chosen sight is remembered per slot after reload', kept === 'reflex_a', 'got ' + kept);
    await page.evaluate(() => localStorage.setItem('scope:smg-01', 'mag_a')); // not allowed on a defender slot
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__range && window.__range.ready);
    const fell = await page.evaluate(() => { window.__range.selectGun(0); return window.__range.state().optic; });
    check('a saved sight the slot no longer allows falls back to defaultOptic', fell === 'holo_a', 'got ' + fell);
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();

    // Serve modified JSON (files on disk are untouched): one new sight, listed on slot 1 only.
    const p2 = await browser.newPage();
    const errs2 = [];
    p2.on('pageerror', (e) => errs2.push(String(e)));
    await p2.route('**/data/optics.json', async (route) => {
      const res = await route.fetch(); const j = await res.json();
      j.optics.push({ id: 'test_x', group: 'telescopic', label: 'Test X', zoom: 4,
        housing: { shape: 'round', w: 0.25, h: 0.25, bezel: 0.05 }, reticle: { shapes: [{ t: 'dot', r: 6 }] } });
      route.fulfill({ response: res, json: j });
    });
    await p2.route('**/data/guns.json', async (route) => {
      const res = await route.fetch(); const j = await res.json();
      j.guns[0].optics.push('test_x');
      route.fulfill({ response: res, json: j });
    });
    await p2.goto(BASE + 'index.html?test', { waitUntil: 'networkidle' });
    await p2.waitForFunction(() => window.__range && window.__range.ready);
    const t = await p2.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.selectGun(1); const other = R.sightRowCount();
      R.selectGun(0); const row = R.sightRowCount(); R.setOptic('test_x'); R.setAds(true); R.step(1);
      const st = R.state(); R.toggleGallery(true); const gal = R.galleryCount();
      return { row, other, optic: st.optic, zoom: st.zoom, sensKey: st.sensKey, gal,
        sensRows: [...document.querySelectorAll('.optic-table tbody tr td:first-child')].map((td) => td.textContent) };
    });
    check('test sight appears on slot 1 only (12 vs 14), selectable, zoom 4', t.row === 12 && t.other === 14 && t.optic === 'test_x' && t.zoom === 4, JSON.stringify(t));
    check('gallery shows 16 and the sens table gains a 4.0x row (rows: 1.0x, 2.5x, 3.5x, 4.0x, 8.0x)', t.gal === 16 && t.sensRows.join(',') === '1.0x,2.5x,3.5x,4.0x,8.0x', JSON.stringify(t.sensRows));
    check('no page errors', errs2.length === 0, errs2.join('\n'));
    await p2.close();
  }

  /* ---------- 2c. attachments (Milestone 8) ---------- */
  console.log('\nAttachments: effective guns in the Range, the armory, Battle and the match modes');
  {
    const { page, errors } = await openPage('index.html?test');
    const a = await page.evaluate(() => {
      const R = window.__range, out = {};
      R.manual(true); R.selectGun(1);
      out.measured = R.gunNow();
      out.code = R.attach('1111');
      out.ext = R.gunNow();
      const s0 = R.state().shots;
      R.trigger(true); R.step(6); R.trigger(false); R.step(0.2);
      out.fired = R.state().shots - s0; out.ammo = R.state().ammo;
      return out;
    });
    check('measured loadout is the catalogue gun (F2: flash hider, vertical grip, laser)', a.measured.base && a.measured.attach === null && a.measured.magSize === 25, JSON.stringify(a.measured));
    check('extended magazine: 35 rounds fired from one magazine', a.code === '1111' && a.ext.magSize === 35 && a.fired >= 35 && a.fired <= 36 && a.ammo === 0, JSON.stringify(a));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__range && window.__range.ready);
    const kept = await page.evaluate(() => { window.__range.selectGun(1); return window.__range.gunNow().attach; });
    check('attachments are remembered per gun after reload', kept === '1111', 'got ' + kept);
    await page.evaluate(() => window.__range.openArmory());
    await page.locator('#attach-rows button', { hasText: /^Suppressor$/ }).click();
    const ui = await page.evaluate(() => ({ g: window.__range.gunNow(), fx: document.getElementById('attach-fx').innerText, pressed: [...document.querySelectorAll('#attach-rows button[aria-pressed=true]')].map((b) => b.textContent) }));
    check('armory: picking the suppressor changes the gun and lists its effects', ui.g.suppressed && ui.g.flash === 0 && /Shot noise -60%/.test(ui.fx) && ui.pressed.join() === 'Suppressor,Vertical grip,Laser,Extended', JSON.stringify(ui));
    await page.evaluate(() => document.getElementById('arm-back').click());
    const b = await page.evaluate(() => {
      const R = window.__range;
      R.manual(true); R.setGraphics('standard');
      R.battleStart({ opponent: 'bots', bots: 2, level: 'easy', kills: 99 });
      R.step(0.5, 60);
      const B = R.battle(), h = B.humans[0];
      const out = { attach: h.gun.attach, cap: h.weapon.capacity, look: h.f._lookKey, bots: B.bots.map((x) => !!x.gun.base) };
      R.battleLeave();
      return out;
    });
    check('Battle: you carry your attachments (suppressor, extended magazine); bots the measured loadout', b.attach === '4111' && b.cap >= 35 && /\|4111$/.test(b.look) && b.bots.every((x) => !x), JSON.stringify(b));
    const mm = await page.evaluate(async () => {
      const R = window.__range;
      for (const g of R.guns) localStorage.setItem('attach:' + g.id, g.model === 'lmg' ? '0002' : '0002');
      await R.modeStart('tdm', { map: { tdm: 'containers', ctf: 'yard', bomb: 'ranch' }, seed: 3, side: 'attack', op: { tdm: 'glitch', ctf: 'dash', bomb: 'pace' }, abilities: { tdm: false, ctf: false, bomb: false } });
      R.step(1, 60);
      const G = R.modeGame(), me = G.me;
      const base = R.guns.find((g) => g.id === me.gunData.id);
      return { attach: me.gunData.attach, human: G.h.gun.attach, reload: me.gun.reload, baseReload: base.reloadSeconds, bots: G.m.actors.filter((x) => !x.human).every((x) => !x.gunData.base) };
    });
    check('match modes: your op\'s gun has your saved attachments (quick-change: faster reload)', mm.attach && mm.attach.endsWith('2') && mm.human === mm.attach && mm.reload < mm.baseReload && mm.bots, JSON.stringify(mm));
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

  /* ---------- 2d. pack weapon animations (Milestone 8) ---------- */
  console.log('\nPack weapon animations: keyframed reloads on High with the pack, same timing');
  {
    const { page, errors } = await openPage('index.html?test');
    const r = await page.evaluate(async () => {
      const R = window.__range, out = {};
      R.manual(true); R.setGraphics('standard'); R.selectGun(4); R.step(0.5);
      out.standardSplit = R.packClip().split;
      out.install = (await R.hdInstall()).ok;
      R.setGraphics('high'); R.selectGun(4); R.step(0.5);
      out.highSplit = R.packClip().split;
      const rest = R.packClip().hand;
      R.reloadFrom(true);
      let far = 0, hidden = false, bolt = 0, steps = 0, clip = null;
      while (R.state().reloading && steps < 1000) {
        R.step(1 / 60); steps++;
        const c = R.packClip(); clip = clip || c.clip;
        far = Math.max(far, Math.hypot(c.hand[0] - rest[0], c.hand[1] - rest[1], c.hand[2] - rest[2]));
        if (!c.mag[4]) hidden = true;
        bolt = Math.max(bolt, c.bolt);
      }
      out.clip = clip; out.far = far; out.hidden = hidden; out.bolt = bolt; out.steps = steps;
      R.step(0.3);
      const end = R.packClip();
      out.endRest = Math.hypot(end.hand[0] - rest[0], end.hand[1] - rest[1], end.hand[2] - rest[2]) < 1e-3 && end.mag[4] && Math.abs(end.mag[1]) < 1e-6;
      R.setGraphics('standard'); R.selectGun(4); R.step(0.2);
      R.reloadFrom(false); let s2 = 0; while (R.state().reloading && s2 < 1000) { R.step(1 / 60); s2++; }
      out.steps2 = s2;
      return out;
    });
    check('Standard keeps the procedural animations (no separate hand)', r.standardSplit === false, JSON.stringify(r));
    check('High with the pack: the support hand is its own animated part', r.install && r.highSplit === true, JSON.stringify(r));
    check('empty reload: the hand leaves the handguard, the old magazine drops, the charging handle is pulled', r.clip === 'empty' && r.far > 0.1 && r.hidden && r.bolt > 0.03, JSON.stringify(r));
    check('after the reload the hand and magazine are back at rest', r.endRest, JSON.stringify(r));
    check('reload takes the same time with the pack clips as without (within one frame)', Math.abs(r.steps - r.steps2) <= 1, r.steps + ' vs ' + r.steps2);
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

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
      h.f.x = 16; h.f.z = 12; h.f.protectUntil = 0; h.f.health = 100; h.f.alive = true;
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
      R.selectGun(2);
      P.equip(2, res.skin.id); U.onEquip(2);
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

  // Enhanced Graphics pack: nothing downloaded until asked; High / Ultra prompt for it; the
  // download is checked file by file, kept in the browser (offline) and removable; detailed
  // guns; world post-processing (ambient occlusion, TAA, upscaling); the FPS counter.
  {
    console.log('\nEnhanced Graphics pack, graphics screen, world post-processing, FPS counter');
    const { page, errors, external } = await openPage('index.html?test');
    await page.waitForFunction(() => window.__range && window.__range.ready, null, { timeout: 10000 });
    const hdReq = () => page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/hd\/guns\//.test(e.name)).length);
    const p0 = await page.evaluate(() => {
      const R = window.__range, G = R.graphicsUI();
      R.manual(true); R.selectGun(2); R.step(0.5);
      G.open(); G.choose('high'); R.step(0.1); R.renderFrame();
      const pr = document.querySelector('.gx-prompt');
      return { st: R.hdState(), prompt: !pr.hidden, text: pr.textContent, tone: R.toneMapping(), hd: R.rigHD(), btn: document.getElementById('gx-download').textContent };
    });
    check('no pack: nothing downloaded; High runs as Standard and the screen offers the download (' + p0.btn + ')',
      (await hdReq()) === 0 && p0.st.state === 'none' && p0.st.effective === 'standard' && p0.prompt && /needs the Enhanced Graphics pack/.test(p0.text) && p0.tone === 0 && !p0.hd, JSON.stringify(p0));
    // A damaged file is refused (one byte flipped on the way).
    await page.route('**/hd/guns/ak.rrmz', async (route) => { const r = await route.fetch(); const b = Buffer.from(await r.body()); b[200] ^= 0xff; await route.fulfill({ response: r, body: b }); });
    await page.click('#gx-download');
    await page.waitForFunction(() => window.__range.hdState().state !== 'downloading' && window.__range.hdState().state !== 'none', null, { timeout: 60000 });
    const bad = await page.evaluate(() => ({ st: window.__range.hdState(), status: document.querySelector('.gx-status').textContent }));
    check('a damaged download is refused (checked against the pack list)', bad.st.state === 'error' && !bad.st.ready && /damaged/.test(bad.status), JSON.stringify(bad));
    await page.unroute('**/hd/guns/ak.rrmz');
    await page.click('#gx-download');
    await page.waitForFunction(() => window.__range.hdState().loaded, null, { timeout: 60000 });
    const p1 = await page.evaluate(async () => {
      const R = window.__range;
      R.step(0.2); R.renderFrame();
      const tris = () => { let t = 0; R.rigObj().current.traverse((o) => { if (o.isMesh) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return t; };
      const man = await (await fetch('hd/manifest.json')).json();
      const cached = (await (await caches.open('recoil-range-hd')).keys()).length;
      const hiTris = tris(), hd = R.rigHD(), tone = R.toneMapping();
      R.setGraphics('standard'); R.step(0.1);
      const lowTris = tris();
      R.setGraphics('high'); R.step(0.1); R.renderFrame();
      return { st: R.hdState(), files: man.files.length, cached, hd, tone, hiTris, lowTris, status: document.querySelector('.gx-status').textContent, prompt: !document.querySelector('.gx-prompt').hidden };
    });
    check('download with the button: every file checked and kept in the browser (' + p1.cached + ' files); High switches on', p1.st.state === 'installed' && p1.cached === p1.files && p1.hd && p1.tone !== 0 && !p1.prompt && /Installed/.test(p1.status), JSON.stringify(p1));
    check('the pack\'s gun is far more detailed (' + Math.round(p1.hiTris / 1000) + 'k triangles vs ' + Math.round(p1.lowTris / 1000) + 'k)', p1.hiTris > p1.lowTris * 4, JSON.stringify(p1));
    // The pack's soldier in a battle (High): far more detailed than the simple one, same hit shapes.
    const sol = await page.evaluate(() => {
      const R = window.__range;
      const started = R.battleStart({ opponent: 'bots', bots: 2, level: 'easy', kills: 30 });
      if (!started) return { why: 'battle did not start: ' + document.getElementById('notice').textContent + ' | ' + JSON.stringify(R.battleState && R.battleState()) };
      const B = R.battle(), f = B.bots[0].f;
      R.step(0.5); R.renderFrame();
      const hiVerts = f.body.geometry.attributes.position.count + f.legs.reduce((s, l) => s + l.piv.children[0].geometry.attributes.position.count, 0);
      R.battleLeave();
      R.setGraphics('standard');
      R.battleStart({ opponent: 'bots', bots: 2, level: 'easy', kills: 30 });
      const f2 = R.battle().bots[0].f;
      const loVerts = f2.body.geometry.attributes.position.count + f2.legs.reduce((s, l) => s + l.piv.children[0].geometry.attributes.position.count, 0);
      R.battleLeave();
      R.setGraphics('high');
      return { hiVerts, loVerts };
    });
    check('the pack\'s soldier in battles (' + Math.round(sol.hiVerts / 3000) + 'k triangles vs ' + Math.round(sol.loVerts / 3000) + 'k)', sol.hiVerts > sol.loVerts * 3, JSON.stringify(sol));
    // World post-processing on High: ambient occlusion + TAA, then upscaling at 60%.
    const wp = await page.evaluate(() => {
      const R = window.__range;
      document.getElementById('menu').hidden = true;
      const a = R.setPost({ ao: true, taa: true, sharpen: 0.25, renderScale: 0 });
      for (let i = 0; i < 4; i++) { R.step(1 / 60); R.renderFrame(); }
      R.setAds(true); R.step(0.6); R.renderFrame(); R.setAds(false); R.step(0.6); R.renderFrame();
      const b = R.setPost({ ao: true, taa: false, renderScale: 0.6 }); R.renderFrame();
      const info = R.renderInfo();
      R.setGraphics('standard');
      const c = R.setPost({ renderScale: 0 });
      R.setGraphics('high');
      return { a, b, c, info };
    });
    check('High: ambient occlusion and TAA run; at 60% the world is upscaled and the screen stays full size (' + wp.info.w + 'x' + wp.info.h + ')',
      wp.a.on && wp.a.ao && wp.a.taa && wp.b.on && wp.b.scale === 0.6 && wp.info.w === 1280 && !wp.c.on, JSON.stringify(wp));
    // FPS counter.
    await page.evaluate(() => { const R = window.__range; R.graphicsUI().open(); if (!document.getElementById('gx-counter').checked) document.getElementById('gx-counter').click(); });
    await page.evaluate(() => { const R = window.__range; R.manual(false); });
    await page.waitForTimeout(800);
    const fps = await page.evaluate(() => ({ shown: !document.getElementById('perf').hidden, text: document.querySelector('#perf pre').textContent }));
    check('FPS counter: frame rate, frame time, 1% low, CPU / GPU time, resolution and draw calls', fps.shown && /fps/.test(fps.text) && /CPU/.test(fps.text) && /draws/.test(fps.text), JSON.stringify(fps));
    // After a reload the pack is still there and nothing is downloaded again.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__range && window.__range.ready && window.__range.hdState().loaded, null, { timeout: 30000 });
    const p2 = await page.evaluate(() => { const R = window.__range; R.manual(true); R.step(0.2); R.renderFrame(); return { st: R.hdState(), hd: R.rigHD() }; });
    check('after a reload the pack loads from the browser (no download) and High is on', p2.st.state === 'installed' && p2.hd && (await hdReq()) === 0, JSON.stringify(p2));
    const p3 = await page.evaluate(async () => {
      const R = window.__range;
      await R.hdRemove(); R.step(0.1); R.renderFrame();
      return { st: R.hdState(), hd: R.rigHD(), cached: (await caches.keys()).includes('recoil-range-hd'), tone: R.toneMapping() };
    });
    check('remove: space freed, High back to needing the pack (Standard look)', p3.st.state === 'none' && !p3.hd && !p3.cached && p3.st.effective === 'standard' && p3.tone === 0, JSON.stringify(p3));
    check('no page errors', errors.length === 0, errors.join('\n'));
    check('no third-party requests', external.length === 0, external.join('\n'));
    await page.close();
  }

  // Legendary skin: your own photo (a generated test image here), kept in this browser only.
  {
    console.log('\nLegendary skin (your photo)');
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.stack || e)));
    await page.goto(BASE + 'index.html?test', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__range);
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#3a8a3a'; g.fillRect(0, 0, 300, 400); g.fillStyle = '#ffcc00'; g.beginPath(); g.arc(150, 180, 80, 0, 7); g.fill(); return c.toDataURL('image/png').split(',')[1]; });
    await page.evaluate(() => { document.querySelector('.mode-card') && 0; });
    await page.setInputFiles('#pk-legend-file', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => { try { return !!localStorage.getItem('recoilRange.legendPhoto.v1'); } catch (e) { return false; } }, null, { timeout: 5000 });
    const lg = await page.evaluate(() => {
      const R = window.__range, prof = R.profile();
      const card = [...document.querySelectorAll('#packs-root .pk-card')].find((c) => /Legend/.test(c.textContent));
      const thumb = card && card.querySelector('img').src.startsWith('data:image/jpeg');
      card.click();
      const out = { thumb, rarity: card.textContent.includes('Legendary'), equipped: [0, 3, 7].map((s) => prof.equip(s, 2000) && prof.equippedFor(s)) };
      const code = prof.saveCode();
      out.codeHasPhoto = code.length > 200;
      prof.loadCode(code); out.reloaded = prof.equippedFor(3);
      // in battle: you see your photo; another player wearing it shows the gold finish
      R.battleStart({ opponent: 'bots', bots: 1, level: 'easy', kills: 99, map: 'yard' });
      const B = R.battle();
      out.mine = B.humans[0].f.skin;
      B._look(B.bots[0].f, B.bots[0].f.gun, 2000);
      out.theirs = B.bots[0].f.skin;
      R.battleLeave();
      return out;
    });
    check('Legendary: your photo becomes a skin for every gun; the save code keeps the choice but not the photo; others see gold', lg.thumb && lg.rarity && lg.equipped.every((v) => v === 2000) && !lg.codeHasPhoto && lg.reloaded === 2000 && lg.mine === 2000 && lg.theirs === 2001, JSON.stringify(lg));
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

  // Heights, vaulting, stairs, ramps, acid, night and weather.
  {
    console.log('\nBattle movement, hazards, night and weather');
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.stack || e)));
    await page.goto(BASE + 'index.html?test', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__range);
    const mv = await page.evaluate(() => {
      const R = window.__range; R.manual(true);
      const res = {};
      const setup = (map, o = {}) => { R.battleStart({ opponent: 'bots', bots: 1, level: 'easy', kills: 30, map, night: false, weather: 'auto', fog: false, ...o }); const B = R.battle(); B.bots[0].update = () => {}; B.bots[0].f.x = 20; B.bots[0].f.z = -15; const h = B.humans[0]; h.f.protectUntil = 1e9; return [B, h]; };
      const place = (h, x, y, z, yaw) => { h.f.x = x; h.f.y = y; h.f.z = z; h.camY = y; h.f.vx = h.f.vz = 0; h.look.setAngles(yaw, 0); };
      const run = (s) => { for (let i = 0; i < s * 20; i++) R.step(0.05, 60); };
      const vault = (h) => { h.in.vault = true; run(0.1); h.in.vault = false; run(0.8); };
      let [B, h] = setup('yard');
      place(h, 3.75, 0, 2.0, 0); run(0.2); vault(h); res.over = [h.f.z, h.f.y];
      place(h, 3.75, 1.2, 0.5, -90); run(0.2); vault(h); res.climb = h.f.y;
      place(h, 0, 0, 5, 0); run(0.1); vault(h); res.tall = [h.f.z, h.f.y];
      [B, h] = setup('casino');
      place(h, -6.5, 0, -2, 0); h.in.fwd = false; h.look.setAngles(180, 0); h.in.fwd = true; run(3); h.in.fwd = false; res.stairs = h.f.y;
      res.upPath = B.arena.findPath(12, 0, -10, 12, 0, 3.6).slice(-1)[0];
      place(h, 20, 0, -13.1, -90); h.in.fwd = true; run(4); h.in.fwd = false; res.ramp = h.f.y;
      place(h, 1, 3.6, 10, 0); h.in.fwd = true; run(2); h.in.fwd = false; res.fallBlockedByRail = h.f.y;
      [B, h] = setup('winter');
      place(h, -2.2, 0, 4, 0); h.in.fwd = true; run(1.5); h.in.fwd = false; res.cabin = h.f.z;
      [B, h] = setup('school');
      h.f.protectUntil = 0; place(h, -10, 0, 6, 0); run(4); res.acid = { dead: h.f.deaths > 0, feed: B.hud.feed.textContent };
      [B, h] = setup('yard', { night: true, weather: 'storm', fog: true });
      run(0.5);
      res.night = { lights: B.torches.filter((l) => l.visible).length, own: B.torches[0].intensity, beam: B.bots[0].f.torchG.visible, rain: !!(B.arena.rain && B.arena.rain.visible), banks: !!(B.arena.banks && B.arena.banks.visible), hemi: B.arena.hemi.intensity };
      R.battleKey('KeyF', true); R.battleKey('KeyF', false); run(0.1); res.lightOff = B.torches[0].intensity;
      res.nightOutline = B.bots[0].f.outline.visible;
      [B, h] = setup('yard'); run(0.2);
      res.dayOutline = B.bots[0].f.outline.visible && !h.f.outline.visible;
      // kill cam and hit report
      h.f.protectUntil = 0; B.bots[0].f.protectUntil = 0;
      const k = B.bots[0].f;
      B._damage(k, 30, h.f, 'body', B.t);
      B._damage(h.f, 30, k, 'limb', B.t); B._damage(h.f, 90, k, 'head', B.t);
      run(0.2);
      const rep = B.hud.views[0].rep;
      res.kc = { on: !!B.kc && B.kc.killer === k, panel: !rep.hidden, text: rep.textContent };
      R.battleKey('Space', true); R.battleKey('Space', false); run(0.1);
      res.kc.skipped = !B.kc && !h.f.alive;
      run(3.5);
      res.kc.respawned = h.f.alive && B.hud.views[0].rep.hidden;
      res.day = { lights: B.torches.filter((l) => l.visible).length, hemi: B.arena.hemi.intensity, rain: !!(B.arena.rain && B.arena.rain.visible) };
      res.look = { gun: B.bots[0].f._gunModel ? B.bots[0].f._gunModel.children.length : 0, skin: B.bots[0].f.skin };
      // hearing and the radio: two bots behind the middle container, you fire on the far side
      R.battleStart({ opponent: 'bots', bots: 2, level: 'hard', kills: 99, map: 'yard', night: false, weather: 'auto', fog: false });
      B = R.battle(); h = B.humans[0]; h.f.protectUntil = 1e9;
      const said = []; const orig = B.radio.bind(B); B.radio = (f, text, tt) => { said.push(text); orig(f, text, tt); };
      B.bots.forEach((bt, i) => { bt.f.x = -1 + i * 2; bt.f.z = -3; bt.f.y = 0; bt.f.yaw = 180; bt.respawned(); bt.nextPath = 1e9; bt.goal = { x: bt.f.x, z: bt.f.z, y: 0 }; });
      place(h, 0, 0, 4, 180); run(0.3);
      h.in.fire = true; run(0.2); h.in.fire = false; run(0.4);
      res.hear = { heard: B.bots.map((bt) => !!(bt.heard && bt.heard.kind === 'shot')), said: said.slice(0, 4), comms: B.hud.comms.children.length };
      // walking legs swing
      B.bots[0].update = () => {}; B.bots[0].f.x = 10; B.bots[0].f.z = 0;
      let maxSwing = 0;
      for (let i = 0; i < 20; i++) { B.bots[0].f.x += 0.15; R.step(0.05, 60); maxSwing = Math.max(maxSwing, Math.abs(B.bots[0].f.legs[0].piv.rotation.x)); }
      res.legs = maxSwing;
      // bodies collide: six bots dropped on one spot spread out
      R.battleStart({ opponent: 'bots', bots: 6, level: 'easy', kills: 99, map: 'yard', night: false, weather: 'auto', fog: false });
      B = R.battle();
      B.bots.forEach((bt) => { bt.update = () => {}; bt.f.x = -12; bt.f.z = 2; bt.f.y = 0; });
      run(0.5);
      let closest = 9;
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) closest = Math.min(closest, Math.hypot(B.bots[i].f.x - B.bots[j].f.x, B.bots[i].f.z - B.bots[j].f.z));
      res.spread = closest;
      const sayLog = [];
      B.deps.voice = { say: (text, who) => { sayLog.push(who + ': ' + text); return true; }, stop() {} };
      B.radio(B.bots[0].f, 'Contact! by the crates, north.', B.t);
      res.voice = sayLog;
      R.battleLeave();
      return res;
    });
    check('vault (C) over low cover, climb onto a 1.4 m ledge, but not over a 2.6 m container', mv.over[0] < 0 && mv.over[1] === 0 && Math.abs(mv.climb - 2.6) < 0.01 && mv.tall[0] > 4.9, JSON.stringify(mv));
    check('casino: stairs and a ramp up to the second floor; bots can path up there; rails stop falls', Math.abs(mv.stairs - 3.6) < 0.01 && Math.abs(mv.ramp - 3.6) < 0.01 && mv.upPath && Math.abs(mv.upPath[2] - 3.6) < 0.01 && Math.abs(mv.fallBlockedByRail - 3.6) < 0.01, JSON.stringify(mv));
    check('winter: walk into the cabin through its door', mv.cabin < 0, JSON.stringify(mv));
    check('school basement: acid kills, shown in the kill feed', mv.acid.dead && /Acid/.test(mv.acid.feed), JSON.stringify(mv.acid));
    check('night: flashlights (yours toggles with F; others light the scene in Standard and up), beams on others; storm rain and thick plain fog; day has none', mv.night.lights >= 1 && mv.night.own > 0 && mv.night.beam && mv.night.rain && !mv.night.banks && mv.lightOff === 0 && mv.day.lights === 0 && !mv.day.rain && mv.day.hemi > mv.night.hemi * 4, JSON.stringify(mv));
    check('others carry their real gun model (with a skin for bots)', mv.look.gun > 0, JSON.stringify(mv.look));
    check('bots hear gunfire through cover and call it out on their radio', mv.hear.heard.every(Boolean) && mv.hear.said.some((s) => /Shots/.test(s)) && mv.hear.comms > 0, JSON.stringify(mv.hear));
    check('legs swing when soldiers walk', mv.legs > 0.2, String(mv.legs));
    check('soldiers collide: six bots on one spot spread out (closest ' + mv.spread.toFixed(2) + ' m)', mv.spread > 0.6, String(mv.spread));
    check('radio lines are spoken (Bot voices on)', mv.voice.length === 1 && /Contact/.test(mv.voice[0]), JSON.stringify(mv.voice));
    check('red outline on other players by day, not at night', mv.dayOutline && !mv.nightOutline, JSON.stringify(mv));
    check('kill cam on your killer with a hit report (head / body / limbs, damage both ways); Space skips', mv.kc.on && mv.kc.panel && /Head 1 · Body 0 · Arms \/ legs 1/.test(mv.kc.text) && /You hit .* 1 times · 30 damage/.test(mv.kc.text) && mv.kc.skipped && mv.kc.respawned, JSON.stringify(mv.kc));
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

  /* ---------- match modes in the browser ---------- */
  console.log('\nMatch modes (Team Deathmatch, Capture the Flag, Bomb) in the browser');
  {
    const { page, errors } = await openPage('index.html?test');
    await page.waitForFunction(() => window.__range && window.__range.ready);
    const mm = await page.evaluate(async () => {
      const R = window.__range, out = {};
      R.manual(true); R.setGraphics('standard');
      const maps = { tdm: 'containers', ctf: 'yard', bomb: 'ranch' };
      // every mode starts, runs and draws
      out.started = [];
      for (const [mode, map] of [['tdm', 'containers'], ['tdm', 'casino'], ['ctf', 'winter'], ['ctf', 'school'], ['ctf', 'yard'], ['bomb', 'embassy'], ['bomb', 'workshop']]) {
        const ok = await R.modeStart(mode, { map: { ...maps, [mode]: map }, seed: 3, side: 'attack', op: { tdm: 'glitch', ctf: 'dash', bomb: 'pace' }, abilities: { tdm: false, ctf: false, bomb: true } });
        R.step(2, 60); R.renderFrame();
        const G = R.modeGame();
        out.started.push(mode + '/' + map + ':' + (ok && G.active && G.m.actors.length === 10 && !G.m.nan ? 'ok' : 'BAD'));
      }
      // Bomb on Ranch as an attacker with the plain prep drone
      await R.modeStart('bomb', { map: maps, seed: 3, side: 'attack', op: { tdm: 'glitch', ctf: 'dash', bomb: 'pace' }, abilities: { tdm: false, ctf: false, bomb: true } });
      const G = R.modeGame(), m = G.m, me = G.me;
      out.feedAtStart = G.hud.feed.children.length;
      // bots parked: no catcher zapping the drone, nobody opening the doors
      for (const a of m.actors) if (a !== me) { a.brain = null; a.x = 30; a.z = 20 - a.id; }
      R.step(0.5, 60);
      G.key('OperatorAbility', true); G.key('OperatorAbility', false);
      const d = me.ab.drone;
      out.drone = !!d;
      // at 10 and 15 FPS: straight at the west outer wall (x = -28) for 3 s, from outside
      out.droneWall = [];
      for (const fps of [10, 15, 30]) {
        d.x = -29.4; d.z = -5; d.yaw = 90; d.pitch = 0;
        G.key('KeyW', true); R.step(3, fps); G.key('KeyW', false);
        out.droneWall.push(+d.x.toFixed(2));
      }
      // and at the site's west soft wall reinforced (x = -28, z 9..12) and under the west door (z -1.7..-0.3)
      for (const pn of m.map.panels) if (pn.kind === 'soft' && pn.box.minX < -27.9 && pn.box.maxX > -28.1) m.map.reinforce(pn);
      d.x = -29.4; d.z = 10.5; d.yaw = 90; G.key('KeyW', true); R.step(3, 10); G.key('KeyW', false); out.droneReinforced = +d.x.toFixed(2);
      m.map.resetPanels();
      d.x = -29.4; d.z = -1; d.yaw = 90; G.key('KeyW', true); R.step(1.2, 10); G.key('KeyW', false); out.droneUnderDoor = +d.x.toFixed(2);
      G.key('KeyV', true); G.key('KeyV', false);
      // the player: sprint at the wall and at the boarded door at 10 FPS
      while (m.rules.phase === 'prep') R.step(1, 60);
      const run = (x, z, secs, fps) => { G.h.f.x = x; G.h.f.z = z; G.h.f.vx = G.h.f.vz = 0; me.x = x; me.z = z; G.h.look.setAngles(90, 0); G.key('KeyW', true); G.key('ShiftLeft', true); R.step(secs, fps); G.key('KeyW', false); G.key('ShiftLeft', false); return +G.h.f.x.toFixed(2); };
      out.bodyWall = run(-30.5, -5, 2, 10);
      out.bodyDoor = run(-30.5, -1, 2, 10);
      out.doorAlive = m.map.panels.filter((q) => q.kind === 'door').some((q) => q.alive && Math.abs((q.box.minZ + q.box.maxZ) / 2 + 1) < 0.1 && q.box.minX < -27.9);
      // memory: the same match started again and again keeps the same amount on the graphics card
      const ren = R.renderer(), geo = [];
      for (let i = 0; i < 5; i++) { await R.modeStart('bomb', { map: maps, seed: 3 }); R.step(1, 60); R.renderFrame(); geo.push(ren.info.memory.geometries); }
      out.geo = geo;
      // the Rust core is what answers collision and paths, and old maps are freed in it too
      const core = globalThis.__recoilCore;
      out.core = !!core && core.e.rc_abi() === 4 && R.modeGame().map.world.id >= 0;
      out.worlds = core ? core.e.rc_world_count() : -1;
      // death replay ends before the respawn in Team Deathmatch
      await R.modeStart('tdm', { map: maps, seed: 3 });
      const G2 = R.modeGame(), m2 = G2.m, me2 = G2.me;
      R.step(1, 60);
      const k = m2.actors.find((a) => a.team !== me2.team);
      me2.protectUntil = 0; m2.hit(me2, 500, k, 'torso');
      R.step(0.5, 60); out.kcOn = !!G2.kc;
      R.step(2.35, 60); out.kcOffBeforeRespawn = !G2.kc && !me2.alive;
      R.step(0.5, 60); out.respawned = me2.alive;
      R.battleLeave();
      // Battle: sprint at a thin wall of the Casino (0.25 m) at 10 FPS
      R.battleStart({ opponent: 'bots', bots: 1, level: 'easy', kills: 99, map: 'casino' });
      const B = R.battle(), h = B.humans[0];
      for (const b of B.bots) { b.update = () => {}; b.f.x = 18; b.f.z = 12; }
      R.step(0.2, 60);
      h.f.x = -6.5; h.f.z = -13.9; h.f.y = 0; h.f.vx = h.f.vz = 0; h.f.protectUntil = 1e9; h.look.setAngles(270, 0);
      B.key('KeyW', true); B.key('ShiftLeft', true); R.step(2, 10); B.key('KeyW', false); B.key('ShiftLeft', false);
      out.casinoWall = +h.f.x.toFixed(2);
      R.battleLeave();
      return out;
    });
    check('every mode starts and runs on its maps', mm.started.every((s) => s.endsWith(':ok')), mm.started.join(' '));
    check('a new match starts with an empty kill feed', mm.feedAtStart === 0, String(mm.feedAtStart));
    check('a drone driven at a wall stays outside it at 10, 15 and 30 FPS (x ' + mm.droneWall.join(', ') + ')', mm.drone && mm.droneWall.every((x) => x < -28.2 && x > -28.6), JSON.stringify(mm.droneWall));
    check('a drone cannot pass a reinforced wall at 10 FPS', mm.droneReinforced < -28.1, String(mm.droneReinforced));
    check('a drone rolls under a boarded door', mm.droneUnderDoor > -27.6, String(mm.droneUnderDoor));
    check('sprinting at a wall or a boarded door at 10 FPS does not get you through (x ' + mm.bodyWall + ', ' + mm.bodyDoor + ')', mm.bodyWall < -28.4 && mm.bodyDoor < -28.3 && mm.doorAlive, JSON.stringify(mm));
    check('graphics memory is steady across match restarts (geometries ' + mm.geo.join(', ') + ')', Math.max(...mm.geo) - Math.min(...mm.geo) <= 6, mm.geo.join(','));
    check('the Rust core (WebAssembly) is loaded and holds exactly the current map', mm.core && mm.worlds === 1, JSON.stringify({ core: mm.core, worlds: mm.worlds }));
    check('the death replay ends before the Team Deathmatch respawn', mm.kcOn && mm.kcOffBeforeRespawn && mm.respawned, JSON.stringify({ on: mm.kcOn, off: mm.kcOffBeforeRespawn, back: mm.respawned }));
    check('Battle: sprinting at a thin Casino wall at 10 FPS does not get you through', mm.casinoWall > -7.9, String(mm.casinoWall));
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

  /* ---------- stairs, upper floors, falling, vaulting and the Bomb boundary, played ---------- */
  console.log('\nMatch modes: stairs, upper floors, falling, vaulting, defenders kept inside (played with the keys)');
  {
    const { page, errors } = await openPage('index.html?test');
    await page.waitForFunction(() => window.__range && window.__range.ready);
    const ph = await page.evaluate(async () => {
      const R = window.__range, out = {};
      R.manual(true); R.setGraphics('standard');
      const prefs = (mode, map, side = 'attack') => ({ map: { tdm: 'casino', ctf: 'yard', bomb: 'ranch', [mode]: map }, seed: 3, side, op: { tdm: 'glitch', ctf: 'dash', bomb: side === 'attack' ? 'pace' : 'kamai' }, abilities: { tdm: false, ctf: false, bomb: true } });
      const yawTo = (dx, dz) => Math.atan2(dx, -dz) * 180 / Math.PI;
      const park = (G) => { for (const a of G.m.actors) if (a !== G.me) a.brain = null; G.me.protectUntil = 1e9; };
      const put = (G, x, z, y, yaw) => { const f = G.h.f; f.x = x; f.z = z; f.y = y; f.vx = f.vy = f.vz = 0; G.h.camY = y; G.h.vault = null; G.me.x = x; G.me.z = z; G.me.y = y; G.h.look.setAngles(yaw, 0); };
      // Walk the player along the game's own path with W held (sprinting), turning at each corner.
      const walk = (G, to, secs, fps) => {
        const f = G.h.f; let t = 0, top = f.y;
        G.key('ShiftLeft', true);
        while (t < secs && !(Math.hypot(to[0] - f.x, to[1] - f.z) < 0.5 && Math.abs(f.y - to[2]) < 0.5)) {
          const path = G.map.path(f.x, f.z, to[0], to[1], f.y, to[2]);
          // a vault on the way: face it and press C (as a player does)
          if (path[0] && path[0][3] === 1 && path[1] && Math.hypot(path[0][0] - f.x, path[0][1] - f.z) < 0.45) {
            const ex = path[1][0] - f.x, ez = path[1][1] - f.z, ax = Math.abs(ex) > Math.abs(ez);
            G.h.look.setAngles(yawTo(ax ? Math.sign(ex) : 0, ax ? 0 : Math.sign(ez)), 0);
            G.key('KeyW', false); G.key('KeyC', true); R.step(0.1, fps); G.key('KeyC', false); R.step(0.6, fps); t += 0.7; continue;
          }
          const wp = path.find((p) => Math.hypot(p[0] - f.x, p[1] - f.z) > 0.35) || to;
          G.h.look.setAngles(yawTo(wp[0] - f.x, wp[1] - f.z), 0);
          G.key('KeyW', true); R.step(0.1, fps); t += 0.1;
          top = Math.max(top, f.y);
        }
        G.key('KeyW', false); G.key('ShiftLeft', false); R.step(0.3, fps);
        return { t: +t.toFixed(1), x: f.x, y: f.y, z: f.z, top, there: Math.hypot(to[0] - f.x, to[1] - f.z) < 0.6 && Math.abs(f.y - to[2]) < 0.5 };
      };
      /* Team Deathmatch on Jesse's Casino: up to the top floor and down again */
      await R.modeStart('tdm', prefs('tdm', 'casino'));
      let G = R.modeGame(); park(G);
      // the upper floor: the level above 2.5 m with the most places on it
      const N = G.map.nodes, lv = new Map(); for (const n of N) if (n[2] > 2.5) lv.set(n[2], (lv.get(n[2]) || 0) + 1);
      const topY = [...lv.entries()].sort((p, q) => q[1] - p[1])[0][0], up = N.filter((n) => n[2] === topY)[0], down = N.filter((n) => n[2] === 0).sort((a, b) => Math.hypot(b[0] - up[0], b[1] - up[1]) - Math.hypot(a[0] - up[0], a[1] - up[1]))[0];
      const start = [G.h.f.x, G.h.f.z, G.h.f.y];
      out.topY = topY; out.levels = new Set(N.map((n) => n[2])).size;
      out.climb = walk(G, up, 60, 60);
      out.camUp = +(G.h.camera.position.y - G.h.f.y).toFixed(2); out.simY = G.me.y;
      // a bot standing up here is drawn up here
      const bot = G.m.actors.find((a) => a !== G.me && a.alive); bot.x = up[0] + 1; bot.z = up[1]; bot.y = topY; R.step(0.1, 60); R.renderFrame();
      out.botDrawnAt = +G.fig.get(bot.id).group.position.y.toFixed(2);
      // crouch (Space) and aim on the upper floor
      G.key('Space', true); R.step(0.6, 60); out.crouchUp = +G.h.f.crouch.toFixed(2); out.crouchY = G.h.f.y; G.key('Space', false); R.step(0.4, 60);
      // walk off the edge: find a side where the floor ends, walk off it, land
      out.fall = null;
      for (let k = 0; k < 400 && !out.fall; k++) {
        const n = N.filter((q) => q[2] === topY)[k]; if (!n) break;
        for (const ang of [0, 90, 180, 270]) {
          const dx = Math.sin(ang * Math.PI / 180), dz = -Math.cos(ang * Math.PI / 180);
          let d = 0; while (d < 6 && G.map.groundAt(n[0] + dx * d, n[1] + dz * d, topY) > topY - 0.5 && G.map.free(n[0] + dx * d, n[1] + dz * d, 0.32, topY)) d += 0.25;
          if (d >= 6 || !G.map.free(n[0] + dx * (d + 0.5), n[1] + dz * (d + 0.5), 0.32, topY) || G.map.groundAt(n[0] + dx * (d + 0.5), n[1] + dz * (d + 0.5), topY) > topY - 2) continue;      // a wall, a rail or a step down: not a drop
          put(G, n[0], n[1], topY, ang);
          let air = false, lowest = topY;
          G.key('KeyW', true);
          for (let i = 0; i < 40; i++) { R.step(0.1, 60); if (G.h.f.vy < -0.5) air = true; lowest = Math.min(lowest, G.h.f.y); }
          G.key('KeyW', false); R.step(0.5, 60);
          if (air) { out.fall = { from: topY, air, y: G.h.f.y, lowest, vy: G.h.f.vy, onGround: Math.abs(G.map.groundAt(G.h.f.x, G.h.f.z, G.h.f.y) - G.h.f.y) < 1e-6, alive: G.me.alive }; break; }
        }
      }
      out.descend = walk(G, down, 60, 15);
      /* vaulting (C): over low cover in Team Deathmatch on Container Yard */
      await R.modeStart('tdm', prefs('tdm', 'containers'));
      G = R.modeGame(); park(G);
      out.vault = null;
      for (const b of G.map.solids) {
        if (out.vault || b.minY > 0.05 || b.maxY < 0.8 || b.maxY > 1.3 || b.kind === 'edge') continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = (b.minX + b.maxX) / 2 - dx * ((b.maxX - b.minX) / 2 + 0.5), z = (b.minZ + b.maxZ) / 2 - dz * ((b.maxZ - b.minZ) / 2 + 0.5);
          if (!G.map.free(x, z, 0.32, 0) || G.map.groundAt(x, z, 0) > 0.01) continue;
          const v = G.map.vaultTarget(x, 0, z, dx, dz);
          if (!v || v.y > 0.05) continue;                         // over it, to the far side
          put(G, x, z, 0, yawTo(dx, dz)); R.step(0.2, 60);
          G.key('KeyC', true); R.step(0.1, 60); const mid = !!G.h.vault; let peak = 0;
          for (let i = 0; i < 12; i++) { R.step(0.05, 60); peak = Math.max(peak, G.h.f.y); }
          G.key('KeyC', false); R.step(0.3, 60);
          out.vault = { h: b.maxY, mid, peak: +peak.toFixed(2), crossed: (G.h.f.x - x) * dx + (G.h.f.z - z) * dz, want: (v.x - x) * dx + (v.z - z) * dz, y: G.h.f.y, sim: Math.hypot(G.me.x - G.h.f.x, G.me.z - G.h.f.z) };
          break;
        }
      }
      // C in the open does nothing; a tall wall is not climbed
      put(G, G.map.nodes[0][0], G.map.nodes[0][1], G.map.nodes[0][2], 0);
      const tall = G.map.solids.find((b) => b.kind === 'edge' && b.minX > 0);
      put(G, tall.minX - 0.5, 0.3, 0, 90); R.step(0.2, 60); G.key('KeyC', true); R.step(0.4, 60); G.key('KeyC', false);
      out.noVaultWall = !G.h.vault && G.h.f.x < tall.minX;
      /* Bomb on Ranch as a defender: the opened west door and a breached outside wall */
      await R.modeStart('bomb', prefs('bomb', 'ranch', 'defend'));
      G = R.modeGame(); park(G);
      out.defender = !G.m.rules.isAttacker(G.me);
      const door = G.map.panels.find((q) => q.kind === 'door' && !q.win && q.box.minX < -27.9 && q.box.maxX > -28.1);
      G.map.hurtDoor(door, 999);
      const dz0 = (door.box.minZ + door.box.maxZ) / 2;
      const push = (x, z, yaw, secs, fps) => { put(G, x, z, 0, yaw); G.key('KeyW', true); G.key('ShiftLeft', true); let far = 1e9; for (let i = 0; i < secs * 10; i++) { R.step(0.1, fps); far = Math.min(far, G.h.f.x); } G.key('KeyW', false); G.key('ShiftLeft', false); return far; };
      out.doorOpen = !door.alive;
      out.defOut = [push(-26.5, dz0, 270, 2, 60), push(-26.5, dz0, 270, 2, 10)];
      R.step(0.05, 60);
      out.warn = G.hud.banner.hidden ? '' : G.hud.banner.textContent;
      // back in the middle of the house the warning goes away
      put(G, -15, 7, 0, 0); R.step(2, 60);
      out.warnInside = G.hud.banner.hidden ? '' : G.hud.banner.textContent;
      // a breached soft wall in the west outside wall (x = -28, z 9..12) and the window (z 5..7) broken open
      const softN = G.map.panels.filter((q) => (q.kind === 'soft' || q.win) && q.box.minX < -27.9 && q.box.maxX > -28.1);
      for (const q of softN) G.map.breakPanel(q);
      out.defOutSoft = -1e9;
      for (const q of softN) { const sz = (q.box.minZ + q.box.maxZ) / 2; put(G, -26.6, sz, 0, 270); G.key('KeyW', true); G.key('ShiftLeft', true); for (let i = 0; i < 20; i++) { R.step(0.1, 15); out.defOutSoft = Math.max(out.defOutSoft, -G.h.f.x); } G.key('KeyW', false); G.key('ShiftLeft', false); G.key('KeyC', true); R.step(0.6, 15); G.key('KeyC', false); R.step(0.3, 15); out.defOutSoft = Math.max(out.defOutSoft, -G.h.f.x); }
      out.softBroken = softN.length; out.defOutSoft = -out.defOutSoft;
      // defender bots too: one sent outside comes no farther than the wall line
      const db = G.m.actors.find((a) => a !== G.me && !G.m.rules.isAttacker(a));
      db.x = -26.5; db.z = dz0; db.y = 0; let botFar = 1e9; for (let i = 0; i < 120; i++) { G.m.moveActor(db, -5.6, 0, 1 / 60); G.m.step(); botFar = Math.min(botFar, db.x); }
      out.botOut = botFar;
      /* the same door as an attacker: out you go */
      await R.modeStart('bomb', prefs('bomb', 'ranch', 'attack'));
      G = R.modeGame(); park(G);
      while (G.m.rules.phase === 'prep') R.step(1, 60);
      const door2 = G.map.panels.find((q) => q.kind === 'door' && !q.win && q.box.minX < -27.9 && q.box.maxX > -28.1);
      G.map.hurtDoor(door2, 999);
      put(G, -26.5, dz0, 0, 270); G.key('KeyW', true); R.step(2, 60); G.key('KeyW', false);
      out.attOut = G.h.f.x; out.attWarn = G.hud.banner.hidden ? '' : G.hud.banner.textContent;
      R.battleLeave();
      /* Battle: the same stairs with the same body */
      R.battleStart({ opponent: 'bots', bots: 1, level: 'easy', kills: 99, map: 'casino' });
      const B = R.battle(), h = B.humans[0];
      for (const b of B.bots) { b.update = () => {}; b.f.x = 18; b.f.z = 12; }
      // Start downstairs so a random upper-floor spawn cannot bypass the stairs.
      h.respawn(-19.25, 14.75, B.t, 0);
      h.f.protectUntil = 1e9; R.step(0.2, 60);
      const A = B.arena, topB = topY, goal = up;        // the same top-floor spot as in Team Deathmatch
      let tB = 0;
      while (tB < 60 && !(Math.hypot(goal[0] - h.f.x, goal[1] - h.f.z) < 0.6 && Math.abs(h.f.y - topB) < 0.5)) {
        const path = A.findPath(h.f.x, h.f.z, goal[0], goal[1], h.f.y, topB);
        if (path[0] && path[0][3] === 1 && path[1] && Math.hypot(path[0][0] - h.f.x, path[0][1] - h.f.z) < 0.45) {
          const ex = path[1][0] - h.f.x, ez = path[1][1] - h.f.z, ax = Math.abs(ex) > Math.abs(ez);
          h.look.setAngles(yawTo(ax ? Math.sign(ex) : 0, ax ? 0 : Math.sign(ez)), 0); B.key('KeyW', false); B.key('KeyC', true); R.step(0.1, 30); B.key('KeyC', false); R.step(0.6, 30); tB += 0.7; continue;
        }
        const wp = path.find((p) => Math.hypot(p[0] - h.f.x, p[1] - h.f.z) > 0.35) || goal;
        h.look.setAngles(yawTo(wp[0] - h.f.x, wp[1] - h.f.z), 0); B.key('KeyW', true); R.step(0.1, 30); tB += 0.1;
      }
      B.key('KeyW', false);
      out.battleTop = { want: topB, y: h.f.y, t: +tB.toFixed(1) };
      out.sameTop = A.nodeAt(up[0], up[1], topY) >= 0;
      R.battleLeave();
      return out;
    });
    check('Casino in Team Deathmatch has its upper floors (' + ph.levels + ' levels, the top one ' + ph.topY + ' m up)', ph.levels > 5 && ph.topY > 2.5, JSON.stringify(ph));
    check('you walk up the stairs to the top floor with W held (' + ph.climb.t + ' s; feet at ' + ph.climb.y.toFixed(2) + ' m)', ph.climb.there && Math.abs(ph.climb.y - ph.topY) < 0.01 && Math.abs(ph.simY - ph.topY) < 0.01, JSON.stringify(ph.climb));
    check('the camera is at eye height above the floor you stand on (' + ph.camUp + ' m)', ph.camUp > 1.4 && ph.camUp < 1.7, String(ph.camUp));
    check('a bot upstairs is drawn upstairs', Math.abs(ph.botDrawnAt - ph.topY) < 0.01, String(ph.botDrawnAt));
    check('crouching works on the upper floor (Space)', ph.crouchUp > 0.9 && Math.abs(ph.crouchY - ph.topY) < 0.01, JSON.stringify([ph.crouchUp, ph.crouchY]));
    check('walking off the edge you fall and land on your feet below (from ' + (ph.fall && ph.fall.from) + ' m to ' + (ph.fall && ph.fall.y.toFixed(2)) + ' m)', !!ph.fall && ph.fall.air && ph.fall.y < ph.fall.from - 1 && ph.fall.y >= 0 && ph.fall.onGround && ph.fall.vy === 0 && ph.fall.alive, JSON.stringify(ph.fall));
    check('and you walk back down to the ground floor at 15 FPS (' + ph.descend.t + ' s)', ph.descend.there && Math.abs(ph.descend.y) < 0.01, JSON.stringify(ph.descend));
    check('C vaults over low cover in a match mode (a ' + (ph.vault && ph.vault.h.toFixed(2)) + ' m obstacle; feet up to ' + (ph.vault && ph.vault.peak) + ' m)', !!ph.vault && ph.vault.mid && ph.vault.peak > ph.vault.h && Math.abs(ph.vault.crossed - ph.vault.want) < 0.3 && Math.abs(ph.vault.y) < 0.01 && ph.vault.sim < 0.3, JSON.stringify(ph.vault));
    check('C at a full-height wall does nothing', ph.noVaultWall);
    check('Bomb defender: sprinting out of an opened outside door stops at the wall line, at 60 and 10 FPS (x ' + ph.defOut.map((v) => v.toFixed(2)).join(', ') + ')', ph.defender && ph.doorOpen && ph.defOut.every((x) => x >= -28.001), JSON.stringify(ph.defOut));
    check('a quiet warning shows there ("' + ph.warn + '") and goes away inside', /inside the building/.test(ph.warn) && ph.warnInside === '', JSON.stringify([ph.warn, ph.warnInside]));
    check('a breached outside wall or an opened window (sprinting at it, then C to vault) does not let a defender out either (x ' + ph.defOutSoft.toFixed(2) + ')', ph.softBroken > 2 && ph.defOutSoft >= -28.001, JSON.stringify([ph.softBroken, ph.defOutSoft]));
    check('defender bots are held at the same line (x ' + ph.botOut.toFixed(2) + ')', ph.botOut >= -28.001, String(ph.botOut));
    check('an attacker walks out of the same door freely, with no warning (x ' + ph.attOut.toFixed(2) + ')', ph.attOut < -30 && ph.attWarn === '', JSON.stringify([ph.attOut, ph.attWarn]));
    check('Battle uses the same body on the same stairs: up to the Casino top floor (' + ph.battleTop.t + ' s)', ph.sameTop && Math.abs(ph.battleTop.y - ph.battleTop.want) < 0.01, JSON.stringify(ph.battleTop));
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

  /* ---------- Bomb prep and destruction, played ---------- */
  console.log('\nBomb: reinforcing, barricading, barbed wire, wall holes, windows (played with the keys)');
  {
    const { page, errors } = await openPage('index.html?test');
    await page.waitForFunction(() => window.__range && window.__range.ready);
    const bp = await page.evaluate(async () => {
      const R = window.__range, out = {};
      R.manual(true); R.setGraphics('standard');
      const start = async (side, prep = 30) => { await R.modeStart('bomb', { map: { tdm: 'containers', ctf: 'yard', bomb: 'ranch' }, seed: 3, side, prepTime: prep, op: { tdm: 'glitch', ctf: 'dash', bomb: side === 'attack' ? 'pace' : 'kamai' }, abilities: { tdm: false, ctf: false, bomb: true } }); const G = R.modeGame(); for (const a of G.m.actors) if (a !== G.me) { a.brain = null; a.x = 36; a.z = 27 - a.id; } G.me.protectUntil = 1e9; return G; };
      const put = (G, x, z, yaw) => { const f = G.h.f; f.x = x; f.z = z; f.y = 0; f.vx = f.vy = f.vz = 0; G.h.camY = 0; G.h.vault = null; G.me.x = x; G.me.z = z; G.me.y = 0; G.h.look.setAngles(yaw, 0); };
      /* a defender in prep, 45 s of it this time */
      let G = await start('defend', 45), m = G.m;
      out.prep = +(m.rules.phaseEnd - m.t).toFixed(1); out.reinfLeft = G.me.reinf;
      // the soft wall between the bedroom and the hallway (z = 1, x -25..-22), from the bedroom side
      const soft = m.map.panels.find((q) => q.kind === 'soft' && q.box.minZ < 1.1 && q.box.maxZ > 0.9 && q.box.maxX <= -22.4);
      put(G, (soft.box.minX + soft.box.maxX) / 2, 2.1, 0); R.step(0.2, 60);
      G.key('Interact', true); R.step(1.0, 60); out.midHold = G.me.hold && G.me.hold.type; R.step(1.8, 60); G.key('Interact', false); R.step(0.1, 60);
      out.reinforced = soft.kind === 'reinforced' && soft.cells.every((c) => c.alive && c.kind === 'reinforced'); out.reinfAfter = G.me.reinf;
      // the doorway from the bedroom to the hallway (x -17..-15.6): open, then barricaded
      const slot = m.map.panels.find((q) => q.kind === 'door' && q.slot && q.box.minZ < 1.1 && q.box.maxZ > 0.9 && q.box.minX > -17.1 && q.box.maxX < -15.5);
      out.slotOpen = !slot.alive && m.map.walkClear(-16.3, 2.2, -16.3, -0.2, 0.3);
      put(G, -16.3, 2.1, 0); R.step(0.2, 60);
      G.key('Interact', true); R.step(1.7, 60); G.key('Interact', false); R.step(0.1, 60);
      out.barricaded = slot.alive && !m.map.walkClear(-16.3, 2.2, -16.3, -0.2, 0.3);
      // barbed wire (Caps Lock), laid in the open bedroom, then an attacker walks through it
      put(G, -20, 3.5, 0); G.h.look.setAngles(0, -30); R.step(0.2, 60);
      const n0 = m.ab.gadgets.filter((g) => g.alive && g.type === 'wire').length;
      G.key('CapsLock', true); G.key('CapsLock', false); R.step(0.2, 60);
      const wire = m.ab.gadgets.find((g) => g.alive && g.type === 'wire');
      out.wireLaid = !!wire && m.ab.gadgets.filter((g) => g.alive && g.type === 'wire').length === n0 + 1; out.wireLeft = G.me.wire;
      out.wireText = G.hud.nades.textContent;
      while (m.rules.phase === 'prep') R.step(1, 60);
      const at = m.actors.find((a) => m.rules.isAttacker(a)); at.alive = true; at.hp = 100; at.protectUntil = 0;
      const step = (a, secs = 0.5) => { const x0 = a.x; for (let i = 0; i < secs * 60; i++) { m.moveActor(a, 3.4 * m.speedOf(a), 0, 1 / 60); m.step(); } return (a.x - x0) / secs; };
      at.x = wire.x - 4; at.z = wire.z; at.y = 0; at.vx = at.vz = 0; out.freeSpeed = +step(at).toFixed(2);
      at.x = wire.x - 1.1; at.z = wire.z; at.vx = at.vz = 0; const hp0 = at.hp; out.wireSpeed = +step(at, 1.2).toFixed(2); out.wireHurt = hp0 - at.hp;
      // the attacker knifes it
      at.x = wire.x - 1.3; at.z = wire.z; at.yaw = 90; at.pitch = 0; at.knifeAt = 0; m.knife(at);
      out.wireCut = !wire.alive;
      /* an attacker in the action phase: holes in a soft wall, a window */
      G = await start('attack'); m = G.m;
      while (m.rules.phase === 'prep') R.step(1, 60);
      // the soft wall between the kitchen and the hallway (z = -3, x -6..-3) from the kitchen side
      const sw = m.map.panels.find((q) => q.kind === 'soft' && q.box.minZ < -2.9 && q.box.maxZ > -3.1 && q.box.minX >= -6.01);
      const cx = (sw.box.minX + sw.box.maxX) / 2;
      put(G, cx, -5, 0); R.step(0.2, 60);
      const shots0 = sw.cells.filter((c) => c.alive).length;
      for (let i = 0; i < 12; i++) { G.mouse && 0; m.shoot(G.me, [cx, 1.4, -5], [0, 0, 1]); }
      out.cellsAfterShots = [shots0, sw.cells.filter((c) => c.alive).length];
      out.seeThrough = m.map.sight([cx, 1.4, -5], [cx, 1.4, -1]);
      // the knife makes another hole beside it
      put(G, cx + 0.5, -3.6, 180); G.h.look.setAngles(180, 10); R.step(0.8, 60); G.key('KeyK', true); G.key('KeyK', false); R.step(0.2, 60);
      out.cellsAfterKnife = sw.cells.filter((c) => c.alive).length;
      R.renderFrame();
      // the boarded window of the bedroom (west wall, z 5..7): knife it open, then C to vault in
      const win = m.map.panels.find((q) => q.win && q.box.minX < -27.9 && q.box.maxX > -28.1);
      out.winBoarded = win.alive;
      put(G, -29.1, 6, 90); R.step(0.8, 60);
      for (let i = 0; i < 3 && win.alive; i++) { G.key('KeyK', true); G.key('KeyK', false); R.step(0.8, 60); }
      out.winOpen = !win.alive;
      G.key('KeyC', true); R.step(0.1, 60); out.vaulting = !!G.h.vault; R.step(0.6, 60); G.key('KeyC', false); R.step(0.3, 60);
      out.inside = G.h.f.x > -27.6 && Math.abs(G.h.f.y) < 0.01;
      R.battleLeave();
      return out;
    });
    check('preparation time is a match option (45 s asked, ' + bp.prep + ' s given)', Math.abs(bp.prep - 45) < 0.5, String(bp.prep));
    check('a defender holding Interact at a soft wall reinforces it in 2.5 s (2 a round)', bp.midHold === 'reinforce' && bp.reinforced && bp.reinfLeft === 2 && bp.reinfAfter === 1, JSON.stringify(bp));
    check('interior doorways start open; holding Interact in one barricades it', bp.slotOpen && bp.barricaded, JSON.stringify(bp));
    check('Caps Lock lays barbed wire for a Bomb defender (2 a round; the HUD says so)', bp.wireLaid && bp.wireLeft === 1 && /barbed wire/.test(bp.wireText), JSON.stringify(bp));
    check('wire slows an attacker to under half speed and scratches (' + bp.freeSpeed + ' to ' + bp.wireSpeed + ' m/s, ' + bp.wireHurt + ' damage)', bp.wireSpeed < bp.freeSpeed * 0.5 && bp.wireHurt > 0 && bp.wireHurt < 5, JSON.stringify(bp));
    check('a knife clears the wire', bp.wireCut);
    check('bullets chip a soft wall into a hole you can see through (cells ' + bp.cellsAfterShots.join(' to ') + ' of 12)', bp.cellsAfterShots[1] < bp.cellsAfterShots[0] && bp.cellsAfterShots[1] >= 8 && bp.seeThrough, JSON.stringify(bp));
    check('the knife breaks one more cell', bp.cellsAfterKnife === bp.cellsAfterShots[1] - 1, JSON.stringify(bp));
    check('outside windows start boarded; knife it open and C vaults you in', bp.winBoarded && bp.winOpen && bp.vaulting && bp.inside, JSON.stringify(bp));
    check('no page errors', errors.length === 0, errors.join('\n'));
    await page.close();
  }

  // Network battle between two separate browser sessions (as two PCs would be): join codes,
  // positions both ways, shots both ways, kill feed, host ending the match.
  // Runs over direct join codes and, when a relay is running (RELAY=url, or wrangler dev on
  // port 8787 in relay/), over the relay with a game code.
  const RELAY = process.env.RELAY || 'http://127.0.0.1:8787';
  let relayUp = false;
  try { relayUp = /Recoil Range relay/.test(await (await fetch(RELAY + '/')).text()); } catch (e) { /* not running */ }
  if (!relayUp) console.log('\n(relay not running at ' + RELAY + ': skipping the relay network test; run "npx wrangler dev --port 8787" in relay/)');
  for (const via of relayUp ? ['lan', 'relay'] : ['lan']) {
    console.log('\nNetwork battle (two browser sessions, ' + (via === 'lan' ? 'join codes' : 'relay game code') + ')');
    const A = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
    const B = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
    const nerr = [];
    for (const [n, p] of [['host', A], ['player', B]]) p.on('pageerror', (e) => nerr.push(n + ': ' + String(e.stack || e)));
    for (const p of [A, B]) { await p.goto(BASE + 'index.html?test' + (via === 'relay' ? '&relay=' + encodeURIComponent(RELAY) : ''), { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__range); }
    for (const p of [A, B]) { await p.locator('[data-first-profile=mouse]').click(); await p.evaluate(() => document.querySelector('.mode-card[data-mode=net]').click()); }
    let connected = true, join = '';
    if (via === 'relay') {
      for (const p of [A, B]) await p.click('#net-via-relay');
      await B.click('#net-join');
      await B.fill('#relay-in', 'zzzz'); await B.click('#relay-connect');
      let refused = true;
      try { await B.waitForFunction(() => /No game with that code/.test(document.getElementById('net-status').textContent), null, { timeout: 8000 }); } catch (e) { refused = false; }
      check('a wrong game code is refused with a clear message', refused, await B.textContent('#net-status'));
      await A.click('#net-host');
      await A.waitForFunction(() => /^[A-Z2-9]{4}$/.test(document.getElementById('relay-code').textContent), null, { timeout: 8000 });
      join = await A.textContent('#relay-code');
      await B.fill('#relay-in', join.toLowerCase()); await B.click('#relay-connect');
      try {
        await B.waitForFunction(() => /Connected/.test(document.getElementById('net-status').textContent), null, { timeout: 8000 });
        await A.waitForFunction(() => /Player 2/.test(document.getElementById('relay-players').textContent), null, { timeout: 8000 });
      } catch (e) { connected = false; }
      check('the game code ' + join + ' connects two sessions through the relay', connected, await B.textContent('#net-status') + ' / ' + await A.textContent('#relay-players'));
    } else {
    for (const p of [A, B]) await p.click('#net-via-lan');
    await A.click('#net-host');
    await B.click('#net-join');
    await B.waitForFunction(() => document.getElementById('net-out-j').value.startsWith('RR1-'));
    join = await B.inputValue('#net-out-j');
    await A.fill('#net-in-h', join); await A.click('#net-accept');
    await A.waitForFunction(() => document.getElementById('net-out-h').value.startsWith('RR1-'));
    await B.fill('#net-in-j', await A.inputValue('#net-out-h')); await B.click('#net-connect');
    try { await B.waitForFunction(() => /Connected/.test(document.getElementById('net-status').textContent), null, { timeout: 25000 }); } catch (e) { connected = false; }
    check('join codes connect two sessions (code ' + join.length + ' characters)', connected, await B.textContent('#net-status'));
    }
    const lag = via === 'relay' ? 25 : 5;
    if (connected) {
      await A.evaluate(() => { const R = window.__range; R.manual(true); R.battleStart({ opponent: 'net', bots: 1, level: 'easy', kills: 10 }); });
      await B.waitForFunction(() => window.__range.battle() && window.__range.battle().active, null, { timeout: 5000 });
      await B.evaluate(() => window.__range.manual(true));
      const run = async (sec) => { for (let i = 0; i < sec * 20; i++) { await A.evaluate(() => window.__range.step(0.05, 60)); await B.evaluate(() => window.__range.step(0.05, 60)); await new Promise((r) => setTimeout(r, lag)); } };
      await run(1);
      await A.evaluate(() => { const Bt = window.__range.battle(); for (const b of Bt.bots) { b.update = () => {}; b.f.x = -16; b.f.z = -12; } const h = Bt.humans[0]; h.f.x = 16; h.f.z = 12; h.f.protectUntil = 0; });
      await B.evaluate(() => { const h = window.__range.battle().humans[0]; h.f.x = 16; h.f.z = 2; h.f.protectUntil = 0; });
      await run(0.6);
      const seen = {
        host: await A.evaluate(() => { const r = window.__range.battle().remotes[0].f; return [r.x, r.z]; }),
        player: await B.evaluate(() => window.__range.battle().proxies.map((q) => [q.f.name, Math.round(q.f.x), Math.round(q.f.z)])),
      };
      check('positions sync both ways (host sees the player, the player sees the host and the bot)',
        seen.host[0] === 16 && seen.host[1] === 2 && seen.player.some((p) => p[0] === 'Host' && p[1] === 16 && p[2] === 12) && seen.player.length === 2, JSON.stringify(seen));
      const tap = async (P, yaw) => {
        for (let k = 0; k < 8; k++) {
          await P.evaluate((yaw) => { const Bt = window.__range.battle(); Bt.humans[0].look.setAngles(yaw, Math.atan2(1.18 - 1.6, 10) * 180 / Math.PI); Bt.mouseButton(0, true); }, yaw);
          await run(0.05);
          await P.evaluate(() => window.__range.battle().mouseButton(0, false));
          await run(0.5);
        }
      };
      await tap(B, 180);                       // the player shoots the host
      const r1 = await A.evaluate(() => { const Bt = window.__range.battle(); return { hostDeaths: Bt.humans[0].f.deaths, playerKills: Bt.remotes[0].f.kills }; });
      const feed1 = await B.evaluate(() => window.__range.battle().hud.feed.textContent);
      check('the player on the other PC kills the host; the kill feed shows on both', r1.hostDeaths === 1 && r1.playerKills === 1 && /Player 2 › Host/.test(feed1), JSON.stringify(r1) + feed1);
      await run(3.5);
      await A.evaluate(() => { const Bt = window.__range.battle(); const h = Bt.humans[0]; h.f.x = 16; h.f.z = 12; h.f.protectUntil = 0; Bt.remotes[0].f.protectUntil = 0; });
      await B.evaluate(() => { const h = window.__range.battle().humans[0]; h.f.x = 16; h.f.z = 2; h.f.protectUntil = 0; });
      await run(0.3);
      await tap(A, 0);                          // the host shoots back
      const r2 = await B.evaluate(() => { const Bt = window.__range.battle(); return { myDeaths: Bt.fighters.find((f) => f.id === Bt.net.myId).deaths, kc: Bt.lastKillCam }; });
      check('the host kills the player; the player\'s PC shows its own death', r2.myDeaths >= 1, JSON.stringify(r2));
      check('the player\'s PC replays the host shooting them (kill cam with recorded shots)', r2.kc && r2.kc.killer === 'Host' && r2.kc.frames > 20 && r2.kc.shots >= 1, JSON.stringify(r2.kc));
      await A.evaluate(() => window.__range.battleLeave());
      await run(0.3);
      const end = await B.evaluate(() => ({ active: window.__range.battle().active, status: document.getElementById('net-status').textContent }));
      check('host ending the match returns the player to the menu, still connected', !end.active && /Still connected/.test(end.status), JSON.stringify(end));
      if (via === 'relay') {
        await A.click('#net-reset');
        let told = true;
        try { await B.waitForFunction(() => /host left/i.test(document.getElementById('net-status').textContent), null, { timeout: 8000 }); } catch (e) { told = false; }
        check('when the host disconnects, the player is told', told, await B.textContent('#net-status'));
      }
    }
    check('no page errors in either session', nerr.length === 0, nerr.join('\n'));
    await A.close(); await B.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? '\n' + failures + ' FAILED' : '\nAll checks passed');
process.exit(failures ? 1 : 0);
