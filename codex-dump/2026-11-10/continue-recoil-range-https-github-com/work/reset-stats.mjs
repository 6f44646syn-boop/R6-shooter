import fs from 'node:fs';
const p='tools/compare-pack.mjs';let s=fs.readFileSync(p,'utf8');s=s.replace('const draw=()=>{renderer.setRenderTarget(null);','const draw=()=>{renderer.info.reset();renderer.setRenderTarget(null);');fs.writeFileSync(p,s);
