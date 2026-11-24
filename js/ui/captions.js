// Sound captions: when the master volume is under 20%, the game's sounds show at the bottom of
// the screen with the way they come from (footsteps behind you, a shot to the left...).
const NAMES = { step: 'Footsteps', shot: 'Gunshot', blast: 'Explosion', crack: 'Breaching', knife: 'Knife', zap: 'Electric zap' };
const ARROWS = ['↑ ahead', '↗ ahead right', '→ right', '↘ behind right', '↓ behind', '↙ behind left', '← left', '↖ ahead left'];
const HOLD_S = 1.6;

// The way a sound comes from, as one of eight: 0 ahead, 2 right, 4 behind, 6 left (camera's facing, level).
export function cueSector(source, camera) {
  const e = camera.matrixWorld.elements;                     // (the camera looks down its -Z)
  const fx = -e[8], fz = -e[10], dx = source.x - camera.position.x, dz = source.z - camera.position.z;
  const ang = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);   // + to the right
  return ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
}

export class Captions {
  constructor(parent) {
    this.root = document.createElement('div');
    this.root.className = 'captions';
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
    parent.append(this.root);
    this.rows = new Map();                                   // kind + way -> { el, until }
  }
  add(kind, source, camera) {
    if (Math.hypot(source.x - camera.position.x, source.z - camera.position.z) < 1.5) return;   // (your own steps and shots)
    const way = ARROWS[cueSector(source, camera)], key = kind + way, now = performance.now() / 1000;
    let row = this.rows.get(key);
    if (!row) {
      row = { el: document.createElement('div') };
      row.el.textContent = (NAMES[kind] || kind) + ' ' + way;
      this.root.append(row.el);
      this.rows.set(key, row);
    }
    row.until = now + HOLD_S;
    this.root.hidden = false;
    if (!this.timer) this.timer = setInterval(() => this._expire(), 250);
  }
  _expire() {
    const now = performance.now() / 1000;
    for (const [k, r] of this.rows) if (now > r.until) { r.el.remove(); this.rows.delete(k); }
    if (!this.rows.size) { this.root.hidden = true; clearInterval(this.timer); this.timer = null; }
  }
}
