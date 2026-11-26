// Recoil Range relay (Cloudflare Worker + Durable Object).
//
// Each game is a room named by a short code. The host connects with ?role=host, players
// with ?role=player. Players' messages go to the host; the host's messages go to one player
// or to all. Ranked lobby listings expire after 45 seconds and signed receipts after a day.
//
//   GET  /                      -> "Recoil Range relay: OK" (for the in-game connection test)
//   GET  /ranked               -> open ranked Bomb lobbies
//   GET  /ranked-result/CODE/ID -> signed match receipt, if available
//   GET  /world?by=STAT&id=ID   -> a world board (rating, kills, skins, points or games): the top 50, and where ID stands
//   POST /account {op:'login', name, pin, code?} (text/plain JSON) -> claim a name (with your save code)
//                 or log in to it: { token, code, created }; 403 for a wrong PIN (5 wrong: locked 15 min)
//   POST /account {op:'create', name, pin, code} -> a new account only (409 if the name is taken)
//   POST /account {op:'save', name, token, code} -> keep your progress online ({ at })
//   POST /account {op:'pull', name, token} -> your latest progress { code, at, secs } (another PC may have saved since)
//   POST /account {op:'rename', name, token, newName} -> a new name, if nobody has it (409 if taken)
//   POST /world?by=STAT  {id,name,rating,kills,skins,points,games} (text/plain JSON) -> record a player, then as GET
//   WS   /room/CODE?role=host   -> host of game CODE (refused if the room already has a host)
//   WS   /room/CODE?role=player -> player in game CODE (refused if there is no host, or full)
//
// Wire format (JSON text frames):
//   relay -> anyone : { t: 'hello', id }            your id (host is 0)
//   relay -> host   : { t: 'join', id } / { t: 'leave', id } / { from: id, d }
//   relay -> player : { d } / { t: 'end' } (the host left)
//   host  -> relay  : { to: id | -1 (everyone), d } or a bundle { b: [{ to, d }, ...] }
//                     or { kick: id } (disconnect that player)
//   player-> relay  : { d }

const MAX_PLAYERS = 8;          // host + 7
const MAX_MSG = 64000;          // characters per frame
const MAX_PER_SEC = 120;        // frames per second per connection (game sends ~20)
const CODE = /^[A-Z0-9]{4,8}$/;

const RANK_SHARDS = 4;
const RANK_TTL = 45_000;
const RECEIPT_TTL = 86_400_000;
const MATCH_ID = /^[0-9a-f]{32}$/;
const RESET = 1;   // one-time resets (see _resetOnce)
const DEFAULT_NAME = /^player\s*\d*$/i;   // "Player", "Player 1"...: the game's default name, never an account
const SAVE_CODE = /^RRS1-[A-Za-z0-9_-]{4,10000}$/, ACCOUNTS_MAX = 200_000;
// A PIN is kept as SHA-256 of the name and the PIN (never the PIN itself).
async function pinHash(key, pin) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('recoil-range-account\u0000' + key + '\u0000' + pin));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const WORLD_STATS = { rating: 3000, kills: 1e9, skins: 5000, points: 0xffffffff, games: 1e9, minutes: 1e8 };   // each board, and the highest value it takes
const rankedStub = (env, shard) => env.ROOMS.get(env.ROOMS.idFromName('ranked-' + shard));
const rankedShard = code => code.charCodeAt(0) % RANK_SHARDS;
const rankedHeaders = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const receipt = url.pathname.match(/^\/ranked-result\/([A-Z0-9]{4,8})\/([0-9a-f]{32})$/);
    if (receipt && req.method === 'GET') {
      const [, code, id] = receipt;
      const response = await rankedStub(env, rankedShard(code)).fetch('https://relay.internal/receipt?code=' + code + '&id=' + id);
      return new Response(response.body, { status: response.status, headers: { ...rankedHeaders,
        'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (url.pathname === '/ranked' && req.method === 'GET') {
      // one shard failing hides only its own games
      const shards = await Promise.allSettled(Array.from({ length: RANK_SHARDS }, async (_, index) => {
        const response = await rankedStub(env, index).fetch('https://relay.internal/directory');
        if (!response.ok) throw new Error('Ranked directory unavailable');
        return response.json();
      }));
      const games = shards.flatMap(s => s.status === 'fulfilled' ? s.value : []).sort((a, b) => b.players - a.players || a.code.localeCompare(b.code));
      return Response.json(games, { headers: rankedHeaders });
    }
    if (url.pathname === '/account' && req.method === 'POST') {
      const response = await env.ROOMS.get(env.ROOMS.idFromName('accounts')).fetch('https://relay.internal/account', { method: 'POST', body: await req.text() });
      return new Response(response.body, { status: response.status, headers: { ...rankedHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (url.pathname === '/world' && (req.method === 'GET' || req.method === 'POST')) {
      const response = await env.ROOMS.get(env.ROOMS.idFromName('accounts')).fetch('https://relay.internal/world' + url.search, { method: req.method, body: req.method === 'POST' ? await req.text() : undefined });
      return new Response(response.body, { status: response.status, headers: { ...rankedHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (url.pathname === '/' || url.pathname === '/health') return new Response('Recoil Range relay: OK', { headers: cors });
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})$/);
    if (!m || !CODE.test(m[1].toUpperCase())) return new Response('Not found', { status: 404, headers: cors });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426, headers: cors });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase()));
    return stub.fetch(req);
  },
};

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.rate = new Map();      // socket -> [windowStart, count]
  }

  _all() { return this.state.getWebSockets().map((ws) => ({ ws, a: ws.deserializeAttachment() || {} })); }
  _host() { return this._all().find((x) => x.a.role === 'host'); }
  _send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* closing */ } }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/directory') return this._directory(req);
    if (url.pathname === '/receipt') return this._receipt(req, url);
    if (url.pathname === '/world') return this._world(req, url);
    if (url.pathname === '/account') return this._account(req);
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'player';
    const all = this._all();
    const host = all.find((x) => x.a.role === 'host');
    // Refusals are sent as a WebSocket that closes with a reason, so the browser can show it.
    const refuse = (code, reason) => {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (role === 'host' && host) return refuse(4009, 'That code is already in use. Try hosting again.');
    if (role === 'player' && !host) return refuse(4004, 'No game with that code. Check the code with the host.');
    if (all.length >= MAX_PLAYERS) return refuse(4008, 'That game is full.');

    const [client, server] = Object.values(new WebSocketPair());
    const id = role === 'host' ? 0 : Math.max(0, ...all.map((x) => x.a.id || 0)) + 1;
    this.state.acceptWebSocket(server);
    const code = url.pathname.split('/').at(-1).toUpperCase();
    server.serializeAttachment({ role, id, code, lease: role === 'host' ? crypto.randomUUID() : null });
    this._send(server, { t: 'hello', id });
    if (role === 'player') this._send(host.ws, { t: 'join', id });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > MAX_MSG) return;
    const now = Date.now();
    const r = this.rate.get(ws) || [now, 0];
    if (now - r[0] > 1000) { r[0] = now; r[1] = 0; }
    if (++r[1] > MAX_PER_SEC) return;           // flooding: drop
    this.rate.set(ws, r);
    let m;
    try { m = JSON.parse(msg); } catch (e) { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    const me = ws.deserializeAttachment() || {};
    if (me.role === 'host') {
      if (m.rankReceipt && me.code && MATCH_ID.test(m.rankReceipt.result?.id || '')) {
        await rankedStub(this.env, rankedShard(me.code)).fetch(
          'https://relay.internal/receipt?code=' + me.code + '&id=' + m.rankReceipt.result.id,
          { method: 'PUT', body: JSON.stringify(m.rankReceipt) });
        return;
      }
      if (Object.hasOwn(m, 'ranked')) {
        if (m.ranked || me.rankedListed) await this._publish(me, m.ranked);
        ws.serializeAttachment({ ...me, rankedListed: !!m.ranked });
        return;
      }
      const players = this._all().filter((x) => x.a.role === 'player');
      if (m.kick != null) {
        const p = players.find((x) => x.a.id === m.kick);
        if (p) { try { p.ws.close(4001, 'The host removed you.'); } catch (e) { /* closed */ } }
        return;
      }
      const list = Array.isArray(m.b) ? m.b : [m];
      for (const one of list) {
        if (!one || typeof one !== 'object') continue;
        for (const { ws: s, a } of players) if (one.to === -1 || a.id === one.to) this._send(s, { d: one.d });
      }
    } else {
      const host = this._host();
      if (host) this._send(host.ws, { from: me.id, d: m.d });
    }
  }

  async _publish(host, listing) {
    if (!CODE.test(host.code || '') || !host.lease) return;
    await rankedStub(this.env, rankedShard(host.code)).fetch('https://relay.internal/directory', {
      method: 'PUT',
      body: JSON.stringify({ code: host.code, lease: host.lease, listing }),
    });
  }

  async _directory(req) {
    const sql = this.state.storage.sql, now = Date.now();
    sql.exec('CREATE TABLE IF NOT EXISTS ranked (code TEXT PRIMARY KEY, lease TEXT, expires INTEGER, data TEXT)');
    sql.exec('DELETE FROM ranked WHERE expires <= ?', now);
    if (req.method === 'GET') {
      return Response.json(sql.exec('SELECT code, data FROM ranked ORDER BY expires DESC LIMIT 64').toArray()
        .map(row => ({ code: row.code, ...JSON.parse(row.data) })));
    }
    if (req.method !== 'PUT') return new Response(null, { status: 405 });
    const { code, lease, listing } = await req.json();
    if (!CODE.test(code || '') || typeof lease !== 'string' || lease.length > 40) return new Response(null, { status: 400 });
    if (listing === null) {
      sql.exec('DELETE FROM ranked WHERE code = ? AND lease = ?', code, lease);
    } else {
      const { average, low, high, players, capacity, map } = listing || {};
      const ratings = [low, average, high];
      if (!ratings.every(value => Number.isInteger(value) && value >= 0 && value <= 3000)
        || low > average || average > high || !Number.isInteger(players) || !Number.isInteger(capacity)
        || capacity < 2 || capacity > 8 || players < 1 || players >= capacity || !['ranch', 'embassy', 'workshop'].includes(map)) {
        return new Response(null, { status: 400 });
      }
      const data = JSON.stringify({ average, low, high, players, capacity, map });
      sql.exec('INSERT OR REPLACE INTO ranked VALUES (?, ?, ?, ?)', code, lease, now + RANK_TTL, data);
      sql.exec('DELETE FROM ranked WHERE code IN (SELECT code FROM ranked ORDER BY expires DESC LIMIT -1 OFFSET 64)');
    }
    return new Response(null, { status: 204 });
  }

  async _receipt(req, url) {
    const code = url.searchParams.get('code'), id = url.searchParams.get('id');
    if (!CODE.test(code || '') || !MATCH_ID.test(id || '')) return new Response(null, { status: 400 });
    const sql = this.state.storage.sql, now = Date.now();
    sql.exec('CREATE TABLE IF NOT EXISTS ranked_receipts (code TEXT, id TEXT, expires INTEGER, data TEXT, PRIMARY KEY (code, id))');
    sql.exec('DELETE FROM ranked_receipts WHERE expires <= ?', now);
    if (req.method === 'GET') {
      const row = sql.exec('SELECT data FROM ranked_receipts WHERE code = ? AND id = ?', code, id).toArray()[0];
      return row ? new Response(row.data, { headers: { 'Content-Type': 'application/json' } }) : new Response(null, { status: 404 });
    }
    if (req.method !== 'PUT') return new Response(null, { status: 405 });
    const data = await req.text();
    if (data.length > 2048) return new Response(null, { status: 413 });
    const packet = JSON.parse(data);
    if (packet.k !== 'mrankResult' || packet.result?.id !== id || typeof packet.signature !== 'string' || packet.signature.length !== 88) {
      return new Response(null, { status: 400 });
    }
    sql.exec('INSERT OR IGNORE INTO ranked_receipts VALUES (?, ?, ?, ?)', code, id, now + RECEIPT_TTL, data);
    sql.exec('DELETE FROM ranked_receipts WHERE rowid IN (SELECT rowid FROM ranked_receipts ORDER BY expires DESC LIMIT -1 OFFSET 512)');
    return new Response(null, { status: 204 });
  }

  // The world boards: one row per player (a random id kept in their browser), one board per stat,
  // best first. The numbers come from the players' own browsers, so these are friendly boards, not proof.
  async _world(req, url) {
    const sql = this.state.storage.sql, now = Date.now();
    this._resetOnce(sql);
    sql.exec('CREATE TABLE IF NOT EXISTS board (key TEXT PRIMARY KEY, name TEXT, rating INTEGER, kills INTEGER, skins INTEGER, points INTEGER, games INTEGER, minutes INTEGER, at INTEGER)');
    const by = Object.hasOwn(WORLD_STATS, url.searchParams.get('by')) ? url.searchParams.get('by') : 'rating';
    let key = String(url.searchParams.get('name') || '').trim().toLowerCase();
    if (req.method === 'POST') {
      const text = await req.text();
      if (text.length > 512) return new Response(null, { status: 413 });
      let b; try { b = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
      if (b && b.minutes === undefined) b.minutes = 0;   // (older games do not send it)
      const ok = Object.entries(WORLD_STATS).every(([k, max]) => Number.isInteger(b[k]) && b[k] >= 0 && b[k] <= max);
      if (!ok || typeof b.name !== 'string' || typeof b.token !== 'string') return new Response(null, { status: 400 });
      // only signed-in accounts, under their own name (one row each)
      key = b.name.trim().toLowerCase();
      const acct = this._accountsTable(sql) && sql.exec('SELECT name, token FROM accounts WHERE key = ?', key).toArray()[0];
      if (!acct || !acct.token || acct.token !== b.token) return new Response(null, { status: 403 });
      sql.exec('INSERT OR REPLACE INTO board (key, name, rating, kills, skins, points, games, minutes, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', key, acct.name, b.rating, b.kills, b.skins, b.points, b.games, b.minutes, now);
    }
    sql.exec('DELETE FROM board WHERE key NOT IN (SELECT key FROM accounts)');   // (renamed or gone accounts)
    // (by is one of WORLD_STATS' own names, so it is safe in the query)
    const top = sql.exec('SELECT name, ' + by + ' AS v FROM board ORDER BY ' + by + ' DESC, at ASC LIMIT 50').toArray().map((r, i) => ({ pos: i + 1, name: r.name, value: r.v }));
    const total = sql.exec('SELECT COUNT(*) AS n FROM board').one().n;
    let me = null;
    const row = key && sql.exec('SELECT ' + by + ' AS v, at FROM board WHERE key = ?', key).toArray()[0];
    if (row) me = { value: row.v, pos: sql.exec('SELECT COUNT(*) AS n FROM board WHERE ' + by + ' > ? OR (' + by + ' = ? AND at < ?)', row.v, row.v, row.at).one().n + 1 };
    return Response.json({ by, top, me, total });
  }

  _accountsTable(sql) {
    sql.exec('CREATE TABLE IF NOT EXISTS accounts (key TEXT PRIMARY KEY, name TEXT, pin TEXT, token TEXT, code TEXT, fails INTEGER, lock INTEGER, at INTEGER)');
    try { sql.exec('ALTER TABLE accounts ADD COLUMN secs INTEGER DEFAULT 0'); } catch { /* there already: time played, in seconds */ }
    return true;
  }
  // One-time resets (RESET goes up by one for each): 1 = everyone signs in again (sessions end; names, PINs and
  // progress stay), and accounts with the default name ("Player", "Player 1"...) are deleted.
  _resetOnce(sql) {
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER)');
    const done = sql.exec("SELECT v FROM meta WHERE k = 'reset'").toArray()[0]?.v || 0;
    if (done >= RESET) return;
    this._accountsTable(sql);
    sql.exec('UPDATE accounts SET token = NULL');
    for (const { key } of sql.exec('SELECT key FROM accounts').toArray()) if (DEFAULT_NAME.test(key)) sql.exec('DELETE FROM accounts WHERE key = ?', key);   // (and the "Player 1" accounts go)
    sql.exec("INSERT OR REPLACE INTO meta VALUES ('reset', ?)", RESET);
  }

  // Online accounts: a name (unique, any letter case) with a PIN, holding that player's save code.
  // The PIN is kept only as a hash; logging in gives a token the game keeps to save on its own.
  async _account(req) {
    const sql = this.state.storage.sql, now = Date.now();
    this._accountsTable(sql);
    this._resetOnce(sql);
    const text = await req.text();
    if (text.length > 12000) return new Response(null, { status: 413 });
    let b; try { b = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
    const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) : '');
    const name = clean(b?.name), key = name.toLowerCase();
    const code = b?.code === undefined ? null : b.code;
    const secs = Number.isInteger(b?.secs) && b.secs >= 0 && b.secs < 1e9 ? b.secs : null;   // time played (seconds)
    const bad = (status, error) => Response.json({ error }, { status });
    if (!name) return bad(400, 'Type a player name.');
    if (code !== null && !SAVE_CODE.test(code)) return bad(400, 'That save code is not valid.');
    const row = sql.exec('SELECT * FROM accounts WHERE key = ?', key).toArray()[0];
    const signedIn = row && typeof b.token === 'string' && b.token === row.token;
    if (b.op === 'save') {
      if (!signedIn || code === null) return bad(403, 'Sign in again to save online.');
      sql.exec('UPDATE accounts SET code = ?, at = ?, secs = MAX(COALESCE(secs, 0), ?) WHERE key = ?', code, now, secs ?? 0, key);
      return Response.json({ ok: true, at: now });
    }
    if (b.op === 'rename') {                        // a new name, if nobody has it (the PIN, progress and sign-ins stay)
      if (!signedIn) return bad(403, 'Sign in again.');
      const to = clean(b.newName), toKey = to.toLowerCase();
      if (!to) return bad(400, 'Type the new name.');
      if (DEFAULT_NAME.test(to)) return bad(400, 'Pick a name of your own (not ' + to + ').');
      if (toKey !== key && sql.exec('SELECT 1 FROM accounts WHERE key = ?', toKey).toArray().length) return bad(409, 'The name ' + to + ' is taken.');
      sql.exec('DELETE FROM accounts WHERE key = ?', key);
      sql.exec('INSERT INTO accounts (key, name, pin, token, code, fails, lock, at, secs) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)', toKey, to, row.pin, row.token, row.code, row.at, row.secs || 0);
      sql.exec('CREATE TABLE IF NOT EXISTS board (key TEXT PRIMARY KEY, name TEXT, rating INTEGER, kills INTEGER, skins INTEGER, points INTEGER, games INTEGER, minutes INTEGER, at INTEGER)');
      sql.exec('UPDATE board SET key = ?, name = ? WHERE key = ?', toKey, to, key);   // (your place on the boards moves with you)
      return Response.json({ name: to });
    }
    if (b.op === 'pull') {                          // the latest progress (another PC may have saved since)
      if (!signedIn) return bad(403, 'Sign in again.');
      return Response.json({ code: row.code, at: row.at, name: row.name, secs: row.secs || 0 });
    }
    if (b.op !== 'login' && b.op !== 'create') return bad(400, 'Unknown request.');
    if (b.op === 'create' && DEFAULT_NAME.test(name)) return bad(400, 'Pick a name of your own (not ' + name + ').');
    if (b.op === 'create' && row) return bad(409, 'The name ' + row.name + ' is taken: pick another, or sign in if it is yours.');
    if (typeof b.pin !== 'string' || !/^(\d{4,8})?$/.test(b.pin)) return bad(400, 'A PIN is 4 to 8 digits (or none).');   // (no PIN: the name alone signs in)
    const hash = await pinHash(key, b.pin), token = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (!row) {                                     // a new name: claim it with this PIN and your progress
      if (code === null) return bad(404, 'No player called ' + name + '.');
      if (DEFAULT_NAME.test(name)) return bad(400, 'Pick a name of your own (not ' + name + ').');
      sql.exec('INSERT INTO accounts (key, name, pin, token, code, fails, lock, at, secs) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)', key, name, hash, token, code, now, secs ?? 0);
      sql.exec('DELETE FROM accounts WHERE key IN (SELECT key FROM accounts ORDER BY at DESC LIMIT -1 OFFSET ?)', ACCOUNTS_MAX);
      return Response.json({ token, code, name, at: now, created: true });
    }
    if (row.lock > now) return bad(429, 'Too many wrong PINs for ' + row.name + '. Try again in ' + Math.ceil((row.lock - now) / 60000) + ' min.');
    if (row.pin !== hash) {
      const fails = row.fails + 1;
      sql.exec('UPDATE accounts SET fails = ?, lock = ? WHERE key = ?', fails >= 5 ? 0 : fails, fails >= 5 ? now + 15 * 60000 : 0, key);
      return bad(403, 'Wrong PIN for ' + row.name + ' (or that name is taken).');
    }
    // (the same token for every PC you sign in on: they all stay signed in)
    sql.exec('UPDATE accounts SET fails = 0, lock = 0, token = COALESCE(token, ?) WHERE key = ?', token, key);
    return Response.json({ token: row.token || token, code: row.code, name: row.name, at: row.at, secs: row.secs || 0, created: false });
  }

  async webSocketClose(ws) { await this._gone(ws); }
  async webSocketError(ws) { await this._gone(ws); }

  async _gone(ws) {
    this.rate.delete(ws);
    const me = ws.deserializeAttachment() || {};
    if (me.role === 'host') {
      for (const { ws: s, a } of this._all()) if (a.role === 'player') { this._send(s, { t: 'end' }); try { s.close(4000, 'The host left.'); } catch (e) { /* closed */ } }
      if (me.rankedListed) await this._publish(me, null);
    } else {
      const host = this._host();
      if (host) this._send(host.ws, { t: 'leave', id: me.id });
    }
  }
}
