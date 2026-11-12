import { tabs } from './m7-menu.js?v=eca0e5a-mwdi3x0w';
// Settings panel inside the Esc menu. Every change is sanitised, saved to localStorage and
// handed to main.js through onChange(key) so it takes effect immediately.
import { sanitize, saveSettings, clearSavedSettings, DEFAULTS, DISTANCES, CROSSHAIR_STYLES, RETICLE_COLOR_NAMES } from '../core/settings.js?v=eca0e5a-mwdi3x0w';
import { degPerCount, countsPer360, inchesPer360, horizontalFovDeg } from '../core/sensitivity.js?v=eca0e5a-mwdi3x0w';
import { drawCrosshair } from './crosshair.js?v=eca0e5a-mwdi3x0w';

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
  // ctx: { settings, guns, sensKeys, sensFile, opticMultiplier(key), isPlaceholder(key), getState(), onChange(key) }
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
        this.range('set-sens-h', 'Horizontal sensitivity', { min: 1, max: 50, step: 1, fmt: (v) => String(v) }, () => this.s.sensH, (v) => { this.s.sensH = v; }, 'sens'),
        this.range('set-sens-v', 'Vertical sensitivity', { min: 1, max: 50, step: 1, fmt: (v) => String(v) }, () => this.s.sensV, (v) => { this.s.sensV = v; }, 'sens'),
        this.select('set-ads-sens', 'Aimed sensitivity', [['focal', 'Match screen distance (focal length)'], ['game', 'My game values (sens.json)']], () => this.s.adsSens, (v) => { this.s.adsSens = v; }, 'sens'),
        this.range('set-mdm', 'Monitor distance (focal mode)', { min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' + (v === 0 ? ' (match at crosshair)' : v === 1 ? ' (match at screen edge)' : '') }, () => this.s.mdm, (v) => { this.s.mdm = v; }, 'sens'),
        this.range('set-assist', 'Range training aim assist (offline only)', { min: 0, max: 1, step: 0.05, fmt: (v) => v === 0 ? 'off' : Math.round(v * 100) + '%' }, () => this.s.aimAssist, (v) => { this.s.aimAssist = v; }, 'assist'),
      ),
      this.derived);

    /* ADS multipliers: one row per magnification used in data/optics.json */
    const tbody = el('tbody');
    this.opticRows = [];
    for (const key of ctx.sensKeys) {
      const fileVal = ctx.sensFile[key];
      const input = el('input', { type: 'number', min: 0.01, max: 20, step: 0.01, id: 'set-ads-' + key.replace('.', '_') });
      const mark = el('span', { class: 'edited' });
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v) || v <= 0) return;
        if (v === fileVal) delete this.s.opticOverrides[key];
        else this.s.opticOverrides[key] = v;
        this.commit('optics');
      });
      const dpcCell = el('td', { class: 'small' });
      this.opticRows.push({ key, fileVal, input, mark, dpcCell });
      tbody.append(el('tr', {},
        el('td', { text: key }),
        el('td', { class: 'small', text: ctx.gameSliders[key] !== undefined ? String(ctx.gameSliders[key]) : '\u2014' }),
        el('td', {}, input, ' ', mark),
        dpcCell));
    }
    const g0 = ctx.gameSens || {};
    const gameLine = el('p', { class: 'small', text: 'From your game settings (data/sens.json): horizontal ' + (g0.horizontal ?? '\u2014') + ', vertical ' + (g0.vertical ?? '\u2014') +
      ', aim mode ' + (g0.aimMode ?? '\u2014') + '. Hipfire here is set by DPI and cm/360 above.' });
    const resetOptics = el('button', { type: 'button', text: 'Clear my edits' });
    resetOptics.addEventListener('click', () => { this.s.opticOverrides = {}; this.commit('optics'); this.refresh(); });
    const optics = this.group('ADS sensitivity per magnification',
      el('p', { class: 'small', text: 'ADS deg/count = hip deg/count \u00d7 multiplier (\u00d7 the gun\u2019s own ADS factor). 1.0 = same as hipfire. Used when Aimed sensitivity is \u201cMy game values\u201d; the default (focal length) needs no table. Rows are the magnifications in data/sens.json plus any a sight uses. \u201cGame slider\u201d is your in-game value, shown for reference: it is not converted, because how the game turns it into degrees per count is not known here. A row with no calibrated multiplier (an "ads" entry in data/sens.json) uses the 1.0x multiplier divided by the zoom and is marked placeholder. Edits here are saved in this browser only.' }),
      gameLine,
      el('div', { class: 'table-wrap' }, el('table', { class: 'optic-table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Magnification' }), el('th', { text: 'Game slider' }), el('th', { text: 'Multiplier' }), el('th', { text: 'deg/count' }))),
        tbody)),
      el('div', { class: 'row' }, resetOptics));

    /* Range */
    const gunOpts = ctx.guns.map((g, i) => [String(i), (i < 10 ? ((i + 1) % 10) + ': ' : '') + g.name + (g.placeholder ? ' (placeholder)' : '')]);
    const range = this.group('Range',
      el('div', { class: 'set-grid' },
        this.select('set-gun', 'Gun', gunOpts, () => String(this.s.gunIndex), (v) => { this.s.gunIndex = Number(v); }, 'gun'),
        this.select('set-distance', 'Target distance', DISTANCES.map((d) => [String(d), d + ' m']), () => String(this.s.distance), (v) => { this.s.distance = Number(v); }, 'distance'),
        this.range('set-aim-recoil', 'Aimed recoil strength', { min: 0.25, max: 1.5, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' + (v === 1 ? ' (as measured)' : '') }, () => this.s.aimRecoil, (v) => { this.s.aimRecoil = v; }, 'recoil'),
        el('div', { class: 'field' }, el('span', { text: '\u00a0' }),
          this.check('set-aim-smooth', 'Smooth measured spray when aiming', () => this.s.aimSmooth, (v) => { this.s.aimSmooth = v; }, 'recoil')),
        this.range('set-reload', 'Reload speed', { min: 1, max: 5, step: 0.25, fmt: (v) => v + 'x' + (v === 1 ? ' (as measured)' : '') }, () => this.s.reloadSpeed, (v) => { this.s.reloadSpeed = v; }, 'reload'),
        this.range('set-hip-recoil', 'Hip-fire recoil strength', { min: 1, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) + 'x' }, () => this.s.hipRecoil, (v) => { this.s.hipRecoil = v; }, 'recoil'),
        el('div', { class: 'field' }, el('span', { text: '\u00a0' }),
          this.check('set-hip-spread', 'Hip-fire spread (random, grows while firing)', () => this.s.hipSpread, (v) => { this.s.hipSpread = v; }, 'recoil')),
        el('div', { class: 'field' }, el('span', { text: '\u00a0' }),
          this.check('set-auto-reload', 'Auto reload when empty', () => this.s.autoReload, (v) => { this.s.autoReload = v; }, 'reload')),
        this.range('set-hole', 'Bullet hole size', { min: 0.5, max: 10, step: 0.5, fmt: (v) => v + ' cm' }, () => this.s.holeSizeCm, (v) => { this.s.holeSizeCm = v; }, 'holes'),
        this.select('set-target', 'Target (M cycles)', [['dummy', 'Dummy'], ['paper', 'Paper target (ring score)'], ['dots-still', 'Red dots, still'], ['dots-moving', 'Red dots, moving']],
          () => this.s.targetMode === 'dots' ? (this.s.dotMoving ? 'dots-moving' : 'dots-still') : this.s.targetMode,
          (v) => { this.s.targetMode = v.startsWith('dots') ? 'dots' : v; this.s.dotMoving = v === 'dots-moving'; }, 'target'),
        this.range('set-dot-count', 'Red dots', { min: 1, max: 12, step: 1, fmt: (v) => String(v) }, () => this.s.dotCount, (v) => { this.s.dotCount = Math.round(v); }, 'target'),
        this.range('set-dot-size', 'Dot size', { min: 5, max: 50, step: 1, fmt: (v) => v + ' cm' }, () => this.s.dotSizeCm, (v) => { this.s.dotSizeCm = v; }, 'target'),
        this.range('set-dot-speed', 'Moving dot speed', { min: 0.25, max: 6, step: 0.25, fmt: (v) => v + ' m/s' }, () => this.s.dotSpeed, (v) => { this.s.dotSpeed = v; }, 'target'),
        this.num('set-seed', 'Fixed jitter seed (blank = random)', { min: 0, max: 4294967295, step: 1 }, () => this.s.fixedSeed, (v) => { this.s.fixedSeed = String(Math.floor(v)); }, 'seed'),
      ));
    // Allow clearing the seed field back to "random".
    this.inputs['set-seed'].addEventListener('input', (e) => { if (e.target.value === '') { this.s.fixedSeed = ''; this.commit('seed'); } });

    /* View */
    this.fovNote = el('span', { class: 'small' });
    const view = this.group('View',
      el('div', { class: 'set-grid' },
        this.range('set-fov', 'Vertical FOV', { min: 60, max: 90, step: 1, fmt: (v) => v + '\u00b0' }, () => this.s.fov, (v) => { this.s.fov = v; }, 'fov'),
        this.select('set-scale', 'Render resolution', [['0', 'Auto (screen sharpness)'], ['2', '200% (supersampled)'], ['1.5', '150% (supersampled)'], ['1', '100%'], ['0.85', '85%'], ['0.75', '75%'], ['0.5', '50%']], () => String(this.s.renderScale), (v) => { this.s.renderScale = Number(v); }, 'scale'),
        this.select('set-graphics', 'Graphics quality', [['low', 'Low: flat colours (slowest PCs)'], ['standard', 'Standard (fast, no download)'], ['high', 'High: detailed guns, lighting (Enhanced pack)'], ['ultra', 'Ultra: 4K skins with depth (Enhanced pack)'], ['max', 'Max: everything on (Enhanced pack)']], () => this.s.graphics, (v) => { this.s.graphics = v; }, 'graphics'),
        this.range('set-royale-distance', 'Battle Royale render distance', {min:45,max:200,step:5,fmt:v=>v+' m'}, () => this.s.royaleRenderDistance, v => { this.s.royaleRenderDistance = v; }, 'royaleRenderDistance'),
        this.select('set-shading', 'Gun and sight shading (Standard graphics)', [['fast', 'Fast (recommended)'], ['detailed', 'Detailed metal (slower)']], () => this.s.weaponShading, (v) => { this.s.weaponShading = v; }, 'shading'),
        this.select('set-lens', 'Lens effects when aiming', [['auto', 'Auto (drops if aiming is slow)'], ['3', 'High: blur, fringing, glare'], ['2', 'Medium: no blur'], ['1', 'Low (fast): glare, darkening, reticle'], ['0', 'Off (fast): darkening and reticle']], () => this.s.lensQuality, (v) => { this.s.lensQuality = v; }, 'lens'),
      ),
      this.fovNote,
      el('div', { class: 'row' },
        this.ctx.openGraphics ? (() => { const b = el('button', { type: 'button', id: 'set-open-graphics', text: 'Graphics & performance\u2026' }); b.addEventListener('click', () => this.ctx.openGraphics()); return b; })() : null,
        this.check('set-aa', 'Antialiasing (after reload)', () => this.s.antialias, (v) => { this.s.antialias = v; }, 'aa'),
        this.check('set-anim', 'Weapon animations', () => this.s.animations, (v) => { this.s.animations = v; }, 'anim'),
        this.check('set-viewmodel', 'Show gun model', () => this.s.showViewmodel, (v) => { this.s.showViewmodel = v; }, 'viewmodel'),
        this.check('set-minimap', 'Mini map (battles and matches)', () => this.s.minimap, (v) => { this.s.minimap = v; }, 'minimap'),
        this.check('set-debug', 'Debug readout (F3)', () => this.s.debugHud, (v) => { this.s.debugHud = v; }, 'debug'),
      ));

    const audio = this.group('Audio',
      this.range('set-volume', 'Master volume', { min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' }, () => this.s.volume, (v) => { this.s.volume = v; }, 'volume'),
      this.check('set-spatial-audio', '3D headphone positioning (HRTF)', () => this.s.spatialAudio, (v) => { this.s.spatialAudio = v; }, 'audio'),
      el('p', { class:'small', text:'Headphones provide directional and height cues. Distance and wall muffling remain active with stereo positioning. Footsteps follow the floor material; no enemy markers are added.' }));

    /* Crosshair */
    this.preview = el('canvas', { 'aria-hidden': 'true' });
    const previewBox = el('div', { class: 'xh-preview' }, this.preview);
    const cross = this.group('Crosshair',
      el('div', { class: 'xh-wrap' },
        el('div', { class: 'set-grid' },
          this.select('set-reticle', 'Sight reticle colour (ADS)', RETICLE_COLOR_NAMES.map((v) => [v, v[0].toUpperCase() + v.slice(1)]), () => this.s.reticleColor, (v) => { this.s.reticleColor = v; }, 'reticle'),
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

    const panels = [sens, optics, view, cross, range, audio];
    panels.forEach((p,i) => p.id = 'm7-settings-' + i);
    const settings = el('div', { class: 'settings' }, ...panels);
    tabs(settings, panels.map((panel,i)=>({panel,label:['Sensitivity','ADS','Video','Crosshair','Range','Audio'][i]})), 'Settings categories');
    this.root.append(settings, el('div', { class: 'row' }, resetAll, el('span', { class: 'small', text: 'Settings are saved in this browser automatically.' })));
  }

  // Push current settings into every control (after load or reset, and when the menu opens).
  // Quick setup (new players, after Graphics): only the settings that matter on day one.
  quick(root) {
    const xh = () => this.s.crosshair;
    root.append(el('div', { class: 'set-grid' },
      this.num('q-dpi', 'Mouse DPI (from your mouse software; 800 or 1600 if unsure)', { min: 50, max: 32000, step: 50 }, () => this.s.dpi, (v) => { this.s.dpi = v; }, 'sens'),
      this.range('q-sens', 'Sensitivity', { min: 1, max: 50, step: 1, fmt: (v) => String(v) }, () => this.s.sensH, (v) => { this.s.sensH = this.s.sensV = v; }, 'sens'),
      this.range('q-fov', 'Field of view', { min: 60, max: 90, step: 1, fmt: (v) => v + '\u00b0' }, () => this.s.fov, (v) => { this.s.fov = v; }, 'fov'),
      this.range('q-volume', 'Volume', { min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' }, () => this.s.volume, (v) => { this.s.volume = v; }, 'volume'),
      this.field('Crosshair colour', (() => {
        const i = el('input', { type: 'color' });
        i.addEventListener('input', () => { xh().color = i.value; this.commit('crosshair'); });
        i._get = () => xh().color;
        return i;
      })(), 'q-xh-color'),
      this.select('q-reticle', 'Sight reticle colour', RETICLE_COLOR_NAMES.map((v) => [v, v[0].toUpperCase() + v.slice(1)]), () => this.s.reticleColor, (v) => { this.s.reticleColor = v; }, 'reticle')),
      el('div', { class: 'row' },
        this.check('q-minimap', 'Mini map', () => this.s.minimap, (v) => { this.s.minimap = v; }, 'minimap'),
        this.check('q-autoreload', 'Auto reload when empty', () => this.s.autoReload, (v) => { this.s.autoReload = v; }, 'reload'),
        this.check('q-fps', 'FPS counter', () => this.s.fpsCounter, (v) => { this.s.fpsCounter = v; }, 'perf')));
    this.refresh();
  }

  refresh() {
    for (const i of Object.values(this.inputs)) {
      if (!i._get) continue;
      if (i.type === 'checkbox') i.checked = i._get();
      else i.value = i._get();
      if (i._show) i._show();
    }
    for (const r of this.opticRows) r.input.value = +this.ctx.opticMultiplier(r.key).toFixed(4);
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
    line('turn (horizontal)', fmt(s.cm360, 2) + ' cm / 360\u00b0  (' + fmt(inchesPer360(s.cm360), 2) + ' in)');
    line('turn (vertical)', fmt(s.cm360 * s.sensH / s.sensV, 2) + ' cm / 360\u00b0');
    line('counts / 360\u00b0', fmt(countsPer360(s.dpi, s.cm360), 2));
    line('degrees / count (hip)', fmt(dpc, 8) + '\u00b0 horizontal, ' + fmt(dpc * s.sensV / s.sensH, 8) + '\u00b0 vertical');
    if (g && st.optic) {
      const m = this.ctx.aimedMultiplier(st.optic);
      line('ADS deg/count for ' + g.name + ' with ' + st.optic.label + ' (' + st.optic.sensKey + ')', fmt(dpc * m, 8) + '\u00b0  = ' + fmt(s.cm360 / m, 2) + ' cm/360');
    }
    for (const r of this.opticRows) {
      const ov = s.opticOverrides[r.key];
      r.mark.textContent = ov !== undefined ? 'edited' : (this.ctx.isPlaceholder(r.key) ? 'placeholder' : '');
      r.dpcCell.textContent = fmt(dpc * this.ctx.opticMultiplier(r.key), 6);
    }
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.fovNote.textContent = 'Vertical, like the game\u2019s FOV slider. Measured recoil assumes 83\u00b0. Horizontal FOV at this window size: ' + horizontalFovDeg(s.fov, aspect).toFixed(2) + '\u00b0. ' +
      'ADS FOV = 2 · atan(tan(hip FOV / 2) / zoom).';
    drawCrosshair(this.preview, s.crosshair);
    this.preview.style.margin = '0';
  }
}
