// Local accounts: several players on one PC, each with their own progress, stats, season and
// settings. The game keeps everything under "recoilRange." keys; switching stores the current
// player's keys as a snapshot, then puts the other player's in their place (and the page reloads).
// The PIN is a light lock against a sibling on the same PC, not security: anyone with the
// browser's developer tools can read local storage.
const REG = 'recoilAccounts.v1', SNAP = 'recoilAccount:', PREFIX = 'recoilRange.';
const SHARED = new Set(['recoilRange.hdPack.v1']);          // this PC's graphics download, for everyone
const mine = (k) => (k.startsWith(PREFIX) || k.startsWith('attach:') || k.startsWith('scope:')) && !SHARED.has(k);   // (attach: / scope: are each gun's loadout)

function reg() {
  let r = null;
  try { r = JSON.parse(localStorage.getItem(REG)); } catch { /* blocked or broken */ }
  if (!r || !Array.isArray(r.list) || !r.list.length) r = { current: 'Player 1', list: [{ name: 'Player 1', pin: null }] };
  if (!r.list.some((a) => a.name === r.current)) r.current = r.list[0].name;
  return r;
}
const putReg = (r) => localStorage.setItem(REG, JSON.stringify(r));
// A PIN check value (FNV-1a with the name as salt): enough to keep honest people out.
function pinHash(name, pin) {
  let h = 0x811c9dc5;
  for (const ch of name + '\u0000' + pin) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
// Once per browser: delete every account called name, and its progress. If it is the one in use,
// the next player (or a fresh Player 1) takes over. Returns true when something was deleted (the
// caller reloads). The name can be used again afterwards.
const DROPPED = 'recoilAccountsDropped.v1';   // (not a player key: it outlives switching players)
export function dropAccounts(name, storage = localStorage) {
  const r = reg(), bad = (a) => a.name.toLowerCase() === name.toLowerCase();
  try { if (storage.getItem(DROPPED + ':' + name)) return false; storage.setItem(DROPPED + ':' + name, '1'); if (!r.list.some(bad)) return false; } catch { return false; }
  for (const a of r.list.filter(bad)) storage.removeItem(SNAP + a.name);
  const inUse = bad({ name: r.current });
  r.list = r.list.filter((a) => !bad(a));
  if (!r.list.length) r.list.push({ name: 'Player 1', pin: null });
  if (inUse) {
    const keys = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (mine(k)) keys.push(k); }
    for (const k of keys) storage.removeItem(k);
    const next = r.list[0];
    let snap = {};
    try { snap = JSON.parse(storage.getItem(SNAP + next.name) || '{}') || {}; } catch { snap = {}; }
    for (const [k, v] of Object.entries(snap)) if (mine(k) && typeof v === 'string') storage.setItem(k, v);
    storage.removeItem(SNAP + next.name);
    r.current = next.name;
  }
  putReg(r);
  return true;
}
export function accounts() { const r = reg(); return { current: r.current, list: r.list.map((a) => ({ name: a.name, locked: !!a.pin })) }; }
export const currentAccount = () => reg().current;

// Swap to another account. Throws an Error with a message for the player; on success the
// caller reloads the page. Nothing is removed until the snapshot has been written and read back.
export function switchTo(name, pin = '', storage = localStorage) {
  const r = reg(), to = r.list.find((a) => a.name === name);
  if (!to) throw new Error('No account called ' + name + '.');
  if (name === r.current) return false;
  if (to.pin && to.pin !== pinHash(name, pin)) throw new Error('Wrong PIN for ' + name + '.');
  const keys = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (mine(k)) keys.push(k); }
  const snap = {};
  for (const k of keys) snap[k] = storage.getItem(k);
  const text = JSON.stringify(snap);
  try { storage.setItem(SNAP + r.current, text); } catch { throw new Error('Not enough browser storage to keep ' + r.current + '\'s progress. Nothing was changed.'); }
  if (storage.getItem(SNAP + r.current) !== text) throw new Error('Could not save ' + r.current + '\'s progress. Nothing was changed.');
  let next = {};
  try { next = JSON.parse(storage.getItem(SNAP + name) || '{}') || {}; } catch { next = {}; }
  for (const k of keys) storage.removeItem(k);
  for (const [k, v] of Object.entries(next)) if (mine(k) && typeof v === 'string') storage.setItem(k, v);
  storage.removeItem(SNAP + name);              // its keys are live again
  r.current = name; putReg(r);
  return true;
}
// A new, empty account (then switch to it). pin: '' for none.
export function createAccount(name, pin = '') {
  name = String(name || '').trim().slice(0, 16);
  if (!name) throw new Error('Give the account a name.');
  const r = reg();
  if (r.list.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new Error('There is already an account called ' + name + '.');
  if (r.list.length >= 8) throw new Error('8 accounts at most on one PC.');
  if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('A PIN is 4 to 8 digits (or leave it empty).');
  r.list.push({ name, pin: pin ? pinHash(name, pin) : null });
  putReg(r);
  return name;
}
// Delete another account and its progress (not the one in use).
export function deleteAccount(name, pin = '') {
  const r = reg(), a = r.list.find((x) => x.name === name);
  if (!a || name === r.current) return false;
  if (a.pin && a.pin !== pinHash(name, pin)) throw new Error('Wrong PIN for ' + name + '.');
  r.list = r.list.filter((x) => x !== a); putReg(r);
  localStorage.removeItem(SNAP + name);
  return true;
}
