// The Enhanced Graphics pack's gun models: one detailed, original design per model in
// js/scene/viewmodel.js (same layout and anchor points as the low-poly ones: receiver top,
// rails, grip, magazine, hands and muzzle), built with tools/hd/kit.mjs.
import * as THREE from '../../vendor/three/three.module.min.js';
import {
  Model, side, sideC, section, lathe, rod, pin, rbox, rail, screw, mirror, triggerGroup, grip, magazine,
  barrel, brake, flashHider, port, slots, swivel, rect, slot, circle, bez, shape, xform, rotX, move,
} from './kit.mjs';

/* ---------- shared assemblies ---------- */
// AR-style upper receiver: flat top at `top` from z0 (rear) to z1 (front), split line at ys,
// ejection port on the right, forward assist and brass deflector, charging handle at the back.
function arUpper(m, { z0, z1, top, ys, hw, portZ = 0, portY = 0.012 }) {
  sideC(m, 'finish', [[z0, ys], [z0, top - 0.006, 0.004], [z0 - 0.008, top], [z1, top], [z1, ys + 0.004, 0.002], [z1 + 0.01, ys]], hw * 2, { bevel: 0.0022 });
  // Side flats (slightly proud bands) along the upper.
  for (const sx of [-1, 1]) side(m, 'finish', rect((z0 + z1) / 2 - 0.01, top - 0.0085, (z0 - z1) * 0.8, 0.0075, 0.002), sx > 0 ? hw - 0.0005 : -hw - 0.0006, sx > 0 ? hw + 0.0006 : -hw + 0.0005, { bevel: 0.0004 });
  port(m, hw, portY, portZ, 0.05, 0.016);
  // Brass deflector behind the port.
  side(m, 'finish', [[portZ + 0.03, portY - 0.004], [portZ + 0.03, top - 0.004, 0.003], [portZ + 0.05, top - 0.004], [portZ + 0.055, portY - 0.004]], hw - 0.002, hw + 0.006, { bevel: 0.0012 });
  // Forward assist: a short plunger on the right, angled back.
  const fa = rod(m, 'finish', 0.0055, 0.02, -0.006, { seg: 16, chamfer: 0.0012 });
  fa.rotateY(-0.35).translate(hw + 0.004, portY + 0.006, portZ + 0.07);
  rod(m, 'steel', 0.0042, 0.026, 0.018, { seg: 14 }).rotateY(-0.35).translate(hw + 0.004, portY + 0.006, portZ + 0.07);
  // Charging handle: a T at the back of the top.
  section(m, 'polymer', [[-0.009, top - 0.006], [0.009, top - 0.006], [0.009, top - 0.0015, 0.001], [-0.009, top - 0.0015, 0.001]], z0 - 0.012, z0 + 0.004, { bevel: 0.0006 });
  section(m, 'polymer', [[-0.018, top - 0.007, 0.002], [0.018, top - 0.007, 0.002], [0.018, top - 0.001, 0.002], [-0.018, top - 0.001, 0.002]], z0 + 0.004, z0 + 0.011, { bevel: 0.0008 });
}
// AR-style lower: from z0 (rear) to z1 (front) below ys down to yb, with the magazine well
// flaring down around the magazine (mz, depth md) to yw, pins and controls.
function arLower(m, { z0, z1, ys, yb, hw, mz, md, yw, tz }) {
  const w0 = mz + md / 2 + 0.006, w1 = mz - md / 2 - 0.006;
  sideC(m, 'finish', [
    [z0, ys], [z0, yb + 0.006, 0.004], [z0 - 0.012, yb], [w0 + 0.004, yb], [w0, yw, 0.003], [w1, yw, 0.003], [w1 - 0.004, yb + 0.004], [z1, yb + 0.008, 0.003], [z1, ys],
  ], hw * 2 - 0.003, { bevel: 0.002 });
  // Magazine well opening (dark) seen from below is covered by the magazine; flare ridge.
  for (const sx of [-1, 1]) side(m, 'finish', rect(mz, yw + 0.004, md + 0.014, 0.006, 0.002), sx > 0 ? hw - 0.002 : -hw + 0.0002, sx > 0 ? hw - 0.0002 : -hw + 0.002, { bevel: 0.0005 });
  // Takedown and pivot pins, hammer and trigger pins.
  for (const z of [z0 - 0.012, z1 + 0.008]) pin(m, 'steel', 0.0028, hw * 2 + 0.002, 0, ys - 0.006, z, 'x', 14);
  for (const z of [tz + 0.012, tz - 0.004]) pin(m, 'steel', 0.0018, hw * 2 + 0.001, 0, yb + 0.012, z, 'x', 10);
  // Magazine release (right) and bolt catch (left).
  rbox(m, 'steel', 0.004, 0.008, 0.008, hw - 0.0005, yb + 0.012, w0 + 0.006, { r: 0.002, bevel: 0.0008 });
  side(m, 'steel', [[w0 + 0.002, ys - 0.004], [w0 + 0.002, ys - 0.016, 0.002], [w0 + 0.012, ys - 0.016, 0.002], [w0 + 0.016, ys - 0.004]], -hw - 0.0025, -hw + 0.0005, { bevel: 0.0006 });
  triggerGroup(m, yb, tz, hw);
}
// Buffer tube with a collapsible stock: tube from z0 back to z1 along y, stock body from zs.
function arStock(m, { z0, y, zs, ze, top, bottom }) {
  // Castle nut and end plate.
  lathe(m, 'steel', [[0.006, -z0 - 0.004], [0.0165, -z0 - 0.004], [0.0165, -z0 + 0.006], [0.006, -z0 + 0.006]], { y, seg: 12 });
  const prof = [[0, -ze]];
  prof.push([0.0115, -ze], [0.0128, -ze + 0.003]);
  for (let z = ze - 0.012; z > z0 + 0.012; z -= 0.016) prof.push([0.0128, -z - 0.001], [0.0122, -z], [0.0128, -z + 0.001]);
  prof.push([0.0128, -z0 - 0.002], [0.0115, -z0], [0, -z0]);
  lathe(m, 'steel', prof, { y });
  // Stock body: side profile with a lightening cut and a sling slot.
  const body = [[zs, top - 0.008], [zs + 0.01, top, 0.006], [ze + 0.002, top + 0.003, 0.004], [ze + 0.002, bottom, 0.004], [ze - 0.03, bottom + 0.004, 0.006], [zs + 0.03, y - 0.016, 0.01], [zs, y - 0.014]];
  sideC(m, 'shell', body, 0.036, { holes: [slot(ze - 0.05, (top + bottom) / 2 - 0.008, 0.03, 0.016)], bevel: 0.004 });
  // Rubber butt pad with ribs.
  sideC(m, 'rubber', [[ze, top + 0.004, 0.004], [ze + 0.016, top + 0.006, 0.005], [ze + 0.016, bottom - 0.002, 0.005], [ze, bottom - 0.002, 0.003]], 0.04, { bevel: 0.004 });
  for (let i = 0; i < 6; i++) { const yy = top - (top - bottom) * (i + 0.6) / 6.3; section(m, 'rubber', [[-0.019, yy - 0.002, 0.001], [0.019, yy - 0.002, 0.001], [0.019, yy + 0.002, 0.001], [-0.019, yy + 0.002, 0.001]], ze + 0.0155, ze + 0.0185, { bevel: 0.0005 }); }
  // Adjustment lever under the tube.
  section(m, 'steel', [[-0.004, y - 0.022, 0.002], [0.004, y - 0.022, 0.002], [0.004, y - 0.016], [-0.004, y - 0.016]], zs + 0.006, zs + 0.03, { bevel: 0.0008 });
}
// Hollow handguard with ventilation slots in the sides, from z0 (rear) to z1 (front):
// side plates with real slots, top and bottom plates, chamfered corners, an end ring.
function slotHandguard(m, { z0, z1, top, bottom, hw, role = 'finish', railTop = true, nslots, barrelY }) {
  const yc = (top + bottom) / 2, h = top - bottom, len = z0 - z1, c = Math.min(0.009, h * 0.22);
  const n = nslots || Math.max(3, Math.round(len / 0.035));
  const holes = slots(z0 - 0.012, z1 + 0.012, yc, n, len / n * 0.62, h * 0.32);
  for (const sx of [-1, 1]) side(m, role, rect((z0 + z1) / 2, yc, len, h - 2 * c + 0.002, 0.001), sx > 0 ? hw - 0.0028 : -hw, sx > 0 ? hw : -hw + 0.0028, { holes, bevel: 0.0008 });
  section(m, role, [[-hw + c, top - 0.003], [hw - c, top - 0.003], [hw - c, top], [-hw + c, top]], z1, z0, { bevel: 0.0006 });
  section(m, role, [[-hw + c, bottom], [hw - c, bottom], [hw - c, bottom + 0.003], [-hw + c, bottom + 0.003]], z1, z0, { bevel: 0.0006 });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x0 = sx * hw, y0 = sy > 0 ? top : bottom;
    const pts = [[x0, y0 - sy * c], [x0 - sx * 0.0028, y0 - sy * c], [x0 - sx * c, y0 - sy * 0.0028], [x0 - sx * c, y0]];
    section(m, role, sx * sy > 0 ? pts : pts.slice().reverse(), z1, z0, { bevel: 0.0005 });
  }
  // Small slots on the chamfers (lightening).
  // End ring at the front with the barrel opening.
  side(m, role, rect(z1 + 0.003, yc, 0.006, h, c), -hw, hw, { holes: [circle(z1 + 0.003, barrelY, 0.011)], bevel: 0.0012 });
  // Mounting screws along the sides.
  for (const z of [z0 - 0.006, z1 + 0.012]) for (const sx of [-1, 1]) screw(m, sx, sx * hw, yc, z, 0.0018);
  if (railTop) rail(m, top, z0 - 0.002, z1 + 0.006);
}
// Gas block and gas tube inside a handguard.
function gasSystem(m, y, zb, zt) {
  rbox(m, 'steel', 0.022, 0.024, 0.018, 0, y + 0.004, zb, { r: 0.004, bevel: 0.0015 });
  rod(m, 'steel', 0.0032, zb + 0.008, zt, { y: y + 0.013 });
  for (const sx of [-1, 1]) screw(m, sx, sx * 0.011, y + 0.004, zb, 0.0016);
}
// Vertical foregrip with finger ribs, top at (z, y).
function foregrip(m, z, y, { len = 0.07, r = 0.0135, rake = 0 } = {}) {
  const prof = [[0, -len], [r * 0.9, -len], [r, -len + 0.004]];
  for (let i = 0; i < 4; i++) { const t = -len + 0.012 + i * (len - 0.02) / 4; prof.push([r * 1.06, t + 0.004], [r * 0.93, t + 0.009]); }
  prof.push([r, -0.004], [r * 1.25, -0.002], [r * 1.25, 0], [0, 0]);
  const g = lathe(m, 'shell', prof, { axis: 'y', seg: 18 });
  // Lathe 'y' leaves the profile on +y: t = y offset from the top, already negative downwards.
  if (rake) g.rotateX(-rake);
  g.translate(0, y, z);
  // Mount clamp.
  rbox(m, 'polymer', 0.024, 0.008, 0.03, 0, y + 0.003, z, { r: 0.002, bevel: 0.001 });
}
// SMG receiver: a stamped, boxy body from z0 to z1 between yb and top, with side flutes, a
// cocking slot, a port and an end cap.
function smgReceiver(m, { z0, z1, top, yb, hw, portZ, portY = 0.01, role = 'finish', flutes = 2 }) {
  sideC(m, role, [[z0, yb + 0.008], [z0, top - 0.008, 0.008], [z0 - 0.012, top], [z1 + 0.01, top], [z1, top - 0.01, 0.006], [z1, yb + 0.006, 0.004], [z1 + 0.012, yb], [z0 - 0.014, yb]], hw * 2, { bevel: 0.0025 });
  for (let i = 0; i < flutes; i++) for (const sx of [-1, 1]) {
    const yy = top - 0.012 - i * 0.009;
    side(m, 'dark', slot((z0 + z1) / 2 + 0.02, yy, (z0 - z1) * 0.45, 0.0035), sx > 0 ? hw - 0.0006 : -hw - 0.0002, sx > 0 ? hw + 0.0002 : -hw + 0.0006, { bevel: 0 });
  }
  port(m, hw, portY, portZ, 0.04, 0.014, { cover: false });
  // Cocking slot along the left top with the handle.
  side(m, 'dark', slot((z0 + z1) / 2 - 0.03, top - 0.006, (z0 - z1) * 0.5, 0.004), -hw - 0.0003, -hw + 0.0008, { bevel: 0 });
  // End cap.
  side(m, 'steel', rect(z0 + 0.003, (top + yb) / 2, 0.006, top - yb - 0.008, 0.004), -hw + 0.002, hw - 0.002, { bevel: 0.0012 });
  for (const sx of [-1, 1]) screw(m, sx, sx * hw, (top + yb) / 2, z0 - 0.02, 0.002);
}
// Folding / telescoping wire stock: two bars at ±xb from z0 back to z1 at height y, a butt plate.
function wireStock(m, { z0, z1, y, xb, plateH = 0.05, plateY = y - 0.01, r = 0.0035 }) {
  for (const sx of [-1, 1]) rod(m, 'steel', r, z0, z1, { x: sx * xb, y });
  sideC(m, 'polymer', rect(z1 + 0.004, plateY, 0.01, plateH, 0.004), xb * 2 + 0.014, { bevel: 0.003 });
  sideC(m, 'rubber', rect(z1 + 0.011, plateY, 0.005, plateH - 0.004, 0.002), xb * 2 + 0.01, { bevel: 0.0015 });
  for (const sx of [-1, 1]) pin(m, 'steel', r * 1.5, 0.006, sx * xb, y, z0 + 0.004, 'x', 12);
}
// Suppressor-like round shroud with a front cap (from z0 back to z1 forward).
function shroud(m, y, z0, z1, r, { holes = 0, role = 'steel' } = {}) {
  lathe(m, role, [[0, -z0], [r * 0.85, -z0], [r, -z0 - 0.003], [r, -z1 + 0.004], [r * 0.9, -z1], [r * 0.4, -z1], [r * 0.4, -z1 - 0.002]], { y, seg: 24 });
  for (let i = 0; i < holes; i++) for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + i * 0.5, z = z0 - 0.01 - i * (z0 - z1 - 0.02) / Math.max(1, holes - 1);
    const g = rbox(m, 'dark', 0.0016, 0.006, 0.006, 0, r - 0.0004, 0, { r: 0.003, bevel: 0.0003 });
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(a)).translate(0, y, z);
  }
}

/* ---------- the guns ---------- */
// Each returns a Model plus anchors used at runtime instead of the low-poly values:
// muzzle [y, z] (flash), port [x, y, z] (brass), top (receiver top for the sight).
export const GUNS = {
  // R4-C-like carbine.
  carbine() {
    const m = new Model('carbine'), hw = 0.025;
    arUpper(m, { z0: 0.15, z1: -0.15, top: 0.034, ys: -0.004, hw });
    rail(m, 0.034, 0.142, -0.148);
    arLower(m, { z0: 0.135, z1: -0.12, ys: -0.004, yb: -0.034, hw, mz: -0.07, md: 0.05, yw: -0.046, tz: -0.005 });
    slotHandguard(m, { z0: -0.15, z1: -0.29, top: 0.031, bottom: -0.024, hw: 0.026, barrelY: 0.012 });
    barrel(m, 0.012, -0.12, -0.415, 0.0082);
    gasSystem(m, 0.012, -0.27, -0.16);
    brake(m, 0.012, -0.445, 0.032, 0.0115);
    grip(m, 0.028, -0.03, { len: 0.1, depth: 0.044, w: 0.032, a: 0.3 });
    magazine(m, -0.07, -0.03, { h: 0.13, d: 0.05, w: 0.026, bend: 0.1, ribs: 3, window: true });
    arStock(m, { z0: 0.135, y: 0.012, zs: 0.22, ze: 0.335, top: 0.03, bottom: -0.05 });
    swivel(m, -hw - 0.006, -0.01, 0.16);
    return { m, anchors: { muzzle: [0.012, -0.447], top: 0.034 } };
  },
  // C8-SFW-like heavy carbine: long handguard, heavy barrel, fixed stock.
  sfw() {
    const m = new Model('sfw'), hw = 0.025;
    arUpper(m, { z0: 0.15, z1: -0.15, top: 0.034, ys: -0.004, hw });
    rail(m, 0.034, 0.142, -0.148);
    arLower(m, { z0: 0.135, z1: -0.12, ys: -0.004, yb: -0.034, hw, mz: -0.06, md: 0.05, yw: -0.046, tz: 0 });
    slotHandguard(m, { z0: -0.15, z1: -0.45, top: 0.032, bottom: -0.026, hw: 0.027, barrelY: 0.012, nslots: 7 });
    barrel(m, 0.012, -0.12, -0.57, 0.0115, { steps: 1 });
    gasSystem(m, 0.012, -0.42, -0.16);
    flashHider(m, 0.012, -0.61, 0.04, 0.0135);
    grip(m, 0.028, -0.03, { len: 0.1, depth: 0.044, w: 0.032, a: 0.3 });
    magazine(m, -0.06, -0.03, { h: 0.13, d: 0.05, w: 0.026, bend: 0.1, ribs: 3, window: true });
    // Fixed stock: a solid tapered body with a cheek line and a butt pad.
    lathe(m, 'steel', [[0.006, -0.139], [0.0165, -0.139], [0.0165, -0.129], [0.006, -0.129]], { y: 0.012, seg: 12 });
    sideC(m, 'shell', [[0.135, 0.022], [0.15, 0.03, 0.006], [0.38, 0.026, 0.006], [0.385, -0.06, 0.006], [0.36, -0.064, 0.01], [0.2, -0.03, 0.02], [0.135, -0.008]], 0.042, { holes: [slot(0.33, -0.022, 0.05, 0.018)], bevel: 0.006 });
    sideC(m, 'rubber', [[0.383, 0.03, 0.004], [0.4, 0.032, 0.005], [0.4, -0.066, 0.005], [0.383, -0.064, 0.003]], 0.046, { bevel: 0.004 });
    swivel(m, -hw - 0.006, -0.01, 0.17);
    return { m, anchors: { muzzle: [0.012, -0.612], top: 0.034 } };
  },
  // Scorpion-like angular SMG: long top rail, skeleton side-folding stock, curved magazine.
  evo() {
    const m = new Model('evo'), hw = 0.023;
    // Upper: angular top with a long rail, the cocking slot and port.
    sideC(m, 'finish', [[0.15, -0.012], [0.15, 0.026, 0.006], [0.14, 0.032], [-0.2, 0.032], [-0.26, 0.026, 0.006], [-0.26, 0.0, 0.004], [-0.15, -0.012]], hw * 2, { bevel: 0.0022 });
    rail(m, 0.032, 0.142, -0.25);
    port(m, hw, 0.01, 0.0, 0.042, 0.014, { cover: false });
    side(m, 'dark', slot(-0.06, 0.022, 0.16, 0.004), -hw - 0.0003, -hw + 0.0008, { bevel: 0 });
    // Cocking handle on the left at the front of the slot.
    side(m, 'polymer', [[-0.13, 0.017, 0.002], [-0.13, 0.027, 0.002], [-0.115, 0.027, 0.002], [-0.115, 0.017, 0.002]], -hw - 0.012, -hw + 0.001, { bevel: 0.0015 });
    // Polymer lower with the magazine well and a big trigger guard.
    sideC(m, 'shell', [[0.12, -0.012], [0.12, -0.05, 0.006], [0.1, -0.058], [-0.02, -0.058], [-0.03, -0.072, 0.003], [-0.085, -0.072, 0.003], [-0.1, -0.055, 0.004], [-0.1, -0.012]], hw * 2 - 0.002, { bevel: 0.003 });
    sideC(m, 'polymer', [[0.035, -0.056], [0.035, -0.088, 0.008], [-0.03, -0.088, 0.01], [-0.032, -0.066]], 0.008, { holes: [[[0.029, -0.06], [0.029, -0.083, 0.006], [-0.024, -0.083, 0.006], [-0.026, -0.066]]], bevel: 0.0014 });
    triggerGroup(m, -0.056, 0.0, hw - 0.001, { guard: false });
    // Ribbed front handguard under the barrel.
    sideC(m, 'shell', [[-0.1, -0.012], [-0.1, -0.03, 0.004], [-0.26, -0.026, 0.006], [-0.26, 0.0]], hw * 2 - 0.004, { holes: slots(-0.11, -0.25, -0.012, 4, 0.022, 0.008), bevel: 0.0025 });
    barrel(m, 0.008, -0.25, -0.36, 0.0075, { steps: 1 });
    lathe(m, 'steel', [[0.006, 0.36], [0.0115, 0.36], [0.012, 0.362], [0.012, 0.382], [0.0105, 0.385], [0.005, 0.385], [0.005, 0.36]], { y: 0.008, seg: 22 });
    for (let i = 0; i < 3; i++) rbox(m, 'dark', 0.026, 0.0035, 0.004, 0, 0.008, -0.366 - i * 0.006, { r: 0.0015, bevel: 0.0003 });
    grip(m, 0.05, -0.05, { len: 0.1, depth: 0.042, w: 0.031, a: 0.32 });
    magazine(m, -0.055, -0.045, { h: 0.18, d: 0.048, w: 0.024, bend: 0.22, ribs: 2, window: true });
    // Skeleton stock: two flat struts and a pad, hinged at the back of the receiver.
    for (const y of [0.006, -0.046]) sideC(m, 'steel', rect(0.25, y, 0.2, 0.012, 0.004), 0.01, { holes: [slot(0.25, y, 0.15, 0.004)], bevel: 0.0015 });
    sideC(m, 'shell', [[0.34, 0.018, 0.004], [0.36, 0.02, 0.006], [0.36, -0.066, 0.006], [0.34, -0.062, 0.004]], 0.032, { bevel: 0.004 });
    pin(m, 'steel', 0.004, 0.014, 0, -0.02, 0.152, 'x', 14);
    return { m, anchors: { muzzle: [0.008, -0.385], top: 0.032 } };
  },
  // F2-like bullpup: one long body, magazine behind the grip, carry rail on top, big guard.
  bullpup() {
    const m = new Model('bullpup'), hw = 0.025;
    sideC(m, 'finish', [[0.31, -0.05], [0.31, 0.02, 0.012], [0.26, 0.032, 0.02], [-0.18, 0.032], [-0.27, 0.02, 0.01], [-0.4, 0.018, 0.006], [-0.4, -0.02, 0.006], [-0.3, -0.026, 0.006], [-0.18, -0.03], [-0.05, -0.052, 0.01], [0.05, -0.052], [0.05, -0.036], [0.16, -0.036], [0.16, -0.05], [0.3, -0.054, 0.01]],
      hw * 2, { holes: [slot(-0.33, -0.004, 0.08, 0.012)], bevel: 0.004 });
    // Carry handle with its rail.
    sideC(m, 'finish', [[0.06, 0.03], [0.06, 0.05, 0.004], [0.05, 0.06], [-0.16, 0.06], [-0.17, 0.05, 0.004], [-0.17, 0.03]], 0.03, { holes: [slot(-0.055, 0.04, 0.17, 0.01)], bevel: 0.003 });
    rail(m, 0.06, 0.05, -0.155, { w: 0.02 });
    // The big trigger guard enclosing the hand (one piece with the grip).
    sideC(m, 'shell', [[-0.07, -0.05], [-0.07, -0.16, 0.012], [-0.24, -0.15, 0.015], [-0.25, -0.03, 0.006]], 0.036, { holes: [[[-0.085, -0.055], [-0.088, -0.14, 0.01], [-0.215, -0.13, 0.012], [-0.225, -0.05, 0.006]]], bevel: 0.006 });
    grip(m, -0.14, -0.05, { len: 0.1, depth: 0.044, w: 0.032, a: 0.25, grooves: false });
    triggerGroup(m, -0.05, -0.16, hw, { guard: false });
    port(m, hw, 0.0, 0.12, 0.045, 0.016, { cover: false });
    for (const z of [0.0, 0.2]) for (const sx of [-1, 1]) screw(m, sx, sx * hw, -0.02, z, 0.0025);
    barrel(m, 0.01, -0.3, -0.52, 0.0085, { steps: 1 });
    flashHider(m, 0.01, -0.55, 0.035, 0.0125);
    magazine(m, 0.1, -0.045, { h: 0.12, d: 0.055, w: 0.026, bend: 0.12, ribs: 3, window: true });
    sideC(m, 'rubber', [[0.31, 0.02, 0.008], [0.332, 0.02, 0.008], [0.332, -0.054, 0.008], [0.31, -0.054, 0.006]], 0.052, { bevel: 0.005 });
    swivel(m, -hw - 0.006, -0.03, 0.25);
    return { m, anchors: { muzzle: [0.01, -0.552], top: 0.06 } };
  },
  // SMG-11-like machine pistol: tiny boxy receiver, magazine in the grip, wire stock.
  machinepistol() {
    const m = new Model('machinepistol'), hw = 0.02;
    smgReceiver(m, { z0: 0.1, z1: -0.1, top: 0.035, yb: -0.035, hw, portZ: 0.0, flutes: 1 });
    rail(m, 0.035, 0.09, -0.09);
    barrel(m, 0.01, -0.09, -0.14, 0.008, { steps: 0 });
    lathe(m, 'steel', [[0.005, 0.14], [0.012, 0.14], [0.013, 0.142], [0.013, 0.156], [0.011, 0.158], [0.005, 0.158], [0.005, 0.14]], { y: 0.01, seg: 22 });
    // Front strap / handstop under the muzzle.
    sideC(m, 'shell', [[-0.05, -0.035], [-0.05, -0.084, 0.008], [-0.095, -0.08, 0.01], [-0.1, -0.035]], 0.03, { bevel: 0.005 });
    // Grip with the magazine inside and the guard.
    grip(m, 0.012, -0.034, { len: 0.11, depth: 0.044, w: 0.034, a: 0.15, grooves: false });
    triggerGroup(m, -0.035, -0.02, hw);
    magazine(m, 0.03, -0.1, { h: 0.11, d: 0.034, w: 0.024, ribs: 1, rake: 0.15 });
    wireStock(m, { z0: 0.02, z1: 0.18, y: 0.0, xb: 0.022, plateH: 0.05, plateY: -0.02 });
    return { m, anchors: { muzzle: [0.01, -0.158], top: 0.035 } };
  },
  // AK-12-like rifle: stamped receiver, ribbed dust cover, gas tube, curved magazine.
  ak() {
    const m = new Model('ak'), hw = 0.025;
    sideC(m, 'finish', [[0.17, -0.035], [0.17, 0.03, 0.004], [0.16, 0.034], [-0.17, 0.034], [-0.17, -0.02], [-0.11, -0.035, 0.006]], hw * 2, { bevel: 0.002 });
    // Dimples and rivets on the receiver sides.
    for (const sx of [-1, 1]) { for (const z of [-0.12, -0.04, 0.05, 0.11]) screw(m, sx, sx * hw, -0.024, z, 0.0016); side(m, 'dark', rect(-0.09, -0.012, 0.02, 0.008, 0.004), sx > 0 ? hw - 0.0005 : -hw - 0.0002, sx > 0 ? hw + 0.0002 : -hw + 0.0005, { bevel: 0 }); }
    // Dust cover: a ribbed arch on top, with the rail.
    section(m, 'finish', [[-0.024, 0.033], [0.024, 0.033], [0.022, 0.039, 0.004], [-0.022, 0.039, 0.004]], -0.13, 0.17, { bevel: 0.001 });
    for (let z = 0.14; z > -0.1; z -= 0.04) section(m, 'finish', [[-0.0245, 0.032], [0.0245, 0.032], [0.0225, 0.0405, 0.004], [-0.0225, 0.0405, 0.004]], z - 0.008, z, { bevel: 0.0006 });
    rail(m, 0.04, 0.13, -0.11);
    port(m, hw, 0.012, 0.0, 0.07, 0.016, { cover: false });
    // Charging handle on the right.
    rod(m, 'steel', 0.0045, 0.02, 0, { seg: 14 }).rotateY(Math.PI / 2).translate(hw, 0.016, -0.04);
    // Safety lever (long, right side).
    side(m, 'steel', [[0.12, 0.002, 0.003], [0.12, -0.008, 0.003], [-0.03, -0.004, 0.002], [-0.03, 0.002, 0.002]], hw, hw + 0.002, { bevel: 0.0006 });
    // Handguard: ribbed polymer lower and the gas tube on top.
    sideC(m, 'shell', [[-0.16, 0.022], [-0.16, -0.025, 0.006], [-0.36, -0.022, 0.008], [-0.36, 0.022]], 0.05, { holes: slots(-0.17, -0.35, -0.003, 4, 0.035, 0.012), bevel: 0.005 });
    rod(m, 'finish', 0.012, -0.16, -0.37, { y: 0.045, chamfer: 0.002 });
    for (let z = -0.19; z > -0.35; z -= 0.035) rbox(m, 'dark', 0.004, 0.006, 0.012, 0, 0.056, z, { r: 0.002, bevel: 0.0004 });
    rail(m, 0.057, -0.18, -0.34, { w: 0.016 });
    barrel(m, 0.01, -0.17, -0.55, 0.009, { steps: 2 });
    // Gas block with the front sight base.
    sideC(m, 'steel', [[-0.37, 0.058, 0.004], [-0.4, 0.058, 0.004], [-0.4, -0.004, 0.004], [-0.37, -0.004, 0.004]], 0.026, { holes: [circle(-0.385, 0.045, 0.006)], bevel: 0.002 });
    brake(m, 0.01, -0.6, 0.05, 0.0115, { ports: 3 });
    grip(m, 0.048, -0.03, { len: 0.1, depth: 0.044, w: 0.032, a: 0.32 });
    triggerGroup(m, -0.035, 0.005, hw);
    magazine(m, -0.06, -0.03, { h: 0.19, d: 0.055, w: 0.028, bend: 0.36, ribs: 2 });
    // Skeleton stock: a side-folding frame with cheek riser and pad.
    sideC(m, 'shell', [[0.17, 0.026], [0.17, -0.046], [0.37, -0.05, 0.01], [0.4, -0.06, 0.005], [0.4, 0.028, 0.006], [0.25, 0.024, 0.01]], 0.03, { holes: [[[0.19, 0.012], [0.19, -0.034, 0.008], [0.37, -0.038, 0.01], [0.37, 0.012, 0.01]]], bevel: 0.005 });
    sideC(m, 'shell', rect(0.3, 0.033, 0.1, 0.016, 0.006), 0.03, { bevel: 0.005 });
    sideC(m, 'rubber', [[0.398, 0.03, 0.004], [0.41, 0.03, 0.004], [0.41, -0.064, 0.004], [0.398, -0.062, 0.003]], 0.04, { bevel: 0.004 });
    return { m, anchors: { muzzle: [0.01, -0.6], top: 0.044 } };
  },
  // MP5K-like compact SMG: no stock, vertical foregrip, cocking tube, curved magazine.
  compact() {
    const m = new Model('compact'), hw = 0.022;
    smgReceiver(m, { z0: 0.13, z1: -0.13, top: 0.035, yb: -0.035, hw, portZ: 0.02 });
    rail(m, 0.035, 0.11, -0.11);
    // Cocking tube over the barrel with the handle slot.
    rod(m, 'finish', 0.0105, -0.12, -0.24, { y: 0.025, chamfer: 0.002 });
    side(m, 'dark', slot(-0.18, 0.025, 0.07, 0.004), -0.0108, -0.006, { bevel: 0 });
    rbox(m, 'steel', 0.012, 0.006, 0.008, -0.014, 0.027, -0.16, { r: 0.002, bevel: 0.0008 });
    barrel(m, 0.0, -0.12, -0.2, 0.0085, { steps: 0 });
    lathe(m, 'steel', [[0.006, 0.195], [0.0125, 0.195], [0.0135, 0.198], [0.0135, 0.212], [0.0115, 0.215], [0.006, 0.215], [0.006, 0.195]], { y: 0.0, seg: 22 });
    // Front block joining tube and barrel.
    sideC(m, 'finish', rect(-0.235, 0.012, 0.018, 0.04, 0.006), 0.026, { holes: [circle(-0.235, 0.0, 0.006)], bevel: 0.002 });
    foregrip(m, -0.13, -0.035, { len: 0.085, r: 0.014 });
    grip(m, 0.04, -0.034, { len: 0.1, depth: 0.044, w: 0.032, a: 0.27, grooves: false });
    triggerGroup(m, -0.035, 0.02, hw);
    magazine(m, -0.04, -0.04, { h: 0.13, d: 0.04, w: 0.024, bend: 0.25, ribs: 2 });
    // End cap with a sling loop.
    sideC(m, 'shell', rect(0.14, 0.0, 0.02, 0.05, 0.008), 0.04, { bevel: 0.006 });
    swivel(m, 0, 0.0, 0.158, 0.009);
    return { m, anchors: { muzzle: [0.0, -0.215], top: 0.035 } };
  },
  // MP7-like PDW: magazine in the grip, folding foregrip, telescoping stock.
  pdw() {
    const m = new Model('pdw'), hw = 0.021;
    sideC(m, 'finish', [[0.125, -0.02], [0.125, 0.03, 0.008], [0.11, 0.035], [-0.11, 0.035], [-0.125, 0.026, 0.006], [-0.125, -0.012, 0.006], [-0.1, -0.03, 0.006], [0.0, -0.03], [0.02, -0.036, 0.004], [0.11, -0.036, 0.004]],
      hw * 2, { bevel: 0.003 });
    rail(m, 0.035, 0.115, -0.115);
    for (const sx of [-1, 1]) side(m, 'finish', slot(-0.05, 0.012, 0.09, 0.008), sx > 0 ? hw - 0.0004 : -hw - 0.0012, sx > 0 ? hw + 0.0012 : -hw + 0.0004, { bevel: 0.0005 });
    port(m, hw, 0.01, 0.0, 0.035, 0.012, { cover: false });
    // Side rails on the front.
    for (const sx of [-1, 1]) { const g = section(m, 'polymer', [[-0.007, -0.003], [0.007, -0.003], [0.007, 0.003], [-0.007, 0.003]], -0.12, -0.07, { bevel: 0.0008 }); g.rotateZ(sx * Math.PI / 2).translate(sx * (hw + 0.002), 0.008, 0); }
    barrel(m, 0.008, -0.12, -0.188, 0.0075, { steps: 0 });
    lathe(m, 'steel', [[0.005, 0.185], [0.011, 0.185], [0.012, 0.188], [0.012, 0.204], [0.0105, 0.207], [0.005, 0.207], [0.005, 0.185]], { y: 0.008, seg: 22 });
    grip(m, 0.0, -0.034, { len: 0.11, depth: 0.044, w: 0.034, a: 0.12, grooves: false });
    triggerGroup(m, -0.034, -0.02, hw);
    magazine(m, 0.022, -0.11, { h: 0.1, d: 0.036, w: 0.026, ribs: 1, rake: 0.12 });
    // Folding foregrip (flat paddle) at an angle.
    const fg = sideC(m, 'shell', [[0.0, 0.0], [0.0, -0.06, 0.008], [-0.03, -0.06, 0.008], [-0.03, 0.0]], 0.026, { bevel: 0.005 });
    fg.applyMatrix4(new THREE.Matrix4().makeRotationX(-0.2)).translate(0, -0.03, -0.075);
    pin(m, 'steel', 0.004, 0.03, 0, -0.033, -0.09, 'x', 14);
    // Telescoping stock bars and a butt plate.
    wireStock(m, { z0: 0.08, z1: 0.24, y: 0.0, xb: 0.016, plateH: 0.06, plateY: -0.01, r: 0.004 });
    return { m, anchors: { muzzle: [0.008, -0.207], top: 0.035 } };
  },
  // T-5-like SMG: square receiver, shrouded barrel, long stick magazine, vertical foregrip.
  smg() {
    const m = new Model('smg'), hw = 0.024;
    smgReceiver(m, { z0: 0.12, z1: -0.12, top: 0.0375, yb: -0.0375, hw, portZ: 0.02 });
    rail(m, 0.0375, 0.11, -0.115);
    shroud(m, 0.01, -0.115, -0.225, 0.017, { holes: 3 });
    grip(m, 0.03, -0.037, { len: 0.1, depth: 0.044, w: 0.032, a: 0.25 });
    triggerGroup(m, -0.037, 0.0, hw);
    magazine(m, -0.06, -0.03, { h: 0.195, d: 0.034, w: 0.024, ribs: 1, window: true });
    // Mag well collar.
    sideC(m, 'finish', rect(-0.06, -0.042, 0.046, 0.016, 0.004), 0.03, { bevel: 0.002 });
    foregrip(m, -0.12, -0.037, { len: 0.07, r: 0.013 });
    // Folded stock: arms along the sides and the butt under the receiver.
    for (const sx of [-1, 1]) side(m, 'steel', rect(0.135, -0.012, 0.03, 0.05, 0.006), sx > 0 ? hw : -hw - 0.006, sx > 0 ? hw + 0.006 : -hw, { holes: [slot(0.135, -0.012, 0.012, 0.03)], bevel: 0.002 });
    sideC(m, 'steel', rect(0.12, -0.044, 0.13, 0.01, 0.004), 0.04, { holes: [slot(0.12, -0.044, 0.09, 0.004)], bevel: 0.002 });
    return { m, anchors: { muzzle: [0.01, -0.225], top: 0.0375 } };
  },
  // G8A1-like LMG: big stamped receiver, feed cover, ventilated shroud, drum-box magazine.
  lmg() {
    const m = new Model('lmg'), hw = 0.035;
    sideC(m, 'finish', [[0.2, -0.045], [0.2, 0.04, 0.008], [0.19, 0.045], [-0.2, 0.045], [-0.2, -0.03], [-0.17, -0.045, 0.008]], hw * 2, { bevel: 0.003 });
    for (const sx of [-1, 1]) for (const z of [-0.15, -0.05, 0.08, 0.16]) screw(m, sx, sx * hw, -0.03, z, 0.0022);
    // Feed cover with ribs and its latch.
    sideC(m, 'finish', [[0.08, 0.044], [0.08, 0.066, 0.006], [0.07, 0.075], [-0.04, 0.075], [-0.04, 0.044]], hw * 2, { bevel: 0.0025 });
    for (let z = 0.06; z > -0.03; z -= 0.022) section(m, 'finish', [[-hw - 0.0005, 0.05], [hw + 0.0005, 0.05], [hw + 0.0005, 0.058], [-hw - 0.0005, 0.058]], z - 0.004, z, { bevel: 0.0005 });
    rail(m, 0.075, 0.075, -0.035);
    // Carry handle.
    sideC(m, 'shell', [[-0.05, 0.045], [-0.05, 0.1, 0.01], [-0.13, 0.1, 0.01], [-0.13, 0.045]], 0.016, { holes: [[[-0.06, 0.05], [-0.06, 0.088, 0.006], [-0.12, 0.088, 0.006], [-0.12, 0.05]]], bevel: 0.004 });
    port(m, hw, 0.0, 0.0, 0.07, 0.02);
    // Ventilated shroud with oval holes, heavy barrel, flash hider, folded bipod.
    lathe(m, 'finish', [[0.01, 0.2], [0.024, 0.2], [0.024, 0.44], [0.018, 0.445], [0.01, 0.445], [0.01, 0.2]], { y: 0.005, seg: 24 });
    for (let i = 0; i < 6; i++) for (const a of [-0.9, 0, 0.9, Math.PI]) {
      const g = rbox(m, 'dark', 0.002, 0.008, 0.022, 0, 0.0234, 0, { r: 0.004, bevel: 0.0003 });
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ(a)).translate(0, 0.005, -0.23 - i * 0.035);
    }
    barrel(m, 0.005, -0.44, -0.535, 0.012, { steps: 0 });
    flashHider(m, 0.005, -0.565, 0.035, 0.015);
    for (const sx of [-1, 1]) { rod(m, 'steel', 0.0045, -0.25, -0.43, { x: sx * 0.017, y: -0.03 }); rbox(m, 'rubber', 0.01, 0.01, 0.014, sx * 0.017, -0.03, -0.43, { r: 0.004, bevel: 0.002 }); }
    rbox(m, 'steel', 0.05, 0.014, 0.02, 0, -0.022, -0.24, { r: 0.004, bevel: 0.002 });
    grip(m, 0.07, -0.044, { len: 0.1, depth: 0.044, w: 0.034, a: 0.3 });
    triggerGroup(m, -0.045, 0.03, hw);
    // Box-drum magazine: twin round drums joined by a feed tower, with steel end caps.
    m.in('mag', () => {
      sideC(m, 'shell', rect(-0.05, -0.065, 0.06, 0.05, 0.008), 0.05, { bevel: 0.005 });
      const drum = lathe(m, 'shell', [[0, 0.002], [0.042, 0.002], [0.047, 0.007], [0.047, 0.05], [0.043, 0.055], [0, 0.055]], { axis: 'x', seg: 32 });
      drum.translate(0, -0.105, -0.05); mirror(m, drum, 'shell');
      const cap = lathe(m, 'steel', [[0, 0.054], [0.026, 0.054], [0.028, 0.056], [0.028, 0.058], [0, 0.058]], { axis: 'x', seg: 24 });
      cap.translate(0, -0.105, -0.05); mirror(m, cap, 'steel');
      for (let k = 0; k < 6; k++) { const g = rbox(m, 'polymer', 0.05, 0.004, 0.012, 0.0285, 0, 0, { r: 0.002, bevel: 0.0008 }); g.translate(0, 0.045, 0).applyMatrix4(new THREE.Matrix4().makeRotationX(k / 6 * Math.PI * 2)).translate(0, -0.105, -0.05); mirror(m, g, 'polymer'); }
    });
    sideC(m, 'shell', [[0.2, 0.032], [0.2, -0.044], [0.39, -0.05, 0.01], [0.4, -0.055, 0.004], [0.4, 0.034, 0.004], [0.27, 0.036, 0.01]], 0.05, { holes: [slot(0.34, -0.008, 0.06, 0.02)], bevel: 0.006 });
    sideC(m, 'rubber', [[0.398, 0.036, 0.004], [0.414, 0.036, 0.004], [0.414, -0.058, 0.004], [0.398, -0.056, 0.003]], 0.054, { bevel: 0.004 });
    return { m, anchors: { muzzle: [0.005, -0.565], top: 0.075 } };
  },
};
