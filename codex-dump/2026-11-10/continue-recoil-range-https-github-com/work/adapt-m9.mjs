import fs from 'node:fs';
function edit(path, pairs) {
  let s=fs.readFileSync(path,'utf8');
  for (const [a,b] of pairs) { if(!s.includes(a)) throw new Error(path+' '+a); s=s.replace(a,Array.isArray(b)?b.join('\n'):b); }
  fs.writeFileSync(path,s);
}
edit('js/replay/grenade.js',[
 ['  release() { this.held = null; }',[
 '  release() { this.held = null; this.pending = null; }',
 '  request(owner) { this.pending = { owner, id: null }; }',
 '  accept(owner, id) { if (this.pending?.owner === owner) this.pending.id = id; }',
 '  projectile(id) {',
 '    for (const nade of this.tracks.keys()) if (nade.id === id) return nade;',
 '    return null;',
 '  }',
 '  track(id) { return this.tracks.get(this.projectile(id)); }']],
 ['track = { samples: [],','track = { id: nade.id, samples: [],'],
 ['    for (const nade of live) this.record(nade, t);',[
 '    for (const nade of live) {',
 '      const track = this.record(nade, t);',
 '      if (this.pending && this.pending.id === nade.id) { this.held = track; this.pending = null; }',
 '    }']],
 ['(!track.blast || t - track.blast.t > 6)','t - (track.blast?.t ?? track.latest.t) > 6'],
 ['return Math.min(FLIGHT_LIMIT, track.blast.t - track.samples[0].t);','return Math.max(0, Math.min(FLIGHT_LIMIT, track.blast.t - track.samples[0].t));'],
]);
edit('js/battle/nades.js',[
 ['    this.live.push(n);\n  }\n  // Online (client): where','    this.live.push(n);\n    return n;\n  }\n  // Online (client): where'],
 ['    for (const n of this.live) if (n.ghost && n.id === m.id) n.done = true;\n    this.b._blast(+m.x || 0, +m.y || 0, +m.z || 0, t);',[
 '    const n = this.live.find(nade => nade.ghost && nade.id === m.id) || this.b.grenadeView.projectile(m.id);',
 '    const position = { x: +m.x || 0, y: +m.y || 0, z: +m.z || 0 };',
 '    if (n) n.done = true;',
 '    const track = n ? this.b.grenadeView.explode(n, t, position) : null;',
 '    this.b._blast(position.x, position.y, position.z, t);',
 '    return track;']],
]);
edit('js/battle/battle.js',[
 ['this.grenadeDeath = null; this.grenadeCam = null;', 'this.grenadeDeath = null; this.pendingGrenadeDeath = null; this.grenadeCam = null;'],
 ["vid: g.id, head: zone === 'head', t };","vid: g.id, head: zone === 'head', nadeId: grenade?.id, t };"],
 ["    if (m.k === 'nd') { this.nadesB.ghost(m, this.t); return; }\n    if (m.k === 'blast') { this.nadesB.remoteBlast(m, this.t); return; }",[
 "    if (m.k === 'nd') {",
 '      const grenade = this.nadesB.ghost(m, this.t);',
 '      if (grenade) this.grenadeView.accept(m.by, grenade.id);',
 '      return;',
 '    }',
 "    if (m.k === 'blast') {",
 '      const track = this.nadesB.remoteBlast(m, t);',
 '      if (!this.over && this.pendingGrenadeDeath === m.id) {',
 '        this.pendingGrenadeDeath = null;',
 '        this.grenadeDeath = track;',
 '        if (me && !me.f.alive) this._startKillCam(t);',
 '      }',
 '      return;',
 '    }']],
 ["    } else if (m.k === 'spawn' && me) {\n      me.f.alive","    } else if (m.k === 'spawn' && me) {\n      this.pendingGrenadeDeath = null;\n      this.grenadeDeath = null;\n      me.f.alive"],
 ['        if (!this.kc && me.killerId) this._startKillCam(t);',[
 '        if (m.e.nadeId != null) {',
 '          const track = this.grenadeView.track(m.e.nadeId);',
 '          if (track?.blast) this.grenadeDeath = track;',
 '          else this.pendingGrenadeDeath = m.e.nadeId;',
 '        }',
 '        if (!this.kc && me.killerId && this.pendingGrenadeDeath === null) this._startKillCam(t);']],
 ['    if (this._meAlive && !f.alive) this._startKillCam(t);','    if (this._meAlive && !f.alive && !this.kc && this.pendingGrenadeDeath === null) this._startKillCam(t);'],
 ['    this.nadesB.update(this.over ? 0 : dt, t);\n    this._updateBlasts(t);','    this.nadesB.update(this.over ? 0 : dt, t);\n    this.grenadeView.sample(this.nadesB.live, t);\n    this._updateBlasts(t);'],
]);
edit('js/modes/game.js',[
 ['        const track = this.grenadeView.explode(grenade, t, event);\n        for (const kill of kills) this.grenadeKills.set(kill, track);',[
 '        const track = this.grenadeView.explode(grenade, t, event);',
 '        event.nadeId = grenade.id;',
 '        for (const kill of kills) {',
 '          kill.nadeId = grenade.id;',
 '          this.grenadeKills.set(kill, track);',
 '        }']],
 ['  _recShot(e) {',[
 '  _networkGrenadeEvents() {',
 '    const { events, nades, t } = this.m;',
 '    if (!events.length) return;',
 '    for (const event of events) {',
 "      if (event.type === 'nadeThrow') this.grenadeView.accept(event.id, event.nade);",
 "      if (event.type !== 'boom' || event.nadeId === undefined) continue;",
 '      const grenade = this.grenadeView.projectile(event.nadeId);',
 '      if (grenade) this.grenadeView.explode(grenade, event.t ?? t, event);',
 '    }',
 '    for (const event of events) {',
 "      if (event.type !== 'kill' || event.nadeId === undefined) continue;",
 '      const track = this.grenadeView.track(event.nadeId);',
 '      if (track?.blast) this.grenadeKills.set(event, track);',
 '    }',
 '    this.grenadeView.sample(nades.live, t);',
 '  }',
 '  _recShot(e) {']],
 ['h ? h.offset[0] : 0, h ? h.offset[1] : 0','h ? h.offset[0] : a.recoilYaw || 0, h ? h.offset[1] : a.recoilPitch || 0'],
 ["        this.feed.unshift({ k: k ? (k === me","        if (this.netClient) { v.alive = false; v.hp = 0; }\n        this.feed.unshift({ k: k ? (k === me"],
 ["e.winner, t);","e.winner, t, e.results);"],
 ['  _showEnd(title, winner, t) {','  _showEnd(title, winner, t, results) {'],
 ['    const rows = m.actors.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);',[
 '    const scores = new Map((results || []).map(([id, kills, deaths]) => [id, { kills, deaths }]));',
 '    const rows = m.actors.map(actor => ({ ...actor, ...scores.get(actor.id) }))',
 '      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);']],
 ["a === this.me ? 'You (' + a.op.name + ')' : a.name","a.id === this.me.id ? 'You (' + a.op.name + ')' : a.name"],
]);
edit('js/modes/net-match.js',[
 ['      if (a.ab && a.ab.drone && msg.drone)',[
 '      a.lean = Math.max(-1, Math.min(1, fin(msg.lean)));',
 '      a.recoilYaw = Math.max(-89, Math.min(89, fin(msg.recoilYaw)));',
 '      a.recoilPitch = Math.max(-89, Math.min(89, fin(msg.recoilPitch)));',
 '      if (a.ab && a.ab.drone && msg.drone)']],
 ['a.alive ? 1 : 0, r1(a.speed || 0)]','a.alive ? 1 : 0, r1(a.speed || 0), r2(a.lean || 0), r2(a.recoilYaw || 0), r2(a.recoilPitch || 0)]'],
 ['r2(n.z), r2(n.end)]','r2(n.z), r2(n.end), n.owner, r2(n.vx), r2(n.vy), r2(n.vz)]'],
 ['    for (const e of list) { const x = encode(e, m, 0); if (x) out.push(x); }',[
 '    for (const e of list) {',
 "      const event = e.type === 'end' ? { ...e, results: m.actors.map(actor => [actor.id, actor.kills, actor.deaths]) } : e;",
 '      const encoded = encode(event, m, 0);',
 '      if (encoded) out.push(encoded);',
 '    }']],
 ['a.alive = alive; a.speed = row[10];','a.alive = alive; a.speed = row[10];\n      a.lean = fin(row[11]); a.recoilYaw = fin(row[12]); a.recoilPitch = fin(row[13]);'],
 ['end: r[5], alive: true','end: r[5], owner: r[6], vx: fin(r[7]), vy: fin(r[8]), vz: fin(r[9]), alive: true'],
 ['    const extra = {};','    const extra = { lean: r2(h.lean), recoilYaw: r2(h.offset[0]), recoilPitch: r2(h.offset[1]) };'],
]);

