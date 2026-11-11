import fs from 'node:fs';
const root=process.argv[2];
function edit(path, replacements) {
  const file=root+'/'+path;
  let source=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');
  for(const [before,after] of replacements) {
    if(!source.includes(before)) throw new Error(path+': missing '+before);
    source=source.replace(before,after);
  }
  fs.writeFileSync(file,source);
}
const importGrenade="import { GrenadeReplay } from '../replay/grenade.js?v=3a5db4d-mwbgfx6u';\n";
edit('js/modes/game.js',[
  ['import { replayCamera }',importGrenade+'import { replayCamera }'],
  ['    this._buildHud();','    this.grenadeView = new GrenadeReplay();\n    this.grenadeKills = new WeakMap();\n    this._buildHud();'],
  ['    this.deps.sfx.stopAll?.();','    this.deps.sfx.stopAll?.();\n    this.grenadeView.reset();'],
  ['pause() { if (!this.active) return;', 'pause() { if (!this.active) return; this.grenadeView.release();'],
  ['    while (this.acc >= TICK && n < 8) { m.step(); this._record(); this.acc -= TICK; n++; }',`    while (this.acc >= TICK && n < 8) {
      const grenades = m.nades.live, eventStart = m.events.length;
      m.step();
      if (grenades.length) this._grenadeEvents(grenades, eventStart);
      this.grenadeView.sample(m.nades.live, m.t);
      this._record();
      this.acc -= TICK;
      n++;
    }`],
  ['  _recShot(e) {',`  _grenadeEvents(grenades, eventStart) {
    const { events, t } = this.m;
    const kills = [];
    const matched = new Set();
    for (let i = eventStart; i < events.length; i++) {
      const event = events[i];
      if (event.type === 'kill' && event.kind === 'nade') kills.push(event);
      if (event.type !== 'boom' || !event.nade) continue;
      // Each grenade emits its kill events before its boom. Position and owner
      // disambiguate simultaneous blasts without guessing at a projectile ID.
      const candidates = grenades.filter(n => !n.alive && n.end <= t && !matched.has(n)
        && n.x === event.x && n.z === event.z && Math.max(0.15, n.y) === event.y
        && kills.every(kill => !kill.by || kill.by === n.owner));
      if (candidates.length === 1) {
        const grenade = candidates[0];
        matched.add(grenade);
        const track = this.grenadeView.explode(grenade, t, event);
        for (const kill of kills) this.grenadeKills.set(kill, track);
      }
      kills.length = 0;
    }
  }
  _recShot(e) {`],
  ['this.kc = { prevT: t + 0.3, by: k.id,','this.kc = { grenade: this.grenadeKills.get(e), prevT: t + 0.3, by: k.id,'],
  ["el('b', '', 'KILL CAM')","el('b', '', this.kc.grenade ? 'GRENADE REPLAY' : 'KILL CAM')"],
  ['    if (t < kc.start) return;\n    const rt',`    if (t < kc.start) return;
    if (kc.grenade) {
      this.grenadeCam = this.grenadeView.replay(kc.grenade, t - kc.start, this.scene, this.map.world);
      if (!this.grenadeCam) this._endKc();
      return;
    }
    const rt`],
  ['    if (this.kc) this._replay(t);','    this.grenadeCam = null;\n    this.grenadeView.hide();\n    if (!me.alive) this.grenadeView.release();\n    if (this.kc) this._replay(t);'],
  ['    if (this.kc && this.kcCam && t >= this.kc.start) over = this.kcCam;',`    const liveGrenade = me.alive && !this.paused && !this.over && this.grenadeView.live(m.t, this.map.world);
    if (this.grenadeCam) over = this.grenadeCam;
    else if (this.kc && this.kcCam && !this.kc.grenade && t >= this.kc.start) over = this.kcCam;
    else if (liveGrenade) over = liveGrenade;`],
  ['      const now = this.prevT;\n      if (down || (code === \'CapsLock\' && now - (this._capsDown || -9) > 0.6)) { if (down) this._capsDown = now; if (this.me.alive && !this.paused && !this.over) this.m.nades.throw(this.me, this.h.look.yaw, this.h.look.pitch); }',`      const now = this.prevT;
      if (!down) this.grenadeView.release();
      if (down || (code === 'CapsLock' && now - (this._capsDown || -9) > 0.6)) {
        if (down) this._capsDown = now;
        if (me.alive && !this.paused && !this.over) {
          const grenade = this.m.nades.throw(me, h.look.yaw, h.look.pitch);
          if (down && code === 'KeyG' && this.m.nades.live.includes(grenade)) this.grenadeView.hold(grenade, this.m.t);
        }
      }`],
]);
edit('js/battle/battle.js',[
  ['import { replayCamera }',importGrenade+'import { replayCamera }'],
  ['    this._buildHud();','    this.grenadeView = new GrenadeReplay();\n    this._buildHud();'],
  ['    this.rec = null; this.kc = null; this._meAlive = false;','    this.rec = null; this.kc = null; this._meAlive = false;\n    this.grenadeView.reset();\n    this.grenadeDeath = null; this.grenadeCam = null;'],
  ['pause() { if (!this.active) return; this.paused = true;', 'pause() { if (!this.active) return; this.grenadeView.release(); this.paused = true;'],
  ['    this.nadesB.update(this.over ? 0 : dt, t);','    this.nadesB.update(this.over ? 0 : dt, t);\n    this.grenadeView.sample(this.nadesB.live, t);'],
  ['    this._killCam(t);\n    const ears',`    this._killCam(t);
    if (!this.kc && !this.paused && !this.over && this.humans[0]?.f.alive) {
      this.grenadeCam = this.grenadeView.live(t, this.arena.world);
    }
    const ears`],
  ['this.deps.sfx.listen(ears.camera);','this.deps.sfx.listen(this.grenadeCam || ears.camera);'],
  ['  _damage(g, dmg, by, zone, t) {','  _damage(g, dmg, by, zone, t, grenade = null) {'],
  ['    if (hv) { hv.killedBy = by.name; hv.killerId = by.id; }','    if (hv) { hv.killedBy = by.name; hv.killerId = by.id; }\n    if (hv === this.humans[0]) this.grenadeDeath = grenade;'],
  ["if (code === 'KeyV' && this.kc && !p1.f.alive)", "if (code === 'KeyV' && this.kc && !this.kc.grenade && !p1.f.alive)"],
  ["    if (code === 'CapsLock' || code === 'KeyG') {\n      if (this.net", "    if (code === 'CapsLock' || code === 'KeyG') {\n      if (!down) this.grenadeView.release();\n      if (this.net"],
  ['        if (this.nadesB.throw(p1.f, p1.look.yaw, p1.look.pitch, this.t)) { if (p1.rig.melee) p1.rig.melee(); this.deps.sfx.knife(0.6); }',`        const grenade = this.nadesB.throw(p1.f, p1.look.yaw, p1.look.pitch, this.t);
        if (grenade) {
          if (down && code === 'KeyG') this.grenadeView.hold(grenade, this.t);
          if (p1.rig.melee) p1.rig.melee();
          this.deps.sfx.knife(0.6);
        }`],
  ['      if (h.camera.aspect !== aspect) { h.camera.aspect = aspect; h.camera.updateProjectionMatrix(); }','      const grenadeCam = i === 0 && this.grenadeCam;\n      const camera = grenadeCam || h.camera;\n      if (camera.aspect !== aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); }'],
  ['if (wp && wp.active) wp.draw(this.arena.scene, h.camera); else r.render(this.arena.scene, h.camera);\n      h.f.group.visible = ownVis;','if (wp && wp.active) wp.draw(this.arena.scene, camera); else r.render(this.arena.scene, camera);\n      h.f.group.visible = ownVis;\n      if (grenadeCam) return;'],
  ['    const rec = this.rec;\n    if (!k', '    const rec = this.rec;\n    const grenade = this.grenadeDeath;\n    this.grenadeDeath = null;\n    if (!k'],
  ['    this.lastKillCam = { killer:', '    if (grenade) { this.kc.grenade = grenade; this.kc.until = t + this.grenadeView.duration(grenade) + 1; }\n    this.lastKillCam = { killer:'],
  ['  _killCam(t) {\n    const h', '  _killCam(t) {\n    this.grenadeCam = null;\n    this.grenadeView.hide();\n    const h'],
  ['    if (!this.kc) return;\n    const kc = this.kc, rec',`    if (!f.alive) this.grenadeView.release();
    if (!this.kc) return;
    if (this.kc.grenade) {
      this.grenadeCam = this.grenadeView.replay(this.kc.grenade, t - this.kc.start, this.arena.scene, this.arena.world);
      return;
    }
    const kc = this.kc, rec`],
  ["(this.kc.pov ? 'THEIR VIEW' : 'REPLAY')","(this.kc.grenade ? 'GRENADE' : this.kc.pov ? 'THEIR VIEW' : 'REPLAY')"],
  ["(this.kc ? ' · V: ' + (this.kc.pov ? 'shoulder view' : 'their view') + ' · Space: skip' : '')","(this.kc ? (this.kc.grenade ? '' : ' · V: ' + (this.kc.pov ? 'shoulder view' : 'their view')) + ' · Space: skip' : '')"],
]);
edit('js/battle/nades.js',[
  ['    for (const g of B.fighters) {','    const replay = B.grenadeView.explode(n, t);\n    for (const g of B.fighters) {'],
  ["B._damage(g, dmg, by, 'torso', t);","B._damage(g, dmg, by, 'torso', t, replay);"],
]);
