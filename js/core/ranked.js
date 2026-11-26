export const START_RATING = 1000;
export const HISTORY_LIMIT = 20;

export function ratingOf(value) {
  return Number.isInteger(value) ? Math.max(0, Math.min(3000, value)) : START_RATING;
}

export const CHAMPION = 1800;   // Champion: above Diamond, shown with the player's world number (Champion #3)
export function rankOf(rating) {
  if (rating >= CHAMPION) return 'Champion';
  if (rating >= 1650) return 'Diamond';
  if (rating >= 1500) return 'Emerald';           // (between Platinum and Diamond, as in Siege)
  if (rating >= 1350) return 'Platinum';
  if (rating >= 1200) return 'Gold';
  if (rating >= 1050) return 'Silver';
  if (rating >= 900) return 'Bronze';
  return 'Copper';
}

// Divisions, as in Siege: each rank from Copper to Diamond (Emerald too) has 5 (5 lowest ... 1 highest), 30 rating
// points each (Copper's start 150 below Bronze: under 780 is Copper 5). Champion has none (its world number).
const RANK_FLOOR = { Copper: 750, Bronze: 900, Silver: 1050, Gold: 1200, Platinum: 1350, Emerald: 1500, Diamond: 1650 };
export function rankDivision(rating) {
  const r = rankOf(rating);
  if (r === 'Champion') return 0;
  return 5 - Math.max(0, Math.min(4, Math.floor((rating - RANK_FLOOR[r]) / 30)));
}
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export const rankTitle = (rating) => rankOf(rating) + (rankDivision(rating) ? ' ' + ROMAN[rankDivision(rating)] : '');   // "Bronze III"

// Elo with K 32, then two factors (both ways, so rating does not drift up over time):
// - performance (0 to 1, 0.5 an average game; see performance()): a win x(0.5 + perf), a loss x(1.5 - perf),
//   so a great game wins up to x1.5 and loses x0.5, a poor one the other way round;
// - enemy bots: 0.5 + bots / 6 (1 bot x0.67, 3 x1, 6 x1.5), a win times it, a loss divided by it.
// Online against players: bots count as 3.
export const MAX_DELTA = 127;          // (what a save code holds; the most possible is 32 x 1.5 x 1.5 = 72)
export function eloDelta(rating, opponent, score, { perf = 0.5, bots = 3 } = {}) {
  const expected = 1 / (1 + 10 ** ((opponent - rating) / 400)), d = 32 * (score - expected);
  const p = Math.min(1, Math.max(0, Number.isFinite(perf) ? perf : 0.5)), many = 0.5 + Math.min(6, Math.max(1, bots | 0)) / 6;
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(d > 0 ? d * (0.5 + p) * many : d * (1.5 - p) / many)));
}
// How well you played, 0 to 1 (0.5 an average game): the mean of K/D (1 = 0.5, 3 = 0.75), your best
// kill streak (3 = 0.5), how long you stayed alive before dying on average (60 s = 0.5) and, in round
// games (Bomb), the share of rounds your team won.
export function performance({ kills = 0, deaths = 0, streak = 0, alive = 0, roundsWon = 0, rounds = 0 } = {}) {
  const kd = Math.max(0, kills) / Math.max(1, deaths), s = Math.max(0, streak), a = Math.max(0, alive);
  const parts = [kd / (kd + 1), s / (s + 3), a / (a + 60)];
  if (rounds > 0) parts.push(Math.min(1, Math.max(0, roundsWon) / rounds));
  return parts.reduce((x, y) => x + y, 0) / parts.length;
}

// Ranked against bots: the bots' rating by difficulty; leaving early counts as a loss.
export const BOT_RATING = { easy: 850, normal: 1050, hard: 1250, terminator: 1500 };
// perf: how well you played (performance()); bots: how many enemy bots you faced.
export function botRankedChange(rating, difficulty, outcome, perf = 0.5, bots = 3) {
  const delta = eloDelta(ratingOf(rating), BOT_RATING[difficulty] ?? BOT_RATING.normal, outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0, { perf, bots });
  return { id: crypto.randomUUID().replaceAll('-', ''), outcome, delta };
}

export function rankedSummary(ratings) {
  const values = ratings.map(ratingOf);
  return {
    average: Math.round(values.reduce((sum, rating) => sum + rating, 0) / values.length),
    low: Math.min(...values),
    high: Math.max(...values),
  };
}

export function rankedChange(ticket, result, actorId, perf = 0.5) {   // perf: how well this player played
  if (!result || result.id !== ticket.id || result.rounds < 2 || result.early) return null;
  const seat = ticket.roster.find(([id]) => id === actorId);
  if (!seat) return null;
  const [, team, rating] = seat;
  const opposition = ticket.roster.filter(([, side]) => side !== team).map(([, , value]) => value);
  if (!opposition.length) return null;
  const outcome = result.left.includes(actorId) ? 'loss'
    : result.winner === 'draw' ? 'draw' : result.winner === team ? 'win' : 'loss';
  const score = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
  return { id: result.id, outcome, delta: eloDelta(rating, rankedSummary(opposition).average, score, { perf }) };
}

const keyOptions = { name: 'ECDSA', namedCurve: 'P-256' };
const signatureOptions = { name: 'ECDSA', hash: 'SHA-256' };
const bytes = value => new TextEncoder().encode(JSON.stringify(value));

export async function createRankedSession(roster) {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(keyOptions, true, ['sign', 'verify']);
  return {
    ticket: {
      id: crypto.randomUUID().replaceAll('-', ''),
      publicKey: await crypto.subtle.exportKey('jwk', publicKey),
      roster,
    },
    privateKey, left: new Set(), early: false, rounds: 0, finished: false,
  };
}

export async function signRankedResult(session, winner) {
  const result = {
    id: session.ticket.id, winner, rounds: session.rounds,
    early: session.early, left: [...session.left].sort((a, b) => a - b),
  };
  const signature = await crypto.subtle.sign(signatureOptions, session.privateKey, bytes(result));
  return { k: 'mrankResult', result, signature: btoa(String.fromCharCode(...new Uint8Array(signature))) };
}

export function validRankedTicket(ticket) {
  return !!ticket && /^[0-9a-f]{32}$/.test(ticket.id) && !!ticket.publicKey && Array.isArray(ticket.roster)
    && ticket.roster.length >= 2 && ticket.roster.length <= 10
    && new Set(ticket.roster.map(row => row?.[0])).size === ticket.roster.length
    && ticket.roster.every(row => Array.isArray(row) && row.length === 3 && Number.isInteger(row[0])
      && ['A', 'B'].includes(row[1]) && Number.isInteger(row[2]) && row[2] >= 0 && row[2] <= 3000);
}

export async function verifyRankedResult(ticket, packet) {
  if (!validRankedTicket(ticket)) return null;
  const result = packet?.result;
  if (!result || result.id !== ticket.id || !['A', 'B', 'draw'].includes(result.winner)
    || !Number.isInteger(result.rounds) || result.rounds < 0 || result.rounds > 7
    || typeof result.early !== 'boolean' || !Array.isArray(result.left) || result.left.length > ticket.roster.length
    || (result.seconds !== undefined && !(Number.isInteger(result.seconds) && result.seconds >= 0 && result.seconds <= 300))
    || !result.left.every(id => ticket.roster.some(([actorId]) => actorId === id))
    || typeof packet.signature !== 'string' || packet.signature.length !== 88) return null;
  try {
    const key = await crypto.subtle.importKey('jwk', ticket.publicKey, keyOptions, false, ['verify']);
    const signature = Uint8Array.from(atob(packet.signature), ch => ch.charCodeAt(0));
    return await crypto.subtle.verify(signatureOptions, key, signature, bytes(result)) ? result : null;
  } catch { return null; }
}
