// Refit every measured gun in data/guns.json from its bullet-hole pixels at the FOV it was
// recorded at. The wall sprays were shot AIMED, so each gun uses its sight's aimed FOV:
// measuredSight (or defaultOptic) -> hip vFOV x sens.json model.adsVFovMultipliers.
//
//   node tools/refit-aimed.mjs           show old vs new end points (dry run)
//   node tools/refit-aimed.mjs --write   update data/guns.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { refit, aimedVFov } from './fit-lib.mjs';

const path = (f) => fileURLToPath(new URL('../data/' + f, import.meta.url));
const guns = JSON.parse(readFileSync(path('guns.json'), 'utf8'));
const optics = JSON.parse(readFileSync(path('optics.json'), 'utf8'));
const sens = JSON.parse(readFileSync(path('sens.json'), 'utf8'));
const write = process.argv.includes('--write');

guns.guns.forEach((g, i) => {
  const holes = g.measurement && g.measurement.holesPx;
  if (!holes) return;
  const sight = g.measuredSight || g.defaultOptic;
  const v = aimedVFov(sight, optics, sens);
  const fit = refit(holes, v);
  console.log('slot ' + String(i + 1).padStart(2) + '  ' + g.id.padEnd(9) + ' sight ' + sight.padEnd(7) +
    ' vFOV ' + v.toFixed(2).padStart(6) + '  end ' + JSON.stringify(g.sprayPath[g.sprayPath.length - 1]) + ' -> ' + JSON.stringify(fit[fit.length - 1]));
  if (write) {
    g.sprayPath = fit;
    g.measuredSight = sight;
    g.measuredAiming = true;
    g.measuredAtVFov = Math.round(v * 100) / 100;
  }
});
if (write) {
  guns._comment = 'Spray paths of guns with "placeholder": false were measured AIMED in game, through measuredSight, at measuredAtVFov (vertical FOV). They are real view angles: do not rescale them. Guns with "placeholder": true still use invented test shapes. See docs/GUN_DATA.md.';
  const json = JSON.stringify(guns, null, 2).replace(/\[\s+(-?[\d.e-]+),\s+(-?[\d.e-]+)\s+\]/g, '[$1, $2]');
  writeFileSync(path('guns.json'), json + '\n');
  console.log('Wrote data/guns.json');
} else console.log('Dry run. Add --write to update data/guns.json.');
