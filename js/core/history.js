// Your finished matches, kept in this browser (the last 50): mode, result, kills, deaths, gun, when.
const KEY = 'recoilRange.history.v1', MAX = 50;
let list = null;
function load() {
  if (list) return list;
  try { list = JSON.parse(localStorage.getItem(KEY)) || []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  return list;
}
export function addMatch(m) {
  const played = gamesPlayed(), L = load();
  L.unshift({ mode: String(m.mode), result: m.result, kills: m.kills | 0, deaths: m.deaths | 0, gun: m.gun || '', place: m.place | 0, at: Date.now() });
  L.length = Math.min(L.length, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(L)); } catch { /* storage full or blocked: kept for this visit */ }
  try { localStorage.setItem(GAMES, String(played + 1)); } catch { /* kept in the history */ }
}
export function matches() { return load(); }
// Every match you have finished (all time; the history keeps only the last 50). Starts from the history's length.
const GAMES = 'recoilRange.games.v1';
export function gamesPlayed() { let n = 0; try { n = parseInt(localStorage.getItem(GAMES), 10) || 0; } catch { /* blocked */ } return Math.max(n, load().length); }
// Totals over the kept matches.
export function totals() {
  const L = load(), t = { matches: L.length, wins: 0, kills: 0, deaths: 0, guns: new Map() };
  for (const m of L) {
    if (m.result === 'win') t.wins++;
    t.kills += m.kills; t.deaths += m.deaths;
    if (m.gun) t.guns.set(m.gun, (t.guns.get(m.gun) || 0) + m.kills);
  }
  t.kd = t.deaths ? t.kills / t.deaths : t.kills;
  t.best = [...t.guns].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return t;
}
