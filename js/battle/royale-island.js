// Blacktide Island, rebuilt as a real island: sea all round (deep water drowns you; the shallows and
// beach do not), a winding river across the middle with three bridges, a low town in the west full of
// houses, walls and market stalls (plenty of cover), and high ground in the east: two terraces with
// cliffs, open and exposed, a lighthouse on top. A jetty runs out from the town.
// Everything structural sits on the 3.2 m build grid.
import { BoxGeometry, BufferGeometry, ConeGeometry, PlaneGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace, ShaderMaterial, Mesh, Color } from '../../vendor/three/three.module.min.js?v=9ab81ba-mwx0bk9g';
import { wallPanels, duskSky } from '../scene/range-tex.js?v=9ab81ba-mwx0bk9g';
import { mulberry32 } from '../core/prng.js?v=9ab81ba-mwx0bk9g';
import { gfxLevel } from '../render/quality.js?v=9ab81ba-mwx0bk9g';
import { windU } from '../scene/smoke.js?v=9ab81ba-mwx0bk9g';
import { surface } from '../render/surfaces.js?v=9ab81ba-mwx0bk9g';
import { MAPS } from './maps.js?v=9ab81ba-mwx0bk9g';

const G = 3.2, T = 0.4;
const cellC = (k) => (k + 0.5) * G;                       // the centre of grid cell k
const box = (x, z, w, d, h, kind = 'wall', y = 0) => ({ x, z, w, d, h, kind, y });
const rnd = mulberry32(4401);
const layout = [], chests = [], houses = [];

/* ---------- the land: coast, river, sea ---------- */
// Land is inside a wobbly oval; the river winds north to south a little east of the middle.
const coast = (x, z) => (x / 71) ** 2 + (z / 55) ** 2 + 0.05 * Math.sin(x * 0.11 + z * 0.07) + 0.04 * Math.cos(z * 0.13 - x * 0.05) < 1;
export const riverX = (z) => 6 + 7 * Math.sin(z / 17);
const BRIDGES = [-33.6, 0, 30.4];                          // (z of each bridge, a cell row)
const JETTY = { x0: -78, x1: -60, z: 12.8 };               // the town's jetty, out west into the sea
const inRiver = (x, z) => Math.abs(x - riverX(z)) < 3.4 && Math.abs(z) < 60;
const onBridge = (x, z) => BRIDGES.some((b) => Math.abs(z - b - G / 2) < G) && Math.abs(x - riverX(z)) < 6.5;
const onJetty = (x, z) => x > JETTY.x0 - 1 && x < JETTY.x1 + 1 && Math.abs(z - JETTY.z - G / 2) < G * 0.75;
// deep water, cell by cell: the sea (past the beach) and the river (except under the bridges)
const deep = (kx, kz) => { const x = cellC(kx), z = cellC(kz); return !onBridge(x, z) && !onJetty(x, z) && (!coast(x * 0.94, z * 0.94) || inRiver(x, z)); };
export const water = [];                                   // [x, z, w, d] rectangles of deep water (row runs)
for (let kz = -20; kz < 20; kz++) {
  let run = null;
  const flush = () => { if (run) water.push([(run[0] + run[1] + 1) / 2 * G, cellC(kz), (run[1] - run[0] + 1) * G, G]); run = null; };
  for (let kx = -25; kx < 25; kx++) { if (deep(kx, kz)) run = run ? [run[0], kx] : [kx, kx]; else flush(); }
  flush();
}
const isWater = (x, z) => water.some(([cx, cz, w, d]) => Math.abs(x - cx) < w / 2 + 0.5 && Math.abs(z - cz) < d / 2 + 0.5);

/* ---------- the town (west, low, lots of cover) ---------- */
// A house: walls on grid lines with a one-cell door, a pitched roof (ramps you can stand on).
function house(kx, kz, n, m, h, kind) {
  const w = n * G, d = m * G, x = kx * G + w / 2, z = kz * G + d / 2, half = (w - G) / 2, off = (w + G) / 4;
  houses.push([x, z, w, d, h]);
  layout.push(box(x - w / 2, z, T, d, h, kind), box(x + w / 2, z, T, d, h, kind));
  for (const face of [-1, 1]) for (const side of [-1, 1]) layout.push(box(x + side * off, z + face * d / 2, half, T, h, kind));
  layout.push(box(x, z, w + 0.5, d + 0.5, 0.25, kind, h));
  const rw = (w + 0.55) / 2, eave = h + 0.25;
  layout.push({ ramp: '+x', x: x - rw / 2, z, w: rw, d: d + 0.5, y: eave, y1: eave + 1.45, base: eave, kind: 'roof' },
    { ramp: '-x', x: x + rw / 2, z, w: rw, d: d + 0.5, y: eave, y1: eave + 1.45, base: eave, kind: 'roof' });
  chests.push([x + w / 2 - 1.2, z - d / 2 + 1.2]);
}
const HOUSE_KINDS = ['plank', 'plankRed', 'plankBlue', 'plankGreen', 'stone'];
[[-21, -10], [-17, -10], [-13, -10], [-21, -4], [-13, -4], [-21, 3], [-17, 3], [-13, 3], [-21, 8], [-17, 8], [-13, 8], [-17, -4], [-9, 3], [-9, -10]]
  .forEach(([kx, kz], i) => { if (i === 11) return; house(kx, kz, 3, 3, 3.4 + (i % 3) * 0.3, HOUSE_KINDS[i % 5]); });
// The town hall on the square: two storeys, stairs inside, a flat roof you can stand on.
{
  const x0 = -17 * G, z0 = -4 * G, n = 3, w = n * G, h = 3.2;
  for (const y of [0, h]) {
    layout.push(box(x0, z0 + w / 2, T, w, h, 'stone', y), box(x0 + w, z0 + w / 2, T, w, h, 'stone', y));
    for (const z of [z0, z0 + w]) layout.push(box(x0 + G / 2, z, G, T, h, 'stone', y), box(x0 + 2.5 * G, z, G, T, h, 'stone', y), box(x0 + 1.5 * G, z, G, T, y ? 1 : 0.7, 'stone', y ? y : 2.5));
  }
  layout.push(box(x0 + 0.5 * G, z0 + w / 2, G, w, 0.3, 'plank', h - 0.3), box(x0 + 2.5 * G, z0 + w / 2, G, w, 0.3, 'plank', h - 0.3));
  layout.push(box(x0 + w / 2, z0 + w / 2, w, w, 0.3, 'stone', 2 * h - 0.3));
  layout.push({ stairs: '+z', x: x0 + 1.5 * G, z: z0 + w / 2, w: G - 0.3, d: w - 0.6, y: 0, y1: h, base: 0, rise: 0.3, kind: 'plank' });
  layout.push({ stairs: '-z', x: x0 + 1.5 * G, z: z0 + w / 2 - 0.3, w: 1.2, d: w - 1.2, y: h, y1: 2 * h, base: h, rise: 0.3, kind: 'plank' });
  chests.push([x0 + 0.6 * G, z0 + w / 2, h], [x0 + w / 2, z0 + w / 2, 2 * h]);
}
// Town cover: garden walls, market stalls, carts, crates and barrels along the lanes.
for (const [x, z, w, d] of [[-56, -36, 9.6, 0.6], [-43.2, -24, 0.6, 9.6], [-56, 20, 12.8, 0.6], [-30.4, 16, 0.6, 6.4], [-69, -8, 0.6, 12.8], [-30, -36, 6.4, 0.6], [-47, 36, 9.6, 0.6]])
  layout.push(box(x, z, w, d, 1.1, 'stone'));
export const STALLS = [0, 1, 2, 3, 4, 5].map((i) => [-48 + (i % 3) * 4.2, i < 3 ? 3.4 : 6.8]);
for (const [x, z] of STALLS) layout.push(box(x, z, 2.4, 1.1, 1, 'plank'));   // stall counters on the square
for (const [x, z] of [[-60, -20], [-38, -18], [-55, 22.5], [-30.4, 30], [-52, -42], [-28, 4], [-58, 6], [-40, 44]]) layout.push(box(x, z, 1.6 + rnd() * 0.8, 1.6, 1 + rnd() * 0.8, rnd() < 0.5 ? 'crate' : 'cart'));
// The jetty: planks on posts out into the sea, a boathouse at the end.
layout.push(box((JETTY.x0 + JETTY.x1) / 2, JETTY.z + G / 2, JETTY.x1 - JETTY.x0, G * 1.2, 0.35, 'plank'));
layout.push(box(JETTY.x0 + 3, JETTY.z + G / 2, 4.8, 3.6, 2.6, 'plankBlue', 0.35));
chests.push([JETTY.x0 + 7.5, JETTY.z + G / 2]);

/* ---------- the river and its bridges ---------- */
for (const b of BRIDGES) {
  const z = b + G / 2, x = riverX(z);
  layout.push(box(x, z, 4 * G, G * 1.2, 0.35, 'plank'));
  for (const dz of [-G * 0.6, G * 0.6]) layout.push(box(x, z + dz, 4 * G, 0.12, 1, 'plank', 0.35));
  chests.push([x + 2.6 * G, z + 1.5]);
}

/* ---------- the fields and woods (middle) ---------- */
const trees = [];
const grove = (cx, cz, n, spread) => { for (let i = 0; i < n; i++) { const x = cx + (rnd() - 0.5) * spread, z = cz + (rnd() - 0.5) * spread; if (coast(x, z) && !isWater(x, z) && Math.abs(x - riverX(z)) > 5) trees.push(box(x, z, 0.65, 0.65, 4.2 + rnd() * 2.6, 'tree')); } };
grove(-6, -42, 9, 16); grove(-8, 40, 9, 16); grove(18, -22, 7, 12); grove(20, 26, 7, 12); grove(-20, -48, 5, 10); grove(-26, 48, 5, 10);
for (const [x, z] of [[-12, -22], [-12, 22], [16, -46], [16, 46], [-14, -6]]) { layout.push(box(x, z, 3.2, 0.6, 1.1, 'stone'), box(x + 4, z + 2, 1.8, 1.8, 1.4, 'hay')); chests.push([x + 2, z - 2]); }
layout.push(...trees);

/* ---------- the high ground (east): two terraces with cliffs, little cover ---------- */
// lower terrace: 3 m, ramps up from the fields; upper terrace: 6.4 m, two steep tracks up from the lower one
const T1 = { x0: 32, x1: 60.8, z0: -25.6, z1: 22.4, h: 3.2 }, T2 = { x0: 44.8, x1: 57.6, z0: -16, z1: 12.8, h: 6.4 };
for (const t of [T1, T2]) layout.push(box((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2, t.x1 - t.x0, t.z1 - t.z0, t.h, 'cliff'));
layout.push({ ramp: '+x', x: T1.x0 - 3.2, z: -12.8, w: 6.4, d: 6.4, y1: T1.h, kind: 'cliff' },
  { ramp: '+x', x: T1.x0 - 3.2, z: 19.2, w: 6.4, d: 6.4, y1: T1.h, kind: 'cliff' },
  { ramp: '-z', x: 41.6, z: T1.z1 + 3.2, w: 6.4, d: 6.4, y1: T1.h, kind: 'cliff' },
  { ramp: '+x', x: T2.x0 - 3.2, z: 9.6, w: 6.4, d: 3.2, y: T1.h, y1: T2.h, base: T1.h, kind: 'cliff' },
  { ramp: '+z', x: 51.2, z: T2.z0 - 3.2, w: 3.2, d: 6.4, y: T1.h, y1: T2.h, base: T1.h, kind: 'cliff' });
for (const [x, z, y] of [[38, -20, T1.h], [38, 18, T1.h], [50, -10, T2.h], [54, 8, T2.h], [48, 0, T2.h]]) layout.push(box(x, z, 2.2, 1.8, 1.2, 'rock', y));   // a few rocks, nothing more
chests.push([52, -4, T2.h], [40, -22, T1.h], [40, 18, T1.h], [56, 10, T2.h]);
export const LIGHTHOUSE = [54.4, -12.8, T2.h];
export const TOWERS = [[-33.6, -40, 0], [-1.6, 49.6, 0], [40, 6.4, T1.h]];
for (const [x, z, y] of TOWERS) layout.push(box(x, z, G, G, 0.3, 'plank', y + 4.5), { stairs: '+z', x, z: z - G / 2 - 2.4, w: 1.4, d: 4.8, y, y1: y + 4.5, base: y, rise: 0.3, kind: 'plank' });
layout.push(box(LIGHTHOUSE[0], LIGHTHOUSE[1], 2 * G, 2 * G, 1.4, 'rock', T2.h));

/* ---------- drawing: water, ground, grass, trees, details ---------- */
function blades() {
  const v = [-.12, 0, 0, .10, 0, 0, .035, .49, .04, 0, 0, -.11, 0, 0, .13, -.04, .35, .02, -.19, 0, .11, -.05, 0, .16, -.24, .3, .17];
  const both = v.slice();
  for (let i = 0; i < v.length; i += 9) both.push(...v.slice(i, i + 3), ...v.slice(i + 6, i + 9), ...v.slice(i + 3, i + 6));
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(both, 3)); g.computeVertexNormals();
  return g;
}
// Water: one sheet over the whole map; the shader draws it only where the coast and river curves say water
// (the same curves as the ground texture), so the shoreline is smooth. Moving waves, foam at the edge.
// (The drowning areas underneath stay on the grid: that is what the game and the bots use.)
function waterMesh() {
  const g = new PlaneGeometry(2400, 2400, 1, 1)   /* (to the horizon: still one square) */;
  g.rotateX(-Math.PI / 2);
  const m = new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uT: windU.uWT, uDeep: { value: new Color(0x16506a) }, uShal: { value: new Color(0x3c95a2) }, uFoam: { value: new Color(0xeef6f4) }, uHaze: { value: new Color(0x9a8a8c) } },
    vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uT; uniform vec3 uDeep, uShal, uFoam, uHaze; varying vec3 vW;
      void main() {
        float x = vW.x, z = vW.z;
        float e = (x / 71.0) * (x / 71.0) + (z / 55.0) * (z / 55.0) + 0.05 * sin(x * 0.11 + z * 0.07) + 0.04 * cos(z * 0.13 - x * 0.05);
        float rv = abs(x - (6.0 + 7.0 * sin(z / 17.0)));
        // how far into the water: past the beach (e > 1.0) or into the river (rv < 3.4)
        float sea = smoothstep(0.985, 1.02, e), river = (1.0 - smoothstep(3.0, 3.5, rv)) * step(abs(z), 60.0);
        float wet = max(sea, river);
        if (wet < 0.02) discard;
        float edge = max(1.0 - smoothstep(0.99, 1.02, e), smoothstep(2.95, 3.4, rv) * river);   // (near the shore)
        float r = sin(x * 1.7 + uT * 2.0) * sin(z * 1.3 - uT * 1.6) + sin((x + z) * 0.6 + uT);
        vec3 c = mix(uShal, uDeep, smoothstep(1.0, 1.25, e) * (1.0 - river * 0.4));
        c += vec3(0.025) * r;
        float foam = edge * (0.55 + 0.45 * sin(x * 2.3 + z * 1.9 + uT * 2.2) * sin(x * 0.7 - z * 1.1 - uT));
        c = mix(c, uFoam, foam * 0.6);
        c = mix(c, uHaze, smoothstep(70.0, 190.0, length(cameraPosition.xz - vW.xz)));   // (fades into the haze toward the horizon)
        gl_FragColor = vec4(c, wet * mix(0.62, 0.9, smoothstep(1.0, 1.15, e))); }`,
  });
  const mesh = new Mesh(g, m);
  mesh.position.y = 0.05; mesh.renderOrder = 2; mesh.userData.ownMaterial = true;
  return mesh;
}

function life(ctx, solids) {
  const r = mulberry32(3019), cube = new BoxGeometry(1, 1, 1), ball = new IcosahedronGeometry(1, 0);
  ctx.object(waterMesh());
  const timber = { color: 0x543c2a, rough: 0.98 }, canvas = { color: 0x79382d, rough: 0.95 }, faded = { color: 0x997355, rough: 0.9 };
  // trees: trunk and two cone layers that sway
  ctx.scatter(cube, { color: 0x5d4931, rough: 1, castShadow: true }, trees.map((b) => [b.x, b.h / 2, b.z, b.w, b.h, b.d]));
  ctx.scatter(new ConeGeometry(1, 1, 9), { color: 0x375646, rough: 0.95, castShadow: true, sway: 0.1 }, trees.map((b) => [b.x, b.h - 0.55, b.z, 2.15, 3.1, 2.15]));
  ctx.scatter(new ConeGeometry(1, 1, 9), { color: 0x4c6c4b, rough: 0.95, sway: 0.14 }, trees.map((b) => [b.x, b.h + 0.65, b.z, 1.65, 2.9, 1.65]));
  // grass, stones and flowers on open land (not in water, buildings or the town's lanes)
  const samples = (count, make) => {
    const out = [];
    for (let a = 0; out.length < count && a < count * 5; a++) {
      const x = r() * 150 - 75, z = r() * 118 - 59;
      if (!coast(x * 1.04, z * 1.04) || isWater(x, z)) continue;
      let y = 0, blocked = false;
      for (const b of solids) { if (x <= b.minX - 0.25 || x >= b.maxX + 0.25 || z <= b.minZ - 0.25 || z >= b.maxZ + 0.25) continue; if (b.kind !== 'cliff') { blocked = true; break; } y = Math.max(y, b.maxY); }
      if (!blocked) out.push(make(x, y, z, 0.65 + r() * 0.8, r() * Math.PI * 2, r()));
    }
    return out;
  };
  ctx.scatter(blades(), { color: 0xffffff, rough: 1, sway: 0.12 }, samples(3600, (x, y, z, s, a, t) => [x, y, z, s, s, s, a, t < 0.35 ? 0x586b3d : t < 0.7 ? 0x82904b : 0xa2a36c]), [0, 800, 2000, 3600]);
  ctx.scatter(ball, { color: 0xffffff, rough: 1 }, samples(420, (x, y, z, s, a, t) => [x, y + 0.11 * s, z, 0.29 * s, 0.18 * s, 0.21 * s, a, t < 0.5 ? 0x66695f : 0xa49d8a]), [30, 110, 240, 420]);
  ctx.scatter(ball, { color: 0xffffff, rough: 0.8 }, samples(900, (x, y, z, s, a, t) => [x, y + 0.25 * s, z, 0.12 * s, 0.1 * s, 0.12 * s, a, [0xd2453b, 0xf0c63c, 0xf3efe6, 0x9b6bd0][Math.floor(t * 4)]]), [0, 200, 500, 900]);
  // houses: shutters and window frames on the long sides, a doorstep
  const shutters = [];
  for (const [x, z, w, d] of houses) for (const face of [-1, 1]) for (const side of [-1, 1]) shutters.push([x + side * (w / 2 - 1.1), 1.8, z + face * (d / 2 + 0.22), 1.1, 1.05, 0.08, 0, 0x34403c]);
  ctx.scatter(cube, { color: 0xffffff, rough: 0.9 }, shutters);
  // market canopies over the stalls
  for (const [i, [x, z]] of STALLS.entries()) { ctx.box({ color: [0xb5574a, 0x5d86a8, 0xd9b44a][i % 3], rough: 0.9 }, 2.8, 0.1, 1.8, x, 2.3, z); for (const dx of [-1.3, 1.3]) ctx.cylinder(timber, 0.05, 2.3, x + dx, 1.15, z + 0.8, 5); }
  // watchtowers: legs, rails, a roof
  for (const [x, z, y] of TOWERS) {
    for (const [dx, dz] of [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]]) ctx.cylinder(timber, 0.13, 4.5, x + dx, y + 2.25, z + dz, 6);
    for (const [dx, dz, w, d] of [[0, 1.55, 3.2, 0.1], [-1.55, 0, 0.1, 3.2], [1.55, 0, 0.1, 3.2]]) ctx.box(faded, w, 0.1, d, x + dx, y + 5.6, z + dz);
    ctx.box(canvas, 3.6, 0.14, 3.6, x, y + 7.05, z);
  }
  // the lighthouse on the high ground
  { const [x, z, y] = LIGHTHOUSE;
    for (let i = 0; i < 7; i++) ctx.cylinder({ color: i % 2 ? 0xf2eee6 : 0xb83a33, rough: 0.7 }, 1.45 - i * 0.08, 2, x, y + 2.4 + i * 2, z, 16);
    ctx.cylinder({ emissive: 0xffe08a }, 0.85, 1.3, x, y + 16, z, 12);
    ctx.cylinder({ color: 0x2c3436, rough: 0.6 }, 1.15, 0.25, x, y + 16.8, z, 12); }
  // jetty posts and bridge posts in the water
  const posts = [];
  for (let x = JETTY.x0 + 1; x < JETTY.x1; x += 2.4) for (const dz of [-1.8, 1.8]) posts.push([x, 0.15, JETTY.z + G / 2 + dz, 0.22, 0.9, 0.22]);
  ctx.scatter(cube, timber, posts);
}

// The ground: grass inland, sand on the beach and the riverbanks, wet sand at the water's edge, dirt lanes
// through the town and to the bridges, crop rows in the fields. High and up: 12 px a metre.
function ground() {
  const hi = gfxLevel.q === 'high' || gfxLevel.q === 'ultra', P = hi ? 12 : 4, w = 160 * P, h = 128 * P;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h), q = mulberry32(71);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = px / P - 80, z = py / P - 64, at = (py * w + px) * 4, n = q() - 0.5;
    const e = (x / 71) ** 2 + (z / 55) ** 2 + 0.05 * Math.sin(x * 0.11 + z * 0.07) + 0.04 * Math.cos(z * 0.13 - x * 0.05);   // (as coast())
    const rv = Math.abs(x - riverX(z));
    let c;
    if (e > 1.05 || (rv < 3.4 && Math.abs(z) < 60)) c = [70, 86, 82];                               // sea and river bed
    else if (e > 0.9 || rv < 5.2) { const t = Math.min(1, Math.max(0, e > 0.9 ? (e - 0.9) / 0.15 : (5.2 - rv) / 1.8)); c = [210 - 60 * t, 192 - 58 * t, 148 - 42 * t]; }   // beach: dry to wet sand
    else { const s = 9 * Math.sin(x * 0.21 + z * 0.17) + 5 * Math.cos(x * 0.53 - z * 0.31); c = [104 + s, 122 + s, 74 + s * 0.6]; }   // grass
    const g = n * (hi ? 26 : 18);
    img.data[at] = c[0] + g; img.data[at + 1] = c[1] + g; img.data[at + 2] = c[2] + g; img.data[at + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const m = (v, half) => (v + half) * P;
  ctx.lineCap = ctx.lineJoin = 'round';
  const lane = (pts, wide) => { ctx.beginPath(); pts.forEach(([x, z], i) => ctx[i ? 'lineTo' : 'moveTo'](m(x, 80), m(z, 64))); for (const [col, lw] of [['#7e6a4e66', wide + 1.6], ['#a08a66cc', wide], ['#b9a37f40', wide * 0.5]]) { ctx.strokeStyle = col; ctx.lineWidth = lw * P; ctx.stroke(); } };
  lane([[-66, -1.6], [-24, -1.6], [-8, -1.6], [riverX(1.6), 1.6], [30, 0], [44, -12.8]], 4.2);            // the main road, over the middle bridge to the hill
  lane([[-48, -40], [-48, 40]], 3.4); lane([[-36, -40], [-36, 40]], 3); lane([[-60, 24], [-24, 24]], 3); lane([[-60, -24], [-24, -24]], 3);
  lane([[-24, -30], [riverX(-32) - 8, -32], [riverX(-32) + 10, -32], [36, -14]], 2.6);
  lane([[-24, 30], [riverX(32) - 8, 32], [riverX(32) + 10, 32], [41.6, 40]], 2.6);
  for (const [cx, cz] of [[-12, -22], [-12, 22], [16, -46], [16, 46]]) { ctx.strokeStyle = 'rgba(92,74,46,.5)'; ctx.lineWidth = 0.4 * P; for (let k = -5; k <= 5; k++) { ctx.beginPath(); ctx.moveTo(m(cx - 6, 80), m(cz + k * 1.2, 64)); ctx.lineTo(m(cx + 6, 80), m(cz + k * 1.2, 64)); ctx.stroke(); } }   // crop rows
  ctx.fillStyle = '#8f8a80'; ctx.fillRect(m(-17 * G - 6, 80), m(-1.6 - 6, 64), 18 * P, 12 * P);     // the town square, paved
  if (hi) { ctx.strokeStyle = 'rgba(60,58,54,.45)'; ctx.lineWidth = 1; for (let k = 0; k <= 18; k += 0.8) { ctx.beginPath(); ctx.moveTo(m(-17 * G - 6 + k, 80), m(-7.6, 64)); ctx.lineTo(m(-17 * G - 6 + k, 80), m(4.4, 64)); ctx.stroke(); } }
  const map = new CanvasTexture(canvas);
  map.wrapS = map.wrapT = RepeatWrapping; map.colorSpace = SRGBColorSpace; map.anisotropy = hi ? 8 : 1;
  return { map, tileX: 160, tileZ: 128, rough: 0.97, keepInLow: true };
}

const Y = MAPS.yard.kinds;
export const island = (spawns) => ({
  name: 'Blacktide Island', hx: 80, hz: 64, wallH: 5, mist: true, openEdge: true,
  sky: duskSky, background: 0x4c5f65, fog: [0x73878e, 78, 186],
  hemi: [0xd5e8f1, 0x524638, 2.2], key: [0xffe2bb, 2, [-43, 83, 30]],
  floor: ground,
  wall: () => ({ ...wallPanels(), tileW: 2, tileH: 4 }),
  acid: water.map(([x, z, w, d]) => ({ x, z, w, d, dps: 24 })),           // deep water: you drown (bots keep out)
  kinds: {
    wall: { color: 0x707b70, rough: 0.9 },
    stone: { ...surface('plaster', Y.low.map), color: 0xa39c8e, rough: 0.95, tile: 1.6 },
    plank: { ...surface('planks', Y.plank.map), tile: 1.8, color: 0xa88162, rough: 0.9 },
    plankRed: { ...surface('planks', Y.plank.map), tile: 1.8, color: 0xb5574a, rough: 0.9 },
    plankBlue: { ...surface('planks', Y.plank.map), tile: 1.8, color: 0x5d86a8, rough: 0.9 },
    plankGreen: { ...surface('planks', Y.plank.map), tile: 1.8, color: 0x6f9a62, rough: 0.9 },
    roof: { ...surface('shingles', Y.plank.map), tile: 2.1, color: 0x6f5546, rough: 0.95 },
    crate: { color: 0x9b6944, rough: 0.9 },
    cart: { ...surface('planks', Y.plank.map), tile: 1.2, color: 0x7d5a3e, rough: 0.9 },
    hay: { color: 0xc9a85a, rough: 1 },
    cliff: { ...surface('rock', Y.low.map), color: 0x7d7a6c, rough: 1, tile: 3 },
    rock: { color: 0x67736e, rough: 1 },
    tree: { hiddenBox: true },
  },
  spawns, spawnsB: [],
  chests: [...spawns.map(([x, z]) => [x * 0.82, z * 0.82]), ...chests],
  layout,
  extra: (ctx, _map, solids) => life(ctx, solids),
});
