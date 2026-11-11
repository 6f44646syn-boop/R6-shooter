import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {parseRRM} from '../js/render/hd-mesh.js';
const root=new URL('../hd/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',root)));
let total=0,surfaces=0;
for(const f of m.files){
 assert.ok(!f.path.includes('..')&&!f.path.includes('://'));
 const bytes=readFileSync(new URL(f.path,root));assert.equal(bytes.length,f.size,f.path+' size');assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.path+' hash');total+=bytes.length;
 if(f.path.endsWith('.png')){const size=Number(f.path.match(/-(512|1024)\.png$/)[1]);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);surfaces++;}
}
assert.equal(total,m.total);assert.ok(total<20*1048576,'pack stays under 20 MiB');assert.equal(surfaces,16);
const raw=gunzipSync(readFileSync(new URL('soldiers/equipment.rrmz',root))),mesh=parseRRM(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
const triangles=mesh.lods[0].reduce((n,p)=>n+p.index.length/3,0);assert.ok(triangles<=1200);
assert.equal(createHash('sha256').update(readFileSync(new URL('audio/recoil-range-audio-v1.rra',root))).digest('hex'),createHash('sha256').update(readFileSync(new URL('../packs/audio/recoil-range-audio-v1.rra',import.meta.url))).digest('hex'));
console.log(`PASS ${m.files.length} manifest files verified; ${total} bytes, 16 bounded surfaces, ${triangles} soldier triangles; audio byte-identical`);
