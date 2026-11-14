// Skins & packs: points, the pack opening (a slot-machine reel that slows down and lands on
// your skin), your collection (click to put a skin on the selected gun), and the save code.
import { RARITY, RARITIES, CATALOGUE, SKIN_COUNT, skinById, skinFits, LEGEND_ID } from '../core/skins.js?v=ba75b4c-mwgabqbe';
import { Profile, PACK_COST, LEGEND_PACK_COST, KILL_POINTS, HEADSHOT_BONUS, WIN_POINTS } from '../core/profile.js?v=ba75b4c-mwgabqbe';
import { legendPhotoURL, setLegendPhoto, clearLegendPhoto, onLegendChange } from '../core/legend.js?v=ba75b4c-mwgabqbe';
import { skinThumb } from '../render/gpu-tex.js?v=ba75b4c-mwgabqbe';
import { matches, totals } from '../core/history.js?v=ba75b4c-mwgabqbe';
import { CHARMS } from '../core/charms.js?v=ba75b4c-mwgabqbe';
import { BOARD, ranking, myCode, addFriend, removeFriend, myName, setName, friends } from '../core/bests.js?v=ba75b4c-mwgabqbe';
import { TRADE_UP, TRADE_NEXT } from '../core/profile.js?v=ba75b4c-mwgabqbe';
import { mulberry32 } from '../core/prng.js?v=ba75b4c-mwgabqbe';

// Weekly shop prices (a pack is 100 points for a random skin).
const SHOP_PRICE = { common: 120, rare: 250, epic: 450, blackice: 900, legendary: 1500 };

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}

const EARN_TEXT = () => KILL_POINTS + ' points per battle kill (+' + HEADSHOT_BONUS + ' for a headshot), +' + WIN_POINTS + ' for winning a battle. Odds: ' +
  RARITIES.map((x) => x.name + ' ' + new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 3 }).format(x.odds)).join(' · ') + '. A duplicate gives points back.';
const PIRATE_TEXT = 'Pirate Token: find the Pirate Chest in Battle Royale and the token inside unlocks every Black Ice skin at once.';
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
    if (skinById(id).art) return skinById(id).art;          // painted skins: their artwork
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
    this.statsEl = el('div', { class: 'pk-stats' });
    this.boardEl = el('div', { class: 'pk-stats' });
    r.append(
      el('h2', { text: 'Skins & packs' }),
      el('div', { class: 'pk-top' },
        el('div', { class: 'pk-points' }, this.pointsEl, el('span', { text: ' points' })),
        this.openBtn),
      el('p', { class: 'small', text: EARN_TEXT() }),
      this._legendBox(),
      el('div', { class: 'pk-top' }, el('h3', { class: 'pk-h3' }, el('span', { text: 'Collection ' }), this.countEl, el('span', { text: ' / ' + SKIN_COUNT })), this.allBtn),
      el('div', { class: 'row' }, this.slotNote, el('button', { type: 'button', class: 'primary', text: 'Inspect on your gun', title: 'See the skin and charm on the gun in your hands (Esc or click to stop)', onclick: () => this.inspect?.() })),
      this.grid,
      this.statsEl,
      this.boardEl,
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

  // The Packs menu (its own page): points, one big open button, how to earn points and the odds.
  mountShop(root) {
    this.shopPoints = el('b', { text: '0' });
    this.shopBtn = el('button', { type: 'button', class: 'primary pk-shop-open', id: 'shop-open', text: 'Open a pack · ' + PACK_COST + ' points', onclick: () => this.open() });
    this.shopNeed = el('p', { class: 'pk-shop-need' });
    this.legendBtn = el('button', { type: 'button', class: 'pk-shop-open pk-legend-open', id: 'shop-legend', text: 'Legendary pack · ' + LEGEND_PACK_COST + ' points', onclick: () => this.open(Math.random, true) });
    this.legendNote = el('p', { class: 'small' });
    root.append(el('div', { class: 'pk-shop' },
      el('div', { class: 'pk-points pk-shop-points' }, this.shopPoints, el('span', { text: ' points' })),
      this.shopBtn, this.shopNeed, this.legendBtn, this.legendNote,
      el('p', { class: 'small', text: EARN_TEXT() }), el('p', { class: 'small pk-pirate', text: PIRATE_TEXT })));
    this.weekEl = el('div', { class: 'pk-extra' }); this.tradeEl = el('div', { class: 'pk-extra' }); this.charmEl = el('div', { class: 'pk-extra' });
    root.append(this.weekEl, this.tradeEl, this.charmEl);
    this.refresh();
  }
  refresh() {
    const p = this.profile;
    this.pointsEl.textContent = String(p.points);
    if (this.shopBtn) {
      this.shopPoints.textContent = String(p.points);
      this.shopBtn.disabled = !p.canOpen || !this.modal.hidden;
      this.legendBtn.disabled = !p.canOpenLegend || !this.modal.hidden;
      this.legendNote.textContent = p.legendPack ? 'Legendary pack opened: one per player.' : 'One per player: a Legendary skin guaranteed (one you do not have yet).';
      const packsNow = Math.floor(p.points / PACK_COST);
      this.shopNeed.textContent = packsNow ? 'You can open ' + packsNow + ' pack' + (packsNow > 1 ? 's' : '') + ' now.' : (PACK_COST - p.points) + ' more points for your next pack.';
    }
    this.openBtn.disabled = !p.canOpen || !this.modal.hidden;
    this.countEl.textContent = String(p.ownedCount);
    this.codeOut.value = p.saveCode();
    this._stats();
    this._board();
    this._shopExtras();
    const slot = this.gunIndex(), gun = this.guns[slot];
    const eq = p.equippedFor(slot);
    this.slotNote.textContent = 'Click a skin to put it on ' + gun.name + ' (slot ' + ((slot + 1) % 10) + ', selected in Loadout).';
    const cards = [el('button', {
      type: 'button', class: 'pk-card factory' + (eq === null ? ' on' : ''), title: 'No skin (factory finish)',
      onclick: () => { p.equip(slot, null); this.onEquip(slot); },
    }, el('span', { class: 'pk-thumb plain' }), el('span', { class: 'pk-name', text: 'Factory finish' }))];
    // Your skins, or (Show all) the whole catalogue rarest first, with the ones you lack locked.
    this.allBtn.textContent = this.showAll ? 'Show only mine' : 'Show all ' + SKIN_COUNT + ' skins';
    const order = { legendary: 0, blackice: 1, epic: 2, rare: 3, common: 4 };
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
    const order = { legendary: 0, blackice: 1, epic: 2, rare: 3, common: 4 };
    for (const id of [LEGEND_ID, ...p.ownedIds().filter((i) => this.fits(i, slot)).sort((a, b) => order[CATALOGUE[a].rarity] - order[CATALOGUE[b].rarity] || a - b)]) {
      const s = skinById(id);
      cards.push(el('button', { type: 'button', class: 'pk-card r-' + s.rarity + (eq === id ? ' on' : ''), title: s.name, onclick: () => pick(id) },
        this.thumbImg(id), el('span', { class: 'pk-name', text: s.name }),
        el('span', { class: 'pk-rar', text: RARITY[s.rarity].name })));
    }
    container.replaceChildren(...cards);
  }
  // Your stats: totals over the last 50 matches and the last 10 of them.
  _stats() {
    const t = totals(), MODE = { battle: 'Battle', gungame: 'Gun Game', endless: 'Endless', royale: 'Battle Royale', tdm: 'Team Deathmatch', ctf: 'Capture the Flag', bomb: 'Bomb' };
    const kids = [el('h3', { class: 'pk-h3', text: 'Your stats' })];
    if (!t.matches) kids.push(el('p', { class: 'small', text: 'Finish a match and it shows up here.' }));
    else {
      kids.push(el('p', { class: 'small', text: t.matches + ' matches · ' + t.wins + ' wins (' + Math.round(t.wins / t.matches * 100) + '%) · ' + t.kills + ' kills · K/D ' + t.kd.toFixed(2) + (t.best ? ' · most kills with ' + t.best : '') }));
      kids.push(el('div', { class: 'pk-hist', role: 'list' }, ...matches().slice(0, 10).map((m) => el('div', { class: 'pk-hrow r-' + m.result, role: 'listitem' },
        el('span', { text: m.result === 'win' ? 'Win' : m.result === 'draw' ? 'Draw' : m.place ? '#' + m.place : 'Loss' }),
        el('span', { text: MODE[m.mode] || m.mode }),
        el('span', { text: m.kills + ' / ' + m.deaths }),
        el('span', { text: m.gun }),
        el('span', { class: 'pk-when', text: new Date(m.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })))));
    }
    this.statsEl.replaceChildren(...kids);
  }
  // Leaderboards: your bests against friends' (from the score codes they send you).
  _board() {
    const name = el('input', { type: 'text', maxlength: '16', value: myName(), 'aria-label': 'Your name on leaderboards', class: 'lb-name' });
    name.addEventListener('change', () => { setName(name.value); this._board(); });
    const code = el('input', { type: 'text', readonly: '', value: myCode(), 'aria-label': 'Your score code', class: 'lb-code' });
    const paste = el('input', { type: 'text', placeholder: 'Paste a friend\'s score code (RRB1-...)', 'aria-label': 'Friend\'s score code', class: 'lb-code' });
    const msg = el('p', { class: 'small', role: 'status' });
    const copy = el('button', { type: 'button', text: 'Copy my code', onclick: async () => { try { await navigator.clipboard.writeText(code.value); msg.textContent = 'Copied: send it to a friend.'; } catch { code.select(); msg.textContent = 'Press Ctrl+C to copy.'; } } });
    const add = el('button', { type: 'button', text: 'Add friend', onclick: () => { try { const n = addFriend(paste.value); this._board(); this.boardEl.querySelector('[role=status]').textContent = n + ' added.'; } catch (e) { msg.textContent = e.message; } } });
    const boards = BOARD.map((b) => {
      const rows = ranking(b.key);
      return el('div', { class: 'lb-board' }, el('b', { text: b.label }),
        ...(rows.length ? rows.slice(0, 6).map((r, i) => el('div', { class: 'lb-row' + (r.me ? ' me' : '') }, el('span', { text: (i + 1) + '. ' + r.name }), el('span', { text: r.value + b.unit }))) : [el('span', { class: 'small', text: 'No score yet' })]));
    });
    const fr = friends();
    this.boardEl.replaceChildren(el('h3', { class: 'pk-h3', text: 'Leaderboards' }),
      el('div', { class: 'row' }, el('span', { class: 'small', text: 'Your name' }), name, copy), code,
      el('div', { class: 'row' }, paste, add), msg,
      el('div', { class: 'lb-grid' }, ...boards),
      fr.length ? el('div', { class: 'pk-trades' }, ...fr.map((f) => el('button', { type: 'button', text: '× ' + f.name, title: 'Remove ' + f.name, onclick: () => { removeFriend(f.name); this._board(); } }))) : null);
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

  // This week's shop: a Rare, an Epic and a Black Ice or Legendary skin, plus a charm (the same
  // for everyone, new each Monday).
  weekOffers(now = Date.now()) {
    const week = Math.floor((now / 86400000 + 3) / 7), rng = mulberry32(week * 2654435761 >>> 0);
    const pick = (rarity) => { const pool = CATALOGUE.filter((s) => s.rarity === rarity && s.id !== LEGEND_ID && !s.photo); return pool[Math.floor(rng() * pool.length)]; };
    const skins = [pick('rare'), pick('epic'), pick(week % 2 ? 'legendary' : 'blackice')];
    return { week, skins, charm: CHARMS[Math.floor(rng() * CHARMS.length)], ends: (week + 1) * 7 * 86400000 - 3 * 86400000 };
  }
  _shopExtras() {
    if (!this.weekEl) return;
    const p = this.profile, w = this.weekOffers(), days = Math.max(1, Math.ceil((w.ends - Date.now()) / 86400000));
    const buy = (label, price, owned, fn) => el('button', { type: 'button', class: 'primary', text: owned ? 'Owned' : label + ' · ' + price, disabled: owned || p.points < price ? '' : null, onclick: () => { if (fn()) { this.refresh(); this.onEquip(this.gunIndex()); } } });
    this.weekEl.replaceChildren(el('h3', { class: 'pk-h3', text: 'This week · new skins in ' + days + ' day' + (days > 1 ? 's' : '') }),
      el('div', { class: 'pk-offers' },
        ...w.skins.map((s) => el('div', { class: 'pk-offer r-' + s.rarity }, this.thumbImg(s.id), el('span', { class: 'pk-name', text: s.name }), el('span', { class: 'pk-rar', text: RARITY[s.rarity].name + (s.guns ? ' · ' + this.onlyFor(s.id) : '') }),
          buy('Buy', SHOP_PRICE[s.rarity], p.has(s.id), () => p.buySkin(s.id, SHOP_PRICE[s.rarity])))),
        el('div', { class: 'pk-offer pk-charm-offer' }, el('span', { class: 'pk-charm-dot', style: 'background:#' + w.charm.color.toString(16).padStart(6, '0') }), el('span', { class: 'pk-name', text: w.charm.name }), el('span', { class: 'pk-rar', text: 'Charm' }),
          buy('Buy', w.charm.price, p.hasCharm(w.charm.id), () => p.buyCharm(w.charm.id)))));
    this.tradeEl.replaceChildren(el('h3', { class: 'pk-h3', text: 'Trade up' }),
      el('p', { class: 'small', text: 'Duplicates from packs count here (you still get their points). ' + TRADE_UP + ' duplicates of one rarity become a skin of the next rarity, one you do not have yet when there is one.' }),
      el('div', { class: 'pk-trades' }, ...Object.keys(TRADE_NEXT).map((r) => el('button', { type: 'button', class: 'pk-trade r-' + r, disabled: p.canTradeUp(r) && this.modal.hidden ? null : '',
        text: p.dups[r] + ' / ' + TRADE_UP + ' ' + RARITY[r].name + ' → ' + RARITY[TRADE_NEXT[r]].name, onclick: () => this.open(Math.random, false, p.tradeUp(r)) }))));
    this.charmEl.replaceChildren(el('h3', { class: 'pk-h3', text: 'Your charms' }),
      el('div', { class: 'pk-trades' },
        el('button', { type: 'button', class: p.charm === null ? 'on' : '', text: 'No charm', onclick: () => { p.wearCharm(null); this.refresh(); this.onEquip(this.gunIndex()); } }),
        ...CHARMS.map((c) => el('button', { type: 'button', class: p.charm === c.id ? 'on' : '', disabled: p.hasCharm(c.id) ? null : '', title: p.hasCharm(c.id) ? 'Hang it on your guns' : 'Comes to the weekly shop now and then (' + c.price + ' points)',
          text: c.name, onclick: () => { p.wearCharm(c.id); this.refresh(); this.onEquip(this.gunIndex()); } }))));
  }

  /* ---------- the slot machine ---------- */
  // given: a result made elsewhere (a trade-up) to show on the reel.
  open(rng = Math.random, legend = false, given = null) {
    if (!this.modal.hidden) return null;
    const res = given || (legend ? this.profile.openLegendPack(rng) : this.profile.openPack(rng));
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
    this.reveal.hidden = false;
    if (this.sfx) this.sfx.reload();
  }
  close() { this._spinning = false; clearTimeout(this._timer); this.modal.hidden = true; this.refresh(); }
}
