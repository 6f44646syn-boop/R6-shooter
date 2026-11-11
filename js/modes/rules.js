import { utilityFor } from '../balance/bomb-utility.js?v=25db2c9-mwbx9yjs';
// Mode rules: Team Deathmatch, Capture the Flag, Bomb. Each sets up the match, spawns,
// scores, ends it, and gives bots their objective (botGoal).
export function makeRules(m) {
  const mode = m.o.mode;
  if (mode === 'tdm') return new TDM(m);
  if (mode === 'ctf') return new CTF(m);
  if (mode === 'bomb') return new Bomb(m);
  throw new Error('Unknown mode ' + mode);
}

class Rules {
  constructor(m) { this.m = m; this.score = { A: 0, B: 0 }; this.timeLimit = m.o.minutes * 60; }
  sideOf() { return null; }               // TDM / CTF: any op
  humanTeam() { return 'A'; }
  spawnList(team) { return this.m.map.data.spawns[team]; }
  start() { for (const a of this.m.actors) this.m.spawn(a, this.spawnList(a.team)); }
  update() {
    const m = this.m;
    for (const a of m.actors) if (!a.alive && a.respawnAt && m.t >= a.respawnAt) { a.respawnAt = 0; m.spawn(a, this.spawnList(a.team)); m.ab.refill(a); }
  }
  onKill(v) { v.respawnAt = this.m.t + 3; }
  check() {}
  botGoal() { return null; }
  frozen() { return false; }
  noFire() { return false; }
  // Where an actor may be: Bomb keeps defenders inside the building (see Bomb.keepIn).
  keepIn() { return null; }
  confine() { return false; }
  timeLeft() { return Math.max(0, this.timeLimit - this.m.t); }
}

/* ---------- Team Deathmatch: first to 40 kills, or more kills after the time ---------- */
export class TDM extends Rules {
  constructor(m) { super(m); this.limit = 40; this.name = 'Team Deathmatch'; }
  onKill(v, by) {
    super.onKill(v);
    if (by && by.team !== v.team) this.score[by.team]++;
  }
  check() {
    const m = this.m, s = this.score;
    if (s.A >= this.limit || s.B >= this.limit) m.end(s.A > s.B ? 'A' : 'B', 'kills');
    else if (m.t >= this.timeLimit) m.end(s.A === s.B ? 'draw' : s.A > s.B ? 'A' : 'B', 'time');
  }
}

/* ---------- Capture the Flag ---------- */
// Each team's flag: 'home' on its stand, 'carried' by an enemy, or 'dropped' where its carrier
// died (back home after 15 s, or at once when a teammate touches it). Bring the enemy flag to
// your own stand while yours is home to capture. First to 3, or more after the time; a tie
// goes to the next capture (overtime).
const TOUCH = 1.3, CAPTURE_R = 1.6, RETURN_S = 15;
export class CTF extends Rules {
  constructor(m) {
    super(m);
    this.name = 'Capture the Flag'; this.limit = 3; this.overtime = false; this.usesE = false;
    const st = m.map.data.flags;
    this.flags = {};
    for (const team of ['A', 'B']) this.flags[team] = { team, state: 'home', x: st[team][0], z: st[team][1], y: st[team][2] || 0, stand: st[team], carrier: null, returnAt: 0 };
    this.nextRoles = 0;
    this.group = {};
  }
  other(team) { return team === 'A' ? 'B' : 'A'; }
  flagHome(f) { f.state = 'home'; f.x = f.stand[0]; f.z = f.stand[1]; f.y = f.stand[2] || 0; f.carrier = null; f.returnAt = 0; }
  update(dt) {
    super.update(dt);
    const m = this.m, t = m.t;
    for (const team of ['A', 'B']) {
      const f = this.flags[team];
      if (f.state === 'carried') {
        const c = f.carrier;
        if (!c || !c.alive) this.drop(f, c);
        else { f.x = c.x; f.z = c.z; f.y = c.y; }
      } else if (f.state === 'dropped' && t >= f.returnAt) {
        this.flagHome(f);
        m.emit({ type: 'msg', text: (team === 'A' ? 'Blue' : 'Orange') + ' flag returned', team, flag: 'return' });
      }
    }
    for (const a of m.actors) {
      if (!a.alive) continue;
      const enemy = this.flags[this.other(a.team)], own = this.flags[a.team];
      // pick up the enemy flag
      if (!a.carry && (enemy.state === 'home' || enemy.state === 'dropped') && Math.hypot(enemy.x - a.x, enemy.z - a.z) < TOUCH && Math.abs(enemy.y - a.y) < 1.5) {
        enemy.state = 'carried'; enemy.carrier = a; enemy.returnAt = 0;
        a.carry = { type: 'flag', team: enemy.team };
        m.emit({ type: 'msg', text: (m.isMe(a) ? 'You have' : a.name + ' has') + ' the ' + (enemy.team === 'A' ? 'blue' : 'orange') + ' flag', team: a.team, flag: 'take', id: a.id });
        this.nextRoles = 0;
      }
      // return our dropped flag by touching it
      if (own.state === 'dropped' && Math.hypot(own.x - a.x, own.z - a.z) < TOUCH && Math.abs(own.y - a.y) < 1.5) {
        this.flagHome(own);
        m.emit({ type: 'msg', text: (m.isMe(a) ? 'You returned' : a.name + ' returned') + ' the ' + (own.team === 'A' ? 'blue' : 'orange') + ' flag', team: a.team, flag: 'return' });
        this.nextRoles = 0;
      }
      // capture
      if (a.carry && a.carry.type === 'flag' && own.state === 'home' && Math.hypot(own.stand[0] - a.x, own.stand[1] - a.z) < CAPTURE_R && Math.abs((own.stand[2] || 0) - a.y) < 1.5) {
        const f = this.flags[a.carry.team];
        this.flagHome(f); a.carry = null;
        this.score[a.team]++;
        m.emit({ type: 'msg', text: (m.isMe(a) ? 'You captured' : a.name + ' captured') + ' the flag!', team: a.team, flag: 'capture', id: a.id });
        this.nextRoles = 0;
      }
    }
    if (t >= this.nextRoles) this.roles();
  }
  drop(f, c) {
    f.state = 'dropped'; f.carrier = null; f.returnAt = this.m.t + RETURN_S;
    if (c) { f.x = c.x; f.z = c.z; f.y = this.m.map.groundAt(c.x, c.z, c.y); c.carry = null; }
    this.m.emit({ type: 'msg', text: (f.team === 'A' ? 'Blue' : 'Orange') + ' flag dropped', team: f.team, flag: 'drop' });
    this.nextRoles = 0;
  }
  onKill(v, by) {
    super.onKill(v, by);
    if (v.carry && v.carry.type === 'flag') this.drop(this.flags[v.carry.team], v);
  }
  check() {
    const m = this.m, s = this.score;
    if (s.A >= this.limit || s.B >= this.limit) { m.end(s.A > s.B ? 'A' : 'B', 'captures'); return; }
    if (m.t >= this.timeLimit) {
      if (s.A !== s.B) m.end(s.A > s.B ? 'A' : 'B', this.overtime ? 'overtime' : 'time');
      else if (!this.overtime) { this.overtime = true; m.emit({ type: 'msg', text: 'Overtime: next capture wins' }); }
      if (m.t >= this.timeLimit + 600) m.end('draw', 'time');      // a safety stop after 10 more minutes
    }
  }
  // Bot roles, reassigned on events (and every 2 s): stealers when the enemy flag is home,
  // escorts when we carry it, chasers when ours is taken, defenders otherwise.
  roles() {
    const m = this.m;
    this.nextRoles = m.t + 2;
    for (const team of ['A', 'B']) {
      const bots = m.actors.filter((a) => a.team === team && a.brain && a.alive);
      const own = this.flags[team], enemy = this.flags[this.other(team)];
      const ourCarrier = enemy.state === 'carried' ? enemy.carrier : null;
      const byDist = (x, z) => bots.slice().sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z));
      for (const b of bots) b.brain.role = 'defend';
      if (own.state === 'carried' || own.state === 'dropped') {
        // chase the carrier / return the flag: the nearest half
        byDist(own.x, own.z).slice(0, Math.max(1, Math.ceil(bots.length / 2))).forEach((b) => { b.brain.role = own.state === 'carried' ? 'chase' : 'recover'; });
      }
      if (ourCarrier) {
        if (ourCarrier.brain) ourCarrier.brain.role = 'carry';
        bots.filter((b) => b !== ourCarrier && b.brain.role === 'defend').slice(1).forEach((b) => { b.brain.role = 'escort'; });
      } else {
        const free = bots.filter((b) => b.brain.role === 'defend');
        const n = Math.max(1, Math.ceil(free.length * 0.6));
        byDist(enemy.x, enemy.z).filter((b) => free.includes(b)).slice(0, n).forEach((b) => { b.brain.role = 'steal'; });
      }
      // one defender at most; the others hunt (in overtime everyone attacks)
      bots.filter((b) => b.brain.role === 'defend').slice(this.overtime ? 0 : 1).forEach((b) => { b.brain.role = this.overtime && !ourCarrier ? 'steal' : 'hunt'; });
      // stealers group up before going in
      const st = bots.filter((b) => b.brain.role === 'steal');
      const g = this.group[team] || (this.group[team] = { until: 0 });
      if (enemy.state !== 'home' || st.length < 2) g.until = 0;
      else {
        const sx = enemy.stand[0] + Math.sign(own.stand[0] - enemy.stand[0]) * 14, sz = enemy.stand[1];
        g.stage = [sx, sz];
        const near = st.filter((b) => Math.hypot(b.x - sx, b.z - sz) < 7).length;
        if (!g.until) g.until = m.t + 6;
        g.go = near >= 2 || m.t > g.until;
        if (g.go && m.t > g.until + 20) g.until = 0;      // a new grouping next time
      }
    }
  }
  botGoal(brain) {
    const a = brain.a, own = this.flags[a.team], enemy = this.flags[this.other(a.team)];
    switch (brain.role) {
      case 'carry': {
        const via = this.via(brain, own.stand);
        if (via) return { x: via[0], z: via[1], y: via[2], key: 'carryvia', must: true, push: true };
        return { x: own.stand[0], z: own.stand[1], y: own.stand[2] || 0, key: 'carry', must: true, push: true };
      }
      case 'steal': {
        const via = this.via(brain, [enemy.x, enemy.z]);
        if (via) return { x: via[0], z: via[1], y: via[2], key: 'via' + via[1], push: true };
        const g = this.group[a.team];
        if (g && g.until && !g.go && g.stage) return { x: g.stage[0], z: g.stage[1], key: 'stage', hold: true, r: 4, face: [enemy.x, enemy.z] };
        return { x: enemy.x, z: enemy.z, y: enemy.y, key: 'steal' + enemy.state + Math.round(enemy.x) + ',' + Math.round(enemy.z), push: true };
      }
      case 'hunt': return null;
      case 'escort': { const c = enemy.carrier; return c ? { x: c.x - 1.5, z: c.z, y: c.y, key: 'escort' + Math.round(c.x / 3) + ',' + Math.round(c.z / 3), push: true } : null; }
      case 'chase': return { x: own.x, z: own.z, y: own.y, key: 'chase' + Math.round(own.x / 3) + ',' + Math.round(own.z / 3) };
      case 'recover': return { x: own.x, z: own.z, y: own.y, key: 'recover', push: true };
      default: {
        // hold near our stand at a cover spot
        if (!brain.post || brain.postT < this.m.t) {
          const spots = this.m.map.data.cover.filter((c) => { const d = Math.hypot(c[0] - own.stand[0], c[1] - own.stand[1]); return d > 5 && d < 14; });
          brain.post = spots.length ? spots[Math.floor(this.m.rng() * spots.length)] : own.stand;
          brain.postT = this.m.t + 20;
        }
        return { x: brain.post[0], z: brain.post[1], y: brain.post[2] || 0, key: 'post' + brain.post[0] + ',' + brain.post[1], hold: true, r: 1.5, face: [enemy.stand[0], enemy.stand[1]] };
      }
    }
  }
  // Go round a flank rather than through the middle: a waypoint in the north or south lane
  // (picked per bot), until past the middle of the map towards the target.
  via(brain, to) {
    const a = brain.a;
    const key = brain.role + Math.sign(to[0]);
    if (brain.viaKey !== key) { brain.viaKey = key; brain.viaDone = false; brain.lane = this.m.rng() < 0.5 ? -1 : 1; }
    if (brain.viaDone) return null;
    if (Math.abs(to[0] - a.x) < 14 || (Math.sign(to[0]) === Math.sign(a.x) && Math.abs(a.x) > 8)) { brain.viaDone = true; return null; }
    const hz = this.m.map.hz, map = this.m.map;
    const vk = Math.sign(to[0]) + ',' + brain.lane, V = this._via || (this._via = new Map());
    if (!V.has(vk)) V.set(vk, map.nearestSpot(Math.sign(to[0]) * 11, brain.lane * hz * 0.68, 0));
    const n = V.get(vk);
    if (!n) { brain.viaDone = true; return null; }
    if (Math.hypot(n[0] - a.x, n[1] - a.z) < 2.5) { brain.viaDone = true; return null; }
    return n;
  }
  // For the HUD: flags, stands and compass markers.
  markers(me) {
    const out = [];
    for (const team of ['A', 'B']) {
      const f = this.flags[team], col = team === 'A' ? 0x5b8cff : 0xff7048, ours = team === me.team;
      out.push({ key: 'stand' + team, shape: 'stand', x: f.stand[0], z: f.stand[1], y: f.stand[2] || 0, color: col });
      out.push({ key: 'flag' + team, shape: 'flag', x: f.x, z: f.z, y: (f.y || 0) + (f.state === 'carried' ? 0.6 : 0), color: col, show: !(f.state === 'carried' && f.carrier === me), compass: ours ? 'Our flag' : 'Enemy flag' });
    }
    return out;
  }
  flagText(f, me) {
    if (f.state === 'home') return 'home';
    if (f.state === 'carried') return f.carrier === me ? 'YOU HAVE IT' : 'taken by ' + f.carrier.name;
    return 'dropped (back in ' + Math.ceil(f.returnAt - this.m.t) + ' s)';
  }
  statusText(me) { return 'Our flag: ' + this.flagText(this.flags[me.team], me) + '  ·  Enemy flag: ' + this.flagText(this.flags[this.other(me.team)], me); }
  scoreText(team) { return 'Captures: your team ' + this.score[team] + ' · enemy ' + this.score[this.other(team)]; }
  timerText() { return this.overtime ? 'Overtime' : Math.floor(this.timeLeft() / 60) + ':' + String(Math.floor(this.timeLeft() % 60)).padStart(2, '0'); }
  summary() { return this.m.winner + ' ' + this.score.A + '-' + this.score.B + (this.overtime ? ' OT' : ''); }
}

/* ---------- Bomb ---------- */
// Attackers plant, defenders stop them. First to 4 round wins; sides swap after round 3. One
// life a round (dead players spectate). Phases: prep 30 s (defenders set gadgets, attackers
// wait at their spawn and scout with drones), action duration from the Bomb utility policy, then 5 s of round summary.
// An attacker carries the bomb: hold E for 5 s inside a site to plant; it goes off after
// 40 s; defenders hold E for 6 s beside it to defuse. Holding stops you moving; damage cancels.
// A round ends when one team is all dead (after a plant, the defenders must still defuse),
// the bomb goes off (attackers win), it is defused (defenders win), or the time runs out with
// no plant (defenders win). If the carrier dies the bomb drops; any attacker can pick it up.
// Prep (30 s by default; prepTime in the match options): defenders hold E at a soft wall to
// reinforce it (two each a round) or in an open doorway or window to barricade it, lay
// barbed wire (their throwable in Bomb) and place gadgets; attackers drone.
export const BOMB = { prep: 30, get action() { return utilityFor('bomb').actionSeconds; }, plant: 5, fuse: 40, defuse: 6, summary: 5, wins: 4, swapAfter: 3, pickup: 1.2, defuseR: 1.6, reinforce: 2.5, barricade: 1.5, reinforcements: 2, wires: 2 };
export class Bomb extends Rules {
  constructor(m) {
    super(m);
    this.name = 'Bomb'; this.usesE = true;
    this.prep = Math.max(10, Math.min(120, +m.o.prepTime || BOMB.prep));
    this.claimed = new Set();     // panels a defender bot is working on
    this.round = 0; this.rounds = []; this.phase = 'prep'; this.phaseEnd = 0;
    this.firstAttack = (m.o.human && m.o.human.side === 'defend') ? 'B' : 'A';   // your team is A
    this.bomb = { state: 'none', x: 0, z: 0, carrier: null, site: null, fuseEnd: 0 };
    this.sites = m.map.data.sites;
    // The defenders' area: the rooms of the building ([x0, z0, x1, z1] each). They never
    // leave it: not through a door, a window, or a wall that has been opened.
    const D = m.map.data;
    this.inside = D.inside && D.inside.length ? D.inside : D.building ? [D.building] : null;
  }
  attackTeam() { return this.round > BOMB.swapAfter ? (this.firstAttack === 'A' ? 'B' : 'A') : this.firstAttack; }
  sideOf(team) { return team === (this.round > BOMB.swapAfter ? (this.firstAttack === 'A' ? 'B' : 'A') : this.firstAttack) ? 'attack' : 'defend'; }
  isAttacker(a) { return a.team === this.attackTeam(); }
  spawnList(team) { return this.m.map.data.spawns[this.sideOf(team) === 'attack' ? 'A' : 'B']; }
  start() { this.newRound(); }
  newRound() {
    const m = this.m;
    this.round++;
    this.stack = null; this.stackGo = false;     // the attackers' gathering point this round
    // after round 3 the sides swap: everyone takes the matching op of the other side
    if (this.round === BOMB.swapAfter + 1) {
      const O = m.o.ops;
      for (const a of m.actors) {
        const from = O.attackers.findIndex((o) => o.id === a.op.id), to = from >= 0 ? O.defenders[from] : O.attackers[O.defenders.findIndex((o) => o.id === a.op.id)];
        if (!to) continue;
        a.op = to; if (!a.human) a.name = to.name;
        const g = m.gunFor ? m.gunFor(a.human, to.gun, a.attachMap) : m.gunsById.get(to.gun);
        a.gunData = g; a.gun = Object.assign(a.gun, { ...m.constructor.gunStatsOf(g) });
        m.ab.init(a);
      }
      m.emit({ type: 'swap' });
      m.emit({ type: 'msg', text: 'Sides swapped' });
    }
    this.phase = 'prep'; this.phaseEnd = m.t + this.prep; this.claimed.clear();
    this.bomb = { state: 'none', x: 0, z: 0, carrier: null, site: null, fuseEnd: 0 };
    m.ab.clearAll(); m.nades.clear(); m.map.resetPanels();
    this.target = this.sites[Math.floor(m.rng() * this.sites.length)];
    for (const a of m.actors) {
      m.spawn(a, this.spawnList(a.team), 0, 2.5); a.respawnAt = 0; m.ab.refill(a); if (a.brain) { a.brain.post = null; a.brain.job = null; a.brain.jobsDone = 0; a.brain.wired = false; }
      // defenders: reinforcements and barbed wire instead of grenades
      const def = !this.isAttacker(a);
      a.reinf = def ? BOMB.reinforcements : 0; a.wire = def ? BOMB.wires : 0;
      if (def) a.nades = 0;
    }
    // the bomb: always yours when you attack, else a random attacker bot
    const att = m.actors.filter((a) => this.isAttacker(a));
    const carrier = att.find((a) => a.human) || att[Math.floor(m.rng() * att.length)];
    this.give(carrier);
    // jobs (the same bot keeps its job while on a side)
    const ATT = ['entry', 'flanker', 'support', 'lurker'], DEF = ['anchor', 'site control', 'roamer', 'site control', 'anchor'];
    let ai = 0, di = 0;
    for (const a of m.actors) {
      a.role = null;
      if (!a.brain) continue;
      const b = a.brain;
      b.site = this.sites[0]; b.roam = null; b.flank = null; b.flankDone = false; b.fellBack = false;
      if (this.isAttacker(a)) a.role = a === carrier ? 'carrier' : ATT[ai++ % ATT.length];
      else { a.role = DEF[di % DEF.length]; b.slot = di++; }
    }
    m.emit({ type: 'round', round: this.round, attack: this.attackTeam() });
    m.emit({ type: 'msg', text: 'Round ' + this.round + ': ' + (this.attackTeam() === (m.human() ? m.human().team : 'A') ? 'attack' : 'defend'), roundStart: this.round, attack: this.attackTeam() });
  }
  // The nearest point to (x, z) a defender may stand at: [x, z, moved]. Others: null.
  keepIn(a, x, z) {
    const R = this.inside;
    if (!R || this.isAttacker(a)) return null;
    let bx = x, bz = z, bd = Infinity;
    for (const r of R) {
      const cx = Math.max(r[0], Math.min(x, r[2])), cz = Math.max(r[1], Math.min(z, r[3]));
      const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
      if (d < bd) { bd = d; bx = cx; bz = cz; if (d === 0) break; }
    }
    return [bx, bz, bd > 1e-10];
  }
  // Put a defender who is outside back at the edge of the building. Returns true if it moved.
  confine(a) {
    const p = this.keepIn(a, a.x, a.z);
    if (!p || !p[2]) return false;
    a.x = p[0]; a.z = p[1];
    return true;
  }
  // A defender this close to a way out (an open door, a hole in an outside wall) gets a
  // warning: metres to the edge of the building, or Infinity.
  edgeAhead(a) {
    const R = this.inside;
    if (!R || this.isAttacker(a) || !a.alive) return Infinity;
    const map = this.m.map;
    let best = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // how far in this direction until the building ends
      let d = 0;
      while (d < 1.6 && !this.keepIn(a, a.x + dx * (d + 0.2), a.z + dz * (d + 0.2))[2]) d += 0.2;
      if (d >= 1.6 || d >= best) continue;
      if (map.walkClear(a.x, a.z, a.x + dx * (d + 0.9), a.z + dz * (d + 0.9), 0.15, a.y)) best = d;   // nothing in the way: an opening
    }
    return best;
  }
  give(a) { const b = this.bomb; b.state = 'carried'; b.carrier = a; a.carry = { type: 'bomb' }; }
  frozen(a) {
    if (this.phase === 'post') return true;
    if (this.phase === 'prep' && this.isAttacker(a)) return true;
    return !!a.hold;
  }
  // nobody shoots in the prep phase (defenders set up, attackers wait) or between rounds
  noFire() { return this.phase === 'prep' || this.phase === 'post'; }
  inSite(x, z) { return this.sites.find((s) => Math.hypot(s.x - x, s.z - z) <= s.r) || null; }
  // What a defender facing this way could work on: a soft wall to reinforce (if it has
  // reinforcements left), else an open doorway or window to barricade.
  workAt(a) {
    const y = a.yaw * Math.PI / 180, dx = Math.sin(y), dz = -Math.cos(y), map = this.m.map;
    return (a.reinf > 0 && map.panelInFront(a.x, a.z, a.y, dx, dz, 'soft', this.m.utility.reinforceReach)) || map.panelInFront(a.x, a.z, a.y, dx, dz, 'slot') || null;
  }
  // Start or stop holding E: defuse, reinforce, barricade, plant. Returns true if a hold
  // started. target: the panel a bot means (people use what they face).
  setHold(a, on, target = null) {
    const m = this.m, b = this.bomb;
    if (!on) { if (a.hold) { a.hold = null; } return false; }
    if (!a.alive || a.hold || this.phase === 'post') return false;
    const def = !this.isAttacker(a);
    if (def && b.state === 'planted' && Math.hypot(b.x - a.x, b.z - a.z) < BOMB.defuseR) {
      a.hold = { type: 'defuse', t0: m.t, need: BOMB.defuse, label: 'Defusing' }; return true;
    }
    if (def) {
      const pn = target || this.workAt(a);
      if (pn && pn.kind === 'soft' && a.reinf > 0) { a.hold = { type: 'reinforce', panel: pn, t0: m.t, need: m.utility.reinforceSeconds, label: 'Reinforcing' }; return true; }
      if (pn && pn.kind === 'door' && !pn.alive) { a.hold = { type: 'barricade', panel: pn, t0: m.t, need: m.utility.barricadeSeconds, label: 'Barricading' }; return true; }
    }
    if (this.phase === 'prep') return false;
    if (!def && b.state === 'carried' && b.carrier === a && this.inSite(a.x, a.z)) {
      a.hold = { type: 'plant', t0: m.t, need: BOMB.plant, label: 'Planting' }; return true;
    }
    return false;
  }
  // The panel is still there to work on, within reach of a.
  _reach(a, pn) { const c = pn.box; return Math.hypot(Math.max(c.minX - a.x, 0, a.x - c.maxX), Math.max(c.minZ - a.z, 0, a.z - c.maxZ)) < 2 && Math.abs((pn.y0 || 0) - a.y) < 0.6; }
  key(me, code, down) { if (code !== 'KeyE') return false; this.setHold(me, down); return true; }
  update() {
    const m = this.m, t = m.t, b = this.bomb;
    if (this.phase === 'prep' && t >= this.phaseEnd) { this.phase = 'action'; this.phaseEnd = t + m.utility.actionSeconds; m.emit({ type: 'msg', text: 'Action phase' }); }
    if (this.phase === 'post') { if (t >= this.phaseEnd) { if (!m.over) this.newRound(); } return; }
    // the bomb
    if (b.state === 'carried') {
      const c = b.carrier;
      if (!c || !c.alive) { b.state = 'dropped'; b.carrier = null; if (c) { b.x = c.x; b.y = c.y; b.z = c.z; c.carry = null; } m.emit({ type: 'msg', text: 'The bomb was dropped' }); }
      else { b.x = c.x; b.y = c.y; b.z = c.z; }
    } else if (b.state === 'dropped') {
      for (const a of m.actors) if (a.alive && this.isAttacker(a) && !a.carry && Math.hypot(a.x - b.x, a.z - b.z) < BOMB.pickup) { this.give(a); m.emit({ type: 'msg', text: (m.isMe(a) ? 'You have' : a.name + ' has') + ' the bomb', id: a.id }); break; }
    }
    // holds
    for (const a of m.actors) {
      const h = a.hold;
      if (!h) continue;
      if (!a.alive) { a.hold = null; continue; }
      if (h.type === 'plant' && !(b.state === 'carried' && b.carrier === a && this.inSite(a.x, a.z))) { a.hold = null; continue; }
      if (h.type === 'defuse' && !(b.state === 'planted' && Math.hypot(b.x - a.x, b.z - a.z) < BOMB.defuseR)) { a.hold = null; continue; }
      if (h.type === 'reinforce' && !(h.panel.kind === 'soft' && this._reach(a, h.panel))) { a.hold = null; continue; }
      if (h.type === 'barricade' && !(h.panel.kind === 'door' && !h.panel.alive && this._reach(a, h.panel))) { a.hold = null; continue; }
      if (t - h.t0 >= h.need) {
        a.hold = null;
        const pb = h.panel && h.panel.box;
        if (h.type === 'reinforce') {
          m.map.reinforce(h.panel, a.id); a.reinf--;
          m.noise(a, 20, 'reinforce');
          m.emit({ type: 'reinforce', id: a.id, x: (pb.minX + pb.maxX) / 2, y: (pb.minY + pb.maxY) / 2, z: (pb.minZ + pb.maxZ) / 2 });
          continue;
        }
        if (h.type === 'barricade') {
          if (m.map.barricade(h.panel)) { m.noise(a, 15, 'barricade'); m.emit({ type: 'barricade', id: a.id, x: (pb.minX + pb.maxX) / 2, y: (pb.minY + pb.maxY) / 2, z: (pb.minZ + pb.maxZ) / 2 }); }
          continue;
        }
        if (h.type === 'plant') {
          b.state = 'planted'; b.carrier = null; a.carry = null; b.x = a.x; b.y = a.y; b.z = a.z; b.site = this.inSite(a.x, a.z); b.fuseEnd = t + BOMB.fuse;
          this.phase = 'planted';
          m.noise(a, 35, 'plant');
          m.emit({ type: 'msg', text: 'Bomb planted at ' + b.site.name + '!' });
        } else {
          b.state = 'defused';
          this.endRound(a.team, 'defused');
          return;
        }
      }
    }
    if (b.state === 'planted' && t >= b.fuseEnd) { b.state = 'detonated'; this.explode(); this.endRound(this.attackTeam(), 'detonated'); }
  }
  explode() {
    const m = this.m, b = this.bomb;
    for (const a of m.actors) if (a.alive && Math.hypot(a.x - b.x, a.z - b.z) < 8) m.hit(a, 300, null, 'torso', 'bomb');
    m.emit({ type: 'boom', x: b.x, y: b.y || 0, z: b.z });
  }
  onKill(v) { v.respawnAt = 0; }               // one life a round
  check() {
    const m = this.m;
    if (m.over || this.phase === 'post') return;
    const at = this.attackTeam(), df = at === 'A' ? 'B' : 'A';
    const aliveA = m.actors.some((a) => a.alive && a.team === at), aliveD = m.actors.some((a) => a.alive && a.team === df);
    if (!aliveD) { this.endRound(at, 'eliminated'); return; }
    if (!aliveA && this.bomb.state !== 'planted') { this.endRound(df, 'eliminated'); return; }
    if (this.phase === 'action' && m.t >= this.phaseEnd && this.bomb.state !== 'planted') this.endRound(df, 'time');
  }
  endRound(team, reason) {
    const m = this.m;
    this.score[team]++;
    this.rounds.push({ round: this.round, winner: team, side: this.sideOf(team), reason });
    for (const a of m.actors) { a.hold = null; }
    m.emit({ type: 'roundEnd', winner: team, reason, round: this.round });
    const words = { eliminated: 'all enemies down', detonated: 'the bomb went off', defused: 'the bomb was defused', time: 'time ran out with no plant' };
    const me = m.human();
    m.emit({ type: 'msg', text: (me ? (team === me.team ? 'Round won' : 'Round lost') : 'Team ' + team + ' wins the round') + ': ' + words[reason], roundWinner: team, words: words[reason] });
    if (this.score[team] >= BOMB.wins) { m.end(team, 'rounds'); return; }
    this.phase = 'post'; this.phaseEnd = m.t + BOMB.summary;
  }
  timeLeft() {
    const m = this.m;
    if (this.bomb.state === 'planted') return Math.max(0, this.bomb.fuseEnd - m.t);
    return Math.max(0, this.phaseEnd - m.t);
  }
  /* bots */
  botGoal(brain) {
    const m = this.m, a = brain.a, b = this.bomb, t = m.t;
    if (this.phase === 'post') return null;
    if (this.isAttacker(a)) {
      const site = (b.site) || this.target;
      if (b.state === 'dropped') {
        // the nearest attacker fetches it
        const att = m.actors.filter((x) => x.alive && this.isAttacker(x) && x.brain);
        const near = att.sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0];
        if (near === a) return { x: b.x, z: b.z, key: 'bombpick', push: true };
      }
      if (b.state === 'carried' && b.carrier === a) {
        if (this.inSite(a.x, a.z) && Math.hypot(site.x - a.x, site.z - a.z) < site.r - 0.5) {
          // plant (after the area looks clear for a moment, or if hurt)
          if (!a.hold && (t - brain.visAt > 1.2 || a.hp < 50)) this.setHold(a, true);
          return { x: a.x, z: a.z, key: 'plant', hold: true, r: 9, ignoreEnemies: !!a.hold };
        }
        // hang back while the team still sees defenders on the site, so the others clear it;
        // go in once it is quiet, when alone, or late in the round
        const mates = m.actors.filter((x) => x.alive && x !== a && this.isAttacker(x));
        const hot = [...m.bb[a.team].seen.values()].some((s) => t - s.t < 3 && Math.hypot(s.x - site.x, s.z - site.z) < 10);
        const held = mates.some((x) => Math.hypot(x.x - site.x, x.z - site.z) < site.r + 1.5);
        const inside = Math.hypot(site.x - a.x, site.z - a.z) < site.r;
        brain.staging = !inside && mates.length > 0 && (hot || !held) && this.phaseEnd - t > 45 && Math.hypot(site.x - a.x, site.z - a.z) < 20;
        if (brain.staging) {
          // a cover spot out of sight of the site, nearest to the carrier
          if (brain.stageFor !== site.name) {
            const ok = m.map.data.cover.filter((q) => { const d = Math.hypot(q[0] - site.x, q[1] - site.z); return d >= 8 && d <= 16 && !m.map.sight([q[0], 1.2, q[1]], [site.x, 1.2, site.z]); });
            ok.sort((p, q) => Math.hypot(p[0] - a.x, p[1] - a.z) - Math.hypot(q[0] - a.x, q[1] - a.z));
            brain.stage = ok[0] || [a.x, a.z]; brain.stageFor = site.name;
          }
          return { x: brain.stage[0], z: brain.stage[1], key: 'stage' + site.name, crouch: true };
        }
        return { x: site.x, z: site.z, key: 'site' + site.name, push: t - brain.visAt > 4 };
      }
      if (b.state === 'planted') {
        // guard the bomb from cover nearby
        return this.post(brain, b.x, b.z, 4, 11, 'guard');
      }
      const c = b.carrier, late = this.phaseEnd - t < 70;
      // Coordinated entry: the entry and support gather with the team out of the site's sight,
      // then go in together (when three are there, the carrier is close, or after 25 s).
      if ((a.role === 'entry' || a.role === 'support') && !late && this.phase === 'action' && !this.stackGo) {
        const st = this.stackPoint(site);
        if (st) {
          const att = m.actors.filter((x) => x.alive && this.isAttacker(x));
          const there = att.filter((x) => Math.hypot(x.x - st[0], x.z - st[1]) < 5).length;
          const since = t - (this.phaseEnd - BOMB.action);
          if (there >= Math.min(3, att.length) || since > 25 || (c && Math.hypot(c.x - st[0], c.z - st[1]) < 5 && there >= 2)) this.stackGo = true;
          else return { x: st[0] + (a.id % 3 - 1) * 1.2, z: st[1] + (a.id % 2 ? -1.2 : 1.2), key: 'stack' + site.name, crouch: Math.hypot(st[0] - a.x, st[1] - a.z) < 4 };
        }
      }
      const onSite = { x: site.x + (a.id % 3 - 1) * 2.5, z: site.z + (a.id % 2 ? -2.5 : 2.5), key: 'site' + site.name + a.id, push: true };
      // support: stays with the carrier (you, or a bot), then on to the site
      if (a.role === 'support' && c && c !== a && !(c.brain && c.brain.staging) && Math.hypot(c.x - site.x, c.z - site.z) > 6) return { x: c.x + (a.id % 3 - 1) * 2, z: c.z + (a.id % 2 ? -2 : 2), key: 'escort' + Math.round(c.x / 4) + ',' + Math.round(c.z / 4), push: true };
      // flanker: round to the site's entry farthest from the team, then in through it
      if (a.role === 'flanker' && !brain.flankDone && !late) {
        if (!brain.flank) {
          const E = site.entries || [];
          const tx = m.actors.filter((x) => x.alive && this.isAttacker(x)).reduce((s, x) => s + x.x, 0), tz = m.actors.filter((x) => x.alive && this.isAttacker(x)).reduce((s, x) => s + x.z, 0), n = Math.max(1, m.actors.filter((x) => x.alive && this.isAttacker(x)).length);
          const e = E.slice().sort((p, q) => Math.hypot(q[0] - tx / n, q[1] - tz / n) - Math.hypot(p[0] - tx / n, p[1] - tz / n))[0];
          if (e) { const dx = e[0] - site.x, dz = e[1] - site.z, L = Math.hypot(dx, dz) || 1; brain.flank = [e[0] + dx / L * 2.5, e[1] + dz / L * 2.5]; }
          else brain.flankDone = true;
        }
        if (brain.flank) {
          if (Math.hypot(brain.flank[0] - a.x, brain.flank[1] - a.z) < 2) brain.flankDone = true;
          else return { x: brain.flank[0], z: brain.flank[1], key: 'flank', push: t - brain.visAt > 3 };
        }
      }
      // lurker: hunts roamers away from the site until late in the round
      if (a.role === 'lurker' && !late) {
        const away = [...m.bb[a.team].seen.values()].filter((s) => t - s.t < 8 && Math.hypot(s.x - site.x, s.z - site.z) > 9).sort((p, q) => q.t - p.t)[0];
        if (away) return { x: away.x, z: away.z, key: 'lurk' + Math.round(away.x / 3) + ',' + Math.round(away.z / 3) };
        return this.roamGoal(brain, site, 'lurk');
      }
      return onSite;
    }
    // defenders
    if (b.state === 'planted') {
      // defuse when nobody has been seen for 2 s, else move up to the bomb
      const clear = t - brain.visAt > 2;
      if (clear && Math.hypot(b.x - a.x, b.z - a.z) < BOMB.defuseR - 0.2) {
        if (!a.hold) this.setHold(a, true);
        return { x: a.x, z: a.z, key: 'defuse', hold: true, r: 9, ignoreEnemies: !!a.hold };
      }
      return { x: b.x, z: b.z, key: 'tobomb', push: clear };
    }
    const site = brain.site || this.sites[0], late = this.phaseEnd - t < 55;
    const job = this.prepJob(brain, site);
    if (job) return job;
    // roamer: works the rooms away from the site, holding each spot a while; falls back late
    // (falls back when hurt or when two or more attackers have been seen near it)
    const crowd = [...m.bb[a.team].seen.values()].filter((s) => t - s.t < 6 && Math.hypot(s.x - a.x, s.z - a.z) < 14).length;
    if (a.role === 'roamer' && (a.hp < 60 || crowd >= 2)) brain.fellBack = true;
    if (a.role === 'roamer' && !late && !brain.fellBack) return this.roamGoal(brain, site, 'roam');
    // site control: holds one of the ways into the site
    if ((a.role === 'site control' || a.role === 'roamer') && site.entries && site.entries.length) {
      const e = site.entries[(brain.slot || 0) % site.entries.length], de = Math.hypot(e[0] - site.x, e[1] - site.z);
      // a spot on the site's side of the doorway, watching it
      // (back from the doorway: whoever comes through is seen alone, not a whole team outside)
      return this.post(brain, e[0], e[1], 3, 9, 'ctrl', true, (c) => Math.hypot(c[0] - site.x, c[1] - site.z) < de);
    }
    // anchor: on the site itself, watching the nearest way in
    const g = this.post(brain, site.x, site.z, 1, 6, 'hold', true);
    const E = site.entries || [];
    if (E.length) { const e = E.slice().sort((p, q) => Math.hypot(p[0] - g.x, p[1] - g.z) - Math.hypot(q[0] - g.x, q[1] - g.z))[0]; g.face = [e[0], e[1]]; }
    return g;
  }
  // Defender bots in prep (and the first seconds of the action): anchors and site control
  // reinforce the site room's soft walls and barricade its open doorways and windows (each
  // panel by one bot), then lay their wire just inside a way in. Returns a goal or null.
  prepJob(brain, site) {
    const m = this.m, a = brain.a, t = m.t;
    if (a.role === 'roamer' || a.hold || this.phase !== 'prep') return null;
    const room = (m.map.data.callouts || []).find((c) => c.floor && !c.y && site.x > c.x0 && site.x < c.x1 && site.z > c.z0 && site.z < c.z1);
    const inRoom = (b) => room ? (b.minX + b.maxX) / 2 > room.x0 - 0.7 && (b.minX + b.maxX) / 2 < room.x1 + 0.7 && (b.minZ + b.maxZ) / 2 > room.z0 - 0.7 && (b.minZ + b.maxZ) / 2 < room.z1 + 0.7 : Math.hypot((b.minX + b.maxX) / 2 - site.x, (b.minZ + b.maxZ) / 2 - site.z) < 9;
    if (brain.job && (t > brain.job.until || (brain.job.kind === 'soft' ? brain.job.pn.kind !== 'soft' || a.reinf <= 0 : brain.job.pn.alive))) { brain.jobsDone++; brain.job = null; }
    if (!brain.job && brain.jobsDone < 3) {
      // the nearest unclaimed panel of the site room that needs work, with a free spot on the room's side
      let best = null, bd = Infinity;
      for (const pn of m.map.panels) {
        const kind = pn.kind === 'soft' ? 'soft' : pn.kind === 'door' && !pn.alive ? 'slot' : null;
        if (!kind || (kind === 'soft' && a.reinf <= 0) || (pn.y0 || 0) > 0.5 || this.claimed.has(pn.i) || !inRoom(pn.box)) continue;
        const b = pn.box, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, n = pn.alongX ? [0, 1] : [1, 0];
        let spot = null;
        for (const s of [1, -1]) for (const k of [0.85, 1.15]) {
          const x = cx + n[0] * s * k, z = cz + n[1] * s * k;
          if (spot || !m.map.free(x, z, 0.33, 0) || (room && !(x > room.x0 && x < room.x1 && z > room.z0 && z < room.z1))) continue;
          const kp = this.keepIn(a, x, z);
          if (kp && kp[2]) continue;
          spot = [x, z];
        }
        if (!spot) continue;
        const d = Math.hypot(spot[0] - a.x, spot[1] - a.z) + (kind === 'slot' ? 3 : 0);
        if (d < bd) { bd = d; best = { pn, kind, spot, face: [cx, cz] }; }
      }
      if (best) { this.claimed.add(best.pn.i); best.until = t + 14; brain.job = best; }
    }
    const j = brain.job;
    if (j) {
      if (Math.hypot(j.spot[0] - a.x, j.spot[1] - a.z) < 0.45) {
        a.yaw = Math.atan2(j.face[0] - a.x, -(j.face[1] - a.z)) * 180 / Math.PI;
        if (!this.setHold(a, true, j.pn)) { brain.jobsDone++; brain.job = null; return null; }
      }
      return { x: j.spot[0], z: j.spot[1], key: 'job' + j.pn.i, hold: true, r: 0.4, face: j.face, ignoreEnemies: this.phase === 'prep' };
    }
    // then the wire: just inside one of the site's ways in, across it
    if (a.wire > 0 && !brain.wired && site.entries && site.entries.length) {
      // one of the site's ways in (a different one per bot) with a free spot just inside it
      const E = site.entries, n = E.length;
      let e = null, sx = 0, sz = 0;
      for (let i = 0; i < n && !e; i++) {
        const c = E[(a.id + (brain.slot || 0) + i) % n], dx = site.x - c[0], dz = site.z - c[1], L = Math.hypot(dx, dz) || 1;
        for (const k of [2.4, 1.8, 3.0]) { const x = c[0] + dx / L * k, z = c[1] + dz / L * k; if (m.map.free(x, z, 0.4, 0) && !m.ab.gadgets.some((g) => g.alive && g.type === 'wire' && Math.hypot(g.x - x, g.z - z) < 2.5)) { e = c; sx = x; sz = z; break; } }
      }
      if (!e) { brain.wired = true; return null; }
      if (Math.hypot(sx - a.x, sz - a.z) < 0.6) {
        a.yaw = Math.atan2(e[0] - a.x, -(e[1] - a.z)) * 180 / Math.PI; a.pitch = -35;
        m.ab.placeWire(a); brain.wired = true;
        return null;
      }
      return { x: sx, z: sz, key: 'wire' + e[0] + ',' + e[1], r: 0.5, face: [e[0], e[1]], ignoreEnemies: this.phase === 'prep' };
    }
    return null;
  }
  // The attackers' gathering point for a site: a cover spot 8-18 m from it, out of its sight,
  // nearest to where the attackers are when the action starts. Once a round.
  stackPoint(site) {
    if (this.stack && this.stack.site === site) return this.stack.p;
    const m = this.m, att = m.actors.filter((x) => x.alive && this.isAttacker(x));
    if (!att.length) return null;
    const cx = att.reduce((s, x) => s + x.x, 0) / att.length, cz = att.reduce((s, x) => s + x.z, 0) / att.length;
    const ok = m.map.data.cover.filter((q) => { const d = Math.hypot(q[0] - site.x, q[1] - site.z); return !(q[2] > 0.5) && d >= 8 && d <= 18 && !m.map.sight([q[0], 1.2, q[1]], [site.x, 1.2, site.z]); });
    ok.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cz) - Math.hypot(q[0] - cx, q[1] - cz));
    this.stack = { site, p: ok[0] || null };
    return this.stack.p;
  }
  // A spot away from the site (inside the building), held for a while, then the next.
  roamGoal(brain, site, key) {
    const m = this.m, a = brain.a;
    if (!brain.roam || m.t > brain.roamUntil) {
      const bb = m.map.data.building;
      const spots = m.map.data.cover.filter((c) => Math.hypot(c[0] - site.x, c[1] - site.z) > 11 && (!bb || (c[0] > bb[0] && c[0] < bb[2] && c[1] > bb[1] && c[1] < bb[3])));
      brain.roam = spots.length ? spots[Math.floor(m.rng() * spots.length)] : [site.x, site.z];
      brain.roamUntil = m.t + 14 + m.rng() * 10;
    }
    const r = brain.roam;
    // face away from the site (where attackers come from)
    return { x: r[0], z: r[1], key: key + r[0] + ',' + r[1], hold: true, r: 1.5, crouch: key === 'roam', face: [r[0] * 2 - site.x, r[1] * 2 - site.z] };
  }
  // A cover spot (authored in the map) between rmin and rmax of a point, held crouched.
  post(brain, x, z, rmin, rmax, key, crouch = false, ok = null) {
    const m = this.m;
    if (!brain.post || brain.postFor !== key + x + z || brain.postT < m.t) {
      const spots = m.map.data.cover.filter((c) => { const d = Math.hypot(c[0] - x, c[1] - z); return d >= rmin && d <= rmax && (!ok || ok(c)) && m.map.sight([c[0], 1.2, c[1]], [x, 1.2, z]); });
      brain.post = spots.length ? spots[Math.floor(m.rng() * spots.length)] : [x, z];
      brain.postFor = key + x + z; brain.postT = m.t + 25;
    }
    return { x: brain.post[0], z: brain.post[1], key: key + brain.post[0] + ',' + brain.post[1], hold: true, r: 1.5, crouch, face: [x, z] };
  }
  /* HUD */
  markers(me) {
    const out = this.sites.map((s) => ({ key: 'site' + s.name, shape: 'site', x: s.x, z: s.z, r: s.r, label: s.name, color: 0xffc040, compass: 'Site ' + s.name }));
    const b = this.bomb;
    if (b.state === 'dropped' || b.state === 'planted') out.push({ key: 'bomb', shape: 'bomb', x: b.x, z: b.z, color: 0xff3020, compass: b.state === 'planted' ? 'BOMB' : 'Bomb' });
    else if (b.state === 'carried' && b.carrier && this.isAttacker(me) && b.carrier !== me) out.push({ key: 'bombc', shape: 'none', show: false, x: b.carrier.x, z: b.carrier.z, color: 0xff3020, compass: 'Bomb' });
    return out;
  }
  scoreText(team) { return 'Round ' + this.round + ' · you ' + this.score[team] + ' : ' + this.score[team === 'A' ? 'B' : 'A'] + ' enemy · ' + (this.sideOf(team) === 'attack' ? 'ATTACK' : 'DEFEND'); }
  timerText() {
    const s = this.timeLeft();
    const label = this.phase === 'prep' ? 'Prep ' : this.bomb.state === 'planted' ? 'Bomb ' : this.phase === 'post' ? 'Next round ' : '';
    return label + Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }
  statusText(me) {
    const m = this.m, b = this.bomb, at = this.attackTeam();
    const alive = (team) => m.actors.filter((a) => a.team === team && a.alive).length + '/' + m.actors.filter((a) => a.team === team).length;
    let st = 'Alive: you ' + alive(me.team) + ' · enemy ' + alive(me.team === 'A' ? 'B' : 'A');
    if (b.state === 'carried' && me.team === at) st += ' · bomb: ' + (b.carrier === me ? 'YOU (hold E on a site)' : b.carrier.name);
    if (b.state === 'dropped') st += ' · bomb dropped';
    if (b.state === 'planted') st += ' · bomb planted at ' + b.site.name + (me.team !== at ? ' (hold E beside it)' : '');
    if (me.team !== at && me.alive && b.state !== 'planted' && this.phase !== 'post') st += ' · hold E at a soft wall to reinforce (' + (me.reinf || 0) + ' left), in an open doorway to barricade';
    if (this.phase === 'prep') st += me.team === at ? ' · preparation: scout with drones' : ' · preparation: set your gadgets';
    return st;
  }
  deadText(me) { return 'You are down · spectating (click: next) · next round soon'; }
  endText() { return 'Rounds ' + this.score.A + ' : ' + this.score.B + '. ' + this.rounds.map((r) => 'R' + r.round + ' ' + r.reason).join(', ') + '.'; }
  summary() { return this.m.winner + ' ' + this.score.A + '-' + this.score.B + ' [' + this.rounds.map((r) => r.reason[0]).join('') + ']'; }
}
