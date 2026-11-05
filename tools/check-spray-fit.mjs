// Check that data/guns.json's measured sprayPaths match their stored bullet-hole pixels
// (measurement.holesPx) at a given vertical FOV. Read-only unless --write is given.
//
//   node tools/check-spray-fit.mjs 83            compare data/guns.json with a refit at 83 deg
//   node tools/check-spray-fit.mjs 83 file.json  check another file
// (To refit the measurement file itself at another FOV, use tools/refit-fov.mjs.)
//
// Pinhole camera, 1920x1080 screenshots, crosshair at the screen centre:
//   f     = (H / 2) / tan(vFOV / 2)                  focal length in pixels
//   yaw   = atan(dx / f)                             dx = x - cx (right +)
//   pitch = atan(dy / sqrt(f^2 + dx^2))              dy = cy - y (up +)
// Angles are taken relative to bullet 1, rounded to 0.01 deg, like the measurement file.
// Only guns with measurement.holesPx are touched.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const vFov = Number(args[0]);
if (!(vFov > 0 && vFov < 180)) {
  console.error('Usage: node tools/check-spray-fit.mjs <vertical FOV degrees> [--write] [file]');
  process.exit(1);
}
const write = args.includes('--write');
const file = args.find((a, i) => i > 0 && a !== '--write') || fileURLToPath(new URL('../data/guns.json', import.meta.url));
const data = JSON.parse(readFileSync(file, 'utf8'));

const DEG = 180 / Math.PI;
export function refit(holes, vFovDeg, W = 1920, H = 1080) {
  const f = (H / 2) / Math.tan(vFovDeg / DEG / 2);
  const cx = W / 2, cy = H / 2;
  const ang = holes.map(([x, y]) => {
    const dx = x - cx, dy = cy - y;
    return [Math.atan(dx / f) * DEG, Math.atan(dy / Math.hypot(f, dx)) * DEG];
  });
  const r2 = (v) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0
  return ang.map(([y, p]) => [r2(y - ang[0][0]), r2(p - ang[0][1])]);
}

let worstAll = 0, n = 0;
for (const g of data.guns) {
  const holes = g.measurement && g.measurement.holesPx;
  if (!Array.isArray(holes) || !holes.length) continue;
  n++;
  const fit = refit(holes, vFov);
  let worst = 0;
  fit.forEach((p, i) => {
    const q = g.sprayPath[i];
    if (!q) { worst = Infinity; return; }
    worst = Math.max(worst, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]));
  });
  if (fit.length !== g.sprayPath.length) worst = Infinity;
  worstAll = Math.max(worstAll, worst);
  console.log((g.id + '').padEnd(10) + ' ' + String(holes.length).padStart(3) + ' holes  max diff vs file ' +
    (worst === Infinity ? 'length differs' : worst.toFixed(2) + ' deg'));
  if (write) {
    g.sprayPath = fit;
    g.measuredAtVFov = vFov;
  }
}
if (!n) { console.log('No guns with measurement.holesPx in ' + file); process.exit(0); }
if (write) {
  let json = JSON.stringify(data, null, 2).replace(/\[\s+(-?[\d.e-]+),\s+(-?[\d.e-]+)\s+\]/g, '[$1, $2]');
  writeFileSync(file, json + '\n');
  console.log('Wrote refit at ' + vFov + ' deg to ' + file);
} else {
  console.log(worstAll <= 0.011 ? 'File matches a refit at ' + vFov + ' deg (within rounding).' : 'File differs from a refit at ' + vFov + ' deg.');
}
