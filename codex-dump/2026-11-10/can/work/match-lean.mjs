import fs from 'node:fs';const p=process.argv[2]+'/js/modes/game.js';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('h ? h.lean : 0','h ? h.lean : a.lean || 0'));
