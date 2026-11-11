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
const importFinale="import { MatchFinale } from '../replay/finale.js?v=3a5db4d-mwbgfx6u';\n";
edit('js/modes/game.js',[
  ['import { GrenadeReplay }',importFinale+'import { GrenadeReplay }'],
  ['    this._buildHud();','    this._buildHud();\n    this.finale = new MatchFinale(this.hud.end, this.hud.endTable);'],
  ['    this.grenadeView.reset();','    this.grenadeView.reset();\n    this.finale.reset();\n    this.lastKill = null;'],
  ['  update(t) {\n    if (!this.active) return;','  update(t) {\n    if (!this.active) return;\n    if (this.over && this.finale.active) { this._updateFinale(t); return; }'],
  ['        if (v === me) { this.killedBy = k ? k.name : \'the world\'; if (k && k !== me) this._startKc(k, e, t); }',`        if (k && k !== v) this.lastKill = this._killClip(k, e);
        if (v === me) {
          this.killedBy = k ? k.name : 'the world';
          if (k && k !== me) this._startKc(k, e, t, this.lastKill);
        }`],
  ["this._showEnd(e.winner === 'draw' ? 'Draw' : won ? 'Your team wins' : 'Your team loses', e.reason);","this._showEnd(e.winner === 'draw' ? 'Draw' : won ? 'Your team wins' : 'Your team loses', e.winner, t);"],
  ['    if (this.kc) return;\n    const last = R.frames.at(-1);','    const last = R.frames.at(-1);'],
  ['  _startKc(k, e, t) {',`  _killClip(killer, event) {
    const { frames, shots } = this.rec;
    const deathT = this.m.t;
    const from = Math.max(frames[0]?.t ?? deathT, deathT - 2.1);
    return {
      by: killer.id, name: killer.name, deathT, from,
      grenade: this.grenadeKills.get(event),
      rec: { frames: frames.filter(frame => frame.t >= from - 1 / 30), shots: shots.filter(shot => shot.t >= from) },
    };
  }
  _startKc(k, e, t, clip = this._killClip(k, e)) {`],
  ['    this.kc = { grenade: this.grenadeKills.get(e), prevT: t + 0.3, by: k.id, deathT: m.t, start: t + 0.3, from: m.t - 2.1, si: 0, fi: 0 };\n    this.kc.si = this.rec.shots.findIndex((s) => s.t >= this.kc.from); if (this.kc.si < 0) this.kc.si = this.rec.shots.length;','    this.kc = { ...clip, prevT: t + 0.3, start: t + 0.3, si: 0, fi: 0 };'],
  ['    this.rec.frames.length = 0; this.rec.shots.length = 0;\n  }','  }'],
  ['    const kc = this.kc, m = this.m, R = this.rec;\n    if (this.me.alive)', '    const kc = this.kc, m = this.m, R = kc.rec || this.rec;\n    if (this.me.alive && !kc.final)'],
  ['  render() {\n    if (!this.active) return;\n    const r', '  render() {\n    if (!this.active || this.finale.render(this.deps.renderer)) return;\n    const r'],
  ['  _showEnd(title, reason) {',`  _updateFinale(t) {
    this.grenadeCam = null;
    this.grenadeView.hide();
    if (this.finale.replaying(t) && this.kc) {
      this._replay(t);
      this._camera(t);
      this.deps.sfx.listen(this.camOverride || this.h.camera);
      this._updateTracers(t);
    } else {
      this.kc = null;
      this.camOverride = null;
    }
  }
  _showEnd(title, winner, t) {`],
  ['    H.end.hidden = false;\n    this.h.releaseAll();',`    H.end.hidden = false;
    H.kcBox.hidden = true;
    const lineup = rows.filter(actor => winner === 'draw' || actor.team === winner);
    const clip = this.lastKill;
    const replayable = clip && (clip.grenade || clip.rec.frames.length);
    this.kc = replayable ? { ...clip, final: true, start: t, prevT: t, si: 0, fi: 0 } : null;
    if (this.kc && !this.kcCam) this.kcCam = new THREE.PerspectiveCamera(70, 1, 0.03, 300);
    const seconds = replayable ? clip.grenade ? this.grenadeView.duration(clip.grenade) + 1 : clip.deathT - clip.from + 0.3 : 0;
    this.finale.begin(t, lineup.map(actor => ({ name: actor.name, figure: this.fig.get(actor.id) })),
      replayable ? { name: clip.name, seconds } : null);
    this.h.releaseAll();`],
]);
edit('js/battle/battle.js',[
  ['import { GrenadeReplay }',importFinale+'import { GrenadeReplay }'],
  ['    this._buildHud();','    this._buildHud();\n    this.finale = new MatchFinale(this.hud.end, this.hud.endTable);'],
  ['    this.grenadeView.reset();','    this.grenadeView.reset();\n    this.finale.reset();'],
  ['  update(t) {\n    if (!this.active) return;','  update(t) {\n    if (!this.active) return;\n    if (this.over && this.finale.active) { this._updateFinale(t); return; }'],
  ['if (this.teamScore[by.team] >= goal) this._end(by.team);','if (this.teamScore[by.team] >= goal) this._end(by.team, by, grenade);'],
  ['  _end(team) {','  _end(team, killer = null, grenade = null) {'],
  ["    if (this.net) this._broadcast({ k: 'end', title, rows, team });",`    if (this.net) {
      const lastShot = this.rec?.shots.at(-1);
      const shot = killer && lastShot?.by === killer.id && Math.abs(lastShot.t - this.t) < 0.1 ? lastShot : null;
      this._broadcast({ k: 'end', title, rows, team, killerId: killer?.id, shot });
    }`],
  ['    this._showEnd(title, rows, true);','    this._showEnd(title, rows, true, team, this.t, killer, grenade);'],
  ['  _showEnd(title, rows, canRestart) {','  _showEnd(title, rows, canRestart, team, t, killer, grenade) {'],
  ['    this.hud.end.hidden = false;\n  }',`    this.hud.end.hidden = false;
    this.kc = null;
    if (killer) {
      this._record(t, true);
      this._startKillCam(t, killer, grenade);
    }
    const lineup = this.fighters.filter(f => !team || f.team === team)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.finale.begin(t, lineup.map(f => ({ name: f.name, figure: f })),
      this.kc ? { name: killer.name, seconds: this.kc.until - t } : null);
  }`],
  ['      this._showEnd(m.title, m.rows, false);',`      const killer = this.fighters.find(f => f.id === m.killerId);
      const shot = m.shot;
      const last = this.rec?.shots.at(-1);
      if (killer && shot?.by === killer.id && this.rec
        && [shot.a, shot.b].every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))
        && !(last?.by === killer.id && t - last.t < 0.15 && last.b.every((value, i) => Math.abs(value - shot.b[i]) < 0.05))) {
        this.rec.shots.push({ ...shot, t });
      }
      this._showEnd(m.title, m.rows, false, m.team, t, killer);`],
  ['  render() {\n    if (!this.active) return;','  render() {\n    if (!this.active || this.finale.render(this.deps.renderer)) return;'],
  ['  _record(t) {','  _record(t, force = false) {'],
  ['    if (last && t - last.t < 1 / 30 - 1e-6) return;', '    if (last && t - last.t < 1 / 30 - 1e-6) {\n      if (!force) return;\n      rec.frames.pop();\n    }'],
  ['  _startKillCam(t) {','  _startKillCam(t, finalKiller = null, finalGrenade = null) {'],
  ['    const k = this.fighters.find((g) => g.id === h.killerId && g !== h.f);','    const k = finalKiller || this.fighters.find((g) => g.id === h.killerId && g !== h.f);'],
  ['    const grenade = this.grenadeDeath;','    const grenade = finalKiller ? finalGrenade : this.grenadeDeath;'],
  ['pov: this.kcPov !== false, prevT: t','pov: !!finalKiller || this.kcPov !== false, prevT: t'],
  ['  _killCam(t) {\n    this.grenadeCam',`  _updateFinale(t) {
    this.grenadeCam = null;
    this.grenadeView.hide();
    if (this.finale.replaying(t) && this.kc) {
      this._playKillCam(t);
      this.deps.sfx.listen(this.grenadeCam || this.humans[0].camera);
      this._updateTracers(t);
    } else {
      this.kc = null;
    }
  }
  _killCam(t) {
    if (this.over && this.finale.active) { this._updateFinale(t); return; }
    this.grenadeCam`],
  ['    if (!this.kc) return;\n    if (this.kc.grenade) {','    if (this.kc) this._playKillCam(t);\n  }\n  _playKillCam(t) {\n    const h = this.humans[0];\n    if (this.kc.grenade) {'],
]);
