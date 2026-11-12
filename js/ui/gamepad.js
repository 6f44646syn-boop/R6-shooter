// Controller support (Gamepad API, standard layout: Xbox / PlayStation pads in any browser).
// Playing: each button triggers the same action as its key, so every mode works with it; the
// left stick moves and the right stick looks. Menus: the D-pad or left stick moves between
// buttons, A presses, B goes back. Start (Menu / Options) pauses and resumes.
// The button for each action can be changed in Controls & keybinds > Controller.
export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'Left stick press', 'Right stick press', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'];
const START = 9;
export const PAD_ACTIONS = [
  ['fire', 'Fire'], ['ads', 'Aim down sights'], ['sprint', 'Sprint'], ['crouch', 'Crouch'],
  ['vault', 'Vault'], ['reload', 'Reload'], ['interact', 'Interact / plant / defuse'],
  ['leanLeft', 'Lean left'], ['leanRight', 'Lean right'], ['ability', 'Operator ability / drone'],
  ['grenade', 'Throw grenade'], ['knife', 'Knife'], ['inspect', 'Inspect weapon'],
  ['recall', 'Recall drone / build edit'], ['underbarrel', 'Underbarrel / build (Royale)'], ['scoreboard', 'Scoreboard'],
];
const DEFAULTS = { fire: 7, ads: 6, sprint: 10, crouch: 1, vault: 0, reload: 2, interact: 3, leanLeft: 4, leanRight: 5,
  ability: 13, grenade: 12, knife: 11, inspect: 14, recall: 15, underbarrel: -1, scoreboard: 8 };
const STORE = 'recoilRange.pad.v1';
const DZ = 0.18;
const dz = (v) => (Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ));

export class Gamepad {
  constructor() {
    this.binds = { ...DEFAULTS };
    this.lookSpeed = 240;          // degrees a second at full right-stick
    this.invert = false;
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s) {
        for (const [id] of PAD_ACTIONS) if (Number.isInteger(s.binds?.[id]) && s.binds[id] >= -1 && s.binds[id] < 16 && s.binds[id] !== START) this.binds[id] = s.binds[id];
        if (Number.isFinite(s.lookSpeed)) this.lookSpeed = Math.min(600, Math.max(60, s.lookSpeed));
        this.invert = s.invert === true;
      }
    } catch { /* storage blocked: defaults */ }
    this.held = new Set();          // actions held down by the pad
    this.was = [];                  // buttons pressed last poll
    this.usedAt = -1e9;             // last time anything on the pad moved
    this.capture = null;            // (button) => void: waiting for a press to rebind
    this.navAt = 0; this.navDir = 0;
    this.onChange = () => {};
  }
  save() { try { localStorage.setItem(STORE, JSON.stringify({ binds: this.binds, lookSpeed: this.lookSpeed, invert: this.invert })); } catch { /* storage blocked */ } this.onChange(); }
  reset() { this.binds = { ...DEFAULTS }; this.lookSpeed = 240; this.invert = false; this.save(); }
  // One button per action: taking a button from another action leaves that one unbound.
  bind(id, button) {
    if (button === START) return false;
    for (const k in this.binds) if (this.binds[k] === button) this.binds[k] = -1;
    this.binds[id] = button;
    this.save();
    return true;
  }
  label(id) { const b = this.binds[id]; return b >= 0 ? PAD_BUTTONS[b] : 'Unbound'; }
  pad() { for (const p of navigator.getGamepads ? navigator.getGamepads() : []) if (p && p.connected) return p; return null; }
  recent(now = performance.now()) { return now - this.usedAt < 4000; }
  release(onAction) { for (const id of this.held) onAction(id, false); this.held.clear(); }

  // hooks: { playing, onAction(id, down), look(degX, degY), start(), menuMove(dir, sideways), menuPress(), menuBack() }
  poll(dt, hooks, now = performance.now()) {
    const pad = this.pad();
    if (!pad) { this.release(hooks.onAction); this.was = []; return; }
    const b = (i) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
    const pressed = pad.buttons.map((_, i) => b(i)), edge = (i) => pressed[i] && !this.was[i];
    const ax = pad.axes.map(dz);
    if (pressed.some(Boolean) || ax.some((v) => v !== 0)) this.usedAt = now;
    if (this.capture) {
      const i = pressed.findIndex((p, j) => p && !this.was[j] && j !== START);
      if (i >= 0) { const done = this.capture; this.capture = null; done(i); }
      this.was = pressed; return;
    }
    if (edge(START)) hooks.start();
    if (hooks.playing) {
      const want = new Set();
      for (const [id] of PAD_ACTIONS) if (this.binds[id] >= 0 && pressed[this.binds[id]]) want.add(id);
      const [lx = 0, ly = 0, rx = 0, ry = 0] = ax;
      // shortcut: the left stick is on / off (walk or stand), not gradual; upgrade if players want slow walking on the stick

      if (ly < -0.35) want.add('forward'); if (ly > 0.35) want.add('back');
      if (lx < -0.35) want.add('left'); if (lx > 0.35) want.add('right');
      for (const id of this.held) if (!want.has(id)) { this.held.delete(id); hooks.onAction(id, false); }
      for (const id of want) if (!this.held.has(id)) { this.held.add(id); hooks.onAction(id, true); }
      // finer aim near the centre of the stick
      const k = this.lookSpeed * dt;
      if (rx || ry) hooks.look(rx * Math.abs(rx) * k, (this.invert ? -1 : 1) * ry * Math.abs(ry) * k);
    } else {
      this.release(hooks.onAction);
      const v = pressed[12] || ax[1] < -0.5 ? -1 : pressed[13] || ax[1] > 0.5 ? 1 : 0;
      const h = pressed[14] || ax[0] < -0.5 ? -1 : pressed[15] || ax[0] > 0.5 ? 1 : 0;
      const dir = v || h, key = v ? 'v' + v : 'h' + h;
      if (!dir) this.navDir = 0;
      else if (key !== this.navDir || now >= this.navAt) {           // repeats while held
        this.navAt = now + (key !== this.navDir ? 380 : 120); this.navDir = key;
        hooks.menuMove(dir, !v);
      }
      if (edge(0)) hooks.menuPress();
      if (edge(1)) hooks.menuBack();
    }
    this.was = pressed;
  }
}

// Controls & keybinds > Controller: the pad's state, look speed, invert, and a button per action.
export function padPanel(pad) {
  const n = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const root = n('section'); root.id = 'pad-panel';
  const status = n('p', '', 'small'); status.setAttribute('aria-live', 'polite');
  const speed = n('input'); speed.type = 'range'; speed.min = 60; speed.max = 600; speed.step = 10; speed.id = 'pad-speed';
  const speedLabel = n('span');
  speed.addEventListener('input', () => { pad.lookSpeed = Number(speed.value); pad.save(); });
  const inv = n('input'); inv.type = 'checkbox'; inv.id = 'pad-invert';
  inv.addEventListener('change', () => { pad.invert = inv.checked; pad.save(); });
  const speedField = n('label', '', 'field'); speedField.htmlFor = 'pad-speed'; speedField.append(speedLabel, speed);
  const invField = n('label', '', 'check'); invField.htmlFor = 'pad-invert'; invField.append(inv, n('span', 'Invert vertical look'));
  const opts = n('div', '', 'set-grid'); opts.append(speedField, invField);
  const list = n('div', '', 'pad-binds');
  const rows = PAD_ACTIONS.map(([id, name]) => {
    const btn = n('button'); btn.type = 'button'; btn.dataset.padAction = id;
    btn.addEventListener('click', () => {
      btn.textContent = 'Press a controller button…';
      pad.capture = (i) => { pad.bind(id, i); };
      status.textContent = 'Press the button for ' + name + ' (Start is fixed to pause).';
    });
    const row = n('div', '', 'pad-bind'); row.append(n('span', name), btn);
    list.append(row);
    return [id, btn];
  });
  const reset = n('button', 'Reset controller buttons'); reset.type = 'button'; reset.addEventListener('click', () => pad.reset());
  const sticks = n('p', 'Left stick: move · Right stick: look · Start: pause / resume · In menus: D-pad or left stick to move, A to press, B to go back.', 'small');
  root.append(status, opts, sticks, list, reset);
  const render = () => {
    const p = pad.pad();
    status.textContent = p ? 'Controller connected: ' + p.id.replace(/\s*\(.*$/, '') : 'No controller found. Plug one in (or pair it) and press any button.';
    speed.value = pad.lookSpeed; speedLabel.textContent = 'Look speed ' + pad.lookSpeed + '°/s';
    inv.checked = pad.invert;
    for (const [id, btn] of rows) btn.textContent = pad.label(id);
  };
  pad.onChange = render;
  addEventListener('gamepadconnected', render); addEventListener('gamepaddisconnected', render);
  render();
  return root;
}
