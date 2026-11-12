// Network matches (Milestone 9): Team Deathmatch, Capture the Flag and Bomb online, over the
// existing relay or a direct peer-to-peer link (js/net/). No server: one player hosts.
//
// The same model as Battle online:
// - Every player moves on their own PC (the same Rust physics and Bomb boundary) and sends
//   where they are. The host keeps everyone out of walls, and can move a player (spawns,
//   rounds, Bomb's boundary) with a 'force' message.
// - Shots go to the host with the shooter's aim and what the shooter saw hit. The host fires
//   the shot in its simulation (walls, doors, gadgets, noise) and accepts the claimed hit
//   only if the target is alive, an enemy, near the claimed spot and in sight.
// - Everything else (grenades, the knife, abilities, drones, planting and defusing, reinforcing,
//   barricades, barbed wire) is sent as an action and run by the host's simulation.
// - The host sends positions about 20 times a second, the match state (rules, abilities,
//   gadgets, walls and doors) when it changes, and every game event (shots, hits, kills,
//   explosions, messages) so each PC draws and plays them.
// A client keeps a copy of the match built from the host's roster (same actor ids) and never
// steps it; it only applies what the host sends.

import { spectatorVisibility } from '../replay/spectator.js?v=29e6b7d-mwdhze2p';

const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const fin = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
export const NET_SNAP_HZ = 20;

/* ---------- encoding: actors and gadgets become references ---------- */
// A deep copy that JSON can carry: actors become { $a: id }, gadgets { $g: id }, Sets and
// functions are dropped, numbers are rounded.
export function encode(v, m, depth = 0) {
  if (v === null || v === undefined) return v ?? null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'function' || depth > 6) return undefined;
  if (v instanceof Set || v instanceof Map) return undefined;
  if (Array.isArray(v)) return v.map((x) => encode(x, m, depth + 1));
  if (m.actors.includes(v)) return { $a: v.id };
  if (v.cells && v.box && m.map.panels[v.i] === v) return { $p: v.i };
  if (depth > 0 && v.type && v.id !== undefined && (m.ab.gadgets.includes(v) || m.ab.projectiles.includes(v))) return { $g: v.id };
  const out = {};
  for (const k of Object.keys(v)) {
    if (k === 'm' || k === 'brain' || k === 'c' || k === 'cfg') continue;
    const e = encode(v[k], m, depth + 1);
    if (e !== undefined) out[k] = e;
  }
  return out;
}
export function decode(v, m, gadgetById) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decode(x, m, gadgetById));
  if (v.$a !== undefined) return m.actors.find((a) => a.id === v.$a) || null;
  if (v.$p !== undefined) return m.map.panels[v.$p] || null;
  if (v.$g !== undefined) return gadgetById ? gadgetById(v.$g) : null;
  const out = {};
  for (const k of Object.keys(v)) out[k] = decode(v[k], m, gadgetById);
  return out;
}

// Rules fields that only the host's bots use (or are fixed for the match).
const RULES_SKIP = new Set(['m', 'sites', 'inside', 'claimed', 'group', 'stack', 'stackGo', 'target', 'nextRoles', 'name', 'usesE', 'limit', 'prep', 'timeLimit']);
export function rulesState(rules, m) {
  const out = {};
  for (const k of Object.keys(rules)) if (!RULES_SKIP.has(k)) { const e = encode(rules[k], m, 1); if (e !== undefined) out[k] = e; }
  return out;
}
// Ability state of an actor that the HUD and the drone camera need.
const AB_KEEP = ['charges', 'busy', 'cdUntil', 'nextAt', 'holdQ', 'shotgun', 'shells', 'nextShell', 'ready', 'dash'];
function abState(a, m) {
  if (!a.ab) return null;
  const o = {};
  for (const k of AB_KEEP) if (a.ab[k] !== undefined) o[k] = encode(a.ab[k], m, 1);
  o.drone = a.ab.drone ? a.ab.drone.id : 0;
  return o;
}
// Walls and doors: [kind (0 soft, 1 reinforced, 2 door), hp, alive bits of its cells].
const KINDS = ['soft', 'reinforced', 'door'];
export function mapState(map) {
  return map.panels.map((p) => {
    let bits = 0;
    p.cells.forEach((c, i) => { if (c.alive) bits |= 1 << i; });
    return [KINDS.indexOf(p.kind), Math.round(p.hp ?? 0), bits];
  });
}
export function applyMapState(map, st) {
  if (!Array.isArray(st) || st.length !== map.panels.length) return false;
  let changed = false;
  st.forEach(([k, hp, bits], i) => {
    const p = map.panels[i], kind = KINDS[k] || p.kind;
    if (p.kind !== kind) { p.kind = kind; for (const c of p.cells) if (c.kind !== 'door') c.kind = kind === 'door' ? c.kind : kind; changed = true; }
    p.hp = hp;
    p.cells.forEach((c, j) => { const alive = !!(bits & (1 << j)); if (c.alive !== alive) { map._setCell(c, alive); changed = true; } });
    map._sync(p);
  });
  if (changed) map.version++;
  return changed;
}

// What a player's PC sends for itself every frame (fast channel).
export function ownState(a, extra = {}) {
  return { k: 'st', x: r2(a.x), y: r2(a.y), z: r2(a.z), yaw: r1(a.yaw), pitch: r1(a.pitch), crouch: r2(a.crouch), speed: r1(a.speed || 0), ads: r2(a.ads || 0), ...extra };
}

/* ---------- host ---------- */
// game: the ModeGame running the match; peers: [{ link, actorId }].
export class MatchHost {
  constructor(game, peers) {
    this.g = game; this.peers = peers;
    this.nextSnap = 0; this.lastState = ''; this.lastMap = -1; this.lastGadgets = '';
    this.shots = new Map();
  }
  actorOf(link) { const p = this.peers.find(x => x.link === link && !x.retired && !x.spectator); return p ? this.g.m.actors.find((a) => a.id === p.actorId) : null; }
  send(msg, fast = false) {
    for (const peer of this.peers) {
      if (peer.spectator && msg.k !== 'mmap' && msg.k !== 'stopped') continue;
      if (peer.retired && msg.k !== 'stopped') continue;
      peer.link.send(msg, fast);
    }
  }
  // A message from a player.
  onMessage(link, msg) {
    const g = this.g, m = g.m, a = this.actorOf(link);
    if (!a || !msg || typeof msg !== 'object' || m.over) return;
    const t = m.t;
    if (msg.k === 'st') {
      if (!a.alive || t < (a.ignoreUntil || 0)) return;
      const p = { x: fin(msg.x, a.x), y: Math.max(0, Math.min(40, fin(msg.y, a.y))), z: fin(msg.z, a.z) };
      m.map.resolve(p);
      a.x = p.x; a.y = p.y; a.z = p.z;
      a.yaw = fin(msg.yaw, a.yaw); a.pitch = Math.max(-89, Math.min(89, fin(msg.pitch, a.pitch)));
      a.crouch = Math.max(0, Math.min(1, fin(msg.crouch))); a.speed = Math.max(0, Math.min(12, fin(msg.speed))); a.ads = Math.max(0, Math.min(1, fin(msg.ads)));
      a.lean = Math.max(-1, Math.min(1, fin(msg.lean)));
      a.recoilYaw = Math.max(-89, Math.min(89, fin(msg.recoilYaw)));
      a.recoilPitch = Math.max(-89, Math.min(89, fin(msg.recoilPitch)));
      if (a.ab && a.ab.drone && msg.drone) this.droneIn(a, msg.drone);
    } else if (msg.k === 'shot') this.shot(a, msg);
    else if (msg.k === 'act') this.act(a, msg);
  }
  shot(a, msg) {
    const m = this.g.m, t = m.t;
    if (!a.alive || !Array.isArray(msg.o) || !Array.isArray(msg.d)) return;
    // no faster than the gun (plus slack for bunching on the way)
    const list = this.shots.get(a.id) || []; this.shots.set(a.id, list);
    list.push(t); while (list.length && list[0] < t - 1) list.shift();
    if (list.length > a.gun.rpm / 60 * 1.5 + 3) return;
    const o = msg.o.slice(0, 3).map((v) => fin(v)), d = msg.d.slice(0, 3).map((v) => fin(v));
    const n = Math.hypot(d[0], d[1], d[2]); if (n < 1e-6) return;
    d[0] /= n; d[1] /= n; d[2] /= n;
    // the shot leaves from near the shooter's eye, never from somewhere else
    const eye = m.eye(a);
    if (Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) > 1.5) { o[0] = eye[0]; o[1] = eye[1]; o[2] = eye[2]; }
    const r = m.humanShot(a, o, d);
    if (!r || r.actor || !msg.hit) return;
    // the shooter saw a hit the host's (slightly older) positions missed: check it
    const v = m.actors.find((x) => x.id === (msg.hit.id | 0)), p = Array.isArray(msg.hit.p) ? msg.hit.p.slice(0, 3).map((x) => fin(x)) : null;
    const zone = ['head', 'torso', 'limbs'].includes(msg.hit.zone) ? msg.hit.zone : 'torso';
    if (!v || !p || !v.alive || v.team === a.team) return;
    if (Math.hypot(p[0] - v.x, p[2] - v.z) > 2 || Math.abs(p[1] - v.y - 1) > 1.6) return;
    if (r.t < Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]) - 0.6 && r.box) return;   // a wall in front of it
    if (!m.map.sight(o, p)) return;
    m.hit(v, a.gun.damage, a, zone, 'gun');
  }
  // Ability, grenade, knife, interact. The same calls ModeGame.key() makes for you.
  act(a, msg) {
    const g = this.g, m = g.m;
    const down = !!msg.down, ab = m.ab;
    switch (msg.a) {
      case 'q': if (a.alive && a.ab) ab.q(a, down); break;
      case 'f': if (a.alive && a.ab) ab.f(a); break;
      case 'recall': if (a.alive && a.ab && a.ab.drone) ab.recall(a); break;
      case 'shotgunToggle': if (a.alive && a.ab && a.ab.id === 'underbarrel') ab.toggleShotgun(a); break;
      case 'shotgun': if (a.alive && a.ab && a.ab.shotgun) { a.yaw = fin(msg.yaw, a.yaw); a.pitch = fin(msg.pitch, a.pitch); ab.fireShotgun(a); } break;
      case 'key': if (m.rules.key) m.rules.key(a, 'KeyE', down); break;
      case 'nade': if (a.alive) m.nades.throw(a, fin(msg.yaw, a.yaw), fin(msg.pitch, a.pitch)); break;
      case 'knife': if (a.alive) m.knife(a); break;
      default: break;
    }
  }
  droneIn(a, dn) {
    if (!Array.isArray(dn)) return;
    const [fwd, back, left, right] = dn.map((v) => !!v);
    a._droneIn = { fwd, back, left, right };
  }
  // Each frame, after the simulation stepped. t: the page clock.
  update(t, dt) {
    const g = this.g, m = g.m;
    // players on other PCs drive their drones through the simulation, like you do
    for (const a of m.actors) if (a.remote !== null && a.remote !== undefined && a.ab && a.ab.drone && a.ab.drone.alive && a._droneIn) m.ab.droneInput(a, a._droneIn, dt);
    // positions the simulation moved a player to: tell that player
    for (const p of this.peers) {
      const a = m.actors.find((x) => x.id === p.actorId);
      if (a && a.forced) { a.forced = false; a.ignoreUntil = m.t + 0.3; p.link.send({ k: 'force', x: r2(a.x), y: r2(a.y), z: r2(a.z), yaw: r1(a.yaw) }); }
    }
    if (t < this.nextSnap) return;
    this.nextSnap = t + 1 / NET_SNAP_HZ;
    // positions and health of everyone, and moving things (grenades, drones, breaching rounds)
    const f = m.actors.map((a) => [a.id, r2(a.x), r2(a.y), r2(a.z), r1(a.yaw), r1(a.pitch), r2(a.crouch), r2(a.ads || 0), Math.ceil(Math.max(0, a.hp)), a.alive ? 1 : 0, r1(a.speed || 0), r2(a.lean || 0), r2(a.recoilYaw || 0), r2(a.recoilPitch || 0)]);
    const mv = [...m.nades.live.map((n) => ['n', n.id, r2(n.x), r2(n.y), r2(n.z), r2(n.end), n.owner, r2(n.vx), r2(n.vy), r2(n.vz)]),
      ...m.ab.gadgets.filter((x) => x.alive && x.type === 'drone').map((x) => ['d', x.id, r2(x.x), r2(x.y), r2(x.z), r1(x.yaw), r1(x.pitch || 0)]),
      ...m.ab.projectiles.filter((x) => x.alive).map((x) => ['p', x.id, r2(x.x), r2(x.y), r2(x.z)])];
    this.send({ k: 'ms', t: r2(m.t), f, mv }, true);
    const views = new Map();
    for (const peer of this.peers) {
      if (!peer.spectator) continue;
      let view = views.get(peer.team);
      if (!view) {
        const visible = spectatorVisibility(m.actors, peer.team, m.map.world);
        const allies = new Set(m.actors.filter(actor => actor.team === peer.team).map(actor => actor.id));
        const marks = [...m.bb[peer.team].seen.values()].filter(mark => m.t - mark.t <= 2)
          .map(mark => ({ id: mark.id, x: r2(mark.x), z: r2(mark.z) }));
        view = { k: 'mwatch', t: r2(m.t), f: f.filter(row => visible.has(row[0])), score: m.rules.score,
          mv: mv.filter(row => row[0] === 'n' && allies.has(row[6])), marks };
        views.set(peer.team, view);
      }
      peer.link.send(view, true);
    }
    // the match state when it changes (reliable)
    const st = JSON.stringify({ rules: rulesState(m.rules, m), actors: m.actors.map((a) => [a.id, a.kills, a.deaths, a.assists || 0, encode(a.carry, m, 1), encode(a.hold, m, 1), r2(a.protectUntil), r2(a.stunUntil), r2(a.slowUntil), r2(a.revealedUntil), r2(a.respawnAt || 0), a.reinf ?? 0, a.wire ?? 0, abState(a, m), a.op.id, a.gunData.id, a.name]), nades: m.nades.live.map((n) => n.id) });
    if (st !== this.lastState) { this.lastState = st; this.send({ k: 'mstate', s: st }); }
    // each gadget in full (depth 0); references to gadgets elsewhere stay references
    const gs = JSON.stringify([...m.ab.gadgets.filter((x) => x.alive), ...m.ab.projectiles.filter((x) => x.alive)].map((x) => encode(x, m, 0)).concat([encode(m.ab.clouds || [], m, 1)]));
    if (gs !== this.lastGadgets) { this.lastGadgets = gs; this.send({ k: 'mgad', g: gs }); }
    if (m.map.version !== this.lastMap) { this.lastMap = m.map.version; this.send({ k: 'mmap', p: mapState(m.map) }); }
  }
  // Game events of this frame (before ModeGame._events clears them).
  events(list) {
    const m = this.g.m;
    if (!list.length) return;
    // a player on another PC (re)spawned: move them there first (the event follows in order)
    for (const e of list) if (e.type === 'spawn') {
      const a = m.actors.find((x) => x.id === e.id), p = a && this.peers.find((x) => x.actorId === a.id);
      if (p) { a.forced = false; a.ignoreUntil = m.t + 0.3; p.link.send({ k: 'force', x: r2(a.x), y: r2(a.y), z: r2(a.z), yaw: r1(a.yaw) }); }
    }
    const out = [];
    for (const e of list) {
      const event = e.type === 'end' ? { ...e, results: m.actors.map(actor => [actor.id, actor.kills, actor.deaths]) } : e;
      const encoded = encode(event, m, 0);
      if (encoded) out.push(encoded);
    }
    if (out.length) this.send({ k: 'mev', e: out });
    const end = out.find(event => event.type === 'end');
    if (end) for (const peer of this.peers) if (peer.spectator) peer.link.send({ k: 'mev', e: [end] });
  }
}

/* ---------- client ---------- */
export class MatchClient {
  constructor(game, link) {
    this.g = game; this.link = link;
    this.hostT = 0; this.nextSend = 0;
    this.gadgets = new Map();
  }
  send(msg, fast = false) { this.link.send(msg, fast); }
  onMessage(msg) {
    const g = this.g, m = g.m;
    if (!m || !msg) return;
    if (g.viewOnly && !['mwatch', 'mmap', 'mev'].includes(msg.k)) return;
    if (msg.k === 'mwatch' && g.viewOnly) {
      const present = new Set(msg.f.map(row => row[0]));
      for (const actor of m.actors) if (!present.has(actor.id)) actor.alive = false;
      g.watchMarks = msg.marks || [];
      m.rules.score = msg.score;
      this.snap(msg);
    } else if (msg.k === 'ms' && !g.viewOnly) this.snap(msg);
    else if (msg.k === 'mstate') this.state(JSON.parse(msg.s));
    else if (msg.k === 'mgad') this.gadgetsFrom(JSON.parse(msg.g));
    else if (msg.k === 'mmap') applyMapState(m.map, msg.p);
    else if (msg.k === 'mev') this.events(msg.e);
    else if (msg.k === 'force') { const me = g.me; me.x = fin(msg.x, me.x); me.y = fin(msg.y, me.y); me.z = fin(msg.z, me.z); if (msg.yaw !== undefined) { me.yaw = +msg.yaw; g.h.look.setAngles(me.yaw, 0); } me.forced = true; }
    else if (msg.k === 'mend') g._netEnd(msg);
  }
  snap(msg) {
    const g = this.g, m = g.m, me = g.me;
    m.t = fin(msg.t, m.t); this.hostT = m.t;
    for (const row of msg.f || []) {
      const a = m.actors.find((x) => x.id === row[0]);
      if (!a) continue;
      const alive = !!row[9];
      if (a === me && !g.viewOnly) {
        // you: the host decides health and life; your PC decides where you are
        a.hp = row[8];
        if (alive && !a.alive) a.forcedSpawn = true;
        a.alive = alive;
        continue;
      }
      a.x = row[1]; a.y = row[2]; a.z = row[3]; a.yaw = row[4]; a.pitch = row[5]; a.crouch = row[6]; a.ads = row[7]; a.hp = row[8]; a.alive = alive; a.speed = row[10];
      a.lean = fin(row[11]); a.recoilYaw = fin(row[12]); a.recoilPitch = fin(row[13]);
    }
    // moving things: grenades, drones, breaching rounds
    const live = [];
    for (const r of msg.mv || []) {
      if (r[0] === 'n') { let n = m.nades.live.find((x) => x.id === r[1]); if (!n) n = { id: r[1], alive: true }; Object.assign(n, { x: r[2], y: r[3], z: r[4], end: r[5], owner: r[6], vx: fin(r[7]), vy: fin(r[8]), vz: fin(r[9]), alive: true }); live.push(n); }
      else { const x = this.gadgets.get(r[1]); if (x) { x.x = r[2]; x.y = r[3]; x.z = r[4]; if (r[0] === 'd') { x.yaw = r[5]; x.pitch = r[6]; } } }
    }
    m.nades.live = live;
  }
  state(s) {
    const g = this.g, m = g.m;
    const rs = decode(s.rules, m, (id) => this.gadgets.get(id) || null);
    Object.assign(m.rules, rs);
    for (const row of s.actors) {
      const a = m.actors.find((x) => x.id === row[0]);
      if (!a) continue;
      [, a.kills, a.deaths, a.assists] = row;
      a.carry = decode(row[4], m); a.hold = decode(row[5], m);
      a.protectUntil = row[6]; a.stunUntil = row[7]; a.slowUntil = row[8]; a.revealedUntil = row[9]; a.respawnAt = row[10]; a.reinf = row[11]; a.wire = row[12];
      if (row[13] && a.ab) { const { drone, ...rest } = row[13]; Object.assign(a.ab, decode(rest, m)); a.ab.drone = drone ? this.gadgets.get(drone) || null : null; }
      if (a.op.id !== row[14]) { const op = [...m.o.ops.attackers, ...m.o.ops.defenders].find((x) => x.id === row[14]); if (op) { a.op = op; m.ab.init(a); } }
      if (a.gunData.id !== row[15]) { const gd = m.gunFor(a.human, row[15], a.attachMap); a.gunData = gd; Object.assign(a.gun, m.constructor.gunStatsOf(gd)); g._lookChanged = true; }
      if (row[16] && a !== g.me) a.name = row[16];
    }
  }
  gadgetsFrom(arr) {
    const m = this.g.m;
    const clouds = arr.pop() || [];
    const seen = new Set(), gad = [], proj = [];
    for (const raw of arr) {
      const x = decode(raw, m);
      if (!x || x.id === undefined) continue;
      let o = this.gadgets.get(x.id);
      if (!o) { o = {}; this.gadgets.set(x.id, o); }
      Object.assign(o, x); o.alive = true;
      seen.add(x.id);
      (x.type === 'breach' ? proj : gad).push(o);
    }
    for (const [id, o] of this.gadgets) if (!seen.has(id)) { o.alive = false; this.gadgets.delete(id); }
    m.ab.gadgets = gad; m.ab.projectiles = proj; m.ab.clouds = decode(clouds, m);
    // your drone object is the one in the list
    for (const a of m.actors) if (a.ab && a.ab.drone) a.ab.drone = this.gadgets.get(a.ab.drone.id) || null;
  }
  events(list) {
    const g = this.g, m = g.m, me = g.me;
    for (const raw of list) {
      const e = decode(raw, m);
      if (g.viewOnly && e.type !== 'end') continue;
      if (e.type === 'msg') {
        // messages written for the host's player: say them for you
        if (e.roundStart) e.text = 'Round ' + e.roundStart + ': ' + (e.attack === me.team ? 'attack' : 'defend');
        else if (e.roundWinner) e.text = (e.roundWinner === me.team ? 'Round won' : 'Round lost') + ': ' + e.words;
        else if (e.id === me.id) e.text = String(e.text).replace(/^\S.*? (has|returned|captured) /, (s, v) => 'You ' + (v === 'has' ? 'have' : v) + ' ');
        else if (typeof e.text === 'string') e.text = e.text.replace(/^You (have|returned|captured) /, (s, v) => g.hostName + ' ' + (v === 'have' ? 'has' : v) + ' ');
      }
      m.events.push(e);
    }
  }
  // Each frame: your position (fast) about 30 times a second, and your drone's controls.
  update(t, h) {
    const me = this.g.me;
    if (t < this.nextSend) return;
    this.nextSend = t + 1 / 30;
    const extra = { lean: r2(h.lean), recoilYaw: r2(h.offset[0]), recoilPitch: r2(h.offset[1]) };
    if (me.ab && me.ab.drone && me.ab.drone.alive) extra.drone = [h.in.fwd ? 1 : 0, h.in.back ? 1 : 0, h.in.left ? 1 : 0, h.in.right ? 1 : 0];
    if (me.alive) this.send(ownState(me, extra), true);
    else if (extra.drone) this.send({ k: 'st', drone: extra.drone }, true);
  }
  act(a, extra = {}) { this.send({ k: 'act', a, ...extra }); }
}
