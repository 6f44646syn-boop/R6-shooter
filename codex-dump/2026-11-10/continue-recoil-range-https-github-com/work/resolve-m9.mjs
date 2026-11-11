import fs from 'node:fs';
function edit(path,fn){fs.writeFileSync(path,fn(fs.readFileSync(path,'utf8')));}
function resolve(s, choices) {
  let i=0;
  const r=s.replace(/<<<<<<< HEAD\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> origin\/main\r?\n/g,(_,ours,theirs)=>choices[i++](ours,theirs));
  if(i!==choices.length) throw new Error('Conflict count '+i);
  return r;
}
edit('js/modes/game.js',s=>resolve(s,[
  ours=>ours,
  (ours,theirs)=>ours+theirs.split('\n').filter(l=>l.includes('net-match.js')||l.includes("from './bots.js")).join('\n')+'\n',
  (_,theirs)=>theirs.replace('      this.netClient.update(t, h);','      this.grenadeView.sample(m.nades.live, m.t);\n      this._networkGrenadeEvents();\n      this._record();\n      this.netClient.update(t, h);').replace('      while (this.acc >= TICK && n < 8) { m.step(); this.acc -= TICK; n++; }',[
'      while (this.acc >= TICK && n < 8) {',
'        const grenades = m.nades.live, eventStart = m.events.length;',
'        m.step();',
'        if (grenades.length) this._grenadeEvents(grenades, eventStart);',
'        this.grenadeView.sample(m.nades.live, m.t);',
'        this._record();',
'        this.acc -= TICK;',
'        n++;',
'      }'].join('\n')),
  ours=>ours.replace('          const grenade = this.m.nades.throw(me, h.look.yaw, h.look.pitch);\n          if (down && code === \'KeyG\' && this.m.nades.live.includes(grenade)) this.grenadeView.hold(grenade, this.m.t);',[
'          if (C) {',
"            if (down && code === 'KeyG') this.grenadeView.request(me.id);",
"            C.act('nade', { yaw: h.look.yaw, pitch: h.look.pitch });",
'          } else {',
'            const grenade = this.m.nades.throw(me, h.look.yaw, h.look.pitch);',
"            if (down && code === 'KeyG' && this.m.nades.live.includes(grenade)) this.grenadeView.hold(grenade, this.m.t);",
'          }'].join('\n')),
]));
edit('js/battle/battle.js',s=>resolve(s,[
  ours=>ours.replace('r2(g.ads || 0), r2(g.lean', 'r2(g.ads || 0), g.nades ?? 2, r2(g.lean'),
  ours=>ours.replace('ads = 0, lean', 'ads = 0, nades, lean'),
  (ours,theirs)=>ours.replace('if (this.net || this.paused || this.over)','if (this.paused || this.over)').replace('        const grenade =', [
"        if (this.net?.role === 'client') {",
'          const f = p1.f;',
'          if (!f.alive || (f.nades ?? 2) <= 0 || this.t < (f.nadeAt || 0)) return true;',
'          f.nades = (f.nades ?? 2) - 1;',
'          f.nadeAt = this.t + 1;',
"          if (down && code === 'KeyG') this.grenadeView.request(f.id);",
"          this.net.link.send({ k: 'nade', yaw: r1(p1.look.yaw), pitch: r1(p1.look.pitch) });",
'          p1.rig.melee?.();',
'          this.deps.sfx.knife(0.6);',
'          return true;',
'        }',
'        const grenade ='].join('\n')),
]));
edit('tests/replay-browser.mjs',s=>s.replaceAll('row[15]', 'row[16]').replaceAll('row[14]', 'row[15]'));

