// Internet play through the game's relay server (relay/ in this repo, a Cloudflare Worker).
// The host opens a room with a short code (like K7QD); players type the code to join. Every
// message goes through the relay, so it works on networks that block direct PC-to-PC
// connections, as long as the network allows the relay's address.
//
// The objects handed to the game behave exactly like a direct Link (link.js):
//   send(obj, fast), onmessage, onclose, close(), open
// Messages are bundled and flushed about 20 times a second. For 'fast' messages (position
// updates) only the newest of each kind is kept in a bundle.

export const DEFAULT_RELAY = '';           // set to the deployed relay, e.g. 'https://recoil-range-relay.NAME.workers.dev'
const FLUSH_MS = 50;
const CONNECT_TIMEOUT = 10000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I

const KEY = 'recoil-range-relay';
export function relayUrl() {
  try { const q = new URLSearchParams(location.search).get('relay'); if (q) return q; } catch (e) { /* no location */ }
  try { const s = localStorage.getItem(KEY); if (s) return s; } catch (e) { /* storage blocked */ }
  return DEFAULT_RELAY;
}
export function setRelayUrl(u) {
  try { if (u) localStorage.setItem(KEY, u); else localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
}

export function makeCode() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += CODE_CHARS[x % CODE_CHARS.length];
  return s;
}
export function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function wsUrl(base, code, role) {
  let u = String(base || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('No relay server set. Open "Relay server" below and paste its address.');
  if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/^http(s?):\/\//i, 'ws$1://');
  return u + '/room/' + code + '?role=' + role;
}

const REASONS = {
  4004: 'No game with that code. Check the code with the host.',
  4008: 'That game is full.',
  4009: 'That code is already in use. Try hosting again.',
  4000: 'The host left.',
  4001: 'The host removed you from the game.',
};
function closeReason(e) { return REASONS[e.code] || e.reason || 'Lost the connection to the relay server.'; }

// Open a socket and wait for the relay's hello. Resolves { ws, id }.
function open(base, code, role) {
  return new Promise((res, rej) => {
    let ws;
    try { ws = new WebSocket(wsUrl(base, code, role)); } catch (e) { rej(e.message ? e : new Error('Bad relay address.')); return; }
    const t = setTimeout(() => { ws.close(); rej(new Error('The relay server did not answer. Check its address, or the network may block it.')); }, CONNECT_TIMEOUT);
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'hello') { clearTimeout(t); ws.onmessage = null; ws.onclose = null; ws.onerror = null; res({ ws, id: m.id }); }
    };
    ws.onclose = (e) => { clearTimeout(t); rej(new Error(e.code >= 4000 ? closeReason(e) : 'Could not reach the relay server. Check its address, or the network may block it.')); };
    ws.onerror = () => {};
  });
}

// A queue of outgoing messages; fast ones replace an older queued one of the same kind.
class Outbox {
  constructor() { this.q = []; }
  push(obj, fast) {
    if (fast && obj.k) {
      const i = this.q.findIndex((x) => x.f && x.m.k === obj.k);
      if (i >= 0) { this.q.splice(i, 1); }
    }
    this.q.push({ m: obj, f: fast });
  }
  take() { const out = this.q.map((x) => x.m); this.q.length = 0; return out; }
  get size() { return this.q.length; }
}

class VirtualLink {
  constructor(closeFn) {
    this.onmessage = null; this.onclose = null; this.open = true;
    this.out = new Outbox();
    this._closeFn = closeFn;
  }
  send(obj, fast = false) { if (this.open) this.out.push(obj, fast); }
  _recv(list) {
    if (!this.onmessage || !Array.isArray(list)) return;
    for (const m of list) { if (!this.open) return; if (m && typeof m === 'object') this.onmessage(m); }
  }
  _closed() { if (!this.open) return; this.open = false; if (this.onclose) this.onclose(); }
  close() { if (!this.open) return; this.open = false; if (this._closeFn) this._closeFn(); }
}

// Host a room. Returns a hub: { code, onjoin(link), close(), onlost(msg) }.
export async function hostRelay(base, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const code = makeCode();
    try { const { ws } = await open(base, code, 'host'); return new HostHub(ws, code); }
    catch (e) { lastErr = e; if (!/already in use/.test(e.message)) throw e; }
  }
  throw lastErr;
}

class HostHub {
  constructor(ws, code) {
    this.ws = ws; this.code = code;
    this.links = new Map();       // player id -> VirtualLink
    this.onjoin = null; this.onlost = null;
    this.alive = true;
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'join') {
        const id = m.id;
        const link = new VirtualLink(() => { this.links.delete(id); this._send({ kick: id }); });
        this.links.set(id, link);
        if (this.onjoin) this.onjoin(link);
      } else if (m.t === 'leave') {
        const l = this.links.get(m.id); this.links.delete(m.id); if (l) l._closed();
      } else if (m.from != null) {
        const l = this.links.get(m.from); if (l) l._recv(m.d);
      }
    };
    ws.onclose = (e) => {
      if (!this.alive) return;
      this._stop();
      for (const l of this.links.values()) l._closed();
      this.links.clear();
      if (this.onlost) this.onlost(closeReason(e));
    };
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
  }
  _send(obj) { if (this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(obj)); } catch (e) { /* closing */ } } }
  flush() {
    const b = [];
    for (const [id, l] of this.links) if (l.out.size) b.push({ to: id, d: l.out.take() });
    if (b.length) this._send({ b });
  }
  _stop() { this.alive = false; clearInterval(this.timer); }
  close() {
    if (!this.alive) return;
    this.flush();
    this._stop();
    for (const l of this.links.values()) l.open = false;
    this.links.clear();
    try { this.ws.close(1000, 'bye'); } catch (e) { /* closed */ }
  }
}

// Join a room by code. Resolves a Link-like object connected to the host.
export async function joinRelay(base, code) {
  const c = cleanCode(code);
  if (c.length < 4) throw new Error('Type the 4-letter game code from the host.');
  const { ws } = await open(base, c, 'player');
  const link = new VirtualLink(() => { clearInterval(timer); try { ws.close(1000, 'bye'); } catch (e) { /* closed */ } });
  link.code = c;
  link.closeReason = '';
  const flush = () => { if (link.out.size && ws.readyState === 1) { try { ws.send(JSON.stringify({ d: link.out.take() })); } catch (e) { /* closing */ } } };
  const timer = setInterval(flush, FLUSH_MS);
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.t === 'end') { link.closeReason = 'The host left.'; return; }
    if (m.d) link._recv(m.d);
  };
  ws.onclose = (e) => { clearInterval(timer); if (!link.closeReason) link.closeReason = closeReason(e); link._closed(); };
  return link;
}

// Quick check that a relay address answers (GET /).
export async function pingRelay(base) {
  let u = String(base || '').trim().replace(/\/+$/, '');
  if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u;
  const r = await fetch(u + '/', { cache: 'no-store' });
  const t = await r.text();
  if (!/Recoil Range relay/.test(t)) throw new Error('That address answered, but it is not a Recoil Range relay.');
  return true;
}
