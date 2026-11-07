// Mode rules: Team Deathmatch, Capture the Flag, Bomb. Each sets up the match, spawns,
// scores, ends it, and gives bots their objective (botGoal).
export function makeRules(m) {
  const mode = m.o.mode;
  if (mode === 'tdm') return new TDM(m);
  if (mode === 'ctf') return new CTF(m);
  if (mode === 'bomb' && typeof Bomb !== 'undefined') return new Bomb(m);
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
