// Optional mini map (Settings > Video): a round radar in the top-left corner, centred on you and
// turned so that up is the way you face. Walls on your floor, your teammates, and enemies for
// 2 s after they fire (they are not shown otherwise).
const R = 84, RANGE = 32, DEG = Math.PI / 180;

export class Minimap {
  constructor(root) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.width = this.canvas.height = R * 2;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    root.append(this.canvas);
  }
  hide() { this.canvas.hidden = true; }
  // walls: boxes as { minX, maxX, minZ, maxZ, minY, maxY } or the Bomb maps' { x0, z0, x1, z1, y0, h }
  // me: { x, y, z, yaw (degrees) }; friends / foes: [{ x, z }]
  draw(walls, me, friends, foes) {
    const g = this.canvas.getContext('2d'), k = R / RANGE;
    this.canvas.hidden = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, R * 2, R * 2);
    g.save();
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.fillStyle = 'rgba(10, 16, 24, 0.72)'; g.fill(); g.clip();
    g.translate(R, R); g.rotate(-me.yaw * DEG); g.scale(k, k); g.translate(-me.x, -me.z);
    g.fillStyle = 'rgba(150, 175, 200, 0.55)';
    const y = me.y || 0;
    for (const w of walls) {
      if (w.alive === false) continue;                          // a broken wall or door
      const x0 = w.minX ?? Math.min(w.x0, w.x1), x1 = w.maxX ?? Math.max(w.x0, w.x1);
      const z0 = w.minZ ?? Math.min(w.z0, w.z1), z1 = w.maxZ ?? Math.max(w.z0, w.z1);
      const bottom = w.minY ?? w.y0 ?? 0, top = w.maxY ?? bottom + (w.h ?? 3);
      if (bottom > y + 2 || top < y + 0.4) continue;          // another floor, or flat on the ground
      if (Math.abs((x0 + x1) / 2 - me.x) > RANGE + 20 || Math.abs((z0 + z1) / 2 - me.z) > RANGE + 20) continue;
      g.fillRect(x0, z0, Math.max(0.25, x1 - x0), Math.max(0.25, z1 - z0));
    }
    const dot = (p, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(p.x, p.z, r / k, 0, Math.PI * 2); g.fill(); };
    for (const p of friends) dot(p, '#5fb8ff', 4);
    for (const p of foes) dot(p, '#ff5a4a', 4.5);
    g.restore();
    // you: an arrow pointing up
    g.fillStyle = '#ffd36a';
    g.beginPath(); g.moveTo(R, R - 8); g.lineTo(R + 6, R + 6); g.lineTo(R, R + 2); g.lineTo(R - 6, R + 6); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)'; g.lineWidth = 2;
    g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2); g.stroke();
  }
}
