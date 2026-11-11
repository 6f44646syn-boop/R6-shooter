// Convert traced bullet-hole pixel coordinates into a sprayPath (degrees).
//
//   node tools/path-from-points.mjs points.txt --distance 10 --px-per-metre 85.3
//
// points.txt: one hole per line in firing order, "x y" or "x,y" in image pixels (y grows
// downwards, as in any image editor). A JSON array [[x, y], ...] also works.
//
// Assumptions (keep them true when you record):
//   - You aimed at one point and did not move the mouse during the spray.
//   - The camera looked straight at the wall (perpendicular), and bullet 1 landed on the aim
//     point. Everything is measured relative to bullet 1.
//   - --distance is the distance from your eye to the wall in metres.
//   - --px-per-metre is the image scale at the wall (measure something of known size on the
//     wall in the same screenshot, e.g. a 1 m marking: pixels / metres).
//
// Maths: the hole offset (dx, dy) in metres on a wall at distance d maps back to angles with
// the same geometry the game's hitscan uses:
//   yaw   = atan(dx / d)
//   pitch = atan(dy / sqrt(d^2 + dx^2))
import { readFileSync } from 'node:fs';

function usage(msg) {
  if (msg) console.error('Error: ' + msg + '\n');
  console.error('Usage: node tools/path-from-points.mjs <points file> --distance <m> --px-per-metre <px>');
  process.exit(1);
}

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : NaN; };
const d = opt('distance');
const ppm = opt('px-per-metre');
if (!file) usage('no points file given');
if (!(d > 0)) usage('--distance must be a number > 0 (metres)');
if (!(ppm > 0)) usage('--px-per-metre must be a number > 0');

const text = readFileSync(file, 'utf8').trim();
let pts;
if (text.startsWith('[')) {
  pts = JSON.parse(text);
} else {
  pts = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/[\s,;]+/).map(Number));
}
pts.forEach((p, i) => {
  if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) usage('bad point on entry ' + (i + 1) + ': ' + JSON.stringify(p));
});

const DEG = 180 / Math.PI;
const [x0, y0] = pts[0];
const path = pts.map(([x, y]) => {
  const dx = (x - x0) / ppm;    // metres, right positive
  const dy = -(y - y0) / ppm;   // metres, up positive (image y is down)
  const yaw = Math.atan(dx / d) * DEG;
  const pitch = Math.atan(dy / Math.hypot(d, dx)) * DEG;
  return [Math.round(yaw * 10000) / 10000, Math.round(pitch * 10000) / 10000];
});

console.log('"sprayPath": [\n' + path.map((p) => '  [' + p[0] + ', ' + p[1] + ']').join(',\n') + '\n]');
