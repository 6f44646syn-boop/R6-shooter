export const START_RATING = 1000;
export const HISTORY_LIMIT = 20;

export function ratingOf(value) {
  return Number.isInteger(value) ? Math.max(0, Math.min(3000, value)) : START_RATING;
}

export function rankOf(rating) {
  if (rating >= 1500) return 'Diamond';
  if (rating >= 1350) return 'Platinum';
  if (rating >= 1200) return 'Gold';
  if (rating >= 1050) return 'Silver';
  if (rating >= 900) return 'Bronze';
  return 'Copper';
}

export function eloDelta(rating, opponent, score) {
  const expected = 1 / (1 + 10 ** ((opponent - rating) / 400));
  return Math.round(32 * (score - expected));
}

// Ranked against bots: the bots' rating by difficulty; leaving early counts as a loss.
export const BOT_RATING = { easy: 850, normal: 1050, hard: 1250, terminator: 1500 };
export function botRankedChange(rating, difficulty, outcome) {
  const delta = eloDelta(ratingOf(rating), BOT_RATING[difficulty] ?? BOT_RATING.normal, outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0);
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
  return { id: result.id, outcome, delta: eloDelta(rating, rankedSummary(opposition).average, score) };
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
    || !result.left.every(id => ticket.roster.some(([actorId]) => actorId === id))
    || typeof packet.signature !== 'string' || packet.signature.length !== 88) return null;
  try {
    const key = await crypto.subtle.importKey('jwk', ticket.publicKey, keyOptions, false, ['verify']);
    const signature = Uint8Array.from(atob(packet.signature), ch => ch.charCodeAt(0));
    return await crypto.subtle.verify(signatureOptions, key, signature, bytes(result)) ? result : null;
  } catch { return null; }
}
