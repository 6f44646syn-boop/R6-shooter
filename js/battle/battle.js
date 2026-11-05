// Battle mode: you against bots (Easy / Medium / Hard), or two local players in split
// screen (optionally with bots as a third side). First side to the kill target wins.
//
// Uses the same guns, measured sprays, sensitivity and weapon models as the range; adds an
// arena with cover, fighters with health, bot brains, tracers, hit markers and a kill feed.
import * as THREE from '../../vendor/three/three.module.min.js';
import { Arena } from './arena.js';
import { Fighter, gunDamage, ZONE_DAMAGE, MAX_HEALTH } from './fighter.js';
import { Bot, LEVELS } from './bot.js';
import { Human } from './human.js';
import { drawCrosshair } from '../ui/crosshair.js';

const TEAM_COLOR = { p1: 0x5b8cff, p2: 0x3fd07a, bots: 0xff7048 };
const BOT_NAMES = ['Rook', 'Vex', 'Mako', 'Quill', 'Brisk', 'Tarn'];
const RESPAWN_S = 3, PROTECT_S = 1.5, REGEN_DELAY = 5, REGEN_PER_S = 15;
const MAX_TRACERS = 48;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

export class Battle {
  // deps: { renderer, settings, guns, sfx, opticFor(gun), adsVFov(optic), baseDpc(), now(),
  //         slotOf(gun), onEnd() (release the mouse), hudRoot (element) }
  constructor(deps) {
    this.deps = deps;
    this.arena = new Arena();
    this.active = false; this.paused = false; this.over = false;
    this.fighters = []; this.humans = []; this.bots = [];
    this.prevT = 0; this.t = 0;
    this._dir = [0, 0, 0]; this._eye = [0, 0, 0]; this._hit = { t: 0, n: [0, 0, 0] };
    this._v = new THREE.Vector3();
    this._lastBotSound = 0;
    this._buildTracers();
    this._buildHud();
    this.humanPool = [];         // reused between matches (each has a weapon rig)
  }

  /* ---------- setup ---------- */
  // opts: { opponent: 'bots' | 'p2', bots, level, killsToWin, p1Gun, p2Gun }
  start(opts) {
    this.stop();
    const d = this.deps;
    this.opts = { ...opts };
    this.arena.setGraphics(d.settings.graphics, d.renderer);
    this.arena.holes.clear();
    for (const f of this.fighters) f.group.removeFromParent();
    this.fighters = []; this.humans = []; this.bots = [];
    this.teamScore = { p1: 0, p2: 0, bots: 0 };
    this.feed = [];
    const two = opts.opponent === 'p2';
    const mk = (i, name, team, gun, controls) => {
      const f = new Fighter({ name, team, color: TEAM_COLOR[team], human: true });
      let h = this.humanPool[i];
      if (!h) { h = this.humanPool[i] = new Human(f, controls, { ...d }, d.slotOf); }
      h.f = f; h.controls = controls; h.padIndex = -1; h.releaseAll();
      h.setGun(gun);
      this.humans.push(h); this.fighters.push(f);
      return h;
    };
    mk(0, two ? 'Player 1' : 'You', 'p1', opts.p1Gun, 'mouse');
    if (two) mk(1, 'Player 2', 'p2', opts.p2Gun, 'keys');
    const n = Math.max(0, Math.min(6, opts.bots | 0));
    for (let i = 0; i < n; i++) {
      const f = new Fighter({ name: BOT_NAMES[i] + ' (' + LEVELS[opts.level].name + ')', team: 'bots', color: TEAM_COLOR.bots });
      const gun = d.guns[(i * 3 + 1) % d.guns.length];
      const b = new Bot(f, opts.level, gun, 1000 + i * 7919 + Math.floor(Math.random() * 1e6));
      this.bots.push(b); this.fighters.push(f);
    }
    for (const f of this.fighters) this.arena.scene.add(f.group);
    const t = d.now();
    this.t = t; this.prevT = t;
    for (const f of this.fighters) this._spawn(f, t);
    this.active = true; this.paused = false; this.over = false;
    this.hud.root.hidden = false;
    this.hud.end.hidden = true;
    this._layoutHud();
    this._updateScore();
    this._renderFeed();
  }

  // Graphics quality, gun shading or reticle colour changed (from the menu, while paused).
  refreshGraphics() {
    this.arena.setGraphics(this.deps.settings.graphics, this.deps.renderer);
    for (const h of this.humans) {
      h.rig.rebuild();
      h.rig.setGun(h.gun, this.deps.slotOf(h.gun), h.optic);
      h._buildReticle();
    }
  }

  stop() {
    this.active = false;
    this.paused = false;
    if (this.hud) this.hud.root.hidden = true;
    for (const h of this.humans) h.releaseAll();
  }
  pause() { if (!this.active) return; this.paused = true; for (const h of this.humans) h.releaseAll(); }
  resume(t) { this.paused = false; this.prevT = t; }

  _side(f) { return f.team === 'p1' ? 'A' : f.team === 'p2' ? 'B' : (this.opts.opponent === 'p2' ? null : 'B'); }
  enemiesOf(f) { return this.fighters.filter((g) => g !== f && g.team !== f.team); }
  _ctl(f) { return this.humans.find((h) => h.f === f) || this.bots.find((b) => b.f === f); }

  _spawn(f, t) {
    const p = this.arena.spawnPoint(this._side(f), this.enemiesOf(f).filter((e) => e.alive));
    f.x = p.x; f.z = p.z; f.vx = f.vz = 0;
    f.health = MAX_HEALTH; f.alive = true; f.crouch = 0;
    f.protectUntil = t + PROTECT_S; f.lastHurt = -10;
    f.yaw = Math.atan2(-p.x, p.z) * 180 / Math.PI; f.pitch = 0;
    const c = this._ctl(f);
    if (c instanceof Human) c.respawn(p.x, p.z, t);
    else if (c) c.respawned();
  }

  /* ---------- simulation ---------- */
  update(t) {
    if (!this.active) return;
    let dt = Math.min(0.1, Math.max(0, t - this.prevT));
    this.prevT = t;
    if (this.paused || this.over) dt = 0;
    this.t = t;
    if (dt > 0) {
      for (const b of this.bots) b.update(t, dt, this);
      for (const f of this.fighters) {
        if (!f.alive && t >= f.respawnAt) this._spawn(f, t);
        if (f.alive && f.health < MAX_HEALTH && t - f.lastHurt > REGEN_DELAY) f.health = Math.min(MAX_HEALTH, f.health + REGEN_PER_S * dt);
      }
    }
    for (const h of this.humans) h.update(t, dt, this);
    for (const f of this.fighters) f.updateVisual(t);
    this._updateTracers(t);
    this._updateHud(t);
  }

  // A bullet from shooter (Human or Bot) at time shotT.
  fire(shooter, shotT) {
    const f = shooter.f, d = this._dir, o = this._eye;
    if (!f.alive || this.over) return;
    shooter.shotDirection(shotT, d);
    if (shooter instanceof Human) shooter.eye(o); else f.eye(o);
    f.flashUntil = shotT + 0.05;
    // Nearest hit: cover / walls / floor, or an enemy's body.
    const tw = this.arena.raycast(o, d, 200, this._hit);
    let best = null, bt = tw;
    for (const g of this.fighters) {
      if (g === f || g.team === f.team || !g.alive) continue;
      const r = g.raycast(o, d);
      if (r && r.t < bt) { bt = r.t; best = { g, r }; }
    }
    const end = bt === Infinity ? 60 : bt;
    const from = shooter instanceof Human ? this._v.set(o[0], o[1] - 0.12, o[2]).addScaledVector(new THREE.Vector3(d[0], d[1], d[2]), 0.6) : f.muzzleWorld(this._v);
    this._addTracer(from, [o[0] + d[0] * end, o[1] + d[1] * end, o[2] + d[2] * end], shotT, f.team);
    if (best) this._damage(best.g, gunDamage(f.gun) * (ZONE_DAMAGE[best.r.zone] || 1), f, best.r.zone, shotT);
    else if (tw !== Infinity) {
      const n = this._hit.n;
      this.arena.holes.add(o[0] + d[0] * tw, o[1] + d[1] * tw, o[2] + d[2] * tw, n[0], n[1], n[2]);
    }
    // Sound: your own shots full volume; others by distance to the nearest human (rate-limited).
    const sfx = this.deps.sfx;
    if (shooter instanceof Human) sfx.shot(f.gun.tone, this.humans.length > 1 ? 0.7 : 1);
    else if (shotT - this._lastBotSound > 0.045) {
      this._lastBotSound = shotT;
      let dist = Infinity;
      for (const h of this.humans) dist = Math.min(dist, Math.hypot(h.f.x - f.x, h.f.z - f.z));
      sfx.shot(f.gun.tone, Math.max(0.06, Math.min(0.6, 3 / (dist + 2))));
    }
  }

  _damage(g, dmg, by, zone, t) {
    if (t < g.protectUntil) dmg = 0;
    if (dmg <= 0) return;
    g.health -= dmg;
    g.lastHurt = t;
    const victim = this._ctl(g);
    if (victim instanceof Bot) victim.onHurt(by, t);
    const killer = this.humans.find((h) => h.f === by);
    const dead = g.health <= 0;
    if (killer) this._hitMarker(killer, dead ? 'kill' : zone === 'head' ? 'head' : 'hit', t);
    const hv = this.humans.find((h) => h.f === g);
    if (hv) this._hurtFlash(hv, by, t);
    if (!dead) return;
    g.health = 0; g.alive = false; g.deaths++; g.respawnAt = t + RESPAWN_S;
    by.kills++;
    this.teamScore[by.team]++;
    this.feed.unshift({ k: by.name, kc: by.team, v: g.name, vc: g.team, head: zone === 'head', t });
    this.feed.length = Math.min(this.feed.length, 5);
    this._renderFeed();
    this._updateScore();
    if (hv) hv.killedBy = by.name;
    const goal = this.opts.killsToWin;
    if (this.teamScore[by.team] >= goal) this._end(by.team);
  }

  _end(team) {
    this.over = true;
    const two = this.opts.opponent === 'p2';
    const names = { p1: two ? 'Player 1 wins' : 'You win', p2: 'Player 2 wins', bots: 'The bots win' };
    this.hud.endTitle.textContent = names[team];
    const rows = this.fighters.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.hud.endTable.replaceChildren(...rows.map((f) => {
      const r = el('div', 'b-row');
      r.append(el('span', 'b-name t-' + f.team, f.name), el('span', '', f.kills + ' kills'), el('span', '', f.deaths + ' deaths'));
      return r;
    }));
    this.hud.end.hidden = false;
    for (const h of this.humans) h.releaseAll();
    this.deps.onEnd();
  }

  /* ---------- input ---------- */
  mouseMove(dx, dy) { if (this.active && !this.paused && !this.over) this.humans[0].mouseMove(dx, dy); }
  mouseButton(b, down) {
    const h = this.humans[0];
    if (!h) return;
    if (b === 0) h.in.fire = down;
    else if (b === 2) h.in.ads = down;
    else if (b === 3) h.in.leanL = down;
    else if (b === 4) h.in.leanR = down;
  }
  // Returns true if the key was used.
  key(code, down) {
    if (!this.active) return false;
    const p1 = this.humans[0], p2 = this.humans[1];
    if (p2 && p2.controls !== 'mouse' && p2.key(code, down)) return true;
    const map = { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'sprint', Space: 'crouch', KeyQ: 'leanL', KeyE: 'leanR' };
    if (!p2) map.ShiftRight = 'sprint';
    if (map[code]) { p1.in[map[code]] = down; return true; }
    if (code === 'KeyR') { if (down) p1.reload(); return true; }
    return false;
  }

  /* ---------- rendering ---------- */
  viewports() {
    const sz = this.deps.renderer.getSize(new THREE.Vector2());
    const W = sz.x, H = sz.y;
    if (this.humans.length < 2) return [{ x: 0, y: 0, w: W, h: H }];
    const hw = Math.floor(W / 2);
    return [{ x: 0, y: 0, w: hw, h: H }, { x: hw, y: 0, w: W - hw, h: H }];
  }
  render() {
    if (!this.active) return;
    const r = this.deps.renderer;
    r.info.reset();
    r.autoClear = false;
    r.setRenderTarget(null);
    const vps = this.viewports();
    r.setScissorTest(true);
    this.humans.forEach((h, i) => {
      const v = vps[i];
      r.setViewport(v.x, v.y, v.w, v.h);
      r.setScissor(v.x, v.y, v.w, v.h);
      r.clear();
      const aspect = v.w / v.h;
      if (h.camera.aspect !== aspect) { h.camera.aspect = aspect; h.camera.updateProjectionMatrix(); }
      h.f.group.visible = false;                 // not your own body
      r.render(this.arena.scene, h.camera);
      h.f.group.visible = h.f.alive;
      r.clearDepth();
      h.rig.setAspect(aspect, v.h);
      r.render(h.rig.scene, h.rig.camera);
    });
    r.setScissorTest(false);
    const sz = r.getSize(new THREE.Vector2());
    r.setViewport(0, 0, sz.x, sz.y);
  }

  /* ---------- tracers ---------- */
  _buildTracers() {
    const g = new THREE.BufferGeometry();
    this.trPos = new Float32Array(MAX_TRACERS * 6);
    this.trCol = new Float32Array(MAX_TRACERS * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.trCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.tracers.frustumCulled = false;
    this.trBorn = new Float64Array(MAX_TRACERS).fill(-10);
    this.trI = 0;
    this.arena.scene.add(this.tracers);
  }
  _addTracer(a, b, t, team) {
    const i = this.trI++ % MAX_TRACERS, p = this.trPos, c = this.trCol;
    p.set([a.x, a.y, a.z, b[0], b[1], b[2]], i * 6);
    const col = team === 'bots' ? [1, 0.55, 0.3] : [1, 0.85, 0.5];
    c.set([col[0], col[1], col[2], col[0] * 0.2, col[1] * 0.2, col[2] * 0.2], i * 6);
    this.trBorn[i] = t;
  }
  _updateTracers(t) {
    let changed = false;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.trBorn[i] < -5) continue;
      if (t - this.trBorn[i] > 0.07) {      // collapse old segments
        const k = i * 6;
        this.trPos[k + 3] = this.trPos[k]; this.trPos[k + 4] = this.trPos[k + 1]; this.trPos[k + 5] = this.trPos[k + 2];
        this.trBorn[i] = -10;
      }
      changed = true;
    }
    if (changed) { this.tracers.geometry.attributes.position.needsUpdate = true; this.tracers.geometry.attributes.color.needsUpdate = true; }
  }

  /* ---------- HUD ---------- */
  _buildHud() {
    const root = el('div', 'battle-hud');
    root.hidden = true;
    const top = el('div', 'b-top');
    const score = el('div', 'b-score');
    const feed = el('div', 'b-feed');
    top.append(score);
    root.append(top, feed);
    const end = el('div', 'b-end');
    end.hidden = true;
    const box = el('div', 'b-end-box');
    const endTitle = el('h1', '', '');
    const endTable = el('div', 'b-table');
    const again = el('button', 'primary', 'Play again');
    const leave = el('button', '', 'Back to the range');
    again.type = leave.type = 'button';
    const row = el('div', 'row'); row.append(again, leave);
    box.append(endTitle, endTable, row, el('p', 'small', 'Click "Play again" for a rematch with the same settings.'));
    end.append(box);
    root.append(end);
    this.deps.hudRoot.insertBefore(root, this.deps.hudRoot.querySelector('#menu'));   // under the menu
    this.hud = { root, score, feed, end, endTitle, endTable, again, leave, views: [] };
  }
  _layoutHud() {
    for (const v of this.hud.views) v.box.remove();
    this.hud.views = this.humans.map((h, i) => {
      const box = el('div', 'b-view' + (this.humans.length > 1 ? ' half ' + (i ? 'right' : 'left') : ''));
      const cross = document.createElement('canvas');
      cross.className = 'b-cross';
      drawCrosshair(cross, this.deps.settings.crosshair);
      const hit = el('div', 'b-hit');
      const hurt = el('div', 'b-hurt');
      const dead = el('div', 'b-dead'); dead.hidden = true;
      const name = el('div', 'b-name t-' + h.f.team, h.f.name + ' · ' + h.gun.name);
      const hp = el('div', 'b-hp'); const hpFill = el('i'); hp.append(hpFill);
      const hpText = el('div', 'b-hptext', '100');
      const ammo = el('div', 'b-ammo', '');
      const ctl = el('div', 'b-ctl small', '');
      box.append(hurt, cross, hit, dead, name, hp, hpText, ammo, ctl);
      this.hud.root.insertBefore(box, this.hud.root.firstChild);
      return { box, cross, hit, hurt, dead, hpFill, hpText, ammo, ctl, hitUntil: 0, hurtUntil: 0, last: {} };
    });
  }
  _hitMarker(h, kind, t) {
    const v = this.hud.views[this.humans.indexOf(h)];
    if (!v) return;
    v.hit.className = 'b-hit on ' + kind;
    v.hitUntil = t + (kind === 'kill' ? 0.35 : 0.15);
  }
  _hurtFlash(h, by, t) {
    const v = this.hud.views[this.humans.indexOf(h)];
    if (!v) return;
    v.hurtUntil = t + 0.35;
    // Which side the damage came from (left/right/front/behind) shows as a red edge.
    const ang = Math.atan2(by.x - h.f.x, -(by.z - h.f.z)) * 180 / Math.PI;
    let rel = ((ang - h.look.yaw + 540) % 360) - 180;
    v.hurt.className = 'b-hurt on ' + (Math.abs(rel) < 45 ? 'front' : Math.abs(rel) > 135 ? 'back' : rel > 0 ? 'right' : 'left');
  }
  _updateScore() {
    const o = this.opts, two = o.opponent === 'p2';
    const parts = [];
    parts.push([two ? 'P1' : 'You', 'p1', this.teamScore.p1]);
    if (two) parts.push(['P2', 'p2', this.teamScore.p2]);
    if (this.bots.length) parts.push(['Bots', 'bots', this.teamScore.bots]);
    this.hud.score.replaceChildren(...parts.map(([n, c, s]) => el('span', 't-' + c, n + ' ' + s)), el('span', 'b-goal', 'first to ' + o.killsToWin));
  }
  _renderFeed() {
    this.hud.feed.replaceChildren(...this.feed.map((e) => {
      const r = el('div', 'b-feedrow');
      r.append(el('span', 't-' + e.kc, e.k), el('span', 'b-icon', e.head ? ' ✦ ' : ' › '), el('span', 't-' + e.vc, e.v));
      return r;
    }));
  }
  _updateHud(t) {
    this.humans.forEach((h, i) => {
      const v = this.hud.views[i];
      if (!v) return;
      const f = h.f, L = v.last;
      const hp = Math.ceil(f.health);
      if (L.hp !== hp) { L.hp = hp; v.hpFill.style.width = hp + '%'; v.hpFill.className = hp > 60 ? '' : hp > 30 ? 'mid' : 'low'; v.hpText.textContent = String(hp); }
      const ammo = h.weapon.reloading ? 'reloading' : h.weapon.ammo + ' / ' + h.gun.magSize;
      if (L.ammo !== ammo) { L.ammo = ammo; v.ammo.textContent = ammo; v.ammo.classList.toggle('low', !h.weapon.reloading && h.weapon.ammo <= Math.ceil(h.gun.magSize * 0.2)); }
      const showCross = f.alive && h.adsE < 0.4;
      if (L.cross !== showCross) { L.cross = showCross; v.cross.hidden = !showCross; }
      if (t > v.hitUntil && v.hit.classList.contains('on')) v.hit.className = 'b-hit';
      if (t > v.hurtUntil && v.hurt.classList.contains('on')) v.hurt.className = 'b-hurt';
      const deadMsg = f.alive ? '' : 'Eliminated by ' + (h.killedBy || '?') + ' · back in ' + Math.max(0, Math.ceil(f.respawnAt - t));
      if (L.dead !== deadMsg) { L.dead = deadMsg; v.dead.hidden = !deadMsg; v.dead.textContent = deadMsg; }
      const ctl = i === 1 ? (h.controls === 'pad' ? 'Gamepad' : 'Keys: I J K L move · arrows look · Enter fire · Right Shift aim · Backspace reload · / crouch') : '';
      if (L.ctl !== ctl) { L.ctl = ctl; v.ctl.textContent = ctl; }
    });
  }
}
