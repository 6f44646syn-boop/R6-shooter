import { BoxGeometry, BufferGeometry, Float32BufferAttribute, IcosahedronGeometry } from '../../vendor/three/three.module.min.js?v=a37f22c-mwcnqhgi';
import { mulberry32 } from '../core/prng.js?v=a37f22c-mwcnqhgi';

export const blacktideTrails = [
  [[-47,-23],[-33,-16],[-23,-10],[-12,-7],[-4,-5]],
  [[-46,25],[-37,20],[-29,14],[-19,9],[-7,7]],
  [[46,-28],[32,-18],[23,-12],[13,-8],[6,-5]],
  [[47,24],[36,19],[27,14],[19,10],[7,7]],
  [[-28,-51],[-36,-42],[-45,-36]],
  [[54,-46],[61,-28],[58,-16],[54,-6],[58,10],[52,21]],
  [[-38,48],[-26,50],[-14,47],[-8,37],[-6,26],[-5,13]],
];
export const villageHouses = [[-51,29],[-38,29],[-44,42],[-31,42]];
export const villageHouse = {w:11,d:8,h:3.65,door:3.2};

function landmarkDetails(ctx) {
  const timber = { color:0x543c2a, rough:.98 };
  const fadedWood = { color:0x997355, rough:.9 };
  const steel = { color:0x6a8486, rough:.75, metal:.45 };
  const canvas = { color:0x79382d, rough:.95 };
  const hatches = [];
  const {w,d,h,door} = villageHouse;
  for (const [x,z] of villageHouses) {
    ctx.box(fadedWood,w+.55,.17,.21,x,h+.25,z+d/2+.26);
    ctx.box(fadedWood,w+.55,.17,.21,x,h+.25,z-d/2-.26);
    for (const side of [-1,1]) {
      hatches.push([x+side*3.45,1.82,z+d/2+.22,1.12,1.06,.08,0,0x34403c]);
      hatches.push([x+side*3.45,1.82,z+d/2+.27,.11,1.17,.06,0,0xbc9871]);
    }
    ctx.box(timber,door,.22,1.4,x,.11,z+d/2+.4);
  }

  ctx.cylinder(timber,.18,7.2,-45,3.6,-29,8);
  ctx.box(fadedWood,6.1,.19,.2,-45,5.95,-29);
  ctx.box(canvas,3.4,1.75,.05,-45.9,4.9,-29);
  for (let i = 0; i < 9; i++) {
    ctx.box(fadedWood,.29,2.4,.24,-56+i*2.62,1.2,-28.48);
    ctx.box(fadedWood,.28,2.1,.2,-54+i*2.2,1.05,-36.53);
  }

  const ribs = [];
  for (const [x,z,length,alongX] of [[36,-29,16,true],[55,-30,19,false],[45,-43,13,true],[34,-40,9,false]]) {
    for (let p = -length/2+.48; p < length/2; p += .62) {
      ribs.push(alongX ? [x+p,1.4,z+1.42,.085,2.63,.075] : [x-1.42,1.4,z+p,.075,2.63,.085]);
    }
    if (alongX) ctx.box(steel,length,.12,.12,x,2.72,z+1.45);
    else ctx.box(steel,.12,.12,length,x-1.45,2.72,z);
  }

  for (const [x,z] of [[-8,-9],[8,-9],[-8,9],[8,9]]) {
    ctx.cylinder(timber,.085,2.1,x,4.25,z,6);
    ctx.box(canvas,1.24,.72,.045,x+.59,4.83,z);
    ctx.box(fadedWood,6.2,.16,.8,x,3.17,z);
  }
  ctx.scatter(new BoxGeometry(1,1,1), {color:0xffffff,rough:.9}, hatches);
  ctx.scatter(new BoxGeometry(1,1,1), steel, ribs);
}

function nearTrail(x, z) {
  for (const route of blacktideTrails) for (let i = 1; i < route.length; i++) {
    const [ax,az] = route[i-1], dx = route[i][0]-ax, dz = route[i][1]-az;
    const along = Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));
    if ((x-ax-along*dx)**2+(z-az-along*dz)**2 < 2.15**2) return true;
  }
  return false;
}

function blades() {
  const vertices = [
    -.12,0,0, .10,0,0, .035,.49,.04,
    0,0,-.11, 0,0,.13, -.04,.35,.02,
    -.19,0,.11, -.05,0,.16, -.24,.3,.17,
  ];
  const doubleSided = vertices.slice();
  for (let i = 0; i < vertices.length; i += 9) {
    doubleSided.push(...vertices.slice(i,i+3),...vertices.slice(i+6,i+9),...vertices.slice(i+3,i+6));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(doubleSided,3));
  geometry.computeVertexNormals();
  return geometry;
}

export function addBlacktideDetails(ctx, solids) {
  landmarkDetails(ctx);
  const rng = mulberry32(3019);
  const samples = (count, make) => {
    const result = [];
    for (let attempts = 0; result.length < count && attempts < count * 4; attempts++) {
      const x = rng()*154-77, z = rng()*122-61;
      if (nearTrail(x,z)) continue;
      let y = 0, blocked = false;
      for (const b of solids) {
        if (x <= b.minX-.25 || x >= b.maxX+.25 || z <= b.minZ-.25 || z >= b.maxZ+.25) continue;
        if (b.kind !== 'hill') { blocked = true; break; }
        y = Math.max(y,b.maxY);
      }
      if (!blocked) result.push(make(x,y,z,.65+rng()*.8,rng()*Math.PI*2,rng()));
    }
    return result;
  };
  ctx.scatter(blades(), {color:0xffffff,rough:1},
    samples(3300,(x,y,z,s,a,t) => [x,y,z,s,s,s,a,t < .35 ? 0x586b3d : t < .7 ? 0x82904b : 0xa2a36c]),
    [0,740,1850,3300]);
  ctx.scatter(new IcosahedronGeometry(1,0), {color:0xffffff,rough:1},
    samples(500,(x,y,z,s,a,t) => [x,y+.11*s,z,.29*s,.18*s,.21*s,a,t < .5 ? 0x66695f : 0xa49d8a]),
    [32,120,260,500]);
  ctx.scatter(new IcosahedronGeometry(1,0), {color:0xffffff,rough:1},
    samples(340,(x,y,z,s,a,t) => [x,y+.21*s,z,.085*s,.14*s,.083*s,a,t < .6 ? 0xd4b36c : 0xc0a4a9]),
    [0,0,90,340]);
}
