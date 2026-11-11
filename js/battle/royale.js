import * as THREE from '../../vendor/three/three.module.min.js?v=9dd0f7b-mwbioun8';

const TOKEN_CHANCE = 0.001;
const WALL_HP = 130;
const WALL_HEIGHT = 2.7;
const GRID = 3;
const FULL_WALL = (1 << GRID ** 2) - 1;
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX
  && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;

export class BattleRoyale {
  constructor(battle, rng = Math.random) {
    this.battle = battle;
    const { arena, deps } = battle;
    this.arena = arena;
    this.elapsed = 0;
    this.materials = 2;
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
    const chestMat = new THREE.MeshStandardMaterial({ color: 0x63472b, roughness: .8 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xe4aa49, emissive: 0x5e3507, metalness: .45 });
    const pirateMat = new THREE.MeshStandardMaterial({ color: 0x6e237e, emissive: 0x672674, metalness: .4 });
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0x96704d, roughness: .9 });
    this.editKeep = new THREE.MeshBasicMaterial({ color: 0x64c7ff, transparent: true, opacity: .65 });
    this.editRemove = new THREE.MeshBasicMaterial({ color: 0xff917d, transparent: true, opacity: .34, wireframe: true });
    this.editFocus = new THREE.MeshBasicMaterial({ color: 0xffdf91, transparent: true, opacity: .74 });
    this.aimRay = new THREE.Ray();
    this.aimPoint = new THREE.Vector3();
    this.aimEnd = new THREE.Vector3();
    const ringGeo = new THREE.RingGeometry(.987, 1, 96);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xb989ff, side: THREE.DoubleSide, depthWrite: false });
    this.resources = [chestGeo, trimGeo, chestMat, goldMat, pirateMat, this.wallMat,
      this.editKeep, this.editRemove, this.editFocus, ringGeo, ringMat];
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.position.set(this.x, .07, this.z);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.scale.setScalar(this.radius);
    arena.scene.add(this.ring);

    const count = 8;
    const pirateIndex = rng() < TOKEN_CHANCE ? Math.floor(rng() * count) : -1;
    this.chests = Array.from({ length: count }, (_, i) => {
      const angle = i * Math.PI * 2 / count;
      const k = arena.world.nearestNode(Math.cos(angle) * arena.hx * .59, Math.sin(angle) * arena.hz * .59, 0);
      const pirate = i === pirateIndex;
      const group = new THREE.Group();
      const body = new THREE.Mesh(chestGeo, pirate ? pirateMat : chestMat);
      body.castShadow = true;
      group.add(body);
      for (const x of [-.25, .25]) {
        const strap = new THREE.Mesh(trimGeo, goldMat);
        strap.position.x = x;
        group.add(strap);
      }
      group.position.set(arena.nodeX[k], arena.nodeY[k] + .31, arena.nodeZ[k]);
      arena.scene.add(group);
      return { group, pirate, gun: deps.guns[Math.floor(rng() * deps.guns.length)], opened: false };
    });
    this.updateHud();
  }

  outside(f, margin = 0) { return Math.hypot(f.x - this.x, f.z - this.z) > this.radius - margin; }

  advance(dt) {
    this.elapsed += dt;
    const shrink = Math.max(0, Math.min(1, (this.elapsed - 20) / 160));
    const collapse = Math.max(0, Math.min(1, (this.elapsed - 190) / 25));
    this.radius = (this.startRadius * (1 - shrink) + 3 * shrink) * (1 - collapse);
    this.ring.scale.setScalar(Math.max(.01, this.radius));
  }

  nearby(f) {
    if (!f?.alive) return null;
    return this.chests.find(({ opened, group }) => {
      const p = group.position;
      return !opened && Math.abs(f.y - (p.y - .31)) < .8 && Math.hypot(f.x - p.x, f.z - p.z) < 2.2
        && this.arena.sightLine([f.x, f.y + 1.2, f.z], [p.x, p.y + .35, p.z]);
    });
  }

  open(f) {
    const chest = this.nearby(f);
    if (!chest) return false;
    chest.opened = true;
    chest.group.removeFromParent();
    this.materials += 2;
    this.battle.changeGun(chest.gun);
    if (chest.pirate) {
      this.token = true;
      this.battle.deps.onPirateToken();
    }
    this.notify(chest.pirate ? 'Pirate Token found · All Black Ice skins unlocked' : chest.gun.name + ' · +2 walls');
    return true;
  }

  build(f, yaw) {
    if (!this.materials || !f.alive) return;
    const { arena } = this;
    const angle = yaw * Math.PI / 180, dx = Math.sin(angle), dz = -Math.cos(angle);
    const x = Math.round((f.x + dx * 2.5) * 2) / 2, z = Math.round((f.z + dz * 2.5) * 2) / 2;
    const w = Math.abs(dx) > Math.abs(dz) ? .32 : 2.8, d = w > 1 ? .32 : 2.8;
    const y = arena.groundAt(x, z, f.y);
    const box = { minX:x-w/2, maxX:x+w/2, minY:y, maxY:y+WALL_HEIGHT, minZ:z-d/2, maxZ:z+d/2 };
    const blocked = Math.abs(y - f.y) > .45 || box.maxY >= (arena.map.ceiling ? arena.wallH : Infinity)
      || box.minX <= -arena.hx || box.maxX >= arena.hx || box.minZ <= -arena.hz || box.maxZ >= arena.hz
      || arena.boxes.some(other => overlaps(box, other))
      || !arena.sightLine([f.x, f.y + 1.2, f.z], [x, y + .7, z])
      || this.occupied(box);
    if (blocked) { this.notify('Wall needs clear space'); return; }
    const acrossX = w > d, cw = acrossX ? w / GRID : w, cd = acrossX ? d : d / GRID, ch = WALL_HEIGHT / GRID;
    const mesh = new THREE.Group();
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
    arena.scene.add(mesh);
    const bounds = new THREE.Box3(new THREE.Vector3(box.minX, box.minY, box.minZ),
      new THREE.Vector3(box.maxX, box.maxY, box.maxZ));
    this.walls.push({ box, bounds, acrossX, cells, mask:FULL_WALL, mesh, geometry, hp:WALL_HP });
    this.materials--;
    this.syncWalls();
  }

  damageWall(wall, damage) {
    wall.hp -= damage;
    if (wall.hp > 0) return;
    if (this.editing === wall) this.cancelEdit();
    wall.mesh.removeFromParent();
    wall.geometry.dispose();
    this.walls.splice(this.walls.indexOf(wall), 1);
    this.syncWalls();
  }

  syncWalls() {
    const solids = [];
    this.impactWalls = [];
    for (const wall of this.walls) {
      const pieces = wall.mask === FULL_WALL ? [wall.box] : wall.cells.filter((_, i) => wall.mask & (1 << i));
      for (const piece of pieces) { solids.push(piece); this.impactWalls.push(wall); }
    }
    this.arena.setBuilds(solids);
  }

  occupied(box) {
    return this.battle.fighters.some(g => g.alive && overlaps(box, {
      minX:g.x-.45, maxX:g.x+.45, minZ:g.z-.45, maxZ:g.z+.45, minY:g.y, maxY:g.y+1.75,
    }));
  }

  aimAt(wall, human) {
    const ray = this.aimRay;
    ray.origin.copy(human.camera.position);
    human.camera.getWorldDirection(ray.direction);
    const point = ray.intersectBox(wall.bounds, this.aimPoint);
    if (!point) return null;
    const distance = point.distanceTo(ray.origin);
    if (distance > 5 || !this.arena.sightLine(ray.origin.toArray(), ray.at(Math.max(0, distance - .03), this.aimEnd).toArray())) return null;
    return point;
  }

  edit(human) {
    if (!this.editing) {
      this.editing = this.walls.find(wall => this.aimAt(wall, human));
      if (!this.editing) { this.notify('Aim at your wall to edit'); return; }
      this.editMask = this.editing.mask;
      human.in.fire = human.in.ads = false;
      human.weapon.releaseTrigger();
      this.previewEdit();
      return;
    }
    const wall = this.editing;
    if (!this.editMask) { this.notify('Keep at least one panel'); return; }
    const added = this.editMask & ~wall.mask;
    if (wall.cells.some((box, i) => (added & (1 << i)) && this.occupied(box))) {
      this.notify('A fighter is blocking that edit');
      return;
    }
    const changed = wall.mask !== this.editMask;
    wall.mask = this.editMask;
    this.cancelEdit();
    if (changed) this.syncWalls();
  }

  aimedPanel(human) {
    const wall = this.editing, p = this.aimAt(wall, human);
    if (!p) return -1;
    const box = wall.box;
    const u = wall.acrossX ? (p.x - box.minX) / (box.maxX - box.minX) : (p.z - box.minZ) / (box.maxZ - box.minZ);
    const index = n => Math.max(0, Math.min(GRID - 1, Math.floor(n * GRID)));
    return index((p.y - box.minY) / WALL_HEIGHT) * GRID + index(u);
  }

  dragEdit(down) {
    this.editDragging = down;
    this.draggedPanels = 0;
    this.previewEdit();
  }

  resetEdit() { this.editMask = FULL_WALL; this.previewEdit(); }

  previewEdit() {
    const wall = this.editing, human = this.battle.humans[0];
    if (!wall) return;
    if (human.camera.position.distanceTo(wall.mesh.position) > 6) { this.cancelEdit(); return; }
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
    this.editing.mesh.children.forEach((tile, i) => {
      tile.visible = Boolean(this.editing.mask & (1 << i));
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
    const bearing = Math.atan2(this.x - f.x, f.z - this.z) * 180 / Math.PI - f.yaw;
    const arrow = '↑↗→↘↓↙←↖'[(Math.round(bearing / 45) % 8 + 8) % 8];
    const zone = this.outside(f) ? arrow + ' Outside safe zone' : this.elapsed < 20
      ? 'Zone shrinks in ' + Math.ceil(20 - this.elapsed) + 's' : 'Safe zone · ' + Math.ceil(this.radius) + ' m';
    const chest = this.nearby(f);
    this.previewEdit();
    const status = !f.alive ? 'Eliminated · Waiting for the last survivor' : this.elapsed < this.noticeUntil ? this.notice
      : this.editing ? bind('fire') + ' Select / drag · ' + bind('ability') + ' Confirm · ' + bind('recall') + ' Reset · ' + bind('ads') + ' Cancel'
      : chest ? bind('interact') + ' Open ' + (chest.pirate ? 'Pirate Chest' : 'chest')
      : bind('underbarrel') + ' Build wall · ' + bind('ability') + ' Edit wall';
    const score = alive + ' left · ' + zone + ' · ' + this.materials + ' walls';
    if (b.hud.score.textContent !== score) b.hud.score.textContent = score;
    if (b.hud.royale.textContent !== status) b.hud.royale.textContent = status;
    b.hud.royale.hidden = false;
  }

  dispose() {
    this.ring.removeFromParent();
    for (const chest of this.chests) chest.group.removeFromParent();
    for (const { mesh, geometry } of this.walls) { mesh.removeFromParent(); geometry.dispose(); }
    if (this.walls.length) this.arena.setBuilds([]);
    for (const resource of this.resources) resource.dispose();
    this.battle.hud.royale.hidden = true;
  }
}
