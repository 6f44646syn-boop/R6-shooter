// Original close-fitting soldier equipment details, using the existing RRM codec.
import * as THREE from '../../vendor/three/three.module.min.js';
import { writeRRM } from './format.mjs';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
const parts=[];
function box(role,w,h,d,x,y,z){const g=new THREE.BoxGeometry(w,h,d).translate(x,y,z);const pos=Array.from(g.attributes.position.array), n=pos.length/3;parts.push({group:'upper',role,pos,nor:Array.from(g.attributes.normal.array),idx:Array.from(g.index.array),ao:Array(n).fill(1),edge:Array(n).fill(0),cavity:Array(n).fill(0)});g.dispose();}
// Carrier webbing with separate stitches, pouch lips, fasteners and shoulder straps.
for(const y of [1.16,1.21,1.26])for(const x of [-.15,-.09,-.03,.03,.09,.15]){
 box('webbing',.045,.012,.007,x,y,.158);
 for(const dx of [-.018,.018])box('stitch',.003,.014,.008,x+dx,y,.159);
}
for(const x of [-.12,0,.12]){
 box('gear',.094,.025,.008,x,1.128,.219);
 box('black',.018,.013,.009,x,1.113,.22);
 for(const dx of [-.041,.041])box('stitch',.002,.09,.005,x+dx,1.067,.218);
}
for(const s of [-1,1]){box('webbing',.045,.19,.009,s*.145,1.33,.158);box('black',.035,.025,.012,s*.145,1.38,.161);box('glass',.065,.032,.006,s*.043,1.617,.142);box('stitch',.028,.003,.008,s*.145,1.4,.16);}
box('black',.017,.055,.008,0,1.615,.143);
for(const x of [-.11,0,.11]){box('webbing',.024,.31,.008,x,1.2,-.298);box('stitch',.003,.29,.008,x+.009,1.2,-.299);}
const root=new URL('../../hd/soldiers/',import.meta.url);mkdirSync(root,{recursive:true});
writeFileSync(new URL('equipment.rrmz',root),gzipSync(writeRRM([parts],{name:'soldier-equipment',maxTriangles:1200}),{level:9}));
console.log('soldier details',parts.reduce((s,p)=>s+p.idx.length/3,0),'triangles');
