// Enhanced Graphics pack v5: detailed props for the match maps (original designs), built with the
// modelling kit and baked by tools/build-props.mjs. They replace the fitted boxes of furniture,
// cars and the like on High / Ultra; collision stays the box.
//
// Prop coordinates: the long side along z (-L/2..L/2), depth along x, y up from the floor (0).
// Each prop is made at a typical size (PROPS[name].size = [length z, height y, depth x]) and
// scaled to its box at runtime; 'bay' props (shelves, counters, benches, barriers, planters)
// are one unit repeated along the box's length instead, so books and doors never stretch.
import * as THREE from '../../vendor/three/three.module.min.js';
import { Model, side, section, lathe, capsule, rect } from './kit.mjs';

// a rounded box with its base at y (w across x, h up, d along z), optional rotation
function bx(m, role, w, h, d, x, y, z, { r = 0.012, rot = null } = {}) {
  const rr = Math.min(r, w * 0.45, h * 0.45, d * 0.45), bev = Math.min(rr * 0.6, 0.008);
  const g = side(m, role, rect(0, 0, d, h, rr), -w / 2, w / 2, { bevel: bev });
  if (rot) { g.rotateX(rot[0] || 0); g.rotateY(rot[1] || 0); g.rotateZ(rot[2] || 0); }
  g.translate(x, y + h / 2, z);
  return g;
}
// a deformed sphere (foliage, cushions of leaves)
function blob(m, role, r, x, y, z, { sx = 1, sy = 1, sz = 1, seed = 1, detail = 2, rough = 0.18 } = {}) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const off = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = p.getX(i).toFixed(4) + ',' + p.getY(i).toFixed(4) + ',' + p.getZ(i).toFixed(4);
    if (!off.has(k)) off.set(k, 1 + (rnd() - 0.5) * 2 * rough);
    const f = off.get(k);
    p.setXYZ(i, p.getX(i) * f * sx, p.getY(i) * f * sy, p.getZ(i) * f * sz);
  }
  g.translate(x, y, z);
  g.computeVertexNormals();
  return m.add(g, role);
}
const rng = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

function crate() {
  const m = new Model('crate');
  const W = 1.4, H = 1.2, L = 1.4, t = 0.035;
  bx(m, 'woodDark', W - 0.08, H - 0.06, L - 0.08, 0, 0.02, 0, { r: 0.01 });
  // planks on the four sides and the top, a frame round each face, diagonal braces
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) bx(m, i % 2 ? 'wood' : 'wood2', t, H / 6 - 0.012, L - 0.16, sx * (W / 2 - t / 2), i * H / 6 + 0.006, 0, { r: 0.006 });
    for (const sz of [-1, 1]) bx(m, 'woodDark', t * 1.6, H, 0.12, sx * (W / 2 - t * 0.3), 0, sz * (L / 2 - 0.06), { r: 0.008 });
    bx(m, 'woodDark', t * 1.6, 0.12, L - 0.2, sx * (W / 2 - t * 0.3), 0, 0, { r: 0.008 }); bx(m, 'woodDark', t * 1.6, 0.12, L - 0.2, sx * (W / 2 - t * 0.3), H - 0.12, 0, { r: 0.008 });
    const diag = Math.hypot(L - 0.24, H - 0.24);
    bx(m, 'woodDark', t * 1.5, 0.11, diag, sx * (W / 2 - t * 0.2), -0.055, 0, { r: 0.008, rot: [Math.atan2(H - 0.24, L - 0.24) * sx, 0, 0] }).translate(0, H / 2, 0);
  }
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 6; i++) bx(m, i % 2 ? 'wood2' : 'wood', W - 0.16, H / 6 - 0.012, t, 0, i * H / 6 + 0.006, sz * (L / 2 - t / 2), { r: 0.006 });
    for (const sx of [-1, 1]) bx(m, 'woodDark', 0.12, H, t * 1.6, sx * (W / 2 - 0.06), 0, sz * (L / 2 - t * 0.3), { r: 0.008 });
    bx(m, 'woodDark', W - 0.2, 0.12, t * 1.6, 0, 0, sz * (L / 2 - t * 0.3), { r: 0.008 }); bx(m, 'woodDark', W - 0.2, 0.12, t * 1.6, 0, H - 0.12, sz * (L / 2 - t * 0.3), { r: 0.008 });
  }
  for (let i = 0; i < 7; i++) bx(m, i % 2 ? 'wood' : 'wood2', W - 0.06, t, L / 7 - 0.012, 0, H - t, -L / 2 + (i + 0.5) * L / 7, { r: 0.006 });
  // steel corner brackets
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, H - 0.1]) bx(m, 'metal', 0.13, 0.1, 0.13, sx * (W / 2 - 0.055), y, sz * (L / 2 - 0.055), { r: 0.01 });
  return m;
}

function car() {
  const m = new Model('car');
  const L = 4.5, W = 1.86, wr = 0.34, wz = 1.42;
  // lower body: side profile with wheel arches
  const arch = (zc) => { const pts = []; for (let i = 0; i <= 10; i++) { const a = Math.PI * i / 10; pts.push([zc + Math.cos(a) * (wr + 0.07), 0.36 + Math.sin(a) * (wr + 0.07)]); } return pts; };
  const lower = [[-L / 2, 0.32, 0.12], [-L / 2 + 0.05, 0.78, 0.18], [-L / 2 + 0.95, 0.9, 0.3], [L / 2 - 0.5, 0.94, 0.25], [L / 2, 0.86, 0.14], [L / 2, 0.3, 0.1], ...arch(wz).map(([z, y]) => [z, y]).reverse().map(([z, y]) => [z, y]), ...arch(-wz).map(([z, y]) => [z, y]).reverse()];
  // keep the outline going round once: front bumper .. rear, then back along the bottom past both arches
  const prof = [[-L / 2, 0.32, 0.12], [-L / 2 + 0.05, 0.78, 0.18], [-L / 2 + 0.95, 0.9, 0.3], [L / 2 - 0.5, 0.94, 0.25], [L / 2, 0.86, 0.14], [L / 2, 0.3, 0.1]];
  for (const [z, y] of arch(wz)) prof.push([z, y]);
  for (const [z, y] of arch(-wz)) prof.push([z, y]);
  void lower;
  side(m, 'paint', prof, -W / 2, W / 2, { bevel: 0.05 });
  // greenhouse: glass, with a painted roof and pillars
  const cab = [[-0.95, 0.9], [-0.25, 1.38, 0.12], [0.85, 1.42, 0.12], [1.45, 0.93]];
  side(m, 'glass', cab, -W / 2 + 0.12, W / 2 - 0.12, { bevel: 0.03 });
  side(m, 'paint', [[-0.3, 1.36], [-0.22, 1.45, 0.1], [0.86, 1.48, 0.1], [0.92, 1.4]], -W / 2 + 0.14, W / 2 - 0.14, { bevel: 0.025 });
  for (const sx of [-1, 1]) bx(m, 'paint', 0.05, 0.44, 0.08, sx * (W / 2 - 0.115), 0.92, 0.32, { r: 0.02 });   // the door pillar
  // wheels: tyre, rim, hub
  for (const zc of [-wz, wz]) for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.13);
    lathe(m, 'tyre', [[0, -0.12], [wr - 0.06, -0.12], [wr, -0.09], [wr + 0.005, 0], [wr, 0.09], [wr - 0.06, 0.12], [0, 0.12]], { x, y: 0.36, z: zc, axis: 'x', seg: 24 });
    lathe(m, 'chrome', [[0, -0.125], [wr - 0.1, -0.125], [wr - 0.09, -0.13], [0, -0.13]].map(([r, t]) => [r, t * sx]), { x, y: 0.36, z: zc, axis: 'x', seg: 20 });
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; bx(m, 'chrome', 0.03, 0.04, wr - 0.12, x + sx * 0.12, 0.34, zc, { r: 0.01, rot: [a, 0, 0] }); }
  }
  // lights, bumpers, grille, mirrors, handles
  for (const sx of [-1, 1]) {
    bx(m, 'light', 0.36, 0.1, 0.06, sx * 0.6, 0.72, -L / 2 + 0.03, { r: 0.03 });
    bx(m, 'tail', 0.34, 0.1, 0.05, sx * 0.62, 0.78, L / 2 - 0.02, { r: 0.03 });
    bx(m, 'paint', 0.1, 0.08, 0.16, sx * (W / 2 + 0.03), 1.0, -0.75, { r: 0.03 });
    for (const z of [-0.2, 0.6]) bx(m, 'chrome', 0.03, 0.03, 0.14, sx * (W / 2 + 0.005), 0.86, z, { r: 0.012 });
  }
  bx(m, 'plastic', 0.9, 0.16, 0.04, 0, 0.46, -L / 2 - 0.01, { r: 0.02 });
  bx(m, 'plastic', W - 0.1, 0.14, 0.12, 0, 0.28, -L / 2 + 0.05, { r: 0.04 }); bx(m, 'plastic', W - 0.1, 0.14, 0.12, 0, 0.28, L / 2 - 0.05, { r: 0.04 });
  bx(m, 'dark', W - 0.3, 0.12, L - 1.6, 0, 0.12, 0, { r: 0.02 });
  return m;
}

function desk() {
  const m = new Model('desk');
  const L = 2.4, D = 1.2, top = 0.74;
  bx(m, 'wood', D, 0.04, L, 0, top, 0, { r: 0.012 });
  for (const sz of [-1, 1]) {
    bx(m, 'woodDark', D - 0.1, top - 0.02, 0.5, 0, 0.02, sz * (L / 2 - 0.3), { r: 0.01 });
    for (let i = 0; i < 3; i++) { bx(m, 'wood', 0.02, 0.2, 0.46, -(D / 2 - 0.05), 0.06 + i * 0.22, sz * (L / 2 - 0.3), { r: 0.006 }); bx(m, 'chrome', 0.03, 0.02, 0.14, -(D / 2 - 0.07), 0.17 + i * 0.22, sz * (L / 2 - 0.3), { r: 0.008 }); }
  }
  bx(m, 'woodDark', 0.02, 0.4, L - 1.2, D / 2 - 0.15, 0.32, 0, { r: 0.006 });
  // a monitor, a keyboard, a lamp and some papers
  bx(m, 'plastic', 0.2, 0.02, 0.25, 0.2, top + 0.04, 0.1, { r: 0.008 });
  bx(m, 'plastic', 0.04, 0.12, 0.05, 0.22, top + 0.06, 0.1, { r: 0.01 });
  bx(m, 'plastic', 0.04, 0.34, 0.56, 0.2, top + 0.16, 0.1, { r: 0.012 });
  bx(m, 'screen', 0.01, 0.3, 0.52, 0.177, top + 0.18, 0.1, { r: 0.004 });
  bx(m, 'plastic', 0.16, 0.025, 0.46, -0.12, top + 0.04, 0.1, { r: 0.008 });
  capsule(m, 'metal', [0.3, top + 0.04, -0.85], [0.25, top + 0.38, -0.8], 0.012, { seg: 10 });
  lathe(m, 'metal', [[0, 0], [0.09, 0.02], [0.05, 0.08], [0, 0.1]], { x: 0.22, y: top + 0.3, z: -0.78, axis: 'y', seg: 16 });
  lathe(m, 'metal', [[0, 0], [0.08, 0], [0.08, 0.02], [0, 0.02]], { x: 0.3, y: top + 0.04, z: -0.85, axis: 'y', seg: 16 });
  for (let i = 0; i < 3; i++) bx(m, 'paper', 0.3, 0.006, 0.21, -0.2 + i * 0.03, top + 0.04 + i * 0.006, -0.5 + i * 0.05, { r: 0.002, rot: [0, i * 0.2, 0] });
  return m;
}

function table() {
  const m = new Model('table');
  const L = 2.4, D = 1.2, H = 0.78;
  bx(m, 'wood', D, 0.05, L, 0, H - 0.05, 0, { r: 0.02 });
  bx(m, 'woodDark', D - 0.14, 0.1, L - 0.14, 0, H - 0.15, 0, { r: 0.01 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lathe(m, 'woodDark', [[0, 0], [0.035, 0], [0.03, 0.1], [0.045, 0.16], [0.03, 0.22], [0.032, H - 0.2], [0.04, H - 0.12], [0, H - 0.12]], { x: sx * (D / 2 - 0.08), y: 0, z: sz * (L / 2 - 0.08), axis: 'y', seg: 14 });
  lathe(m, 'glass', [[0, 0], [0.06, 0], [0.08, 0.1], [0.04, 0.22], [0.05, 0.28], [0, 0.28]], { y: H, axis: 'y', seg: 18 });
  return m;
}

function sofa() {
  const m = new Model('sofa');
  const L = 3, D = 1, H = 0.9;
  bx(m, 'fabric', D - 0.05, 0.3, L - 0.3, 0, 0.1, 0, { r: 0.05 });
  for (let i = 0; i < 3; i++) {
    bx(m, 'fabric2', D - 0.3, 0.18, (L - 0.4) / 3 - 0.02, -0.08, 0.38, -(L - 0.4) / 3 + i * (L - 0.4) / 3, { r: 0.07 });
    bx(m, 'fabric2', 0.22, 0.45, (L - 0.4) / 3 - 0.03, D / 2 - 0.2, 0.42, -(L - 0.4) / 3 + i * (L - 0.4) / 3, { r: 0.08, rot: [0, 0, 0.18] });
  }
  bx(m, 'fabric', 0.22, H - 0.12, L - 0.3, D / 2 - 0.11, 0.1, 0, { r: 0.06 });
  for (const sz of [-1, 1]) bx(m, 'fabric', D - 0.02, 0.62, 0.2, 0, 0.1, sz * (L / 2 - 0.1), { r: 0.08 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lathe(m, 'woodDark', [[0, 0], [0.025, 0], [0.035, 0.1], [0, 0.1]], { x: sx * (D / 2 - 0.1), y: 0, z: sz * (L / 2 - 0.12), axis: 'y', seg: 10 });
  bx(m, 'fabric3', 0.12, 0.32, 0.36, -0.05, 0.5, -0.9, { r: 0.08, rot: [0, 0.3, 0.2] });
  return m;
}

function bed() {
  const m = new Model('bed');
  const L = 2.6, W = 2.4, H = 0.75;   // length along z (head at -z), width across x
  bx(m, 'wood', W, 0.28, L - 0.08, 0, 0.06, 0.04, { r: 0.02 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(m, 'woodDark', 0.08, 0.08, 0.08, sx * (W / 2 - 0.05), 0, sz * (L / 2 - 0.08) + 0.04, { r: 0.01 });
  bx(m, 'wood', W, H, 0.08, 0, 0, -L / 2 + 0.04, { r: 0.03 });
  for (let i = 0; i < 6; i++) bx(m, 'woodDark', 0.07, 0.3, 0.03, -W / 2 + 0.3 + i * (W - 0.6) / 5, 0.38, -L / 2 + 0.085, { r: 0.01 });
  bx(m, 'mattress', W - 0.1, 0.22, L - 0.2, 0, 0.32, 0.06, { r: 0.07 });
  bx(m, 'fabric', W - 0.04, 0.12, L * 0.62, 0, 0.47, L * 0.18, { r: 0.06 });
  bx(m, 'fabric', 0.04, 0.32, L * 0.62, W / 2 - 0.02, 0.24, L * 0.18, { r: 0.02 }); bx(m, 'fabric', 0.04, 0.32, L * 0.62, -W / 2 + 0.02, 0.24, L * 0.18, { r: 0.02 });
  bx(m, 'fabric2', W - 0.04, 0.13, 0.24, 0, 0.47, L * 0.18 - L * 0.31, { r: 0.06 });
  for (const sx of [-1, 1]) bx(m, 'mattress', 0.8, 0.16, 0.42, sx * 0.52, 0.53, -L / 2 + 0.36, { r: 0.08 });
  return m;
}

function shelfBay() {
  const m = new Model('shelf');
  const L = 1, D = 0.8, H = 2, r = rng(7);
  for (const sz of [-1, 1]) bx(m, 'woodDark', D, H, 0.04, 0, 0, sz * (L / 2 - 0.02), { r: 0.008 });
  bx(m, 'woodDark', 0.02, H - 0.04, L - 0.06, D / 2 - 0.01, 0.02, 0, { r: 0.004 });
  const levels = [0.04, 0.45, 0.86, 1.27, 1.68];
  for (const y of levels) bx(m, 'wood', D - 0.02, 0.035, L - 0.06, 0, y, 0, { r: 0.006 });
  bx(m, 'wood', D, 0.04, L, 0, H - 0.04, 0, { r: 0.008 });
  for (const y of levels.slice(0, 4).concat([1.68])) {
    if (y > 1.6 && r() < 0.5) continue;
    let z = -L / 2 + 0.05;
    while (z < L / 2 - 0.08) {
      const t = 0.025 + r() * 0.04, h = 0.2 + r() * 0.14, d = 0.15 + r() * 0.08;
      if (r() < 0.08) { z += 0.06 + r() * 0.1; continue; }
      const lean = r() < 0.06 ? 0.25 : 0;
      bx(m, ['book1', 'book2', 'book3', 'book4'][(r() * 4) | 0], d, h, t, -D / 2 + 0.06 + d / 2, y + 0.035, z + t / 2, { r: 0.004, rot: [lean, 0, 0] });
      z += t + 0.002 + lean * 0.05;
    }
  }
  return m;
}

function counterBay() {
  const m = new Model('counter');
  const L = 1, D = 0.8, H = 1.0;
  bx(m, 'dark', D - 0.1, 0.1, L, 0.04, 0, 0, { r: 0.004 });
  bx(m, 'woodDark', D - 0.06, H - 0.14, L - 0.004, 0.02, 0.1, 0, { r: 0.004 });
  for (const sz of [-1, 1]) { bx(m, 'wood', 0.02, H - 0.2, L / 2 - 0.02, -(D / 2 - 0.02), 0.12, sz * L / 4, { r: 0.006 }); bx(m, 'chrome', 0.03, 0.14, 0.02, -(D / 2 - 0.04), 0.66, sz * (L / 4 - (L / 4 - 0.06)) , { r: 0.008 }); }
  bx(m, 'stone', D, 0.04, L, 0, H - 0.04, 0, { r: 0.01 });
  return m;
}

function benchBay() {
  const m = new Model('bench');
  const L = 1, D = 0.9, H = 1.0;
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) bx(m, 'metal', 0.05, H - 0.06, 0.05, sx * (D / 2 - 0.05), 0, sz * (L / 2 - 0.05), { r: 0.006 });
  bx(m, 'metal', D - 0.06, 0.04, L - 0.06, 0, 0.2, 0, { r: 0.006 });
  bx(m, 'wood', D, 0.06, L, 0, H - 0.06, 0, { r: 0.008 });
  bx(m, 'metalRed', 0.36, 0.22, 0.5, 0.1, 0.24, 0, { r: 0.02 });
  for (let i = 0; i < 3; i++) bx(m, 'dark', 0.02, 0.02, 0.4, 0.1 - 0.18, 0.28 + i * 0.06, 0, { r: 0.006 });
  capsule(m, 'metal', [-0.2, H, -0.2], [-0.2, H, 0.15], 0.015, { seg: 8 });
  bx(m, 'plastic', 0.06, 0.04, 0.14, -0.2, H, 0.22, { r: 0.015 });
  return m;
}

function barrierUnit() {
  const m = new Model('barrier');
  const L = 3, H = 1.1;
  const prof = [[-0.4, 0], [0.4, 0], [0.4, 0.08], [0.16, 0.33], [0.12, H, 0.03], [-0.12, H, 0.03], [-0.16, 0.33], [-0.4, 0.08]];
  section(m, 'concrete', prof, -L / 2 + 0.02, L / 2 - 0.02, { bevel: 0.015 });
  // red and white bands near the top, lifting loops, scrapes at the foot
  for (let i = 0; i < 6; i++) section(m, i % 2 ? 'white' : 'redPaint', [[-0.128, 0.84], [0.128, 0.84], [0.125, 0.98], [-0.125, 0.98]].map(([x, y]) => [x * 1.06, y]), -L / 2 + 0.04 + i * (L - 0.08) / 6, -L / 2 + 0.04 + (i + 1) * (L - 0.08) / 6 - 0.002, { bevel: 0.002 });
  for (const sz of [-1, 1]) lathe(m, 'metal', [[0.03, -0.012], [0.05, -0.012], [0.05, 0.012], [0.03, 0.012]], { y: H + 0.02, z: sz * 1.0, axis: 'x', seg: 14 });
  return m;
}

function planterUnit() {
  const m = new Model('planter');
  const L = 1.2, H = 0.9, W = 1.2, r = rng(11);
  bx(m, 'stone', W, H - 0.06, L - 0.01, 0, 0, 0, { r: 0.02 });
  bx(m, 'stone2', W + 0.06, 0.06, L + 0.04, 0, H - 0.06, 0, { r: 0.015 });
  bx(m, 'soil', W - 0.12, 0.04, L - 0.12, 0, H - 0.07, 0, { r: 0.01 });
  for (let i = 0; i < 7; i++) {
    const x = (r() - 0.5) * (W - 0.4), z = (r() - 0.5) * (L - 0.4), s = 0.16 + r() * 0.12;
    blob(m, r() < 0.5 ? 'leaf' : 'leaf2', s, x, H + s * 0.55, z, { sy: 0.8 + r() * 0.5, seed: i * 31 + 7, detail: 1, rough: 0.25 });
    if (r() < 0.6) for (let k = 0; k < 3; k++) blob(m, 'flower', 0.03, x + (r() - 0.5) * s, H + s * 1.1 + r() * 0.05, z + (r() - 0.5) * s, { seed: k + i * 7, detail: 0 });
  }
  return m;
}

function fountain() {
  const m = new Model('fountain');
  lathe(m, 'stone', [[0, 0], [1.3, 0], [1.3, 0.55], [1.22, 0.62], [1.15, 0.55], [1.15, 0.15], [0, 0.15]], { axis: 'y', seg: 40 });
  lathe(m, 'water', [[0, 0.42], [1.16, 0.42], [1.16, 0.44], [0, 0.44]], { axis: 'y', seg: 40 });
  lathe(m, 'stone2', [[0, 0.15], [0.2, 0.15], [0.14, 0.4], [0.12, 0.7], [0.5, 0.75], [0.55, 0.8], [0.5, 0.86], [0.1, 0.86], [0.08, 0.95], [0.12, 1.0], [0, 1.02]], { axis: 'y', seg: 28 });
  lathe(m, 'water', [[0, 0.8], [0.48, 0.8], [0.48, 0.82], [0, 0.82]], { axis: 'y', seg: 28 });
  return m;
}

function tree() {
  const m = new Model('tree');
  const r = rng(5);
  lathe(m, 'bark', [[0, 0], [0.26, 0], [0.2, 0.25], [0.17, 1.2], [0.14, 2.2], [0.1, 3.0], [0, 3.2]], { axis: 'y', seg: 12 });
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + r() * 0.6, y = 1.7 + r() * 1.0, l = 0.9 + r() * 0.6;
    capsule(m, 'bark', [0, y, 0], [Math.cos(a) * l, y + 0.6 + r() * 0.5, Math.sin(a) * l], 0.07, { seg: 8, rb: 0.035 });
  }
  const crowns = [[0, 3.6, 0, 1.4], [0.9, 3.1, 0.3, 1.0], [-0.8, 3.2, -0.4, 1.05], [0.2, 3.0, -0.95, 0.95], [-0.3, 3.1, 0.95, 0.95], [0.1, 4.4, 0.1, 0.95], [0.75, 4.0, -0.5, 0.8], [-0.7, 4.0, 0.5, 0.8]];
  crowns.forEach(([x, y, z, s], i) => blob(m, i % 3 ? 'leaf' : 'leaf2', s, x, y, z, { sy: 0.85, seed: i * 13 + 3, detail: 2, rough: 0.22 }));
  return m;
}

function bush() {
  const m = new Model('bush');
  [[0, 0.42, 0, 0.62], [0.42, 0.35, 0.18, 0.46], [-0.4, 0.34, -0.15, 0.48], [0.1, 0.3, -0.45, 0.42], [-0.15, 0.32, 0.45, 0.42]]
    .forEach(([x, y, z, s], i) => blob(m, i % 2 ? 'leaf2' : 'leaf', s, x, y, z, { sy: 0.75, seed: i * 7 + 2, detail: 2, rough: 0.25 }));
  return m;
}

// size: the typical box [length (z), height, depth (x)] the model is made for; bay: repeated.
export const PROPS = {
  crate: { L: 0.35, size: [1.4, 1.2, 1.4], build: crate },
  car: { L: 0.3, size: [4.5, 1.5, 2.0], build: car },
  desk: { L: 0.3, size: [2.4, 1.1, 1.2], build: desk },
  table: { L: 0.3, size: [2.4, 0.8, 1.2], build: table },
  sofa: { L: 0.25, size: [3, 0.9, 1], build: sofa },
  bed: { L: 0.3, size: [2.6, 0.75, 2.4], build: bed },
  shelf: { L: 0.4, size: [1, 2, 0.8], bay: true, build: shelfBay },
  counter: { L: 0.3, size: [1, 1, 0.8], bay: true, build: counterBay },
  bench: { L: 0.3, size: [1, 1, 0.9], bay: true, build: benchBay },
  barrier: { L: 0.3, size: [3, 1.1, 0.8], bay: true, build: barrierUnit },
  planter: { L: 0.4, size: [1.2, 0.9, 1.2], bay: true, build: planterUnit },
  fountain: { L: 0.3, size: [2.6, 1, 2.6], build: fountain },
  tree: { L: 0.6, size: [3, 5.4, 3], build: tree },
  bush: { L: 0.5, size: [1.6, 0.9, 1.6], build: bush },
};
// Material per role (sRGB colour, roughness, metalness); 'paint' is tinted per car.
export const PROP_ROLES = {
  wood: [0xa07448, 0.6, 0], wood2: [0x8c6238, 0.65, 0], woodDark: [0x5e3f26, 0.55, 0], fabric: [0x6b5a4a, 0.95, 0], fabric2: [0x7c6a58, 0.95, 0], fabric3: [0xb8a07a, 0.95, 0],
  mattress: [0xe6e2d8, 0.9, 0], paper: [0xf2efe6, 0.8, 0], metal: [0x8a9096, 0.45, 0.85], metalRed: [0xa83a2a, 0.5, 0.4], chrome: [0xd8dce0, 0.18, 1], glass: [0x1a2430, 0.08, 0.2],
  screen: [0x0a0e14, 0.12, 0], plastic: [0x26282c, 0.6, 0], dark: [0x141516, 0.8, 0], paint: [0xe8e8e8, 0.32, 0.25], tyre: [0x1a1a1c, 0.88, 0], light: [0xf0ead8, 0.1, 0],
  tail: [0x9a1810, 0.2, 0], stone: [0xa49c8e, 0.85, 0], stone2: [0xb8b0a2, 0.8, 0], concrete: [0xc8c2b8, 0.9, 0], redPaint: [0xc0381e, 0.6, 0], white: [0xe8e4dc, 0.6, 0],
  soil: [0x4a3626, 0.98, 0], leaf: [0x4a7a34, 0.75, 0], leaf2: [0x3a6428, 0.75, 0], flower: [0xd86a8a, 0.6, 0], bark: [0x5a4232, 0.95, 0], water: [0x3a7aa0, 0.05, 0],
  book1: [0x8a2a24, 0.7, 0], book2: [0x2a4a7a, 0.7, 0], book3: [0x3a6a42, 0.7, 0], book4: [0xb89a50, 0.7, 0],
};
