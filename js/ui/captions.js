// Sound captions: when the master volume is under 20%, the game's sounds show at the bottom of
// the screen. With many players they are grouped: one line per kind of sound and direction, with
// how many make it, ally or enemy (footsteps), close or far, the loudest first.
const NAMES = { step: 'footsteps', shot: 'Gunshot', blast: 'Explosion', crack: 'Breaching', knife: 'Knife', zap: 'Electric zap' };
const ARROWS = ['↑ ahead', '↗ ahead right', '→ right', '↘ behind right', '↓ behind', '↙ behind left', '← left', '↖ ahead left'];
const HOLD_S = 1.6, ROWS = 4;

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
    this.groups = new Map();                                 // kind + side + way -> { sources: Map(who -> { t, gain }) }
  }
  // gain: how loud it reaches you (0-1); ally: true / false for footsteps, undefined when unknown
  add(kind, source, camera, gain = 0.5, ally) {
    if (Math.hypot(source.x - camera.position.x, source.z - camera.position.z) < 1.5) return;   // (your own steps and shots)
    const way = cueSector(source, camera), side = ally === true ? 'ally' : ally === false ? 'enemy' : '';
    const key = kind + side + way, now = performance.now() / 1000;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = { kind, side, way, sources: new Map() }));
    // who made it: their id, else where they stand (a 3 m square), so several players count apart
    g.sources.set(source.id ?? Math.round(source.x / 3) + ',' + Math.round(source.z / 3), { t: now, gain });
    this._render(now);
    if (!this.timer) this.timer = setInterval(() => this._render(performance.now() / 1000), 250);
  }
  _render(now) {
    const live = [];
    for (const [k, g] of this.groups) {
      for (const [w, s] of g.sources) if (now - s.t > HOLD_S) g.sources.delete(w);
      if (!g.sources.size) { this.groups.delete(k); continue; }
      live.push({ g, gain: Math.max(...[...g.sources.values()].map((s) => s.gain)), n: g.sources.size });
    }
    live.sort((a, b) => b.gain - a.gain);
    this.root.replaceChildren(...live.slice(0, ROWS).map(({ g, gain, n }) => {
      const row = document.createElement('div');
      row.className = 'cue' + (g.side ? ' cue-' + g.side : '') + (gain > 0.35 ? ' cue-close' : '');
      const name = g.kind === 'step' ? (g.side === 'ally' ? 'Ally footsteps' : g.side === 'enemy' ? 'Enemy footsteps' : 'Footsteps') : NAMES[g.kind] || g.kind;
      row.textContent = ARROWS[g.way].split(' ')[0] + ' ' + name + (n > 1 ? ' ×' + n : '') + ' · ' + ARROWS[g.way].slice(2) + ' · ' + (gain > 0.35 ? 'close' : 'far');
      return row;
    }));
    this.root.hidden = !live.length;
    if (!live.length) { clearInterval(this.timer); this.timer = null; }
  }
}
