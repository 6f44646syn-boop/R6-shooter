// Bakes the Enhanced Graphics pack's props (tools/hd/props.mjs) to hd/props/<name>.rrmz: one
// level of detail, ambient occlusion ray-traced over the whole prop, per-part material roles.
// node tools/build-props.mjs [name ...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { setDetail } from './hd/kit.mjs';
import { bake } from './hd/bake.mjs';
import { writeRRM } from './hd/format.mjs';
import { PROPS } from './hd/props.mjs';

const OUT = new URL('../hd/props/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
let total = 0;
for (const [name, def] of Object.entries(PROPS)) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now();
  setDetail(1);
  // coarse subdivision: props repeat dozens of times on a map (occlusion per vertex is enough)
  const lod = bake(def.build(), { L: def.L || 0.3, R: 0.05, rays: 24, maxD: 0.45 });
  const raw = writeRRM([lod], { name, size: def.size, bay: !!def.bay });
  const gz = gzipSync(raw, { level: 9 });
  writeFileSync(new URL(name + '.rrmz', OUT), gz);
  total += gz.length;
  const tris = lod.reduce((s, p) => s + p.idx.length / 3, 0);
  console.log(name.padEnd(10), 'tris', String(tris).padEnd(7), (gz.length / 1024).toFixed(0) + ' KB', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
console.log('props:', (total / 1048576).toFixed(1) + ' MB');
