// Frag grenades in Battle (Caps Lock or G): two a life, the same rules as the match modes
// (2.5 s fuse, bounces, up to 130 damage, lethal within 1.8 m, nothing behind cover), on the
// Battle maps' floors, stairs and upper levels. They never hurt the thrower's own team.
// Bots lob one at an enemy they lost sight of a moment ago.
import * as THREE from '../../vendor/three/three.module.min.js?v=bomb-audio-2';

export const NADE = { count: 2, fuse: 2.5, speed: 15, radius: 6, lethal: 1.8, damage: 130, gravity: 9.8, every: 1.0 };

export class BattleNades {
  constructor(battle) { this.b = battle; this.live = []; this._hit = { t: 0, n: [0, 0, 0] }; }
  reset() { for (const n of this.live) n.mesh.removeFromParent(); this.live = []; }
  refill(f) { f.nades = NADE.count; f.nadeAt = 0; }

  throw(f, yaw, pitch, t, speed = NADE.speed) {
    if (!f.alive || (f.nades ?? NADE.count) <= 0 || t < (f.nadeAt || 0)) return null;
    if (f.nades === undefined) f.nades = NADE.count;
    f.nades--; f.nadeAt = t + NADE.every;
    if (t < f.protectUntil) f.protectUntil = t;
    const y = yaw * Math.PI / 180, p = (pitch + 4) * Math.PI / 180, cp = Math.cos(p);
    const d = [Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp];
    const ey = f.y + 1.6 - 0.45 * (f.crouch || 0);
    const n = { f, x: f.x + d[0] * 0.5, y: ey - 0.15, z: f.z + d[2] * 0.5, vx: d[0] * speed + (f.vx || 0) * 0.5, vy: d[1] * speed, vz: d[2] * speed + (f.vz || 0) * 0.5, end: t + NADE.fuse };
    n.mesh = this._mesh();
    this.b.arena.scene.add(n.mesh);
    this.live.push(n);
    this.b._noise(f, 'nade', 10, t);
    return n;
  }
  _mesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3a4a2a }));
    body.scale.y = 1.25;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff3020, toneMapped: false }));
    led.position.set(0.05, 0.03, 0);
    g.add(body, led); g.userData.led = led;
    return g;
  }

  update(dt, t) {
    for (const n of this.live) {
      if (t >= n.end) { n.done = true; this.explode(n, t); continue; }
      if (dt > 0) this._move(n, dt);
      n.mesh.position.set(n.x, n.y, n.z); n.mesh.rotation.set(t * 9, t * 5, 0);
      n.mesh.userData.led.visible = Math.floor(t * (n.end - t < 1 ? 12 : 4)) % 2 === 0;
    }
    for (const n of this.live) if (n.done) { n.mesh.removeFromParent(); n.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    this.live = this.live.filter((n) => !n.done);
  }
  _move(n, dt) {
    const A = this.b.arena, H = this._hit;
    n.vy -= NADE.gravity * dt;
    let rem = dt;
    for (let k = 0; k < 3 && rem > 0; k++) {
      const sp = Math.hypot(n.vx, n.vy, n.vz);
      if (sp < 1e-4) break;
      const d = [n.vx / sp, n.vy / sp, n.vz / sp], step = sp * rem;
      const tt = A.raycast([n.x, n.y, n.z], d, step + 0.06, H);
      if (tt === Infinity || H.t > step) { n.x += n.vx * rem; n.y += n.vy * rem; n.z += n.vz * rem; break; }
      const go = Math.max(0, H.t - 0.06);
      n.x += d[0] * go; n.y += d[1] * go; n.z += d[2] * go;
      rem -= go / sp;
      const [nx, ny, nz] = H.n;
      // reflect on the face (bouncy off walls, soft on floors)
      const dot = n.vx * nx + n.vy * ny + n.vz * nz;
      n.vx -= 2 * dot * nx; n.vy -= 2 * dot * ny; n.vz -= 2 * dot * nz;
      if (ny > 0.5) { n.vy *= 0.35; n.vx *= 0.65; n.vz *= 0.65; if (n.vy < 0.6) n.vy = 0; } else { n.vx *= 0.45; n.vz *= 0.45; n.vy *= 0.8; }
    }
    // resting on whatever is under it
    const g = A.groundAt(n.x, n.z, n.y + 0.05) + 0.06;
    if (n.y <= g && n.vy <= 0) { n.y = g; n.vy = 0; const fr = Math.max(0, 1 - 4 * dt); n.vx *= fr; n.vz *= fr; }
  }
  explode(n, t) {
    const B = this.b, A = B.arena, p = [n.x, n.y + 0.2, n.z], by = n.f;
    for (const g of B.fighters) {
      if (!g.alive || g.team === by.team) continue;
      const chest = [g.x, g.y + 1.0 - 0.3 * (g.crouch || 0), g.z], d = Math.hypot(chest[0] - p[0], chest[1] - p[1], chest[2] - p[2]);
      if (d > NADE.radius) continue;
      if (!A.sightLine(p, chest) && !A.sightLine(p, [g.x, g.y + 1.6, g.z])) continue;
      const dmg = d < NADE.lethal ? 300 : NADE.damage * Math.pow(1 - (d - NADE.lethal) / (NADE.radius - NADE.lethal), 1.4);
      if (dmg > 1) B._damage(g, dmg, by, 'torso', t);
    }
    B._noise(by, 'blast', 40, t);
    B._blast(n.x, n.y, n.z, t);
  }

  // A bot that lost sight of an enemy 1-4 s ago, 7-20 m away, lobs one there now and then.
  botThink(bot, t) {
    const f = bot.f, s = bot.lastSeen;
    if (!f.alive || (f.nades ?? NADE.count) <= 0 || t < (bot.nadeT || 0) || !s) return;
    bot.nadeT = t + 2 + Math.random() * 2;
    const age = t - s.t, dx = s.x - f.x, dz = s.z - f.z, d = Math.hypot(dx, dz);
    if (age < 0.6 || age > 6 || d < 5 || d > 24 || (bot.target && t - bot.seenAt < 0.5) || Math.random() > 0.4) return;
    if (this.b.fighters.some((q) => q !== f && q.alive && q.team === f.team && Math.hypot(q.x - s.x, q.z - s.z) < NADE.radius)) return;
    const ang = 35 * Math.PI / 180, h = (f.y + 1.45) - ((s.y || 0) + 0.2);
    const v = Math.sqrt(NADE.gravity * d * d / Math.max(0.1, 2 * Math.cos(ang) ** 2 * (d * Math.tan(ang) + h)));
    const yaw = Math.atan2(dx, -dz) * 180 / Math.PI;
    if (this.throw(f, yaw + (Math.random() - 0.5) * 6, 31 + (Math.random() - 0.5) * 4, t, Math.min(20, v))) bot.nadeT = t + 12;
  }
}
