import fs from 'node:fs';const p=process.argv[2]+'/js/battle/battle.js';let s=fs.readFileSync(p,'utf8');const a=s.indexOf('    rec.frames.push({ version: 2, t, d:');const b=s.indexOf('\n    while (rec.frames.length',a);s=s.slice(0,a)+`    // Keep the original ten fields first so legacy replay frames remain readable.
    const actors = this.fighters.map(f => [
      f.id, f.x, f.y, f.z, f.yaw + (f.viewDY || 0), f.pitch + (f.viewDP || 0),
      f.crouch, f.alive ? 1 : 0, t < f.flashUntil ? 1 : 0, f.ads || 0,
      f.lean || 0, slotIn(this.deps.guns, f.gun), f.gun?.attach || null,
      f.skin ?? null, f.viewOptic || this.deps.opticFor(f.gun).id,
    ]);
    rec.frames.push({ version: 2, t, d: actors });`+s.slice(b);fs.writeFileSync(p,s);
