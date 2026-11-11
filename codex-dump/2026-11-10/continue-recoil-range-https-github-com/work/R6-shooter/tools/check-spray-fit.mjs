// Read-only check that every measured sprayPath in data/guns.json matches its bullet-hole
// pixels (measurement.holesPx) at the FOV it was recorded at (the gun's measuredAtVFov,
// which for aimed sprays is the sight's aimed FOV).
//
//   node tools/check-spray-fit.mjs           each gun at its own measuredAtVFov
//   node tools/check-spray-fit.mjs 83        every gun at one FOV (to compare)
//   node tools/check-spray-fit.mjs 83 f.json another file
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { refit } from './fit-lib.mjs';

const args = process.argv.slice(2);
const fixed = args[0] !== undefined && !args[0].endsWith('.json') ? Number(args[0]) : null;
const file = args.find((a) => a.endsWith('.json')) || fileURLToPath(new URL('../data/guns.json', import.meta.url));
const data = JSON.parse(readFileSync(file, 'utf8'));
let worstAll = 0, n = 0;
for (const g of data.guns) {
  const holes = g.measurement && g.measurement.holesPx;
  if (!Array.isArray(holes) || !holes.length) continue;
  const v = fixed || g.measuredAtVFov || (data.calibration && data.calibration.assumedVerticalFovDeg);
  if (!(v > 0)) { console.log(g.id + ': no measuredAtVFov'); continue; }
  n++;
  const fit = refit(holes, v);
  let worst = fit.length === g.sprayPath.length ? 0 : Infinity;
  fit.forEach((p, i) => { const q = g.sprayPath[i]; if (q) worst = Math.max(worst, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])); });
  worstAll = Math.max(worstAll, worst);
  console.log(String(g.id).padEnd(10) + ' vFOV ' + v.toFixed(2).padStart(6) + '  ' + String(holes.length).padStart(3) + ' holes  max diff ' +
    (worst === Infinity ? 'length differs' : worst.toFixed(2) + ' deg'));
}
if (!n) { console.log('No guns with measurement.holesPx'); process.exit(0); }
console.log(worstAll <= 0.011 ? 'All sprays match their hole pixels (within rounding).' : 'Some sprays do not match their hole pixels at this FOV.');
process.exit(worstAll <= 0.011 ? 0 : 1);
