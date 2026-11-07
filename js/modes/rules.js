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
    for (const team of ['A', 'B']) this.flags[team] = { team, state: 'home', x: st[team][0], z: st[team][1], stand: st[team], carrier: null, returnAt: 0 };
    this.nextRoles = 0;
    this.group = {};
  }
  other(team) { return team === 'A' ? 'B' : 'A'; }
  flagHome(f) { f.state = 'home'; f.x = f.stand[0]; f.z = f.stand[1]; f.carrier = null; f.returnAt = 0; }
  update(dt) {
    super.update(dt);
    const m = this.m, t = m.t;
    for (const team of ['A', 'B']) {
      const f = this.flags[team];
      if (f.state === 'carried') {
        const c = f.carrier;
        if (!c || !c.alive) this.drop(f, c);
        else { f.x = c.x; f.z = c.z; }
      } else if (f.state === 'dropped' && t >= f.returnAt) {
        this.flagHome(f);
        m.emit({ type: 'msg', text: (team === 'A' ? 'Blue' : 'Orange') + ' flag returned', team, flag: 'return' });
      }
    }
    for (const a of m.actors) {
      if (!a.alive) continue;
      const enemy = this.flags[this.other(a.team)], own = this.flags[a.team];
      // pick up the enemy flag
      if (!a.carry && (enemy.state === 'home' || enemy.state === 'dropped') && Math.hypot(enemy.x - a.x, enemy.z - a.z) < TOUCH) {
        enemy.state = 'carried'; enemy.carrier = a; enemy.returnAt = 0;
        a.carry = { type: 'flag', team: enemy.team };
        m.emit({ type: 'msg', text: (a.human ? 'You have' : a.name + ' has') + ' the ' + (enemy.team === 'A' ? 'blue' : 'orange') + ' flag', team: a.team, flag: 'take', id: a.id });
        this.nextRoles = 0;
      }
      // return our dropped flag by touching it
      if (own.state === 'dropped' && Math.hypot(own.x - a.x, own.z - a.z) < TOUCH) {
        this.flagHome(own);
        m.emit({ type: 'msg', text: (a.human ? 'You returned' : a.name + ' returned') + ' the ' + (own.team === 'A' ? 'blue' : 'orange') + ' flag', team: a.team, flag: 'return' });
        this.nextRoles = 0;
      }
      // capture
      if (a.carry && a.carry.type === 'flag' && own.state === 'home' && Math.hypot(own.stand[0] - a.x, own.stand[1] - a.z) < CAPTURE_R) {
        const f = this.flags[a.carry.team];
        this.flagHome(f); a.carry = null;
        this.score[a.team]++;
        m.emit({ type: 'msg', text: (a.human ? 'You captured' : a.name + ' captured') + ' the flag!', team: a.team, flag: 'capture', id: a.id });
        this.nextRoles = 0;
      }
    }
    if (t >= this.nextRoles) this.roles();
  }
  drop(f, c) {
    f.state = 'dropped'; f.carrier = null; f.returnAt = this.m.t + RETURN_S;
    if (c) { f.x = c.x; f.z = c.z; c.carry = null; }
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
        if (via) return { x: via[0], z: via[1], key: 'carryvia', must: true, push: true };
        return { x: own.stand[0], z: own.stand[1], key: 'carry', must: true, push: true };
      }
      case 'steal': {
        const via = this.via(brain, [enemy.x, enemy.z]);
        if (via) return { x: via[0], z: via[1], key: 'via' + via[1], push: true };
        const g = this.group[a.team];
        if (g && g.until && !g.go && g.stage) return { x: g.stage[0], z: g.stage[1], key: 'stage', hold: true, r: 4, face: [enemy.x, enemy.z] };
        return { x: enemy.x, z: enemy.z, key: 'steal' + enemy.state + Math.round(enemy.x) + ',' + Math.round(enemy.z), push: true };
      }
      case 'hunt': return null;
      case 'escort': { const c = enemy.carrier; return c ? { x: c.x - 1.5, z: c.z, key: 'escort' + Math.round(c.x / 3) + ',' + Math.round(c.z / 3), push: true } : null; }
      case 'chase': return { x: own.x, z: own.z, key: 'chase' + Math.round(own.x / 3) + ',' + Math.round(own.z / 3) };
      case 'recover': return { x: own.x, z: own.z, key: 'recover', push: true };
      default: {
        // hold near our stand at a cover spot
        if (!brain.post || brain.postT < this.m.t) {
          const spots = this.m.map.data.cover.filter((c) => { const d = Math.hypot(c[0] - own.stand[0], c[1] - own.stand[1]); return d > 5 && d < 14; });
          brain.post = spots.length ? spots[Math.floor(this.m.rng() * spots.length)] : own.stand;
          brain.postT = this.m.t + 20;
        }
        return { x: brain.post[0], z: brain.post[1], key: 'post' + brain.post[0] + ',' + brain.post[1], hold: true, r: 1.5, face: [enemy.stand[0], enemy.stand[1]] };
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
    const k = map.nearestNode(Math.sign(to[0]) * 11, brain.lane * hz * 0.68, false);
    if (k < 0) { brain.viaDone = true; return null; }
    const n = map.nodes[k];
    if (Math.hypot(n[0] - a.x, n[1] - a.z) < 2.5) { brain.viaDone = true; return null; }
    return n;
  }
  // For the HUD: flags, stands and compass markers.
  markers(me) {
    const out = [];
    for (const team of ['A', 'B']) {
      const f = this.flags[team], col = team === 'A' ? 0x5b8cff : 0xff7048, ours = team === me.team;
      out.push({ key: 'stand' + team, shape: 'stand', x: f.stand[0], z: f.stand[1], color: col });
      out.push({ key: 'flag' + team, shape: 'flag', x: f.x, z: f.z, y: f.state === 'carried' ? 0.6 : 0, color: col, show: !(f.state === 'carried' && f.carrier === me), compass: ours ? 'Our flag' : 'Enemy flag' });
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
// wait at their spawn and scout with drones), action 150 s, then 5 s of round summary.
// An attacker carries the bomb: hold E for 5 s inside a site to plant; it goes off after
// 40 s; defenders hold E for 6 s beside it to defuse. Holding stops you moving; damage cancels.
// A round ends when one team is all dead (after a plant, the defenders must still defuse),
// the bomb goes off (attackers win), it is defused (defenders win), or the time runs out with
// no plant (defenders win). If the carrier dies the bomb drops; any attacker can pick it up.
export const BOMB = { prep: 30, action: 150, plant: 5, fuse: 40, defuse: 6, summary: 5, wins: 4, swapAfter: 3, pickup: 1.2, defuseR: 1.6 };
export class Bomb extends Rules {
  constructor(m) {
    super(m);
    this.name = 'Bomb'; this.usesE = true;
    this.round = 0; this.rounds = []; this.phase = 'prep'; this.phaseEnd = 0;
    this.firstAttack = (m.o.human && m.o.human.side === 'defend') ? 'B' : 'A';   // your team is A
    this.bomb = { state: 'none', x: 0, z: 0, carrier: null, site: null, fuseEnd: 0 };
    this.sites = m.map.data.sites;
  }
  attackTeam() { return this.round > BOMB.swapAfter ? (this.firstAttack === 'A' ? 'B' : 'A') : this.firstAttack; }
  sideOf(team) { return team === (this.round > BOMB.swapAfter ? (this.firstAttack === 'A' ? 'B' : 'A') : this.firstAttack) ? 'attack' : 'defend'; }
  isAttacker(a) { return a.team === this.attackTeam(); }
  spawnList(team) { return this.m.map.data.spawns[this.sideOf(team) === 'attack' ? 'A' : 'B']; }
  start() { this.newRound(); }
  newRound() {
    const m = this.m;
    this.round++;
    // after round 3 the sides swap: everyone takes the matching op of the other side
    if (this.round === BOMB.swapAfter + 1) {
      const O = m.o.ops;
      for (const a of m.actors) {
        const from = O.attackers.findIndex((o) => o.id === a.op.id), to = from >= 0 ? O.defenders[from] : O.attackers[O.defenders.findIndex((o) => o.id === a.op.id)];
        if (!to) continue;
        a.op = to; if (!a.human) a.name = to.name;
        const g = m.gunsById.get(to.gun);
        a.gunData = g; a.gun = Object.assign(a.gun, { ...m.constructor.gunStatsOf(g) });
        m.ab.init(a);
      }
      m.emit({ type: 'swap' });
      m.emit({ type: 'msg', text: 'Sides swapped' });
    }
    this.phase = 'prep'; this.phaseEnd = m.t + BOMB.prep;
    this.bomb = { state: 'none', x: 0, z: 0, carrier: null, site: null, fuseEnd: 0 };
    m.ab.clearAll(); m.map.resetPanels();
    this.target = this.sites[Math.floor(m.rng() * this.sites.length)];
    for (const a of m.actors) { m.spawn(a, this.spawnList(a.team), 0, 2.5); a.respawnAt = 0; m.ab.refill(a); if (a.brain) a.brain.post = null; }
    // the bomb goes to a random attacker (a bot, unless you are the only one)
    const att = m.actors.filter((a) => this.isAttacker(a));
    const carrier = att.filter((a) => !a.human)[Math.floor(m.rng() * Math.max(1, att.length - 1))] || att[0];
    this.give(carrier);
    // defenders split between the sites
    const def = m.actors.filter((a) => !this.isAttacker(a) && a.brain);
    def.forEach((a, i) => { a.brain.site = this.sites[i % this.sites.length]; });
    m.emit({ type: 'round', round: this.round, attack: this.attackTeam() });
    m.emit({ type: 'msg', text: 'Round ' + this.round + ': ' + (this.attackTeam() === (m.human() ? m.human().team : 'A') ? 'attack' : 'defend') });
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
  // Start or stop holding E (plant or defuse). Returns true if a hold started.
  setHold(a, on) {
    const m = this.m, b = this.bomb;
    if (!on) { if (a.hold) { a.hold = null; } return false; }
    if (!a.alive || a.hold || this.phase === 'post' || this.phase === 'prep') return false;
    if (this.isAttacker(a) && b.state === 'carried' && b.carrier === a && this.inSite(a.x, a.z)) {
      a.hold = { type: 'plant', t0: m.t, need: BOMB.plant, label: 'Planting' }; return true;
    }
    if (!this.isAttacker(a) && b.state === 'planted' && Math.hypot(b.x - a.x, b.z - a.z) < BOMB.defuseR) {
      a.hold = { type: 'defuse', t0: m.t, need: BOMB.defuse, label: 'Defusing' }; return true;
    }
    return false;
  }
  key(me, code, down) { if (code !== 'KeyE') return false; this.setHold(me, down); return true; }
  update() {
    const m = this.m, t = m.t, b = this.bomb;
    if (this.phase === 'prep' && t >= this.phaseEnd) { this.phase = 'action'; this.phaseEnd = t + BOMB.action; m.emit({ type: 'msg', text: 'Action phase' }); }
    if (this.phase === 'post') { if (t >= this.phaseEnd) { if (!m.over) this.newRound(); } return; }
    // the bomb
    if (b.state === 'carried') {
      const c = b.carrier;
      if (!c || !c.alive) { b.state = 'dropped'; b.carrier = null; if (c) { b.x = c.x; b.z = c.z; c.carry = null; } m.emit({ type: 'msg', text: 'The bomb was dropped' }); }
      else { b.x = c.x; b.z = c.z; }
    } else if (b.state === 'dropped') {
      for (const a of m.actors) if (a.alive && this.isAttacker(a) && !a.carry && Math.hypot(a.x - b.x, a.z - b.z) < BOMB.pickup) { this.give(a); m.emit({ type: 'msg', text: (a.human ? 'You have' : a.name + ' has') + ' the bomb' }); break; }
    }
    // holds
    for (const a of m.actors) {
      const h = a.hold;
      if (!h) continue;
      if (!a.alive) { a.hold = null; continue; }
      if (h.type === 'plant' && !(b.state === 'carried' && b.carrier === a && this.inSite(a.x, a.z))) { a.hold = null; continue; }
      if (h.type === 'defuse' && !(b.state === 'planted' && Math.hypot(b.x - a.x, b.z - a.z) < BOMB.defuseR)) { a.hold = null; continue; }
      if (t - h.t0 >= h.need) {
        a.hold = null;
        if (h.type === 'plant') {
          b.state = 'planted'; b.carrier = null; a.carry = null; b.x = a.x; b.z = a.z; b.site = this.inSite(a.x, a.z); b.fuseEnd = t + BOMB.fuse;
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
    m.emit({ type: 'boom', x: b.x, z: b.z });
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
    m.emit({ type: 'msg', text: (me ? (team === me.team ? 'Round won' : 'Round lost') : 'Team ' + team + ' wins the round') + ': ' + words[reason] });
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
      // escorts: go to the site, a little behind the carrier
      const c = b.carrier;
      if (c && c !== a && !(c.brain && c.brain.staging) && Math.hypot(c.x - site.x, c.z - site.z) > 6) return { x: c.x + (a.id % 3 - 1) * 2, z: c.z + (a.id % 2 ? -2 : 2), key: 'escort' + Math.round(c.x / 4) + ',' + Math.round(c.z / 4), push: true };
      return { x: site.x + (a.id % 3 - 1) * 2.5, z: site.z + (a.id % 2 ? -2.5 : 2.5), key: 'site' + site.name + a.id, push: true };
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
    // rotate on noise: heard or seen attackers near the other site
    const site = brain.site || this.sites[0];
    const seen = [...m.bb[a.team].seen.values()].filter((s) => t - s.t < 5);
    // (slowly, and one site is never left empty)
    for (const s of seen) {
      const other = this.sites.find((q) => q !== site && Math.hypot(q.x - s.x, q.z - s.z) < 10);
      if (!other || m.rng() > 0.02) continue;
      const left = m.actors.filter((x) => x.alive && x !== a && !this.isAttacker(x) && x.brain && x.brain.site === site).length;
      if (left >= 1) { brain.site = other; brain.post = null; }
      break;
    }
    return this.post(brain, site.x, site.z, 1, 7, 'hold', true);
  }
  // A cover spot (authored in the map) between rmin and rmax of a point, held crouched.
  post(brain, x, z, rmin, rmax, key, crouch = false) {
    const m = this.m;
    if (!brain.post || brain.postFor !== key + x + z || brain.postT < m.t) {
      const spots = m.map.data.cover.filter((c) => { const d = Math.hypot(c[0] - x, c[1] - z); return d >= rmin && d <= rmax && m.map.sight([c[0], 1.2, c[1]], [x, 1.2, z]); });
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
    if (this.phase === 'prep') st += me.team === at ? ' · preparation: scout with drones' : ' · preparation: set your gadgets';
    return st;
  }
  deadText(me) { return 'You are down · spectating (click: next) · next round soon'; }
  endText() { return 'Rounds ' + this.score.A + ' : ' + this.score.B + '. ' + this.rounds.map((r) => 'R' + r.round + ' ' + r.reason).join(', ') + '.'; }
  summary() { return this.m.winner + ' ' + this.score.A + '-' + this.score.B + ' [' + this.rounds.map((r) => r.reason[0]).join('') + ']'; }
}
