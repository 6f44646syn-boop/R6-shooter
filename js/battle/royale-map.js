import { wallPanels, duskSky } from '../scene/range-tex.js?v=25db2c9-mwbx9yjs';
import { BoxGeometry, CanvasTexture, ConeGeometry, IcosahedronGeometry, RepeatWrapping, SRGBColorSpace } from '../../vendor/three/three.module.min.js?v=25db2c9-mwbx9yjs';
import { addBlacktideDetails, blacktideTrails, villageHouse, villageHouses } from './royale-details.js?v=25db2c9-mwbx9yjs';
import { MAPS } from './maps.js?v=25db2c9-mwbx9yjs';

export const ROYALE_MAP_ID = 'blacktide';
export const ROYALE_BOTS = 20;

const spawns = Array.from({ length: ROYALE_BOTS + 1 }, (_, i) => {
  const a = (i + .5) * 2 * Math.PI / (ROYALE_BOTS + 1);
  return [63 * Math.cos(a), 49 * Math.sin(a)];
});
const box = (x, z, w, d, h, kind = 'wall', y = 0) => ({ x, z, w, d, h, kind, y });
function building(x,z,{w,d,h,door},kind='plank') {
  const wall = (w-door)/2, offset = (w+door)/4, roofW = (w+.55)/2, roofD = d+.5, eave = h+.25;
  return [
    box(x-w/2,z,.4,d,h,kind), box(x+w/2,z,.4,d,h,kind),
    ...[-1,1].flatMap(face => [-1,1].map(side => box(x+side*offset,z+face*d/2,wall,.4,h,kind))),
    box(x,z,w+.5,roofD,.25,kind,h),
    {ramp:'+x',x:x-roofW/2,z,w:roofW,d:roofD,y:eave,y1:eave+1.45,base:eave,kind:'roof'},
    {ramp:'-x',x:x+roofW/2,z,w:roofW,d:roofD,y:eave,y1:eave+1.45,base:eave,kind:'roof'},
  ];
}

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
  const canvas = document.createElement('canvas'), w = 640, h = 512;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(w,h);
  let seed = 71;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    seed = (Math.imul(1664525,seed)+1013904223) >>> 0;
    const u = x * 2*Math.PI/w, v = y * 2*Math.PI/h;
    const shade = 9*Math.sin(3*u+v) + 5*Math.cos(7*u-4*v) + (seed/4294967296-.5)*23;
    const at = (y*w+x)*4;
    pixels.data[at] = 113+shade; pixels.data[at+1] = 125+shade;
    pixels.data[at+2] = 82+shade; pixels.data[at+3] = 255;
  }
  ctx.putImageData(pixels,0,0);
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const trail of blacktideTrails) {
    ctx.beginPath();
    trail.forEach(([x,z],i) => ctx[i ? 'lineTo' : 'moveTo']((x+80)*4,(z+64)*4));
    ctx.strokeStyle = '#8a80614d'; ctx.lineWidth = 17; ctx.stroke();
    ctx.strokeStyle = '#aea080ad'; ctx.lineWidth = 12; ctx.stroke();
    ctx.strokeStyle = '#c9b89125'; ctx.lineWidth = 7; ctx.stroke();
  }
  const map = new CanvasTexture(canvas);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.colorSpace = SRGBColorSpace;
  return { map, tileX:160, tileZ:128, rough:.97, keepInLow:true };
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
    plank: { map:MAPS.yard.kinds.plank.map, tile:1.8, color:0xa88162, rough:.9 },
    roof: { map:MAPS.yard.kinds.plank.map, tile:2.1, color:0x6f5546, rough:.95 },
    dock: { color: 0x829292, rough: .85 },
    container: { map:MAPS.yard.kinds.container.map, tile:1.5, color:0x486d74, metal:.45, rough:.65 },
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
    ...villageHouses.flatMap(([x,z]) => building(x,z,villageHouse)),
    ...building(42,-15,{w:17,d:10,h:5.1,door:4.6},'container'),
    ...building(17,-40,{w:13,d:9,h:4.2,door:3.8},'wall'),
    box(39,-14,2.4,1.9,1.65,'crate'), box(46,-17,2.2,3.3,1.25,'crate'),
    box(14,-41,2,2.8,1.1,'crate'), box(21,-39,1.8,2.6,1.35,'crate'),
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
    ...[[-56,-9],[-54,18],[-22,-48],[-33,-26],[-28,-7],[-27,14],[-19,35],[-19,52],
      [5,-35],[23,-54],[27,-25],[26,6],[29,24],[24,39],[33,53],[55,4],[53,44],[68,-34]].flatMap(([x,z],i) => [
      box(x,z,i%2?3.8:1.2,i%2?1.2:3.8,1.15,'barrier'),
      box(x+2.8,z-2.5,1.7,1.55,i%3?1.3:1.9,'crate'),
    ]),
  ],
  extra: (ctx, _map, solids) => {
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
    addBlacktideDetails(ctx,solids);
  },
};
