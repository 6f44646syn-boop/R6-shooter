import fs from 'node:fs';
const p='js/modes/game.js';
let s=fs.readFileSync(p,'utf8');
function edit(a,b){if(!s.includes(a))throw new Error(a);s=s.replace(a,Array.isArray(b)?b.join('\n'):b);}
edit('    this.lastKill = null;','    this.lastKill = null;\n    this.spectatorId = null; this.spectator = null;');
edit('    this._camera(t);\n    this.deps.sfx.listen(this.camOverride || h.camera);','    this._camera(t, dt);\n    this.deps.sfx.listen(this.camOverride || h.camera);');
const a=s.indexOf('        const optic = this.deps.opticById(loadout?.optic');
const b=s.indexOf('\n      }\n      if (a === this.me)',a);
if(a<0||b<0)throw new Error('replay rig');
s=s.slice(0,a)+[
'        this._firstPerson(this.kcCam, a, gun, loadout?.optic, loadout?.skin, {',
'          x: fig.x, y: fig.y, z: fig.z, eye: 1.6 - 0.48 * fig.crouch,',
'          yaw: fig.yaw + (stride > 7 ? L(11) : 0), pitch: fig.pitch + (stride > 7 ? L(12) : 0), ads, lean,',
'        }, t, Math.max(0, Math.min(0.1, t - kc.prevT)));',
].join('\n')+s.slice(b);
edit('  _earn(kind, head = false) {',[
'  _firstPerson(camera, actor, gun, sight, skin, pose, t, dt) {',
'    const d = this.deps, optic = d.opticById(sight || actor.op.sight, gun);',
"    if (!this.kcPuppet) this.kcPuppet = new Human(new Fighter({ name: 'view', team: actor.team, color: 0xffffff, human: true }), 'mouse', d, d.slotOf);",
"    const p = this.kcPuppet, key = [gun.id, gun.attach, optic.id, skin].join('|');",
'    if (p._key !== key) {',
'      p.deps = { ...d, opticFor: () => optic };',
'      p.rig.forceSkin = skin ?? null;',
'      p.setGun(gun);',
'      p._key = key;',
'    }',
'    replayCamera(camera, pose, d.settings, d.adsVFov(optic));',
'    p.rig.animations = d.settings.animations; p.rig.reloadP = -1; p.rig.sprinting = false; p.rig.bobY = 0;',
'    p.rig.update(dt, pose.ads, t);',
'    if (p.reticle) p.reticle.material.opacity = Math.min(1, Math.max(0, (pose.ads - 0.55) / 0.35));',
'  }',
'  _earn(kind, head = false) {']);
edit('  // The camera: your eyes, your drone, or (Bomb, down) a teammate\\x27s; jolt wobble, dread shake.'.replace('\\x27',"'"),[
'  _canSpectate() {',
"    return this.m.o.mode === 'bomb' && !this.me.alive && !this.kc && !this.over;",
'  }',
'  _livingTeammates() {',
'    return this.m.actors.filter(a => a.alive && a.team === this.me.team);',
'  }',
'  _cycleSpectator(direction) {',
'    const mates = this._livingTeammates();',
'    if (!mates.length) return;',
'    const index = mates.findIndex(a => a.id === this.spectatorId);',
'    this.spectatorId = mates[(Math.max(0, index) + direction + mates.length) % mates.length].id;',
'  }',
'  // The camera can follow your body, a drone, or a teammate in Bomb.']);
edit('  _camera(t) {','  _camera(t, dt = 0) {');
edit('    let over = null;\n    const d', '    let over = null;\n    this.spectator = null;\n    if (me.alive) this.spectatorId = null;\n    const d');
const c=s.indexOf("    } else if (!me.alive && m.o.mode === 'bomb') {");
const e=s.indexOf('    // effects on whatever camera is showing',c);
if(c<0||e<0)throw new Error('spectator camera');
s=s.slice(0,c)+[
'    } else if (this._canSpectate()) {',
'      const mates = this._livingTeammates();',
'      const actor = mates.find(a => a.id === this.spectatorId) || mates[0];',
'      if (actor) {',
'        this.spectator = actor;',
'        this.spectatorId = actor.id;',
'        const figure = this.fig.get(actor.id);',
'        if (!this.spectatorCam) this.spectatorCam = new THREE.PerspectiveCamera(70, 1, 0.03, 300);',
'        over = this.spectatorCam;',
'        this._firstPerson(over, actor, actor.gunData, actor.op.sight, figure.skin, {',
'          x: figure.x, y: figure.y, z: figure.z, eye: 1.6 - 0.48 * figure.crouch,',
'          yaw: figure.yaw + (actor.recoilYaw || 0), pitch: figure.pitch + (actor.recoilPitch || 0),',
'          ads: actor.ads || 0, lean: actor.lean || 0,',
'        }, t, dt);',
'      }',
'    }',
'    this.camOverride = over;',
].join('\n')+'\n'+s.slice(e);
edit('    if (wp && wp.active) wp.draw(this.scene, cam); else r.render(this.scene, cam);\n    h.f.group.visible = ownVis;',[
'    const drawWorld = () => { if (wp?.active) wp.draw(this.scene, cam); else r.render(this.scene, cam); };',
'    try {',
'      if (this.spectator) this._drawSpectatorWorld(cam, drawWorld);',
'      else drawWorld();',
'    } finally {',
'      h.f.group.visible = ownVis;',
'    }']);
edit('const rig = this.kc && this.camOverride === this.kcCam ?','const rig = this.spectator || (this.kc && this.camOverride === this.kcCam) ?');
edit('  /* ---------- input ---------- */',[
'  _drawSpectatorWorld(camera, draw) {',
'    const eye = camera.position.toArray(), saved = [];',
'    const hide = object => { if (object.visible) { saved.push(object); object.visible = false; } };',
'    for (const actor of this.m.actors) {',
'      const figure = this.fig.get(actor.id);',
'      if (actor === this.spectator) hide(figure.group);',
'      if (actor.team !== this.spectator.team) {',
'        if (!this.map.sight(eye, [figure.x, figure.y + 1.1 - 0.3 * figure.crouch, figure.z])) hide(figure.group);',
'        hide(figure.outline);',
'        for (const leg of figure.legs) hide(leg.o);',
'      }',
'    }',
'    try { draw(); }',
'    finally { for (const object of saved) object.visible = true; }',
'  }',
'',
'  /* ---------- input ---------- */']);
edit("    if (b === 0 && down && !this.me.alive && this.m.o.mode === 'bomb') { this.specIndex = (this.specIndex || 0) + 1; return; }",[
"    if (!this.me.alive && this.m.o.mode === 'bomb' && (b === 0 || b === 2)) {",
'      if (down && this._canSpectate()) this._cycleSpectator(b === 0 ? 1 : -1);',
'      return;',
'    }']);
edit("    if (code === 'Space' && this.kc) { if (down) this._endKc(); return true; }",[
"    if (code === 'Space' && this.kc) { if (down) this._endKc(); return true; }",
'    if (this._canSpectate() && /^Digit[1-5]$/.test(code)) {',
'      const mate = this._livingTeammates()[Number(code.at(-1)) - 1];',
'      if (down && mate) this.spectatorId = mate.id;',
'      return true;',
'    }']);
edit("    const dmsg = me.alive || this.kc ? '' :",[
"    const spectator = this.spectator ? 'Spectating ' + this.spectator.name + ' · Left / right click or 1–5 to switch' : '';",
"    const dmsg = me.alive || this.kc ? '' : spectator ||"]);
edit("const H = this.hud, yaw = this.camOverride ? this.camYaw : this.h.look.yaw, fov = 140;",[
'const H = this.hud, focus = this.spectator || this.me;',
'    const yaw = this.spectator ? this.spectator.yaw : this.camOverride ? this.camYaw : this.h.look.yaw, fov = 140;']);
edit("for (const k of mk) if (k.compass) items.push({ yaw: yawTo(k.x - this.me.x, k.z - this.me.z), txt: k.compass, cls: 'mg-cm', color: '#' + new THREE.Color(k.color || 0xffffff).getHexString(), dist: Math.round(Math.hypot(k.x - this.me.x, k.z - this.me.z)) });","for (const k of mk) if (k.compass) items.push({ yaw: yawTo(k.x - focus.x, k.z - focus.z), txt: k.compass, cls: 'mg-cm', color: '#' + new THREE.Color(k.color || 0xffffff).getHexString(), dist: Math.round(Math.hypot(k.x - focus.x, k.z - focus.z)) });");
fs.writeFileSync(p,s);

