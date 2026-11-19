import { BoxGeometry, BufferGeometry, Float32BufferAttribute, IcosahedronGeometry } from '../../vendor/three/three.module.min.js?v=25a8dbf-mwnd1mvm';
import { mulberry32 } from '../core/prng.js?v=25a8dbf-mwnd1mvm';

export const blacktideTrails = [
  [[-47,-23],[-33,-16],[-23,-10],[-12,-7],[-4,-5]],
  [[-46,25],[-37,20],[-29,14],[-19,9],[-7,7]],
  [[46,-28],[32,-18],[23,-12],[13,-8],[6,-5]],
  [[47,24],[36,19],[27,14],[19,10],[7,7]],
  [[-28,-51],[-36,-42],[-45,-36]],
  [[54,-46],[61,-28],[58,-16],[54,-6],[58,10],[52,21]],
  [[-38,48],[-26,50],[-14,47],[-8,37],[-6,26],[-5,13]],
];
// On the 3.2 m build grid (walls on grid lines, one-cell door).
// Watchtowers (platform on a cell centre) and the lighthouse.
export const watchtowers = [[-20.8,-56], [68.8,36.8], [-72,-17.6]];
export const lighthouse = [72, -56];
export const villageHouses = [[-49.6,30.4],[-36.8,30.4],[-43.2,43.2],[-30.4,43.2]];
export const villageHouse = {w:9.6,d:9.6,h:3.65,door:3.2};

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

  for (const [x,z] of [[-6.4,-9.6],[6.4,-9.6],[-6.4,9.6],[6.4,9.6]]) {
    ctx.cylinder(timber,.085,2.1,x,4.25,z,6);
    ctx.box(canvas,1.24,.72,.045,x+.59,4.83,z);
    ctx.box(fadedWood,6.2,.16,.8,x,3.17,z);
  }
  // watchtowers: four legs, rails, a little roof
  for (const [x,z] of watchtowers) {
    for (const [dx,dz] of [[-1.45,-1.45],[1.45,-1.45],[-1.45,1.45],[1.45,1.45]]) ctx.cylinder(timber,.13,4.5,x+dx,2.25,z+dz,6);
    for (const [dx,dz,w,d] of [[0,-1.55,3.2,.1],[0,1.55,3.2,.1],[-1.55,0,.1,3.2],[1.55,0,.1,3.2]]) if (dz !== -1.55) ctx.box(fadedWood,w,.1,d,x+dx,5.6,z+dz);
    for (const [dx,dz] of [[-1.45,-1.45],[1.45,-1.45],[-1.45,1.45],[1.45,1.45]]) ctx.cylinder(timber,.07,2.2,x+dx,5.9,z+dz,5);
    ctx.box(canvas,3.6,.14,3.6,x,7.05,z);
  }
  // the lighthouse: red and white bands, a glowing lamp room
  { const [x,z] = lighthouse;
    for (let i = 0; i < 7; i++) ctx.cylinder({ color: i % 2 ? 0xf2eee6 : 0xb83a33, rough:.7 }, 1.45 - i * .08, 2, x, 2.4 + i * 2, z, 16);
    ctx.cylinder({ color:0xfff2b0, rough:.3, emissive:0xffe08a }, .85, 1.3, x, 16, z, 12);
    ctx.cylinder({ color:0x2c3436, rough:.6 }, 1.15, .25, x, 16.8, z, 12); }
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
  ctx.scatter(blades(), {color:0xffffff,rough:1,sway:.12},
    samples(3300,(x,y,z,s,a,t) => [x,y,z,s,s,s,a,t < .35 ? 0x586b3d : t < .7 ? 0x82904b : 0xa2a36c]),
    [0,740,1850,3300]);
  ctx.scatter(new IcosahedronGeometry(1,0), {color:0xffffff,rough:1},
    samples(500,(x,y,z,s,a,t) => [x,y+.11*s,z,.29*s,.18*s,.21*s,a,t < .5 ? 0x66695f : 0xa49d8a]),
    [32,120,260,500]);
  ctx.scatter(new IcosahedronGeometry(1,0), {color:0xffffff,rough:1},
    samples(340,(x,y,z,s,a,t) => [x,y+.21*s,z,.085*s,.14*s,.083*s,a,t < .6 ? 0xd4b36c : 0xc0a4a9]),
    [0,0,90,340]);
  // flower patches: red, yellow, white and purple
  ctx.scatter(new IcosahedronGeometry(1,0), {color:0xffffff,rough:.8},
    samples(900,(x,y,z,s,a,t) => [x,y+.25*s,z,.12*s,.1*s,.12*s,a,[0xd2453b,0xf0c63c,0xf3efe6,0x9b6bd0][Math.floor(t*4)]]),
    [0,200,500,900]);
}
