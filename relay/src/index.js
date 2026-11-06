// Recoil Range relay (Cloudflare Worker + Durable Object).
//
// Each game is a room named by a short code. The host connects with ?role=host, players
// with ?role=player. Players' messages go to the host; the host's messages go to one player
// or to all. The relay never looks inside the game messages and keeps nothing after the room
// empties.
//
//   GET  /                      -> "Recoil Range relay: OK" (for the in-game connection test)
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

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health') return new Response('Recoil Range relay: OK', { headers: cors });
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})$/);
    if (!m || !CODE.test(m[1].toUpperCase())) return new Response('Not found', { status: 404, headers: cors });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426, headers: cors });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase()));
    return stub.fetch(req);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    this.rate = new Map();      // socket -> [windowStart, count]
  }

  _all() { return this.state.getWebSockets().map((ws) => ({ ws, a: ws.deserializeAttachment() || {} })); }
  _host() { return this._all().find((x) => x.a.role === 'host'); }
  _send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* closing */ } }

  async fetch(req) {
    const url = new URL(req.url);
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
    server.serializeAttachment({ role, id });
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
    const me = ws.deserializeAttachment() || {};
    if (me.role === 'host') {
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

  async webSocketClose(ws) { this._gone(ws); }
  async webSocketError(ws) { this._gone(ws); }

  _gone(ws) {
    this.rate.delete(ws);
    const me = ws.deserializeAttachment() || {};
    if (me.role === 'host') {
      for (const { ws: s, a } of this._all()) if (a.role === 'player') { this._send(s, { t: 'end' }); try { s.close(4000, 'The host left.'); } catch (e) { /* closed */ } }
    } else {
      const host = this._host();
      if (host) this._send(host.ws, { t: 'leave', id: me.id });
    }
  }
}
