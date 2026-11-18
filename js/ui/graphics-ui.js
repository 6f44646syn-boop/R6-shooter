// Graphics screen: choose Low / Standard (in the browser, nothing to download) or High /
// Ultra (needs the Enhanced Graphics pack), download / update / remove the pack, pick a
// performance profile, the frame-rate target and the FPS counter; download / remove the Weapon Skins pack.
// ctx: { settings, commit(key) (sanitise, save, apply), packSize() }
import { HDPack, SkinPack } from '../render/hd-pack.js?v=088a449-mwmr3fa0';
import { needsPack } from '../render/quality.js?v=088a449-mwmr3fa0';

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}
const MB = (b) => (b / 1048576).toFixed(1) + ' MB';

export const LEVELS = [
  { key: 'minimal', name: 'Minimal', tag: 'Browser', text: 'Low plus default skins, plain bots, no kill cam, no muzzle flash, brass or bullet holes, no rain or snow, still menus, 85% resolution. For the very slowest computers.' },
  { key: 'low', name: 'Low', tag: 'Browser', text: 'Flat colours and the simplest gun. For the slowest computers.' },
  { key: 'standard', name: 'Standard', tag: 'Browser', text: 'Fast, clear and light. Runs in any browser with nothing to download.' },
  { key: 'high', name: 'High', tag: 'Enhanced', text: 'Detailed gun models, realistic lighting, shadows, ambient occlusion, textured surfaces.' },
  { key: 'ultra', name: 'Ultra', tag: 'Enhanced', text: 'High plus 4K weapon skins with depth and lacquer, finer detail and supersampling. For graphics cards.' },
  { key: 'max', name: 'Max', tag: 'Enhanced', text: 'Ultra plus 4K map surfaces, bloom and colour grading, sun shafts and fog, floor reflections, bullet holes with debris, wet surfaces in rain. For fast graphics cards.' },
];
// Performance profiles: a set of settings in one click. 'enhanced' levels fall back to
// Standard without the pack.
export const PROFILES = {
  competitive: { name: 'Competitive', text: 'Highest frame rate and the clearest view: Standard graphics, light lens effects, sharpened.',
    set: { graphics: 'standard', fpsTarget: 144, lensQuality: '1', ao: false, taa: false, sharpen: 0.4, renderScale: 0 } },
  balanced: { name: 'Balanced', text: 'Good looks at a steady frame rate.',
    set: { graphics: 'high', fpsTarget: 60, lensQuality: 'auto', ao: true, taa: false, sharpen: 0.25, renderScale: 0 } },
  quality: { name: 'Quality', text: 'The best picture: Ultra graphics, ambient occlusion, temporal anti-aliasing.',
    set: { graphics: 'ultra', fpsTarget: 60, lensQuality: '3', ao: true, taa: true, sharpen: 0.25, renderScale: 0 } },
  max: { name: 'Max', text: 'Everything on: Max graphics, ambient occlusion and temporal anti-aliasing.',
    set: { graphics: 'max', fpsTarget: 60, lensQuality: '3', ao: true, taa: true, sharpen: 0.2, renderScale: 0 } },
};
export function currentProfile(s) {
  for (const [k, p] of Object.entries(PROFILES)) if (Object.entries(p.set).every(([a, v]) => s[a] === v)) return k;
  return 'custom';
}

export class GraphicsUI {
  constructor(app, ctx) {
    this.ctx = ctx;
    this._build();
    app.append(this.modal);
    HDPack.onChange(() => this.refresh());
    SkinPack.onChange(() => this.refresh());
  }
  get s() { return this.ctx.settings; }

  _build() {
    this.cards = new Map();
    const grid = el('div', { class: 'gx-levels', role: 'radiogroup', 'aria-label': 'Graphics quality' });
    for (const L of LEVELS) {
      const b = el('button', { class: 'gx-level', type: 'button', role: 'radio', 'data-level': L.key, onclick: () => this.choose(L.key) },
        el('span', { class: 'gx-tag ' + (L.tag === 'Enhanced' ? 'gx-tag-hd' : ''), text: L.tag }),
        el('strong', { text: L.name }),
        el('span', { class: 'gx-text', text: L.text }));
      this.cards.set(L.key, b);
      grid.append(b);
    }
    this.prompt = el('p', { class: 'gx-prompt', role: 'status', hidden: true });
    // a pack's section: its status, progress bar, Download and Remove buttons
    const packUI = (pack, id, title, text, label, download) => {
      const p = { pack, label, status: el('p', { class: 'gx-status', role: 'status' }), bar: el('div', { class: 'gx-bar', hidden: true }, el('i')),
        dl: el('button', { class: 'primary', type: 'button', id: id + 'download', onclick: download }),
        rm: el('button', { type: 'button', id: id + 'remove', onclick: () => pack.remove() }, 'Remove pack') };
      p.section = el('section', { class: 'gx-pack' }, el('h3', { text: title }), el('p', { class: 'small', text }), p.status, p.bar, el('div', { class: 'row' }, p.dl, p.rm));
      return p;
    };
    this.packs = [
      packUI(HDPack, 'gx-', 'Enhanced Graphics pack', 'Detailed gun models, deeper weapon skins, map materials, soldier detail and 83 sound clips. Visual enhancements use High and Ultra; audio works at every quality. It downloads from this site only when you choose to, every file is checked, and it stays in this browser so it works offline. Updates arrive separately from the game. Remove it at any time to free the space.', 'Download Enhanced Graphics', () => this.download()),
      packUI(SkinPack, 'gx-skins-', 'Weapon Skins pack', 'A painted picture of every skin on every gun, worn at every graphics level (Minimal mode shows default skins). Without it skins wear their simple generated finish. Like the graphics pack it downloads only when you choose to, is checked, stays in this browser and can be removed at any time.', 'Download Weapon Skins', async () => { if (SkinPack.state !== 'downloading') await SkinPack.install(); this.refresh(); }),
    ];
    this.pack = this.packs[0].section;
    this.profBtns = new Map();
    const prof = el('div', { class: 'gx-profiles' });
    for (const [k, p] of Object.entries(PROFILES)) {
      const b = el('button', { type: 'button', class: 'gx-prof', 'data-profile': k, title: p.text, onclick: () => this.profile(k) }, el('strong', { text: p.name }), el('span', { class: 'gx-text', text: p.text }));
      this.profBtns.set(k, b);
      prof.append(b);
    }
    const sel = (id, label, opts, get, set, key) => {
      const s = el('select', { id });
      for (const [v, t] of opts) s.append(el('option', { value: v, text: t }));
      s.addEventListener('change', () => { set(s.value); this.ctx.commit(key); this.refresh(); });
      s._get = get;
      return el('label', { class: 'field', for: id }, el('span', { text: label }), s);
    };
    const chk = (id, label, get, set, key) => {
      const i = el('input', { type: 'checkbox', id });
      i.addEventListener('change', () => { set(i.checked); this.ctx.commit(key); this.refresh(); });
      i._get = get;
      return el('label', { class: 'check', for: id }, i, el('span', { text: label }));
    };
    this.fields = el('div', { class: 'set-grid' },
      sel('gx-fps', 'Frame-rate target (lowers resolution when missed)', [['60', '60 fps'], ['120', '120 fps'], ['144', '144 fps'], ['240', '240 fps']], () => String(this.s.fpsTarget), (v) => { this.s.fpsTarget = Number(v); }, 'perf'),
      sel('gx-sharpen', 'Sharpening', [['0', 'Off'], ['0.25', 'Light'], ['0.4', 'Medium'], ['0.6', 'Strong']], () => String(this.s.sharpen), (v) => { this.s.sharpen = Number(v); }, 'post'),
      sel('gx-scale', 'Render resolution', [['0', 'Auto'], ['2', '200%'], ['1.5', '150%'], ['1', '100%'], ['0.85', '85% (upscaled)'], ['0.75', '75% (upscaled)'], ['0.6', '60% (upscaled)'], ['0.5', '50% (upscaled)']], () => String(this.s.renderScale), (v) => { this.s.renderScale = Number(v); }, 'scale'),
    );
    this.checks = el('div', { class: 'row' },
      chk('gx-ao', 'Ambient occlusion (High / Ultra)', () => this.s.ao, (v) => { this.s.ao = v; }, 'post'),
      chk('gx-taa', 'Temporal anti-aliasing (High / Ultra)', () => this.s.taa, (v) => { this.s.taa = v; }, 'post'),
      chk('gx-botshadows', 'Player and bot shadows (off is faster on weak GPUs; always on in Ranked and online)', () => this.s.botShadows, (v) => { this.s.botShadows = v; }, 'shading'),
      chk('gx-skins', 'High-res weapon skins (any graphics level)', () => this.s.hiResSkins, (v) => { this.s.hiResSkins = v; }, 'shading'),
      chk('gx-counter', 'FPS counter', () => this.s.fpsCounter, (v) => { this.s.fpsCounter = v; }, 'perf'));
    this.modal = el('div', { class: 'pk-modal gx-modal', id: 'gfx', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gx-title' },
      el('div', { class: 'pk-box gx-box' },
        el('div', { class: 'row gx-head' }, el('h1', { id: 'gx-title', text: 'Graphics' }), el('button', { type: 'button', class: 'gx-close', 'aria-label': 'Close', onclick: () => this.close() }, '×')),
        grid, this.prompt, this.pack, this.packs[1].section,
        el('div', { class: 'gx-perf' }, el('h3', { text: 'Performance' }), prof, this.fields, this.checks),
        el('div', { class: 'row pk-skip' }, el('button', { type: 'button', class: 'primary', onclick: () => this.close() }, 'Done'))));
    this.modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
  }

  // view: 'download' shows only the packs (the Download page); otherwise Graphics, with a pack only when a level needs it
  open(prompt = '', view = 'graphics') {
    this.modal.classList.toggle('gx-dl', view === 'download');
    this.modal.querySelector('#gx-title').textContent = view === 'download' ? 'Download' : 'Graphics';
    this.modal.hidden = false;
    this.wanted = prompt || null;
    HDPack.check(); SkinPack.check();     // the packs' sizes and whether an update is out (same-site requests)
    this.refresh();
    const first = this.modal.querySelector('.gx-level[aria-checked="true"]') || this.modal.querySelector('button');
    if (first) first.focus();
  }
  close() { this.modal.hidden = true; this.wanted = null; if (this.ctx.onClose) this.ctx.onClose(); }
  get isOpen() { return !this.modal.hidden; }

  // A level was picked: Low / Standard apply at once; High / Ultra need the pack.
  choose(level) {
    this.s.graphics = level;
    this.ctx.commit('graphics');
    this.wanted = needsPack(level) && !HDPack.ready ? level : null;
    this.refresh();
  }
  profile(k) {
    Object.assign(this.s, PROFILES[k].set);
    this.ctx.commit('all');
    this.wanted = needsPack(this.s.graphics) && !HDPack.ready ? this.s.graphics : null;
    this.refresh();
  }
  async download() {
    if (HDPack.state === 'downloading') return;
    await HDPack.install();
    if (HDPack.ready && this.ctx.onPackReady) await this.ctx.onPackReady();
    this.refresh();
  }

  refresh() {
    if (this.modal.hidden) return;
    const g = this.s.graphics, ready = HDPack.ready;
    for (const [k, b] of this.cards) {
      b.setAttribute('aria-checked', String(k === g));
      b.classList.toggle('on', k === g);
      b.classList.toggle('locked', needsPack(k) && !ready);
    }
    const need = needsPack(g) && !ready;
    this.prompt.hidden = !need;
    this.pack.classList.toggle("gx-need", !!need);   // (Graphics shows the pack only when the chosen level needs it)
    if (need) this.prompt.textContent = ({ ultra: 'Ultra', max: 'Max' }[g] || 'High') + ' needs the Enhanced Graphics pack' + (HDPack.size ? ' (' + MB(HDPack.size) + ')' : '') + '. Until you download it the game runs on Standard. You can stay on Standard; nothing is downloaded unless you press Download.';
    for (const { pack, label, status, bar, dl, rm } of this.packs) {
      const st = pack.state, p = pack.progress;
      bar.hidden = st !== 'downloading';
      if (st === 'downloading') bar.firstChild.style.width = (p.total ? p.done / p.total * 100 : 0).toFixed(1) + '%';
      const size = pack.size ? ' (' + MB(pack.size) + ')' : '';
      status.textContent = {
        none: 'Not installed.' + (pack.persistent ? '' : ' This browser cannot keep it, so it would last for this visit only.'),
        downloading: 'Downloading… ' + MB(p.done) + ' of ' + MB(p.total),
        installed: 'Installed: version ' + (pack.installed && pack.installed.version) + ', ' + MB(pack.installed ? pack.installed.total : 0) + (pack.persistent ? ', kept in this browser.' : ', for this visit only.'),
        update: 'Installed: version ' + (pack.installed && pack.installed.version) + '. Version ' + (pack.remote && pack.remote.version) + ' is available.',
        unsupported: 'This browser cannot unpack the pack (it needs a current Chrome, Edge, Firefox or Safari). The game works as normal without it.',
        error: 'The download did not finish: ' + pack.error,
      }[st] || '';
      if (pack.error && (st === 'installed' || st === 'update')) status.textContent += ' The update did not finish: ' + pack.error;
      dl.hidden = st === 'installed' || st === 'unsupported';
      dl.disabled = st === 'downloading';
      dl.textContent = st === 'update' ? 'Update pack' + size : st === 'downloading' ? 'Downloading…' : st === 'error' ? 'Try again' + size : label + size;
      rm.hidden = !(st === 'installed' || st === 'update');
    }
    const cur = currentProfile(this.s);
    for (const [k, b] of this.profBtns) { b.classList.toggle('on', k === cur); b.setAttribute('aria-pressed', String(k === cur)); }
    for (const i of this.modal.querySelectorAll('select, input')) {
      if (!i._get) continue;
      if (i.type === 'checkbox') i.checked = !!i._get(); else i.value = i._get();
    }
  }
}
