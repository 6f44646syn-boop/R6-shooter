// Battle mode: you against bots (Easy / Medium / Hard), or two local players in split
// screen (optionally with bots as a third side). First side to the kill target wins.
//
// Uses the same guns, measured sprays, sensitivity and weapon models as the range; adds an
// arena with cover, fighters with health, bot brains, tracers, hit markers and a kill feed.
import * as THREE from '../../vendor/three/three.module.min.js?v=1ab6120-mwbhzb5p';
import { Arena } from './arena.js?v=1ab6120-mwbhzb5p';
import { Fighter, gunDamage, ZONE_DAMAGE, MAX_HEALTH } from './fighter.js?v=1ab6120-mwbhzb5p';
import { Bot, LEVELS } from './bot.js?v=1ab6120-mwbhzb5p';
import { Human } from './human.js?v=1ab6120-mwbhzb5p';
import { BattleNades } from './nades.js?v=1ab6120-mwbhzb5p';
import { drawCrosshair } from '../ui/crosshair.js?v=1ab6120-mwbhzb5p';
import { CATALOGUE, skinFits, LEGEND_ID, LEGEND_GOLD_ID } from '../core/skins.js?v=1ab6120-mwbhzb5p';
import { effectiveGraphics } from '../render/quality.js?v=1ab6120-mwbhzb5p';
import { effectiveGun, slotIn } from '../core/loadout.js?v=1ab6120-mwbhzb5p';

const TEAM_COLOR = { p1: 0x5b8cff, p2: 0x3fd07a, p3: 0xc77dff, p4: 0xffd23f, p5: 0x3fd8e0, p6: 0xff6fae, bots: 0xff7048 };
const SNAP_HZ = 30;            // network position updates per second
const INTERP_DELAY = 0.1;      // clients draw others this far in the past (smooth movement)
const r2 = (v) => Math.round(v * 100) / 100, r1 = (v) => Math.round(v * 10) / 10;

// Host side: a player on another PC. Their PC simulates their movement and aim and reports
// position and shots; the host keeps health, damage, kills, respawns and the score.
class Remote {
  constructor(f, link, gun) { this.f = f; this.link = link; this.gun = gun; f.gun = gun; this.shotTimes = []; }
}
// A random skin that fits the gun in this slot (bots show off a little).
function botSkin(slot, rng = Math.random) {
  for (let i = 0; i < 20; i++) { const s = CATALOGUE[Math.floor(rng() * CATALOGUE.length)]; if (skinFits(s.id, slot)) return s.id; }
  return null;
}
const skinNum = (v) => (Number.isInteger(v) && v >= 0 && v < 2000 ? v : null);
// Client side: anyone else (players and bots), drawn from the host's position updates.
class Proxy {
  constructor(f) { this.f = f; this.buf = []; }
}
const BOT_NAMES = ['Rook', 'Vex', 'Mako', 'Quill', 'Brisk', 'Tarn'];
const RESPAWN_S = 3, PROTECT_S = 3, REGEN_DELAY = 5, REGEN_PER_S = 15;
const MAX_TRACERS = 48;
const DEG2RAD = Math.PI / 180;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

export class Battle {
  // deps: { renderer, settings, guns, sfx, opticFor(gun), adsVFov(optic), baseDpc(), now(),
  //         slotOf(gun), onEnd() (release the mouse), hudRoot (element) }
  constructor(deps) {
    this.deps = deps;
    this.arenas = {};            // one per map, built the first time it is played
    this.arena = this._useArena('yard');
    this.active = false; this.paused = false; this.over = false;
    this.fighters = []; this.humans = []; this.bots = [];
    this.prevT = 0; this.t = 0;
    this._dir = [0, 0, 0]; this._eye = [0, 0, 0]; this._hit = { t: 0, n: [0, 0, 0] };
    this._v = new THREE.Vector3();
    this._lastBotSound = 0;
    this._buildTracers();
    this._buildTorches();
    this._buildHud();
    this.humanPool = [];         // reused between matches (each has a weapon rig)
  }

  _useArena(id) {
    if (!this.arenas[id]) this.arenas[id] = new Arena(id);
    this.arena = this.arenas[id];
    if (this.tracers) this.arena.scene.add(this.tracers);     // moves them to this map's scene
    if (this.torches) for (const l of this.torches) this.arena.scene.add(l, l.target);
    return this.arena;
  }

  /* ---------- night: flashlights ---------- */
  // One spotlight for you (with shadows in High/Ultra) and four for the nearest other
  // fighters whose lights are on. The count never changes during a match (no shader rebuilds).
  _buildTorches() {
    this.torches = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.SpotLight(0xfff2dc, 0, 42, i ? 0.42 : 0.38, 0.55, 1.3);
      l.visible = false;
      this.torches.push(l);
    }
    this.night = false;
    for (const l of this.torches) this.arena.scene.add(l, l.target);
  }
  _setNight(night, weather, fog) {
    this.night = !!night;
    this.arena.setAtmosphere(this.night, weather || 'auto', !!fog);
    const q = effectiveGraphics(this.deps.settings), high = q === 'high' || q === 'ultra';
    // Others' flashlights that light the scene: 4 in High / Ultra, 2 in Standard, none in Low
    // (their beams always show).
    const others = high ? 4 : q === 'low' ? 0 : 2;
    this.torches.forEach((l, i) => {
      l.visible = this.night && i <= others;
      l.castShadow = this.night && i === 0 && high;
      if (l.castShadow) { l.shadow.mapSize.set(1024, 1024); l.shadow.camera.near = 0.3; l.shadow.camera.far = 40; l.shadow.bias = -0.0008; }
    });
    for (const f of this.fighters) {
      f.night = this.night; f.light = true;
      // Others stay crisp: no distance haze on them, except in fog weather (that is the point).
      f.body.material.fog = !!fog; f.body.material.needsUpdate = true;
    }
    for (const h of this.humans) h.rig.setTorch(this.night);
  }
  _updateTorches() {
    if (!this.night) return;
    const [own, ...rest] = this.torches, h = this.humans[0];
    if (h && h.f.alive && h.f.light) {
      const c = h.camera, fw = this._v.set(0, 0, -1).applyQuaternion(c.quaternion);
      own.intensity = 140;
      own.position.copy(c.position).addScaledVector(fw, 0.3);
      own.position.y -= 0.1;
      own.target.position.copy(c.position).addScaledVector(fw, 12);
      own.target.updateMatrixWorld();
    } else own.intensity = 0;
    const me = h ? h.f : null;
    const lit = this.fighters.filter((f) => f !== me && f.alive && f.light)
      .sort((a, b) => (me ? Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z) : 0));
    rest.forEach((l, i) => {
      const f = lit[i];
      if (!f || !l.visible) { l.intensity = 0; return; }
      l.intensity = 110;
      f.muzzleWorld(l.position);
      const y = f.yaw * DEG2RAD, p = f.pitch * DEG2RAD;
      l.target.position.set(l.position.x + Math.sin(y) * Math.cos(p) * 10, l.position.y + Math.sin(p) * 10, l.position.z - Math.cos(y) * Math.cos(p) * 10);
      l.target.updateMatrixWorld();
    });
  }

  /* ---------- setup ---------- */
  // opts: { opponent: 'bots' | 'p2' | 'net', bots, level, killsToWin, p1Gun, p2Gun,
  //         remotes: [{ link, name, gunIndex }] (network game: players on other PCs) }
  start(opts) {
    this.stop();
    const d = this.deps;
    this.opts = { ...opts, remotes: undefined };
    this.net = opts.remotes && opts.remotes.length ? { role: 'host' } : null;
    if (!this.nadesB) this.nadesB = new BattleNades(this);
    this.nadesB.reset();
    for (const f of this.fighters) f.group.removeFromParent();
    this._useArena(opts.map || 'yard');
    this.atmo = { night: !!opts.night, weather: opts.weather || 'auto', fog: !!opts.fog };
    this.remotes = []; this.proxies = [];
    this._nextSnap = 0;
    this.arena.setGraphics(effectiveGraphics(d.settings), d.renderer);
    this.arena.holes.clear();
    for (const f of this.fighters) f.group.removeFromParent();
    this.fighters = []; this.humans = []; this.bots = [];
    this.teamScore = { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0, bots: 0 };
    this.feed = [];
    this.matchPoints = 0;
    this.noises = []; this.intelQ = []; this.comms = []; this._renderComms();
    const two = opts.opponent === 'p2';
    const mk = (i, name, team, gun, controls) => {
      const f = new Fighter({ name, team, color: TEAM_COLOR[team], human: true });
      let h = this.humanPool[i];
      if (!h) { h = this.humanPool[i] = new Human(f, controls, { ...d }, d.slotOf); }
      h.f = f; h.controls = controls; h.padIndex = -1; h.releaseAll();
      h.setGun(gun);
      this.humans.push(h); this.fighters.push(f);
      this._look(f, gun, d.skinOf ? d.skinOf(gun) : null);
      return h;
    };
    mk(0, two ? 'Player 1' : this.net ? (opts.hostName || 'Host') : 'You', 'p1', opts.p1Gun, 'mouse');
    if (two) mk(1, 'Player 2', 'p2', opts.p2Gun, 'keys');
    (opts.remotes || []).forEach((r, i) => {
      const team = 'p' + (i + 2);
      const f = new Fighter({ name: r.name, team, color: TEAM_COLOR[team], human: true });
      f.showBar = false;
      const rm = new Remote(f, r.link, effectiveGun(d.guns[r.gunIndex] || d.guns[0], r.attach));   // attachments checked by Rust
      this._look(f, rm.gun, skinNum(r.skin));
      this.remotes.push(rm);
      this.fighters.push(f);
    });
    const n = Math.max(0, Math.min(6, opts.bots | 0));
    for (let i = 0; i < n; i++) {
      const f = new Fighter({ name: BOT_NAMES[i] + ' (' + LEVELS[opts.level].name + ')', team: 'bots', color: TEAM_COLOR.bots });
      const gun = d.guns[(i * 3 + 1) % d.guns.length];
      const b = new Bot(f, opts.level, gun, 1000 + i * 7919 + Math.floor(Math.random() * 1e6));
      this._look(f, gun, botSkin(slotIn(d.guns, gun)));
      this.bots.push(b); this.fighters.push(f);
    }
    this.fighters.forEach((f, i) => { f.id = i + 1; this.arena.scene.add(f.group); });
    this._setNight(this.atmo.night, this.atmo.weather, this.atmo.fog);
    this.arena.setGraphics(effectiveGraphics(d.settings), d.renderer);
    const t = d.now();
    this.t = t; this.prevT = t;
    // Network game: tell every remote player who is in the match before the spawns go out.
    for (const r of this.remotes) {
      r.link.send({ k: 'start', you: r.f.id, killsToWin: opts.killsToWin, map: this.arena.mapId, night: this.atmo.night, weather: this.atmo.weather, fog: this.atmo.fog, roster: this._roster() });
    }
    for (const f of this.fighters) this._spawn(f, t);
    this.active = true; this.paused = false; this.over = false;
    this.hud.root.hidden = false;
    this.hud.end.hidden = true;
    this._layoutHud();
    this._updateScore();
    this._renderFeed();
  }

  // You picked another gun from the pause menu: take it now (full magazine).
  changeGun(gun) {
    const h = this.humans[0];
    if (!h) return;
    h.setGun(gun);
    const skin = this.deps.skinOf ? this.deps.skinOf(gun) : null;
    this._look(h.f, gun, skin);
    if (this.net && this.net.role === 'client') this.net.link.send({ k: 'gun', i: slotIn(this.deps.guns, gun), s: skin, at: gun.attach || null });
    if (this.net && this.net.role === 'host') this._broadcast({ k: 'look', id: h.f.id, gun: slotIn(this.deps.guns, gun), s: skin, at: gun.attach || null });
    const v = this.hud.views[0];
    if (v) v.box.querySelector('.b-name').textContent = h.f.name + ' · ' + gun.name;
  }

  // Graphics quality, gun shading or reticle colour changed (from the menu, while paused).
  refreshGraphics() {
    this.arena.setGraphics(effectiveGraphics(this.deps.settings), this.deps.renderer);
    for (const f of this.fighters) if (f.gun) { f._lookKey = ''; this._look(f, f.gun, f.skin); }
    for (const h of this.humans) {
      h.rig.rebuild();
      h.rig.setGun(h.gun, this.deps.slotOf(h.gun), h.optic);
      h._buildReticle();
    }
  }

  _roster() {
    return this.fighters.map((f) => ({ id: f.id, name: f.name, team: f.team, human: f.human, gun: slotIn(this.deps.guns, f.gun), at: (f.gun && f.gun.attach) || null, skin: f.skin }));
  }
  // The gun (with its skin) others see this fighter carry.
  _look(f, gun, skin, mine = this.humans.some((h) => h.f === f)) {
    f.setDetail(effectiveGraphics(this.deps.settings));
    // Someone else's Legendary (their own photo) shows as the gold finish here.
    if (skin === LEGEND_ID && !mine) skin = LEGEND_GOLD_ID;
    try { f.setLook(gun, Math.max(0, slotIn(this.deps.guns, gun)), skin); } catch (e) { console.warn('gun look', e); }
  }

  stop() {
    this.deps.sfx.stopAll?.();
    if (this.active && this.net && this.net.role === 'host') this._broadcast({ k: 'stopped' });
    if (this.active && this.net && this.net.role === 'client') this.net.link.send({ k: 'left' });
    this.active = false;
    this.paused = false;
    this._frameN = 0;
    if (this.deps.voice) this.deps.voice.stop();
    if (this.deps.renderer) this.deps.renderer.shadowMap.autoUpdate = true;
    if (this.hud) this.hud.root.hidden = true;
    for (const h of this.humans) h.releaseAll();
  }
  pause() { if (!this.active) return; this.paused = true; for (const h of this.humans) h.releaseAll(); }
  resume(t) { this.paused = false; this.prevT = t; }

  _side(f) {
    if (f.team === 'p1') return 'A';
    if (f.team === 'p2') return 'B';
    if (f.team === 'bots') return this.opts.opponent === 'bots' ? 'B' : null;
    return null;
  }
  enemiesOf(f) { return this.fighters.filter((g) => g !== f && g.team !== f.team); }
  _ctl(f) { return this.humans.find((h) => h.f === f) || this.bots.find((b) => b.f === f) || this.remotes.find((r) => r.f === f); }

  _spawn(f, t) {
    const p = this.arena.spawnPoint(this._side(f), this.enemiesOf(f).filter((e) => e.alive));
    f.x = p.x; f.z = p.z; f.y = p.y; f.vx = f.vy = f.vz = 0;
    f.health = MAX_HEALTH; f.alive = true; f.crouch = 0;
    f.protectUntil = t + PROTECT_S; f.lastHurt = -10;
    if (this.nadesB) this.nadesB.refill(f);
    f.yaw = Math.atan2(-p.x, p.z) * 180 / Math.PI; f.pitch = 0;
    const c = this._ctl(f);
    if (c instanceof Human) { c.respawn(p.x, p.z, t, p.y); if (c === this.humans[0]) this._resetReport(); }
    else if (c instanceof Remote) c.link.send({ k: 'spawn', x: r2(p.x), z: r2(p.z), y: r2(p.y), yaw: r1(f.yaw) });
    else if (c) c.respawned();
  }

  /* ---------- simulation ---------- */
  update(t) {
    if (!this.active) return;
    if (this.net && this.net.role === 'client') { this._clientUpdate(t); return; }
    let dt = Math.min(0.1, Math.max(0, t - this.prevT));
    this.prevT = t;
    // A network game never pauses (Esc only opens your menu); local games do.
    if ((this.paused && !this.net) || this.over) dt = 0;
    this.t = t;
    if (dt > 0) {
      for (const b of this.bots) { b.update(t, dt, this); if (!this.over) this.nadesB.botThink(b, t); }
      while (this.intelQ.length && this.intelQ[0].at <= t) { const q = this.intelQ.shift(); for (const b of this.bots) if (b.f.team === q.team) b.onCallout(q.intel, t, this); }
      for (const f of this.fighters) {
        if (!f.alive && t >= f.respawnAt) this._spawn(f, t);
        if (f.alive && f.health < MAX_HEALTH && t - f.lastHurt > REGEN_DELAY) f.health = Math.min(MAX_HEALTH, f.health + REGEN_PER_S * dt);
        const acid = f.alive && !this.over ? this.arena.hazardAt(f.x, f.y, f.z) : 0;
        if (acid) this._acid(f, acid * dt, t);
        this._sounds(f, t, dt);
      }
    }
    for (const h of this.humans) h.update(t, dt, this);
    this._separate();
    for (const f of this.fighters) f.updateVisual(t);
    this.nadesB.update(this.over ? 0 : dt, t);
    this._updateBlasts(t);
    this._killCam(t);
    const ears = this.humans[0];
    if (ears) { this.deps.sfx.listen(ears.camera); if (!this.kc && !this.over) this.deps.sfx.observeSteps(this.fighters, ears.camera, this.arena, t, null, ears.f.id); }
    this._updateTorches();
    this.arena.update(dt, t, this.humans[0] ? this.humans[0].camera.position : null);
    this._updateTracers(t);
    this._updateHud(t);
    if (this.net && t >= this._nextSnap) { this._nextSnap = t + 1 / SNAP_HZ; this._sendSnapshot(t); }
  }

  // A grenade going off: a flash ring, a bang from its direction, a jolt if you are close.
  _blast(x, y, z, t) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.05, z);
    this.arena.scene.add(ring);
    (this.blasts || (this.blasts = [])).push({ ring, t });
    const w = this._where(x, y, z, 'blast', 120);
    this.deps.sfx.shot(0.05, w.gain, w.route, w.muffle);
    const h = this.humans[0];
    if (h && Math.hypot(h.f.x - x, h.f.z - z) < 9) { const v = this.hud.views[0]; if (v) v.vigT = Math.max(v.vigT, t - 0.2); }
  }
  _updateBlasts(t) {
    if (!this.blasts) return;
    this.blasts = this.blasts.filter((b) => {
      const k = (t - b.t) / 0.6;
      if (k >= 1) { b.ring.removeFromParent(); b.ring.geometry.dispose(); b.ring.material.dispose(); return false; }
      const s = 0.3 + 6 * Math.sqrt(k); b.ring.scale.set(s, s, s); b.ring.material.opacity = 0.85 * (1 - k);
      return true;
    });
  }

  // A bullet from shooter (Human or Bot) at time shotT.
  fire(shooter, shotT) {
    if (this.net && this.net.role === 'client') { this._clientFire(shooter, shotT); return; }
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
    this._noise(f, 'shot', 48 * (f.gun.noise ?? 1), shotT);
    for (const b of this.bots) {
      if (b.f === f || b.f.team === f.team || !b.f.alive || (best && best.g === b.f)) continue;
      if (this._rayDist(o, d, end, b.f.x, b.f.y + 1.2, b.f.z) < 1.6) b.onShotAt(f, shotT);
    }
    const from = shooter instanceof Human ? this._v.set(o[0] + d[0] * 0.6, o[1] - 0.12 + d[1] * 0.6, o[2] + d[2] * 0.6) : f.muzzleWorld(this._v);
    this._addTracer(from, [o[0] + d[0] * end, o[1] + d[1] * end, o[2] + d[2] * end], shotT, f.team, false, f.id);
    let hole = null;
    if (best) this._damage(best.g, gunDamage(f.gun) * (ZONE_DAMAGE[best.r.zone] || 1), f, best.r.zone, shotT);
    else if (tw !== Infinity) {
      const n = this._hit.n;
      hole = [r2(o[0] + d[0] * tw), r2(o[1] + d[1] * tw), r2(o[2] + d[2] * tw), n[0], n[1], n[2]];
      this.arena.holes.add(hole[0], hole[1], hole[2], n[0], n[1], n[2]);
    }
    if (this.net) this._broadcast({ k: 'tr', by: f.id, a: [r2(from.x), r2(from.y), r2(from.z)], b: [r2(o[0] + d[0] * end), r2(o[1] + d[1] * end), r2(o[2] + d[2] * end)], team: f.team, tone: f.gun.tone, hole }, true);
    // Own shots are centred; other emitters use Rust propagation and bounded voices.
    const sfx = this.deps.sfx;
    if (shooter instanceof Human) sfx.shot(f.gun.tone, (this.humans.length > 1 ? 0.7 : 1) * (f.gun.suppressed ? 0.45 : 1));
    else {
      const w = this._where(from.x, from.y, from.z);
      sfx.shot(f.gun.tone, w.gain * (f.gun.suppressed ? 0.45 : 1), w.route, w.muffle);
    }
  }

  // Acid: damage with no shooter (spawn protection does not help; a death scores for no one).
  _acid(g, dmg, t) {
    g.health -= dmg;
    g.lastHurt = t;
    const hv = this.humans.find((h) => h.f === g), rv = this.remotes.find((r) => r.f === g);
    if (hv && (!this._acidFlash || t > this._acidFlash)) { this._acidFlash = t + 0.3; this._hurtFlash(hv, null, t); }
    if (rv && (!rv.acidMsg || t > rv.acidMsg)) { rv.acidMsg = t + 0.3; rv.link.send({ k: 'hurt', from: null, by: 'Acid' }); }
    if (g.health > 0) return;
    g.health = 0; g.alive = false; g.deaths++; g.respawnAt = t + RESPAWN_S;
    const entry = { k: 'Acid', kc: 'env', v: g.name, vc: g.team, vid: g.id, head: false, t };
    this.feed.unshift(entry);
    this.feed.length = Math.min(this.feed.length, 5);
    if (this.net) this._broadcast({ k: 'feed', e: entry });
    this._renderFeed();
    this._updateScore();
    if (hv) { hv.killedBy = 'the acid'; hv.killerId = null; }
  }

  _damage(g, dmg, by, zone, t) {
    if (t < g.protectUntil) dmg = 0;
    if (dmg <= 0) return;
    const applied = Math.min(dmg, Math.max(0, g.health));
    g.health -= dmg;
    g.lastHurt = t;
    this._noteHit(g, by, zone, applied);
    const victim = this._ctl(g);
    if (victim instanceof Bot) victim.onHurt(by, t);
    const killer = this.humans.find((h) => h.f === by);
    const dead = g.health <= 0;
    const kind = dead ? 'kill' : zone === 'head' ? 'head' : 'hit';
    if (killer) this._hitMarker(killer, kind, t);
    const hv = this.humans.find((h) => h.f === g);
    if (hv) this._hurtFlash(hv, by, t);
    const rk = this.remotes.find((r) => r.f === by), rv = this.remotes.find((r) => r.f === g);
    if (rk) rk.link.send({ k: 'hm', kind, head: zone === 'head', id: g.id, dmg: r1(applied) });
    if (dead && this.humans[0] && by === this.humans[0].f) this._earn('kill', zone === 'head');
    if (rv) rv.link.send({ k: 'hurt', from: [r2(by.x), r2(by.z)], by: by.name, id: by.id, zone, dmg: r1(applied) });
    if (!dead) return;
    g.health = 0; g.alive = false; g.deaths++; g.respawnAt = t + RESPAWN_S;
    by.kills++;
    this.teamScore[by.team]++;
    const kb = this.bots.find((b) => b.f === by);
    if (kb) kb.say(this, t, ['Enemy down!', 'Got one!', 'Target down.', 'One less.'][Math.floor(Math.random() * 4)], true);
    const mates = this.bots.filter((b) => b.f !== g && b.f.team === g.team && b.f.alive);
    if (this.bots.some((b) => b.f === g) && mates.length && Math.random() < 0.6) mates[0].say(this, t, g.name.split(' ')[0] + ' is down! ' + this.arena.placeName(by.x, by.z, by.y) + '.', true);
    const entry = { k: by.name, kc: by.team, kid: by.id, v: g.name, vc: g.team, vid: g.id, head: zone === 'head', t };
    this.feed.unshift(entry);
    this.feed.length = Math.min(this.feed.length, 5);
    if (this.net) this._broadcast({ k: 'feed', e: entry });
    this._renderFeed();
    this._updateScore();
    if (hv) { hv.killedBy = by.name; hv.killerId = by.id; }
    const goal = this.opts.killsToWin;
    if (this.teamScore[by.team] >= goal) this._end(by.team);
  }

  _end(team) {
    this.over = true;
    const two = this.opts.opponent === 'p2';
    const names = { p1: two ? 'Player 1 wins' : 'You win', p2: 'Player 2 wins', bots: 'The bots win' };
    let title = names[team];
    if (this.net) { const w = this.fighters.find((f) => f.team === team); title = team === 'bots' ? 'The bots win' : (w ? w.name : 'Someone') + ' wins'; }
    const rows = this.fighters.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((f) => [f.name, f.team, f.kills, f.deaths]);
    if (this.net) this._broadcast({ k: 'end', title, rows, team });
    if (this.humans[0] && this.humans[0].f.team === team) this._earn('win');
    this._showEnd(title, rows, true);
    for (const h of this.humans) h.releaseAll();
    this.deps.onEnd();
  }

  _showEnd(title, rows, canRestart) {
    this.over = true;
    this.hud.endTitle.textContent = title;
    this.hud.endTable.replaceChildren(...rows.map(([name, team, kills, deaths]) => {
      const r = el('div', 'b-row');
      r.append(el('span', 'b-name t-' + team, name), el('span', '', kills + ' kills'), el('span', '', deaths + ' deaths'));
      return r;
    }));
    this.hud.again.hidden = !canRestart;
    this.hud.endNote.textContent = (this.matchPoints ? 'You earned ' + this.matchPoints + ' points this match. ' : '') +
      (canRestart ? 'Click "Play again" for a rematch with the same settings.' : 'The host can start a rematch; you will join it automatically.');
    this.hud.end.hidden = false;
  }

  // Points for you (player 1 on this PC): a kill or a win. Shows "+N" under the crosshair.
  _earn(kind, head = false) {
    const n = this.deps.onPoints ? this.deps.onPoints(kind, head) : 0;
    if (!n) return;
    this.matchPoints = (this.matchPoints || 0) + n;
    const v = this.hud.views[0];
    if (v) { v.pts.textContent = '+' + n + (kind === 'win' ? ' win' : head ? ' headshot' : ''); v.pts.className = 'b-points on'; v.ptsUntil = this.t + 1.2; }
  }

  /* ---------- network: host ---------- */
  _broadcast(msg, fast = false, except = null) {
    for (const r of this.remotes) if (r !== except) r.link.send(msg, fast);
  }
  // Positions, health and score of everyone, ~30 times a second (newest wins).
  _sendSnapshot(t) {
    const f = this.fighters.map((g) => [g.id, r2(g.x), r2(g.z), r1(g.yaw + (g.viewDY || 0)), r1(g.pitch + (g.viewDP || 0)), r2(g.crouch), Math.ceil(Math.max(0, g.health)), g.alive ? 1 : 0, t < g.flashUntil ? 1 : 0, g.kills, g.deaths, r2(g.y), g.light ? 1 : 0, r2(g.ads || 0), g.nades ?? 2]);
    this._broadcast({ k: 'snap', f, s: this.teamScore }, true);
  }
  // A message from a player on another PC (host), or from the host (client).
  onNet(link, m) {
    if (!this.active || !this.net) return;
    if (this.net.role === 'client') { this._clientMsg(m); return; }
    const r = this.remotes.find((x) => x.link === link);
    if (!r) return;
    const f = r.f, t = this.t;
    if (m.k === 'st') {
      if (!f.alive) return;
      f.x = +m.x || 0; f.z = +m.z || 0; f.yaw = +m.yaw || 0; f.pitch = +m.pitch || 0; f.crouch = Math.min(1, Math.max(0, +m.crouch || 0));
      f.y = Math.min(this.arena.wallH, Math.max(0, +m.y || 0));
      f.light = m.fl !== 0;
      f.ads = Math.min(1, Math.max(0, +m.a || 0));
      this.arena.resolve(f);                      // never inside cover
    } else if (m.k === 'shot') {
      if (!f.alive || this.over) return;
      // Rate check: no faster than the gun can fire (plus slack for network bunching).
      r.shotTimes.push(t);
      while (r.shotTimes.length && r.shotTimes[0] < t - 1) r.shotTimes.shift();
      if (r.shotTimes.length > r.gun.rpm / 60 * 1.5 + 3) return;
      if (t < f.protectUntil) f.protectUntil = t;
      f.flashUntil = t + 0.05;
      const a = f.muzzleWorld(this._v);
      this._addTracer(a, m.b, t, f.team, false, f.id);
      this._noise(f, 'shot', 48 * (f.gun.noise ?? 1), t);
      this._broadcast({ k: 'tr', by: f.id, a: [r2(a.x), r2(a.y), r2(a.z)], b: m.b, team: f.team, tone: r.gun.tone, hole: m.hole || null }, true, r);
      if (m.hole) this.arena.holes.add(m.hole[0], m.hole[1], m.hole[2], m.hole[3], m.hole[4], m.hole[5]);
      this._shotSound(f, t);
      // The shooter's PC decided the hit (on what that player saw). Accept it if the target is
      // alive, an enemy, near that point, and no cover stands between.
      if (m.hit) {
        const g = this.fighters.find((x) => x.id === m.hit.id);
        const p = m.hit.p;
        if (g && g.alive && g.team !== f.team && Array.isArray(p) && Math.hypot(p[0] - g.x, p[2] - g.z) < 2.5 && Math.abs(p[1] - g.y - 1) < 2.5 &&
          this.arena.sightLine([f.x, f.y + f.eyeH, f.z], [p[0], p[1], p[2]])) {
          this._damage(g, gunDamage(r.gun) * (ZONE_DAMAGE[m.hit.zone] || 1), f, m.hit.zone, t);
        }
      }
    } else if (m.k === 'nade') {
      if (f.alive && !this.over) this.nadesB.throw(f, +m.yaw || 0, Math.max(-89, Math.min(89, +m.pitch || 0)), t);
    } else if (m.k === 'gun') {
      // The host takes the player's attachments through the same Rust policy (an invalid code
      // gives the measured loadout), so its damage and rate checks use the effective gun.
      const g = this.deps.guns[m.i | 0] && effectiveGun(this.deps.guns[m.i | 0], m.at);
      if (g) { r.gun = g; f.gun = g; this._look(f, g, skinNum(m.s)); this._broadcast({ k: 'look', id: f.id, gun: m.i | 0, s: skinNum(m.s), at: g.attach || null }, false, r); }
    } else if (m.k === 'left') this.onLinkClosed(link);
  }
  // A player's connection dropped (host) or the host's did (client).
  onLinkClosed(link) {
    if (!this.active || !this.net) return;
    if (this.net.role === 'client') { if (link === this.net.link) this.deps.onNetLost('The host left or the connection dropped.'); return; }
    const r = this.remotes.find((x) => x.link === link);
    if (!r) return;
    this.remotes.splice(this.remotes.indexOf(r), 1);
    this.fighters.splice(this.fighters.indexOf(r.f), 1);
    r.f.group.removeFromParent();
    this.feed.unshift({ k: r.f.name, kc: r.f.team, v: 'left the game', vc: 'bots', t: this.t, info: true });
    this.feed.length = Math.min(this.feed.length, 5);
    this._renderFeed();
    this._updateScore();
  }
  _shotSound(f, t, position = null) {
    const p = position || f.muzzleWorld(this._v).toArray();
    const w = this._where(p[0], p[1], p[2]);
    this.deps.sfx.shot(f.gun ? f.gun.tone : 0.5, w.gain * (f.gun && f.gun.suppressed ? 0.45 : 1), w.route, w.muffle);
  }

  /* ---------- network: client ---------- */
  // The host started a match: build it from the roster. You play on this PC; everyone else
  // follows the host's updates.
  startClient(m, link) {
    if (!this.nadesB) this.nadesB = new BattleNades(this);
    this.nadesB.reset();
    this.stop();
    const d = this.deps;
    this.opts = { opponent: 'net', killsToWin: m.killsToWin };
    this.net = { role: 'client', link, myId: m.you };
    for (const f of this.fighters) f.group.removeFromParent();
    this._useArena(m.map || 'yard');
    this.arena.setGraphics(effectiveGraphics(d.settings), d.renderer);
    this.arena.holes.clear();
    for (const f of this.fighters) f.group.removeFromParent();
    this.fighters = []; this.humans = []; this.bots = []; this.remotes = []; this.proxies = [];
    this.teamScore = { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0, bots: 0 };
    this.feed = [];
    this.matchPoints = 0;
    this.noises = []; this.intelQ = []; this.comms = []; this._renderComms();
    for (const e of m.roster) {
      const f = new Fighter({ name: e.name, team: e.team, color: TEAM_COLOR[e.team] || 0xffffff, human: e.human });
      f.id = e.id;
      f.gun = effectiveGun(d.guns[e.gun] || d.guns[0], e.at);
      this._look(f, f.gun, e.id === m.you ? (d.skinOf ? d.skinOf(f.gun) : null) : skinNum(e.skin), e.id === m.you);
      if (e.human) f.showBar = false;
      this.fighters.push(f);
      this.arena.scene.add(f.group);
      if (e.id === m.you) {
        let h = this.humanPool[0];
        if (!h) h = this.humanPool[0] = new Human(f, 'mouse', { ...d }, d.slotOf);
        h.f = f; h.controls = 'mouse'; h.padIndex = -1; h.releaseAll();
        h.setGun(f.gun);
        f.alive = false;                     // until the host's spawn message
        this.humans.push(h);
      } else this.proxies.push(new Proxy(f));
    }
    this.atmo = { night: !!m.night, weather: typeof m.weather === 'string' ? m.weather : 'auto', fog: !!m.fog };
    this._setNight(this.atmo.night, this.atmo.weather, this.atmo.fog);
    this.arena.setGraphics(effectiveGraphics(d.settings), d.renderer);
    const t = d.now();
    this.t = t; this.prevT = t; this._nextSnap = 0;
    this.active = true; this.paused = false; this.over = false;
    this.hud.root.hidden = false;
    this.hud.end.hidden = true;
    this._layoutHud();
    this._updateScore();
    this._renderFeed();
  }

  _clientMsg(m) {
    const t = this.deps.now(), me = this.humans[0];
    if (m.k === 'nd') { this.nadesB.ghost(m, this.t); return; }
    if (m.k === 'blast') { this.nadesB.remoteBlast(m, this.t); return; }
    if (m.k === 'snap') {
      for (const e of m.f) {
        const [id, x, z, yaw, pitch, crouch, health, alive, flash, kills, deaths, y = 0, light = 1, ads = 0, nades] = e;
        const f = this.fighters.find((g) => g.id === id);
        if (!f) continue;
        f.kills = kills; f.deaths = deaths;
        if (me && f === me.f) {
          f.health = health;
          if (nades !== undefined && t >= (f.nadeAt || 0) + 0.5) f.nades = nades;   // (after a throw, until the host has it)
          if (f.alive && !alive) { f.alive = false; f.respawnAt = t + RESPAWN_S; }
          continue;
        }
        f.health = health; f.alive = !!alive; f.light = !!light; f.ads = +ads || 0;
        if (flash) f.flashUntil = t + 0.05;
        const p = this.proxies.find((q) => q.f === f);
        if (p) { p.buf.push([t, x, z, yaw, pitch, crouch, y]); if (p.buf.length > 12) p.buf.shift(); }
      }
      let changed = false;
      for (const k of Object.keys(m.s)) if (this.teamScore[k] !== m.s[k]) { this.teamScore[k] = m.s[k]; changed = true; }
      if (changed) this._updateScore();
    } else if (m.k === 'spawn' && me) {
      me.f.alive = true; me.f.health = MAX_HEALTH; me.f.protectUntil = t + PROTECT_S;
      me.respawn(m.x, m.z, t, +m.y || 0);
      this._resetReport();
      me.look.setAngles(m.yaw, 0);
    } else if (m.k === 'tr') {
      const by = this.fighters.find((g) => g.id === m.by);
      this._addTracer(new THREE.Vector3(m.a[0], m.a[1], m.a[2]), m.b, t, m.team, false, m.by);
      if (m.hole) this.arena.holes.add(m.hole[0], m.hole[1], m.hole[2], m.hole[3], m.hole[4], m.hole[5]);
      if (by) { by.flashUntil = t + 0.05; this._shotSound(by, t, m.a); }
    } else if (m.k === 'hurt' && me) {
      this._hurtFlash(me, Array.isArray(m.from) ? { x: m.from[0], z: m.from[1] } : null, t);
      if (m.id) this._taken(m.id, m.zone, +m.dmg || 0);
    } else if (m.k === 'comm') {
      this._addComm(String(m.who || '?').slice(0, 40), String(m.team || 'bots'), String(m.text || '').slice(0, 80), t);
    } else if (m.k === 'look') {
      const f = this.fighters.find((g) => g.id === m.id), g = this.deps.guns[m.gun | 0] && effectiveGun(this.deps.guns[m.gun | 0], m.at);
      if (f && g && (!me || f !== me.f)) this._look(f, g, skinNum(m.s));
    } else if (m.k === 'hm' && me) {
      this._hitMarker(me, m.kind, t);
      if (m.id) this._dealt(m.id, +m.dmg || 0);
      if (m.kind === 'kill') this._earn('kill', !!m.head);
    } else if (m.k === 'feed') {
      this.feed.unshift(m.e);
      this.feed.length = Math.min(this.feed.length, 5);
      this._renderFeed();
      if (me && m.e.vid === me.f.id) {
        me.killedBy = m.e.k; me.killerId = m.e.kid || null;
        if (!this.kc && me.killerId) this._startKillCam(t);
      }
    } else if (m.k === 'end') {
      for (const h of this.humans) h.releaseAll();
      if (me && m.team === me.f.team) this._earn('win');
      this._showEnd(m.title, m.rows, false);
      this.deps.onEnd();
    }
  }

  _clientUpdate(t) {
    const dt = Math.min(0.1, Math.max(0, t - this.prevT));
    this.prevT = t; this.t = t;
    const me = this.humans[0];
    if (me) me.update(t, this.over ? 0 : dt, this);
    this._separate();
    this.nadesB.update(this.over ? 0 : dt, t);
    this._updateBlasts(t);
    // Others: drawn INTERP_DELAY behind, between the two updates around that moment.
    const rt = t - INTERP_DELAY;
    for (const p of this.proxies) {
      const b = p.buf, f = p.f;
      if (!b.length) continue;
      let i = b.length - 1;
      while (i > 0 && b[i - 1][0] > rt) i--;
      const A = b[Math.max(0, i - 1)], B = b[i];
      const k = B[0] === A[0] ? 1 : Math.min(1, Math.max(0, (rt - A[0]) / (B[0] - A[0])));
      f.x = A[1] + (B[1] - A[1]) * k; f.z = A[2] + (B[2] - A[2]) * k;
      let dy = ((B[3] - A[3] + 540) % 360) - 180;
      f.yaw = A[3] + dy * k; f.pitch = A[4] + (B[4] - A[4]) * k; f.crouch = A[5] + (B[5] - A[5]) * k;
      f.y = Math.abs(B[6] - A[6]) > 1.5 ? B[6] : A[6] + (B[6] - A[6]) * k;
    }
    if (me && me.f.alive && t >= this._nextSnap) {
      this._nextSnap = t + 1 / SNAP_HZ;
      const f = me.f;
      this.net.link.send({ k: 'st', x: r2(f.x), z: r2(f.z), y: r2(f.y), yaw: r1(f.yaw + f.viewDY), pitch: r1(f.pitch + f.viewDP), crouch: r2(f.crouch), fl: f.light ? 1 : 0, a: r2(f.ads) }, true);
    }
    for (const f of this.fighters) f.updateVisual(t);
    this._killCam(t);
    const ears = this.humans[0];
    if (ears) { this.deps.sfx.listen(ears.camera); if (!this.kc && !this.over) this.deps.sfx.observeSteps(this.fighters, ears.camera, this.arena, t, null, ears.f.id); }
    this._updateTorches();
    this.arena.update(dt, t, me ? me.camera.position : null);
    this._updateTracers(t);
    this._updateHud(t);
  }

  // Your shot in a network game: decided here against what you see (so aiming feels exactly
  // like single player), then sent to the host, which applies the damage.
  _clientFire(shooter, shotT) {
    const f = shooter.f, d = this._dir, o = this._eye;
    if (!f.alive || this.over) return;
    shooter.shotDirection(shotT, d);
    shooter.eye(o);
    const tw = this.arena.raycast(o, d, 200, this._hit);
    let best = null, bt = tw;
    for (const g of this.fighters) {
      if (g === f || g.team === f.team || !g.alive) continue;
      const r = g.raycast(o, d);
      if (r && r.t < bt) { bt = r.t; best = { g, r }; }
    }
    const end = bt === Infinity ? 60 : bt;
    const b = [r2(o[0] + d[0] * end), r2(o[1] + d[1] * end), r2(o[2] + d[2] * end)];
    const from = this._v.set(o[0] + d[0] * 0.6, o[1] - 0.12 + d[1] * 0.6, o[2] + d[2] * 0.6);
    this._addTracer(from, b, shotT, f.team, false, f.id);
    let hole = null;
    if (!best && tw !== Infinity) {
      const n = this._hit.n;
      hole = [b[0], b[1], b[2], n[0], n[1], n[2]];
      this.arena.holes.add(hole[0], hole[1], hole[2], n[0], n[1], n[2]);
    }
    const hit = best ? { id: best.g.id, zone: best.r.zone, p: best.r.p.map(r2) } : null;
    if (best) this._hitMarker(shooter, best.r.zone === 'head' ? 'head' : 'hit', shotT);
    this.net.link.send({ k: 'shot', b, hole, hit });
    this.deps.sfx.shot(f.gun.tone, 1);
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
    if (code === 'Space' && this.kc && !p1.f.alive) { if (down) this.kc = null; return true; }
    if (code === 'KeyV' && this.kc && !p1.f.alive) { if (down) { this.kc.pov = this.kcPov = !this.kc.pov; this._repVer++; } return true; }
    const map = { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'sprint', Space: 'crouch', KeyQ: 'leanL', KeyE: 'leanR', KeyC: 'vault' };
    if (!p2) map.ShiftRight = 'sprint';
    if (map[code]) { p1.in[map[code]] = down; return true; }
    if (code === 'KeyR') { if (down) p1.reload(); return true; }
    // Caps Lock (or G): a grenade (games against bots). On a Mac Caps Lock sends only key-up every other press.
    if (code === 'CapsLock' || code === 'KeyG') {
      if (this.paused || this.over) return true;
      if (down || (code === 'CapsLock' && this.t - (this._capsDown || -9) > 0.6)) {
        if (down) this._capsDown = this.t;
        if (this.net && this.net.role === 'client') {
          // online: the host throws it (and decides the damage); every PC draws it flying
          const f = p1.f;
          if (f.alive && (f.nades ?? 2) > 0 && this.t >= (f.nadeAt || 0)) { f.nades = (f.nades ?? 2) - 1; f.nadeAt = this.t + 1; this.net.link.send({ k: 'nade', yaw: r1(p1.look.yaw), pitch: r1(p1.look.pitch) }); if (p1.rig.melee) p1.rig.melee(); this.deps.sfx.knife(0.6); }
        } else if (this.nadesB.throw(p1.f, p1.look.yaw, p1.look.pitch, this.t)) { if (p1.rig.melee) p1.rig.melee(); this.deps.sfx.knife(0.6); }
      }
      return true;
    }
    if (code === 'KeyI') { if (down && !p1.ads) p1.rig.inspect(); return true; }
    if (code === 'Interact' || code === 'KeyF') { if (down && this.night) { p1.f.light = !p1.f.light; p1.rig.setTorch(p1.f.light); if (this.deps.sfx.click) this.deps.sfx.click(); } return true; }
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
    // Shadows are redrawn every other frame (the map never moves; people move a little).
    r.shadowMap.autoUpdate = false;
    this._frameN = (this._frameN || 0) + 1;
    if (this._frameN % 2 === 0 || this._frameN < 3) r.shadowMap.needsUpdate = true;
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
      const ownVis = h.f.group.visible;
      if (!(this.kc && i === 0)) h.f.group.visible = false;      // not your own body (except in the replay)
      const wp = this.deps.worldPost;
      if (wp && wp.active) wp.draw(this.arena.scene, h.camera); else r.render(this.arena.scene, h.camera);
      h.f.group.visible = ownVis;
      r.clearDepth();
      const rig = this.kc && this.kc.pov && i === 0 && this.puppet ? this.puppet.rig : h.rig;
      rig.setAspect(aspect, v.h);
      r.render(rig.scene, rig.camera);
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
  _addTracer(a, b, t, team, replaying = false, by = 0) {
    if (!replaying) {
      const sh = (this.rec || (this.rec = { frames: [], shots: [] })).shots;
      sh.push({ t, a: [a.x, a.y, a.z], b: [b[0], b[1], b[2]], team, by });
      while (sh.length && sh[0].t < t - 5) sh.shift();
    }
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
    const comms = el('div', 'b-comms');
    top.append(score);
    root.append(top, feed, comms);
    const end = el('div', 'b-end');
    end.hidden = true;
    const box = el('div', 'b-end-box');
    const endTitle = el('h1', '', '');
    const endTable = el('div', 'b-table');
    const again = el('button', 'primary', 'Play again');
    const leave = el('button', '', 'Back to the range');
    again.type = leave.type = 'button';
    const row = el('div', 'row'); row.append(again, leave);
    const endNote = el('p', 'small', '');
    box.append(endTitle, endTable, row, endNote);
    end.append(box);
    root.append(end);
    this.deps.hudRoot.insertBefore(root, this.deps.hudRoot.querySelector('#menu'));   // under the menu
    this.hud = { root, score, feed, comms, end, endTitle, endTable, endNote, again, leave, views: [] };
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
      const prot = el('div', 'b-prot'); prot.hidden = true;
      const nades = el('div', 'mg-nades', ''), vig = el('div', 'dmg-vig'), lowhp = el('div', 'low-hp'); lowhp.append(el('span', '', 'LOW HEALTH'));
      const name = el('div', 'b-name t-' + h.f.team, h.f.name + ' · ' + h.gun.name);
      const hp = el('div', 'b-hp'); const hpFill = el('i'); hp.append(hpFill);
      const hpText = el('div', 'b-hptext', '100');
      const ammo = el('div', 'b-ammo', '');
      const ctl = el('div', 'b-ctl small', '');
      const pts = el('div', 'b-points', '');
      const rep = el('div', 'b-report'); rep.hidden = true;
      box.append(nades, vig, lowhp, hurt, cross, hit, pts, dead, prot, rep, name, hp, hpText, ammo, ctl);
      this.hud.root.insertBefore(box, this.hud.root.firstChild);
      return { nades, vig, lowhp, vigT: -9, box, cross, hit, hurt, dead, prot, rep, hpFill, hpText, ammo, ctl, pts, ptsUntil: 0, hitUntil: 0, hurtUntil: 0, last: {} };
    });
  }
  /* ---------- bodies do not overlap ---------- */
  // Push overlapping fighters apart (circles of the body radius, if at about the same height).
  // Players on other PCs control their own position, so only the others move for them.
  _separate() {
    const F = this.fighters.filter((f) => f.alive);
    if (F.length < 2) return;
    const fixed = new Set([...(this.remotes || []).map((r) => r.f), ...(this.proxies || []).map((p) => p.f)]);
    const MIN = 0.66;
    const moved = new Set();
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
        const a = F[i], b = F[j];
        if (Math.abs(a.y - b.y) > 1.5) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= MIN) continue;
        if (d < 1e-4) { const r = (i * 7 + j * 13) % 6.283; dx = Math.cos(r); dz = Math.sin(r); } else { dx /= d; dz /= d; }
        const wa = fixed.has(a) ? 0 : 1, wb = fixed.has(b) ? 0 : 1;
        if (!wa && !wb) continue;
        const push = (MIN - d) / (wa + wb);
        a.x -= dx * push * wa; a.z -= dz * push * wa;
        b.x += dx * push * wb; b.z += dz * push * wb;
        if (wa) moved.add(a);
        if (wb) moved.add(b);
      }
    }
    for (const f of moved) this.arena.resolve(f);
  }

  /* ---------- sounds bots can hear, and the bots' radio ---------- */
  _noise(f, kind, range, t) {
    const n = this.noises || (this.noises = []);
    n.push({ x: f.x, y: f.y, z: f.z, t, kind, range, team: f.team });
    while (n.length > 64 || (n.length && n[0].t < t - 0.6)) n.shift();
    // Keep AI noises untouched. Presentation footsteps use the same Rust cadence
    // on local and interpolated remote actor poses, without new network messages.
    if ((kind === 'reload' || kind === 'vault') && this.humans[0]?.f !== f) {
      const w = this._where(f.x, f.y + 1, f.z, kind, kind === 'vault' ? 24 : 16);
      this.deps.sfx[kind](w.gain, w.route, w.muffle);
    }
  }
  _where(x, y, z, kind = 'shot', reach = 80) {
    const camera = this.humans[0]?.camera;
    if (!camera) return {dist:0,gain:0,pan:0,muffle:0,route:0};
    return this.deps.sfx.locate(kind, {x,y,z}, camera, this.arena, null, {reach});
  }
  // Footsteps (by speed: sprinting is loud, crouch-walking almost silent), vaults, reloads.
  _sounds(f, t, dt) {
    if (!f.alive || dt <= 0) { f._sx = f.x; f._sz = f.z; return; }
    const sp = Math.hypot(f.x - (f._sx ?? f.x), f.z - (f._sz ?? f.z)) / dt;
    f._sx = f.x; f._sz = f.z;
    if (sp < 12 && t >= (f._nextStep || 0)) {
      const range = sp > 4.2 ? 16 : sp > 2.2 ? 8 : sp > 0.8 ? 3 : 0;
      if (range) { this._noise(f, 'steps', range, t); f._nextStep = t + 0.32; }
    }
    const c = this._ctl(f);
    const vaulting = !!(c && c.vault);
    if (vaulting && !f._vaultHeard) this._noise(f, 'vault', 10, t);
    f._vaultHeard = vaulting;
    const reloading = !!(c && c.weapon && c.weapon.reloading);
    if (reloading && !f._reloadHeard) this._noise(f, 'reload', 7, t);
    f._reloadHeard = reloading;
  }
  // Distance from point p to the shot segment o + s d, 0 <= s <= len.
  _rayDist(o, d, len, px, py, pz) {
    const wx = px - o[0], wy = py - o[1], wz = pz - o[2];
    const s = Math.max(0, Math.min(len, wx * d[0] + wy * d[1] + wz * d[2]));
    return Math.hypot(wx - d[0] * s, wy - d[1] * s, wz - d[2] * s);
  }
  // A bot shares what it saw or heard; its teammates get it a moment later.
  shareIntel(from, intel) { this.intelQ.push({ at: this.t + 0.4, team: from.f.team, intel }); }
  radio(f, text, t) {
    // the same line from a teammate a moment ago: no need to repeat it
    if ((this.comms || []).some((c) => c.text === text && c.team === f.team && t - c.t < 3)) return;
    this._addComm(f.name, f.team, text, t);
    if (this.net && this.net.role === 'host') this._broadcast({ k: 'comm', who: f.name, team: f.team, text });
  }
  _addComm(who, team, text, t) {
    this.comms.push({ who, team, text, t });
    // Spoken out loud (setting: Bot voices), after a radio click.
    const v = this.deps.voice;
    if (v && this.deps.settings.battle.voices !== false) {
      v.volume = Math.min(1, this.deps.sfx.volume * 2.4);
      if (v.say(text, who) && this.deps.sfx.radio) this.deps.sfx.radio();
    }
    if (this.comms.length > 4) this.comms.shift();
    this._renderComms();
  }
  _renderComms() {
    if (!this.hud) return;
    const now = this.t;
    this.hud.comms.replaceChildren(...(this.comms || []).filter((c) => now - c.t < 6).map((c) => {
      const r = el('div', 'b-comm');
      r.append(el('span', 'b-comm-who t-' + c.team, c.who.split(' (')[0] + ':'), ' ' + c.text);
      return r;
    }));
  }

  /* ---------- hit report and kill cam ---------- */
  _resetReport() { this.report = { taken: new Map(), dealt: new Map() }; this._repVer = (this._repVer || 0) + 1; }
  _taken(id, zone, dmg) {
    if (!this.report) this._resetReport();
    const e = this.report.taken.get(id) || { head: 0, body: 0, limb: 0, dmg: 0 };
    e[zone in e ? zone : 'body']++; e.dmg += dmg;
    this.report.taken.set(id, e); this._repVer++;
  }
  _dealt(id, dmg) {
    if (!this.report) this._resetReport();
    const e = this.report.dealt.get(id) || { hits: 0, dmg: 0 };
    e.hits++; e.dmg += dmg;
    this.report.dealt.set(id, e); this._repVer++;
  }
  _noteHit(g, by, zone, dmg) {
    const me = this.humans[0] && this.humans[0].f;
    if (!me || this.humans.length > 1) return;
    if (g === me) this._taken(by.id, zone, dmg);
    if (by === me) this._dealt(g.id, dmg);
  }
  /* Kill cam: a replay of the last seconds before you died, from just behind your killer's
     shoulder, aiming the way they aimed (bots and real players alike). Every PC records
     everyone's position, aim, crouch, muzzle flash and tracers for a few seconds; on your
     death those are played back. Space skips. */
  _record(t) {
    const rec = this.rec || (this.rec = { frames: [], shots: [] });
    rec.frames.push({ t, d: this.fighters.map((f) => [f.id, f.x, f.y, f.z, f.yaw + (f.viewDY || 0), f.pitch + (f.viewDP || 0), f.crouch, f.alive ? 1 : 0, t < f.flashUntil ? 1 : 0, f.ads || 0]) });
    while (rec.frames.length && rec.frames[0].t < t - 5) rec.frames.shift();
  }
  _startKillCam(t) {
    const h = this.humans[0];
    const k = this.fighters.find((g) => g.id === h.killerId && g !== h.f);
    const rec = this.rec;
    if (!k || !rec || !rec.frames.length) { this.kc = null; return; }
    const from = Math.max(rec.frames[0].t, t - 2.3);
    this.kc = { killer: k, start: t, from, until: t + (t - from) + 0.5, shot: rec.shots.findIndex((s) => s.t >= from), pov: this.kcPov !== false, prevT: t };
    this.lastKillCam = { killer: k.name, frames: rec.frames.length, shots: rec.shots.filter((s) => s.t >= from).length };
    if (this.kc.shot < 0) this.kc.shot = rec.shots.length;
  }
  // A stand-in player that carries your killer's gun (with their skin) for the replay.
  _puppet(k) {
    if (!this.puppet) {
      const pf = new Fighter({ name: 'replay', team: 'bots', color: 0xffffff, human: true });
      this.puppet = new Human(pf, 'mouse', { ...this.deps }, this.deps.slotOf);
    }
    const P = this.puppet, gun = k.gun || this.deps.guns[0], key = gun.id + '|' + k.skin;
    if (P._key !== key) { P.rig.forceSkin = k.skin ?? null; P.setGun(gun); P._key = key; }
    return P;
  }
  _killCam(t) {
    const h = this.humans[0];
    if (!h || this.humans.length > 1) return;
    const f = h.f;
    this._record(t);
    if (this._meAlive && !f.alive) this._startKillCam(t);
    this._meAlive = f.alive;
    if (f.alive || (this.kc && t > this.kc.until)) this.kc = null;
    // outlines: everyone else, by day only
    for (const g of this.fighters) { const v = g !== f && g.alive && !this.night; g.outline.visible = v; for (const l of g.legs) l.o.visible = v; }
    if (!this.kc) return;
    const kc = this.kc, rec = this.rec, rt = kc.from + (t - kc.start);
    // the recorded frames around the replay time
    const fr = rec.frames;
    let j = 1;
    while (j < fr.length - 1 && fr[j].t < rt) j++;
    const A = fr[Math.max(0, j - 1)], B = fr[j];
    const w = B.t === A.t ? 1 : Math.min(1, Math.max(0, (rt - A.t) / (B.t - A.t)));
    let kill = null;
    const dtR = Math.max(0, Math.min(0.1, t - kc.prevT)); kc.prevT = t;
    for (const g of this.fighters) {
      const a = A.d.find((e) => e[0] === g.id), b = B.d.find((e) => e[0] === g.id) || a;
      if (!a) { g.group.visible = false; continue; }
      const L = (i) => a[i] + (b[i] - a[i]) * w;
      const dy = ((b[4] - a[4] + 540) % 360) - 180, yaw = a[4] + dy * w, crouch = L(6), sy = 1 + (0.7 - 1) * crouch;
      g.group.visible = !!(w < 0.5 ? a[7] : b[7]);
      g.group.position.set(L(1), L(2), L(3));
      g.group.rotation.y = Math.PI - yaw * DEG2RAD;
      g.scaleG.scale.y = sy;
      g.gunG.rotation.x = -Math.max(-30, Math.min(30, L(5))) * DEG2RAD * 0.5;
      g.flash.visible = !!(w < 0.5 ? a[8] : b[8]);
      g.barBg.visible = g.barFg.visible = false;
      if (g === kc.killer) kill = { x: L(1), y: L(2), z: L(3), yaw, pitch: L(5), eye: 1.6 + (1.12 - 1.6) * crouch, ads: a[9] === undefined ? 0 : L(9) };
    }
    // shots fired in the replayed moment
    while (kc.shot < rec.shots.length && rec.shots[kc.shot].t <= rt) {
      const s = rec.shots[kc.shot++];
      if (s.t < kc.from) continue;
      this._addTracer(this._v.set(s.a[0], s.a[1], s.a[2]), s.b, t, s.team, true);
      if (kc.pov && s.by === kc.killer.id && this.puppet) this.puppet.rig.kick();
    }
    if (!kill) return;
    if (kc.pov) {
      // Their eyes: their aim (with recoil), their gun and sight, aiming in when they did.
      const P = this._puppet(kc.killer), cam = h.camera, s = this.deps.settings;
      kc.killer.group.visible = false;
      cam.position.set(kill.x, kill.y + kill.eye, kill.z);
      cam.rotation.set(Math.max(-89, Math.min(89, kill.pitch)) * DEG2RAD, -kill.yaw * DEG2RAD, 0);
      const ads = Math.max(0, Math.min(1, kill.ads));
      const tH = Math.tan(s.fov * DEG2RAD / 2), tA = Math.tan(this.deps.adsVFov(P.optic) * DEG2RAD / 2);
      const fov = 2 * Math.atan(tH + (tA - tH) * ads) / DEG2RAD;
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      P.rig.animations = s.animations; P.rig.reloadP = -1; P.rig.sprinting = false; P.rig.bobY = 0;
      P.rig.root.visible = true;
      P.rig.update(dtR, ads, t);
      if (P.reticle) P.reticle.material.opacity = Math.min(1, Math.max(0, (ads - 0.55) / 0.35));
      return;
    }
    // over the killer's shoulder, along their aim
    const cam = h.camera, y = kill.yaw * DEG2RAD, p = kill.pitch * DEG2RAD;
    const fx = Math.sin(y) * Math.cos(p), fy = Math.sin(p), fz = -Math.cos(y) * Math.cos(p);
    const ex = kill.x, ey = kill.y + kill.eye, ez = kill.z;
    cam.position.set(ex - fx * 1.6 + Math.cos(y) * 0.75, ey + 0.3 - fy * 1.6, ez - fz * 1.6 + Math.sin(y) * 0.75);
    cam.lookAt(ex + fx * 12, ey + fy * 12, ez + fz * 12);
    if (cam.fov !== this.deps.settings.fov) { cam.fov = this.deps.settings.fov; cam.updateProjectionMatrix(); }
  }
  // The panel while you are down: who got you, a body showing where you were hit, damage.
  _renderReport(box, h) {
    const rep = this.report || { taken: new Map(), dealt: new Map() };
    const k = this.fighters.find((g) => g.id === h.killerId);
    const tk = (k && rep.taken.get(k.id)) || { head: 0, body: 0, limb: 0, dmg: 0 };
    const dl = (k && rep.dealt.get(k.id)) || { hits: 0, dmg: 0 };
    let other = 0;
    for (const [id, e] of rep.taken) if (!k || id !== k.id) other += e.dmg;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 60 120'); svg.setAttribute('class', 'b-body');
    const fill = (n) => (n ? 'rgba(255,' + Math.max(40, 150 - n * 35) + ',' + Math.max(30, 120 - n * 30) + ',0.95)' : '#3a3f47');
    const part = (tag, attrs, n) => { const e = document.createElementNS(NS, tag); for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v); e.setAttribute('fill', fill(n)); svg.append(e); };
    part('circle', { cx: 30, cy: 13, r: 10 }, tk.head);
    part('rect', { x: 18, y: 26, width: 24, height: 40, rx: 5 }, tk.body);
    for (const x of [7, 45]) part('rect', { x, y: 27, width: 8, height: 36, rx: 4 }, tk.limb);
    for (const x of [19, 31]) part('rect', { x, y: 68, width: 10, height: 48, rx: 4 }, tk.limb);
    const line = (txt, cls = '') => el('div', cls, txt);
    const stats = el('div', 'b-rep-stats');
    if (k) {
      stats.append(
        line('Hits on you: ' + (tk.head + tk.body + tk.limb) + ' · ' + Math.round(tk.dmg) + ' damage'),
        line('Head ' + tk.head + ' · Body ' + tk.body + ' · Arms / legs ' + tk.limb, 'b-rep-zones'),
        line('You hit ' + k.name + ' ' + dl.hits + ' times · ' + Math.round(dl.dmg) + ' damage', dl.hits ? 'b-rep-dealt' : ''),
        line(k.name + ' had ' + Math.max(0, Math.ceil(k.health)) + ' HP left'));
    } else stats.append(line(h.killedBy === 'the acid' ? 'The acid got you.' : 'Eliminated.'));
    if (other > 0) stats.append(line('From others: ' + Math.round(other) + ' damage'));
    const title = el('div', 'b-rep-title');
    if (k) title.append('Killed by ', el('b', 't-' + k.team, k.name), ' · ' + (k.gun ? k.gun.name : ''));
    else title.textContent = 'Eliminated by ' + (h.killedBy || '?');
    const body = el('div', 'b-rep-body'); body.append(svg, stats);
    const back = Math.max(0, Math.ceil(h.f.respawnAt - this.t));
    const foot = el('div', 'b-rep-skip', 'Back in ' + back + (this.kc ? ' · V: ' + (this.kc.pov ? 'shoulder view' : 'their view') + ' · Space: skip' : ''));
    box.replaceChildren(...[this.kc ? el('div', 'b-rep-cam', 'KILL CAM · ' + (this.kc.pov ? 'THEIR VIEW' : 'REPLAY')) : null, title, body, foot].filter(Boolean));
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
    v.vigT = t;                                    // red vignette on every hit
    if (!by) { v.hurt.className = 'b-hurt on acid'; return; }   // acid: green all round
    // Which side the damage came from (left/right/front/behind) shows as a red edge.
    const ang = Math.atan2(by.x - h.f.x, -(by.z - h.f.z)) * 180 / Math.PI;
    let rel = ((ang - h.look.yaw + 540) % 360) - 180;
    v.hurt.className = 'b-hurt on ' + (Math.abs(rel) < 45 ? 'front' : Math.abs(rel) > 135 ? 'back' : rel > 0 ? 'right' : 'left');
  }
  _updateScore() {
    const o = this.opts, two = o.opponent === 'p2';
    const parts = [];
    const seen = new Set();
    for (const f of this.fighters) {
      if (seen.has(f.team)) continue;
      seen.add(f.team);
      const label = f.team === 'bots' ? 'Bots' : this.net ? f.name : f.team === 'p1' ? (two ? 'P1' : 'You') : 'P2';
      parts.push([label, f.team, this.teamScore[f.team] || 0]);
    }
    this.hud.score.replaceChildren(...parts.map(([n, c, s]) => el('span', 't-' + c, n + ' ' + s)), el('span', 'b-goal', 'first to ' + o.killsToWin));
  }
  _renderFeed() {
    this.hud.feed.replaceChildren(...this.feed.map((e) => {
      const r = el('div', 'b-feedrow');
      if (e.info) r.append(el('span', 't-' + e.kc, e.k), el('span', 'b-icon', ' ' + e.v));
      else r.append(el('span', 't-' + e.kc, e.k), el('span', 'b-icon', e.head ? ' ✦ ' : ' › '), el('span', 't-' + e.vc, e.v));
      return r;
    }));
  }
  _updateHud(t) {
    if (this.comms && this.comms.length && t - this.comms[0].t > 6) { this.comms.shift(); this._renderComms(); }
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
      const vk = Math.max(0, 1 - (t - v.vigT) / 0.7);
      if (Math.abs((L.vk || 0) - vk) > 0.02 || (vk === 0 && L.vk)) { L.vk = vk; v.vig.style.opacity = vk.toFixed(2); }
      const low = f.alive && f.health <= 35;
      if (L.low !== low) { L.low = low; v.lowhp.classList.toggle('on', low); }
      const nt = f.alive && i === 0 ? ('● '.repeat(f.nades ?? 2).trim() || 'no grenades') + ' · Caps Lock' : '';
      if (L.nt !== nt) { L.nt = nt; v.nades.textContent = nt; }
      if (t > v.ptsUntil && v.pts.classList.contains('on')) v.pts.className = 'b-points';
      const deadMsg = f.alive ? '' : 'Eliminated by ' + (h.killedBy || '?') + ' · back in ' + Math.max(0, Math.ceil(f.respawnAt - t));
      const back = Math.max(0, Math.ceil(f.respawnAt - t));
      const prot = f.alive && t < f.protectUntil ? 'Spawn protection ' + Math.ceil(f.protectUntil - t) + ' · shooting ends it' : '';
      if (L.prot !== prot) { L.prot = prot; v.prot.hidden = !prot; v.prot.textContent = prot; }
      const repKey = i === 0 && !f.alive && this.humans.length === 1 ? (h.killerId || 0) + '|' + (this.kc ? 1 : 0) + '|' + this._repVer + '|' + back : '';
      const showDead = deadMsg && !repKey ? deadMsg : '';
      if (L.dead !== showDead) { L.dead = showDead; v.dead.hidden = !showDead; v.dead.textContent = showDead; }
      if (L.rep !== repKey) { L.rep = repKey; v.rep.hidden = !repKey; if (repKey) this._renderReport(v.rep, h); }
      const ctl = i === 1 ? (h.controls === 'pad' ? 'Gamepad' : 'Keys: I J K L move · arrows look · Enter fire · Right Shift aim · Backspace reload · / crouch') : '';
      if (L.ctl !== ctl) { L.ctl = ctl; v.ctl.textContent = ctl; }
    });
  }
}
