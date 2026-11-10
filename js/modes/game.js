import { applyMapArt } from '../render/pack-art.js?v=m6-integration';
import { sensoryFor } from '../balance/bomb-utility.js?v=m6-integration';
// Team Deathmatch, Capture the Flag and Bomb in the browser: draws the match simulation
// (sim.js) and runs your player with the range's own systems (look, sensitivity, recoil,
// spread, sights, weapon model: battle/human.js), at a fixed 60 Hz simulation.
//
// Map: flat-shaded low poly from the map file; static walls merged into one mesh, breakable
// panels in one instanced mesh, one directional light (a 1024 shadow map in High / Ultra).
import * as THREE from '../../vendor/three/three.module.min.js?v=m6-integration';
import { MatchMap } from './map.js?v=m6-integration';
import { initCore } from '../wasm/core.js?v=m6-integration';
import { Match, TICK } from './sim.js?v=m6-integration';
import { yawTo, wrap180, DEG } from './geom.js?v=m6-integration';
import { Fighter } from '../battle/fighter.js?v=m6-integration';
import { makeGadget, animateGadget, gasCloud, updateCloud, beam, stunStars, dashTrail } from './gadget-look.js?v=m6-integration';
import { buildMapLook, panelTextures } from './look.js?v=m6-integration';
import { Arena } from '../battle/arena.js?v=m6-integration';
import { Human } from '../battle/human.js?v=m6-integration';
import { drawCrosshair } from '../ui/crosshair.js?v=m6-integration';
import { effectiveGraphics } from '../render/quality.js?v=m6-integration';

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const TEAM_COLOR = { A: 0x5b8cff, B: 0xff7048 };
const MAX_TRACERS = 64;
const json = new Map();
const load = (url) => { if (!json.has(url)) json.set(url, fetch(url, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); })); return json.get(url); };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
let XRAY = null;
const xrayMat = (base) => XRAY || (XRAY = Object.assign(base.clone(), { depthTest: false, depthWrite: false }));
const GADGET_COLOR = { mine: 0xffc040, jammer: 0x60d0ff, catcher: 0x9cff70, drone: 0xe0e0e0, charge: 0xff5030, breach: 0xffa040 };
const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// Map looks per map id: floor, walls, cover, sky.
const LOOK = {
  yard: { floor: 0x8d877c, wall: 0xb9b2a4, low: 0x7f6a4e, edge: 0x6f6b66, soft: 0xa47a52, reinf: 0x5b6672, sky: 0xaec4d8, fog: [0xc0ccd6, 40, 140] },
  ranch: { floor: 0x9a8a70, wall: 0xd8d0c0, low: 0x6a5a44, edge: 0x6f6b66, soft: 0xb48a62, reinf: 0x56606c, door: 0x7a5434, sky: 0xb8cce0, fog: [0xc8d2dc, 50, 160] },
  embassy: { floor: 0x8e8a80, wall: 0xe4dccc, low: 0x5e5244, edge: 0x6f6b66, soft: 0xb08860, reinf: 0x56606c, door: 0x6a4a30, sky: 0xa8c0d8, fog: [0xbcc8d4, 50, 160] },
  workshop: { floor: 0x75706a, wall: 0xa8a49c, low: 0x5a5048, edge: 0x5f5b56, soft: 0xa47a52, reinf: 0x4e5864, door: 0x6e4c30, sky: 0x9fb2c4, fog: [0xa8b2bc, 45, 150] },
  depot: { floor: 0x6f6a62, wall: 0xa9a196, low: 0x6a5a44, edge: 0x5f5b56, soft: 0xa47a52, reinf: 0x56606c, sky: 0x9fb0c2, fog: [0xaab4be, 35, 120] },
};

export class ModeGame {
  // deps: { renderer, settings, guns, sfx, catalogue (optic by id), adsVFov, baseDpc, now,
  //         slotOf(gun), hudRoot, onEnd(), onPoints(kind, head), opticFor(gun) }
  constructor(deps) {
    this.deps = deps;
    this.active = false; this.paused = false; this.over = false; this.net = null;
    this._buildHud();
    this._buildTracers();
    this.o = [0, 0, 0]; this.d = [0, 0, 0];
  }

  /* ---------- start / stop ---------- */
  // o: { mode, map, difficulty, teamSize, abilities, minutes, headshot, op, side }
  async start(o) {
    // the map and operator data, and the Rust core (collision, raycasts, pathfinding)
    const [mapData, ops, abilities] = await Promise.all([load('data/maps/' + o.map + '.json'), load('data/ops.json'), load('data/abilities.json'), initCore()]);
    this.stop();
    const d = this.deps;
    this.opts = o;
    this.map = new MatchMap(mapData);
    this.m = new Match({ map: this.map, mode: o.mode, guns: d.guns, ops, abilities, teamSize: o.teamSize, difficulty: o.difficulty, abilitiesOn: o.abilities, minutes: o.minutes, prepTime: o.prepTime, headshot: o.headshot, seed: o.seed ?? ((Math.random() * 2 ** 31) | 0), human: { op: o.op, side: o.side } });
    this.me = this.m.human();
    this._buildScene();
    this._buildActors();
    this.prevT = d.now(); this.acc = 0; this.mapVersion = -1;
    this.rec = { frames: [], shots: [], hits: [] }; this.kc = null; this.hud.kcBox.hidden = true;
    this.feed = []; this._renderFeed(); this.points = 0; this._stepT = 0; this.fx = []; this.fx2 = []; this.vigT = -9; this.wasJammed = false;
    this.active = true; this.paused = false; this.over = false;
    this.hud.root.hidden = false; this.hud.end.hidden = true;
    this._refreshPanels();
    return this;
  }
  // Free what the last match put on the graphics card. Maps are rebuilt for every match, and
  // without this each new match left its geometry, floor textures and shadow map behind.
  _disposeScene() {
    const drop = (root) => {
      if (!root) return;
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        for (const m of o.material ? [].concat(o.material) : []) { if (m.map && m.map.userData.own) m.map.dispose(); m.dispose(); }
        if (o.isInstancedMesh) o.dispose();
      });
      root.removeFromParent();
    };
    drop(this.lookGroup); this.lookGroup = null;
    for (const im of Object.values(this.panelMeshes || {})) drop(im);
    this.panelMeshes = {}; this.panelMesh = null;
    drop(this.markerG); this.markerG = null;
    this._ringGeo = null; this.fx = []; this.fx2 = [];
    if (this.gMeshes) this.gMeshes.clear();
    if (this.objMeshes) this.objMeshes.clear();
    if (this.fig) { for (const f of this.fig.values()) f.dispose(); this.fig = null; }
    if (this.sun && !this.arena) { this.sun.shadow.dispose(); this.sun.dispose(); this.hemi.dispose(); }
    this.sun = this.hemi = null;
    if (this.map && this.map.dispose) this.map.dispose();
  }
  stop() {
    this.deps.sfx.stopAll?.();
    if (this.scene) { this._disposeScene(); this.scene = null; }
    this.active = false; this.paused = false;
    if (this.hud) { this.hud.root.hidden = true; this.hud.board.hidden = true; }
    if (this.h) this.h.releaseAll();
    if (this.deps.renderer) this.deps.renderer.shadowMap.autoUpdate = true;
  }
  pause() { if (!this.active) return; this.deps.sfx.hearing?.reset(); if (this.hud) this.hud.disruption.style.opacity = '0'; this.paused = true; if (this.h) this.h.releaseAll(); }
  resume(t) { this.paused = false; this.prevT = t; }
  refreshGraphics() { this._applyGraphics(); if (this.h) { this.h.rig.rebuild(); this.h.rig.setGun(this.h.gun, this.deps.slotOf(this.h.gun), this.h.optic); this.h._buildReticle(); } }
  changeGun() {}

  /* ---------- scene ---------- */
  _buildScene() {
    const map = this.map, L = LOOK[map.id] || LOOK.yard;
    if (map.data.arena) return this._buildArenaScene();
    this.arena = null;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(L.sky);
    scene.fog = new THREE.Fog(...L.fog);
    this.hemi = new THREE.HemisphereLight(0xe8eeff, 0x6a5e50, 1.7);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 1.6);
    this.sun.position.set(-18, 30, 12); this.sun.target.position.set(0, 0, 0);
    const S = Math.max(map.hx, map.hz) + 4;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 80 });
    this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.bias = -0.001;
    scene.add(this.hemi, this.sun, this.sun.target);
    // ground, floors, walls, furniture, trees (look.js)
    this.lookGroup = buildMapLook(scene, map, L);
    // breakable walls, cell by cell: every wall cell has a slot in the soft mesh and in the
    // reinforced mesh (it shows in the one matching its kind now: defenders reinforce soft
    // walls in prep); barricades one each. A broken one is scaled to nothing.
    const tex = panelTextures(), c = new THREE.Color();
    this.panelLook = L;
    this.panelMeshes = {};
    this.cellSlot = new Map();                 // solid index -> instance index
    const cells = map.panels.filter((pn) => pn.kind !== 'door').flatMap((pn) => pn.cells), doors = map.panels.filter((pn) => pn.kind === 'door');
    for (const [kind, list] of [['soft', cells], ['reinforced', cells], ['door', doors.map((pn) => pn.box)]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: tex[kind] }), list.length);
      im.castShadow = im.receiveShadow = true;
      list.forEach((b, k) => { this.cellSlot.set(b.i, k); im.setColorAt(k, c.setRGB(1, 1, 1)); });
      scene.add(im);
      this.panelMeshes[kind] = im;
    }
    this.panelMesh = map.panels.length ? true : null;
    // objectives (flags, bomb sites): drawn by the rules' markers
    this.markerG = new THREE.Group();
    scene.add(this.markerG);
    this.objMeshes = new Map();
    scene.add(this.tracers);
    this._applyGraphics();
  }
  // The Battle maps: the same scenery as Battle (the arena's own scene, lights and weather).
  _buildArenaScene() {
    if (!ModeGame.arenas) ModeGame.arenas = {};
    const id = this.map.data.arena;
    const ar = this.arena = ModeGame.arenas[id] || (ModeGame.arenas[id] = new Arena(id));
    this.scene = ar.scene;
    ar.setAtmosphere(false, 'auto', !!this.deps.settings.fog);
    ar.setGraphics(effectiveGraphics(this.deps.settings), this.deps.renderer);
    this.panelMesh = null; this.panelMeshes = {};
    if (this.markerG) this.markerG.removeFromParent();
    this.markerG = new THREE.Group();
    this.scene.add(this.markerG, this.tracers);
    this.objMeshes = new Map();
    if (this.gMeshes) this.gMeshes.clear();
  }
  _refreshPanels() {
    if (!this.panelMesh || this.mapVersion === this.map.version) return;
    this.mapVersion = this.map.version;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = this._pc || (this._pc = new THREE.Color());
    const M = this.panelMeshes, show = (im, k, b, on) => {
      if (!im) return;
      if (on) { p.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2); s.set(b.maxX - b.minX - 0.004, b.maxY - b.minY - 0.004, b.maxZ - b.minZ); } else s.set(0, 0, 0);
      im.setMatrixAt(k, mtx.compose(p, q, s));
    };
    for (const pn of this.map.panels) {
      if (pn.kind === 'door') {
        const k = this.cellSlot.get(pn.box.i);
        show(M.door, k, pn.box, pn.alive);
        // boards darken as they splinter
        if (M.door) M.door.setColorAt(k, c.setScalar(0.4 + 0.6 * Math.max(0, pn.hp) / 100));
        continue;
      }
      for (const cell of pn.cells) {
        const k = this.cellSlot.get(cell.i);
        show(M.soft, k, cell, cell.alive && cell.kind === 'soft');
        show(M.reinforced, k, cell, cell.alive && cell.kind === 'reinforced');
        // chipped cells look scuffed
        if (M.soft && cell.kind === 'soft') M.soft.setColorAt(k, c.setScalar(0.7 + 0.3 * Math.max(0, cell.hp) / 120));
      }
    }
    for (const im of Object.values(this.panelMeshes)) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
  _applyGraphics() {
    if (!this.scene) return;
    const artQuality = effectiveGraphics(this.deps.settings);
    applyMapArt(this.lookGroup, artQuality, this.deps.renderer);
    if (this.fig) for (const f of this.fig.values()) f.setDetail(artQuality);
    if (this.arena) { this.arena.setGraphics(effectiveGraphics(this.deps.settings), this.deps.renderer); return; }
    const q = effectiveGraphics(this.deps.settings), high = q === 'high' || q === 'ultra', r = this.deps.renderer;
    this.sun.castShadow = high;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    this.hemi.intensity = q === 'low' ? 2.2 : 1.7;
  }

  /* ---------- actors ---------- */
  _buildActors() {
    const d = this.deps, m = this.m;
    this.fig = new Map();
    for (const a of m.actors) {
      const f = new Fighter({ name: a.name, team: a.team, color: TEAM_COLOR[a.team], human: a.human });
      f.setDetail(effectiveGraphics(d.settings));
      f.setLook(a.gunData, Math.max(0, d.guns.indexOf(a.gunData)), a.human && d.skinOf ? d.skinOf(a.gunData) : null);
      f.showBar = !a.human && a.team === this.me.team;
      f.id = a.id;
      this.scene.add(f.group);
      this.fig.set(a.id, f);
    }
    // you: the range's controls, sights and recoil on your op's gun and default sight
    const f = this.fig.get(this.me.id);
    const op = this.me.op;
    const deps = { ...d, opticFor: (g) => d.opticById(op.sight, g) };
    if (!this.h) this.h = new Human(f, 'mouse', deps, d.slotOf);
    this.h.f = f; this.h.deps = deps; this.h.controls = 'mouse'; this.h.releaseAll();
    this.h.setGun(this.me.gunData);
    this.h.respawn(this.me.x, this.me.z, d.now(), this.me.y);
    this.h.look.setAngles(this.me.yaw, 0);
    // Your body moves in the same core as everyone else's: stairs, ramps, upper floors,
    // falling, and vaulting (C) over low cover. A Bomb defender cannot vault out of the building.
    const map = this.map;
    this.bl = { arena: {
      resolve: (p) => map.resolve(p), groundAt: (x, z, y) => map.groundAt(x, z, y), stepBody: (p, dx, dz, dt) => { const on = map.stepBody(p, dx, dz, dt), k = this.m.rules.keepIn(this.me, p.x, p.z); if (k && k[2]) { p.x = k[0]; p.z = k[1]; this.me.kept = true; } return on; },
      vaultTarget: (x, y, z, dx, dz) => { const v = map.vaultTarget(x, y, z, dx, dz), k = v && this.m.rules.keepIn(this.me, v.x, v.z); return k && k[2] ? null : v; },
      hazardAt: () => 0, hazards: [],
    }, fire: (h, shotT) => this._fire(h, shotT) };
    this.hud.name.textContent = 'You · ' + op.name + ' · ' + this.me.gunData.name;
  }

  /* ---------- your shots ---------- */
  _fire(h, shotT) {
    const me = this.me;
    if (!me.alive || this.m.over) return;
    h.shotDirection(shotT, this.d);
    h.eye(this.o);
    const r = this.m.humanShot(me, this.o.slice(), this.d.slice());
    if (!r) return;
    const from = new THREE.Vector3(this.o[0] + this.d[0] * 0.6, this.o[1] - 0.12 + this.d[1] * 0.6, this.o[2] + this.d[2] * 0.6);
    this._tracer(from, r.end, this.prevT, me.team);
    this.deps.sfx.shot(me.gun.tone, 1);
  }

  /* ---------- frame ---------- */
  update(t) {
    if (!this.active) return;
    let dt = Math.min(0.1, Math.max(0, t - this.prevT));
    this.prevT = t;
    if (this.paused || this.over) dt = 0;
    const m = this.m, me = this.me, h = this.h;
    // you (the range's movement, look and weapon), then copy into the simulation
    const ab = me.ab, abOn = m.o.abilitiesOn && ab;
    if (me.forced) { h.f.x = me.x; h.f.z = me.z; h.f.y = me.y; h.f.vx = 0; h.f.vz = 0; h.vault = null; me.forced = false; }
    const frozen = m.rules.frozen(me) || m.t < me.stunUntil || (ab && (ab.busy || ab.dash));
    const droning = !!(ab && ab.drone && ab.drone.alive);
    if (droning && !this.paused && !this.over) m.ab.droneInput(me, h.in, dt);
    // the breacher replaces the rifle while it is switched on; the drone needs your hands
    const fire = h.in.fire;
    if (ab && (droning || (abOn && ab.shotgun))) { if (ab.shotgun && fire && me.alive && !droning && m.ab.fireShotgun(me)) { this.deps.sfx.shot(0.15, 1); h.rig.kick && h.rig.kick(); } h.in.fire = false; }
    if (m.t < me.stunUntil) h.in.fire = false;           // stunned (Charge Dash): no shooting
    h.speedMult = me.alive && !frozen ? m.speedOf(me) : 0;
    h.f.alive = me.alive;
    const mv = droning ? [h.in.fwd, h.in.back, h.in.left, h.in.right] : null;
    if (mv) h.in.fwd = h.in.back = h.in.left = h.in.right = false;
    h.update(t, dt, this.bl);
    if (mv) [h.in.fwd, h.in.back, h.in.left, h.in.right] = mv;
    h.in.fire = fire;
    if (me.alive) {
      me.x = h.f.x; me.z = h.f.z; me.y = h.f.y; me.vy = h.f.vy || 0; me.yaw = h.look.yaw; me.pitch = h.look.pitch;
      me.crouch = h.f.crouch; me.speed = Math.hypot(h.f.vx, h.f.vz); me.ads = h.adsE;
    }
    // the simulation at 60 Hz
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK && n < 8) { m.step(); this.acc -= TICK; n++; }
    if (n === 8) this.acc = 0;
    this._events(t);
    this._record();
    this._refreshPanels();
    // draw everyone where the simulation has them
    for (const a of m.actors) {
      const f = this.fig.get(a.id);
      if (a !== me) { f.x = a.x; f.z = a.z; f.y = a.y; f.yaw = a.yaw; f.pitch = a.pitch; f.crouch = a.crouch; f.ads = a.ads; }
      f.alive = a.alive; f.health = a.hp; f.protectUntil = t + (a.protectUntil - m.t);
      // stunned: stars round the head; charging (Onyx): a blue streak
      const stun = a.alive && m.t < a.stunUntil && a !== me;
      if (stun && !f.stars) { f.stars = stunStars(); f.group.add(f.stars); }
      if (f.stars) { f.stars.visible = stun; if (stun) { f.stars.position.y = 1.95 - 0.4 * a.crouch; f.stars.rotation.y = t * 5; } }
      const dash = a.alive && a.ab && a.ab.dash;
      if (dash && !f.trail) { f.trail = dashTrail(); this.markerG.add(f.trail); }
      if (f.trail) { f.trail.visible = !!dash && a !== me; if (dash) { f.trail.position.set(a.x, a.y, a.z); f.trail.rotation.y = Math.atan2(-dash.dx, -dash.dz); f.trail.scale.z = 2.5; } }
      f.updateVisual(t);
      const enemy = a.team !== me.team;
      const v = a !== me && a.alive && enemy;
      const xr = v && m.t < a.revealedUntil;
      if (xr !== !!f._xr) { f._xr = xr; this._xray(f, xr); }
      f.outline.visible = v; for (const l of f.legs) l.o.visible = v;
      // teammates: a silhouette through walls (only while a wall is in the way)
      if (a !== me && a.alive && !enemy) { if ((this._fr + a.id) % 6 === 0 || f._ghost === undefined) f.setGhost(!m.map.sight(this.camOverride ? [this.camOverride.position.x, this.camOverride.position.y, this.camOverride.position.z] : [me.x, me.y + 1.6, me.z], [a.x, a.y + 1.2, a.z])); }
      else f.setGhost(false);
      if (xr) f.group.visible = true;
    }
    this._objectives(t);
    this._gadgets(t);
    if (this.kc) this._replay(t);
    this._camera(t);
    this.deps.sfx.listen(this.camOverride || h.camera);
    if (!this.paused && !this.over && !this.kc) this._steps();
    this._updateTracers(t);
    if (this.arena) this.arena.update(dt, t, h.camera.position);
    this._hud(t);
  }

  _events(t) {
    const m = this.m, me = this.me, sfx = this.deps.sfx;
    for (const e of m.events) {
      if (e.type === 'shot') this._recShot(e);
      if (e.type === 'hit' && e.id === me.id) this.rec.hits.push({ t: m.t, by: e.by, zone: e.zone, dmg: e.dmg, kind: e.kind });
      if (e.type === 'shot' && e.id !== me.id) {
        const f = this.fig.get(e.id);
        if (f) { f.flashUntil = t + 0.05; this._tracer(f.muzzleWorld(this._v || (this._v = new THREE.Vector3())), e.to, t, e.team); }
        const a = m.actors.find((x) => x.id === e.id);
        const w = this._where(e.from[0], e.from[2], e.from[1]); sfx.shot(a ? a.gun.tone : 0.5, w.gain, w.route, w.muffle);
      } else if (e.type === 'hit') {
        if (e.id === me.id) this._hurt(e.by, t, e.dmg);
        if (e.by === me.id) this._marker(e.zone === 'head' ? 'head' : 'hit', t);
      } else if (e.type === 'kill') {
        const v = m.actors.find((x) => x.id === e.id), k = m.actors.find((x) => x.id === e.by);
        this.feed.unshift({ k: k ? (k.human ? 'You' : k.name) : '', kc: k ? k.team : '', v: v.human ? 'You' : v.name, vc: v.team, head: e.head, knife: e.kind === 'knife', nade: e.kind === 'nade', t });
        this.feed.length = Math.min(this.feed.length, 5);
        this._renderFeed();
        if (k === me) { this._marker('kill', t); this._earn('kill', e.head); }
        if (v === me) { this.killedBy = k ? k.name : 'the world'; if (k && k !== me) this._startKc(k, e, t); }
      } else if (e.type === 'spawn' && e.id === me.id) {
        this.deps.controls?.release();
        this.h.respawn(me.x, me.z, t, me.y);
        this.h.look.setAngles(me.yaw, 0);
        this.h.f.alive = true;
      } else if (e.type === 'end') {
        const won = e.winner === me.team;
        if (won) this._earn('win');
        this._showEnd(e.winner === 'draw' ? 'Draw' : won ? 'Your team wins' : 'Your team loses', e.reason);
      } else if (e.type === 'msg') {
        if (!e.private || e.id === me.id) this._flash(e.text, t);
      } else if (e.type === 'swap') {
        for (const a of m.actors) { const f = this.fig.get(a.id); f.name = a.name; f.setLook(a.gunData, Math.max(0, this.deps.guns.indexOf(a.gunData)), a.human && this.deps.skinOf ? this.deps.skinOf(a.gunData) : null); }
        const op = me.op;
        this.h.deps = { ...this.deps, opticFor: (g) => this.deps.opticById(op.sight, g) };
        this.h.setGun(me.gunData);
        this.hud.name.textContent = 'You · ' + op.name + ' · ' + me.gunData.name;
      } else if (e.type === 'boom') {
        const w = this._where(e.x, e.z, e.y ?? null, 'blast', 120);
        sfx.shot(0.05, w.gain, w.route, w.muffle);
        this._boom(e.x, e.z, e.nade ? 6 : e.small ? 3 : 8, t, 0xffa040);
        if (e.nade) { this._boom(e.x, e.z, 2.5, t, 0xfff0c0); if (w.dist < 9) this.vigT = Math.max(this.vigT, t - 0.2); }
      } else if (e.type === 'nadeThrow') {
        if (e.id === me.id) { if (this.h.rig.melee) this.h.rig.melee(); sfx.knife(0.6); }
      } else if (e.type === 'door') {
        const w = this._where(e.x, e.z, e.y ?? null, 'crack', 40);
        sfx.crack(w.gain, w.route, w.muffle);
      } else if (e.type === 'splinter' || e.type === 'debris') {
        // chips off a wall or a barricade; a breach throws a lot of them
        const n = e.type === 'debris' ? e.n || 20 : e.broke ? 10 : 4, col = e.kind === 'door' ? 0x6a4a2a : e.kind === 'wire' ? 0x9aa0a6 : e.kind === 'reinforced' ? 0x6b7480 : 0xd6cbb2;
        this._debris(e.x, e.y ?? 1, e.z, n, col, t, e.type === 'debris' ? 3.5 : 2);
        if (e.kind === 'soft' && e.broke) { const w = this._where(e.x, e.z, e.y ?? null, 'crack', 30); sfx.crack(w.gain * 0.6, w.route, w.muffle); }
      } else if (e.type === 'wire') {
        const w = this._where(e.x, e.z, e.y ?? null, 'knife', 16);
        sfx.wire(w.gain * 0.5, w.route, w.muffle);
      } else if (e.type === 'reinforce' || e.type === 'barricade') {
        const w = this._where(e.x, e.z, e.y ?? null, 'crack', 30);
        if (e.type === 'reinforce') sfx.reload(w.gain, w.route, w.muffle); else sfx.crack(w.gain * 0.5, w.route, w.muffle);
        this._debris(e.x, e.y, e.z, 6, e.type === 'reinforce' ? 0x9aa4b0 : 0x6a4a2a, t, 1);
      } else if (e.type === 'knife') {
        if (e.id === me.id) { sfx.knife(1); if (this.h.rig.melee) this.h.rig.melee(); }
        else { const a = m.actors.find((x) => x.id === e.id), w = a && this._where(a.x, a.z, a.y + 1, 'knife', 15); if (w) sfx.knife(w.gain, w.route, w.muffle); }
      } else if (e.type === 'pulse') {
        const w = this._where(e.x, e.z, e.y ?? null, 'zap', 50);
        if (e.kind === 'dread') { { const cl = gasCloud(e.x, e.z, e.r || 3); cl.position.y += e.y || 0; this._fxAdd(cl, t, e.dur || 5, 'cloud'); } this._boom(e.x, e.z, e.r || 3, t, 0x9040ff); sfx.shot(0.02, w.gain, w.route, w.muffle); }
        else { this._boom(e.x, e.z, e.r || 4, t, 0x60b0ff); this._boom(e.x, e.z, (e.r || 4) * 0.5, t, 0xe0f4ff); sfx.zap(w.gain, w.route, w.muffle); }
      } else if (e.type === 'scan') {
        if (e.id === me.id || m.actors.find((x) => x.id === e.id)?.team === me.team) this._boom(e.x, e.z, e.r, t, 0x60ffd0);
      } else if (e.type === 'caught') {
        this._boom(e.x, e.z, 1, t, 0x9cff70);
        if (e.cx !== undefined) this._fxAdd(beam([e.cx, (e.cy || 0.4) + 0.12, e.cz], [e.x, e.y, e.z], 0x9cff70), t, 0.3, 'beam');
        const w = this._where(e.x, e.z, e.y ?? null, 'zap', 50); sfx.zap(w.gain, w.route, w.muffle);
      } else if (e.type === 'stun') {
        if (e.id === me.id) { this._flash('Stunned', t); sfx.shot(0.02, 0.6); }
      }
    }
    m.events.length = 0;
  }
  // Events with y use full 3D propagation. Older 2D engine events stay on the
  // listener's horizontal plane until the engine supplies their missing height.
  _where(x, z, y = null, kind = 'shot', reach = 80) {
    const camera = this.camOverride || this.h.camera;
    return this.deps.sfx.locate(kind, {x, y:y ?? camera.position.y, z}, camera, this.map, this.arena, {reach});
  }
  _steps() {
    const m = this.m, me = this.me, camera = this.camOverride || this.h.camera;
    // Preserve the engine's audibility policy, including silent crouch walking.
    for (const n of m.noises) {
      if (n.kind !== 'steps' || n.id === me.id || n.t <= (this._stepT || 0)) continue;
      const y = n.y || 0;
      this.deps.sfx.stepAt({x:n.x,y:y+.12,z:n.z,feetY:y}, camera, this.map, this.arena, n.range, n.team === me.team);
    }
    for (const n of m.noises) this._stepT = Math.max(this._stepT || 0, n.t);
  }
  /* ---------- death replay ---------- */
  // The last few seconds, every frame (sim time): positions and aim of everyone; shots;
  // hits you took.
  _record() {
    const m = this.m, R = this.rec;
    if (this.kc) return;
    const s = new Float32Array(m.actors.length * 7);
    m.actors.forEach((a, i) => { s.set([a.x, a.z, a.yaw, a.pitch, a.crouch, a.alive ? 1 : 0, a.y], i * 7); });
    R.frames.push({ t: m.t, s });
    while (R.frames.length && R.frames[0].t < m.t - 5) R.frames.shift();
    while (R.shots.length && R.shots[0].t < m.t - 5) R.shots.shift();
    while (R.hits.length && R.hits[0].t < m.t - 10) R.hits.shift();
  }
  _recShot(e) { this.rec.shots.push({ t: this.m.t, id: e.id, to: e.to.slice(), team: e.team }); }
  _startKc(k, e, t) {
    const m = this.m, me = this.me;
    const hits = this.rec.hits.filter((h) => m.t - h.t < 8);
    const by = new Map();
    for (const h of hits) { const a = m.actors.find((x) => x.id === h.by); const key = a ? a.name : 'the world'; const r = by.get(key) || { n: 0, head: 0, dmg: 0 }; r.n++; if (h.zone === 'head') r.head++; r.dmg += h.dmg; by.set(key, r); }
    const report = [...by.entries()].map(([n, r]) => n + ': ' + r.n + ' hit' + (r.n > 1 ? 's' : '') + (r.head ? ' (' + r.head + ' head)' : '') + ', ' + Math.round(r.dmg)).join(' · ');
    const dist = Math.hypot(k.x - me.x, k.z - me.z);
    // 0.3 s pause, then the last 2.1 s and 0.3 s after: over before the 3 s respawn
    this.kc = { by: k.id, deathT: m.t, start: t + 0.3, from: m.t - 2.1, si: 0, fi: 0 };
    this.kc.si = this.rec.shots.findIndex((s) => s.t >= this.kc.from); if (this.kc.si < 0) this.kc.si = this.rec.shots.length;
    if (!this.kcCam) this.kcCam = new THREE.PerspectiveCamera(70, 1, 0.03, 300);
    const H = this.hud;
    H.kcBox.replaceChildren(el('b', '', 'KILL CAM'), el('div', '', 'Killed by ' + k.name + ' (' + k.op.name + ' · ' + k.gun.name + (e.kind === 'knife' ? ' · knife' : e.head ? ' · headshot' : '') + ') from ' + dist.toFixed(0) + ' m'), el('div', 'small', 'Damage you took: ' + (report || 'none recorded')), el('div', 'small', 'Space: skip'));
    H.kcBox.hidden = false;
  }
  _endKc() {
    this.kc = null; this.hud.kcBox.hidden = true;
    this.rec.frames.length = 0; this.rec.shots.length = 0;
  }
  _replay(t) {
    const kc = this.kc, m = this.m, R = this.rec;
    if (this.me.alive) { this._endKc(); return; }        // respawned
    if (t < kc.start) return;
    const rt = kc.from + (t - kc.start);
    if (rt > kc.deathT + 0.3 || !R.frames.length) { this._endKc(); return; }
    // the recorded frames around the replay time
    let i = Math.min(kc.fi, R.frames.length - 1);
    while (i < R.frames.length - 1 && R.frames[i + 1].t <= rt) i++;
    kc.fi = i;
    const A = R.frames[i], B = R.frames[Math.min(i + 1, R.frames.length - 1)];
    const f = B.t > A.t ? Math.max(0, Math.min(1, (rt - A.t) / (B.t - A.t))) : 0;
    const lerpYaw = (a, b) => a + wrap180(b - a) * f;
    m.actors.forEach((a, k) => {
      const fig = this.fig.get(a.id), o = k * 7;
      if (o + 6 >= A.s.length) return;
      fig.x = A.s[o] + (B.s[o] - A.s[o]) * f; fig.z = A.s[o + 1] + (B.s[o + 1] - A.s[o + 1]) * f;
      fig.yaw = lerpYaw(A.s[o + 2], B.s[o + 2]); fig.pitch = A.s[o + 3] + (B.s[o + 3] - A.s[o + 3]) * f; fig.crouch = A.s[o + 4];
      fig.alive = A.s[o + 5] > 0.5; fig.y = A.s[o + 6] + (B.s[o + 6] - A.s[o + 6]) * f;
      fig.updateVisual(t);
      fig.outline.visible = false; for (const l of fig.legs) l.o.visible = false; fig.setGhost(false);
      if (a.id === kc.by) {
        // the killer's eyes
        fig.group.visible = false;
        this.kcCam.position.set(fig.x, fig.y + 1.6 - 0.45 * fig.crouch, fig.z);
        this.kcCam.rotation.set(fig.pitch * DEG, -fig.yaw * DEG, 0, 'YXZ');
      }
      if (a === this.me) { fig.outline.visible = true; for (const l of fig.legs) l.o.visible = true; }   // you, in red
    });
    // their shots, as they happened
    while (kc.si < R.shots.length && R.shots[kc.si].t <= rt) {
      const s = R.shots[kc.si++];
      if (s.id !== kc.by) continue;
      const c = this.kcCam.position, d = new THREE.Vector3(0, -0.12, -0.6).applyQuaternion(this.kcCam.quaternion);
      this._tracer(new THREE.Vector3(c.x + d.x, c.y + d.y, c.z + d.z), s.to, t, s.team);
      this.deps.sfx.shot(this.m.actors.find((x) => x.id === s.id)?.gun.tone ?? 0.5, 0.5);
    }
  }
  _earn(kind, head = false) {
    const n = this.deps.onPoints ? this.deps.onPoints(kind, head) : 0;
    if (n) { this.points += n; this.hud.pts.textContent = '+' + n; this.hud.pts.className = 'b-points on'; this.ptsUntil = this.prevT + 1.2; }
  }

  /* ---------- objectives (flags, bomb) drawn from the rules ---------- */
  _objectives(t) {
    const list = this.m.rules.markers ? this.m.rules.markers(this.me) : [];
    const seen = new Set();
    for (const mk of list) {
      seen.add(mk.key);
      let o = this.objMeshes.get(mk.key);
      if (!o) { o = this._makeObj(mk); this.objMeshes.set(mk.key, o); this.markerG.add(o); }
      o.visible = mk.show !== false;
      o.position.set(mk.x, mk.y || 0, mk.z);
      if (mk.spin) o.rotation.y = t * 1.5;
    }
    for (const [k, o] of this.objMeshes) if (!seen.has(k)) o.visible = false;
  }
  _makeObj(mk) {
    const g = new THREE.Group(), c = new THREE.Color(mk.color || 0xffffff);
    if (mk.shape === 'flag') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
      pole.position.y = 1.1;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide, emissive: c, emissiveIntensity: 0.35 }));
      cloth.position.set(0.45, 1.85, 0);
      g.add(pole, cloth);
    } else if (mk.shape === 'stand') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.2, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
      g.add(ring);
    } else if (mk.shape === 'site') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(mk.r - 0.15, mk.r, 48), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
      const label = this._label(mk.label, mk.color);
      label.position.y = 2.6;
      g.add(ring, label);
    } else if (mk.shape === 'bomb') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.28), new THREE.MeshLambertMaterial({ color: 0x2a2c30, emissive: 0xff3020, emissiveIntensity: 0.25 }));
      b.position.y = 0.11;
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
      led.position.set(0.1, 0.24, 0);
      g.add(b, led);
    } else {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(mk.r || 0.18, 10, 8), new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.4 })));
    }
    return g;
  }
  _label(text, color) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(10,12,16,0.6)'; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
    g.fillStyle = '#' + new THREE.Color(color || 0xffffff).getHexString(); g.font = 'bold 72px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
    const tex = new THREE.CanvasTexture(cv); tex.userData.own = true;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(1.2, 1.2, 1); s.renderOrder = 5;
    return s;
  }

  /* ---------- abilities: x-ray, gadgets, effects, cameras ---------- */
  _xray(f, on) {
    const set = (o) => o.traverse((n) => { if (n.isMesh) { if (!n.userData.olMat) n.userData.olMat = n.material; n.material = on ? xrayMat(n.userData.olMat) : n.userData.olMat; n.renderOrder = on ? 6 : 0; } });
    set(f.outline); for (const l of f.legs) set(l.o);
  }
  _gadgetMesh(g) { return makeGadget(g, this.m.ab.cfg); }
  _gadgets(t) {
    const ab = this.m.ab, me = this.me, seen = new Set();
    if (!this.gMeshes) this.gMeshes = new Map();
    for (const g of [...ab.gadgets, ...ab.projectiles]) {
      if (!g.alive) continue;
      const key = g.type + g.id;
      seen.add(key);
      let o = this.gMeshes.get(key);
      if (!o) { o = this._gadgetMesh(g); this.gMeshes.set(key, o); this.markerG.add(o); }
      o.position.set(g.x, g.y || 0.05, g.z);
      if (g.type === 'drone') { o.rotation.y = -g.yaw * DEG; o.visible = !(me.ab && me.ab.drone === g); }
      if (g.type === 'wire') o.rotation.y = -g.yaw * DEG;
      if (g.type === 'charge') { const pn = this.map.panels[g.panel]; if (pn) { const b = pn.box; o.rotation.y = (b.maxX - b.minX) > (b.maxZ - b.minZ) ? 0 : Math.PI / 2; } }
      // spin, spark, pulse; dark when zapped or jammed; the jammer's reach shows to its team and up close
      const u = o.userData, off = g.type !== 'breach' && ab.off(g);
      const R = (ab.cfg.static_jammer && ab.cfg.static_jammer.radius) || 8;
      animateGadget(o, g, t, { off, armed: !!g.trigAt, ready: g.type !== 'catcher' || this.m.t >= g.readyAt, showRing: g.team === me.team || Math.hypot(g.x - me.x, g.z - me.z) < R + 5 });
      // gadgets found by a scan show through walls for that team
      const xr = g.team !== me.team && g.revealedFor === me.team && this.m.t < g.revealedUntil;
      if (xr !== !!u.xr) { u.xr = xr; for (const n of u.parts) { n.material.depthTest = !xr; n.renderOrder = xr ? 6 : 0; } }
    }
    for (const n of this.m.nades.live) {
      const key = 'nade' + n.id;
      seen.add(key);
      let o = this.gMeshes.get(key);
      if (!o) {
        o = new THREE.Group();
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3a4a2a }));
        body.scale.y = 1.25;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6), new THREE.MeshLambertMaterial({ color: 0x888888 }));
        cap.position.y = 0.08;
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff3020, toneMapped: false }));
        led.position.set(0.05, 0.03, 0);
        o.add(body, cap, led); o.userData.led = led;
        this.gMeshes.set(key, o); this.markerG.add(o);
      }
      o.position.set(n.x, n.y, n.z); o.rotation.set(t * 9, t * 5, 0);
      o.userData.led.visible = Math.floor(t * (n.end - this.m.t < 1 ? 12 : 4)) % 2 === 0;
    }
    for (const [k, o] of this.gMeshes) if (!seen.has(k)) { this.markerG.remove(o); o.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) for (const mm of [].concat(n.material)) mm.dispose(); }); this.gMeshes.delete(k); }
  }
  _boom(x, z, r, t, color) {
    if (!this.fx) this.fx = [];
    if (this.fx.length > 12) { const old = this.fx.shift(); this.markerG.remove(old.mesh); old.mesh.material.dispose(); }
    if (!this._ringGeo) this._ringGeo = new THREE.RingGeometry(0.85, 1, 40);
    const mesh = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, 0.06, z);
    this.markerG.add(mesh);
    this.fx.push({ mesh, t, r });
  }
  // Chips: small pieces flung from (x, y, z) that fall and fade.
  _debris(x, y, z, n, color, t, speed = 2) {
    const grp = new THREE.Group();
    if (!this._chipGeo) this._chipGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const matl = new THREE.MeshLambertMaterial({ color, transparent: true });
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(this._chipGeo, matl), s = 0.6 + Math.random() * 1.6;
      c.scale.set(s, s * (0.5 + Math.random()), s);
      c.userData.v = [(Math.random() - 0.5) * speed * 2, Math.random() * speed, (Math.random() - 0.5) * speed * 2];
      grp.add(c);
    }
    grp.position.set(x, y, z); grp.userData.mat = matl;
    if (this.fx2 && this.fx2.filter((f) => f.kind === 'debris').length > 24) { const old = this.fx2.find((f) => f.kind === 'debris'); old.t = -1e9; }
    this._fxAdd(grp, t, 1.2, 'debris');
  }
  _fxAdd(obj, t, dur, kind) {
    if (!this.fx2) this.fx2 = [];
    this.markerG.add(obj);
    this.fx2.push({ obj, t, dur, kind });
  }
  _updateFx(t) {
    if (this.fx2) this.fx2 = this.fx2.filter((f) => {
      const k = (t - f.t) / f.dur;
      if (k >= 1) { this.markerG.remove(f.obj); f.obj.traverse((n) => { if (n.material) n.material.dispose(); if (n.geometry && f.kind === 'beam') n.geometry.dispose(); }); return false; }
      if (f.kind === 'cloud') updateCloud(f.obj, k, 1 / 60);
      else if (f.kind === 'debris') {
        const dt = 1 / 60;
        for (const c of f.obj.children) { const v = c.userData.v; v[1] -= 9.8 * dt; c.position.x += v[0] * dt; c.position.y = Math.max(-f.obj.position.y + 0.02, c.position.y + v[1] * dt); c.position.z += v[2] * dt; c.rotation.x += v[0] * dt * 6; }
        f.obj.userData.mat.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      } else f.obj.material.opacity = 1 - k;
      return true;
    });
    if (!this.fx) return;
    this.fx = this.fx.filter((f) => {
      const k = (t - f.t) / 0.6;
      if (k >= 1) { this.markerG.remove(f.mesh); f.mesh.material.dispose(); return false; }
      const s = 0.2 + f.r * Math.sqrt(k);
      f.mesh.scale.set(s, s, s); f.mesh.material.opacity = 0.8 * (1 - k);
      return true;
    });
  }
  // The camera: your eyes, your drone, or (Bomb, down) a teammate's; jolt wobble, dread shake.
  _camera(t) {
    const m = this.m, me = this.me, h = this.h, ab = me.ab;
    this._updateFx(t);
    if (!this.dcam) this.dcam = new THREE.PerspectiveCamera(80, 1, 0.03, 300);
    const cam = this.dcam;
    let over = null;
    const d = ab && ab.drone && ab.drone.alive ? ab.drone : null;
    if (this.kc && this.kcCam && t >= this.kc.start) over = this.kcCam;
    else if (d) {
      cam.position.set(d.x, (d.y || 0.15) + 0.08, d.z);
      cam.rotation.set(d.pitch * DEG, -d.yaw * DEG, 0, 'YXZ');
      over = cam;
    } else if (!me.alive && m.o.mode === 'bomb') {
      const mates = m.actors.filter((a) => a.alive && a.team === me.team);
      if (mates.length) {
        const a = mates[(this.specIndex || 0) % mates.length];
        const e = m.eye(a);
        // a little behind and above the teammate's shoulder
        const y = a.yaw * DEG;
        cam.position.set(e[0] - Math.sin(y) * 1.6, e[1] + 0.35, e[2] + Math.cos(y) * 1.6);
        cam.rotation.set(a.pitch * DEG - 0.12, -y, 0, 'YXZ');
        over = cam;
        this.specName = a.name;
      }
    }
    this.camOverride = over;
    if (!over) this.specName = null;
    // effects on whatever camera is showing
    const c = over || h.camera;
    if (!reducedMotion() && me.alive && m.t < me.wobbleUntil) { c.rotation.z += Math.sin(t * 7) * 0.035; }
    if (!reducedMotion() && me.alive && m.t < me.shakeUntil) { c.rotation.x += (Math.random() - 0.5) * 0.01; c.rotation.y += (Math.random() - 0.5) * 0.01; }
    const view = this.hud.view;
    if (view) {
      view.classList.toggle('mg-dread', me.alive && m.t < me.shakeUntil);
      view.classList.toggle('mg-jolt', me.alive && m.t < me.wobbleUntil);
      view.classList.toggle('mg-drone', !!d);
    }
  }

  /* ---------- render ---------- */
  render() {
    if (!this.active) return;
    const r = this.deps.renderer, h = this.h;
    r.info.reset();
    r.shadowMap.autoUpdate = false;
    this._fr = (this._fr || 0) + 1;
    if (this._fr % 2 === 0 || this._fr < 3) r.shadowMap.needsUpdate = true;
    r.autoClear = false;
    r.setRenderTarget(null);
    const sz = r.getSize(this._sz || (this._sz = new THREE.Vector2()));
    r.setViewport(0, 0, sz.x, sz.y);
    r.clear();
    const aspect = sz.x / sz.y;
    const cam = this.camOverride || h.camera;
    if (cam.aspect !== aspect) { cam.aspect = aspect; cam.updateProjectionMatrix(); }
    const ownVis = h.f.group.visible;
    if (!(this.kc && this.camOverride === this.kcCam)) h.f.group.visible = false;   // your body shows in your death replay
    const wp = this.deps.worldPost;
    if (wp && wp.active) wp.draw(this.scene, cam); else r.render(this.scene, cam);
    h.f.group.visible = ownVis;
    if (!this.camOverride) {
      r.clearDepth();
      h.rig.setAspect(aspect, sz.y);
      r.render(h.rig.scene, h.rig.camera);
    }
  }

  /* ---------- input ---------- */
  mouseMove(dx, dy) {
    if (!this.active || this.paused || this.over) return;
    if (this.m.ab.mouse(this.me, dx, dy)) return;
    this.h.mouseMove(dx, dy);
  }
  mouseButton(b, down) {
    const h = this.h;
    if (!h) return;
    if (b === 0 && down && !this.me.alive && this.m.o.mode === 'bomb') { this.specIndex = (this.specIndex || 0) + 1; return; }
    if (b === 1) { this.key('OperatorAbility', down); return; }
    if (b === 0) h.in.fire = down;
    else if (b === 2) h.in.ads = down;
    else if (b === 3) h.in.leanL = down;
    else if (b === 4) h.in.leanR = down;
  }
  key(code, down) {
    if (!this.active) return false;
    const h = this.h;
    if (code === 'Space' && this.kc) { if (down) this._endKc(); return true; }
    if (code === 'Tab') { this.hud.board.hidden = !down; if (down) this._renderBoard(); return true; }
    const me = this.me, ab = this.m.ab;
    const abilityUsed = this.m.o.abilitiesOn || this.m.o.mode === 'bomb';
    if (abilityUsed && me.alive && me.ab) {
      if (code === 'OperatorAbility') { if (!down || !this.paused && !this.over) ab.q(me, down); return true; }
      if (code === 'DroneZap' && me.ab.drone) { if (down) ab.f(me); return true; }
      if (code === 'KeyV' && me.ab.drone) { if (down) ab.recall(me); return true; }
      if (code === 'KeyB' && me.ab.id === 'underbarrel') { if (down) ab.toggleShotgun(me); return true; }
    }
    if (code === 'Interact') { if (me.ab?.drone) { if (down) ab.f(me); } else if (this.m.rules.key) this.m.rules.key(me, 'KeyE', down); return true; }
    const map = { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'sprint', Space: 'crouch', KeyC: 'vault', KeyQ: 'leanL', KeyE: 'leanR' };
    if (map[code]) { h.in[map[code]] = down; return true; }
    if (code === 'KeyR') { if (down && this.me.alive) h.reload(); return true; }
    if (code === 'KeyI') { if (down && !h.ads) h.rig.inspect(); return true; }
    // Caps Lock (or G): a grenade. (On a Mac, Caps Lock sends only key-up every other press.)
    if (code === 'CapsLock' || code === 'KeyG') {
      const now = this.prevT;
      if (down || (code === 'CapsLock' && now - (this._capsDown || -9) > 0.6)) { if (down) this._capsDown = now; if (this.me.alive && !this.paused && !this.over) this.m.nades.throw(this.me, this.h.look.yaw, this.h.look.pitch); }
      return true;
    }
    if (code === 'KeyK') { if (down && this.me.alive && !this.paused && !this.over) this.m.knife(this.me); return true; }
    return false;
  }

  /* ---------- tracers ---------- */
  _buildTracers() {
    const g = new THREE.BufferGeometry();
    this.trPos = new Float32Array(MAX_TRACERS * 6); this.trCol = new Float32Array(MAX_TRACERS * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.trCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.trBorn = new Float64Array(MAX_TRACERS).fill(-10); this.trI = 0;
  }
  _tracer(a, b, t, team) {
    const i = this.trI++ % MAX_TRACERS, p = this.trPos, c = this.trCol, k = i * 6;
    p[k] = a.x; p[k + 1] = a.y; p[k + 2] = a.z; p[k + 3] = b[0]; p[k + 4] = b[1]; p[k + 5] = b[2];
    const col = team === this.me.team ? [0.9, 0.95, 1] : [1, 0.6, 0.35];
    c[k] = col[0]; c[k + 1] = col[1]; c[k + 2] = col[2]; c[k + 3] = col[0] * 0.2; c[k + 4] = col[1] * 0.2; c[k + 5] = col[2] * 0.2;
    this.trBorn[i] = t;
    this.tracers.geometry.attributes.position.needsUpdate = true; this.tracers.geometry.attributes.color.needsUpdate = true;
  }
  _updateTracers(t) {
    let ch = false;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.trBorn[i] < -5 || t - this.trBorn[i] < 0.07) continue;
      const k = i * 6; this.trPos[k] = this.trPos[k + 3]; this.trPos[k + 1] = this.trPos[k + 4]; this.trPos[k + 2] = this.trPos[k + 5];
      this.trBorn[i] = -10; ch = true;
    }
    if (ch) this.tracers.geometry.attributes.position.needsUpdate = true;
  }

  /* ---------- HUD ---------- */
  _buildHud() {
    const root = el('div', 'battle-hud mg-hud'); root.hidden = true;
    const top = el('div', 'b-top'), score = el('div', 'b-score mg-score');
    const compass = el('div', 'mg-compass'), status = el('div', 'mg-status');
    top.append(score);
    const feed = el('div', 'b-feed');
    const view = el('div', 'b-view');
    const prot = el('div', 'b-prot'); prot.hidden = true;
    const cross = document.createElement('canvas'); cross.className = 'b-cross';
    const hit = el('div', 'b-hit'), hurt = el('div', 'b-hurt'), dead = el('div', 'b-dead'); dead.hidden = true;
    const name = el('div', 'b-name t-A', '');
    const hp = el('div', 'b-hp'), hpFill = el('i'); hp.append(hpFill);
    const hpText = el('div', 'b-hptext', '100'), ammo = el('div', 'b-ammo', ''), pts = el('div', 'b-points', '');
    const ability = el('div', 'mg-ability'); ability.hidden = true;
    const dmg = el('div', 'mg-dmgdir');
    const flash = el('div', 'mg-flash'); flash.hidden = true;
    const hold = el('div', 'mg-hold'); hold.hidden = true;
    const holdBar = el('i'); hold.append(el('span', '', ''), holdBar);
    const kcBox = el('div', 'mg-kc'); kcBox.hidden = true;
    const nades = el('div', 'mg-nades', ''), nadeWarn = el('div', 'mg-nadewarn'); nadeWarn.hidden = true;
    const disruption = el('div', 'mg-disruption');
    const vig = el('div', 'dmg-vig'), lowhp = el('div', 'low-hp'), jam = el('div', 'mg-jam'), banner = el('div', 'mg-banner'); banner.hidden = true;
    lowhp.append(el('span', '', 'LOW HEALTH'));
    view.append(disruption, kcBox, nades, nadeWarn, jam, vig, lowhp, hurt, dmg, cross, hit, pts, dead, prot, name, hp, hpText, ammo, ability, hold, flash, banner);
    const board = el('div', 'mg-board'); board.hidden = true;
    const end = el('div', 'b-end'); end.hidden = true;
    const box = el('div', 'b-end-box'), endTitle = el('h1', '', ''), endTable = el('div', 'b-table'), endNote = el('p', 'small', '');
    const again = el('button', 'primary', 'Play again'), leave = el('button', '', 'Back to the menu');
    again.type = leave.type = 'button';
    const row = el('div', 'row'); row.append(again, leave);
    box.append(endTitle, endTable, row, endNote); end.append(box);
    root.append(view, top, compass, status, feed, board, end);
    this.deps.hudRoot.insertBefore(root, this.deps.hudRoot.querySelector('#menu'));
    this.hud = { disruption, nades, nadeWarn, kcBox, vig, lowhp, jam, banner, prot, root, score, compass, status, feed, view, cross, hit, hurt, dead, name, hpFill, hpText, ammo, pts, ability, dmg, flash, hold, holdBar, board, end, endTitle, endTable, endNote, again, leave, last: {} };
    drawCrosshair(cross, this.deps.settings.crosshair);
  }
  _marker(kind, t) { this.hud.hit.className = 'b-hit on ' + kind; this.hitUntil = t + (kind === 'kill' ? 0.35 : 0.15); }
  _hurt(byId, t, dmg = 20) {
    // a red vignette every time you are hit (stronger for bigger hits)
    this.vigT = t; this.vigK = Math.min(1, 0.45 + dmg / 45);
    const a = this.m.actors.find((x) => x.id === byId);
    this.hurtUntil = t + 0.35;
    if (!a) { this.hud.hurt.className = 'b-hurt on front'; return; }
    const rel = wrap180(yawTo(a.x - this.me.x, a.z - this.me.z) - this.h.look.yaw);
    this.hud.hurt.className = 'b-hurt on ' + (Math.abs(rel) < 45 ? 'front' : Math.abs(rel) > 135 ? 'back' : rel > 0 ? 'right' : 'left');
    // damage direction arrow round the crosshair
    this.hud.dmg.style.transform = 'translate(-50%, -50%) rotate(' + rel + 'deg)';
    this.hud.dmg.className = 'mg-dmgdir on';
    this.dmgUntil = t + 1.2;
  }
  _flash(text, t) { this.hud.flash.textContent = text; this.hud.flash.hidden = false; this.flashUntil = t + 2.5; }
  _renderFeed() {
    this.hud.feed.replaceChildren(...this.feed.map((e) => {
      const r = el('div', 'b-feedrow');
      if (e.k) r.append(el('span', 't-' + e.kc, e.k), el('span', 'b-icon', e.knife ? ' 🗡 ' : e.nade ? ' 💥 ' : e.head ? ' ✦ ' : ' › '), el('span', 't-' + e.vc, e.v));
      else r.append(el('span', 't-' + e.vc, e.v), el('span', 'b-icon', ' died'));
      return r;
    }));
  }
  _renderBoard() {
    const m = this.m, rows = [];
    for (const team of [this.me.team, this.me.team === 'A' ? 'B' : 'A']) {
      rows.push(el('div', 'mg-board-h t-' + team, team === this.me.team ? 'Your team' : 'Enemy team'));
      for (const a of m.actors.filter((x) => x.team === team).sort((p, q) => q.kills - p.kills)) {
        const r = el('div', 'mg-board-row' + (a.alive ? '' : ' dead'));
        r.append(el('span', '', a.name), el('span', 'small', a.op.name + ' · ' + a.gun.name + (a.role && team === this.me.team ? ' · ' + a.role : '')), el('span', '', a.kills + ' K'), el('span', '', a.deaths + ' D'));
        rows.push(r);
      }
    }
    this.hud.board.replaceChildren(...rows);
  }
  _hud(t) {
    const H = this.hud, L = H.last, m = this.m, me = this.me, h = this.h;
    const score = m.rules.scoreText ? m.rules.scoreText(me.team) : 'Your team ' + m.rules.score[me.team] + ' · Enemy ' + m.rules.score[me.team === 'A' ? 'B' : 'A'];
    const timer = m.rules.timerText ? m.rules.timerText() : fmt(m.rules.timeLeft());
    const sc = score + '  ·  ' + timer;
    if (L.sc !== sc) { L.sc = sc; H.score.textContent = sc; }
    // damage vignette, low health, jammed, stunned
    const vk = Math.max(0, 1 - (t - this.vigT) / 0.7) * (this.vigK || 1);
    if (Math.abs((L.vk || 0) - vk) > 0.02 || (vk === 0 && L.vk)) { L.vk = vk; H.vig.style.opacity = vk.toFixed(2); }
    const low = me.alive && me.hp <= 35;
    if (L.low !== low) { L.low = low; H.lowhp.classList.toggle('on', low); }
    const d = me.ab && me.ab.drone && me.ab.drone.alive ? me.ab.drone : null;
    const jammed = me.alive && (m.ab.jammed(me.x, me.z, me.team, me.y + 1) || (d && m.ab.jammed(d.x, d.z, me.team, d.y)));
    if (jammed && !this.wasJammed) { this.deps.sfx.jam(0.7); this._jamSnd = t; }
    else if (jammed && t - (this._jamSnd || 0) > 0.9) { this.deps.sfx.jam(0.25); this._jamSnd = t; }
    this.wasJammed = jammed;
    const stunned = me.alive && m.t < me.stunUntil;
    const hearingActive = me.alive && !this.paused && !this.over && !this.kc;
    const flags = hearingActive ? ((!d && m.t < me.wobbleUntil ? 1 : 0) | (!d && m.t < me.shakeUntil ? 2 : 0) | (jammed ? 4 : 0) | (!d && stunned ? 8 : 0)) : 0;
    const perception = sensoryFor(m.o.mode, flags);
    this.deps.sfx.hearing?.set(perception.gain, perception.cutoff);
    H.disruption.style.opacity = String(perception.veil);

    // a Bomb defender at a way out of the building
    if ((this._fr || 0) % 6 === 0) this._edge = m.rules.edgeAhead ? m.rules.edgeAhead(me) : Infinity;
    if (me.kept) { me.kept = false; this._keptAt = t; }
    const edge = me.alive && (this._edge < 0.9 || t - (this._keptAt || -9) < 1.5);
    const ban = stunned ? 'STUNNED' : jammed ? 'JAMMED · abilities, drone and team radio offline' : edge ? 'Defenders stay inside the building' : '';
    if (L.ban !== ban) { L.ban = ban; H.banner.hidden = !ban; H.banner.textContent = ban; H.banner.className = 'mg-banner' + (stunned ? ' stun' : !jammed && edge ? ' edge' : ''); H.jam.classList.toggle('on', jammed); H.view.classList.toggle('mg-stun', stunned); H.compass.classList.toggle('jammed', jammed); }
    const pr = me.alive && m.t < me.protectUntil ? 'Spawn protection ' + Math.ceil(me.protectUntil - m.t) + ' · shooting ends it' : '';
    if (L.pr !== pr) { L.pr = pr; H.prot.hidden = !pr; H.prot.textContent = pr; }
    const st = (m.rules.statusText ? m.rules.statusText(me) : '').replace(/hold E/g, 'hold ' + (this.deps.controls?.bindingLabel('interact') || 'F'));
    if (L.st !== st) { L.st = st; H.status.textContent = st; H.status.hidden = !st; }
    const hp = Math.max(0, Math.ceil(me.hp));
    if (L.hp !== hp) { L.hp = hp; H.hpFill.style.width = hp + '%'; H.hpFill.className = hp > 60 ? '' : hp > 30 ? 'mid' : 'low'; H.hpText.textContent = String(hp); }
    const ammo = m.ab.ammoText ? m.ab.ammoText(me) || (h.weapon.reloading ? 'reloading' : h.weapon.ammo + ' / ' + h.gun.magSize) : (h.weapon.reloading ? 'reloading' : h.weapon.ammo + ' / ' + h.gun.magSize);
    if (L.ammo !== ammo) { L.ammo = ammo; H.ammo.textContent = ammo; }
    const wireSlot = m.rules.name === 'Bomb' && !m.rules.isAttacker(me);       // Bomb defenders: barbed wire in the grenade slot
    const nt = !me.alive ? '' : wireSlot ? '≋ '.repeat(me.wire || 0).trim() + (me.wire ? ' barbed wire' : 'no wire') + ' · ' + (this.deps.controls?.bindingLabel('grenade') || 'G') : '● '.repeat(me.nades || 0).trim() + (me.nades ? '' : 'no grenades') + ' · ' + (this.deps.controls?.bindingLabel('grenade') || 'G');
    if (L.nt !== nt) { L.nt = nt; H.nades.textContent = nt; }
    // a live enemy grenade (or yours) within 7 m: an arrow pointing at it
    const ln = me.alive ? m.nades.live.find((n) => Math.hypot(n.x - me.x, n.z - me.z) < 7) : null;
    H.nadeWarn.hidden = !ln;
    if (ln) { const rel = wrap180(yawTo(ln.x - me.x, ln.z - me.z) - this.h.look.yaw); H.nadeWarn.style.transform = 'translate(-50%, -50%) rotate(' + rel.toFixed(0) + 'deg)'; }
    const cross = me.alive && h.adsE < 0.4 && !this.camOverride;
    if (L.cross !== cross) { L.cross = cross; H.cross.hidden = !cross; }
    if (t > (this.hitUntil || 0) && H.hit.classList.contains('on')) H.hit.className = 'b-hit';
    if (t > (this.hurtUntil || 0) && H.hurt.classList.contains('on')) H.hurt.className = 'b-hurt';
    if (t > (this.dmgUntil || 0) && H.dmg.classList.contains('on')) H.dmg.className = 'mg-dmgdir';
    if (t > (this.ptsUntil || 0) && H.pts.classList.contains('on')) H.pts.className = 'b-points';
    if (t > (this.flashUntil || 0) && !H.flash.hidden) H.flash.hidden = true;
    const dmsg = me.alive || this.kc ? '' : (m.rules.deadText ? m.rules.deadText(me) : 'Eliminated by ' + (this.killedBy || '?') + (me.respawnAt ? ' · back in ' + Math.max(0, Math.ceil(me.respawnAt - m.t)) : ''));
    if (L.dead !== dmsg) { L.dead = dmsg; H.dead.hidden = !dmsg; H.dead.textContent = dmsg; }
    // hold bar (plant / defuse)
    const hold = me.hold;
    H.hold.hidden = !hold;
    if (hold) { H.hold.firstChild.textContent = hold.label; H.holdBar.style.width = Math.min(100, (m.t - hold.t0) / hold.need * 100) + '%'; }
    // ability icon
    if (m.ab.hudText) {
      const ab = m.ab.hudText(me).replace(/\bQ\b/g, this.deps.controls ? this.deps.controls.abilityLabel() : 'Middle mouse').replace(/\bF zap\b/g, (this.deps.controls?.bindingLabel('interact') || 'F') + ' zap').replace(/\bV back\b/g, (this.deps.controls?.bindingLabel('recall') || 'V') + ' back');
      if (L.ab !== ab) { L.ab = ab; H.ability.hidden = !ab; H.ability.textContent = ab || ''; }
      const cd = m.ab.cooldown ? m.ab.cooldown(me) : 0;
      H.ability.style.setProperty('--cd', String(cd));
    }
    if (!H.board.hidden && this._fr % 20 === 0) this._renderBoard();
    this._compass();
  }
  // Compass along the top: headings and objective markers.
  _compass() {
    const H = this.hud, yaw = this.camOverride ? this.camYaw : this.h.look.yaw, fov = 140;
    const items = [];
    for (const [deg, txt] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) items.push({ yaw: deg, txt, cls: 'mg-cd' });
    const mk = this.m.rules.markers ? this.m.rules.markers(this.me) : [];
    for (const k of mk) if (k.compass) items.push({ yaw: yawTo(k.x - this.me.x, k.z - this.me.z), txt: k.compass, cls: 'mg-cm', color: '#' + new THREE.Color(k.color || 0xffffff).getHexString(), dist: Math.round(Math.hypot(k.x - this.me.x, k.z - this.me.z)) });
    const key = Math.round(yaw) + '|' + items.map((i) => i.txt + Math.round(i.yaw) + (i.dist || '')).join(',');
    if (H.last.cp === key) return;
    H.last.cp = key;
    H.compass.replaceChildren(...items.filter((i) => Math.abs(wrap180(i.yaw - yaw)) < fov / 2).map((i) => {
      const e = el('span', i.cls, i.txt + (i.dist !== undefined ? ' ' + i.dist + 'm' : ''));
      e.style.left = (50 + wrap180(i.yaw - yaw) / fov * 100) + '%';
      if (i.color) e.style.color = i.color;
      return e;
    }));
  }
  _showEnd(title, reason) {
    this.over = true;
    const m = this.m, H = this.hud;
    H.endTitle.textContent = title;
    const rows = m.actors.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    H.endTable.replaceChildren(...rows.map((a) => {
      const r = el('div', 'b-row');
      r.append(el('span', 'b-name t-' + a.team, a.human ? 'You (' + a.op.name + ')' : a.name), el('span', '', a.kills + ' kills'), el('span', '', a.deaths + ' deaths'));
      return r;
    }));
    H.endNote.textContent = (m.rules.endText ? m.rules.endText() : '') + (this.points ? ' You earned ' + this.points + ' points.' : '');
    H.end.hidden = false;
    this.h.releaseAll();
    this.deps.onEnd();
  }
}
export { DEG };
