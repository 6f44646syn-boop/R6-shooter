import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Profile } from '../js/core/profile.js';
import { createRankedSession, eloDelta, rankedChange, rankOf, signRankedResult, verifyRankedResult } from '../js/core/ranked.js';
import { spectatorVisibility } from '../js/replay/spectator.js';
import worker, { Room } from '../relay/src/index.js';

assert.equal(eloDelta(1000, 1000, 1), 16);
assert.equal(eloDelta(1000, 1000, 0), -16);
assert.equal(eloDelta(1400, 1000, 1), 3);
assert.equal(eloDelta(1400, 1000, 0), -29);
assert.equal(rankOf(1500), 'Diamond');

const host = await createRankedSession([[1, 'A', 1000], [2, 'B', 1000]]);
host.rounds = 2;
host.left.add(1);
const packet = await signRankedResult(host, 'A');
const result = await verifyRankedResult(host.ticket, packet);
assert.ok(result);
assert.equal(rankedChange(host.ticket, result, 1).outcome, 'loss');
assert.equal(rankedChange(host.ticket, { ...result, rounds: 1 }, 1), null);
assert.equal(rankedChange(host.ticket, { ...result, early: true }, 1), null);
assert.equal(await verifyRankedResult(host.ticket, { ...packet, result: { ...result, winner: 'B' } }), null);

const storage = { getItem: () => null, setItem() {} };
const profile = new Profile(storage);
assert.equal(profile.applyRanked(rankedChange(host.ticket, result, 1)).delta, -16);
assert.equal(profile.applyRanked(rankedChange(host.ticket, result, 1)), null);
for (let i = 1; i <= 22; i++) profile.applyRanked({ id: i.toString(16).padStart(32, '0'), outcome: 'win', delta: 10 });
const imported = new Profile(storage);
imported.loadCode(profile.saveCode());
assert.equal(imported.rating, profile.rating);
assert.deepEqual(imported.rankedHistory, profile.rankedHistory);
assert.equal(imported.rankedHistory.length, 20);
imported.loadCode('RRS1-AR4AAAAAAAAACAAAAQAQiAJAAAAAgAIAAAAAAEAA____I________wEAAAAKACa0');
assert.equal(imported.rating, 1000);
assert.equal(imported.points, 30);
assert.deepEqual(imported.rankedHistory, []);

const actors = [
  {id:1, team:'A', alive:true, x:0, y:0, z:0, yaw:0},
  {id:2, team:'B', alive:true, x:0, y:0, z:-5},
  {id:3, team:'B', alive:true, x:0, y:0, z:5},
  {id:4, team:'B', alive:true, x:0, y:0, z:-8},
];
assert.deepEqual([...spectatorVisibility(actors, 'A', {sight: (_, point) => point[2] !== -8})], [1, 2]);

const rooms = new Map();
const env = { ROOMS: { idFromName: name => name, get: name => {
  if (!rooms.has(name)) {
    const db = new DatabaseSync(':memory:');
    const sql = { exec(query, ...args) {
      const statement = db.prepare(query);
      if (query.startsWith('SELECT')) return { toArray: () => statement.all(...args) };
      statement.run(...args);
    }};
    const room = new Room({ storage: {sql} }, env);
    rooms.set(name, { room, fetch: (input, init) => room.fetch(new Request(input, init)), sql });
  }
  return rooms.get(name);
} } };
const dir = env.ROOMS.get('ranked-1');
const listing = {average:1000, low:900, high:1100, players:2, capacity:6, map:'ranch'};
const write = (lease, data) => dir.fetch('https://relay.internal/directory', {method:'PUT', body:JSON.stringify({code:'ABCD',lease,listing:data})});
assert.equal((await write('old', listing)).status, 204);
assert.equal((await write('new', listing)).status, 204);
assert.equal((await write('old', null)).status, 204);
const read = async () => (await worker.fetch(new Request('https://relay.test/ranked'), env)).json();
assert.deepEqual(await read(), [{code:'ABCD',...listing}]);
assert.equal((await write('new', {...listing, average:1200})).status, 400);
assert.equal((await worker.fetch(new Request('https://relay.test/directory',{method:'PUT'}), env)).status, 404);
dir.sql.exec('UPDATE ranked SET expires = 0');
assert.deepEqual(await read(), []);
const relayRoom = env.ROOMS.get('ABCD').room;
const receiptUrl = 'https://relay.test/ranked-result/ABCD/' + host.ticket.id;
const receipt = () => worker.fetch(new Request(receiptUrl), env);
const ws = { deserializeAttachment: () => ({role:'host', code:'ABCD', lease:'new'}) };
assert.equal((await receipt()).status, 404);
await relayRoom.webSocketMessage(ws, JSON.stringify({rankReceipt:packet}));
assert.deepEqual(await verifyRankedResult(host.ticket, await (await receipt()).json()), result);
assert.equal((await worker.fetch(new Request(receiptUrl, {method:'PUT'}), env)).status, 404);
dir.sql.exec('UPDATE ranked_receipts SET expires = 0');
assert.equal((await receipt()).status, 404);
console.log('Ranked Elo, signed results, profile history, spectator visibility, relay directory, and receipt checks passed');
