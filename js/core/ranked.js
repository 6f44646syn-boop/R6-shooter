export const START_RATING = 1000;
export const HISTORY_LIMIT = 20;

export function ratingOf(value) {
  return Number.isInteger(value) ? Math.max(0, Math.min(3000, value)) : START_RATING;
}

export const CHAMPION = 1700;   // Champion: above Diamond, shown with the player's world number (Champion #3)
export function rankOf(rating) {
  if (rating >= CHAMPION) return 'Champion';
  if (rating >= 1500) return 'Diamond';
  if (rating >= 1350) return 'Platinum';
  if (rating >= 1200) return 'Gold';
  if (rating >= 1050) return 'Silver';
  if (rating >= 900) return 'Bronze';
  return 'Copper';
}

// Divisions, as in Siege: each rank from Copper to Diamond has 5 (5 lowest ... 1 highest), 30 rating
// points each (Copper's start 150 below Bronze: under 780 is Copper 5). Champion has none (its world number).
const RANK_FLOOR = { Copper: 750, Bronze: 900, Silver: 1050, Gold: 1200, Platinum: 1350, Diamond: 1500 };
export function rankDivision(rating) {
  const r = rankOf(rating);
  if (r === 'Champion') return 0;
  return 5 - Math.max(0, Math.min(4, Math.floor((rating - RANK_FLOOR[r]) / 30)));
}
export const rankTitle = (rating) => rankOf(rating) + (rankDivision(rating) ? ' ' + rankDivision(rating) : '');   // "Bronze 3"

// Elo with K 32. A win is worth more the longer the match lasted (x1 to x2, reached at 5 minutes),
// and the number of enemy bots scales it: x(0.5 + bots / 6) for a win (1 bot x0.67, 3 x1, 6 x1.5), and a
// loss divided by that (fewer bots: losing costs more). Online against players: time only (as 3 bots).
export const MAX_DELTA = 127;          // (what a save code holds; the most possible is 32 x 2 x 1.5 = 96)
export function eloDelta(rating, opponent, score, { seconds = 0, bots = 3 } = {}) {
  const expected = 1 / (1 + 10 ** ((opponent - rating) / 400)), d = 32 * (score - expected);
  const time = 1 + Math.min(300, Math.max(0, +seconds || 0)) / 300, many = 0.5 + Math.min(6, Math.max(1, bots | 0)) / 6;
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(d > 0 ? d * time * many : d / many)));
}

// Ranked against bots: the bots' rating by difficulty; leaving early counts as a loss.
export const BOT_RATING = { easy: 850, normal: 1050, hard: 1250, terminator: 1500 };
// seconds: how long the match lasted; bots: how many enemy bots you faced.
export function botRankedChange(rating, difficulty, outcome, seconds = 0, bots = 3) {
  const delta = eloDelta(ratingOf(rating), BOT_RATING[difficulty] ?? BOT_RATING.normal, outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0, { seconds, bots });
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

export function rankedChange(ticket, result, actorId) {
  if (!result || result.id !== ticket.id || result.rounds < 2 || result.early) return null;
  const seat = ticket.roster.find(([id]) => id === actorId);
  if (!seat) return null;
  const [, team, rating] = seat;
  const opposition = ticket.roster.filter(([, side]) => side !== team).map(([, , value]) => value);
  if (!opposition.length) return null;
  const outcome = result.left.includes(actorId) ? 'loss'
    : result.winner === 'draw' ? 'draw' : result.winner === team ? 'win' : 'loss';
  const score = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
  return { id: result.id, outcome, delta: eloDelta(rating, rankedSummary(opposition).average, score, { seconds: result.seconds || 0 }) };
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
    privateKey, left: new Set(), early: false, rounds: 0, finished: false, started: Date.now(),
  };
}

export async function signRankedResult(session, winner) {
  const result = {
    id: session.ticket.id, winner, rounds: session.rounds,
    early: session.early, left: [...session.left].sort((a, b) => a - b),
    seconds: Math.min(300, Math.round((Date.now() - session.started) / 1000)),   // (how long it lasted: longer wins are worth more)
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
