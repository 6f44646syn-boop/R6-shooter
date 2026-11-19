// Battle Royale maps: Blacktide Island (royale-island.js) and the Ruined City (royale-city.js).
// The setting battle.royaleMap picks one ('random': either).
import { island } from './royale-island.js?v=8bb16fc-mwnzky3l';
import { ruins } from './royale-city.js?v=8bb16fc-mwnzky3l';
import { mistMap } from './mist.js?v=8bb16fc-mwnzky3l';

export const ROYALE_BOTS = 20;

// drop points round an oval, shared by both maps
const spawns = Array.from({ length: ROYALE_BOTS + 1 }, (_, i) => {
  const a = (i + .5) * 2 * Math.PI / (ROYALE_BOTS + 1);
  return [63 * Math.cos(a), 49 * Math.sin(a)];
});

export const ROYALE_MAPS = { blacktide: island(spawns), ruins: ruins(spawns), mistwood: null };
// The Mist for Battle Royale: a new 160 x 128 m maze from a seed (drop points round the oval, chests in it).
export function freshMistRoyale(seed) {
  const m = mistMap(seed, 'royale');
  return (ROYALE_MAPS.mistwood = { ...m, spawns, chests: [...spawns.map(([x, z]) => [x * 0.85, z * 0.85]), ...m.chests] });
}
freshMistRoyale(1);
export const isRoyaleMap = (id) => Object.hasOwn(ROYALE_MAPS, id);
