// The Enhanced Graphics pack's soldier: the same pose, proportions and hit shapes as
// js/battle/soldier.js (SOLDIER_PARTS: what you see is what can be hit), with real gear.
// Soldier frame: metres, x right, y up from the feet, z forward. Groups: upper (body, arms,
// head), legL and legR (built in place; the game moves them to their hip hinge).
// Roles are coloured per team at runtime: cloth, clothDark, patch (team colour), vest, gear,
// black, skin, helmet.
import * as THREE from '../../vendor/three/three.module.min.js';
import { Model, lathe, rbox, section, capsule, pin } from './kit.mjs';

const L = -1, R = 1;
const MOLLE = (m, role, x0, x1, y0, y1, z, rows, dz = 0.006) => {
  // webbing straps in rows across a face facing +z (or -z with dz < 0)
  for (let i = 0; i < rows; i++) {
    const y = y0 + (y1 - y0) * (i + 0.5) / rows;
    section(m, role, [[x0, y - 0.009, 0.002], [x1, y - 0.009, 0.002], [x1, y + 0.009, 0.002], [x0, y + 0.009, 0.002]], dz > 0 ? z : z + dz, dz > 0 ? z + dz : z, { bevel: 0.0015 });
  }
};
// A pouch on the front (+z face at z), with a flap.
function pouch(m, x, y, z, w, h, d, s = 1) {
  rbox(m, 'gear', w, h, d, x, y, z + s * d / 2, { r: 0.012, bevel: 0.008 });
  rbox(m, 'gear', w + 0.008, h * 0.28, d + 0.01, x, y + h * 0.4, z + s * (d / 2 + 0.003), { r: 0.01, bevel: 0.006 });
  rbox(m, 'black', 0.02, 0.016, 0.006, x, y + h * 0.27, z + s * (d + 0.008), { r: 0.004, bevel: 0.002 });   // buckle
}

export function soldier() {
  const m = new Model('soldier');
  m.in('upper', () => {
    /* head and helmet */
    lathe(m, 'skin', Array.from({ length: 13 }, (_, i) => { const a = -Math.PI / 2 + i / 12 * Math.PI; return [Math.cos(a) * 0.106, Math.sin(a) * 0.112]; }), { axis: 'y', y: 1.6, z: 0.02, seg: 12 });
    rbox(m, 'skin', 0.05, 0.045, 0.05, 0, 1.585, 0.115, { r: 0.018, bevel: 0.012 });                    // nose and jaw
    lathe(m, 'helmet', [[0.126, -0.07], [0.14, -0.066], [0.139, -0.048], [0.135, -0.005], [0.124, 0.04], [0.1, 0.075], [0.062, 0.096], [0, 0.104]], { axis: 'y', y: 1.635, seg: 14 });
    lathe(m, 'patch', [[0.137, -0.03], [0.1405, -0.03], [0.1405, -0.005], [0.137, -0.005]], { axis: 'y', y: 1.635, seg: 14 });   // team band
    for (const s of [L, R]) rbox(m, 'black', 0.012, 0.022, 0.13, s * 0.132, 1.6, 0.0, { r: 0.006, bevel: 0.003 });     // side rails
    rbox(m, 'black', 0.05, 0.04, 0.02, 0, 1.69, 0.12, { r: 0.008, bevel: 0.004 });                        // night-vision mount
    rbox(m, 'helmet', 0.07, 0.05, 0.04, 0, 1.67, -0.12, { r: 0.012, bevel: 0.006 });                      // counterweight
    // goggles and strap, headset cups and mic
    rbox(m, 'black', 0.17, 0.048, 0.045, 0, 1.615, 0.112, { r: 0.018, bevel: 0.01 });
    rbox(m, 'clothDark', 0.23, 0.02, 0.2, 0, 1.615, 0.0, { r: 0.008, bevel: 0.004 });
    for (const s of [L, R]) lathe(m, 'black', [[0, 0], [0.04, 0], [0.043, 0.008], [0.04, 0.026], [0.03, 0.032], [0, 0.032]].map(([r, t]) => [r, s > 0 ? t : t]), { axis: 'x', x: s > 0 ? 0.1 : -0.132, y: 1.585, seg: 10 });
    capsule(m, 'black', [0.12, 1.57, 0.02], [0.05, 1.555, 0.11], 0.005, { seg: 8 });
    rbox(m, 'clothDark', 0.13, 0.05, 0.12, 0, 1.53, 0.04, { r: 0.02, bevel: 0.012 });                   // collar

    /* torso: shirt, plate carrier, pouches, belt, pack */
    capsule(m, 'cloth', [0, 1.03, 0], [0, 1.3, 0], 0.168, { seg: 12 });
    capsule(m, 'cloth', [-0.19, 1.38, 0], [0.19, 1.38, 0], 0.078, { seg: 10 });
    // front and back plates (rounded, slightly curved shoulders), side cummerbund
    const plate = [[-0.19, 0.99, 0.02], [0.19, 0.99, 0.02], [0.19, 1.34, 0.05], [0.12, 1.4, 0.03], [-0.12, 1.4, 0.03], [-0.19, 1.34, 0.05]];
    section(m, 'vest', plate, 0.12, 0.175, { bevel: 0.012 });
    section(m, 'vest', plate, -0.175, -0.12, { bevel: 0.012 });
    for (const s of [L, R]) {
      rbox(m, 'vest', 0.05, 0.22, 0.27, s * 0.18, 1.1, 0, { r: 0.03, bevel: 0.015 });                      // cummerbund
      rbox(m, 'vest', 0.06, 0.03, 0.3, s * 0.12, 1.405, 0, { r: 0.012, bevel: 0.01 });                    // shoulder strap
      rbox(m, 'patch', 0.022, 0.07, 0.07, s * 0.282, 1.3, 0.03, { r: 0.008, bevel: 0.004 });              // team patch
    }
    MOLLE(m, 'vest', -0.17, 0.17, 1.17, 1.33, 0.175, 4);
    MOLLE(m, 'vest', -0.17, 0.17, 1.02, 1.33, -0.175, 6, -0.006);
    for (const x of [-0.12, 0, 0.12]) pouch(m, x, 1.07, 0.175, 0.095, 0.13, 0.06);                         // magazine pouches
    pouch(m, 0, 1.28, 0.175, 0.22, 0.08, 0.04);                                                             // admin pouch
    rbox(m, 'black', 0.035, 0.12, 0.035, 0.13, 1.33, 0.2, { r: 0.012, bevel: 0.006 });                    // radio
    pin(m, 'black', 0.004, 0.14, 0.13, 1.45, 0.2, 'y', 8);                                                   // antenna
    // belt with buckle and side pouches
    lathe(m, 'black', [[0.2, -0.035], [0.215, -0.03], [0.215, 0.03], [0.2, 0.035], [0.18, 0.035], [0.18, -0.035], [0.2, -0.035]], { axis: 'y', y: 0.96, seg: 17 }).scale(1, 1, 0.78).translate(0, 0, 0);
    rbox(m, 'gear', 0.05, 0.045, 0.012, 0, 0.96, 0.168, { r: 0.008, bevel: 0.004 });
    for (const s of [L, R]) pouch(m, s * 0.17, 0.92, 0.05, 0.07, 0.1, 0.05);
    capsule(m, 'clothDark', [-0.1, 0.93, 0], [0.1, 0.93, 0], 0.118, { seg: 11 });
    // backpack with straps, top flap and side bottle
    rbox(m, 'gear', 0.3, 0.38, 0.14, 0, 1.2, -0.25, { r: 0.04, bevel: 0.025 });
    rbox(m, 'gear', 0.31, 0.1, 0.15, 0, 1.36, -0.25, { r: 0.03, bevel: 0.02 });
    rbox(m, 'gear', 0.22, 0.16, 0.05, 0, 1.12, -0.335, { r: 0.02, bevel: 0.012 });
    for (const s of [L, R]) rbox(m, 'black', 0.03, 0.4, 0.012, s * 0.1, 1.2, -0.322, { r: 0.006, bevel: 0.004 });
    capsule(m, 'black', [0.18, 1.06, -0.25], [0.18, 1.22, -0.25], 0.035, { seg: 8 });
    rbox(m, 'vest', 0.26, 0.08, 0.13, 0, 1.43, -0.22, { r: 0.03, bevel: 0.02 });

    /* arms on the rifle: sleeves, elbow pads, gloves (the hit capsules' layout) */
    const arms = [[[0.22, 1.37, 0], [0.25, 1.13, 0.12], 0.058], [[0.25, 1.13, 0.12], [0.09, 1.19, 0.33], 0.05], [[-0.22, 1.37, 0], [-0.21, 1.17, 0.18], 0.058], [[-0.21, 1.17, 0.18], [0.0, 1.23, 0.5], 0.05]];
    for (const [a, b, r] of arms) capsule(m, 'cloth', a, b, r * 0.97, { seg: 8 });
    for (const [a, , r] of [arms[1], arms[3]]) capsule(m, 'black', [a[0], a[1] + 0.005, a[2] - 0.02], [a[0], a[1] + 0.005, a[2] + 0.03], r * 1.18, { seg: 8 });   // elbow pads
    for (const [a, , r] of [arms[0], arms[2]]) capsule(m, 'clothDark', [a[0], a[1] - 0.07, a[2]], [a[0] * 1.05, a[1] - 0.13, a[2] + 0.04], r * 1.04, { seg: 8 });    // sleeve pocket
    rbox(m, 'black', 0.065, 0.075, 0.1, 0.08, 1.19, 0.34, { r: 0.028, bevel: 0.02 });                       // gloves
    rbox(m, 'black', 0.065, 0.07, 0.095, 0.0, 1.23, 0.5, { r: 0.028, bevel: 0.02 });
  });
  /* legs: trousers with cargo pockets, knee pads, boots with soles and laces */
  for (const s of [L, R]) m.in(s < 0 ? 'legL' : 'legR', () => {
    capsule(m, 'cloth', [s * 0.1, 0.88, 0], [s * 0.11, 0.48, 0.03], 0.081, { seg: 10 });
    capsule(m, 'cloth', [s * 0.11, 0.46, 0.03], [s * 0.11, 0.14, 0], 0.062, { seg: 10 });
    rbox(m, 'clothDark', 0.045, 0.14, 0.1, s * 0.185, 0.68, 0.02, { r: 0.015, bevel: 0.01 });               // cargo pocket
    rbox(m, 'gear', 0.05, 0.12, 0.09, s * 0.19, 0.8, 0.0, { r: 0.015, bevel: 0.01 });                         // thigh pouch
    rbox(m, 'black', 0.12, 0.13, 0.06, s * 0.11, 0.47, 0.09, { r: 0.03, bevel: 0.02 });                       // knee pad
    rbox(m, 'black', 0.13, 0.025, 0.02, s * 0.11, 0.53, 0.085, { r: 0.006, bevel: 0.004 });
    rbox(m, 'black', 0.12, 0.1, 0.22, s * 0.11, 0.075, 0.035, { r: 0.04, bevel: 0.025 });                    // boot
    rbox(m, 'gear', 0.125, 0.025, 0.27, s * 0.11, 0.0125, 0.045, { r: 0.012, bevel: 0.006 });               // sole
    rbox(m, 'black', 0.105, 0.09, 0.1, s * 0.11, 0.15, 0.0, { r: 0.03, bevel: 0.02 });                       // boot top
    for (let i = 0; i < 4; i++) rbox(m, 'gear', 0.05, 0.006, 0.01, s * 0.11, 0.1 + i * 0.022, 0.11 - i * 0.012, { r: 0.002, bevel: 0.002 });   // laces
  });
  return m;
}
