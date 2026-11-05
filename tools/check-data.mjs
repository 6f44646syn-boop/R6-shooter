// Check data/optics.json, data/guns.json and data/sens.json. No dependencies.
//   node tools/check-data.mjs        (or: npm run check)
// Uses the same validation code the page runs on load. Exits 1 with readable messages on any
// problem; on success prints how many sights each slot resolves to.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateCatalogue, sensKeys } from '../js/core/optics.js';
import { validateGuns, validateSens } from '../js/core/guns.js';

const root = new URL('../data/', import.meta.url);
function load(name) {
  const file = fileURLToPath(new URL(name, root));
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { console.error('data/' + name + ': ' + e.message); process.exit(1); }
}

const catalogue = validateCatalogue(load('optics.json'));
const sens = validateSens(load('sens.json'));
const guns = validateGuns(load('guns.json'), catalogue);
const errors = [...catalogue.errors, ...sens.errors, ...guns.errors];

if (errors.length) {
  console.error('Data check FAILED (' + errors.length + ' problem' + (errors.length > 1 ? 's' : '') + '):');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
for (const w of guns.warnings) console.warn('warning: ' + w);

console.log('Data check passed.');
console.log('  ' + catalogue.optics.length + ' sights in ' + Object.keys(catalogue.groups).length + ' groups; ADS sens keys: ' + sensKeys(catalogue).join(', '));
console.log('  Sights per slot:');
guns.guns.forEach((g, i) => {
  console.log('    ' + String((i + 1) % 10) + '  ' + g.id.padEnd(10) + String(g.optics.length).padStart(3) + '  default ' + g.defaultOptic +
    (g.opticsVerified ? '' : '  (not verified)'));
});
