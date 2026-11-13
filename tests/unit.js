// Unit tests for the pure modules. Runs in the browser (tests/unit.html) so it uses exactly
// the same JS engine as the game. Results go to window.__results for tests/run.mjs.
import { degPerCount, countsPer360, inchesPer360, verticalFovDeg, zoomedFovDeg } from '../js/core/sensitivity.js';
import { Look, MAX_EVENT_COUNTS } from '../js/core/look.js';
import { sprayStep, sprayTarget, sampleSpray, easeOutCubic, RecoilEngine, EASE_FRACTION, smoothPath, ADS_SETTLE } from '../js/core/recoil.js';
import { GaussianRng, mulberry32 } from '../js/core/prng.js';
import { validateGuns, validateSens } from '../js/core/guns.js';
import { validateCatalogue, resolveGunOptics, sensKeys } from '../js/core/optics.js';
import { sanitize } from '../js/core/settings.js';
import { raycastDummy } from '../js/scene/dummy.js';
import { addMatch, totals, matches } from '../js/core/history.js';
import { CATALOGUE, LEGEND_ID, RARITIES, SAKURA_ID, skinFits } from '../js/core/skins.js';
import { Profile, TRADE_UP } from '../js/core/profile.js';
import { challengesFor, record, progressOf, isPaid, matchStats } from '../js/core/challenges.js';
import { PAD_ASSIST, nearestAim, assistLook } from '../js/core/pad-assist.js';
import { MatchStats } from '../js/core/mvp.js';
import { addXp, checkIn, seasonState, rewardOf, TIERS, XP_PER_TIER } from '../js/core/season.js';
import { submit, myCode, addFriend, ranking, bests } from '../js/core/bests.js';
import { accounts, switchTo, createAccount, deleteAccount } from '../js/core/accounts.js';

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

test('Sakura Gilt is the rarest pack reward and survives save-code export', () => {
  const storage = { getItem: () => null, setItem() {} };
  const profile = new Profile(storage);
  const restored = new Profile(storage);
  const legendary = RARITIES.find(r => r.key === 'legendary');
  const ice = RARITIES.find(r => r.key === 'blackice');
  near(RARITIES.reduce((sum, r) => sum + r.odds, 0), 1, 1e-12);
  eq([ice.odds, legendary.odds].join(), '0.05,0.01', 'Black Ice 5%, Legendary 1%');
  eq(Math.round(RARITIES.reduce((t, r) => t + r.odds, 0) * 1e6), 1e6, 'odds sum to 1');
  eq(CATALOGUE.filter(skin => skin.rarity === 'blackice').length, 9);
  eq(profile.has(SAKURA_ID), false, 'locked at start');
  eq(profile.has(LEGEND_ID), true, 'custom photo still available');
  eq(skinFits(SAKURA_ID, 2), true, 'R4-C');
  eq(skinFits(SAKURA_ID, 4), false, 'another rifle');
  profile.unlockBlackIce();
  eq(profile.has(SAKURA_ID), false, 'Pirate Token only unlocks Black Ice');
  eq(Profile.roll(() => 0.985).rarity, 'blackice', 'roll just below Legendary');
  profile.addPoints(100);
  eq(profile.openPack(() => 0.9999).skin.rarity, 'legendary', 'top pack roll');   // (one of the ten Legendaries)
  profile.owned[SAKURA_ID >> 3] |= 1 << (SAKURA_ID & 7);
  eq(profile.equip(4, SAKURA_ID), false);
  eq(profile.equip(2, SAKURA_ID), true);
  restored.loadCode(profile.saveCode());
  eq(restored.equippedFor(2), SAKURA_ID);
  eq(restored.ownedCount, 11);
  // the Legendary pack: 1000 points, one per player, a Legendary you do not own yet, kept in the save code
  const rich = new Profile(storage); rich.addPoints(2500);
  const got = rich.openLegendPack(() => 0);
  eq(got.skin.rarity, 'legendary'); eq(got.duplicate, false); eq(rich.points, 1500);
  eq(rich.openLegendPack(), null, 'only one per player');
  const back = new Profile(storage); back.loadCode(rich.saveCode());
  eq(back.legendPack, true); eq(back.canOpenLegend, false); eq(back.has(got.skin.id), true);                                     // 9 Black Ice, the rolled Legendary, Sakura Gilt
});

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
test('tail "hold": past the end the step is zero and the target stays on the last point', () => {
  const o = sprayStep(P, 5, [9, 9], 'hold');
  eq(o[0], 0); eq(o[1], 0);
  const t = sprayTarget(P, 7, [0, 0], 'hold');
  eq(t[0], 1); eq(t[1], 3);
});
test('validateSens: ADS multiplier = hip cm/360 / ADS cm/360', () => {
  const r = validateSens({ hipCm360: 14.25, adsCm360: { '1.0x': 11.8, '2.5x': 22.3 } });
  eq(r.errors.length, 0, r.errors.join('; '));
  near(r.ads['1.0x'], 14.25 / 11.8, 1e-12); near(r.ads['2.5x'], 14.25 / 22.3, 1e-12);
});
test('validateSens reads the in-game sensitivity screen format', () => {
  const r = validateSens({ horizontal: 7, vertical: 7, aimMode: 'custom', magnifications: [{ key: '1.0x', slider: 70 }, { key: '8.0x', slider: 97 }] });
  eq(r.errors.length, 0, r.errors.join('; '));
  eq(r.magnifications.map((m) => m.key).join(','), '1.0x,8.0x');
  eq(r.game.horizontal, 7); eq(Object.keys(r.ads).length, 0, 'no multipliers given');
  eq(validateSens({ magnifications: [{ key: 'eight' }] }).errors.length, 1, 'bad key');
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
test('smoothPath: keeps start and end, removes zig-zag in yaw', () => {
  const zig = [[0, 0]];
  for (let i = 1; i < 20; i++) zig.push([zig[i - 1][0] + (i % 2 ? 0.4 : -0.3), zig[i - 1][1] + 1]);
  const sm = smoothPath(zig);
  eq(sm[0][0], 0); eq(sm[0][1], 0);
  near(sm[19][0], zig[19][0], 1e-9, 'end yaw'); near(sm[19][1], zig[19][1], 1e-9, 'end pitch');
  const wob = (p) => p.slice(2).reduce((a, q, i) => a + Math.abs((q[0] - p[i + 1][0]) - (p[i + 1][0] - p[i][0])), 0);
  if (!(wob(sm) < wob(zig) * 0.3)) throw new Error('not smoother: ' + wob(sm) + ' vs ' + wob(zig));
});
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
test('RecoilEngine: off (trackpad) fires every bullet on the aim, hip or aimed', () => {
  const r = new RecoilEngine(); r.setGun(testGun({ jitter: { yawDeg: 0.5, pitchDeg: 0.5 } })); r.newMagazine(1); r.off = true;
  const o = [0, 0];
  for (let i = 0; i < 6; i++) { r.aimed = i % 2 === 0; r.fire(10 + i * 0.1, o); eq(o[0] === 0 && o[1] === 0, true, 'bullet ' + i); }
});
test('RecoilEngine: aimed sprays settle ADS_SETTLE times faster', () => {
  const r = new RecoilEngine(); r.setGun(testGun({ sprayPath: [[0, 0], [0, 2]] })); r.newMagazine(1);
  r.aimed = true; r.fire(0, [0, 0]);
  near(r.offsetAt(0.25, [0, 0])[1], 2 - 10 * ADS_SETTLE * 0.05, 1e-12, '0.05 s into recovery, aimed');
  r.aimed = false;
  near(r.offsetAt(0.25, [0, 0])[1], 2 - 10 * ADS_SETTLE * 0.05, 1e-12, 'letting go of aim mid-settle keeps the rate');
});
test('RecoilEngine: the settle never drags you below where the spray started', () => {
  const g = testGun({ sprayPath: [[0, 0], [0, 2]] }), o = [0, 0];
  const look = { yaw: 0, pitch: 0, setAngles(y, p) { this.yaw = y; this.pitch = p; } };
  let r = new RecoilEngine(); r.setGun(g); r.newMagazine(1);
  r.fire(0, o, look.pitch);                       // started at 0, the kick takes the view to +2
  look.pitch = -3;                                // pulled down: the view is at -1, under the start
  eq(r.settleStop(0.15, look), false, 'nothing during the hold');
  eq(r.settleStop(0.25, look), true, 'no drag down');
  near(look.pitch, -1, 1e-12, 'view stays where it was'); near(r.offsetAt(0.3, o)[1], 0, 1e-12);
  look.pitch = 0; r = new RecoilEngine(); r.setGun(g); r.newMagazine(1);
  r.fire(0, o, 0); look.pitch = -1;               // view at +1: it settles, but only down to 0
  eq(r.settleStop(0.25, look), false, 'still above the start');
  eq(r.settleStop(0.35, look), true, 'reached the start');
  near(look.pitch, 0, 1e-12, 'stops at the start');
  look.pitch = 0; r = new RecoilEngine(); r.setGun(g); r.newMagazine(1);
  r.fire(0, o, 0);                                // no pull at all: settles back to the aim as before
  eq(r.settleStop(1, look), false); near(r.offsetAt(1, o)[1], 0, 1e-12);
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

/* ---------- sight catalogue ---------- */
const CAT = {
  groups: {
    iron: { label: 'Iron', zoom: 1, adsSpeedBonus: 0.1 },
    sight: { label: '1x', zoom: 1, adsSpeedBonus: 0.05 },
    magnified: { label: 'Mag', zoom: 2.5, adsSpeedBonus: 0 },
  },
  optics: [
    { id: 'iron', group: 'iron', housing: { shape: 'round', w: 0.1, h: 0.1 }, reticle: { shapes: [{ t: 'dot', r: 2 }] } },
    { id: 'holo', group: 'sight', housing: { shape: 'rect', w: 0.3, h: 0.2 }, reticle: { shapes: [{ t: 'ring', r: 20 }] } },
    { id: 'dot', group: 'sight', housing: { shape: 'round', w: 0.2, h: 0.2 }, reticle: { shapes: [{ t: 'dot', r: 2 }] } },
    { id: 'mag', group: 'magnified', housing: { shape: 'round', w: 0.4, h: 0.36 }, reticle: { shapes: [{ t: 'line', x1: 0, y1: 0, x2: 0, y2: 9 }] } },
    { id: 'mag35', group: 'magnified', zoom: 3.5, housing: { shape: 'round', w: 0.3, h: 0.3 }, reticle: { shapes: [{ t: 'poly', pts: [[0, 0], [1, 1]] }] } },
  ],
};
const cat = validateCatalogue(CAT);
test('catalogue: good data validates; groups give zoom, bonus and sens key', () => {
  eq(cat.errors.length, 0, cat.errors.join('; '));
  eq(cat.byId.get('holo').zoom, 1); eq(cat.byId.get('holo').adsSpeedBonus, 0.05);
  eq(cat.byId.get('mag').sensKey, '2.5x');
  eq(cat.byId.get('mag35').sensKey, '3.5x', 'zoom override');
  eq(sensKeys(cat).join(','), '1.0x,2.5x,3.5x');
});
test('catalogue: duplicate id, bad zoom, unknown shape, fraction out of range are errors', () => {
  const bad = JSON.parse(JSON.stringify(CAT));
  bad.optics.push({ ...bad.optics[0] });                                   // duplicate id
  bad.optics.push({ ...bad.optics[1], id: 'z', zoom: 0.5 });               // zoom < 1
  bad.optics.push({ ...bad.optics[1], id: 'h', housing: { shape: 'hex', w: 0.3, h: 0.2 } });
  bad.optics.push({ ...bad.optics[1], id: 'f', housing: { shape: 'rect', w: 1.4, h: 0.2 } });
  bad.optics.push({ ...bad.optics[1], id: 'r', reticle: { shapes: [{ t: 'star' }] } });
  const e = validateCatalogue(bad).errors.join('\n');
  for (const f of ['duplicate optic id', '(z).zoom', '(h).housing.shape', '(f).housing.w', '(r).reticle.shapes[0].t']) {
    if (!e.includes(f)) throw new Error('missing "' + f + '" in:\n' + e);
  }
});
test('resolveGunOptics: @group expansion, exclude, default check', () => {
  const r = resolveGunOptics({ optics: ['@iron', '@sight', 'mag'], opticsExclude: ['dot'], defaultOptic: 'mag' }, cat);
  eq(r.errors.length, 0, r.errors.join('; '));
  eq(r.ids.join(','), 'iron,holo,mag');
  const bad = resolveGunOptics({ optics: ['@nope', 'ghost'], defaultOptic: 'holo' }, cat);
  if (!bad.errors.some((m) => m.includes('"@nope"')) || !bad.errors.some((m) => m.includes('"ghost"'))) throw new Error(bad.errors.join('; '));
  const empty = resolveGunOptics({ optics: ['dot'], opticsExclude: ['dot'], defaultOptic: 'dot' }, cat);
  if (!empty.errors.some((m) => m.includes('empty'))) throw new Error('empty list not reported');
  const def = resolveGunOptics({ optics: ['@iron'], defaultOptic: 'mag' }, cat);
  if (!def.errors.some((m) => m.startsWith('defaultOptic'))) throw new Error('bad default not reported');
});

/* ---------- data validation ---------- */
const goodGun = {
  id: 'g1', name: 'Gun', placeholder: true, rpm: 600, magSize: 30, reloadSeconds: 2,
  hipMultiplier: 1, adsMultiplier: 1, resetSeconds: 0.3, optics: ['@iron', '@sight'], defaultOptic: 'holo',
  jitter: { yawDeg: 0, pitchDeg: 0 }, recovery: { delaySeconds: 0.2, degPerSecond: 5 }, sprayPath: [[0, 0], [0, 1]],
};
test('validateGuns accepts a good gun and resolves its sights', () => {
  const r = validateGuns({ guns: [goodGun] }, cat);
  eq(r.errors.length, 0, r.errors.join('; ')); eq(r.guns.length, 1);
  eq(r.guns[0].optics.length, 3);
});
test('validateGuns names the gun and field for bad data', () => {
  const bad = { ...goodGun, id: 'bad', rpm: -5, optics: ['@nope'], sprayPath: [[0, 0], [1]], jitter: { yawDeg: 'x', pitchDeg: 0 } };
  const r = validateGuns({ guns: [goodGun, bad] }, cat);
  eq(r.guns.length, 1, 'good gun still loads');
  const all = r.errors.join('\n');
  for (const f of ['(bad).rpm', '(bad).optics', '(bad).sprayPath[1]', '(bad).jitter.yawDeg']) {
    if (!all.includes(f)) throw new Error('missing error for ' + f + ' in:\n' + all);
  }
});
test('validateGuns rejects duplicate ids and a missing guns array', () => {
  eq(validateGuns({ guns: [goodGun, goodGun] }, cat).guns.length, 1);
  eq(validateGuns({}, cat).errors.length, 1);
});
test('RecoilEngine: opticRecoilScale multiplies sprayPath steps', () => {
  const r = new RecoilEngine(); r.setGun(testGun()); r.newMagazine(1); r.setScale(2);
  const o = [0, 0];
  r.fire(0, o); r.fire(0.1, o);
  near(o[1], 1.0, 1e-12, 'pitch doubled'); near(o[0], 0.2, 1e-12, 'yaw doubled');
});

/* ---------- settings and target ---------- */
test('settings sanitize clamps and fills defaults', () => {
  const s = sanitize({ dpi: 99999, cm360: 'abc', fov: 200, crosshair: { color: 'red', size: 5 } });
  eq(s.dpi, 32000); near(s.cm360, 360 * 2.54 / (32000 * 7 * 0.00572958), 1e-9, 'cm/360 follows DPI and sens'); eq(s.fov, 90); eq(sanitize({}).fov, 83, 'default vertical FOV'); eq(sanitize({ fov: 40 }).fov, 60);
  eq(s.crosshair.color, '#3dff9a'); eq(s.crosshair.size, 5);
  eq(sanitize(null).dpi, 1600, 'default DPI'); near(sanitize(null).cm360, 14.25, 0.01, 'default hip cm/360 (sens 7 at 1600 DPI)');
});
test('dummy raycast: head, chest, gap between legs, miss beside', () => {
  const out = { t: 0, p: [0, 0, 0], n: [0, 0, 0], zone: null };
  const ray = (x, y) => { const o = [0, 1.6, 10], d = [x, y - 1.6, -10], l = Math.hypot(...d); return raycastDummy(o, d.map((v) => v / l), out); };
  eq(ray(0, 1.6), true, 'head centre'); eq(out.zone, 'head');
  near(out.p[2], 0.105, 1e-6, 'hits the front of the head sphere');
  eq(ray(0, 1.15), true, 'chest'); eq(out.zone, 'body');
  eq(ray(0, 0.3), false, 'between the shins');
  eq(ray(0.6, 1.2), false, 'beside the arm');
  eq(ray(0.28, 0.95), true, 'forearm'); eq(out.zone, 'limb');
});

test('match history: newest first, totals, K/D and most-used gun', () => {
  try { localStorage.removeItem('recoilRange.history.v1'); } catch { /* blocked */ }
  const before = matches().length;
  addMatch({ mode: 'battle', result: 'win', kills: 6, deaths: 2, gun: 'R4-C' });
  addMatch({ mode: 'tdm', result: 'loss', kills: 2, deaths: 4, gun: 'MP7' });
  eq(matches().length, before + 2); eq(matches()[0].mode, 'tdm', 'newest first');
  const t = totals();
  if (before === 0) { eq(t.wins, 1); eq(t.kills, 8); near(t.kd, 8 / 6, 1e-9); eq(t.best, 'R4-C'); }
});

test('profile v5: duplicates, trade-up, charms survive a save code; v4 codes still load', () => {
  const mem = { getItem: () => null, setItem() {} };
  const p = new Profile(mem); p.points = 2000;
  p.dups.common = TRADE_UP + 1;
  const r = p.tradeUp('common', () => 0.3);
  eq(r.skin.rarity, 'rare', 'next rarity'); eq(p.dups.common, 1);
  eq(p.tradeUp('common'), null, 'not enough duplicates');
  eq(p.buyCharm(2), true); eq(p.charm, 2); eq(p.buyCharm(2), false, 'only once');
  const q = new Profile(mem); q.loadCode(p.saveCode());
  eq(q.dups.common, 1); eq(q.charm, 2); eq(q.hasCharm(2), true); eq(q.points, p.points); eq(q.has(r.skin.id), true);
  const old = new Profile(mem); old.loadCode('RRS1-BBAnAAD__________________________________wf_____________AAAAAAAA6AMAeso');
  eq(old.points, 10000, 'v4 code'); eq(old.charm, null);
});

test('challenges: one daily and one weekly per mode, the same all day, paid once', () => {
  try { localStorage.removeItem('recoilRange.challenges.v1'); } catch { /* blocked */ }
  const now = Date.UTC(2026, 10, 13, 12), all = challengesFor(now);
  eq(all.length, 14); eq(JSON.stringify(challengesFor(now + 3600000)), JSON.stringify(all), 'same later that day');
  const daily = all.find((c) => c.mode === 'battle' && c.period === 'daily');
  let done = [];
  for (let i = 0; i < 30 && !done.some((c) => c.id === daily.id); i++) done = record('battle', matchStats({ mode: 'battle', result: 'win', kills: 20 }), now);
  eq(isPaid(daily), true); eq(progressOf(daily), daily.goal);
  eq(record('battle', matchStats({ mode: 'battle', result: 'win', kills: 20 }), now).some((c) => c.id === daily.id), false, 'not paid twice');
  eq(matchStats({ mode: 'royale', result: 'loss', place: 4, kills: 2 }).top5, 1);
});

test('controller aim assist: finds the visible enemy, slows and nudges only while moving', () => {
  const clear = () => true, wall = () => false, eye = [0, 1.6, 0];
  const target = [Math.sin(2 * Math.PI / 180) * 10, 1.6, -Math.cos(2 * Math.PI / 180) * 10];   // 2 deg right
  const a = nearestAim(eye, 0, 0, [target], 6, clear);
  near(a.ey, 2, 1e-9); near(a.ep, 0, 1e-9);
  eq(nearestAim(eye, 0, 0, [target], 6, wall), null, 'not through walls');
  eq(nearestAim(eye, 0, 0, [target], 1.5, clear), null, 'outside the cone');
  const [x, y] = assistLook(PAD_ASSIST.standard, 0.5, 0, a);
  eq(x < 0.5, true, 'slower near the target'); eq(x > 0, true); near(y, 0, 1e-12);
  const still = assistLook(PAD_ASSIST.standard, 0, 0, a);
  eq(still[0] === 0 && still[1] === 0, true, 'no pull with the stick still');
  eq(JSON.stringify(assistLook(PAD_ASSIST.off, 0.5, 0, a)), '[0.5,0]', 'off');
});
test('MVP stats: longest kill, fastest double, damage; the standout first', () => {
  const m = new MatchStats();
  m.hit(100); m.kill(10, 12); m.hit(100); m.kill(10.5, 42);
  const c = m.card();
  eq(c[0].key, 'double'); near(m.double, 0.5, 1e-12); eq(m.longest, 42); eq(m.damage, 200);
  eq(new MatchStats().card(), null);
});

test('season pass: tiers pay once (points, charm at 5, skin at 30); login streak grows and resets', () => {
  try { localStorage.removeItem('recoilRange.season.v1'); } catch { /* blocked */ }
  const mem = { getItem: () => null, setItem() {} }, p = new Profile(mem), now = Date.UTC(2026, 10, 13, 12);
  const got = addXp(5 * XP_PER_TIER + 10, p, now);
  eq(got.length, 5); eq(got[4].reward.charm !== undefined, true, 'tier 5 is a charm'); eq(p.hasCharm(got[4].reward.charm), true);
  eq(addXp(10, p, now).length, 0, 'not paid twice');
  addXp(TIERS * XP_PER_TIER, p, now);
  eq(seasonState(now).tier, TIERS); eq(p.has(rewardOf(TIERS, seasonState(now).id).skin), true, 'season skin');
  const pts = p.points;
  eq(checkIn(p, now).streak, 1); eq(checkIn(p, now), null, 'once a day');
  eq(checkIn(p, now + 86400000).streak, 2); eq(checkIn(p, now + 4 * 86400000).streak, 1, 'missed days restart it');
  eq(p.points, pts + 25 + 50 + 25);
});
test('leaderboards: bests only improve; a friend code round-trips and ranks', () => {
  try { localStorage.removeItem('recoilRange.bests.v1'); } catch { /* blocked */ }
  submit({ kills: 10, double: 0.8 }); submit({ kills: 7, double: 1.2 });
  eq(bests().kills, 10); eq(bests().double, 0.8, 'lower is better for a double');
  const code = myCode();
  eq(addFriend(code), 'You');
  let threw = false; try { addFriend(code.slice(0, -2) + 'zz'); } catch { threw = true; }
  eq(threw, true, 'a damaged code is refused');
  eq(ranking('kills').length, 2);
});

test('local accounts: switching swaps each player\'s saved data; PIN; delete', () => {
  localStorage.removeItem('recoilAccounts.v1');
  localStorage.setItem('recoilRange.test.points', '111');
  localStorage.setItem('recoilRange.hdPack.v1', 'shared');
  eq(accounts().current, 'Player 1');
  createAccount('Sam', '1234');
  let threw = false; try { switchTo('Sam', '9999'); } catch { threw = true; }
  eq(threw, true, 'wrong PIN'); eq(localStorage.getItem('recoilRange.test.points'), '111', 'nothing changed');
  eq(switchTo('Sam', '1234'), true);
  eq(localStorage.getItem('recoilRange.test.points'), null, 'Sam starts fresh');
  eq(localStorage.getItem('recoilRange.hdPack.v1'), 'shared', 'the graphics download is for everyone');
  localStorage.setItem('recoilRange.test.points', '7');
  eq(switchTo('Player 1'), true);
  eq(localStorage.getItem('recoilRange.test.points'), '111', 'Player 1 back');
  eq(switchTo('Sam', '1234'), true); eq(localStorage.getItem('recoilRange.test.points'), '7', 'Sam kept his');
  switchTo('Player 1');
  eq(deleteAccount('Sam', '1234'), true); eq(accounts().list.length, 1);
  localStorage.removeItem('recoilRange.test.points'); localStorage.removeItem('recoilAccounts.v1');
});

window.__results = results;
const fails = results.filter((r) => !r.ok);
document.getElementById('out').textContent = results.map((r) => (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.msg)).join('\n') +
  '\n\n' + (results.length - fails.length) + '/' + results.length + ' passed';
