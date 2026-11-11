import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2];
const edit=(p,fn)=>{const file=path.join(root,p);const s=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');fs.writeFileSync(file,fn(s));};
const stamp='2bc20c5-mwb9w9ii';
fs.writeFileSync(path.join(root,'js/replay/view.js'),`// Shared first-person replay camera. Distances and roll match Human's live view.
const DEG = Math.PI / 180;
export function replayCamera(camera, pose, settings, adsFov) {
  const lean = Math.max(-1, Math.min(1, pose.lean || 0));
  const ads = Math.max(0, Math.min(1, pose.ads || 0));
  const yaw = pose.yaw * DEG;
  camera.position.set(pose.x + Math.cos(yaw) * 0.32 * lean,
    pose.y + pose.eye - 0.05 * Math.abs(lean), pose.z + Math.sin(yaw) * 0.32 * lean);
  camera.rotation.set(Math.max(-89, Math.min(89, pose.pitch)) * DEG, -yaw, -11 * lean * DEG, 'YXZ');
  const hip = Math.tan(settings.fov * DEG / 2), aim = Math.tan(adsFov * DEG / 2);
  const fov = 2 * Math.atan(hip + (aim - hip) * ads) / DEG;
  if (Math.abs(camera.fov - fov) > 0.001) { camera.fov = fov; camera.updateProjectionMatrix(); }
}
`);
edit('js/modes/game.js',s=>{
s=`import { replayCamera } from '../replay/view.js?v=${stamp}';\n`+s.replace("import { slotIn }", "import { effectiveGun, slotIn }");
s=s.replace('this.rec = { frames:', 'this.rec = { version: 2, frames:');
s=s.replace('while (this.acc >= TICK && n < 8) { m.step();', 'while (this.acc >= TICK && n < 8) { m.step(); this._record();');
s=s.replace('    this._record();\n    this._refreshPanels();','    this._refreshPanels();');
const a=s.indexOf('    const s = new Float32Array(m.actors.length * 7);');const b=s.indexOf('    while (R.hits.length',a);
s=s.slice(0,a)+`    const last = R.frames.at(-1);
    if (last && m.t - last.t < 1 / 30 - 1e-6) return;
    const stride = 13, s = new Float32Array(m.actors.length * stride);
    const loadouts = m.actors.map((a, i) => {
      const h = a === this.me ? this.h : null, gun = a.gunData;
      s.set([a.x, a.z, a.yaw, a.pitch, a.crouch, a.alive ? 1 : 0, a.y,
        h ? h.adsE : a.ads || 0, h ? h.lean : 0, slotIn(this.deps.guns, gun),
        m.t - (a.lastShot ?? -99) < 0.06 ? 1 : 0, h ? h.offset[0] : 0, h ? h.offset[1] : 0], i * stride);
      return { attach: gun.attach || null, skin: this.fig.get(a.id)?.skin ?? null, optic: a.op.sight };
    });
    R.frames.push({ version: 2, stride, t: m.t, s, loadouts });
    while (R.frames.length && R.frames[0].t < m.t - 6) R.frames.shift();
    while (R.shots.length && R.shots[0].t < m.t - 6) R.shots.shift();
`+s.slice(b);
s=s.replace('    this.kc = { by: k.id,', '    this.kc = { prevT: t + 0.3, by: k.id,');
s=s.replace('const fig = this.fig.get(a.id), o = k * 7;', 'const stride = A.stride || 7, fig = this.fig.get(a.id), o = k * stride;');
s=s.replace(`        this.kcCam.position.set(fig.x, fig.y + 1.6 - 0.45 * fig.crouch, fig.z);
        this.kcCam.rotation.set(fig.pitch * DEG, -fig.yaw * DEG, 0, 'YXZ');`, `        const L = j => A.s[o + j] + (B.s[o + j] - A.s[o + j]) * f;
        const ads = stride > 7 ? L(7) : 0, lean = stride > 7 ? L(8) : 0;
        const loadout = A.loadouts?.[k];
        const gun = loadout ? effectiveGun(this.deps.guns[A.s[o + 9]] || a.gunData, loadout.attach) : a.gunData;
        const optic = this.deps.opticById(loadout?.optic || a.op.sight, gun);
        if (!this.kcPuppet) this.kcPuppet = new Human(new Fighter({ name: 'replay', team: a.team, color: 0xffffff, human: true }), 'mouse', this.deps, this.deps.slotOf);
        const P = this.kcPuppet, key = gun.id + '|' + (gun.attach || '') + '|' + optic.id + '|' + (loadout?.skin ?? '');
        if (P._key !== key) {
          P.deps = { ...this.deps, opticFor: () => optic };
          P.rig.forceSkin = loadout?.skin ?? null; P.setGun(gun); P._key = key;
        }
        replayCamera(this.kcCam, { x: fig.x, y: fig.y, z: fig.z,
          eye: 1.6 - 0.48 * fig.crouch, yaw: fig.yaw + (stride > 7 ? L(11) : 0),
          pitch: fig.pitch + (stride > 7 ? L(12) : 0), ads, lean }, this.deps.settings, this.deps.adsVFov(optic));
        P.rig.animations = this.deps.settings.animations; P.rig.reloadP = -1; P.rig.sprinting = false; P.rig.bobY = 0;
        P.rig.update(Math.max(0, Math.min(0.1, t - kc.prevT)), ads, t);`);
s=s.replace('    // their shots, as they happened', '    kc.prevT = t;\n    // their shots, as they happened');
s=s.replace('      if (s.id !== kc.by) continue;', '      if (s.id !== kc.by) continue;\n      this.kcPuppet?.rig.kick();');
s=s.replace('    if (!this.camOverride) {\n      r.clearDepth();\n      h.rig.setAspect(aspect, sz.y);\n      r.render(h.rig.scene, h.rig.camera);\n    }',`    const rig = this.kc && this.camOverride === this.kcCam ? this.kcPuppet?.rig : !this.camOverride ? h.rig : null;
    if (rig) {
      r.clearDepth(); rig.setAspect(aspect, sz.y); r.render(rig.scene, rig.camera);
    }`);
return s;
});
edit('js/battle/battle.js',s=>{
s=`import { replayCamera } from '../replay/view.js?v=${stamp}';\n`+s;
s=s.replace('import { slotIn', 'import { effectiveGun, slotIn');
s=s.replace('    this.active = false;\n    this.paused = false;', '    this.active = false;\n    this.rec = null; this.kc = null; this._meAlive = false;\n    this.paused = false;');
s=s.replace('r2(g.ads || 0)]', 'r2(g.ads || 0), r2(g.lean || 0)]');
s=s.replace('      f.ads = Math.min(1, Math.max(0, +m.a || 0));','      f.ads = Math.min(1, Math.max(0, +m.a || 0));\n      f.lean = Number.isFinite(+m.l) ? Math.min(1, Math.max(-1, +m.l)) : 0;');
s=s.replace('light = 1, ads = 0] = e;', 'light = 1, ads = 0, lean = 0] = e;');
s=s.replace('f.light = !!light; f.ads = +ads || 0;', 'f.light = !!light; f.ads = +ads || 0; f.lean = Number.isFinite(+lean) ? Math.min(1, Math.max(-1, +lean)) : 0;');
s=s.replace('a: r2(f.ads) }, true)', 'a: r2(f.ads), l: r2(this.humans[0].lean) }, true)');
s=s.replace('    rec.frames.push({ t, d:', '    const last = rec.frames.at(-1);\n    if (last && t - last.t < 1 / 30 - 1e-6) return;\n    rec.version = 2;\n    rec.frames.push({ version: 2, t, d:');
s=s.replace('f.ads || 0]) });', `f.ads || 0, f.lean || 0, slotIn(this.deps.guns, f.gun), f.gun?.attach || null, f.skin ?? null, this.deps.opticFor(f.gun).id]) });`);
s=s.replace('rec.frames[0].t < t - 5', 'rec.frames[0].t < t - 6');
s=s.replace('this.kc = { killer: k,', 'this.kc = { rec: { frames: rec.frames.slice(), shots: rec.shots.slice() }, killer: k,');
s=s.replace('  _puppet(k) {', '  _puppet(k, recorded) {');
s=s.replace("const P = this.puppet, gun = k.gun || this.deps.guns[0], key = gun.id + '|' + k.skin;", `const P = this.puppet, base = recorded ? this.deps.guns[recorded[11]] : null;
    const gun = base ? effectiveGun(base, recorded[12]) : k.gun || this.deps.guns[0];
    const skin = recorded && recorded.length > 13 ? recorded[13] : k.skin;
    const optic = this.deps.catalogue?.[recorded?.[14]] || this.deps.opticFor(gun);
    const key = gun.id + '|' + (gun.attach || '') + '|' + skin + '|' + optic.id;`);
s=s.replace('P.rig.forceSkin = k.skin ?? null; P.setGun(gun);', 'P.deps = { ...this.deps, opticFor: () => optic }; P.rig.forceSkin = skin ?? null; P.setGun(gun);');
s=s.replace('const kc = this.kc, rec = this.rec,', 'const kc = this.kc, rec = kc.rec || this.rec,');
s=s.replace('const A = fr[Math.max(0, j - 1)], B = fr[j];','const A = fr[Math.max(0, j - 1)], B = fr[Math.min(j, fr.length - 1)];');
s=s.replace('ads: a[9] === undefined ? 0 : L(9) };', 'ads: a[9] === undefined ? 0 : L(9), lean: a[10] === undefined ? 0 : L(10), recorded: a };');
s=s.replace('const P = this._puppet(kc.killer),', 'const P = this._puppet(kc.killer, kill.recorded),');
const a=s.indexOf('      cam.position.set(kill.x, kill.y + kill.eye, kill.z);');const b=s.indexOf('      P.rig.animations',a);
s=s.slice(0,a)+`      const ads = Math.max(0, Math.min(1, kill.ads));
      replayCamera(cam, kill, s, this.deps.adsVFov(P.optic));
`+s.slice(b);
return s;
});
edit('js/battle/human.js',s=>s.replace('    f.viewDY = this.offset[0];', '    f.lean = this.lean;\n    f.viewDY = this.offset[0];'));
