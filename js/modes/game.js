// Team Deathmatch, Capture the Flag and Bomb in the browser: draws the match simulation
// (sim.js) and runs your player with the range's own systems (look, sensitivity, recoil,
// spread, sights, weapon model: battle/human.js), at a fixed 60 Hz simulation.
//
// Map: flat-shaded low poly from the map file; static walls merged into one mesh, breakable
// panels in one instanced mesh, one directional light (a 1024 shadow map in High / Ultra).
import * as THREE from '../../vendor/three/three.module.min.js?v=646d2f7-mw61ssr2';
import { MatchMap } from './map.js?v=646d2f7-mw61ssr2';
import { Match, TICK } from './sim.js?v=646d2f7-mw61ssr2';
import { yawTo, wrap180, DEG } from './geom.js?v=646d2f7-mw61ssr2';
import { Fighter } from '../battle/fighter.js?v=646d2f7-mw61ssr2';
import { Human } from '../battle/human.js?v=646d2f7-mw61ssr2';
import { drawCrosshair } from '../ui/crosshair.js?v=646d2f7-mw61ssr2';

const TEAM_COLOR = { A: 0x5b8cff, B: 0xff7048 };
const MAX_TRACERS = 64;
const json = new Map();
const load = (url) => { if (!json.has(url)) json.set(url, fetch(url, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); })); return json.get(url); };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// Map looks per map id: floor, walls, cover, sky.
const LOOK = {
  yard: { floor: 0x8d877c, wall: 0xb9b2a4, low: 0x7f6a4e, edge: 0x6f6b66, soft: 0xa47a52, reinf: 0x5b6672, sky: 0xaec4d8, fog: [0xc0ccd6, 40, 140] },
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
    const [mapData, ops, abilities] = await Promise.all([load('data/maps/' + o.map + '.json'), load('data/ops.json'), load('data/abilities.json')]);
    this.stop();
    const d = this.deps;
    this.opts = o;
    this.map = new MatchMap(mapData);
    this.m = new Match({ map: this.map, mode: o.mode, guns: d.guns, ops, abilities, teamSize: o.teamSize, difficulty: o.difficulty, abilitiesOn: o.abilities, minutes: o.minutes, headshot: o.headshot, seed: (Math.random() * 2 ** 31) | 0, human: { op: o.op, side: o.side } });
    this.me = this.m.human();
    this._buildScene();
    this._buildActors();
    this.prevT = d.now(); this.acc = 0; this.mapVersion = -1;
    this.feed = []; this.points = 0;
    this.active = true; this.paused = false; this.over = false;
    this.hud.root.hidden = false; this.hud.end.hidden = true;
    this._refreshPanels();
    return this;
  }
  stop() {
    this.active = false; this.paused = false;
    if (this.hud) { this.hud.root.hidden = true; this.hud.board.hidden = true; }
    if (this.h) this.h.releaseAll();
    if (this.deps.renderer) this.deps.renderer.shadowMap.autoUpdate = true;
  }
  pause() { if (!this.active) return; this.paused = true; if (this.h) this.h.releaseAll(); }
  resume(t) { this.paused = false; this.prevT = t; }
  refreshGraphics() { this._applyGraphics(); if (this.h) { this.h.rig.rebuild(); this.h.rig.setGun(this.h.gun, this.deps.slotOf(this.h.gun), this.h.optic); this.h._buildReticle(); } }
  changeGun() {}

  /* ---------- scene ---------- */
  _buildScene() {
    const map = this.map, L = LOOK[map.id] || LOOK.yard;
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
    // floor with a faint grid
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'); g.fillStyle = '#' + new THREE.Color(L.floor).getHexString(); g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
    const ft = new THREE.CanvasTexture(cv); ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(map.hx / 2, map.hz / 2); ft.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.hx * 2, map.hz * 2), new THREE.MeshLambertMaterial({ map: ft }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    // static boxes: one merged mesh, a colour per kind, a little variation per box
    const pos = [], nor = [], col = [];
    const c = new THREE.Color();
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const b of map.solids) {
      if (b.panel !== undefined) continue;
      const k = b.kind === 'low' ? L.low : b.kind === 'edge' ? L.edge : b.kind === 'soft-top' ? L.soft : b.kind === 'reinforced-top' ? L.reinf : L.wall;
      c.setHex(k).multiplyScalar(0.9 + rnd() * 0.2);
      const geo = new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ).toNonIndexed();
      geo.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      const p = geo.attributes.position, n = geo.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i));
        const shade = n.getY(i) > 0.5 ? 1.08 : 1;     // tops a touch lighter
        col.push(c.r * shade, c.g * shade, c.b * shade);
      }
      geo.dispose();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const walls = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ vertexColors: true }));
    walls.castShadow = walls.receiveShadow = true;
    scene.add(walls);
    // breakable panels (instanced; a broken one is scaled to nothing)
    const np = map.panels.length;
    this.panelMesh = null;
    if (np) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), np);
      im.castShadow = im.receiveShadow = true;
      map.panels.forEach((pn, i) => im.setColorAt(i, c.setHex(pn.kind === 'reinforced' ? L.reinf : L.soft).multiplyScalar(0.92 + (i % 3) * 0.05)));
      scene.add(im);
      this.panelMesh = im;
    }
    // objectives (flags, bomb sites): drawn by the rules' markers
    this.markerG = new THREE.Group();
    scene.add(this.markerG);
    this.objMeshes = new Map();
    scene.add(this.tracers);
    this._applyGraphics();
  }
  _refreshPanels() {
    if (!this.panelMesh || this.mapVersion === this.map.version) return;
    this.mapVersion = this.map.version;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.map.panels.forEach((pn, i) => {
      const b = pn.box;
      if (pn.alive) { p.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2); s.set(b.maxX - b.minX - 0.02, b.maxY - b.minY, b.maxZ - b.minZ); }
      else s.set(0, 0, 0);
      this.panelMesh.setMatrixAt(i, mtx.compose(p, q, s));
    });
    this.panelMesh.instanceMatrix.needsUpdate = true;
  }
  _applyGraphics() {
    if (!this.scene) return;
    const q = this.deps.settings.graphics, high = q === 'high' || q === 'ultra', r = this.deps.renderer;
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
    this.h.respawn(this.me.x, this.me.z, d.now(), 0);
    this.h.look.setAngles(this.me.yaw, 0);
    this.bl = { arena: { resolve: (p) => this.map.resolve(p), groundAt: () => 0, vaultTarget: () => null, hazardAt: () => 0, hazards: [] }, fire: (h, shotT) => this._fire(h, shotT) };
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
    const frozen = m.rules.frozen(me) || m.t < me.stunUntil || (me.ab && me.ab.busy);
    h.speedMult = me.alive && !frozen ? m.speedOf(me) : 0;
    h.f.alive = me.alive;
    h.update(t, dt, this.bl);
    if (me.alive) {
      me.x = h.f.x; me.z = h.f.z; me.yaw = h.look.yaw; me.pitch = h.look.pitch;
      me.crouch = h.f.crouch; me.speed = Math.hypot(h.f.vx, h.f.vz); me.ads = h.adsE;
    }
    // the simulation at 60 Hz
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK && n < 8) { m.step(); this.acc -= TICK; n++; }
    if (n === 8) this.acc = 0;
    this._events(t);
    this._refreshPanels();
    // draw everyone where the simulation has them
    for (const a of m.actors) {
      const f = this.fig.get(a.id);
      if (a !== me) { f.x = a.x; f.z = a.z; f.y = 0; f.yaw = a.yaw; f.pitch = a.pitch; f.crouch = a.crouch; f.ads = a.ads; }
      f.alive = a.alive; f.health = a.hp;
      f.updateVisual(t);
      const enemy = a.team !== me.team;
      const v = a !== me && a.alive && enemy;
      f.outline.visible = v; for (const l of f.legs) l.o.visible = v;
    }
    this._objectives(t);
    this._updateTracers(t);
    this._hud(t);
  }

  _events(t) {
    const m = this.m, me = this.me, sfx = this.deps.sfx;
    for (const e of m.events) {
      if (e.type === 'shot' && e.id !== me.id) {
        const f = this.fig.get(e.id);
        if (f) { f.flashUntil = t + 0.05; this._tracer(f.muzzleWorld(this._v || (this._v = new THREE.Vector3())), e.to, t, e.team); }
        const a = m.actors.find((x) => x.id === e.id);
        const dist = a ? Math.hypot(a.x - me.x, a.z - me.z) : 20;
        if (t - (this._lastShotSnd || 0) > 0.04) { this._lastShotSnd = t; sfx.shot(a ? a.gun.tone : 0.5, Math.max(0.05, Math.min(0.6, 3 / (dist + 2)))); }
      } else if (e.type === 'hit') {
        if (e.id === me.id) this._hurt(e.by, t);
        if (e.by === me.id) this._marker(e.zone === 'head' ? 'head' : 'hit', t);
      } else if (e.type === 'kill') {
        const v = m.actors.find((x) => x.id === e.id), k = m.actors.find((x) => x.id === e.by);
        this.feed.unshift({ k: k ? (k.human ? 'You' : k.name) : '', kc: k ? k.team : '', v: v.human ? 'You' : v.name, vc: v.team, head: e.head, t });
        this.feed.length = Math.min(this.feed.length, 5);
        this._renderFeed();
        if (k === me) { this._marker('kill', t); this._earn('kill', e.head); }
        if (v === me) this.killedBy = k ? k.name : 'the world';
      } else if (e.type === 'spawn' && e.id === me.id) {
        this.h.respawn(me.x, me.z, t, 0);
        this.h.look.setAngles(me.yaw, 0);
        this.h.f.alive = true;
      } else if (e.type === 'end') {
        const won = e.winner === me.team;
        if (won) this._earn('win');
        this._showEnd(e.winner === 'draw' ? 'Draw' : won ? 'Your team wins' : 'Your team loses', e.reason);
      } else if (e.type === 'msg') {
        this._flash(e.text, t);
      }
    }
    m.events.length = 0;
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
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
    s.scale.set(1.2, 1.2, 1); s.renderOrder = 5;
    return s;
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
    h.f.group.visible = false;
    r.render(this.scene, cam);
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
    if (this.m.ab.mouse && this.m.ab.mouse(this.me, dx, dy, this)) return;
    this.h.mouseMove(dx, dy);
  }
  mouseButton(b, down) {
    const h = this.h;
    if (!h) return;
    if (b === 0) h.in.fire = down;
    else if (b === 2) h.in.ads = down;
    else if (b === 3) h.in.leanL = down;
    else if (b === 4) h.in.leanR = down;
  }
  key(code, down) {
    if (!this.active) return false;
    const h = this.h;
    if (code === 'Tab') { this.hud.board.hidden = !down; if (down) this._renderBoard(); return true; }
    if (this.m.ab.key && this.m.ab.key(this.me, code, down, this)) return true;
    if (this.m.rules.key && this.m.rules.key(this.me, code, down)) return true;
    const map = { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'sprint', Space: 'crouch', KeyC: 'crouch', KeyQ: 'leanL', KeyE: 'leanR' };
    if (this.m.o.abilitiesOn) delete map.KeyQ;          // Q is the ability
    if (this.m.rules.usesE) delete map.KeyE;            // E: pick up / plant / defuse
    if (map[code]) { h.in[map[code]] = down; return true; }
    if (code === 'KeyR') { if (down && this.me.alive) h.reload(); return true; }
    if (code === 'KeyI') { if (down && !h.ads) h.rig.inspect(); return true; }
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
    view.append(hurt, dmg, cross, hit, pts, dead, name, hp, hpText, ammo, ability, hold, flash);
    const board = el('div', 'mg-board'); board.hidden = true;
    const end = el('div', 'b-end'); end.hidden = true;
    const box = el('div', 'b-end-box'), endTitle = el('h1', '', ''), endTable = el('div', 'b-table'), endNote = el('p', 'small', '');
    const again = el('button', 'primary', 'Play again'), leave = el('button', '', 'Back to the menu');
    again.type = leave.type = 'button';
    const row = el('div', 'row'); row.append(again, leave);
    box.append(endTitle, endTable, row, endNote); end.append(box);
    root.append(view, top, compass, status, feed, board, end);
    this.deps.hudRoot.insertBefore(root, this.deps.hudRoot.querySelector('#menu'));
    this.hud = { root, score, compass, status, feed, view, cross, hit, hurt, dead, name, hpFill, hpText, ammo, pts, ability, dmg, flash, hold, holdBar, board, end, endTitle, endTable, endNote, again, leave, last: {} };
    drawCrosshair(cross, this.deps.settings.crosshair);
  }
  _marker(kind, t) { this.hud.hit.className = 'b-hit on ' + kind; this.hitUntil = t + (kind === 'kill' ? 0.35 : 0.15); }
  _hurt(byId, t) {
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
      if (e.k) r.append(el('span', 't-' + e.kc, e.k), el('span', 'b-icon', e.head ? ' ✦ ' : ' › '), el('span', 't-' + e.vc, e.v));
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
        r.append(el('span', '', a.name), el('span', 'small', a.op.name + ' · ' + a.gun.name), el('span', '', a.kills + ' K'), el('span', '', a.deaths + ' D'));
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
    const st = m.rules.statusText ? m.rules.statusText(me) : '';
    if (L.st !== st) { L.st = st; H.status.textContent = st; H.status.hidden = !st; }
    const hp = Math.max(0, Math.ceil(me.hp));
    if (L.hp !== hp) { L.hp = hp; H.hpFill.style.width = hp + '%'; H.hpFill.className = hp > 60 ? '' : hp > 30 ? 'mid' : 'low'; H.hpText.textContent = String(hp); }
    const ammo = m.ab.ammoText ? m.ab.ammoText(me) || (h.weapon.reloading ? 'reloading' : h.weapon.ammo + ' / ' + h.gun.magSize) : (h.weapon.reloading ? 'reloading' : h.weapon.ammo + ' / ' + h.gun.magSize);
    if (L.ammo !== ammo) { L.ammo = ammo; H.ammo.textContent = ammo; }
    const cross = me.alive && h.adsE < 0.4 && !this.camOverride;
    if (L.cross !== cross) { L.cross = cross; H.cross.hidden = !cross; }
    if (t > (this.hitUntil || 0) && H.hit.classList.contains('on')) H.hit.className = 'b-hit';
    if (t > (this.hurtUntil || 0) && H.hurt.classList.contains('on')) H.hurt.className = 'b-hurt';
    if (t > (this.dmgUntil || 0) && H.dmg.classList.contains('on')) H.dmg.className = 'mg-dmgdir';
    if (t > (this.ptsUntil || 0) && H.pts.classList.contains('on')) H.pts.className = 'b-points';
    if (t > (this.flashUntil || 0) && !H.flash.hidden) H.flash.hidden = true;
    const dmsg = me.alive ? '' : (m.rules.deadText ? m.rules.deadText(me) : 'Eliminated by ' + (this.killedBy || '?') + (me.respawnAt ? ' · back in ' + Math.max(0, Math.ceil(me.respawnAt - m.t)) : ''));
    if (L.dead !== dmsg) { L.dead = dmsg; H.dead.hidden = !dmsg; H.dead.textContent = dmsg; }
    // hold bar (plant / defuse)
    const hold = me.hold;
    H.hold.hidden = !hold;
    if (hold) { H.hold.firstChild.textContent = hold.label; H.holdBar.style.width = Math.min(100, (m.t - hold.t0) / hold.need * 100) + '%'; }
    // ability icon
    if (m.ab.hudText) {
      const ab = m.ab.hudText(me);
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
