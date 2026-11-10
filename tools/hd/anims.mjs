// Keyframed first-person weapon animations for the Enhanced Graphics pack (Milestone 8).
// Writes hd/anims/weapons.json. Played by js/scene/weapon-anims.js on High / Ultra with the
// pack's detailed guns; Low and Standard keep the procedural animations in viewmodel.js.
//
// Every clip runs on normalised time 0..1 and is stretched over the same duration the game
// already uses (reload = the gun's reload time, draw 0.42 s, inspect 3.2 s), so nothing about
// gameplay timing changes: only how it looks.
//
// Tracks (all optional):
//   root: [t, x, y, z, pitch, yaw, roll]            the whole weapon, view space (m, rad)
//   hand: [t, anchor, x, y, z, rx, ry, rz]          the support hand's palm, gun space, as an
//                                                   offset from an anchor the runtime measures
//                                                   on the actual model: 'rest' (on the
//                                                   handguard), 'mag' (the magazine's centre,
//                                                   following its animation), 'magBottom',
//                                                   'port' (the charging handle), 'pouch'
//   mag:  [t, x, y, z, rx, ry, rz, visible]         the magazine, offset from where it sits
//   bolt: [t, z]                                    the bolt / charging handle pulled back
//   events: [t, name]                               'slap', 'charge': a small kick of the gun
// Values between keys are interpolated with a Catmull-Rom spline (visibility steps).
//
// Run: node tools/hd/anims.mjs   (tools/build-hd.mjs runs it too)
import { writeFileSync, mkdirSync } from 'node:fs';

const R = (t, x = 0, y = 0, z = 0, p = 0, yw = 0, r = 0) => [t, x, y, z, p, yw, r];
const H = (t, at, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => [t, at, x, y, z, rx, ry, rz];
const M = (t, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, v = 1) => [t, x, y, z, rx, ry, rz, v];
const round = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
const tidy = (clip) => Object.fromEntries(Object.entries(clip).map(([k, keys]) => [k, keys.map((key) => key.map(round))]));

// Reload hold: lifted, muzzle up and rolled so the magazine well faces you.
const HOLD = { x: -0.02, y: 0.05, z: -0.14, p: 0.2, r: 1.1 };   // tuned in the game view (iron sights, AK)

// The palm sits on the left of the magazine while holding it (fingers round the front).
const GRAB = [-0.034, 0.012, 0.004, 0, 0.1, 0.55];

// Tactical reload: a round still chambered. The hand strips the magazine, stows it, brings a
// fresh one, seats it with a push and a slap, and returns to the handguard.
function reload(o = {}) {
  const rock = o.rock || 0;               // AK style: rock the magazine in and out at the front
  const roll = o.roll ?? HOLD.r, yaw = o.yaw ?? 0;
  const P = (t, dx = 0, dy = 0, dz = 0, dp = 0, dyw = 0, dr = 0) => R(t, HOLD.x + dx, HOLD.y + dy, HOLD.z + dz, HOLD.p + dp, yaw + dyw, roll + dr);
  return {
    root: [
      R(0), P(0.12), P(0.22, 0, -0.006, 0, 0.04, 0.03, 0.04), P(0.4, 0.002, 0, 0, 0.01, 0, 0.02), P(0.62, 0, 0.002, 0, 0, 0, -0.02),
      P(0.69, 0.004, 0.012, 0, 0.07, 0, -0.05), P(0.75, 0, 0, -0.002, -0.02), P(0.78, 0, 0.008, 0, 0.04, 0, -0.03),
      R(0.88, HOLD.x * 0.4, HOLD.y * 0.4, HOLD.z * 0.4, HOLD.p * 0.35, yaw * 0.4, roll * 0.4), R(1),
    ],
    mag: [
      M(0), M(0.12), M(0.2, 0, -0.06, 0.004, 0.06 + rock, 0, 0), M(0.3, -0.04, -0.22, 0.06, 0.3, 0, 0.2),
      M(0.4, -0.1, -0.5, 0.15, 0.5, 0, 0.4), M(0.41, -0.1, -0.5, 0.15, 0.5, 0, 0.4, 0), M(0.45, -0.1, -0.5, 0.15, 0.5, 0, 0.4, 0),
      M(0.46, -0.1, -0.5, 0.15, 0.5, 0, 0.4), M(0.56, -0.02, -0.16, 0.03, 0.15 - rock, 0, 0.05), M(0.64, 0, -0.045, 0.006, 0.03 - rock * 0.6, 0, 0),
      M(0.7, 0, 0, 0, 0, 0, 0), M(1),
    ],
    hand: [
      H(0, 'rest'), H(0.1, 'mag', ...GRAB), H(0.12, 'mag', ...GRAB), H(0.2, 'mag', ...GRAB), H(0.3, 'mag', ...GRAB),
      H(0.4, 'mag', ...GRAB), H(0.46, 'mag', ...GRAB), H(0.56, 'mag', ...GRAB), H(0.64, 'mag', ...GRAB), H(0.7, 'mag', ...GRAB),
      H(0.73, 'magBottom', -0.004, -0.05, 0.005, 0.2, 0, 0.15), H(0.755, 'magBottom', -0.004, -0.008, 0.005, 0.1, 0, 0.1),
      H(0.79, 'magBottom', -0.01, -0.06, 0.01, 0.2, 0, 0.2), H(0.88, 'rest', -0.01, -0.02, 0.02, 0.1, 0, 0.1), H(1, 'rest'),
    ],
    events: [[0.755, 'slap']],
  };
}

// Empty reload: the old magazine drops free while the hand goes for a new one; after the slap
// the hand comes over the top and works the charging handle.
function reloadEmpty(o = {}) {
  const rock = o.rock || 0;
  const roll = o.roll ?? HOLD.r, yaw = o.yaw ?? 0;
  const P = (t, dx = 0, dy = 0, dz = 0, dp = 0, dyw = 0, dr = 0) => R(t, HOLD.x + dx, HOLD.y + dy, HOLD.z + dz, HOLD.p + dp, yaw + dyw, roll + dr);
  return {
    root: [
      R(0), P(0.1), P(0.2, 0, 0.006, 0, 0.03, 0, 0.05), P(0.4), P(0.56, 0, 0.002, 0, 0, 0, -0.02),
      P(0.63, 0.004, 0.012, 0, 0.07, 0, -0.05), P(0.68, 0, 0, -0.002, -0.02), P(0.72, 0, 0.006, 0, 0.03, 0, -0.05),
      // over to the right side for the charging handle
      R(0.8, -0.02, 0.03, -0.02, 0.12, yaw - 0.35, -0.3), R(0.865, -0.02, 0.026, -0.012, 0.1, yaw - 0.38, -0.34),
      R(0.9, -0.02, 0.034, -0.02, 0.14, yaw - 0.35, -0.3), R(0.95, -0.008, 0.01, -0.006, 0.03, 0, -0.06), R(1),
    ],
    mag: [
      M(0), M(0.08), M(0.14, 0.004, -0.12, 0.01, 0.05 + rock, 0, 0.05), M(0.24, 0.02, -0.6, 0.04, 0.3, 0, 0.3), M(0.25, 0.02, -0.6, 0.04, 0.3, 0, 0.3, 0),
      M(0.36, -0.1, -0.5, 0.15, 0.5, 0, 0.4, 0), M(0.37, -0.1, -0.5, 0.15, 0.5, 0, 0.4), M(0.5, -0.02, -0.16, 0.03, 0.15 - rock, 0, 0.05),
      M(0.58, 0, -0.045, 0.006, 0.03 - rock * 0.6, 0, 0), M(0.64), M(1),
    ],
    hand: [
      H(0, 'rest'), H(0.06, 'rest', 0.004, -0.02, 0.03, 0.1, 0, 0.2), H(0.2, 'pouch'), H(0.3, 'pouch', 0.02, 0.05, 0),
      H(0.37, 'mag', ...GRAB), H(0.5, 'mag', ...GRAB), H(0.58, 'mag', ...GRAB), H(0.64, 'mag', ...GRAB),
      H(0.665, 'magBottom', -0.004, -0.05, 0.005, 0.2, 0, 0.15), H(0.685, 'magBottom', -0.004, -0.008, 0.005, 0.1, 0, 0.1),
      H(0.74, 'port', 0.03, -0.03, 0.08, 0, 0.5, -0.3), H(0.8, 'port', 0.012, 0.0, 0.004, 0, 0.6, -0.5),
      H(0.865, 'port', 0.012, 0.0, 0.05, 0, 0.6, -0.5), H(0.9, 'port', 0.03, -0.02, 0.04, 0, 0.5, -0.3),
      H(0.95, 'rest', -0.01, -0.02, 0.02, 0.1, 0, 0.1), H(1, 'rest'),
    ],
    bolt: [[0, 0], [0.8, 0], [0.865, 0.045], [0.885, 0.045], [0.9, 0], [1, 0]],
    events: [[0.685, 'slap'], [0.9, 'charge']],
  };
}

// Draw: up from the chest with a turn and a settle; the hand catches the handguard.
function draw() {
  return {
    root: [R(0, 0.02, -0.14, 0.04, -0.9, -0.25, 0.35), R(0.5, 0, -0.012, 0, 0.07, 0.03, -0.05), R(0.75, 0, 0.004, 0, -0.025, 0, 0.012), R(1)],
    hand: [H(0, 'rest', -0.06, -0.2, 0.14, 0.6, 0, 0.5), H(0.42, 'rest', -0.012, -0.035, 0.02, 0.12, 0, 0.12), H(0.7, 'rest', 0, 0.004, 0), H(1, 'rest')],
  };
}

// Inspect: right side, a chamber check, the left side, a magazine check, back to ready.
function inspect() {
  return {
    root: [
      R(0), R(0.12, -0.075, 0.075, -0.11, 0.12, 1.1, 0.2), R(0.24, -0.075, 0.08, -0.11, 0.16, 1.18, 0.14),
      R(0.31, -0.075, 0.084, -0.11, 0.2, 1.2, 0.1), R(0.4, -0.075, 0.076, -0.11, 0.12, 1.08, 0.18),
      R(0.5, -0.065, 0.07, -0.1, 0.12, 0, 0), R(0.58, -0.06, 0.07, -0.1, 0.12, -0.95, -0.2), R(0.66, -0.06, 0.068, -0.1, 0.1, -1.02, -0.18),
      R(0.73, -0.06, 0.06, -0.1, 0.26, -0.45, 0.32), R(0.82, -0.06, 0.062, -0.1, 0.24, -0.42, 0.34),
      R(0.9, -0.02, 0.02, -0.03, 0.03, -0.1, 0.05), R(1),
    ],
    hand: [
      H(0, 'rest'), H(0.12, 'rest'), H(0.24, 'port', -0.02, 0.04, 0.05, 0, 0.3, -0.6), H(0.28, 'port', 0.004, 0.012, 0.004, 0, 0.3, -0.9),
      H(0.31, 'port', 0.004, 0.012, 0.03, 0, 0.3, -0.9), H(0.35, 'port', 0.004, 0.012, 0.004, 0, 0.3, -0.9), H(0.42, 'rest', 0, -0.01, 0.01),
      H(0.66, 'rest'), H(0.72, 'mag', ...GRAB), H(0.76, 'mag', ...GRAB), H(0.8, 'mag', ...GRAB),
      H(0.83, 'magBottom', -0.004, -0.008, 0.005, 0.1, 0, 0.1), H(0.9, 'rest', -0.01, -0.02, 0.02), H(1, 'rest'),
    ],
    mag: [M(0), M(0.72), M(0.76, 0, -0.035, 0.002, 0.02), M(0.8, 0, -0.035, 0.002, 0.02), M(0.83), M(1)],
    bolt: [[0, 0], [0.28, 0], [0.31, 0.025], [0.33, 0.025], [0.35, 0], [1, 0]],
    events: [[0.83, 'slap']],
  };
}

// Styles by model (viewmodel.js MODEL_FOR): how each gun's magazine goes in and out.
const STYLES = {
  default: {},
  ak: { rock: -0.35 },                        // rock the magazine in at the front
  bullpup: { roll: 1.2, yaw: -0.22 },        // magazine behind the grip: show the rear well
  machinepistol: { roll: 0.8 },               // magazine in the grip
  lmg: { roll: 0.9, yaw: -0.1 },
};
const TYPES = { ak: 'ak', bullpup: 'bullpup', machinepistol: 'machinepistol', lmg: 'lmg' };

export function buildAnims() {
  const styles = {};
  for (const [name, o] of Object.entries(STYLES)) {
    styles[name] = { reload: tidy(reload(o)), reloadEmpty: tidy(reloadEmpty(o)), draw: tidy(draw()), inspect: tidy(inspect()) };
  }
  return { format: 'recoil-range-anims', version: 1, styles, types: TYPES };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const root = new URL('../../', import.meta.url);
  mkdirSync(new URL('hd/anims/', root), { recursive: true });
  const out = JSON.stringify(buildAnims());
  writeFileSync(new URL('hd/anims/weapons.json', root), out);
  console.log('hd/anims/weapons.json: ' + out.length + ' bytes');
}
