// Merge a measurement file into data/guns.json by slot (slot 1 = first gun in the file).
//
//   node tools/merge-measured.mjs reference/guns.measured.json            dry run: show changes
//   node tools/merge-measured.mjs reference/guns.measured.json --write    write data/guns.json
//
// Copied per slot: rpm, magSize, chambered, reloadSeconds, damage, sprayPath (as measured, never
// rescaled), measurement (hole pixels etc.), tail, side, jitter, recovery, resetSeconds,
// adsSeconds, hip/adsMultiplier, plus measuredAtVFov from the file's calibration.
// The gun's id, name, model and sights stay as they are (the measurement file's operator
// names are never copied). A slot whose side changes gets the matching sight list.
// placeholder becomes false (the spray is measured); fields the file flags as placeholders
// are listed in placeholderFields and never overwrite values already in data/guns.json.
// Sprays are refitted from the hole pixels at the aimed FOV of the slot's sight (the wall
// sprays were shot aimed); --hip keeps the file's angles instead.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { refit, aimedVFov } from './fit-lib.mjs';

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
if (!src) { console.error('Usage: node tools/merge-measured.mjs <measured.json> [--write]'); process.exit(1); }
const write = args.includes('--write');
const gunsFile = fileURLToPath(new URL('../data/guns.json', import.meta.url));
const measured = JSON.parse(readFileSync(src, 'utf8'));
const data = JSON.parse(readFileSync(gunsFile, 'utf8'));
const opticsJson = JSON.parse(readFileSync(fileURLToPath(new URL('../data/optics.json', import.meta.url)), 'utf8'));
const sensJson = JSON.parse(readFileSync(fileURLToPath(new URL('../data/sens.json', import.meta.url)), 'utf8'));
const vFov = measured.calibration && measured.calibration.assumedVerticalFovDeg;
if (!(vFov > 0)) { console.error('calibration.assumedVerticalFovDeg missing in ' + src); process.exit(1); }

const SIGHTS = {
  attacker: { optics: ['@iron', '@sight', '@magnified'], defaultOptic: 'mag_a' },
  defender: { optics: ['@iron', '@sight'], defaultOptic: 'holo_a' },
};

for (const m of measured.guns) {
  const g = data.guns[m.slot - 1];
  if (!g) { console.error('slot ' + m.slot + ': no gun at that position in data/guns.json'); process.exit(1); }
  const before = { side: g.side, rpm: g.rpm, magSize: g.magSize, n: g.sprayPath.length };

  g.placeholder = false;
  // Values the measurement file flags as placeholders never overwrite what is already in
  // data/guns.json (e.g. recovery 0, which you chose); measured values always do.
  const ph = m.placeholder || {};
  const take = (k) => m[k] !== undefined && !(ph[k] && g[k] !== undefined);
  for (const k of ['rpm', 'magSize', 'reloadSeconds', 'damage', 'resetSeconds', 'adsSeconds', 'hipMultiplier', 'adsMultiplier']) {
    if (take(k)) g[k] = m[k];
  }
  if (m.chambered !== undefined) g.chambered = m.chambered;
  if (m.jitterDeg !== undefined && !(ph.jitter && g.jitter)) g.jitter = { yawDeg: m.jitterDeg, pitchDeg: m.jitterDeg };
  if (m.recovery && !(ph.recovery && g.recovery)) g.recovery = { delaySeconds: m.recovery.delaySeconds, degPerSecond: m.recovery.degPerSecond };
  g.tail = /hold/i.test(m.tail || '') ? 'hold' : 'extrapolate';
  g.sprayPath = m.sprayPath.map((p) => [p[0], p[1]]);
  // The wall sprays were shot AIMED: refit from the hole pixels at the aimed FOV of the
  // sight they were recorded with (the slot's defaultOptic unless measuredSight is set).
  // --hip keeps the file's angles (hip FOV) instead.
  if (!process.argv.includes('--hip') && m.measurement && m.measurement.holesPx) {
    const sight = g.measuredSight || g.defaultOptic;
    const v = aimedVFov(sight, opticsJson, sensJson);
    g.sprayPath = refit(m.measurement.holesPx, v);
    g.measuredSight = sight;
    g.measuredAiming = true;
    g.measuredAtVFov = Math.round(v * 100) / 100;
  } else {
    g.measuredAtVFov = vFov;
  }
  g.placeholderFields = Object.entries(m.placeholder || {}).filter(([, v]) => v).map(([k]) => k);
  if (m.measurement) {
    const x = m.measurement;
    g.measurement = {
      holesPx: x.holesPx, bulletsResolved: x.bulletsResolved, bulletsFiredPerHud: x.bulletsFiredPerHud,
      reachedPitchCeiling: x.reachedPitchCeiling, attachments: x.attachments,
    };
  }
  if (m.side && m.side !== g.side) {
    g.side = m.side;
    if (SIGHTS[m.side]) Object.assign(g, SIGHTS[m.side]);
  }
  console.log('slot ' + String(m.slot).padStart(2) + '  ' + g.id.padEnd(10) +
    ' rpm ' + before.rpm + ' -> ' + g.rpm + ', mag ' + before.magSize + ' -> ' + g.magSize + (g.chambered ? '+1' : '') +
    ', path ' + before.n + ' -> ' + g.sprayPath.length + ' points' + (before.side !== g.side ? ', side ' + before.side + ' -> ' + g.side : ''));
}

data._comment = 'Spray paths of guns with "placeholder": false were measured AIMED in game, through measuredSight, at measuredAtVFov (vertical FOV). They are real view angles: do not rescale them. Guns with "placeholder": true still use invented test shapes. See docs/GUN_DATA.md.';
if (write) {
  const json = JSON.stringify(data, null, 2).replace(/\[\s+(-?[\d.e-]+),\s+(-?[\d.e-]+)\s+\]/g, '[$1, $2]');
  writeFileSync(gunsFile, json + '\n');
  console.log('Wrote ' + gunsFile);
} else {
  console.log('Dry run. Add --write to update data/guns.json.');
}
