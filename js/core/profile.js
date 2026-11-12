// Your progress: points, the skins you own, which skin each gun wears, and a few stats.
// Kept in this browser (localStorage) and in a save code you can copy to another PC or
// browser. The code is checksummed so a typo (or an edited code) is rejected.
//
// Points: KILL_POINTS per battle kill (+ HEADSHOT_BONUS for a headshot kill), WIN_POINTS for
// winning a battle. A pack costs PACK_COST and gives one random skin; a duplicate refunds
// points instead (by rarity).
import { RARITIES, CATALOGUE, SKIN_COUNT, LEGEND_ID, skinFits } from './skins.js?v=d449e87-mwdhjwml';
import { HISTORY_LIMIT, START_RATING, ratingOf } from './ranked.js?v=d449e87-mwdhjwml';

export const KILL_POINTS = 20, HEADSHOT_BONUS = 10, WIN_POINTS = 50, PACK_COST = 100;
const KEY = 'recoilRange.profile.v1';
const SLOTS = 10;
const CODE_PREFIX = 'RRS1-';
const NONE = 255;
const OUTCOMES = ['loss', 'draw', 'win'];
const RANK_RECORD = 18;
const LEGEND_BYTE = 254;          // the Legendary skin in a save code (the photo itself is not saved)

function crc16(bytes) {            // CRC-16/CCITT, salted
  let c = 0x5a17;
  for (const b of bytes) {
    c ^= b << 8;
    for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64u(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export class Profile {
  constructor(storage = null) {
    this.storage = storage;
    this.reset();
    this.listeners = new Set();
    this.load();
  }
  reset() {
    this.points = 0;
    this.owned = new Uint8Array(Math.ceil(SKIN_COUNT / 8));
    this.equipped = new Array(SLOTS).fill(null);
    this.kills = 0; this.packs = 0;
    this.rating = START_RATING; this.rankedHistory = [];
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _changed() { this.save(); for (const fn of this.listeners) fn(this); }

  // The Legendary (your photo) is always yours.
  has(id) { return id === LEGEND_ID || (id >= 0 && id < SKIN_COUNT && (this.owned[id >> 3] & (1 << (id & 7))) !== 0); }
  get ownedCount() { let n = 0; for (let i = 0; i < SKIN_COUNT; i++) if (this.has(i)) n++; return n; }
  ownedIds() { const out = []; for (let i = 0; i < SKIN_COUNT; i++) if (this.has(i)) out.push(i); return out; }
  _own(id) { this.owned[id >> 3] |= 1 << (id & 7); }

  unlockBlackIce() {
    const locked = CATALOGUE.filter(skin => skin.rarity === 'blackice' && !this.has(skin.id));
    for (const skin of locked) this._own(skin.id);
    if (locked.length) this._changed();
  }

  equippedFor(slot) { const id = this.equipped[slot]; return id !== null && this.has(id) ? id : null; }
  equip(slot, id) {
    if (slot < 0 || slot >= SLOTS) return false;
    if (id !== null && (!this.has(id) || !skinFits(id, slot))) return false;
    this.equipped[slot] = id;
    this._changed();
    return true;
  }

  // A kill in battle (headshot: bonus); returns the points added.
  addKill(head = false) { this.kills++; return this.addPoints(KILL_POINTS + (head ? HEADSHOT_BONUS : 0)); }
  addPoints(n) { this.points = Math.min(0xffffffff, this.points + Math.max(0, Math.round(n))); this._changed(); return n; }

  applyRanked(change) {
    if (!change || !/^[0-9a-f]{32}$/.test(change.id) || !OUTCOMES.includes(change.outcome)
      || !Number.isInteger(change.delta) || Math.abs(change.delta) > 32
      || this.rankedHistory.some(entry => entry.id === change.id)) return null;
    const next = ratingOf(this.rating + change.delta);
    const entry = { ...change, delta: next - this.rating };
    this.rating = next;
    this.rankedHistory = [entry, ...this.rankedHistory].slice(0, HISTORY_LIMIT);
    this._changed();
    return entry;
  }

  get canOpen() { return this.points >= PACK_COST; }
  // Pick a skin for a pack: a rarity by its odds, then any skin of that rarity.
  static roll(rng = Math.random) {
    let r = rng(), rar = RARITIES[0];
    for (const x of RARITIES) { if (r < x.odds) { rar = x; break; } r -= x.odds; }
    const pool = CATALOGUE.filter((s) => s.rarity === rar.key);
    return pool[Math.floor(rng() * pool.length)];
  }
  // Spend PACK_COST points on a pack. Returns { skin, duplicate, refund } or null.
  openPack(rng = Math.random) {
    if (!this.canOpen) return null;
    this.points -= PACK_COST;
    this.packs++;
    const skin = Profile.roll(rng);
    const duplicate = this.has(skin.id);
    const refund = duplicate ? RARITIES.find((r) => r.key === skin.rarity).refund : 0;
    if (duplicate) this.points += refund; else this._own(skin.id);
    this._changed();
    return { skin, duplicate, refund };
  }

  /* ---------- storage and save codes ---------- */
  _bytes() {
    const b = new Uint8Array(1 + 4 + this.owned.length + SLOTS + 4 + 2 + 3 + RANK_RECORD * this.rankedHistory.length);
    const dv = new DataView(b.buffer);
    let o = 0;
    b[o++] = 4;                                   // format version (3: local ranked rating and history; 4: room for more than 208 skins)
    dv.setUint32(o, this.points, true); o += 4;
    b.set(this.owned, o); o += this.owned.length;
    for (let i = 0; i < SLOTS; i++) b[o++] = this.equipped[i] === null ? NONE : this.equipped[i] === LEGEND_ID ? LEGEND_BYTE : this.equipped[i];
    dv.setUint32(o, Math.min(this.kills, 0xffffffff), true); o += 4;
    dv.setUint16(o, Math.min(this.packs, 0xffff), true); o += 2;
    dv.setUint16(o, this.rating, true); o += 2;
    b[o++] = this.rankedHistory.length;
    for (const { id, delta, outcome } of this.rankedHistory) {
      for (let i = 0; i < 32; i += 2) b[o++] = Number.parseInt(id.slice(i, i + 2), 16);
      dv.setInt8(o++, delta);
      b[o++] = OUTCOMES.indexOf(outcome);
    }
    return b;
  }
  saveCode() {
    const body = this._bytes();
    const all = new Uint8Array(body.length + 2);
    all.set(body);
    const c = crc16(body);
    all[body.length] = c & 0xff; all[body.length + 1] = c >> 8;
    return CODE_PREFIX + b64u(all);
  }
  // Load a save code. Returns true, or throws an Error with a message for the player.
  loadCode(code) {
    const s = String(code || '').replace(/\s+/g, '');
    if (!s.startsWith(CODE_PREFIX)) throw new Error('That is not a Recoil Range save code.');
    let all;
    try { all = unb64u(s.slice(CODE_PREFIX.length)); } catch (e) { throw new Error('The save code is damaged. Copy all of it.'); }
    if (all.length < 3) throw new Error('The save code is too short.');
    const body = all.subarray(0, all.length - 2);
    const c = all[all.length - 2] | (all[all.length - 1] << 8);
    if (crc16(body) !== c) throw new Error('The save code does not check out (a character is wrong or missing).');
    if (![1, 2, 3, 4].includes(body[0])) throw new Error('This save code is from a newer version. Refresh the page (Ctrl+F5).');
    this._fromBytes(body);
    this._changed();
    return true;
  }
  _fromBytes(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const len = b[0] === 1 ? 25 : b[0] < 4 ? 26 : Math.ceil(SKIN_COUNT / 8);   // owned flags: 200, then 208 skins
    const base = 1 + 4 + len + SLOTS + 4 + 2;
    const count = b[0] >= 3 ? b[base + 2] : 0;
    const expected = b[0] >= 3 ? base + 3 + RANK_RECORD * count : base;
    if (b.length !== expected || count > HISTORY_LIMIT) throw new Error('The save code has an invalid length.');
    const history = [];
    let rating = START_RATING;
    if (b[0] >= 3) {
      rating = ratingOf(dv.getUint16(base, true));
      let offset = base + 3;
      for (let i = 0; i < count; i++) {
        const id = Array.from(b.subarray(offset, offset + 16), v => v.toString(16).padStart(2, '0')).join('');
        offset += 16;
        const delta = dv.getInt8(offset++), outcome = OUTCOMES[b[offset++]];
        if (!outcome || Math.abs(delta) > 32 || history.some(entry => entry.id === id)) throw new Error('The ranked history is invalid.');
        history.push({ id, delta, outcome });
      }
    }
    let o = 1;
    this.points = dv.getUint32(o, true); o += 4;
    this.owned = new Uint8Array(Math.ceil(SKIN_COUNT / 8));
    this.owned.set(b.slice(o, o + len)); o += len;
    for (let i = 0; i < SLOTS; i++) { const v = b[o++]; this.equipped[i] = v === LEGEND_BYTE ? LEGEND_ID : v === NONE || v >= SKIN_COUNT ? null : v; }
    this.kills = dv.getUint32(o, true); o += 4;
    this.packs = dv.getUint16(o, true);
    this.rating = rating; this.rankedHistory = history;
  }
  save() {
    const st = this.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    try { if (st) st.setItem(KEY, this.saveCode()); } catch (e) { /* storage blocked: the save code still works */ }
  }
  load() {
    const st = this.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    let code = null;
    try { code = st ? st.getItem(KEY) : null; } catch (e) { code = null; }
    if (!code) return;
    try { const l = this.listeners; this.listeners = new Set(); this.loadCode(code); this.listeners = l; } catch (e) { this.reset(); }
  }
}
