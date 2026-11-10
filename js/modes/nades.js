// Frag grenades (Caps Lock or G): everyone carries two a life (a round in Bomb). Thrown along
// your aim, they bounce off walls and the floor and go off 2.5 s after the throw: up to 130
// damage, lethal within 1.8 m, nothing behind solid cover. They break soft walls and boarded
// doors close by and destroy gadgets. A Catcher zaps them out of the air.
// Bots throw at enemies they know are behind cover, using a lob that lands on the spot.
import { dirFrom } from './geom.js?v=5cafaa1-mwb62ceu';

export const NADE = { count: 2, fuse: 2.5, speed: 15, radius: 6, lethal: 1.8, damage: 130, gravity: 9.8, wallBreak: 1.4, every: 1.0 };

export class Nades {
  constructor(m) { this.m = m; this.live = []; this.nextId = 1; }
  refill(a) { a.nades = NADE.count; a.nadeAt = 0; }
  clear() { this.live = []; }

  // Throw from a's eye along (yaw, pitch) at speed. Returns the grenade or null.
  throw(a, yaw = a.yaw, pitch = a.pitch, speed = NADE.speed) {
    const m = this.m;
    // Bomb defenders carry barbed wire instead
    if (m.rules.name === 'Bomb' && !m.rules.isAttacker(a)) return m.ab.placeWire(a);
    if (!a.alive || m.over || (a.nades ?? NADE.count) <= 0 || m.t < (a.nadeAt || 0) || m.rules.frozen(a) || m.rules.noFire(a) || (a.ab && a.ab.busy)) return null;
    if (a.nades === undefined) a.nades = NADE.count;
    a.nades--; a.nadeAt = m.t + NADE.every;
    if (m.t < a.protectUntil) a.protectUntil = m.t;
    const d = dirFrom(yaw, pitch + 4), o = m.eye(a);
    const n = { id: this.nextId++, team: a.team, owner: a.id, x: o[0] + d[0] * 0.5, y: o[1] - 0.15, z: o[2] + d[2] * 0.5, vx: d[0] * speed + a.vx * 0.5, vy: d[1] * speed, vz: d[2] * speed + a.vz * 0.5, end: m.t + NADE.fuse, alive: true };
    this.live.push(n);
    m.noise(a, 10, 'nade');
    m.emit({ type: 'nadeThrow', id: a.id, nade: n.id });
    return n;
  }

  update(dt) {
    const m = this.m, t = m.t;
    for (const n of this.live) {
      if (!n.alive) continue;
      // a Catcher in reach zaps it
      const C = m.ab.cfg.catcher || {};
      const cat = m.ab.gadgets.find((g) => g.type === 'catcher' && g.team !== n.team && !m.ab.off(g) && t >= g.readyAt && Math.hypot(g.x - n.x, g.y - n.y, g.z - n.z) < (C.radius || 5));
      if (cat) { n.alive = false; cat.readyAt = t + (C.recharge || 10); m.emit({ type: 'caught', x: n.x, y: n.y, z: n.z, cx: cat.x, cy: cat.y, cz: cat.z }); continue; }
      if (t >= n.end) { n.alive = false; this.explode(n); continue; }
      this.move(n, dt);
    }
    this.live = this.live.filter((n) => n.alive);
  }
  // One step of flight: gravity, then bounce off whatever is in the way.
  move(n, dt) {
    const map = this.m.map;
    n.vy -= NADE.gravity * dt;
    let rem = dt;
    for (let k = 0; k < 3 && rem > 0; k++) {
      const sp = Math.hypot(n.vx, n.vy, n.vz);
      if (sp < 1e-4) break;
      const d = [n.vx / sp, n.vy / sp, n.vz / sp], step = sp * rem, o = [n.x, n.y, n.z];
      const hit = map.raycast(o, d, step + 0.06);
      if (!hit || hit.t > step) { n.x += n.vx * rem; n.y += n.vy * rem; n.z += n.vz * rem; break; }
      const tt = Math.max(0, hit.t - 0.06);
      n.x += d[0] * tt; n.y += d[1] * tt; n.z += d[2] * tt;
      rem -= tt / sp;
      if (hit.box.ceiling) { n.vy = -Math.abs(n.vy) * 0.35; n.vx *= 0.8; n.vz *= 0.8; }
      else if (hit.box.ground) { n.vy = Math.abs(n.vy) * 0.35; n.vx *= 0.65; n.vz *= 0.65; if (n.vy < 0.6) n.vy = 0; n.y = Math.max(n.y, 0.06); }
      else {
        // which face: the axis the hit point is closest to the box's surface on
        const b = hit.box, px = n.x + d[0] * 0.06, py = n.y + d[1] * 0.06, pz = n.z + d[2] * 0.06;
        const dxs = Math.min(Math.abs(px - b.minX), Math.abs(px - b.maxX)), dys = Math.min(Math.abs(py - b.minY), Math.abs(py - b.maxY)), dzs = Math.min(Math.abs(pz - b.minZ), Math.abs(pz - b.maxZ));
        if (dys <= dxs && dys <= dzs) { n.vy = -n.vy * 0.35; if (Math.abs(n.vy) < 0.6) n.vy = 0; } else if (dxs < dzs) n.vx = -n.vx * 0.45; else n.vz = -n.vz * 0.45;
        n.vx *= 0.8; n.vy *= 0.8; n.vz *= 0.8;
      }
    }
    // resting on whatever is under it (the floor, a stair, an upper floor): rolling to a stop
    const g = map.groundAt(n.x, n.z, n.y + 0.05, true) + 0.06;
    if (n.y <= g && n.vy <= 0) { n.y = g; n.vy = 0; const f = Math.max(0, 1 - 4 * dt); n.vx *= f; n.vz *= f; }
  }
  explode(n) {
    const m = this.m, owner = m.actors.find((a) => a.id === n.owner), p = [n.x, Math.max(0.15, n.y), n.z];
    for (const e of m.actors) {
      if (!e.alive) continue;
      const chest = [e.x, e.y + 1.0 - 0.3 * e.crouch, e.z], d = Math.hypot(chest[0] - p[0], chest[1] - p[1], chest[2] - p[2]);
      if (d > NADE.radius) continue;
      if (!m.map.sight([p[0], p[1] + 0.2, p[2]], chest) && !m.map.sight([p[0], p[1] + 0.2, p[2]], [e.x, e.y + 1.6, e.z])) continue;   // behind cover
      const dmg = d < NADE.lethal ? 300 : NADE.damage * Math.pow(1 - (d - NADE.lethal) / (NADE.radius - NADE.lethal), 1.4);
      if (dmg > 1) m.hit(e, dmg, owner, 'torso', 'nade');
      if (e.alive && e.human) e.shakeUntil = Math.max(e.shakeUntil || 0, m.t + 0.6);
    }
    m.map.breakAt(p, NADE.wallBreak);
    for (const g of m.ab.gadgets) if (g.alive && Math.hypot(g.x - p[0], g.z - p[2], g.y - p[1]) < 3) m.ab.destroy(g, owner);
    if (owner) m.noise(owner, 40, 'blast');
    m.emit({ type: 'boom', x: p[0], y: p[1], z: p[2], nade: true });
  }

  /* ---------- bots ---------- */
  // Throw at a known enemy spot 7-22 m away that the bot cannot see right now (behind cover),
  // or at a few enemies bunched up; not near teammates. A lob that lands on the spot.
  botThink(brain) {
    const m = this.m, a = brain.a, t = m.t;
    if (!a.alive || (a.nades ?? NADE.count) <= 0 || t < (brain.nadeT || 0) || m.rules.noFire(a) || m.rules.frozen(a)) return;
    brain.nadeT = t + 2.5 + m.rng() * 2.5;
    const spots = [...m.bb[a.team].seen.values()].filter((s) => t - s.t < 3);
    if (!spots.length) return;
    let best = null, score = 0;
    for (const s of spots) {
      const d = Math.hypot(s.x - a.x, s.z - a.z);
      if (d < 7 || d > 22) continue;
      if (m.actors.some((q) => q.alive && q.team === a.team && Math.hypot(q.x - s.x, q.z - s.z) < NADE.radius)) continue;
      const hidden = !m.map.sight(m.eye(a), [s.x, (s.y || 0) + 1.2, s.z]);
      const crowd = spots.filter((q) => Math.hypot(q.x - s.x, q.z - s.z) < 4).length;
      const sc = (hidden ? 1 : 0.2) + (crowd - 1) * 0.8 + (m.rules.bomb && m.rules.bomb.state === 'planted' ? 0.5 : 0);
      if (sc > score) { score = sc; best = s; }
    }
    if (!best || score < 0.9 || m.rng() > 0.3) return;
    brain.nadeT = t + 12;
    // a 35 degree lob (or flatter, through a doorway, when the spot is in sight)
    const dx = best.x - a.x, dz = best.z - a.z, d = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, -dz) * 180 / Math.PI;
    const ang = 35 * Math.PI / 180, h = (m.eye(a)[1] - 0.15) - ((best.y || 0) + 0.2);
    const v = Math.sqrt(NADE.gravity * d * d / Math.max(0.1, 2 * Math.cos(ang) ** 2 * (d * Math.tan(ang) + h)));
    // the throw adds 4 degrees; spread like a person's throw
    if (this.throw(a, yaw + m.gauss() * 3, 35 - 4 + m.gauss() * 2, Math.min(20, v * (1 + m.gauss() * 0.05)))) a.yaw = yaw;
  }
  // Is a live grenade close to a (a bot runs from it)? Returns it or null.
  near(a, r = 5) { return this.live.find((n) => Math.hypot(n.x - a.x, n.z - a.z) < r && Math.abs(n.y - a.y) < 2.5 && this.m.t > n.end - NADE.fuse + 0.3) || null; }
}
