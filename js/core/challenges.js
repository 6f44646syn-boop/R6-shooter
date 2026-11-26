// Daily and weekly challenges, one of each for every mode. The same for everyone on a given
// day / week (picked from the date), progress kept in this browser, points paid out once.
// Skin challenges: long ones that never reset, each paying one skin (core/skins.js, the Challenge skins).
import { mulberry32 } from './prng.js?v=7141ab8-mwx5zl37';
import { CATALOGUE } from './skins.js?v=7141ab8-mwx5zl37';

export const DAILY_POINTS = 60, WEEKLY_POINTS = 250;
const MODES = { range: 'Shooting range', battle: 'Battle vs bots', endless: 'Endless', royale: 'Battle Royale', tdm: 'Team Deathmatch', ctf: 'Capture the Flag', bomb: 'Bomb' };
// [stat, daily goal, weekly goal, text]: stat is summed over matches ('best': the best single run).
const POOL = {
  range: [['heads', 15, 120, 'headshots on the range dummy'], ['hits', 120, 900, 'hits on range targets']],
  battle: [['kills', 15, 100, 'kills'], ['wins', 1, 6, 'wins'], ['matches', 2, 10, 'matches finished']],
  endless: [['best', 8, 20, 'kills in one run'], ['kills', 15, 90, 'kills in total']],
  royale: [['kills', 3, 25, 'eliminations'], ['top5', 1, 5, 'top-5 finishes'], ['matches', 1, 6, 'matches finished']],
  tdm: [['kills', 12, 80, 'kills'], ['wins', 1, 5, 'wins'], ['matches', 2, 8, 'matches finished']],
  ctf: [['kills', 10, 70, 'kills'], ['wins', 1, 5, 'wins'], ['matches', 1, 6, 'matches finished']],
  bomb: [['kills', 8, 60, 'kills'], ['wins', 1, 4, 'wins'], ['matches', 1, 5, 'matches finished']],
};
// a goal of 1 reads in the singular ('Get 1 win', not 'Get 1 wins')
const ONE = { wins: 'win', 'matches finished': 'match finished', 'top-5 finishes': 'top-5 finish', eliminations: 'elimination', kills: 'kill' };
const KEY = 'recoilRange.challenges.v1';
const DAY = 86400000;
export const dayOf = (now) => Math.floor(now / DAY);
export const weekOf = (now) => Math.floor((now / DAY + 3) / 7);        // weeks start on Monday

// The challenges for a date: [{ id, mode, modeName, period, stat, goal, text, points }].
export function challengesFor(now = Date.now()) {
  const out = [], d = dayOf(now), w = weekOf(now);
  for (const [mode, pool] of Object.entries(POOL)) {
    for (const [period, n, pts] of [['daily', d, DAILY_POINTS], ['weekly', w, WEEKLY_POINTS]]) {
      const rng = mulberry32((n * 7919 + mode.length * 104729 + (period === 'weekly' ? 1 : 0)) >>> 0);
      const [stat, dg, wg, text] = pool[Math.floor(rng() * pool.length)];
      const goal = period === 'daily' ? dg : wg;
      out.push({ id: period[0] + n + ':' + mode, mode, modeName: MODES[mode], period, stat, goal, points: pts,
        text: (stat === 'best' ? 'Reach ' + goal + ' ' : stat === 'wins' || stat === 'top5' ? 'Get ' + goal + ' ' : goal + ' ') + (goal === 1 ? ONE[text] || text : text) });
    }
  }
  return out;
}

// The skin challenges: [{ id, mode, modeName, period: 'skin', stat, goal, text, skin, skinName }].
export const SKIN_CHALLENGES = CATALOGUE.filter((s) => s.trial).map((s) => ({
  id: 's' + s.id, ...s.trial, modeName: MODES[s.trial.mode], period: 'skin', text: s.unlock, skin: s.id, skinName: s.name,
}));

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === 'object') return { progress: s.progress || {}, paid: s.paid || {}, skins: s.skins || {} }; } catch { /* blocked or broken */ }
  return { progress: {}, paid: {}, skins: {} };
}
let state = null;
const st = () => (state ||= load());
function save(now) {
  const live = new Set(challengesFor(now).map((c) => c.id)), s = st();
  for (const k of Object.keys(s.progress)) if (!live.has(k)) delete s.progress[k];
  for (const k of Object.keys(s.paid)) if (!live.has(k)) delete s.paid[k];
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* kept for this visit */ }
}
// (skin challenges keep their progress and paid flag in s.skins: { id: [progress, paid] }, never pruned)
const slot = (c) => (c.period === 'skin' ? (st().skins[c.id] ||= [0, 0]) : null);
export function progressOf(c) { return Math.min(c.goal, c.period === 'skin' ? slot(c)[0] : st().progress[c.id] || 0); }
export function isPaid(c) { return c.period === 'skin' ? !!slot(c)[1] : !!st().paid[c.id]; }

// Record what happened: mode and stats { kills, wins, matches, heads, hits, best, top5 }.
// Returns the challenges finished just now: daily and weekly ones pay points, skin ones their skin (c.skin),
// both for the caller to pay.
export function record(mode, stats, now = Date.now()) {
  const s = st(), done = [];
  const add = (old, c) => { const v = stats[c.stat] || 0; return c.stat === 'best' ? Math.max(old, v) : old + v; };
  for (const c of challengesFor(now)) {
    if (c.mode !== mode || !(c.stat in stats) || s.paid[c.id]) continue;
    s.progress[c.id] = add(s.progress[c.id] || 0, c);
    if (s.progress[c.id] >= c.goal) { s.paid[c.id] = true; done.push(c); }
  }
  for (const c of SKIN_CHALLENGES) {
    const k = slot(c);
    if (c.mode !== mode || !(c.stat in stats) || k[1]) continue;
    k[0] = add(k[0], c);
    if (k[0] >= c.goal) { k[1] = 1; done.push(c); }
  }
  save(now);
  return done;
}
// A finished match (history summary) as challenge stats.
export function matchStats(m) {
  const stats = { kills: m.kills | 0, matches: 1, wins: m.result === 'win' ? 1 : 0 };
  if (m.mode === 'endless') stats.best = m.kills | 0;
  if (m.mode === 'royale') stats.top5 = m.result === 'win' || (m.place > 0 && m.place <= 5) ? 1 : 0;
  return stats;
}
