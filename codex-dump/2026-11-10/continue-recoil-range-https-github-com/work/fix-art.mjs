import fs from 'node:fs';
const edit=(p,fn)=>fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));
edit('js/scene/viewmodel.js',s=>s.replace('disposeBaked(sk.albedo); disposeBaked(sk.rm);','disposeBaked(sk.albedo); disposeBaked(sk.rm); disposeBaked(sk.normal);').replace("m.userData.skinKey = def.id + '@' + skinSize();", "m.userData.skinKey = def.id + ':' + (packArt.finish ? packArt.revision : 0) + '@' + skinSize();"));
edit('js/render/pack-art.js',s=>s.replace('m.map=m.userData.packBase;delete', 'm.map=m.userData.packBase;m.bumpMap=null;delete').replace('m.userData.packBase=base;m.map=tex;', 'm.userData.packBase=base;m.map=tex;m.bumpMap=tex;m.bumpScale=0.006;'));
