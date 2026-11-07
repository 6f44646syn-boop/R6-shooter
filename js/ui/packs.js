// Skins & packs: points, the pack opening (a slot-machine reel that slows down and lands on
// your skin), your collection (click to put a skin on the selected gun), and the save code.
import { RARITY, RARITIES, CATALOGUE, SKIN_COUNT, skinById, skinFits, LEGEND_ID } from '../core/skins.js?v=9ecf153-mw64d875';
import { Profile, PACK_COST, KILL_POINTS, HEADSHOT_BONUS, WIN_POINTS } from '../core/profile.js?v=9ecf153-mw64d875';
import { legendPhotoURL, setLegendPhoto, clearLegendPhoto, onLegendChange } from '../core/legend.js?v=9ecf153-mw64d875';
import { skinThumb } from '../render/gpu-tex.js?v=9ecf153-mw64d875';

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}

const CARD = 112, GAP = 8, REEL_LEN = 56, WIN_AT = 50, SPIN_MS = 5200;

export class PackUI {
  // opts: { root (section), app (element for the modal), profile, renderer, sfx, guns,
  //         gunIndex() (selected loadout slot), onEquip(slot) }
  constructor(opts) {
    Object.assign(this, opts);
    this.thumbs = new Map();
    this._build();
    this.profile.onChange(() => this.refresh());
    this.refresh();
  }

  thumb(id, size = 96) {
    if (id === LEGEND_ID) return legendPhotoURL() || '';
    const key = id + '@' + size;
    if (!this.thumbs.has(key)) {
      let url = '';
      try { url = skinThumb(this.renderer, skinById(id), size).toDataURL(); } catch (e) { url = ''; }
      this.thumbs.set(key, url);
    }
    return this.thumbs.get(key);
  }
  // A thumbnail image that fills in shortly after (a few per frame), so a big collection
  // never stalls the page.
  thumbImg(id, attrs = {}) {
    const key = id + '@96';
    const img = el('img', { class: 'pk-thumb', alt: '', ...attrs });
    if (id === LEGEND_ID) { const u = legendPhotoURL(); if (u) img.src = u; else img.classList.add('pk-legend-empty'); return img; }
    if (this.thumbs.has(key)) { img.src = this.thumbs.get(key); return img; }
    img.dataset.thumb = id;
    this._queue = this._queue || new Set();
    this._queue.add(id);
    if (!this._pumping) { this._pumping = true; requestAnimationFrame(() => this._pump()); }
    return img;
  }
  _pump() {
    const t0 = performance.now();
    for (const id of this._queue) {
      this._queue.delete(id);
      const url = this.thumb(id);
      for (const img of document.querySelectorAll('img[data-thumb="' + id + '"]')) { img.src = url; delete img.dataset.thumb; }
      if (performance.now() - t0 > 10) break;
    }
    if (this._queue.size) requestAnimationFrame(() => this._pump()); else this._pumping = false;
  }

  // Legendary: choose the photo for your own skin (kept in this browser only).
  _legendBox() {
    const file = el('input', { type: 'file', accept: 'image/*', id: 'pk-legend-file', class: 'pk-file' });
    const msg = el('p', { class: 'small', role: 'status' });
    const prev = el('img', { class: 'pk-thumb pk-legend-prev', alt: '' });
    const show = () => { const u = legendPhotoURL(); prev.hidden = !u; if (u) prev.src = u; };
    file.addEventListener('change', async () => {
      try { await setLegendPhoto(file.files[0]); msg.textContent = 'Photo set. Equip "Legend" on any gun below or on the weapon screen.'; }
      catch (e) { msg.textContent = e.message; }
      file.value = ''; show(); this.refresh();
    });
    onLegendChange(() => { show(); this.thumbs.delete(LEGEND_ID + '@96'); });
    show();
    return el('div', { class: 'pk-legend' },
      el('div', { class: 'pk-legend-text' },
        el('h3', { class: 'pk-h3 r-legendary-text', text: 'Legendary: your own photo' }),
        el('p', { class: 'small', text: 'Turn a photo into a skin for every gun. It stays in this browser only: it is not in the game files or your save code, and other players see a gold Legendary finish instead.' }),
        el('div', { class: 'row' },
          el('label', { class: 'pk-file-btn', for: 'pk-legend-file', text: 'Choose photo' }), file,
          el('button', { type: 'button', text: 'Remove photo', onclick: () => { clearLegendPhoto(); msg.textContent = 'Photo removed.'; show(); this.refresh(); } })),
        msg),
      prev);
  }

  _build() {
    const r = this.root;
    this.pointsEl = el('b', { text: '0' });
    this.openBtn = el('button', { type: 'button', class: 'primary', text: 'Open pack (' + PACK_COST + ' points)', onclick: () => this.open() });
    this.countEl = el('span', { text: '0' });
    this.grid = el('div', { class: 'pk-grid', role: 'list' });
    this.showAll = false;
    this.allBtn = el('button', { type: 'button', class: 'pk-all', text: 'Show all ' + SKIN_COUNT + ' skins', onclick: () => { this.showAll = !this.showAll; this.refresh(); } });
    this.slotNote = el('p', { class: 'small' });
    this.codeOut = el('textarea', { readonly: '', spellcheck: 'false', rows: '2', id: 'pk-code-out' });
    this.codeIn = el('input', { type: 'text', spellcheck: 'false', id: 'pk-code-in', placeholder: 'RRS1-...' });
    this.codeMsg = el('p', { class: 'small', role: 'status' });
    r.append(
      el('h2', { text: 'Skins & packs' }),
      el('div', { class: 'pk-top' },
        el('div', { class: 'pk-points' }, this.pointsEl, el('span', { text: ' points' })),
        this.openBtn),
      el('p', { class: 'small', text: KILL_POINTS + ' points per battle kill (+' + HEADSHOT_BONUS + ' for a headshot), +' + WIN_POINTS + ' for winning a battle. Odds: ' +
        RARITIES.filter((x) => x.odds > 0).map((x) => x.name + ' ' + Math.round(x.odds * 100) + '%').join(' · ') + '. A duplicate gives points back.' }),
      this._legendBox(),
      el('div', { class: 'pk-top' }, el('h3', { class: 'pk-h3' }, el('span', { text: 'Collection ' }), this.countEl, el('span', { text: ' / ' + SKIN_COUNT })), this.allBtn),
      this.grid, this.slotNote,
      el('div', { class: 'pk-save' },
        el('label', { class: 'field', for: 'pk-code-out' }, el('span', { text: 'Save code: copy it to keep your progress on another PC or browser' }), this.codeOut),
        el('div', { class: 'row' }, el('button', { type: 'button', text: 'Copy save code', onclick: () => this.copyCode() })),
        el('label', { class: 'field', for: 'pk-code-in' }, el('span', { text: 'Load a save code (replaces the progress in this browser)' }), this.codeIn),
        el('div', { class: 'row' }, el('button', { type: 'button', text: 'Load', onclick: () => this.loadCode() })),
        this.codeMsg),
    );

    // The pack opening overlay.
    this.strip = el('div', { class: 'pk-strip' });
    this.reveal = el('div', { class: 'pk-reveal', hidden: '' });
    this.skipBtn = el('button', { type: 'button', text: 'Skip', onclick: () => this._finish() });
    this.modal = el('div', { class: 'pk-modal', hidden: '' },
      el('div', { class: 'pk-box' },
        el('h1', { text: 'Opening pack' }),
        el('div', { class: 'pk-reel' }, this.strip, el('div', { class: 'pk-marker' })),
        el('div', { class: 'row pk-skip' }, this.skipBtn),
        this.reveal));
    this.app.append(this.modal);
  }

  refresh() {
    const p = this.profile;
    this.pointsEl.textContent = String(p.points);
    this.openBtn.disabled = !p.canOpen || !this.modal.hidden;
    this.countEl.textContent = String(p.ownedCount);
    this.codeOut.value = p.saveCode();
    const slot = this.gunIndex(), gun = this.guns[slot];
    const eq = p.equippedFor(slot);
    this.slotNote.textContent = 'Click a skin to put it on ' + gun.name + ' (slot ' + ((slot + 1) % 10) + ', selected in Loadout).';
    const cards = [el('button', {
      type: 'button', class: 'pk-card factory' + (eq === null ? ' on' : ''), title: 'No skin (factory finish)',
      onclick: () => { p.equip(slot, null); this.onEquip(slot); },
    }, el('span', { class: 'pk-thumb plain' }), el('span', { class: 'pk-name', text: 'Factory finish' }))];
    // Your skins, or (Show all) the whole catalogue rarest first, with the ones you lack locked.
    this.allBtn.textContent = this.showAll ? 'Show only mine' : 'Show all ' + SKIN_COUNT + ' skins';
    const order = { blackice: 0, epic: 1, rare: 2, common: 3 };
    const ids = [LEGEND_ID, ...(this.showAll ? CATALOGUE.map((s) => s.id).sort((a, b) => order[CATALOGUE[a].rarity] - order[CATALOGUE[b].rarity] || a - b) : p.ownedIds())];
    for (const id of ids) {
      const s = skinById(id), rar = RARITY[s.rarity], have = p.has(id);
      const fit = this.fits(id, slot), only = this.onlyFor(id);
      cards.push(el('button', {
        type: 'button', class: 'pk-card r-' + s.rarity + (eq === id ? ' on' : '') + (have ? '' : ' locked') + (have && !fit ? ' nofit' : ''),
        title: s.name + ' (' + rar.name + ')' + (only ? '. ' + only : '') + (have ? '' : ': not unlocked yet'),
        onclick: have && fit ? () => { p.equip(slot, id); this.onEquip(slot); } : null,
      }, this.thumbImg(id), el('span', { class: 'pk-name', text: s.name }),
      el('span', { class: 'pk-rar', text: have ? rar.name : rar.name + ' · Locked' }),
      only ? el('span', { class: 'pk-only', text: only }) : null));
    }
    this.grid.replaceChildren(...cards);
  }

  // Weapon select screen: the skins you own for this gun (plus the factory finish).
  renderArmorySkins(container, slot) {
    const p = this.profile, eq = p.equippedFor(slot);
    const pick = (id) => { p.equip(slot, id); this.onEquip(slot); };
    const cards = [el('button', { type: 'button', class: 'pk-card factory' + (eq === null ? ' on' : ''), onclick: () => pick(null) },
      el('span', { class: 'pk-thumb plain' }), el('span', { class: 'pk-name', text: 'Factory finish' }))];
    const order = { blackice: 0, epic: 1, rare: 2, common: 3 };
    for (const id of [LEGEND_ID, ...p.ownedIds().filter((i) => this.fits(i, slot)).sort((a, b) => order[CATALOGUE[a].rarity] - order[CATALOGUE[b].rarity] || a - b)]) {
      const s = skinById(id);
      cards.push(el('button', { type: 'button', class: 'pk-card r-' + s.rarity + (eq === id ? ' on' : ''), title: s.name, onclick: () => pick(id) },
        this.thumbImg(id), el('span', { class: 'pk-name', text: s.name }),
        el('span', { class: 'pk-rar', text: RARITY[s.rarity].name })));
    }
    container.replaceChildren(...cards);
  }
  // Can skin id go on the gun in this slot? (Some skins are made for certain guns only.)
  fits(id, slot) { return skinFits(id, slot); }
  onlyFor(id) { const s = skinById(id); return s.guns ? 'Only for ' + s.guns.map((i) => this.guns[i] ? this.guns[i].name : '?').join(', ') : ''; }

  async copyCode() {
    try { await navigator.clipboard.writeText(this.codeOut.value); this.codeMsg.textContent = 'Save code copied.'; }
    catch (e) { this.codeOut.select(); this.codeMsg.textContent = 'Press Ctrl+C to copy the selected code.'; }
  }
  loadCode() {
    try { this.profile.loadCode(this.codeIn.value); this.codeIn.value = ''; this.codeMsg.textContent = 'Progress loaded.'; this.onEquip(this.gunIndex()); }
    catch (e) { this.codeMsg.textContent = e.message; }
  }

  /* ---------- the slot machine ---------- */
  open(rng = Math.random) {
    if (!this.modal.hidden) return null;
    const res = this.profile.openPack(rng);
    if (!res) return null;
    this.result = res;
    // A reel of random skins (same odds as packs); the winning card sits at WIN_AT.
    const ids = Array.from({ length: REEL_LEN }, (_, i) => (i === WIN_AT ? res.skin.id : Profile.roll(rng).id));
    this.strip.replaceChildren(...ids.map((id) => {
      const s = CATALOGUE[id];
      return el('div', { class: 'pk-card r-' + s.rarity }, el('img', { class: 'pk-thumb', src: this.thumb(id), alt: '' }), el('span', { class: 'pk-name', text: s.name }));
    }));
    this.reveal.hidden = true;
    this.skipBtn.hidden = false;
    this.modal.hidden = false;
    this.openBtn.disabled = true;
    // Land on the winning card, a little off-centre so it is not always dead centre.
    const reelW = this.strip.parentElement.clientWidth || 600;
    const target = WIN_AT * (CARD + GAP) + CARD / 2 - reelW / 2 + (rng() - 0.5) * CARD * 0.7;
    this.strip.style.transition = 'none';
    this.strip.style.transform = 'translateX(0px)';
    void this.strip.offsetWidth;                       // restart the transition
    this.strip.style.transition = 'transform ' + SPIN_MS + 'ms cubic-bezier(0.08, 0.72, 0.16, 1)';
    this.strip.style.transform = 'translateX(' + (-target) + 'px)';
    this._target = target;
    this._lastCard = -1;
    this._spinning = true;
    const tick = () => {
      if (!this._spinning) return;
      const m = getComputedStyle(this.strip).transform;
      const x = m && m !== 'none' ? -parseFloat(m.split(',')[4]) : 0;
      const card = Math.floor((x + reelW / 2) / (CARD + GAP));
      if (card !== this._lastCard) { this._lastCard = card; if (this.sfx) this.sfx.click(); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this._timer = setTimeout(() => this._finish(), SPIN_MS + 100);
    return res;
  }

  _finish() {
    if (!this._spinning) return;
    this._spinning = false;
    clearTimeout(this._timer);
    this.strip.style.transition = 'none';
    this.strip.style.transform = 'translateX(' + (-this._target) + 'px)';
    this.strip.children[WIN_AT].classList.add('win');
    this.skipBtn.hidden = true;
    const { skin, duplicate, refund } = this.result, rar = RARITY[skin.rarity];
    const slot = this.gunIndex(), gun = this.guns[slot];
    this.reveal.className = 'pk-reveal r-' + skin.rarity;
    this.reveal.replaceChildren(
      (() => { const url = this.shot ? this.shot(skin.id) : ''; return url ? el('img', { class: 'pk-shot', src: url, alt: skin.name + ' on a gun' }) : el('img', { class: 'pk-big', src: this.thumb(skin.id, 192), alt: '' }); })(),
      el('div', { class: 'pk-info' },
        el('div', { class: 'pk-rarity', text: rar.name }),
        el('div', { class: 'pk-title', text: skin.name }),
        this.onlyFor(skin.id) ? el('div', { class: 'pk-only', text: 'Exclusive: ' + this.onlyFor(skin.id).replace('Only for ', '') }) : null,
        el('p', { class: 'small', text: duplicate ? 'Duplicate: +' + refund + ' points back.' : 'New skin! (' + this.profile.ownedCount + ' / ' + SKIN_COUNT + ' collected)' }),
        el('div', { class: 'row' },
          this.fits(skin.id, slot)
            ? el('button', { type: 'button', class: 'primary', text: 'Put on ' + gun.name, onclick: () => { this.profile.equip(slot, skin.id); this.onEquip(slot); this.close(); } })
            : el('span', { class: 'pk-only', text: this.onlyFor(skin.id) }),
          el('button', { type: 'button', text: 'Open another (' + PACK_COST + ')', disabled: this.profile.canOpen ? null : '', onclick: () => { this.close(); this.open(); } }),
          el('button', { type: 'button', text: 'Close', onclick: () => this.close() }))));
    if (!this.profile.canOpen) this.reveal.querySelectorAll('button')[1].disabled = true;
    this.reveal.hidden = false;
    if (this.sfx) this.sfx.reload();
  }
  close() { this._spinning = false; clearTimeout(this._timer); this.modal.hidden = true; this.refresh(); }
}
