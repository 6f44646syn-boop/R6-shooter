import fs from 'node:fs';const root=process.argv[2];
const edit=(p,fn)=>{const f=root+'/'+p;fs.writeFileSync(f,fn(fs.readFileSync(f,'utf8')));};
edit('js/modes/game.js',s=>s.replace('        P.rig.update(Math.max(0, Math.min(0.1, t - kc.prevT)), ads, t);','        P.rig.update(Math.max(0, Math.min(0.1, t - kc.prevT)), ads, t);\n        if (P.reticle) P.reticle.material.opacity = Math.min(1, Math.max(0, (ads - 0.55) / 0.35));'));
edit('js/battle/battle.js',s=>s.replace('    // shots fired in the replayed moment\n', '    if (kill && kc.pov) this._puppet(kc.killer, kill.recorded);\n    // shots fired in the replayed moment\n'));
edit('package.json',s=>{const p=JSON.parse(s);p.scripts['test:replay']='node tests/replay-browser.mjs';return JSON.stringify(p,null,2)+'\n';});
