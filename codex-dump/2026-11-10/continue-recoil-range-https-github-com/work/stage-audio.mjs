import fs from 'node:fs';
for(const p of ['js/main.js','hd/manifest.json','js/ui/graphics-ui.js'])fs.writeFileSync('../'+p.replaceAll('/','_')+'.final',fs.readFileSync(p));
let main=fs.readFileSync('js/main.js','utf8').replace("import { loadPackArt } from './render/pack-art.js?v=m6-integration';\n",'').replace('await Promise.all([HDPack.loadGuns(), loadPackArt()]);','await HDPack.loadGuns();');fs.writeFileSync('js/main.js',main);
const m=JSON.parse(fs.readFileSync('hd/manifest.json'));m.files=m.files.filter(f=>f.path.startsWith('guns/')||f.path.startsWith('audio/'));m.total=m.files.reduce((s,f)=>s+f.size,0);fs.writeFileSync('hd/manifest.json',JSON.stringify(m,null,1)+'\n');
let ui=fs.readFileSync('js/ui/graphics-ui.js','utf8').replace('Detailed gun models, deeper weapon skins, map materials, soldier detail and 83 sound clips.','Detailed gun models, deeper weapon skins and 83 sound clips.');fs.writeFileSync('js/ui/graphics-ui.js',ui);
