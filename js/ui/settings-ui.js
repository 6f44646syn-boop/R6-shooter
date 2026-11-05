// Settings panel inside the Esc menu. Every change is sanitised, saved to localStorage and
// handed to main.js through onChange(key) so it takes effect immediately.
import { sanitize, saveSettings, clearSavedSettings, DEFAULTS, DISTANCES, CROSSHAIR_STYLES } from '../core/settings.js';
import { degPerCount, countsPer360, inchesPer360, verticalFovDeg } from '../core/sensitivity.js';
import { drawCrosshair } from './crosshair.js';

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v !== undefined) e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}

const XH_LABELS = { cross: 'Cross', dot: 'Dot', 'cross-dot': 'Cross + dot', circle: 'Circle', t: 'T (no top arm)' };

export class SettingsUI {
  // ctx: { settings, guns, optics, getState(), onChange(key) }
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.inputs = {};
    this.build();
    this.refresh();
  }

  get s() { return this.ctx.settings; }

  // Replace the shared settings object's contents with a sanitised copy, save, notify.
  commit(key) {
    const clean = sanitize(this.s);
    Object.assign(this.s, clean);
    saveSettings(this.s);
    this.ctx.onChange(key);
    this.refreshDerived();
  }

  field(label, input, id) {
    input.id = id;
    this.inputs[id] = input;
    return el('label', { class: 'field', for: id }, el('span', { text: label }), input);
  }

  num(id, label, { min, max, step }, get, set, key) {
    const i = el('input', { type: 'number', min, max, step, inputmode: 'decimal' });
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (Number.isFinite(v) && v >= min && v <= max) { set(v); this.commit(key); }
    });
    i.addEventListener('change', () => { this.commit(key); i.value = get(); });
    i._get = get;
    return this.field(label, i, id);
  }

  range(id, label, { min, max, step, fmt }, get, set, key) {
    const out = el('span', { class: 'small' });
    const i = el('input', { type: 'range', min, max, step });
    const show = () => { out.textContent = fmt(get()); };
    i.addEventListener('input', () => { set(parseFloat(i.value)); this.commit(key); show(); });
    i._get = get;
    i._show = show;
    const f = this.field(label, i, id);
    f.firstChild.append(' ', out);
    return f;
  }

  select(id, label, options, get, set, key) {
    const i = el('select');
    for (const [value, text] of options) i.append(el('option', { value, text }));
    i.addEventListener('change', () => { set(i.value); this.commit(key); });
    i._get = get;
    return this.field(label, i, id);
  }

  check(id, label, get, set, key) {
    const i = el('input', { type: 'checkbox' });
    i.id = id;
    this.inputs[id] = i;
    i.addEventListener('change', () => { set(i.checked); this.commit(key); });
    i._get = get;
    return el('label', { class: 'check', for: id }, i, el('span', { text: label }));
  }

  group(title, ...kids) {
    return el('section', { class: 'set-group' }, el('h2', { text: title }), ...kids);
  }

  build() {
    const s = this.s, ctx = this.ctx;
    const xh = () => this.s.crosshair;

    /* Sensitivity */
    this.derived = el('div', { class: 'derived' });
    const sens = this.group('Sensitivity',
      el('div', { class: 'set-grid' },
        this.num('set-dpi', 'Mouse DPI', { min: 50, max: 32000, step: 50 }, () => this.s.dpi, (v) => { this.s.dpi = v; }, 'sens'),
        this.num('set-cm360', 'cm per 360° (hipfire)', { min: 1, max: 1000, step: 0.1 }, () => this.s.cm360, (v) => { this.s.cm360 = v; }, 'sens'),
      ),
      this.derived);

    /* ADS multipliers */
    const tbody = el('tbody');
    this.opticRows = [];
    for (const o of ctx.optics) {
      const key = String(o.zoom);
      const input = el('input', { type: 'number', min: 0.01, max: 20, step: 0.01, id: 'set-optic-' + key.replace('.', '_') });
      const mark = el('span', { class: 'edited' });
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v) || v <= 0) return;
        if (v === o.adsMultiplier) delete this.s.opticOverrides[key];
        else this.s.opticOverrides[key] = v;
        this.commit('optics');
      });
      const dpcCell = el('td', { class: 'small' });
      this.opticRows.push({ o, key, input, mark, dpcCell });
      tbody.append(el('tr', {},
        el('td', { text: o.zoom.toFixed(1) + 'x' }),
        el('td', { class: 'small', text: String(o.adsMultiplier) }),
        el('td', {}, input, ' ', mark),
        dpcCell));
    }
    const resetOptics = el('button', { type: 'button', text: 'Use the values from optics.json' });
    resetOptics.addEventListener('click', () => { this.s.opticOverrides = {}; this.commit('optics'); this.refresh(); });
    const optics = this.group('ADS sensitivity multipliers',
      el('p', { class: 'small', text: 'ADS deg/count = hip deg/count × multiplier (× the gun’s own ADS factor). 1.0 = same as hipfire. Edits here are saved in this browser only; copy final values into data/optics.json.' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'optic-table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Optic' }), el('th', { text: 'File' }), el('th', { text: 'Multiplier' }), el('th', { text: 'deg/count' }))),
        tbody)),
      el('div', { class: 'row' }, resetOptics));

    /* Range */
    const gunOpts = ctx.guns.map((g, i) => [String(i), (i < 10 ? ((i + 1) % 10) + ': ' : '') + g.name + (g.placeholder ? ' (placeholder)' : '')]);
    const range = this.group('Range',
      el('div', { class: 'set-grid' },
        this.select('set-gun', 'Gun', gunOpts, () => String(this.s.gunIndex), (v) => { this.s.gunIndex = Number(v); }, 'gun'),
        this.select('set-distance', 'Target distance', DISTANCES.map((d) => [String(d), d + ' m']), () => String(this.s.distance), (v) => { this.s.distance = Number(v); }, 'distance'),
        this.range('set-hole', 'Bullet hole size', { min: 0.5, max: 10, step: 0.5, fmt: (v) => v + ' cm' }, () => this.s.holeSizeCm, (v) => { this.s.holeSizeCm = v; }, 'holes'),
        this.range('set-mover-speed', 'Moving dot speed', { min: 0.25, max: 6, step: 0.25, fmt: (v) => v + ' m/s' }, () => this.s.moverSpeed, (v) => { this.s.moverSpeed = v; }, 'mover'),
        el('div', { class: 'field' }, el('span', { text: '\u00a0' }),
          this.check('set-mover', 'Moving red dot target (M)', () => this.s.movingTarget, (v) => { this.s.movingTarget = v; }, 'mover')),
        this.num('set-seed', 'Fixed jitter seed (blank = random)', { min: 0, max: 4294967295, step: 1 }, () => this.s.fixedSeed, (v) => { this.s.fixedSeed = String(Math.floor(v)); }, 'seed'),
      ));
    // Allow clearing the seed field back to "random".
    this.inputs['set-seed'].addEventListener('input', (e) => { if (e.target.value === '') { this.s.fixedSeed = ''; this.commit('seed'); } });

    /* View */
    this.fovNote = el('span', { class: 'small' });
    const view = this.group('View',
      el('div', { class: 'set-grid' },
        this.range('set-fov', 'Horizontal FOV', { min: 60, max: 110, step: 1, fmt: (v) => v + '°' }, () => this.s.hipFov, (v) => { this.s.hipFov = v; }, 'fov'),
        this.select('set-scale', 'Render resolution', [['1', '100%'], ['0.85', '85%'], ['0.75', '75%'], ['0.5', '50%']], () => String(this.s.renderScale), (v) => { this.s.renderScale = Number(v); }, 'scale'),
        this.range('set-volume', 'Volume', { min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' }, () => this.s.volume, (v) => { this.s.volume = v; }, 'volume'),
      ),
      this.fovNote,
      el('div', { class: 'row' },
        this.check('set-viewmodel', 'Show gun model', () => this.s.showViewmodel, (v) => { this.s.showViewmodel = v; }, 'viewmodel'),
        this.check('set-debug', 'Debug readout (F3)', () => this.s.debugHud, (v) => { this.s.debugHud = v; }, 'debug'),
      ));

    /* Crosshair */
    this.preview = el('canvas', { 'aria-hidden': 'true' });
    const previewBox = el('div', { class: 'xh-preview' }, this.preview);
    const cross = this.group('Crosshair',
      el('div', { class: 'xh-wrap' },
        el('div', { class: 'set-grid' },
          this.select('set-xh-style', 'Style', CROSSHAIR_STYLES.map((v) => [v, XH_LABELS[v]]), () => xh().style, (v) => { xh().style = v; }, 'crosshair'),
          this.field('Colour', (() => {
            const i = el('input', { type: 'color' });
            i.addEventListener('input', () => { xh().color = i.value; this.commit('crosshair'); });
            i._get = () => xh().color;
            return i;
          })(), 'set-xh-color'),
          this.range('set-xh-size', 'Length', { min: 2, max: 60, step: 1, fmt: (v) => v + ' px' }, () => xh().size, (v) => { xh().size = v; }, 'crosshair'),
          this.range('set-xh-gap', 'Gap', { min: 0, max: 40, step: 1, fmt: (v) => v + ' px' }, () => xh().gap, (v) => { xh().gap = v; }, 'crosshair'),
          this.range('set-xh-thick', 'Thickness', { min: 1, max: 8, step: 1, fmt: (v) => v + ' px' }, () => xh().thickness, (v) => { xh().thickness = v; }, 'crosshair'),
          el('div', { class: 'field' }, el('span', { text: ' ' }),
            this.check('set-xh-outline', 'Black outline', () => xh().outline, (v) => { xh().outline = v; }, 'crosshair')),
        ),
        previewBox));

    const resetAll = el('button', { type: 'button', text: 'Reset all settings' });
    resetAll.addEventListener('click', () => {
      if (!resetAll.dataset.armed) {
        resetAll.dataset.armed = '1';
        resetAll.textContent = 'Click again to reset everything';
        setTimeout(() => { delete resetAll.dataset.armed; resetAll.textContent = 'Reset all settings'; }, 3000);
        return;
      }
      clearSavedSettings();
      Object.assign(this.s, sanitize(JSON.parse(JSON.stringify(DEFAULTS))));
      this.commit('all');
      this.refresh();
      delete resetAll.dataset.armed;
      resetAll.textContent = 'Reset all settings';
    });

    this.root.append(el('div', { class: 'settings' }, sens, optics, view, cross, range,
      el('div', { class: 'row' }, resetAll, el('span', { class: 'small', text: 'Settings are saved in this browser automatically.' }))));
  }

  // Push current settings into every control (after load or reset, and when the menu opens).
  refresh() {
    for (const i of Object.values(this.inputs)) {
      if (!i._get) continue;
      if (i.type === 'checkbox') i.checked = i._get();
      else i.value = i._get();
      if (i._show) i._show();
    }
    for (const r of this.opticRows) {
      const ov = this.s.opticOverrides[r.key];
      r.input.value = ov !== undefined ? ov : r.o.adsMultiplier;
    }
    this.refreshDerived();
  }

  refreshDerived() {
    const s = this.s;
    const dpc = degPerCount(s.dpi, s.cm360);
    const st = this.ctx.getState();
    const g = st.gun;
    const fmt = (v, d = 6) => v.toFixed(d);
    this.derived.innerHTML = '';
    const line = (label, value) => this.derived.append(label + ' ', el('b', { text: value }), el('br'));
    line('inches / 360°', fmt(inchesPer360(s.cm360), 3) + ' in');
    line('counts / 360°', fmt(countsPer360(s.dpi, s.cm360), 2));
    line('degrees / count (hip)', fmt(dpc, 8) + '°');
    if (g) {
      const m = this.ctx.opticMultiplier(g.optic) * g.adsMultiplier;
      line('ADS deg/count for ' + g.name + ' (' + g.optic.toFixed(1) + 'x)', fmt(dpc * m, 8) + '°  = ' + fmt(s.cm360 / m, 2) + ' cm/360');
    }
    for (const r of this.opticRows) {
      const ov = s.opticOverrides[r.key];
      r.mark.textContent = ov !== undefined ? 'edited' : '';
      r.dpcCell.textContent = fmt(dpc * (ov !== undefined ? ov : r.o.adsMultiplier), 6);
    }
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.fovNote.textContent = 'Vertical FOV at this window size: ' + verticalFovDeg(s.hipFov, aspect).toFixed(2) + '°. ' +
      'ADS FOV = hip FOV divided by the optic zoom in tan-space.';
    drawCrosshair(this.preview, s.crosshair);
    this.preview.style.margin = '0';
  }
}
