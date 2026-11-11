// Usage: node tools/refit-fov.mjs <verticalFovDeg> [in.json] [out.json]
// Recomputes every gun's sprayPath from measurement.holesPx for a different vertical FOV.
import fs from 'node:fs';
const vfov = parseFloat(process.argv[2]);
if (!(vfov > 0)) { console.error('usage: node tools/refit-fov.mjs <verticalFovDeg> [in] [out]'); process.exit(1); }
// Default: reference/ (gitignored). The measurement file names real operators, so it must not
// live in data/, which is published with the site.
const inFile = process.argv[3] || 'reference/guns.measured.json';
const outFile = process.argv[4] || inFile;
const d = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const [W, H] = d.calibration.screenPx, [cx, cy] = d.calibration.crosshairPx;
const f = (H / 2) / Math.tan((vfov * Math.PI / 180) / 2);
const deg = r => r * 180 / Math.PI;
const ang = ([x, y]) => { const X = (x - cx) / f, Y = (cy - y) / f; return [deg(Math.atan2(X, 1)), deg(Math.atan2(Y, Math.hypot(X, 1)))]; };
const r2 = v => Math.round(v * 100) / 100;
for (const g of d.guns) {
  const a = g.measurement.holesPx.map(ang);
  g.sprayPath = a.map(([y, p]) => [r2(y - a[0][0]), r2(p - a[0][1])]);
  const last = g.sprayPath[g.sprayPath.length - 1];
  g.measurement.totalYawDeg = last[0]; g.measurement.totalPitchDeg = last[1];
}
d.calibration.assumedVerticalFovDeg = vfov;
fs.writeFileSync(outFile, JSON.stringify(d, null, 1));
console.log(`refit ${d.guns.length} guns at vFOV ${vfov} (f=${f.toFixed(1)} px) -> ${outFile}`);
