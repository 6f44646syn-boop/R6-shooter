// Touch play (phones and tablets): a move stick on the left, drag anywhere else to look, and buttons
// for the main actions. It drives the same hooks as a controller (padHooks in main.js: playing,
// onAction(id, down), look(degX, degY), start()), so every mode works with it. Fire can be dragged
// to aim while shooting. Aim and Crouch are toggles (a held thumb would cover the screen).
const BUTTONS = [
  ['fire', 'Fire', 'big'], ['ads', 'Aim', 'toggle'], ['reload', 'Reload'], ['crouch', 'Crouch', 'toggle'],
  ['vault', 'Jump'], ['interact', 'Use'], ['grenade', 'Nade'], ['ability', 'Ability'], ['sprint', 'Sprint', 'toggle'],
];
const STICK_R = 56;            // px from the stick's centre to full deflection
// shortcut: one fixed look speed for every phone; add a slider in Settings if players ask for one
const LOOK_DEG_PER_PX = 0.22;

export class Touch {
  constructor(hooks) {
    this.hooks = hooks;
    this.phone = matchMedia('(pointer: coarse)').matches;   // a touch-first device (phone, tablet): always on
    this.usedAt = this.phone ? Infinity : -1e9;
    this.held = new Set();
    addEventListener('touchstart', () => { this.usedAt = performance.now(); }, { capture: true, passive: true });
    addEventListener('mousedown', () => { if (this.usedAt !== Infinity) this.usedAt = -1e9; }, true);   // the mouse took over
    const el = this.el = document.createElement('div');
    el.id = 'touch'; el.hidden = true;
    el.innerHTML = '<div class="t-look"></div><div class="t-stick"><i></i></div><button type="button" class="t-pause" aria-label="Pause">II</button><div class="t-btns"></div>';
    document.body.append(el);
    this.stickEl = el.querySelector('.t-stick'); this.knob = this.stickEl.querySelector('i');
    for (const [id, label, kind] of BUTTONS) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.dataset.act = id; if (kind) b.className = 't-' + kind;
      el.querySelector('.t-btns').append(b);
    }
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, (e) => this.up(e));
    this.ptr = new Map();      // pointerId -> { kind: 'stick' | 'look' | 'btn', x, y, ox, oy, b }
  }
  recent(now = performance.now()) { return now - this.usedAt < 4000; }

  act(id, on) {
    if (on === this.held.has(id)) return;
    if (on) this.held.add(id); else this.held.delete(id);
    this.hooks.onAction(id, on);
  }
  down(e) {
    e.preventDefault();
    const t = e.target, p = { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY };
    if (t.classList.contains('t-pause')) { this.release(); this.hooks.start(); return; }
    const id = t.dataset?.act;
    if (id) {
      p.kind = 'btn'; p.b = t;
      if (t.classList.contains('t-toggle')) this.act(id, !this.held.has(id));
      else this.act(id, true);
      t.classList.toggle('on', this.held.has(id));
    } else p.kind = t.closest('.t-stick') || e.clientX < innerWidth * 0.4 ? 'stick' : 'look';
    this.ptr.set(e.pointerId, p);
    if (p.kind === 'stick') { Object.assign(this.stickEl.style, { left: e.clientX - STICK_R + 'px', top: e.clientY - STICK_R + 'px', bottom: 'auto' }); this.stick(p); }   // the stick comes to the thumb
  }
  move(e) {
    const p = this.ptr.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (p.kind === 'stick') this.stick(p);
    else if (p.kind === 'look' || p.b?.dataset.act === 'fire') this.hooks.look(dx * LOOK_DEG_PER_PX, dy * LOOK_DEG_PER_PX);
  }
  up(e) {
    const p = this.ptr.get(e.pointerId);
    if (!p) return;
    this.ptr.delete(e.pointerId);
    if (p.kind === 'stick') { p.x = p.ox; p.y = p.oy; this.stick(p); this.stickEl.removeAttribute('style'); }
    if (p.kind === 'btn' && !p.b.classList.contains('t-toggle')) { this.act(p.b.dataset.act, false); p.b.classList.remove('on'); }
  }
  // The stick: on / off per direction past a third of the way (like the controller's left stick).
  stick(p) {
    let x = (p.x - p.ox) / STICK_R, y = (p.y - p.oy) / STICK_R;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    this.knob.style.transform = `translate(${x * STICK_R}px, ${y * STICK_R}px)`;
    this.act('forward', y < -0.35); this.act('back', y > 0.35);
    this.act('left', x < -0.35); this.act('right', x > 0.35);
  }
  release() {
    for (const id of [...this.held]) this.act(id, false);
    for (const b of this.el.querySelectorAll('.on')) b.classList.remove('on');
    this.ptr.clear(); this.knob.style.transform = ''; this.stickEl.removeAttribute('style');
  }
  // Each frame: show the controls while a game is being played on a touch screen.
  frame() {
    const show = this.recent() && this.hooks.playing;
    if (show === !this.el.hidden) return;
    this.el.hidden = !show;
    if (!show) this.release();
  }
}
