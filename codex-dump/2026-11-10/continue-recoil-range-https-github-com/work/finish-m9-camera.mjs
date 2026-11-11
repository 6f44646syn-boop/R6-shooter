import fs from 'node:fs';
function edit(path,fn){fs.writeFileSync(path,fn(fs.readFileSync(path,'utf8')));}
edit('js/replay/grenade.js',s=>s
 .replace("  projectile(id) {\n    for (const nade of this.tracks.keys()) if (nade.id === id) return nade;\n    return null;\n  }\n  track(id) { return this.tracks.get(this.projectile(id)); }","  projectile(id) { return this.tracks.get(id)?.nade || null; }\n  track(id) { return this.tracks.get(id); }")
 .replace('    let track = this.tracks.get(nade);','    const key = nade.id ?? nade;\n    let track = this.tracks.get(key);')
 .replace('this.tracks.set(nade, track);','this.tracks.set(key, track);')
 .replace('    const { x, y, z, vx, vy, vz } = nade;', '    track.nade = nade;\n    const { x, y, z, vx, vy, vz } = nade;')
 .replace('const active = new Set(live);','const active = new Set(live.map(nade => nade.id ?? nade));')
 .replace('for (const [nade, track] of this.tracks) {\n      track.active = active.has(nade);','for (const [key, track] of this.tracks) {\n      track.active = active.has(key) && !track.blast;')
 .replace('this.tracks.delete(nade);','this.tracks.delete(key);'));
edit('js/battle/battle.js',s=>s
 .replace('        me.killedBy = m.e.k; me.killerId = m.e.kid || null;',[
 '        me.killedBy = m.e.k; me.killerId = m.e.kid || null;',
 '        me.f.alive = false; me.f.health = 0; me.f.respawnAt = t + RESPAWN_S;'].join('\n'))
 .replace('    this._killCam(t);\n    const ears = this.humans[0];\n    if (ears) { this.deps.sfx.listen(ears.camera);',[
 '    this._killCam(t);',
 '    if (!this.kc && !this.paused && !this.over && me?.f.alive) this.grenadeCam = this.grenadeView.live(t, this.arena.world);',
 '    const ears = this.humans[0];',
 '    if (ears) { this.deps.sfx.listen(this.grenadeCam || ears.camera);'].join('\n')));
edit('js/modes/game.js',s=>s
 .replace('me.ads = h.adsE;', 'me.ads = h.adsE;\n      me.lean = h.lean; [me.recoilYaw, me.recoilPitch] = h.offset;')
 .replace("      } else if (e.type === 'spawn' && e.id === me.id) {\n        this.deps.controls?.release();","      } else if (e.type === 'spawn' && e.id === me.id) {\n        if (this.netClient) me.alive = true;\n        this.deps.controls?.release();")
 .replace('this.deps.sfx.shot(this.m.actors.find((x) => x.id === s.id)?.gun.tone ?? 0.5, 0.5);','const gun = this.kcPuppet?.gun;\n      this.deps.sfx.shot(gun?.tone ?? 0.5, gun?.suppressed ? 0.225 : 0.5);'));

