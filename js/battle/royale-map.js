import { wallPanels, duskSky } from '../scene/range-tex.js?v=9dd0f7b-mwbioun8';
import { BoxGeometry, CanvasTexture, ConeGeometry, IcosahedronGeometry, RepeatWrapping, SRGBColorSpace } from '../../vendor/three/three.module.min.js?v=9dd0f7b-mwbioun8';

export const ROYALE_MAP_ID = 'blacktide';
export const ROYALE_BOTS = 20;

const spawns = Array.from({ length: ROYALE_BOTS + 1 }, (_, i) => {
  const a = (i + .5) * 2 * Math.PI / (ROYALE_BOTS + 1);
  return [63 * Math.cos(a), 49 * Math.sin(a)];
});
const box = (x, z, w, d, h, kind = 'wall', y = 0) => ({ x, z, w, d, h, kind, y });
const shack = (x, z) => [
  box(x, z - 3, 8, .4, 3, 'plank'), box(x - 4, z, .4, 6, 3, 'plank'),
  box(x + 4, z, .4, 6, 3, 'plank'), box(x - 2.6, z + 3, 2.8, .4, 3, 'plank'),
  box(x + 2.6, z + 3, 2.8, .4, 3, 'plank'), box(x, z, 8.4, 6.4, .25, 'plank', 3),
];

const hill = (x, z, w, d, y) => {
  const rise = 6;
  return [
    box(x, z, w, d, y, 'hill'),
    { ramp:'+x', x:x-(w+rise)/2, z, w:rise, d, y1:y, kind:'hill' },
    { ramp:'-x', x:x+(w+rise)/2, z, w:rise, d, y1:y, kind:'hill' },
    { ramp:'+z', x, z:z-(d+rise)/2, w, d:rise, y1:y, kind:'hill' },
    { ramp:'-z', x, z:z+(d+rise)/2, w, d:rise, y1:y, kind:'hill' },
  ];
};
const groves = [
  [-62,-20], [-65,7], [-28,-39], [-20,-19], [0,-39], [20,-21], [63,-11],
  [-22,21], [0,41], [25,16], [64,8], [28,46], [-64,46], [58,49],
];
const trees = groves.flatMap(([x,z], i) => [[-2,3],[2,-2],[5,3]].map(([dx,dz], j) =>
  box(x + dx, z + dz, .65, .65, 3.8 + ((i+j)%3)*.7, 'tree')));
const brush = groves.flatMap(([x,z], i) => [[-6,-2], [0,5], [3,-6], [7,1]].map(([dx,dz], j) =>
  [x+dx, z+dz, .8 + ((i+j)%3)*.18]));

function groundTexture() {
  const canvas = document.createElement('canvas'), size = 128;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(size,size);
  let seed = 71;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(1664525,seed)+1013904223) >>> 0;
    const u = x * 2*Math.PI/size, v = y * 2*Math.PI/size;
    const shade = 8*Math.sin(u+v) + 4*Math.cos(3*u-2*v) + (seed/4294967296-.5)*21;
    pixels.data.set([118+shade,125+shade,87+shade,255], (y*size+x)*4);
  }
  ctx.putImageData(pixels,0,0);
  const map = new CanvasTexture(canvas);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.colorSpace = SRGBColorSpace;
  return { map, tile:9, rough:.97 };
}

export const BLACKTIDE = {
  name: 'Blacktide Island', hx: 80, hz: 64, wallH: 5,
  sky: duskSky, background: 0x4c5f65, fog: [0x73878e, 78, 186],
  hemi: [0xd5e8f1, 0x524638, 2.2], key: [0xffe2bb, 2, [-43, 83, 30]],
  floor: groundTexture,
  wall: () => ({ ...wallPanels(), tileW: 2, tileH: 4 }),
  kinds: {
    wall: { color: 0x707b70, rough: .9 },
    low: { color: 0x928576, rough: .95 },
    plank: { color: 0x74503a, rough: .9 },
    dock: { color: 0x829292, rough: .85 },
    container: { color: 0x385b62, metal: .45, rough: .65 },
    crate: { color: 0x9b6944, rough: .9 },
    barrier: { color: 0xc6a175, rough: .9 },
    hill: { color: 0x718355, rough: 1 },
    rock: { color: 0x67736e, rough: 1 },
    tree: { hiddenBox:true },
  },
  spawns, spawnsB: [],
  chests: [
    ...spawns.map(([x, z]) => [x * .92, z * .92]),
    [-45,-31], [-36,-18], [36,-35], [54,-22], [-50,28], [-31,35],
    [36,30], [52,19], [-14,0], [12,0], [0,-12], [0,12],
  ],
  layout: [
    // Wreck, village, container docks and quarry surround the central fort.
    box(-45, -29, 26, 1, 2.8, 'plank'), box(-45, -37, 20, .8, 2.2, 'plank'),
    box(-57, -33, 2, 7, 1.2, 'plank'), box(-34, -33, 4, 5, 1.2, 'dock'),
    box(-45, -24, 13, 5, .8, 'dock'), box(-38, -19, 4, 2.6, 1.2, 'crate'),
    ...shack(-51, 29), ...shack(-38, 29), ...shack(-44, 42), ...shack(-31, 42),
    box(36, -29, 16, 2.8, 2.8, 'container'), box(55, -30, 2.8, 19, 2.8, 'container'),
    box(45, -43, 13, 3, 2.8, 'container'), box(34, -40, 2.8, 9, 2.8, 'container'),
    box(46, -34, 3, 3, 1.2, 'crate'), box(49, -23, 9, 3, 1.2, 'dock'),
    box(46, 31, 19, 9, 1.2, 'dock'), box(47, 35, 12, 6, 1.2, 'dock', 1.2),
    { ramp:'-z', x:43, z:23, w:3.5, d:7, y1:1.2, kind:'dock' },
    box(60, 29, 3, 12, 2.1), box(36, 38, 5, 7, 1.25, 'low'),
    box(-8, -9, 6, .7, 3.2), box(8, -9, 6, .7, 3.2),
    box(-8, 9, 6, .7, 3.2), box(8, 9, 6, .7, 3.2),
    box(-11, 0, .7, 9, 3.2), box(11, 0, .7, 9, 3.2),
    box(0, 3, 7, 5, 1.15, 'dock'), box(-3, 3, 1, 3, .9, 'low', 1.15),
    { ramp:'+z', x:0, z:-1.8, w:2.6, d:4.6, y1:1.15, kind:'dock' },
    ...[-60,-30,0,30,60].flatMap((x, i) => [-50,-14,14,50].map((z, j) =>
      box(x + (j % 2 ? 5 : -5), z, (i+j)%2 ? 3 : 6, (i+j)%2 ? 6 : 3, 1.2, 'barrier'))),
    ...hill(-42, 0, 10, 8, 2.5), ...hill(41, 0, 10, 8, 2.7),
    ...hill(-9,-27,10,8,2.4), ...hill(11,29,10,8,2.6), ...hill(9,-49,8,7,1.85),
    ...trees,
    ...groves.flatMap(([x,z], i) => [
      box(x - 5, z + 1, 3.2, 2.4, i % 3 ? 1.3 : 2.3, 'rock'),
      box(x + 2, z + 5, i % 2 ? 2.1 : 4.6, i % 2 ? 4.6 : 2.1, 1.1, 'low'),
    ]),
  ],
  extra: ctx => {
    ctx.scatter(new BoxGeometry(1,1,1), {color:0x5d4931, rough:1, castShadow:true},
      trees.map(b => [b.x,b.h/2,b.z,b.w,b.h,b.d]));
    ctx.scatter(new ConeGeometry(1,1,9), {color:0x375646, rough:.95, castShadow:true},
      trees.map(b => [b.x,b.h-.55,b.z,2.15,3.1,2.15]));
    ctx.scatter(new ConeGeometry(1,1,9), {color:0x4c6c4b, rough:.95},
      trees.map(b => [b.x,b.h+.65,b.z,1.65,2.9,1.65]));
    ctx.scatter(new IcosahedronGeometry(1,0), {color:0x375646, rough:1},
      brush.map(([x,z,s]) => [x,.55*s,z,s,.65*s,s]));
    ctx.scatter(new IcosahedronGeometry(1,0), {color:0x4c6c4b, rough:1},
      brush.map(([x,z,s]) => [x+.7*s,.4*s,z+.25*s,.72*s,.48*s,.72*s]));
  },
};
