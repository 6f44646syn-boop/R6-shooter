// The free season pass (6 weeks, 30 tiers) and the daily login streak. XP comes from matches,
// range hits and challenges; each tier pays out once: points, a charm at 5 / 15 / 25, the
// season's skin at 30. Kept in this browser.
import { CATALOGUE, LEGEND_ID } from './skins.js?v=d05ab44-mwg7imxt';
import { CHARMS } from './charms.js?v=d05ab44-mwg7imxt';

export const TIERS = 30, XP_PER_TIER = 1000, SEASON_DAYS = 42;
const KEY = 'recoilRange.season.v1', DAY = 86400000;
export const XP = { match: 20, kill: 15, win: 60, hit: 1, daily: 150, weekly: 400 };

export function seasonOf(now = Date.now()) {
  const day = Math.floor(now / DAY), id = Math.floor(day / SEASON_DAYS);
  return { id, number: id - 493, ends: (id + 1) * SEASON_DAYS * DAY };      // (season 1 started in 2026)
}
// What tier n (1..30) of a season pays.
export function rewardOf(n, seasonId) {
  if (n === TIERS) {
    const pool = CATALOGUE.filter((s) => s.rarity === 'legendary' && s.id !== LEGEND_ID && !s.photo);
    return { skin: pool[seasonId % pool.length].id };
  }
  if (n % 10 === 5) return { charm: CHARMS[(seasonId * 3 + (n - 5) / 10) % CHARMS.length].id };
  return { points: 40 + 5 * n };
}
export function rewardText(r) {
  return r.skin !== undefined ? 'Season skin: ' + CATALOGUE[r.skin].name : r.charm !== undefined ? 'Charm: ' + CHARMS[r.charm].name : r.points + ' points';
}

function load(now) {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* blocked or broken */ }
  if (!s || typeof s !== 'object') s = {};
  const id = seasonOf(now).id;
  if (s.season !== id) { s.season = id; s.xp = 0; s.paid = 0; }          // a new season starts from tier 0
  s.xp = Math.max(0, s.xp | 0); s.paid = Math.max(0, Math.min(TIERS, s.paid | 0));
  s.streak = Math.max(0, s.streak | 0); s.lastDay = s.lastDay ?? -1;
  return s;
}
let state = null;
const st = (now) => { if (!state || state.season !== seasonOf(now).id) state = load(now); return state; };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* kept for this visit */ } };

export function seasonState(now = Date.now()) {
  const s = st(now), tier = Math.min(TIERS, Math.floor(s.xp / XP_PER_TIER));
  return { ...seasonOf(now), xp: s.xp, tier, into: tier >= TIERS ? XP_PER_TIER : s.xp % XP_PER_TIER, streak: s.streak };
}
// Add XP; pays the tiers it completes into profile. Returns [{ tier, reward }] just reached.
export function addXp(n, profile, now = Date.now()) {
  const s = st(now);
  s.xp += Math.max(0, Math.round(n));
  const reached = Math.min(TIERS, Math.floor(s.xp / XP_PER_TIER)), out = [];
  while (s.paid < reached) {
    const tier = ++s.paid, r = rewardOf(tier, s.season);
    profile.grant(r);
    out.push({ tier, reward: r });
  }
  save();
  return out;
}
// XP for a finished match (history summary).
export const matchXp = (m) => XP.match + XP.kill * (m.kills | 0) + (m.result === 'win' ? XP.win : 0);

// Once a day: the streak grows (or restarts after a missed day) and pays 25 points per day of
// streak, up to 150. Returns { streak, bonus } the first time each day, else null.
export function checkIn(profile, now = Date.now()) {
  const s = st(now), day = Math.floor(now / DAY);
  if (s.lastDay === day) return null;
  s.streak = s.lastDay === day - 1 ? s.streak + 1 : 1;
  s.lastDay = day;
  const bonus = Math.min(150, 25 * s.streak);
  profile.addPoints(bonus);
  save();
  return { streak: s.streak, bonus };
}
