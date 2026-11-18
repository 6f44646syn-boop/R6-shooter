import * as THREE from '../../vendor/three/three.module.min.js?v=3d9ae50-mwm0jy5q';
import { ROYALE_BOTS } from './royale-map.js?v=3d9ae50-mwm0jy5q';
import { PLATFORM_HALF, PLATFORM_MASK, RAMP_RISE, platformHeight, platformMeshes, platformSolids, rampSurface } from './royale-platform.js?v=3d9ae50-mwm0jy5q';

const TOKEN_CHANCE = 0.001;
const CHEST_MATERIALS = 18;
const WALL_HP = 130;
const WALL_HEIGHT = 2.7;
const CELL = PLATFORM_HALF * 2;        // the build grid (3.2 m): every piece sits on it, so pieces line up
const cellMid = (v) => (Math.floor(v / CELL) + 0.5) * CELL;
const GRID = 3;
const FULL_WALL = (1 << GRID ** 2) - 1;
const PIECES = ['wall', 'ramp', 'cone'];
const MAX_RAMPS = 10;
const UNDER_PITCH = 45;                 // looking down this far (degrees) puts a ramp under your feet
const RAISE_PITCH = 35;                 // looking up this far puts a wall one level higher (on what is below it)
const grow = (b, m = .06) => ({ minX:b.minX-m, maxX:b.maxX+m, minY:b.minY-m, maxY:b.maxY+m, minZ:b.minZ-m, maxZ:b.maxZ+m });
const HOLD_GAP = .12, TURBO_GAP = .05;   // seconds between pieces while fire is held (turbo building: faster)
// The drop: everyone starts this high over their spawn and parachutes down (steer with W A S D),
// protected while gliding and for a few seconds after landing (shooting ends it, as at any spawn).
const DROP_H = 55, GLIDE = 5.5, LAND_PROTECT = 5;
const CHUTE_COLORS = [0xe8553e, 0xf2c14e, 0x4fa3e0, 0x63c26b, 0xb46ad8, 0xf28c38];
const EDIT_PRESETS = {
  wall: [
    ['Door', FULL_WALL ^ 18], ['Window', FULL_WALL ^ 16], ['Side opening', FULL_WALL ^ 36], ['Low wall', 63],
  ],
  ramp: [
    ['Left half', 5], ['Right half', 10], ['Reverse', PLATFORM_MASK, 2], ['Full ramp', PLATFORM_MASK],
  ],
  cone: [
    ['Front half', 3], ['Side half', 5], ['One corner', 1], ['Flat', 0],
  ],
};
const SEAM = .001;
const overlaps = (a, b) => a.minX < b.maxX - SEAM && a.maxX > b.minX + SEAM
  && a.minY < b.maxY - SEAM && a.maxY > b.minY + SEAM && a.minZ < b.maxZ - SEAM && a.maxZ > b.minZ + SEAM;

export class BattleRoyale {
  constructor(battle, rng = Math.random) {
    this.battle = battle;
    const { arena, deps } = battle;
    this.arena = arena;
    this.elapsed = 0;
    this.materials = 0;
    this.piece = 'wall';
    this.slots = [null, null, null, null];
    this.slot = 0;
    this.harvested = new Map();
    this.swingAt = -Infinity;
    this.eliminated = [];
    this.walls = [];
    this.impactWalls = [];
    this.pieceSeq = 0;
    this.token = false;
    this.noticeUntil = 0;
    this.holding = false; this.holdAt = -Infinity; this.holdKey = '';   // fire held in build mode
    this.bpK = 0;                         // 0..1: the blueprint raised in your hands
    const center = arena.world.nearestNode(0, 0, 0);
    this.x = arena.nodeX[center];
    this.y = arena.nodeY[center];
    this.z = arena.nodeZ[center];
    this.startRadius = Math.hypot(arena.hx + Math.abs(this.x), arena.hz + Math.abs(this.z));
    this.radius = this.startRadius;

    const chestGeo = new THREE.BoxGeometry(.95, .62, .64);
    const trimGeo = new THREE.BoxGeometry(.16, .64, .67);
    const chestMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .8 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xe4aa49, emissive: 0x5e3507, metalness: .45 });
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0x96704d, roughness: .9, side:THREE.DoubleSide });
    this.editKeep = new THREE.MeshBasicMaterial({ color: 0x64c7ff, transparent: true, opacity: .65 });
    this.editRemove = new THREE.MeshBasicMaterial({ color: 0xff917d, transparent: true, opacity: .34, wireframe: true });
    this.editFocus = new THREE.MeshBasicMaterial({ color: 0xffdf91, transparent: true, opacity: .74 });
    this.aimRay = new THREE.Ray();
    this.platformRay = new THREE.Raycaster();
    this.aimPoint = new THREE.Vector3();
    this.aimEnd = new THREE.Vector3();
    const ringGeo = new THREE.RingGeometry(.987, 1, 96);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xb989ff, side: THREE.DoubleSide, depthWrite: false });
    this.resources = [chestGeo, trimGeo, chestMat, goldMat, this.wallMat,
      this.editKeep, this.editRemove, this.editFocus, ringGeo, ringMat];
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.position.set(this.x, .07, this.z);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.scale.setScalar(this.radius);
    arena.scene.add(this.ring);

    const locations = arena.map.chests;
    const starterCount = ROYALE_BOTS + 1;
    const pirateIndex = rng() < TOKEN_CHANCE ? starterCount + Math.floor(rng() * (locations.length - starterCount)) : -1;
    const spawnOffset = Math.floor(rng() * starterCount);
    this.spawns = arena.map.spawns.map((_, i) => this.point(...arena.map.spawns[(i + spawnOffset) % starterCount]));
    this.chestBodies = new THREE.InstancedMesh(chestGeo, chestMat, locations.length);
    this.chestStraps = new THREE.InstancedMesh(trimGeo, goldMat, locations.length * 2);
    this.chestBodies.castShadow = true;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    this.chests = locations.map(([x, z], i) => {
      const p = this.point(x, z);
      const pirate = i === pirateIndex;
      const position = new THREE.Vector3(p.x,p.y+.31,p.z);
      this.chestBodies.setColorAt(i, color.setHex(pirate ? 0xab38c0 : 0x63472b));
      this.chestBodies.setMatrixAt(i,matrix.makeTranslation(position.x,position.y,position.z));
      for (let j = 0; j < 2; j++) this.chestStraps.setMatrixAt(i*2+j,matrix.makeTranslation(position.x+(j ? .25 : -.25),position.y,position.z));
      return { i, position, pirate, gun: deps.guns[Math.floor(rng() * deps.guns.length)], opened: false };
    });
    arena.scene.add(this.chestBodies,this.chestStraps);
    const wood = new THREE.MeshStandardMaterial({ color: 0x75462d, roughness: .85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x657680, metalness: .65, roughness: .36 });
    const handle = new THREE.CylinderGeometry(.018, .024, .58, 9);
    const head = new THREE.BoxGeometry(.34, .05, .075);
    const axe = this.pickaxe = new THREE.Group();
    axe.add(new THREE.Mesh(handle, wood));
    const blade = new THREE.Mesh(head, steel);
    blade.position.y = .26;
    axe.add(blade);
    axe.visible = false;
    battle.humans[0].rig.scene.add(axe);
    this.resources.push(wood, steel, handle, head);
    this.makeBlueprint(battle.humans[0].rig.scene);
    this.hotbar = document.createElement('div');
    this.hotbar.className = 'royale-hotbar';
    this.hotbar.setAttribute('aria-label', 'Battle Royale inventory');
    battle.hud.root.append(this.hotbar);
    this.renderInventory();
  }

  // Online Battle Royale: the host runs the match; a player's PC asks it to open chests, build and swing,
  // and mirrors the host's builds, chests and materials.
  get client() { return this.battle.net?.role === 'client'; }
  get host() { return this.battle.net?.role === 'host'; }
  remoteOf(f) { return this.battle.remotes?.find((r) => r.f === f) || null; }
  isPlayer(f) { return f === this.battle.humans[0]?.f || !!this.remoteOf(f); }
  materialsOf(f) { return f === this.battle.humans[0]?.f ? this.materials : (f.buildMaterials || 0); }
  sendMats(f) { const r = this.remoteOf(f); if (r) r.link.send({ k: 'mats', n: f.buildMaterials || 0 }); }

  // Vault (C) up onto a ramp or cone in front: up to 2 m (a ramp's tall end, a raised piece),
  // higher than the 1.5 m ledges the core vaults. Returns { x, y, z, top } or null.
  climbTarget(f, dx, dz) {
    const w = this.arena.world;
    for (const t of [0.8, 1.1, 1.4]) {
      const x = f.x + dx * t, z = f.z + dz * t;
      if (!this.walls.some((p) => p.kind !== 'wall' && x > p.box.minX && x < p.box.maxX && z > p.box.minZ && z < p.box.maxZ)) continue;
      const y = w.groundAt(x, z, f.y + 2.3), rise = y - f.y;
      if (rise < 0.45 || rise > 2.0 || !w.free(x, z, w.r - 1e-6, y)) continue;
      return { x, y, z, top: y };
    }
    return null;
  }

  point(x, z) {
    const a = this.arena, i = a.world.nearestNode(x, z, 0);
    return { x:a.nodeX[i], y:a.nodeY[i], z:a.nodeZ[i] };
  }

  outside(f, margin = 0) { return Math.hypot(f.x - this.x, f.z - this.z) > this.radius - margin; }

  advance(dt) {
    this.elapsed += dt;
    this.animateChests(dt);
    const shrink = Math.max(0, Math.min(1, (this.elapsed - 20) / 160));
    const collapse = Math.max(0, Math.min(1, (this.elapsed - 190) / 25));
    this.radius = (this.startRadius * (1 - shrink) + 3 * shrink) * (1 - collapse);
    this.ring.scale.setScalar(Math.max(.01, this.radius));
  }

  nearby(f, bot = false) {
    if (!f?.alive) return null;
    return this.chests.find(({ opened, position:p, pirate }) => {
      return !opened && !(bot && pirate) && Math.abs(f.y - (p.y - .31)) < .8 && Math.hypot(f.x - p.x, f.z - p.z) < 2.2
        && this.arena.sightLine([f.x, f.y + 1.2, f.z], [p.x, p.y + .35, p.z]);
    });
  }

  open(f) {
    const chest = this.nearby(f);
    if (!chest) return false;
    if (this.client) { this.battle.net.link.send({ k: 'chest', i: chest.i }); return true; }
    this.takeChest(chest, f);
    this.popChest(chest);
    this.materials += CHEST_MATERIALS;
    this.lootGun(chest.gun);
    if (chest.pirate) {
      this.token = true;
      this.battle.deps.onPirateToken();
    }
    const reward = chest.pirate ? 'Pirate Token found · All Black Ice skins unlocked' : chest.gun.name;
    this.notify(reward + ' · +' + CHEST_MATERIALS + ' materials');
    return true;
  }

  // Opening a chest: in its place a chest whose lid flies open on a burst of gold light, coins and
  // sparkles spilling up out of it; then it sinks away.
  popChest(chest) {
    const g = new THREE.Group(), gold = chest.pirate ? 0xd070ff : 0xffc040;
    const wood = new THREE.MeshStandardMaterial({ color: chest.pirate ? 0xab38c0 : 0x63472b, roughness: .8, transparent: true });
    const trim = new THREE.MeshStandardMaterial({ color: 0xe4aa49, emissive: 0x5e3507, metalness: .45, transparent: true });
    const base = new THREE.Mesh(new THREE.BoxGeometry(.9, .42, .56), wood); base.position.y = -.1;
    const hinge = new THREE.Group(); hinge.position.set(0, .11, -.28);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(.92, .2, .58), wood); lid.position.set(0, .1, .29); hinge.add(lid);
    for (const x of [-.25, .25]) { const t = new THREE.Mesh(new THREE.BoxGeometry(.06, .44, .58), trim); t.position.set(x, -.1, 0); base.add(t); }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(.8, .5), new THREE.MeshBasicMaterial({ color: gold, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = .1;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.32, .45, 3, 16, 1, true), new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.y = 1.6;
    const coinGeo = new THREE.CylinderGeometry(.045, .045, .012, 10), coinMat = new THREE.MeshStandardMaterial({ color: 0xffd36a, metalness: 1, roughness: .25, emissive: 0x6a4000, transparent: true });
    const coins = Array.from({ length: 16 }, () => { const m = new THREE.Mesh(coinGeo, coinMat); g.add(m); return { m, v: new THREE.Vector3((Math.random() - .5) * 1.6, 2.2 + Math.random() * 1.6, (Math.random() - .5) * 1.6), s: new THREE.Vector3(Math.random() * 14, Math.random() * 14, 0) }; });
    g.add(base, hinge, glow, beam);
    g.position.copy(chest.position);
    this.arena.scene.add(g);
    (this.pops ||= []).push({ g, hinge, glow, beam, coins, age: 0, mats: [wood, trim, glow.material, beam.material, coinMat] });
    this.battle.deps.sfx?.reload?.(0.9);
  }
  animateChests(dt) {
    if (!this.pops?.length) return;
    for (const p of this.pops) {
      p.age += dt; const a = p.age;
      p.hinge.rotation.x = -1.9 * Math.min(1, a / .22) * (1 + .12 * Math.sin(Math.min(a, .6) * 18) * Math.max(0, 1 - a / .6));   // flung open, a little bounce
      const fade = 1 - Math.max(0, Math.min(1, (a - 1.8) / .7));
      p.glow.material.opacity = Math.min(1, a / .1) * fade * (.8 + .2 * Math.sin(a * 20));
      p.beam.material.opacity = .45 * Math.sin(Math.min(1, a / 1.6) * Math.PI);
      p.beam.scale.set(1, Math.min(1, a / .25), 1);
      for (const c of p.coins) {
        const t = Math.min(a, 1.4);
        c.m.position.set(c.v.x * t * .5, .15 + c.v.y * t - 4.9 * t * t, c.v.z * t * .5);
        if (c.m.position.y < -.3) c.m.position.y = -.3;
        c.m.rotation.set(c.s.x * a, c.s.y * a, 0);
      }
      for (const m of p.mats) if (m !== p.beam.material && m !== p.glow.material) m.opacity = fade;
      p.g.position.y -= a > 1.8 ? dt * .3 : 0;
    }
    for (const p of this.pops.filter(p => p.age > 2.6)) {
      p.g.removeFromParent(); p.g.traverse(o => o.geometry?.dispose()); for (const m of p.mats) m.dispose();
    }
    this.pops = this.pops.filter(p => p.age <= 2.6);
  }

  lootGun(gun) {
    let index = this.slots.findIndex(item => item?.gun.id === gun.id);
    if (index < 0) {
      const empty = this.slots.indexOf(null);
      index = empty >= 0 ? empty : this.slot ? this.slot - 1 : this.slots.length - 1;
      if (index === this.slot - 1) this.slot = 0;
      this.slots[index] = { gun, ammo:gun.magSize + Number(!!gun.chambered) };
    }
    this.equip(index + 1);
  }

  equip(slot) {
    if (this.preview) { this.preview = false; this.holding = false; }     // picking a tool puts the blueprint away
    if (slot === this.slot || (slot && !this.slots[slot - 1])) return;
    const human = this.battle.humans[0];
    if (this.slot) this.slots[this.slot - 1].ammo = human.weapon.ammo;
    this.slot = slot;
    const item = this.slots[slot - 1];
    human.in.fire = human.in.ads = false;
    human.weapon.releaseTrigger();
    this.battle.changeGun(item?.gun || null);
    if (item) human.weapon.ammo = item.ammo;
    this.renderInventory();
  }

  renderInventory() {
    const names = ['Pickaxe', ...this.slots.map(item => item?.gun.name || 'Empty')];
    this.hotbar.replaceChildren(...names.map((name, i) => {
      const item = document.createElement('div');
      item.className = 'royale-slot' + (i === this.slot ? ' selected' : '');
      item.textContent = (i + 1) + '  ' + name;
      return item;
    }));
    this.matCount = document.createElement('div');
    this.matCount.className = 'royale-slot';
    this.matCount.textContent = this.materials + ' mats';
    this.hotbar.append(this.matCount);
  }

  takeChest(chest, f) {
    chest.opened = true;
    if (this.host) this.battle._broadcast({ k: 'chest', i: chest.i });
    const hidden = this.hiddenChestMatrix ||= new THREE.Matrix4().makeTranslation(0,-1000,0);
    this.chestBodies.setMatrixAt(chest.i,hidden);
    this.chestStraps.setMatrixAt(chest.i*2,hidden);
    this.chestStraps.setMatrixAt(chest.i*2+1,hidden);
    this.chestBodies.instanceMatrix.needsUpdate = this.chestStraps.instanceMatrix.needsUpdate = true;
    f.nades = Math.min(2, f.nades + 1);
  }

  // Host: a player on another PC opens chest i (near enough, still closed).
  hostChest(r, i) {
    const chest = this.chests[i | 0], f = r.f;
    if (!chest || chest.opened || !f.alive || Math.hypot(f.x - chest.position.x, f.z - chest.position.z) > 2.6 || Math.abs(f.y - (chest.position.y - .31)) > 1.2) return;
    this.takeChest(chest, f);
    this.popChest(chest);
    f.buildMaterials = (f.buildMaterials || 0) + CHEST_MATERIALS;
    (r.looted ||= new Set()).add(this.battle.deps.guns.indexOf(chest.gun));
    r.link.send({ k: 'loot', gun: this.battle.deps.guns.indexOf(chest.gun), mats: f.buildMaterials, nades: f.nades, pirate: !!chest.pirate });
  }
  // A player's PC: the host opened a chest (anyone's): it opens here too.
  mirrorChest(i) {
    const chest = this.chests[i | 0];
    if (!chest || chest.opened) return;
    this.takeChest(chest, { nades: 0 });
    this.popChest(chest);
  }
  // A player's PC: the host gave you a chest's loot.
  takeLoot(m) {
    const gun = this.battle.deps.guns[m.gun | 0];
    if (gun) this.lootGun(gun);
    this.materials = m.mats | 0;
    const me = this.battle.humans[0]?.f; if (me) me.nades = m.nades | 0;
    if (m.pirate) { this.token = true; this.battle.deps.onPirateToken(); }
    this.notify((m.pirate ? 'Pirate Token found · All Black Ice skins unlocked' : gun ? gun.name : 'Chest') + ' · ' + this.materials + ' materials');
    this.renderInventory();
  }

  botLoot(bot) {
    const chest = this.nearby(bot.f, true);
    if (!chest) return;
    this.takeChest(chest, bot.f);
    bot.f.buildMaterials = 2;
    bot.setGun(chest.gun);
    this.battle._look(bot.f, chest.gun, null);
    bot.goal = null;
    bot.path = [];
  }

  nearestChest(f, bot = false) {
    let nearest = null, best = Infinity;
    for (const chest of this.chests) {
      if (chest.opened || (bot && chest.pirate)) continue;
      const p = chest.position;
      if (bot && this.outside(p)) continue;
      const distance = Math.hypot(p.x - f.x, p.z - f.z);
      if (distance < best) { nearest = chest; best = distance; }
    }
    return nearest;
  }

  lootGoal(bot, t) {
    const chest = this.nearestChest(bot.f, true);
    if (!chest) return false;
    if (bot.lootChest !== chest || bot.mode !== 'loot' || t >= bot.nextPath) {
      bot.lootChest = chest;
      const p = chest.position;
      bot._setGoal(p.x, p.z, this.arena, t, p.y - .31);
    }
    return true;
  }

  defend(bot, t) {
    const f = bot.f, attacker = bot.attacker;
    if (!f.buildMaterials || !attacker?.alive || t - bot.attackedAt > 1.2 ||
        t < (bot.nextWall || 0) || f.health > 75 || this.outside(f, 1)) return;
    const dx = attacker.x - f.x, dz = attacker.z - f.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 4 || distance > 36) return;
    bot.nextWall = t + 6;
    if (!this.arena.sightLine(f.chest([0,0,0]), attacker.chest([0,0,0]))) return;
    if (this.build(f, Math.atan2(dx,-dz) * 180 / Math.PI, 'wall')) {
      bot.mode = 'hold';
      bot.holdUntil = t + 1.35;
      bot.crouchWanted = true;
    }
  }

  coverTarget(f, contact, t) {
    if (!contact?.actor.alive || t - contact.t > 2.2) return null;
    const origin = f.eye([0,0,0]), lead = Math.min(.65, t - contact.t);
    for (const dt of [lead, 0]) {
      const target = [contact.x + contact.vx * dt, contact.y, contact.z + contact.vz * dt];
      const delta = target.map((value, i) => value - origin[i]), distance = Math.hypot(...delta);
      if (distance < 2 || distance > 40) continue;
      const ray = delta.map(value => value / distance);
      const hit = this.arena.raycast(origin, ray, distance);
      const wall = this.impactWalls[this.arena.world.hit - this.arena.baseBoxCount];
      if (wall?.kind === 'wall' && wall.owner !== f) return { wall, point:origin.map((v,i) => v + ray[i]*hit) };
    }
    return null;
  }

  swing(human) {
    const b = this.battle, f = human.f;
    if (!f.alive || human.vault || b.t - this.swingAt < .65) return;
    this.swingAt = b.t;
    b.deps.sfx.knife(.8);
    const origin = human.camera.position.toArray(), direction = human.camera.getWorldDirection(this.aimRay.direction).toArray();
    if (this.client) { this.battle.net.link.send({ k: 'swing', o: origin, d: direction }); return; }
    this.strike(f, origin, direction);
  }
  // One pickaxe swing from origin along direction: a rival (40), a build (52), or a prop's material.
  strike(f, origin, direction) {
    const b = this.battle;
    const range = 2.6, distance = this.arena.raycast(origin, direction, range);
    const index = this.arena.world.hit;
    let target = null, closest = Math.min(distance, range);
    for (const g of b.enemiesOf(f)) {
      if (!g.alive) continue;
      const hit = g.raycast(origin, direction);
      if (hit && hit.t < closest) { target = g; closest = hit.t; }
    }
    if (target) { b._damage(target, 40, f, 'torso', b.t); return; }
    const wall = this.impactWalls[index - this.arena.baseBoxCount];
    if (wall) { this.damageWall(wall, 52); return; }
    const prop = this.arena.boxes[index];
    if (index >= 0 && index < this.arena.baseBoxCount && prop && (this.harvested.get(index) || 0) < 3) {
      this.harvested.set(index, (this.harvested.get(index) || 0) + 1);
      if (f === b.humans[0]?.f) { this.materials++; this.notify('+1 wall material'); }
      else { f.buildMaterials = (f.buildMaterials || 0) + 1; this.sendMats(f); }
    }
  }

  showPickaxe(t) { return !this.battle.humans[0].gun || t - this.swingAt < .4; }

  posePickaxe(visible, t) {
    this.pickaxe.visible = !!visible;
    if (!visible) return;
    const swing = Math.sin(Math.PI * Math.max(0, 1 - (t - this.swingAt) / .4));
    this.pickaxe.position.set(.36 - .19 * swing, -.37 + .12 * swing, -.9 - .13 * swing);
    this.pickaxe.rotation.set(.25 - swing * 1.2, -.35, -.33 + swing * .92);
  }

  // pitch: how far you look up (+) or down (-); planned: a plan you already made; quiet: no notice when it does not fit.
  build(f, yaw, selected = this.piece, pitch = 0, planned = null, quiet = false) {
    const player = f === this.battle.humans[0].f, remote = !player && !!this.remoteOf(f);
    if (!this.materialsOf(f) || !f.alive || f.drop) return;
    const p = planned || this.plan(f, yaw, selected, pitch);
    if (player && this.client && !p.limit && !p.blocked) {     // online: the host builds it, and its list comes back
      this.battle.net.link.send({ k: 'build', kind: p.kind, yaw, pitch });
      this.holdAt = this.battle.t; this.holdKey = p.key;
      if (p.under) this.lift(f, { kind: p.kind, mesh: { position: new THREE.Vector3(p.x, p.y, p.z) }, dir: p.dir, mask: PLATFORM_MASK });
      return;
    }
    if (p.limit) { if (player && !quiet) this.notify('10-ramp height limit'); return; }
    if (p.blocked) { if (player && !quiet) this.notify('Build needs clear space'); return; }
    const { kind, isWall, previous, dir, box, x, y, z, w, d } = p, { arena } = this;
    const mesh = new THREE.Group();
    const bounds = new THREE.Box3(new THREE.Vector3(box.minX, box.minY, box.minZ),
      new THREE.Vector3(box.maxX, box.maxY, box.maxZ));
    arena.scene.add(mesh);
    const piece = { id: ++this.pieceSeq, kind, box, bounds, mesh, owner:f, hp:WALL_HP, dir, startDir:dir, level:(previous?.level || 0)+1, mask:isWall ? FULL_WALL : PLATFORM_MASK };
    if (isWall) this.makeWall(piece, x, y, z, w, d);
    else {
      mesh.position.set(x,y,z);
      platformMeshes(piece,this.wallMat);
    }
    this.walls.push(piece);
    if (player) { this.materials--; this.holdAt = this.battle.t; this.holdKey = p.key; }
    else { f.buildMaterials--; if (remote) this.sendMats(f); }
    this.syncWalls();
    if (p.under) this.lift(f, piece);
    return piece;
  }
  // A ramp built under your feet carries you up onto it, to its surface where you stand.
  lift(f, piece) {
    let top = f.y;
    for (const s of platformSolids(piece)) if (f.x >= s.minX && f.x <= s.maxX && f.z >= s.minZ && f.z <= s.maxZ) top = Math.max(top, s.maxY);
    if (top > f.y) { f.y = top + .01; f.vy = 0; }
  }
  // The build you stand on (a ramp or cone): inside its grid cell, feet within its height. The highest wins.
  standingOn(f) {
    let best = null;
    for (const p of this.walls) {
      if (p.kind === 'wall') continue;
      const q = p.mesh.position;
      if (Math.abs(f.x - q.x) > PLATFORM_HALF || Math.abs(f.z - q.z) > PLATFORM_HALF) continue;
      if (f.y < q.y - .1 || f.y > q.y + platformHeight(p.kind) + .3) continue;
      if (!best || q.y > best.mesh.position.y) best = p;
    }
    return best;
  }
  // Where a piece would go (no side effects): the build and its ghost use the same answer.
  plan(f, yaw, selected = this.piece, pitch = 0) {
    const player = this.isPlayer(f);
    const { arena } = this;
    const kind = player ? selected : 'wall', isWall = kind === 'wall';
    const angle = yaw * Math.PI / 180, dx = Math.sin(angle), dz = -Math.cos(angle), alongX = Math.abs(dx) > Math.abs(dz);
    const dir = -Math.round(yaw / 90);
    const up = d => [-Math.round(Math.sin(d * Math.PI/2)), -Math.round(Math.cos(d * Math.PI/2))];   // a ramp's way up
    const [forwardX, forwardZ] = up(dir);
    // The build you stand on sets the grid cell and the heights: pieces then go where they join it, wherever
    // on it you stand (your feet climb it; the cell does not move).
    const support = player ? this.standingOn(f) : null;
    // A ramp with the view tipped down goes in your own cell, under your feet, and lifts you onto it: place one
    // on another, turning a quarter each time, and you crank a tower.
    const under = player && kind === 'ramp' && pitch <= -UNDER_PITCH;
    const cx = cellMid(f.x), cz = cellMid(f.z);
    const previous = kind !== 'ramp' || !support || support.kind !== 'ramp' ? null
      : under ? (Math.abs(support.mesh.position.x - cx) < .01 && Math.abs(support.mesh.position.z - cz) < .01 ? support : null)
      : (support.dir - dir) % 4 === 0 ? support : null;
    if (previous && previous.level >= MAX_RAMPS) return { limit: true };
    // On the grid: a wall on the nearest cell edge in front of you, a floor / ramp / cone in the next cell.
    // (the first edge / cell clear of your body, 0.46 m around you)
    const edge = (v, s) => (s > 0 ? Math.ceil((v + .46) / CELL) : Math.floor((v - .46) / CELL)) * CELL;
    const ahead = (v, s) => edge(v, s) + Math.sign(s) * CELL / 2;
    const gx = (isWall ? edge : ahead)(f.x, dx), gz = (isWall ? edge : ahead)(f.z, dz);
    const x0 = alongX ? gx : cellMid(f.x), z0 = alongX ? cellMid(f.z) : gz;
    const x = under ? cx : previous ? previous.mesh.position.x + forwardX * CELL : x0;
    const z = under ? cz : previous ? previous.mesh.position.z + forwardZ * CELL : z0;
    const w = isWall ? (alongX ? .32 : CELL) : CELL;
    const d = isWall ? (w > 1 ? .32 : CELL) : w;
    let y = under ? (previous ? previous.mesh.position.y + RAMP_RISE : arena.groundAt(x, z, f.y))
      : previous ? previous.mesh.position.y + RAMP_RISE : arena.groundAt(x, z, f.y);
    // A wall on an edge of the build you stand on sits on that build: on the ramp's top edge at its top, on its
    // other edges at its base.
    let attached = false;
    if (isWall && support) {
      const q = support.mesh.position, ex = Math.abs(x - q.x), ez = Math.abs(z - q.z);
      if ((Math.abs(ex - PLATFORM_HALF) < .01 && ez < .01) || (Math.abs(ez - PLATFORM_HALF) < .01 && ex < .01)) {
        const [ux, uz] = up(support.dir), onTop = support.kind === 'ramp' && Math.abs(x - q.x - ux * PLATFORM_HALF) < .01 && Math.abs(z - q.z - uz * PLATFORM_HALF) < .01;
        attached = true;
        y = q.y + (onTop ? RAMP_RISE : 0);
      }
    }
    // Look up: the wall goes a level higher; it needs a build to rest on or lean against.
    const raised = isWall && player && pitch >= RAISE_PITCH;
    if (raised) y += WALL_HEIGHT;
    // Sky base: a cone off the ground goes level with the top or foot of a wall or ramp it touches, or beside
    // a cone it touches (the level nearest your feet).
    if (kind === 'cone' && !previous && !attached && Math.abs(y - f.y) > .45) {
      const cell = grow({ minX:x-w/2, maxX:x+w/2, minY:-Infinity, maxY:Infinity, minZ:z-d/2, maxZ:z+d/2 });
      let level = null;
      for (const p of this.walls) if (overlaps(cell, p.box))
        for (const v of p.kind === 'cone' ? [p.box.minY] : [p.box.minY, p.box.maxY]) if (Math.abs(v - f.y) < 3.3 && (level === null || Math.abs(v - f.y) < Math.abs(level - f.y))) level = v;
      if (level !== null) { y = level; attached = true; }
    }
    const box = { minX:x-w/2, maxX:x+w/2, minY:y, maxY:y+(isWall ? WALL_HEIGHT : platformHeight(kind)), minZ:z-d/2, maxZ:z+d/2 };
    if (raised) attached = this.walls.some(p => overlaps(grow(box), p.box));      // (even on a ramp's edge: raised, it may float)
    // A wall straddles a grid edge: test only its centre line (ends trimmed), so it can stand on the
    // edge of a floor or ramp and meet another wall at a corner, but not on top of another wall.
    // A floor, ramp or cone tests its cell inset by 0.2 m, so it fits right against walls on the cell's
    // edges and next to other pieces.
    const core = !isWall ? { ...box, minX: box.minX + .2, maxX: box.maxX - .2, minZ: box.minZ + .2, maxZ: box.maxZ - .2 } : alongX ? { ...box, minX: x, maxX: x, minZ: box.minZ + .2, maxZ: box.maxZ - .2 } : { ...box, minZ: z, maxZ: z, minX: box.minX + .2, maxX: box.maxX - .2 };
    // Under your feet: the ramp may start up to 2.2 m below you (a jump) or just above them (stacked on the ramp you
    // stand on, in its own cell, so only scenery stops it) and needs room above to lift you.
    const lifted = under ? rampSurface(y, (f.x - x) * forwardX + (f.z - z) * forwardZ) : 0;
    const floating = under ? y > f.y + 2 || f.y - y > 2.2 || arena.raycast([f.x, Math.max(f.y, lifted) + .05, f.z], [0, 1, 0], 1.85) < 1.8
      : !previous && !attached && Math.abs(y - f.y) > .45;
    const blocked = floating || box.maxY >= (arena.map.ceiling ? arena.wallH : Infinity)
      || box.minX <= -arena.hx || box.maxX >= arena.hx || box.minZ <= -arena.hz || box.maxZ >= arena.hz
      || arena.boxes.some((other, i) => (!under || i < arena.baseBoxCount) && overlaps(core, other))
      || (!under && !attached && !arena.sightLine([f.x, f.y + 1.2, f.z], [x, y + .7, z]))
      || this.occupied(box, previous || under ? f : null);
    const key = kind + x.toFixed(2) + y.toFixed(2) + z.toFixed(2) + (isWall ? w > 1 : dir);
    return { kind, isWall, previous, under, attached, dir, box, x, y, z, w, d, blocked, key };
  }
  // The ghost: in build mode (B toggles it), a see-through copy of the piece where it will go
  // (blue: it fits, red: no room). Fire builds it there.
  updateGhost(h) {
    const want = this.preview && h.f.alive && !h.f.drop && !this.editing && !this.battle.paused;
    let p = want ? this.plan(h.f, h.look.yaw, this.piece, h.look.pitch) : null;
    if (!want) this.holding = false;
    else this.holdBuild(h, p);
    if (p && p.limit) p = null;
    if (!this.ghost) {
      this.ghostOk = new THREE.MeshBasicMaterial({ color: 0x64c7ff, transparent: true, opacity: .32, depthWrite: false });
      this.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: .32, depthWrite: false });
      this.ghost = new THREE.Group(); this.ghostKey = '';
      this.arena.scene.add(this.ghost);
      this.resources.push(this.ghostOk, this.ghostBad);
    }
    const g = this.ghost;
    g.visible = !!p;
    if (!p) return;
    const mat = p.blocked || !this.materials ? this.ghostBad : this.ghostOk;
    const key = p.kind + (p.isWall ? (p.w > 1 ? 'x' : 'z') : p.dir);
    if (key !== this.ghostKey) {
      for (const c of g.children.slice()) { c.geometry.dispose(); c.removeFromParent(); }
      g.rotation.set(0, 0, 0);
      if (p.isWall) g.add(new THREE.Mesh(new THREE.BoxGeometry(p.w, WALL_HEIGHT, p.d), mat));
      else platformMeshes({ kind: p.kind, dir: p.dir, mask: PLATFORM_MASK, mesh: g }, mat);
      this.ghostKey = key;
    }
    for (const c of g.children) { c.material = mat; c.castShadow = c.receiveShadow = false; }
    g.position.set(p.x, p.y + (p.isWall ? WALL_HEIGHT / 2 : 0), p.z);
  }

  // Fire in build mode: build now, and keep building for as long as it is held.
  holdFire(h, down) {
    this.holding = down; this.dry = false;
    if (down) this.build(h.f, h.look.yaw, this.piece, h.look.pitch);
  }
  // Held fire puts a piece at every new spot your aim reaches. Turbo building (a setting): twice as fast, and
  // the same spot again the moment its piece is shot down.
  holdBuild(h, p) {
    if (!this.holding || !p || p.limit) return;
    if (!this.materials) { if (!this.dry) { this.dry = true; this.notify('Out of materials'); } return; }
    if (p.blocked) return;
    const turbo = this.battle.deps.settings.turboBuild !== false;
    if (this.battle.t - this.holdAt < (turbo ? TURBO_GAP : HOLD_GAP) || (!turbo && p.key === this.holdKey)) return;
    this.build(h.f, h.look.yaw, this.piece, h.look.pitch, p, true);
  }

  /* ---------- the drop ---------- */
  startDrop(f, t) {
    if (!this.chuteGeo) {
      this.chuteGeo = new THREE.SphereGeometry(1.9, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
      this.lineGeo = new THREE.CylinderGeometry(.012, .012, 3.1, 4);
      this.lineMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
      this.chuteMats = CHUTE_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: .8, side: THREE.DoubleSide }));
      this.resources.push(this.chuteGeo, this.lineGeo, this.lineMat, ...this.chuteMats);
    }
    const chute = new THREE.Group(), canopy = new THREE.Mesh(this.chuteGeo, this.chuteMats[(f.id || 0) % this.chuteMats.length]);
    canopy.scale.y = .55; canopy.position.y = 3.2; canopy.castShadow = true; chute.add(canopy);
    const own = f === this.battle.humans[0].f;        // your own lines would cut across your view: canopy only
    if (!own) for (const [x, z] of [[1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]]) {   // lines from the canopy rim to the harness
      const l = new THREE.Mesh(this.lineGeo, this.lineMat);
      l.position.set(x / 2, 1.85, z / 2); l.rotation.set(Math.atan2(z, 3.1) * .9, 0, -Math.atan2(x, 3.1) * .9); chute.add(l);
    }
    this.arena.scene.add(chute);
    f.drop = { y: f.y + DROP_H, chute, sway: (f.id || 0) * 1.7 };
    f.y = f.drop.y; f.vy = 0;
    f.protectUntil = Infinity;
  }
  // Every frame, after the bodies moved: gliders sink at a steady rate and land.
  glide(dt, t) {
    const h = this.battle.humans[0];
    for (const f of this.battle.fighters) {
      const d = f.drop;
      if (!d) continue;
      if (!f.alive) { this.land(f, t); continue; }
      d.y -= GLIDE * dt;
      const ground = this.arena.groundAt(f.x, f.z, d.y);
      if (d.y <= ground + .02) { f.y = ground; this.land(f, t); }
      else {
        f.y = d.y; f.vy = 0;
        d.chute.position.set(f.x, f.y, f.z);
        d.chute.rotation.z = Math.sin(t * 1.3 + d.sway) * .07; d.chute.rotation.x = Math.cos(t * 1.1 + d.sway) * .05;
      }
      if (h && h.f === f) h.camY = f.y;
    }
  }
  land(f, t) {
    const d = f.drop;
    d.chute.removeFromParent();
    f.drop = null; f.vy = 0;
    if (f.alive) f.protectUntil = t + LAND_PROTECT;
  }

  cyclePiece() {
    this.piece = PIECES[(PIECES.indexOf(this.piece) + 1) % PIECES.length];
    this.noticeUntil = 0;
    this.drawBlueprint();
    this.updateHud();
  }

  // The blueprint you hold in build mode: a sheet of blue drawing paper with a grid and a sketch of the piece you
  // have selected, gripped at its lower corners (drawn here, no image files).
  makeBlueprint(scene) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 360;
    this.bpCanvas = cv;
    this.bpTex = new THREE.CanvasTexture(cv); this.bpTex.colorSpace = THREE.SRGBColorSpace; this.bpTex.anisotropy = 4;
    const g = this.blueprint = new THREE.Group();
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(.6, .42), new THREE.MeshBasicMaterial({ map: this.bpTex, side: THREE.DoubleSide, toneMapped: false }));
    const glove = new THREE.MeshStandardMaterial({ color: 0x2b2f2a, roughness: .85 }), sleeve = new THREE.MeshStandardMaterial({ color: 0x3a4538, roughness: .9 });
    const fist = new THREE.SphereGeometry(1, 14, 10), arm = new THREE.CylinderGeometry(.034, .042, .6, 10);
    g.add(paper);
    for (const side of [-1, 1]) {
      const hand = new THREE.Mesh(fist, glove); hand.scale.set(.05, .036, .055); hand.position.set(side * .285, -.2, .03);
      const forearm = new THREE.Mesh(arm, sleeve); forearm.position.set(side * .31, -.2 - .3, .1); forearm.rotation.set(-.35, 0, side * -.12);
      g.add(hand, forearm);
    }
    g.visible = false;
    scene.add(g);
    this.resources.push(this.bpTex, paper.geometry, paper.material, glove, sleeve, fist, arm);
    this.drawBlueprint();
  }
  drawBlueprint() {
    const g = this.bpCanvas.getContext('2d'), W = 512, H = 360, piece = this.piece;
    g.fillStyle = '#15406b'; g.fillRect(0, 0, W, H);
    const light = g.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, 330);
    light.addColorStop(0, 'rgba(90,170,235,.38)'); light.addColorStop(1, 'rgba(0,10,30,.45)');
    g.fillStyle = light; g.fillRect(0, 0, W, H);
    for (let x = 0; x <= W; x += 32) { g.strokeStyle = x % 128 ? 'rgba(190,225,255,.22)' : 'rgba(190,225,255,.5)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 32) { g.strokeStyle = y % 128 ? 'rgba(190,225,255,.22)' : 'rgba(190,225,255,.5)'; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.strokeStyle = 'rgba(235,246,255,.9)'; g.lineWidth = 3; g.strokeRect(14, 14, W - 28, H - 28);
    g.lineWidth = 2.5; g.fillStyle = 'rgba(235,246,255,.92)'; g.font = 'bold 26px monospace';
    const line = (...pts) => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); };
    const cx = W / 2, cy = 196;
    if (piece === 'wall') {                                    // a 3 x 3 panel wall in elevation
      g.strokeRect(cx - 90, cy - 90, 180, 180);
      for (const k of [60, 120]) { line([cx - 90 + k, cy - 90], [cx - 90 + k, cy + 90]); line([cx - 90, cy - 90 + k], [cx + 90, cy - 90 + k]); }
    } else if (piece === 'ramp') {                             // a ramp in side view, with its rise marked
      line([cx - 140, cy + 80], [cx + 140, cy + 80], [cx + 140, cy - 80], [cx - 140, cy + 80]);
      for (let k = 1; k < 7; k++) line([cx - 140 + k * 40, cy + 80], [cx - 140 + k * 40, cy + 80 - k * 160 / 7 * 1]);
      line([cx + 170, cy + 80], [cx + 170, cy - 80]); line([cx + 160, cy - 80], [cx + 180, cy - 80]); line([cx + 160, cy + 80], [cx + 180, cy + 80]);
    } else {                                                   // a cone (pyramid) from above, its edges to the apex
      g.strokeRect(cx - 100, cy - 90, 200, 180);
      line([cx - 100, cy - 90], [cx + 100, cy + 90]); line([cx + 100, cy - 90], [cx - 100, cy + 90]);
      g.strokeRect(cx - 40, cy - 36, 80, 72);
    }
    g.fillText('BLUEPRINT  /  ' + piece.toUpperCase(), 36, 56);
    g.font = '16px monospace'; g.fillText('GRID 3.2 M', 36, H - 34);
    this.bpTex.needsUpdate = true;
  }
  // Raises the blueprint into your hands (and lowers it again); true while it shows, and the gun stays down.
  poseBlueprint(want, t) {
    const dt = Math.min(.05, Math.max(0, t - (this.bpT ?? t))); this.bpT = t;
    this.bpK += ((want ? 1 : 0) - this.bpK) * (1 - Math.exp(-14 * dt));
    if (!want && this.bpK < .02) this.bpK = 0;
    const k = this.bpK, g = this.blueprint;
    g.visible = k > .02;
    if (!g.visible) return false;
    g.position.set(.02 + Math.sin(t * 1.3) * .004, -.3 - (1 - k) * .5, -.74);
    g.rotation.set(-.5 - (1 - k) * .5, Math.sin(t * .9) * .015, Math.sin(t * 1.1) * .01);
    return true;
  }

  makeWall(wall, x, y, z, w, d) {
    const { mesh } = wall;
    const acrossX = w > d, cw = acrossX ? w / GRID : w, cd = acrossX ? d : d / GRID, ch = WALL_HEIGHT / GRID;
    mesh.position.set(x, y + WALL_HEIGHT / 2, z);
    const geometry = new THREE.BoxGeometry(cw * (acrossX ? .98 : 1), ch * .98, cd * (acrossX ? 1 : .98));
    const cells = Array.from({ length: GRID ** 2 }, (_, i) => {
      const col = i % GRID - 1, row = Math.floor(i / GRID) - 1;
      const cx = x + (acrossX ? col * cw : 0), cy = mesh.position.y + row * ch, cz = z + (acrossX ? 0 : col * cd);
      const tile = new THREE.Mesh(geometry, this.wallMat);
      tile.position.set(cx - x, cy - mesh.position.y, cz - z);
      tile.castShadow = tile.receiveShadow = true;
      mesh.add(tile);
      return { minX:cx-cw/2, maxX:cx+cw/2, minY:cy-ch/2, maxY:cy+ch/2, minZ:cz-cd/2, maxZ:cz+cd/2 };
    });
    Object.assign(wall, { acrossX, cells, geometry });
  }

  damageWall(wall, damage) {
    wall.hp -= damage;
    if (wall.hp > 0) return;
    if (this.editing === wall) this.cancelEdit();
    this.disposePiece(wall);
    this.walls.splice(this.walls.indexOf(wall), 1);
    this.collapse();
  }
  // Builds no longer joined to the ground (through the pieces they touch) fall once what held them up is gone.
  collapse() {
    // on the ground: worked out once per piece, against the bare map (pieces never move)
    const fresh = this.walls.filter(p => p.grounded === undefined);
    if (fresh.length) this.arena.setBuilds([]);
    for (const p of fresh) p.grounded = p.box.minY <= this.arena.groundAt((p.box.minX + p.box.maxX) / 2, (p.box.minZ + p.box.maxZ) / 2, p.box.minY + .3) + .3;
    const held = new Set(this.walls.filter(p => p.grounded));
    for (let more = true; more;) {
      more = false;
      for (const p of this.walls) if (!held.has(p) && [...held].some(q => overlaps(grow(p.box), q.box))) { held.add(p); more = true; }
    }
    for (const p of this.walls.filter(p => !held.has(p))) {
      if (this.editing === p) this.cancelEdit();
      this.disposePiece(p);
      this.walls.splice(this.walls.indexOf(p), 1);
    }
    this.syncWalls();
  }
  // Shot at from above: the build holding the shooter up (the lowest one in sight under them), to bring it down.
  supportTarget(f, enemy, at, t) {
    if (!enemy?.alive || t - at > 3 || enemy.y < f.y + 2.5) return null;
    const eye = f.eye([0, 0, 0]);
    // what they stand on, then every piece below it that it is joined to (the base), lowest first
    const under = this.walls.filter(w => w.box.minY < enemy.y && (w.kind !== 'wall' || w.box.maxY <= enemy.y + .3) && enemy.x > w.box.minX - .4 && enemy.x < w.box.maxX + .4 && enemy.z > w.box.minZ - .4 && enemy.z < w.box.maxZ + .4);
    for (let i = 0; i < under.length; i++)
      for (const w of this.walls) if (!under.includes(w) && w.box.minY < under[i].box.minY + .1 && overlaps(grow(w.box), under[i].box)) under.push(w);
    under.sort((a, b) => a.box.minY - b.box.minY);
    for (const w of under) {
      const point = [(w.box.minX + w.box.maxX) / 2, Math.min(w.box.maxY - .2, w.box.minY + 1), (w.box.minZ + w.box.maxZ) / 2];
      const delta = point.map((v, i) => v - eye[i]), distance = Math.hypot(...delta);
      if (distance < 1 || distance > 45) continue;
      this.arena.raycast(eye, delta.map(v => v / distance), distance + .5);
      if (this.impactWalls[this.arena.world.hit - this.arena.baseBoxCount] === w) return { wall: w, point, support: true };
    }
    return null;
  }

  syncWalls() {
    const solids = [];
    this.impactWalls = [];
    for (const wall of this.walls) {
      const pieces = wall.kind !== 'wall' ? platformSolids(wall)
        : wall.mask === FULL_WALL ? [wall.box] : wall.cells.filter((_, i) => wall.mask & (1 << i));
      for (const piece of pieces) { solids.push(piece); this.impactWalls.push(wall); }
    }
    this.arena.setBuilds(solids);
    if (this.host) this.battle._broadcast({ k: 'walls', w: this.walls.map((w) => [w.id, w.kind, ...[w.mesh.position.x, w.mesh.position.y, w.mesh.position.z, w.box.minX, w.box.minY, w.box.minZ, w.box.maxX, w.box.maxZ].map((v) => Math.round(v * 1000) / 1000), w.dir, w.mask]) });
  }
  // A player's PC: the host's builds, mirrored (new pieces made, gone ones removed, an edited one rebuilt).
  applyWalls(list) {
    const want = new Map(list.map((e) => [e[0], e]));
    for (const w of this.walls.slice()) {
      const e = want.get(w.id);
      if (e && e[11] === w.dir && e[12] === w.mask) { want.delete(w.id); continue; }
      this.disposePiece(w); this.walls.splice(this.walls.indexOf(w), 1);
    }
    for (const [id, kind, x, y, z, minX, minY, minZ, maxX, maxZ, , dir, mask] of want.values()) {
      const isWall = kind === 'wall', w = maxX - minX, d = maxZ - minZ;
      const box = { minX, maxX, minY, maxY: minY + (isWall ? WALL_HEIGHT : platformHeight(kind)), minZ, maxZ };
      const mesh = new THREE.Group();
      this.arena.scene.add(mesh);
      const piece = { id, kind, box, bounds: new THREE.Box3(new THREE.Vector3(box.minX, box.minY, box.minZ), new THREE.Vector3(box.maxX, box.maxY, box.maxZ)), mesh, owner: null, hp: WALL_HP, dir, startDir: dir, level: 1, mask };
      if (isWall) { this.makeWall(piece, (minX + maxX) / 2, minY, (minZ + maxZ) / 2, w, d); piece.mesh.children.forEach((t, i) => { t.visible = !!(mask & (1 << i)); }); }   // (an edited wall: its kept panels)
      else { mesh.position.set(x, y, z); platformMeshes(piece, this.wallMat); }
      this.walls.push(piece);
    }
    this.syncWalls();
  }

  occupied(box, builder = null) {
    return this.battle.fighters.some(g => g !== builder && g.alive && overlaps(box, {
      minX:g.x-.45, maxX:g.x+.45, minZ:g.z-.45, maxZ:g.z+.45, minY:g.y, maxY:g.y+1.75,
    }));
  }

  aimAt(wall, human) {
    const ray = this.aimRay;
    ray.origin.copy(human.camera.position);
    human.camera.getWorldDirection(ray.direction);
    let point = ray.intersectBox(wall.bounds, this.aimPoint);
    if (point && wall.kind !== 'wall') {
      wall.mesh.updateMatrixWorld(true);
      this.platformRay.ray.copy(ray);
      this.platformRay.far = 5;
      point = this.platformRay.intersectObjects(wall.mesh.children, false)[0]?.point;
    }
    if (!point) return null;
    const distance = point.distanceTo(ray.origin);
    if (distance > 5) return null;
    if (!this.arena.sightLine(ray.origin.toArray(), ray.at(Math.max(0, distance - .08), this.aimEnd).toArray())) {
      this.arena.raycast(ray.origin.toArray(),ray.direction.toArray(),distance);
      if (this.impactWalls[this.arena.world.hit - this.arena.baseBoxCount] !== wall) return null;
    }
    return point;
  }

  edit(human) {
    if (this.client) { this.notify('Editing builds works in offline games'); return; }
    if (this.editing) { this.cancelEdit(); return; }
    this.editing = this.walls.find(wall => wall.owner === human.f && this.aimAt(wall, human));
    this.holding = false;
    if (!this.editing) { this.notify('Aim at a build to edit'); return; }
    this.editMask = this.editing.mask;
    this.editDir = this.editing.dir;
    this.noticeUntil = 0;
    human.in.fire = human.in.ads = false;
    human.weapon.releaseTrigger();
    this.previewEdit();
  }

  applyEdit() {
    const wall = this.editing;
    if (!wall) return;
    if (!this.editMask && wall.kind !== 'cone') { this.notify('Keep at least one panel'); return; }
    const added = this.editMask & ~wall.mask;
    const changed = wall.mask !== this.editMask || wall.dir !== this.editDir;
    const blocked = wall.kind === 'wall' ? wall.cells.some((box, i) => (added & (1 << i)) && this.occupied(box))
      : changed && platformSolids(wall,this.editMask,this.editDir).some(box => this.occupied(box));
    if (blocked) {
      this.notify('A fighter is blocking that edit');
      return;
    }
    wall.mask = this.editMask;
    wall.dir = this.editDir;
    if (changed && wall.kind !== 'wall') platformMeshes(wall,this.wallMat);
    this.cancelEdit();
    if (changed) this.syncWalls();
  }

  aimedPanel(human) {
    const wall = this.editing, p = this.aimAt(wall, human);
    if (!p) return -1;
    if (wall.kind !== 'wall') {
      wall.mesh.worldToLocal(p);
      return Number(p.x >= 0) + 2 * Number(p.z >= 0);
    }
    const box = wall.box;
    const u = wall.acrossX ? (p.x - box.minX) / (box.maxX - box.minX) : (p.z - box.minZ) / (box.maxZ - box.minZ);
    const index = n => Math.max(0, Math.min(GRID - 1, Math.floor(n * GRID)));
    return index((p.y - box.minY) / WALL_HEIGHT) * GRID + index(u);
  }

  dragEdit(down) {
    if (!down) {
      if (!this.editDragging) return;
      this.previewEdit();
      this.editDragging = false;
      if (this.draggedPanels) this.applyEdit();
      return;
    }
    this.editDragging = down;
    this.draggedPanels = 0;
    this.previewEdit();
  }

  resetEdit() {
    this.editMask = this.editing.kind === 'wall' ? FULL_WALL : PLATFORM_MASK;
    this.editDir = this.editing.startDir;
    this.applyEdit();
  }

  // The reset key without the editor: the build you aim at goes back to how it was built.
  quickReset(human) {
    if (this.editing) { this.resetEdit(); return; }
    const piece = this.walls.find(w => w.owner === human.f && this.aimAt(w, human));
    if (!piece) { this.notify('Aim at one of your builds to reset it'); return; }
    if (piece.mask === (piece.kind === 'wall' ? FULL_WALL : PLATFORM_MASK) && piece.dir === piece.startDir) { this.notify('Nothing to reset'); return; }
    this.editing = piece;
    this.resetEdit();
    if (this.editing === piece) this.cancelEdit();         // a fighter was in the way: it stays as it is
    else this.notify('Edit reset');
  }

  rotateEdit() { if (this.editing.kind === 'ramp') { this.editDir = (this.editDir + 1) % 4; this.applyEdit(); } }

  editPreset(index) {
    const preset = EDIT_PRESETS[this.editing.kind][index];
    if (!preset) return;
    const [,mask,turn=0] = preset;
    this.editMask = mask;
    this.editDir = (this.editing.dir + turn) % 4;
    this.applyEdit();
  }

  previewEdit() {
    const wall = this.editing, human = this.battle.humans[0];
    if (!wall) return;
    if (human.camera.position.distanceTo(wall.mesh.position) > 6) { this.cancelEdit(); return; }
    if (wall.kind !== 'wall') wall.mesh.rotation.y = this.editDir * Math.PI / 2;
    const focus = this.aimedPanel(human);
    if (this.editDragging && focus >= 0 && !(this.draggedPanels & (1 << focus))) {
      this.draggedPanels |= 1 << focus;
      this.editMask ^= 1 << focus;
    }
    wall.mesh.children.forEach((tile, i) => {
      tile.visible = true;
      tile.material = i === focus ? this.editFocus : this.editMask & (1 << i) ? this.editKeep : this.editRemove;
    });
  }

  cancelEdit() {
    if (!this.editing) return;
    const piece = this.editing;
    if (piece.kind !== 'wall') piece.mesh.rotation.y = piece.dir * Math.PI / 2;
    piece.mesh.children.forEach((tile, i) => {
      tile.visible = piece.kind === 'cone' || Boolean(piece.mask & (1 << i));
      tile.material = this.wallMat;
    });
    this.editing = null;
    this.editDragging = false;
  }

  notify(message) {
    this.notice = message;
    this.noticeUntil = this.elapsed + 3.5;
    this.updateHud();
  }

  updateHud() {
    const b = this.battle, f = b.humans[0].f;
    const alive = b.fighters.filter(g => g.alive).length;
    const bind = id => b.deps.controls.bindingLabel(id);
    const direction = (x, z) => {
      const bearing = Math.atan2(x - f.x, f.z - z) * 180 / Math.PI - f.yaw;
      return '↑↗→↘↓↙←↖'[(Math.round(bearing / 45) % 8 + 8) % 8];
    };
    const zone = this.outside(f) ? direction(this.x, this.z) + ' Outside safe zone' : this.elapsed < 20
      ? 'Zone shrinks in ' + Math.ceil(20 - this.elapsed) + 's' : 'Safe zone · ' + Math.ceil(this.radius) + ' m';
    const chest = this.nearby(f);
    const loot = !b.humans[0].gun && this.nearestChest(f);
    const p = loot && loot.position;
    const hint = p ? ' · ' + direction(p.x, p.z) + ' Chest ' + Math.round(Math.hypot(p.x - f.x, p.z - f.z)) + ' m' : '';
    this.previewEdit();
    const status = !f.alive ? 'Eliminated · Waiting for the last survivor' : this.elapsed < this.noticeUntil ? this.notice
      : this.editing ? bind('fire') + ' Drag, release to apply · ' + bind('recall') + ' Reset · ' + bind('ads') + ' Cancel'
        + (this.editing.kind === 'ramp' ? ' · ' + bind('reload') + ' Rotate' : '')
        + '\n' + EDIT_PRESETS[this.editing.kind].map(([name],i) => (i+1) + ' ' + name).join(' · ')
      : chest ? bind('interact') + ' Open ' + (chest.pirate ? 'Pirate Chest' : 'chest')
      : (b.humans[0].gun ? bind('knife') : bind('fire')) + ' Pickaxe · ' + bind('underbarrel') + (this.preview ? ' Back to shooting · ' + bind('fire') + ' Build (hold to keep building) ' : ' Build mode ') + this.piece
        + ' · ' + bind('zero') + ' Change piece · ' + bind('ability') + ' Edit · ' + bind('recall') + ' Reset edit'
        + (this.preview && this.piece === 'ramp' ? ' · Look down: ramp under you' : '') + hint;
    const score = alive + ' left · ' + zone;
    const mats = this.materials + ' mats';
    if (this.matCount.textContent !== mats) this.matCount.textContent = mats;
    if (b.hud.score.textContent !== score) b.hud.score.textContent = score;
    if (b.hud.royale.textContent !== status) b.hud.royale.textContent = status;
    b.hud.royale.hidden = false;
  }

  dispose() {
    this.ring.removeFromParent();
    this.pickaxe.removeFromParent();
    this.blueprint.removeFromParent();
    this.hotbar.remove();
    if (this.ghost) { for (const c of this.ghost.children) c.geometry.dispose(); this.ghost.removeFromParent(); }
    for (const f of this.battle.fighters) if (f.drop) { f.drop.chute.removeFromParent(); f.drop = null; }
    for (const mesh of [this.chestBodies,this.chestStraps]) { mesh.removeFromParent(); mesh.dispose(); }
    for (const p of this.pops || []) { p.g.removeFromParent(); p.g.traverse(o => o.geometry?.dispose()); for (const m of p.mats) m.dispose(); }
    for (const piece of this.walls) this.disposePiece(piece);
    if (this.walls.length) this.arena.setBuilds([]);
    for (const resource of this.resources) resource.dispose();
    this.battle.hud.royale.hidden = true;
  }

  disposePiece(piece) {
    piece.mesh.removeFromParent();
    if (piece.geometry) piece.geometry.dispose();
    else for (const mesh of piece.mesh.children) mesh.geometry.dispose();
  }
}
