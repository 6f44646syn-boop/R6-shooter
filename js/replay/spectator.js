import * as THREE from '../../vendor/three/three.module.min.js?v=077023c-mwdg8dho';

const DEG = Math.PI / 180;
const movement = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'fast', Space: 'up', KeyC: 'down' };
const bound = (n, limit) => Math.max(-limit, Math.min(limit, n));

// Host-side visibility for the view-only feed. A teammate must face the target
// and have a clear eye-to-body ray before the live enemy pose is sent.
export function spectatorVisibility(actors, team, world) {
  const mates = actors.filter(a => a.team === team && a.alive);
  const visible = new Set(actors.filter(a => a.team === team).map(a => a.id));
  for (const enemy of actors) {
    if (!enemy.alive || enemy.team === team) continue;
    for (const mate of mates) {
      const x = enemy.x - mate.x, z = enemy.z - mate.z, distance = Math.hypot(x, z);
      const yaw = mate.yaw * DEG;
      const forward = x * Math.sin(yaw) - z * Math.cos(yaw);
      if (distance > 0.01 && forward < distance * 0.57) continue;
      const eye = [mate.x, mate.y + 1.6 - 0.48 * (mate.crouch || 0), mate.z];
      if (world.sight(eye, [enemy.x, enemy.y + 1.55 - 0.45 * (enemy.crouch || 0), enemy.z])
        || world.sight(eye, [enemy.x, enemy.y + 1.05 - 0.3 * (enemy.crouch || 0), enemy.z])) {
        visible.add(enemy.id);
        break;
      }
    }
  }
  return visible;
}

export class SpectatorTools {
  constructor(root, controls) {
    this.controls = controls;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.03, 300);
    this.camera.rotation.order = 'YXZ';
    this.panel = document.createElement('div');
    this.panel.className = 'watch-panel';
    this.status = document.createElement('p');
    this.map = document.createElement('canvas');
    this.map.width = 800;
    this.map.height = 540;
    this.map.setAttribute('aria-label', 'Overhead map of team positions and sightings');
    this.panel.append(this.map, this.status);
    root.append(this.panel);
    this.reset();
  }

  reset() {
    this.mode = 'follow';
    this.panel.hidden = true;
    this.map.hidden = true;
    this.release();
  }

  release() { this.keys = {}; }

  key(code, down, focus) {
    if (code === 'KeyV' || code === 'KeyM') {
      if (down) {
        const mode = code === 'KeyV' ? 'free' : 'map';
        this.mode = this.mode === mode ? 'follow' : mode;
        if (this.mode === 'free' && focus) {
          this.camera.position.set(focus.x, focus.y + 2, focus.z);
          this.camera.rotation.set(0, -focus.yaw * DEG, 0, 'YXZ');
        }
        this.release();
      }
      return true;
    }
    const action = movement[code];
    if (!action) return false;
    this.keys[action] = down;
    return true;
  }

  look(dx, dy) {
    if (this.mode !== 'free') return;
    this.camera.rotation.y -= dx * 0.0028;
    this.camera.rotation.x = bound(this.camera.rotation.x - dy * 0.0028, Math.PI * 0.49);
  }

  frame(dt, focus, map, actors, team, marks = []) {
    const camera = this.camera;
    this.panel.hidden = false;
    this.map.hidden = this.mode !== 'map';
    const view = this.mode === 'follow' ? 'Following ' + (focus?.name || 'no living teammate')
      : this.mode === 'free' ? 'Free camera · movement to fly, sprint for speed, crouch / vault for height' : 'Overhead map · blue team, orange sighting';
    const free = this.controls?.bindingLabel('recall') || 'V';
    const overhead = this.controls?.bindingLabel('target') || 'M';
    this.status.textContent = view + ' · ' + free + ' free / follow · ' + overhead + ' overhead / follow';
    if (this.mode === 'map') this.drawMap(map, actors, team, marks);
    if (this.mode !== 'free') return null;
    const k = this.keys, yaw = -camera.rotation.y, speed = (k.fast ? 18 : 7) * dt;
    const forward = +!!k.forward - +!!k.back, right = +!!k.right - +!!k.left;
    camera.position.x = bound(camera.position.x + (forward * Math.sin(yaw) + right * Math.cos(yaw)) * speed, map.hx);
    camera.position.z = bound(camera.position.z + (-forward * Math.cos(yaw) + right * Math.sin(yaw)) * speed, map.hz);
    camera.position.y = Math.max(0.2, Math.min(32, camera.position.y + (+!!k.up - +!!k.down) * speed));
    return camera;
  }

  drawMap(map, actors, team, marks) {
    const g = this.map.getContext('2d'), { width, height } = this.map;
    const scale = Math.min((width - 48) / (2 * map.hx), (height - 48) / (2 * map.hz));
    const x = n => width / 2 + n * scale, z = n => height / 2 + n * scale;
    g.fillStyle = '#111b27';
    g.fillRect(0, 0, width, height);
    g.strokeStyle = '#57718b';
    g.strokeRect(x(-map.hx), z(-map.hz), 2 * map.hx * scale, 2 * map.hz * scale);
    g.fillStyle = '#42586e';
    const boxes = map.data?.walls || map.boxes || [];
    for (const wall of boxes) {
      if ((wall.y0 ?? wall.minY ?? 0) >= 2.5) continue;
      const x0 = wall.x0 ?? wall.minX, z0 = wall.z0 ?? wall.minZ;
      const x1 = wall.x1 ?? wall.maxX, z1 = wall.z1 ?? wall.maxZ;
      g.fillRect(x(Math.min(x0, x1)), z(Math.min(z0, z1)), Math.max(1, Math.abs(x1 - x0) * scale), Math.max(1, Math.abs(z1 - z0) * scale));
    }
    const current = new Set(actors.filter(a => a.alive).map(a => a.id));
    for (const mark of marks) if (!current.has(mark.id)) this.dot(g, x(mark.x), z(mark.z), '#a96b40', 4);
    for (const actor of actors) {
      if (!actor.alive) continue;
      const px = x(actor.x), py = z(actor.z);
      this.dot(g, px, py, actor.team === team ? '#76c6ff' : '#ffac68', 5);
      if (actor.team === team) {
        g.fillStyle = '#f4f8ff';
        g.font = '12px sans-serif';
        g.fillText(actor.name, px + 8, py + 4);
      }
    }
  }

  dot(g, x, y, color, radius) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, radius, 0, Math.PI * 2);
    g.fill();
  }
}
