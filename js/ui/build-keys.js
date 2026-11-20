// Battle Royale piece keys (Controls > Keybinds > Battle Royale): a key for each piece.
// "In build mode": with build mode on, the key picks that piece and builds it (hold: keeps building).
// "Always": the key builds that piece any time, build mode or not, and leaves you on your gun after.
const PIECES = [['wall', 'Wall'], ['ramp', 'Ramp'], ['cone', 'Cone']];
const label = (c) => c ? c.replace(/^Key|^Digit/, '') : 'Unbound';

export function buildKeysPanel(settings, save) {
  const n = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const root = n('div', '', 'build-keys'); root.id = 'build-keys';
  const mode = n('select'); mode.id = 'build-keys-mode';
  for (const [v, t] of [['off', 'Off'], ['toggle', 'In build mode (B, then the piece key)'], ['always', 'Always (the piece key builds any time)']]) { const o = n('option', t); o.value = v; mode.append(o); }
  mode.value = settings.buildKeys;
  mode.addEventListener('change', () => { settings.buildKeys = mode.value; save(); });
  const modeField = n('label', '', 'field'); modeField.htmlFor = mode.id; modeField.append(n('span', 'Piece keys'), mode);
  let capture = null;
  const buttons = PIECES.map(([p, name]) => {
    const b = n('button'); b.type = 'button'; b.dataset.buildKey = p;
    const show = () => { b.textContent = capture === p ? 'Press a key…' : label(settings.buildBinds[p]); };
    b.addEventListener('click', () => { capture = p; buttons.forEach((x) => x.show()); });
    b.show = show; show();
    const row = n('div', '', 'row'); row.append(n('span', name), b);
    b.row = row;
    return b;
  });
  // The next key press sets the piece's key (Escape cancels, Delete or Backspace clears it).
  window.addEventListener('keydown', (e) => {
    if (!capture) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.code !== 'Escape') {
      const code = e.code === 'Delete' || e.code === 'Backspace' ? '' : e.code;
      for (const p in settings.buildBinds) if (code && settings.buildBinds[p] === code) settings.buildBinds[p] = '';   // one key, one piece
      settings.buildBinds[capture] = code; save();
    }
    capture = null; buttons.forEach((x) => x.show());
  }, true);
  root.append(n('h3', 'Piece keys'), modeField, ...buttons.map((b) => b.row),
    n('p', 'A piece key wins over anything else bound to the same key while you play Battle Royale.', 'hint'));
  return root;
}

// While playing Battle Royale: a piece key picks its piece and builds (held: keeps building), like holding fire
// in build mode. Returns true when it used the key.
export function buildKey(e, down, settings, battle) {
  const r = battle?.royale, mode = settings.buildKeys;
  if (mode === 'off' || !battle.active || !r) return false;
  const piece = PIECES.find(([p]) => settings.buildBinds[p] && settings.buildBinds[p] === e.code)?.[0];
  if (!piece) return false;
  if (!down) {
    if (r.keyHeld !== e.code) return false;
    r.keyHeld = null; battle.mouseButton(0, false);
    if (r.quick) { r.quick = false; r.preview = false; }   // ("Always": back to your gun)
    return true;
  }
  if (e.repeat) return r.keyHeld === e.code;
  if (mode === 'toggle' && !r.preview) return false;      // (outside build mode the key does its usual job)
  if (r.editing || battle.paused || battle.over) return false;
  if (r.keyHeld) battle.mouseButton(0, false);
  if (!r.preview) { r.preview = true; r.quick = true; }
  r.keyHeld = e.code; r.pick(piece);
  battle.mouseButton(0, true);
  return true;
}
