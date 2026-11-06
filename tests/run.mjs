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
      out.wallBlocks = !A.sightLine([16, 1.5, 2.5], [11, 1.5, 2.5]);      // tall wall at x = 13.5
      out.lowWallCrouch = !A.sightLine([0, 0.9, 9], [0, 0.9, 7]);          // low wall at z = 8 hides a crouched head
      out.lowWallStand = A.sightLine([0, 1.6, 9], [0, 1.6, 7]);            // ...but not a standing one
      const p0 = B.bots.map((b) => [b.f.x, b.f.z]);
      R.step(8, 30);
      out.botsMoved = B.bots.filter((b, i) => Math.hypot(b.f.x - p0[i][0], b.f.z - p0[i][1]) > 1).length;
      out.inBounds = B.fighters.every((f) => Math.abs(f.x) < 18 && Math.abs(f.z) < 14);
      out.notInCover = B.fighters.every((f) => !A.boxes.some((b) => f.x > b.minX && f.x < b.maxX && f.z > b.minZ && f.z < b.maxZ));
      // Your shots: a frozen bot in the open lane, tapped at the chest from 10 m.
      const h = B.humans[0], bot = B.bots[0];
      for (const b of B.bots) b.update = () => {};
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
          inCover: B.fighters.filter((f) => A.boxes.some((b) => f.x > b.minX && f.x < b.maxX && f.z > b.minZ && f.z < b.maxZ)).length,
        };
        R.battleLeave();
      }
      return out;
    });
    check('maps: Container Yard, Winter Cabin, Jesse\'s Casino and School build; bots roam; paths cross; nobody inside cover',
      Object.entries(mp).every(([k, v]) => v.id === k && v.cover > 10 && v.path > 1 && v.moved >= 2 && v.inCover === 0), JSON.stringify(mp));

    // Bot levels: time for one bot to kill you standing in the open at 12 m.
    const lv = await page.evaluate(() => {
      const R = window.__range;
      const out = {};
      for (const level of ['easy', 'hard']) {
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

  // Network battle between two separate browser sessions (as two PCs would be): join codes,
  // positions both ways, shots both ways, kill feed, host ending the match.
  {
    console.log('\nNetwork battle (two browser sessions, join codes)');
    const A = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
    const B = await (await browser.newContext()).newPage({ viewport: { width: 960, height: 540 } });
    const nerr = [];
    for (const [n, p] of [['host', A], ['player', B]]) p.on('pageerror', (e) => nerr.push(n + ': ' + String(e.stack || e)));
    for (const p of [A, B]) { await p.goto(BASE + 'index.html?test', { waitUntil: 'networkidle' }); await p.waitForFunction(() => window.__range); }
    for (const p of [A, B]) await p.evaluate(() => document.querySelector('.mode-card[data-mode=net]').click());
    await A.click('#net-host');
    await B.click('#net-join');
    await B.waitForFunction(() => document.getElementById('net-out-j').value.startsWith('RR1-'));
    const join = await B.inputValue('#net-out-j');
    await A.fill('#net-in-h', join); await A.click('#net-accept');
    await A.waitForFunction(() => document.getElementById('net-out-h').value.startsWith('RR1-'));
    await B.fill('#net-in-j', await A.inputValue('#net-out-h')); await B.click('#net-connect');
    let connected = true;
    try { await B.waitForFunction(() => /Connected/.test(document.getElementById('net-status').textContent), null, { timeout: 25000 }); } catch (e) { connected = false; }
    check('join codes connect two sessions (code ' + join.length + ' characters)', connected, await B.textContent('#net-status'));
    if (connected) {
      await A.evaluate(() => { const R = window.__range; R.manual(true); R.battleStart({ opponent: 'net', bots: 1, level: 'easy', kills: 10 }); });
      await B.waitForFunction(() => window.__range.battle() && window.__range.battle().active, null, { timeout: 5000 });
      await B.evaluate(() => window.__range.manual(true));
      const run = async (sec) => { for (let i = 0; i < sec * 20; i++) { await A.evaluate(() => window.__range.step(0.05, 60)); await B.evaluate(() => window.__range.step(0.05, 60)); await new Promise((r) => setTimeout(r, 5)); } };
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
      const r2 = await B.evaluate(() => { const Bt = window.__range.battle(); return { myDeaths: Bt.fighters.find((f) => f.id === Bt.net.myId).deaths }; });
      check('the host kills the player; the player\'s PC shows its own death', r2.myDeaths >= 1, JSON.stringify(r2));
      await A.evaluate(() => window.__range.battleLeave());
      await run(0.3);
      const end = await B.evaluate(() => ({ active: window.__range.battle().active, status: document.getElementById('net-status').textContent }));
      check('host ending the match returns the player to the menu, still connected', !end.active && /Still connected/.test(end.status), JSON.stringify(end));
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
