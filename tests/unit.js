// Unit tests for the pure modules. Runs in the browser (tests/unit.html) so it uses exactly
// the same JS engine as the game. Results go to window.__results for tests/run.mjs.
import { degPerCount, countsPer360, inchesPer360, verticalFovDeg, zoomedFovDeg } from '../js/core/sensitivity.js';
import { Look, MAX_EVENT_COUNTS } from '../js/core/look.js';
import { sprayStep, sprayTarget, sampleSpray, easeOutCubic, RecoilEngine, EASE_FRACTION } from '../js/core/recoil.js';
import { GaussianRng, mulberry32 } from '../js/core/prng.js';
import { validateGuns } from '../js/core/guns.js';
import { sanitize } from '../js/core/settings.js';
import { hitsSilhouette } from '../js/scene/target.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, msg: String(e && e.message || e) }); }
}
function near(a, b, eps, what) {
  if (!(Math.abs(a - b) <= eps)) throw new Error((what || 'value') + ': expected ' + b + ', got ' + a + ' (eps ' + eps + ')');
}
function eq(a, b, what) {
  if (a !== b) throw new Error((what || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}

/* ---------- sensitivity ---------- */
test('cm/360 to deg/count: 800 DPI, 40 cm = 0.028575', () => {
  near(degPerCount(800, 40), 0.028575, 1e-15, 'deg/count');
  near(countsPer360(800, 40), 800 * 40 / 2.54, 1e-9, 'counts/360');
  near(inchesPer360(40), 15.748031496062993, 1e-12, 'in/360');
});
test('cm/360 to deg/count: 1 inch per 360 at 1600 DPI = 1600 counts', () => {
  near(countsPer360(1600, 2.54), 1600, 1e-9);
  near(degPerCount(1600, 2.54), 0.225, 1e-15);
});
test('deg/count scales inversely with DPI and cm/360', () => {
  near(degPerCount(400, 40) / degPerCount(800, 40), 2, 1e-12);
  near(degPerCount(800, 20) / degPerCount(800, 40), 2, 1e-12);
});
test('N counts = exactly 360 degrees (400 DPI, 25.4 cm -> 4000 counts)', () => {
  const L = new Look();
  const dpc = degPerCount(400, 25.4);
  for (let i = 0; i < 4000; i++) L.apply(1, 0, dpc);
  near(L.unwrappedYaw, 360, 1e-9, 'unwrapped yaw');
  eq(L.countsX, 4000, 'counts');
  if (!(L.yaw < 1e-9 || L.yaw > 360 - 1e-9)) throw new Error('wrapped yaw should be ~0, got ' + L.yaw);
});
test('Mixed event sizes sum exactly: 10 full turns at 800 DPI / 40 cm', () => {
  const L = new Look();
  const dpc = degPerCount(800, 40);
  const total = 125984; // counts; 125984 * 0.028575 = 3599.9928 deg
  let left = total, k = 0;
  while (left > 0) { const s = Math.min(left, 1 + (k++ * 7) % 23); L.apply(s, 0, dpc); left -= s; }
  near(L.unwrappedYaw, total * dpc, 1e-8, 'unwrapped yaw');
  eq(L.countsX, total);
});
test('yaw wraps both ways, pitch clamps at +/-89.9', () => {
  const L = new Look();
  L.apply(-10, 0, 1);
  near(L.yaw, 350, 1e-12, 'yaw');
  near(L.unwrappedYaw, -10, 1e-12, 'unwrapped');
  L.apply(0, -1000, 1); // mouse forward = look up
  near(L.pitch, 89.9, 1e-12, 'pitch up clamp');
  L.apply(0, 1500, 1);
  near(L.pitch, -89.9, 1e-12, 'pitch down clamp');
});
test('glitch guard discards single events over 2000 counts', () => {
  const L = new Look();
  eq(L.apply(MAX_EVENT_COUNTS, 0, 0.01), true, '2000 accepted');
  eq(L.apply(MAX_EVENT_COUNTS + 1, 0, 0.01), false, '2001 discarded');
  eq(L.apply(0, -2500, 0.01), false, 'y discarded');
  eq(L.discarded, 2);
  eq(L.countsX, 2000);
});
test('FOV: vertical from horizontal, ADS zoom in tan-space', () => {
  near(verticalFovDeg(90, 16 / 9), 2 * Math.atan(9 / 16) * 180 / Math.PI, 1e-12);
  near(zoomedFovDeg(90, 1), 90, 1e-12);
  near(zoomedFovDeg(90, 2), 53.13010235415598, 1e-10);
  near(Math.tan(zoomedFovDeg(100, 3.5) * Math.PI / 360), Math.tan(50 * Math.PI / 180) / 3.5, 1e-12);
});

/* ---------- spray path ---------- */
const P = [[0, 0], [0, 1], [1, 3]];
test('sprayStep inside the path is the difference of neighbours', () => {
  const o = sprayStep(P, 2, [0, 0]);
  eq(o[0], 1); eq(o[1], 2);
});
test('sprayStep past the end = average of the last steps', () => {
  const o = sprayStep(P, 5, [0, 0]); // k = min(3, 2) = 2 -> ([1,3]-[0,0]) / 2
  near(o[0], 0.5, 1e-12); near(o[1], 1.5, 1e-12);
});
test('sprayTarget extrapolates linearly past the end', () => {
  const a = sprayTarget(P, 3, [0, 0]), b = sprayTarget(P, 4, [0, 0]);
  near(a[0], 1.5, 1e-12); near(a[1], 4.5, 1e-12);
  near(b[0], 2, 1e-12); near(b[1], 6, 1e-12);
});
test('sampleSpray interpolation: eased over 40% of the interval', () => {
  const o = [0, 0];
  sampleSpray(P, 0, 0, o); near(o[1], 0, 1e-12, 'start');
  sampleSpray(P, 0, EASE_FRACTION / 2, o); near(o[1], easeOutCubic(0.5), 1e-12, 'halfway through ease');
  near(easeOutCubic(0.5), 0.875, 1e-12);
  sampleSpray(P, 0, EASE_FRACTION, o); near(o[1], 1, 1e-12, 'end of ease');
  sampleSpray(P, 0, 0.9, o); near(o[1], 1, 1e-12, 'held until next shot');
  sampleSpray(P, 1, 0.2, o); near(o[0], 0.875, 1e-12, 'yaw'); near(o[1], 1 + 2 * 0.875, 1e-12, 'pitch');
});
test('path[0] offset is ignored (offsets are relative to bullet 0)', () => {
  const a = sprayTarget([[1, 1], [1, 2]], 1, [0, 0]);
  eq(a[0], 0); eq(a[1], 1);
});

function testGun(over) {
  return Object.assign({
    rpm: 600, resetSeconds: 0.3, sprayPath: [[0, 0], [0.1, 0.5], [0.3, 0.9], [0.2, 1.2]],
    jitter: { yawDeg: 0, pitchDeg: 0 }, recovery: { delaySeconds: 0.2, degPerSecond: 10 },
  }, over);
}
test('RecoilEngine: with no jitter, bullet i leaves at sprayPath[i]', () => {
  const g = testGun();
  const r = new RecoilEngine(); r.setGun(g); r.newMagazine(1);
  const o = [0, 0];
  for (let i = 0; i < 4; i++) {
    r.fire(10 + i * 0.1, o);
    near(o[0], g.sprayPath[i][0], 1e-12, 'yaw ' + i);
    near(o[1], g.sprayPath[i][1], 1e-12, 'pitch ' + i);
  }
  r.fire(10.4, o); // extrapolated: avg of last 3 steps = ([0.2,1.2]-[0,0])/3
  near(o[0], 0.2 + 0.2 / 3, 1e-12); near(o[1], 1.2 + 0.4, 1e-12);
});
test('RecoilEngine: shotIndex resets after resetSeconds', () => {
  const r = new RecoilEngine(); r.setGun(testGun()); r.newMagazine(1);
  const o = [0, 0];
  r.fire(0, o); r.fire(0.1, o);
  eq(r.shotIndex, 2);
  r.fire(0.1 + 0.31, o);
  eq(r.shotIndex, 1);
});
test('RecoilEngine: recovery waits, then returns to zero at degPerSecond', () => {
  const g = testGun({ sprayPath: [[0, 0], [0, 2]] });
  const r = new RecoilEngine(); r.setGun(g); r.newMagazine(1);
  const o = [0, 0];
  r.fire(0, o);
  near(r.offsetAt(0.15, o)[1], 2, 1e-12, 'held during delay');
  near(r.offsetAt(0.25, o)[1], 1.5, 1e-12, '0.05 s into recovery at 10 deg/s');
  near(r.offsetAt(1, o)[1], 0, 1e-12, 'fully recovered');
});
test('RecoilEngine: same seed gives the same jitter, another seed differs', () => {
  const g = testGun({ jitter: { yawDeg: 0.1, pitchDeg: 0.1 } });
  const run = (seed) => {
    const r = new RecoilEngine(); r.setGun(g); r.newMagazine(seed);
    const o = [0, 0], out = [];
    for (let i = 0; i < 10; i++) { r.fire(i * 0.1, o); out.push(o[0], o[1]); }
    return out.join(',');
  };
  eq(run(42), run(42), 'same seed');
  if (run(42) === run(43)) throw new Error('different seeds gave identical sprays');
});
test('Gaussian PRNG: mean ~0, sd ~1, deterministic', () => {
  const g = new GaussianRng(7);
  let s = 0, s2 = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) { const v = g.next(); s += v; s2 += v * v; }
  near(s / n, 0, 0.03, 'mean');
  near(Math.sqrt(s2 / n), 1, 0.03, 'sd');
  eq(mulberry32(5)(), mulberry32(5)());
});

/* ---------- data validation ---------- */
const goodGun = {
  id: 'g1', name: 'Gun', placeholder: true, rpm: 600, magSize: 30, reloadSeconds: 2, optic: 1,
  hipMultiplier: 1, adsMultiplier: 1, resetSeconds: 0.3,
  jitter: { yawDeg: 0, pitchDeg: 0 }, recovery: { delaySeconds: 0.2, degPerSecond: 5 }, sprayPath: [[0, 0], [0, 1]],
};
test('validateGuns accepts a good gun', () => {
  const r = validateGuns({ guns: [goodGun] }, [1, 2]);
  eq(r.errors.length, 0, 'errors'); eq(r.guns.length, 1);
});
test('validateGuns names the gun and field for bad data', () => {
  const bad = { ...goodGun, id: 'bad', rpm: -5, optic: 7, sprayPath: [[0, 0], [1]], jitter: { yawDeg: 'x', pitchDeg: 0 } };
  const r = validateGuns({ guns: [goodGun, bad] }, [1, 2]);
  eq(r.guns.length, 1, 'good gun still loads');
  const all = r.errors.join('\n');
  for (const f of ['(bad).rpm', '(bad).optic', '(bad).sprayPath[1]', '(bad).jitter.yawDeg']) {
    if (!all.includes(f)) throw new Error('missing error for ' + f + ' in:\n' + all);
  }
});
test('validateGuns rejects duplicate ids and a missing guns array', () => {
  eq(validateGuns({ guns: [goodGun, goodGun] }, [1]).guns.length, 1);
  eq(validateGuns({}, [1]).errors.length, 1);
});

/* ---------- settings and target ---------- */
test('settings sanitize clamps and fills defaults', () => {
  const s = sanitize({ dpi: 99999, cm360: 'abc', hipFov: 200, crosshair: { color: 'red', size: 5 } });
  eq(s.dpi, 32000); eq(s.cm360, 40); eq(s.hipFov, 110);
  eq(s.crosshair.color, '#3dff9a'); eq(s.crosshair.size, 5);
  eq(sanitize(null).dpi, 800);
});
test('silhouette hit test', () => {
  eq(hitsSilhouette(0, 0), true, 'centre');
  eq(hitsSilhouette(0, 0.33), true, 'head');
  eq(hitsSilhouette(0.3, 0), false, 'beside torso');
  eq(hitsSilhouette(0.235, 0.175), false, 'rounded shoulder corner');
});

window.__results = results;
const fails = results.filter((r) => !r.ok);
document.getElementById('out').textContent = results.map((r) => (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.msg)).join('\n') +
  '\n\n' + (results.length - fails.length) + '/' + results.length + ' passed';
