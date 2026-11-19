// Battle Royale maps: Blacktide Island (royale-island.js) and the Ruined City (royale-city.js).
// The setting battle.royaleMap picks one ('random': either).
import { island } from './royale-island.js?v=2707cda-mwneqmgv';
import { ruins } from './royale-city.js?v=2707cda-mwneqmgv';

export const ROYALE_BOTS = 20;

// drop points round an oval, shared by both maps
const spawns = Array.from({ length: ROYALE_BOTS + 1 }, (_, i) => {
  const a = (i + .5) * 2 * Math.PI / (ROYALE_BOTS + 1);
  return [63 * Math.cos(a), 49 * Math.sin(a)];
});

export const ROYALE_MAPS = { blacktide: island(spawns), ruins: ruins(spawns) };
export const isRoyaleMap = (id) => Object.hasOwn(ROYALE_MAPS, id);
