// Peer-to-peer connection between two browsers on the same network (WebRTC data channels),
// set up with copy-paste codes instead of a server:
//
//   1. The player who wants to join makes a JOIN code      (createJoinRequest)
//   2. The host pastes it and gets a REPLY code            (acceptJoin)
//   3. The joiner pastes the reply                         (request.finish)
//
// No STUN/TURN servers and no third-party requests: only addresses on the local network are
// used, so both PCs must be on the same network, and that network must allow devices to
// reach each other (some school and public Wi-Fi does not).
//
// Each Link has two channels: 'rel' (reliable, ordered: events) and 'fast' (unordered, no
// retransmits: position updates, where only the newest matters). Messages are JSON.

const PREFIX = 'RR1-';
const CONNECT_TIMEOUT = 20000;

async function deflate(text) {
  if (typeof CompressionStream === 'undefined') return 'u' + btoa(unescape(encodeURIComponent(text)));
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return 'z' + btoa(bin);
}
async function inflate(s) {
  if (s[0] === 'u') return decodeURIComponent(escape(atob(s.slice(1))));
  const bin = atob(s.slice(1));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}
// Only the SDP lines a data-channel connection needs (shorter codes).
function trimSdp(sdp) {
  return sdp.split(/\r?\n/).filter((l) => l && !/^a=(extmap|rtcp-fb|ssrc|msid|max-message-size)/.test(l)).join('\r\n') + '\r\n';
}
async function pack(obj) {
  const b64 = await deflate(JSON.stringify(obj));
  return PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack(code) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!c.startsWith(PREFIX)) throw new Error('That is not a Recoil Range code.');
  const body = c.slice(PREFIX.length);
  let b64 = body.slice(1).replace(/-/g, '+').replace(/_/g, '/');   // first char: format flag
  while (b64.length % 4) b64 += '=';
  try { return JSON.parse(await inflate(body[0] + b64)); } catch (e) { throw new Error('The code is incomplete or damaged. Copy all of it.'); }
}

function waitIce(pc, ms = 5000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const done = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', done); res(); } };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(res, ms);
  });
}
function channelsOpen(chs, pc) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Could not connect. Both PCs must be on the same network, and the network must allow devices to talk to each other (some school or public Wi-Fi blocks this).')), CONNECT_TIMEOUT);
    const check = () => { if (chs.every((c) => c && c.readyState === 'open')) { clearTimeout(t); res(); } };
    for (const c of chs) if (c) c.addEventListener('open', check);
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') { clearTimeout(t); rej(new Error('Connection failed (the network may block direct connections between PCs).')); } });
    check();
  });
}

export class Link {
  constructor(pc, rel, fast) {
    this.pc = pc; this.rel = rel; this.fast = fast;
    this.onmessage = null;
    this.onclose = null;
    this.open = true;
    const recv = (e) => { if (this.onmessage) { let m; try { m = JSON.parse(e.data); } catch (err) { return; } this.onmessage(m); } };
    rel.onmessage = recv; fast.onmessage = recv;
    const closed = () => { if (!this.open) return; this.open = false; if (this.onclose) this.onclose(); };
    rel.onclose = closed; fast.onclose = closed;
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closed(); });
  }
  // fast: position updates (may be dropped; only the newest matters).
  send(obj, fast = false) {
    const ch = fast ? this.fast : this.rel;
    if (!this.open || ch.readyState !== 'open') return;
    try { ch.send(JSON.stringify(obj)); } catch (e) { /* closing */ }
  }
  close() { this.open = false; try { this.pc.close(); } catch (e) { /* ignore */ } }
}

function newPc() { return new RTCPeerConnection({ iceServers: [] }); }
function channels(pc) {
  return [pc.createDataChannel('rel', { ordered: true }), pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 })];
}

// Joiner, step 1. Returns { code, finish(replyCode) -> Promise<Link>, cancel() }.
export async function createJoinRequest() {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser cannot make network connections (WebRTC is unavailable).');
  const pc = newPc();
  const [rel, fast] = channels(pc);
  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  const code = await pack({ t: 'join', sdp: trimSdp(pc.localDescription.sdp) });
  return {
    code,
    async finish(reply) {
      const m = await unpack(reply);
      if (m.t !== 'reply') throw new Error(m.t === 'join' ? 'That is a join code. Paste the REPLY code the host sends back.' : 'That is not a reply code.');
      await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      await channelsOpen([rel, fast], pc);
      return new Link(pc, rel, fast);
    },
    cancel() { pc.close(); },
  };
}

// Host: accept one player's join code. Returns { code (reply), link: Promise<Link> }.
export async function acceptJoin(joinCode) {
  const m = await unpack(joinCode);
  if (m.t !== 'join') throw new Error(m.t === 'reply' ? 'That is a reply code. Paste the JOIN code the other player sends you.' : 'That is not a join code.');
  const pc = newPc();
  const got = {};
  const both = new Promise((res) => {
    pc.ondatachannel = (e) => { got[e.channel.label] = e.channel; if (got.rel && got.fast) res(); };
  });
  await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIce(pc);
  const code = await pack({ t: 'reply', sdp: trimSdp(pc.localDescription.sdp) });
  const link = (async () => {
    await Promise.race([both, new Promise((_, rej) => setTimeout(() => rej(new Error('The other player did not connect in time.')), CONNECT_TIMEOUT))]);
    await channelsOpen([got.rel, got.fast], pc);
    return new Link(pc, got.rel, got.fast);
  })();
  link.catch(() => pc.close());
  return { code, link };
}
