import fs from 'node:fs';
const edit=(p,fn)=>fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));
edit('js/main.js',s=>"import { loadPackArt } from './render/pack-art.js?v=m6-integration';\n"+s.replace('await HDPack.loadGuns();','await Promise.all([HDPack.loadGuns(), loadPackArt()]);'));
edit('js/modes/look.js',s=>s.replace('const cache = new Map();','const cache = new Map();\nlet bakeScale = 1;').replace('if (cache.has(key)) return cache.get(key);','if (bakeScale === 1 && cache.has(key)) return cache.get(key);').replace('cv.width = w; cv.height = h;','cv.width = w * bakeScale; cv.height = h * bakeScale;').replace("const g = cv.getContext('2d');","const g = cv.getContext('2d'); g.scale(bakeScale, bakeScale);").replace('cache.set(key, t);',"t.userData.surface = key;\n  if (bakeScale === 1) cache.set(key, t);")+`\n// Offline authoring: rerun the original vector patterns at higher resolution.\nexport function bakeMapSurface(name, scale = 4) { bakeScale = scale; try { return TEX[name](); } finally { bakeScale = 1; } }\n`);
edit('js/modes/game.js',s=>"import { applyMapArt } from '../render/pack-art.js?v=m6-integration';\n"+s.replace('if (!this.scene) return;\n    if (this.arena)',"if (!this.scene) return;\n    const artQuality = effectiveGraphics(this.deps.settings);\n    applyMapArt(this.lookGroup, artQuality, this.deps.renderer);\n    if (this.fig) for (const f of this.fig.values()) f.setDetail(artQuality);\n    if (this.arena)").replace('f.setLook(a.gunData,','f.setDetail(effectiveGraphics(d.settings));\n      f.setLook(a.gunData,'));
edit('js/battle/soldier.js',s=>"import { packArt } from '../render/pack-art.js?v=m6-integration';\n"+s.replace('soldierGeometry(team) {\n  if (cache.has(team)) return cache.get(team);',"soldierGeometry(team, enhanced = false) {\n  const key = team + ':' + (enhanced && packArt.soldier ? packArt.revision : 0);\n  if (cache.has(key)) return cache.get(key);").replace('const out = { upper: merge(parts)',`if (enhanced && packArt.soldier) for (const p of packArt.soldier) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.position.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.normal.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(p.index.slice(), 1));
    add(g, { webbing: 0x454b3f, stitch: 0x74745d, gear: GEAR, black: BLACK, glass: 0x445b62 }[p.role] || GEAR);
  }
  const out = { upper: merge(parts)`).replace('cache.set(team, out);','cache.set(key, out);'));
edit('js/battle/fighter.js',s=>s.replace('  get eyeH()',`  setDetail(quality) {
    const geo = soldierGeometry(this.color, quality === 'high' || quality === 'ultra');
    this.body.geometry = geo.upper;
    this.legs[0].piv.children[0].geometry = geo.legL;
    this.legs[1].piv.children[0].geometry = geo.legR;
  }

  get eyeH()`));
edit('js/battle/battle.js',s=>s.replace('  _look(f, gun, skin, mine = this.humans.some((h) => h.f === f)) {','  _look(f, gun, skin, mine = this.humans.some((h) => h.f === f)) {\n    f.setDetail(effectiveGraphics(this.deps.settings));'));
