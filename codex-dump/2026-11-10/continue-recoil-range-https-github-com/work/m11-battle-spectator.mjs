import fs from 'node:fs';
const p='js/battle/battle.js';let s=fs.readFileSync(p,'utf8');
const edit=(a,b)=>{if(!s.includes(a))throw Error(a);s=s.replace(a,Array.isArray(b)?b.join('\n'):b);};
edit('import { MatchFinale }',"import { SpectatorTools, spectatorVisibility } from '../replay/spectator.js?v=9dd0f7b-mwbioun8';\nimport { MatchFinale }");
edit('    this.finale = new MatchFinale(this.hud.end, this.hud.endTable);',[
'    this.finale = new MatchFinale(this.hud.end, this.hud.endTable);',
'    this.watch = new SpectatorTools(this.hud.root, this.deps.controls);',
'    this.watchers = [];']);
edit("    this.net = opts.remotes && opts.remotes.length ? { role: 'host' } : null;",[
'    this.watchers = opts.spectators || [];',
"    this.net = opts.remotes?.length || this.watchers.length ? { role: 'host' } : null;"]);
edit('    for (const f of this.fighters) this._spawn(f, t);\n    this.active = true;',[
'    for (const link of this.watchers) {',
"      link.send({ k: 'start', spectator: true, you: this.humans[0].f.id, killsToWin: opts.killsToWin,",
'        map: this.arena.mapId, ...this.atmo, roster: this._roster() });',
'    }',
'    for (const f of this.fighters) this._spawn(f, t);',
'    this.active = true;']);
edit("if (this.active && this.net && this.net.role === 'client') this.net.link.send({ k: 'left' });", "if (this.active && this.net?.role === 'client' && !this.viewOnly) this.net.link.send({ k: 'left' });");
edit('    this.finale.reset();\n    this.grenadeDeath',[
'    this.finale.reset(); this.watch.reset();',
'    this.viewOnly = false; this.watchers = []; this.watchCam = null; this.watchFocus = null;',
'    this.grenadeDeath']);
edit('this.grenadeView.release(); this.paused = true;', 'this.grenadeView.release(); this.watch.release(); this.paused = true;');
edit('  changeGun(gun) {\n    const h', '  changeGun(gun) {\n    if (this.viewOnly) return;\n    const h');
edit('    this.over = true;\n    this.hud.endTitle.textContent = title;', '    this.over = true;\n    this.watch.reset();\n    this.hud.endTitle.textContent = title;');
edit('    for (const r of this.remotes) if (r !== except) r.link.send(msg, fast);',[
'    for (const r of this.remotes) if (r !== except) r.link.send(msg, fast);',
"    if (msg.k === 'stopped' || msg.k === 'look') for (const watcher of this.watchers) watcher.send(msg, fast);",
"    if (msg.k === 'end') for (const watcher of this.watchers) {",
"      watcher.send({ k: 'end', title: msg.title, rows: msg.rows, team: msg.team });",
'    }']);
edit("    this._broadcast({ k: 'snap', f, s: this.teamScore }, true);",[
"    this._broadcast({ k: 'snap', f, s: this.teamScore }, true);",
'    if (this.watchers.length) {',
'      const visible = spectatorVisibility(this.fighters, this.humans[0].f.team, this.arena.world);',
"      const view = { k: 'watchSnap', f: f.filter(row => visible.has(row[0])), s: this.teamScore };",
'      for (const watcher of this.watchers) watcher.send(view, true);',
'    }']);
edit('  onLinkClosed(link) {\n    if (!this.active', '  onLinkClosed(link) {\n    this.watchers = this.watchers.filter(watcher => watcher !== link);\n    if (!this.active');
edit("    this.stop();\n    const d = this.deps;\n    this.opts = { opponent: 'net',", "    this.stop();\n    this.viewOnly = m.spectator === true;\n    const d = this.deps;\n    this.opts = { opponent: 'net',");
edit('this._look(f, f.gun, e.id === m.you ?', 'this._look(f, f.gun, !this.viewOnly && e.id === m.you ?');
edit('skinNum(e.skin), e.id === m.you);', 'skinNum(e.skin), !this.viewOnly && e.id === m.you);');
edit('      } else this.proxies.push(new Proxy(f));',[
'      }',
'      if (this.viewOnly) f.alive = false;',
'      if (this.viewOnly || e.id !== m.you) this.proxies.push(new Proxy(f));']);
edit("  _clientMsg(m) {\n    const t",[
'  _clientMsg(m) {',
"    if (this.viewOnly && !['watchSnap', 'look', 'end'].includes(m.k)) return;",
"    if (m.k === 'watchSnap' && !this.viewOnly) return;",
'    const t']);
edit("    if (m.k === 'snap') {\n      for (const e of m.f)",[
"    if (m.k === 'snap' || m.k === 'watchSnap') {",
'      if (this.viewOnly) {',
'        const present = new Set(m.f.map(row => row[0]));',
'        for (const fighter of this.fighters) if (!present.has(fighter.id)) fighter.alive = false;',
'      }',
'      for (const e of m.f)']);
edit('        if (me && f === me.f) {','        if (!this.viewOnly && me && f === me.f) {');
edit('if (f && g && (!me || f !== me.f)) this._look(f, g, skinNum(m.s));','if (f && g && (this.viewOnly || !me || f !== me.f)) this._look(f, g, skinNum(m.s));');
edit("if (me && m.team === me.f.team) this._earn('win');","if (!this.viewOnly && me && m.team === me.f.team) this._earn('win');");
edit('    if (me) me.update(t, this.over ? 0 : dt, this);\n    this._separate();','    if (me && !this.viewOnly) me.update(t, this.over ? 0 : dt, this);\n    if (!this.viewOnly) this._separate();');
edit('    if (me && me.f.alive && t >= this._nextSnap) {','    if (!this.viewOnly && me && me.f.alive && t >= this._nextSnap) {');
edit('    for (const f of this.fighters) f.updateVisual(t);\n    this._killCam(t);\n    if (!this.kc && !this.paused && !this.over && me?.f.alive)',[
'    for (const f of this.fighters) f.updateVisual(t);',
'    if (this.viewOnly) { this._updateWatch(t, dt); return; }',
'    this._killCam(t);',
'    if (!this.kc && !this.paused && !this.over && me?.f.alive)']);
edit('  // Your shot in a network game:',[
'  _updateWatch(t, dt) {',
'    const viewer = this.humans[0], team = viewer.f.team;',
'    const focus = viewer.f.alive ? viewer.f : null;',
'    for (const fighter of this.fighters) {',
'      fighter.outline.visible = false;',
'      for (const leg of fighter.legs) leg.o.visible = false;',
'    }',
'    const free = this.watch.frame(this.paused ? 0 : dt, focus, this.arena, this.fighters, team);',
"    this.watchFocus = this.watch.mode === 'follow' ? focus : null;",
'    this.watchCam = free || viewer.camera;',
'    if (this.watchFocus) {',
'      const puppet = this._puppet(focus);',
'      const ads = focus.ads || 0;',
'      replayCamera(viewer.camera, { x: focus.x, y: focus.y, z: focus.z, eye: focus.eyeH,',
'        yaw: focus.yaw, pitch: focus.pitch, ads, lean: focus.lean }, this.deps.settings, this.deps.adsVFov(puppet.optic));',
'      puppet.rig.update(dt, ads, t);',
'      if (puppet.reticle) puppet.reticle.material.opacity = Math.max(0, Math.min(1, (ads - 0.55) / 0.35));',
'    }',
'    this.hud.views[0].box.classList.add(\'mg-view-only\');',
'    this.arena.update(dt, t, this.watchCam.position);',
'  }',
'',
'  // Your shot in a network game:']);
edit('  mouseMove(dx, dy) { if (this.active && !this.paused && !this.over) this.humans[0].mouseMove(dx, dy); }',[
'  mouseMove(dx, dy) {',
'    if (!this.active || this.paused || this.over) return;',
'    if (this.viewOnly) this.watch.look(dx, dy);',
'    else this.humans[0].mouseMove(dx, dy);',
'  }']);
edit('  mouseButton(b, down) {\n    const h', '  mouseButton(b, down) {\n    if (this.viewOnly) return;\n    const h');
edit('    const p1 = this.humans[0], p2 = this.humans[1];','    const p1 = this.humans[0], p2 = this.humans[1];\n    if (this.viewOnly) return !this.over && this.watch.key(code, down, p1.f);');
edit('      const camera = grenadeCam || h.camera;', '      const camera = this.watchCam || grenadeCam || h.camera;');
edit('      if (!(this.kc && i === 0)) h.f.group.visible = false;', '      if (this.viewOnly ? !!this.watchFocus : !(this.kc && i === 0)) h.f.group.visible = false;');
edit('      if (grenadeCam) return;', '      if (grenadeCam || this.viewOnly && !this.watchFocus) return;');
edit('      const rig = this.kc && this.kc.pov && i === 0 && this.puppet ? this.puppet.rig : h.rig;', '      const rig = this.watchFocus || (this.kc && this.kc.pov && i === 0 && this.puppet) ? this.puppet.rig : h.rig;');
edit('this.deps.opticById?.(recorded?.[14], gun)', 'this.deps.opticById?.(recorded?.[14] ?? k.viewOptic, gun)');
fs.writeFileSync(p,s);

