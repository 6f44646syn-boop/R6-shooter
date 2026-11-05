// Writes data/guns.json with 10 PLACEHOLDER guns (generic names, made-up recoil). The patterns are invented shapes for
// exercising the engine (straight climb, drifts, S-curve, J-curve, ...). They are not
// measurements of any real game. Replace them with your own data (see docs/GUN_DATA.md).
//
//   node tools/make-placeholder-guns.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const r4 = (x) => Math.round(x * 10000) / 10000;

// Build a cumulative path from a per-step function step(i) -> [dYaw, dPitch] for i >= 1.
function path(n, step) {
  const out = [[0, 0]];
  let y = 0, p = 0;
  for (let i = 1; i < n; i++) {
    const [dy, dp] = step(i);
    y += dy; p += dp;
    out.push([r4(y), r4(p)]);
  }
  return out;
}

const guns = [
  { id: 'smg-01', name: 'SMG 01', model: 'smg', side: 'defender', rpm: 750, magSize: 30, reloadSeconds: 2.4, tone: 0.5,
    jitter: { yawDeg: 0.04, pitchDeg: 0.03 }, recovery: { delaySeconds: 0.2, degPerSecond: 10 }, resetSeconds: 0.35,
    sprayPath: path(30, (i) => [0, i < 10 ? 0.35 : 0.2]) },                                   // straight climb
  { id: 'rifle-01', name: 'Rifle 01', model: 'rifle', side: 'attacker', rpm: 800, magSize: 30, reloadSeconds: 2.5, tone: 0.45,
    jitter: { yawDeg: 0.05, pitchDeg: 0.03 }, recovery: { delaySeconds: 0.2, degPerSecond: 10 }, resetSeconds: 0.35,
    sprayPath: path(30, (i) => [i > 8 ? 0.18 : 0.02, i <= 8 ? 0.32 : 0.12]) },                // climb, then right
  { id: 'rifle-02', name: 'Rifle 02', model: 'carbine', side: 'attacker', rpm: 700, magSize: 25, reloadSeconds: 2.3, tone: 0.55,
    jitter: { yawDeg: 0.05, pitchDeg: 0.04 }, recovery: { delaySeconds: 0.25, degPerSecond: 8 }, resetSeconds: 0.4,
    sprayPath: path(25, (i) => [i > 6 ? -0.2 : -0.02, i <= 6 ? 0.4 : 0.15]) },               // climb, then left
  { id: 'mp-01', name: 'Machine Pistol 01', model: 'smg', side: 'defender', rpm: 950, magSize: 40, reloadSeconds: 2.0, tone: 0.3,
    jitter: { yawDeg: 0.06, pitchDeg: 0.04 }, recovery: { delaySeconds: 0.15, degPerSecond: 14 }, resetSeconds: 0.3,
    sprayPath: path(40, (i) => [0.3 * Math.cos(i / 4), 0.22]) },                            // S-curve
  { id: 'smg-02', name: 'SMG 02', model: 'smg', side: 'defender', rpm: 1100, magSize: 50, reloadSeconds: 2.1, tone: 0.2,
    jitter: { yawDeg: 0.12, pitchDeg: 0.1 }, recovery: { delaySeconds: 0.15, degPerSecond: 15 }, resetSeconds: 0.25,
    sprayPath: path(50, () => [0.01, 0.12]) },                                              // small climb, noisy
  { id: 'rifle-03', name: 'Rifle 03', model: 'carbine', side: 'attacker', rpm: 650, magSize: 30, reloadSeconds: 5.5, tone: 0.75,
    jitter: { yawDeg: 0.05, pitchDeg: 0.03 }, recovery: { delaySeconds: 0.3, degPerSecond: 7 }, resetSeconds: 0.5,
    sprayPath: path(60, (i) => [0.12 * Math.sin(i / 7), i <= 6 ? 0.55 : 0.05]) },          // hard kick, then plateau
  { id: 'rifle-04', name: 'Rifle 04', model: 'rifle', side: 'defender', rpm: 850, magSize: 30, reloadSeconds: 2.2, tone: 0.4,
    jitter: { yawDeg: 0.04, pitchDeg: 0.03 }, recovery: { delaySeconds: 0.2, degPerSecond: 9 }, resetSeconds: 0.35,
    sprayPath: path(30, () => [0.12, 0.25]) },                                              // diagonal up-right
  { id: 'rifle-05', name: 'Rifle 05', model: 'rifle', side: 'attacker', rpm: 720, magSize: 30, reloadSeconds: 2.6, tone: 0.6,
    jitter: { yawDeg: 0.04, pitchDeg: 0.04 }, recovery: { delaySeconds: 0.25, degPerSecond: 8 }, resetSeconds: 0.4,
    sprayPath: path(30, (i) => [i > 12 ? -0.03 * (i - 12) : 0, i <= 12 ? 0.3 : 0.08]) },  // J-curve hooking left
  { id: 'smg-03', name: 'SMG 03', model: 'smg', side: 'defender', rpm: 1000, magSize: 32, reloadSeconds: 1.9, tone: 0.25,
    jitter: { yawDeg: 0.05, pitchDeg: 0.04 }, recovery: { delaySeconds: 0.15, degPerSecond: 14 }, resetSeconds: 0.3,
    sprayPath: path(32, (i) => [Math.floor((i - 1) / 4) % 2 === 0 ? 0.28 : -0.28, 0.15]) }, // zigzag snake
  { id: 'smg-04', name: 'SMG 04', model: 'smg', side: 'defender', rpm: 780, magSize: 20, reloadSeconds: 2.8, tone: 0.9,
    jitter: { yawDeg: 0.1, pitchDeg: 0.05 }, recovery: { delaySeconds: 0.1, degPerSecond: 12 }, resetSeconds: 0.6,
    sprayPath: path(20, () => [0.03, 0.9]) },                                               // big per-shot kick
];

const ordered = guns.map((g) => ({
  id: g.id, name: g.name, placeholder: true, rpm: g.rpm, magSize: g.magSize, reloadSeconds: g.reloadSeconds,
  hipMultiplier: 1.0, adsMultiplier: 1.0, resetSeconds: g.resetSeconds, adsSeconds: 0.3,
  side: g.side,
  // Sights: attackers get Magnified and start on it; defender automatics do not (docs/SCOPES.md).
  optics: g.side === 'attacker' ? ['@iron', '@sight', '@magnified'] : ['@iron', '@sight'],
  opticsExclude: [],
  defaultOptic: g.side === 'attacker' ? 'mag_a' : 'holo_a',
  opticRecoilScale: {},
  opticsVerified: false,
  ...(g.fireMode ? { fireMode: g.fireMode } : {}), model: g.model, tone: g.tone,
  jitter: g.jitter, recovery: g.recovery, sprayPath: g.sprayPath,
}));

// JSON with one sprayPath point per line, so it is easy to read and paste over.
let json = JSON.stringify({
  _comment: 'PLACEHOLDER DATA. These recoil numbers are invented test shapes, not measurements. Replace them with your own (see docs/GUN_DATA.md).',
  guns: ordered,
}, null, 2);
json = json.replace(/\[\s+(-?[\d.e-]+),\s+(-?[\d.e-]+)\s+\]/g, '[$1, $2]');

const out = fileURLToPath(new URL('../data/guns.json', import.meta.url));
writeFileSync(out, json + '\n');
console.log('wrote ' + out);
