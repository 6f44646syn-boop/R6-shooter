import * as THREE from '../../vendor/three/three.module.min.js?v=189fea0-mwc1zla2';
import { ROYALE_BOTS } from './royale-map.js?v=189fea0-mwc1zla2';
import { PLATFORM_HALF, PLATFORM_MASK, RAMP_RISE, platformHeight, platformMeshes, platformSolids } from './royale-platform.js?v=189fea0-mwc1zla2';

const TOKEN_CHANCE = 0.001;
const CHEST_MATERIALS = 6;
const WALL_HP = 130;
const WALL_HEIGHT = 2.7;
const GRID = 3;
const FULL_WALL = (1 << GRID ** 2) - 1;
const PIECES = ['wall', 'ramp', 'cone'];
const MAX_RAMPS = 10;
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
    this.token = false;
    this.noticeUntil = 0;
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
    this.hotbar = document.createElement('div');
    this.hotbar.className = 'royale-hotbar';
    this.hotbar.setAttribute('aria-label', 'Battle Royale inventory');
    battle.hud.root.append(this.hotbar);
    this.renderInventory();
  }

  point(x, z) {
    const a = this.arena, i = a.world.nearestNode(x, z, 0);
    return { x:a.nodeX[i], y:a.nodeY[i], z:a.nodeZ[i] };
  }

  outside(f, margin = 0) { return Math.hypot(f.x - this.x, f.z - this.z) > this.radius - margin; }

  advance(dt) {
    this.elapsed += dt;
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
    this.takeChest(chest, f);
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
    const hidden = this.hiddenChestMatrix ||= new THREE.Matrix4().makeTranslation(0,-1000,0);
    this.chestBodies.setMatrixAt(chest.i,hidden);
    this.chestStraps.setMatrixAt(chest.i*2,hidden);
    this.chestStraps.setMatrixAt(chest.i*2+1,hidden);
    this.chestBodies.instanceMatrix.needsUpdate = this.chestStraps.instanceMatrix.needsUpdate = true;
    f.nades = Math.min(2, f.nades + 1);
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
      this.materials++;
      this.notify('+1 wall material');
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

  build(f, yaw, selected = this.piece) {
    const player = f === this.battle.humans[0].f;
    if (!(player ? this.materials : f.buildMaterials) || !f.alive) return;
    const { arena } = this;
    const kind = player ? selected : 'wall', isWall = kind === 'wall';
    const angle = yaw * Math.PI / 180, dx = Math.sin(angle), dz = -Math.cos(angle);
    const distance = isWall ? 1.7 : (PLATFORM_HALF+.78) / Math.max(Math.abs(dx),Math.abs(dz));
    const dir = -Math.round(yaw / 90);
    const forwardX = -Math.round(Math.sin(dir * Math.PI/2)), forwardZ = -Math.round(Math.cos(dir * Math.PI/2));
    const previous = kind === 'ramp' && this.walls.find(ramp => {
      if (ramp.kind !== 'ramp' || (ramp.dir-dir)%4 !== 0) return false;
      const p = ramp.mesh.position, px = f.x - p.x, pz = f.z - p.z;
      const forward = px*forwardX + pz*forwardZ;
      return forward >= .15 && forward <= PLATFORM_HALF+.08
        && Math.abs(px*forwardZ-pz*forwardX) < PLATFORM_HALF+.2
        && Math.abs(f.y - (p.y+RAMP_RISE)) <= .55;
    });
    if (previous && previous.level >= MAX_RAMPS) { this.notify('10-ramp height limit'); return; }
    const x = previous ? previous.mesh.position.x + forwardX * PLATFORM_HALF*2 : Math.round((f.x + dx * distance) * 2) / 2;
    const z = previous ? previous.mesh.position.z + forwardZ * PLATFORM_HALF*2 : Math.round((f.z + dz * distance) * 2) / 2;
    const w = isWall ? (Math.abs(dx) > Math.abs(dz) ? .32 : 2.8) : PLATFORM_HALF * 2;
    const d = isWall ? (w > 1 ? .32 : 2.8) : w;
    const y = previous ? previous.mesh.position.y + RAMP_RISE : arena.groundAt(x, z, f.y);
    const box = { minX:x-w/2, maxX:x+w/2, minY:y, maxY:y+(isWall ? WALL_HEIGHT : platformHeight(kind)), minZ:z-d/2, maxZ:z+d/2 };
    const blocked = (!previous && Math.abs(y - f.y) > .45) || box.maxY >= (arena.map.ceiling ? arena.wallH : Infinity)
      || box.minX <= -arena.hx || box.maxX >= arena.hx || box.minZ <= -arena.hz || box.maxZ >= arena.hz
      || arena.boxes.some(other => overlaps(box, other))
      || !arena.sightLine([f.x, f.y + 1.2, f.z], [x, y + .7, z])
      || this.occupied(box, previous ? f : null);
    if (blocked) { if (player) this.notify('Build needs clear space'); return; }
    const mesh = new THREE.Group();
    const bounds = new THREE.Box3(new THREE.Vector3(box.minX, box.minY, box.minZ),
      new THREE.Vector3(box.maxX, box.maxY, box.maxZ));
    arena.scene.add(mesh);
    const piece = { kind, box, bounds, mesh, owner:f, hp:WALL_HP, dir, startDir:dir, level:(previous?.level || 0)+1, mask:isWall ? FULL_WALL : PLATFORM_MASK };
    if (isWall) this.makeWall(piece, x, y, z, w, d);
    else {
      mesh.position.set(x,y,z);
      platformMeshes(piece,this.wallMat);
    }
    this.walls.push(piece);
    if (player) this.materials--;
    else f.buildMaterials--;
    this.syncWalls();
    return piece;
  }

  cyclePiece() {
    this.piece = PIECES[(PIECES.indexOf(this.piece) + 1) % PIECES.length];
    this.noticeUntil = 0;
    this.updateHud();
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
    this.syncWalls();
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
    if (this.editing) { this.cancelEdit(); return; }
    this.editing = this.walls.find(wall => wall.owner === human.f && this.aimAt(wall, human));
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
      : (b.humans[0].gun ? bind('knife') : bind('fire')) + ' Pickaxe · ' + bind('underbarrel') + ' Build ' + this.piece
        + ' · ' + bind('zero') + ' Change piece · ' + bind('ability') + ' Edit' + hint;
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
    this.hotbar.remove();
    for (const mesh of [this.chestBodies,this.chestStraps]) { mesh.removeFromParent(); mesh.dispose(); }
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
