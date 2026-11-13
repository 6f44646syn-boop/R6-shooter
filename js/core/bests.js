// Your personal bests, and friends' bests from the score codes they share (no server: a code
// is your name and bests, checksummed). Kept in this browser.
const KEY = 'recoilRange.bests.v1', PREFIX = 'RRB1-';
export const BOARD = [
  { key: 'endless', label: 'Best Endless run', unit: ' kills', better: 'high' },
  { key: 'kills', label: 'Most kills in a match', unit: '', better: 'high' },
  { key: 'range', label: 'Best range magazine', unit: ' hits', better: 'high' },
  { key: 'longest', label: 'Longest kill', unit: ' m', better: 'high' },
  { key: 'double', label: 'Fastest double kill', unit: ' s', better: 'low' },
];
let state = null;
function st() {
  if (state) return state;
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
  if (!state || typeof state !== 'object') state = {};
  state.mine ||= {}; state.friends = Array.isArray(state.friends) ? state.friends : []; state.name ||= 'You';
  return state;
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* kept for this visit */ } };
const better = (b, v, old) => old === undefined || (b.better === 'low' ? v < old : v > old);

export function bests() { return st().mine; }
export function myName() { return st().name; }
export function setName(n) { st().name = String(n || '').trim().slice(0, 16) || 'You'; save(); }
export function friends() { return st().friends; }
// New results { key: value }; returns the labels of the records just beaten.
export function submit(vals) {
  const s = st(), beaten = [];
  for (const b of BOARD) {
    const v = vals[b.key];
    if (!(Number.isFinite(v) && v > 0)) continue;
    const r = b.key === 'double' || b.key === 'longest' ? Math.round(v * 100) / 100 : Math.round(v);
    if (better(b, r, s.mine[b.key])) { if (s.mine[b.key] !== undefined) beaten.push(b.label); s.mine[b.key] = r; }
  }
  save();
  return beaten;
}
function sum(str) { let h = 7; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) % 1000003; return h.toString(36); }
export function myCode() {
  const body = btoa(unescape(encodeURIComponent(JSON.stringify({ n: myName(), b: bests() })))).replace(/=+$/, '');
  return PREFIX + body + '.' + sum(body);
}
// Add (or update) a friend from their code. Returns their name, or throws with a message.
export function addFriend(code) {
  const s = String(code || '').trim();
  if (!s.startsWith(PREFIX)) throw new Error('That is not a score code (they start with ' + PREFIX + ').');
  const [body, check] = s.slice(PREFIX.length).split('.');
  if (!body || sum(body) !== check) throw new Error('The score code is damaged. Copy all of it.');
  let d;
  try { d = JSON.parse(decodeURIComponent(escape(atob(body)))); } catch { throw new Error('The score code is damaged.'); }
  const name = String(d.n || 'Friend').slice(0, 16), b = {};
  for (const x of BOARD) if (Number.isFinite(d.b?.[x.key]) && d.b[x.key] > 0) b[x.key] = d.b[x.key];
  const st0 = st();
  st0.friends = st0.friends.filter((f) => f.name !== name).concat({ name, b }).slice(-20);
  save();
  return name;
}
export function removeFriend(name) { st().friends = st().friends.filter((f) => f.name !== name); save(); }
// One board: [{ name, value, me }] best first.
export function ranking(key) {
  const b = BOARD.find((x) => x.key === key), rows = [];
  if (bests()[key] !== undefined) rows.push({ name: myName(), value: bests()[key], me: true });
  for (const f of friends()) if (f.b[key] !== undefined) rows.push({ name: f.name, value: f.b[key], me: false });
  return rows.sort((p, q) => (b.better === 'low' ? p.value - q.value : q.value - p.value));
}
