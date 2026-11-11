import fs from 'node:fs';
const p='js/render/pack-art.js';let s=fs.readFileSync(p,'utf8').replace('m.bumpMap=tex;m.bumpScale=0.006;',"m.bumpMap=quality==='ultra'?tex:null;m.bumpScale=0.002;");fs.writeFileSync(p,s);
