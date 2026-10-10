// Online play. Three interchangeable transports carry the same messages:
//  - claude.ai artifact viewer: the platform's live `room` channel
//  - any other host (e.g. GitHub Pages): WebRTC via PeerJS
//  - `?net=local`: BroadcastChannel between tabs (for testing)
// A small reliability layer (sequence numbers, acks, resends, in-order
// delivery) sits on top so a dropped packet never desyncs the game.
const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/+esm';
const PREFIX = 'rooftop-cup-pong-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOPIC = 'pong';

const randomCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const randomId = () => Math.random().toString(36).slice(2, 10);
export const normalizeCode = (c) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

class Link {
  constructor(rawSend, onMessage) {
    this.raw = rawSend;
    this.onMessage = onMessage;
    this.seq = 0;
    this.expected = 1;
    this.out = new Map();
    this.inbox = new Map();
    this.timer = setInterval(() => { for (const p of this.out.values()) this.raw(p); }, 700);
  }
  send(msg) {
    const pkt = { seq: ++this.seq, msg };
    this.out.set(pkt.seq, pkt);
    this.raw(pkt);
  }
  receive(pkt) {
    if (!pkt || typeof pkt !== 'object') return;
    if (pkt.ack) { this.out.delete(pkt.ack); return; }
    if (!Number.isInteger(pkt.seq)) return;
    this.raw({ ack: pkt.seq });
    if (pkt.seq < this.expected) return;
    this.inbox.set(pkt.seq, pkt.msg);
    while (this.inbox.has(this.expected)) {
      const m = this.inbox.get(this.expected);
      this.inbox.delete(this.expected++);
      if (m && typeof m === 'object') this.onMessage(m);
    }
  }
  close() { clearInterval(this.timer); this.onClose = null; this.dispose?.(); }
}

// --- transport selection ----------------------------------------------------

function backend() {
  if (new URLSearchParams(location.search).get('net') === 'local') return 'local';
  if (window.claude?.use) return 'room';
  return 'peer';
}

// A "channel" is a broadcast pipe for one room code: { send(data), onData(fn(data, from)), onLeave(fn(from)), close() }
async function openChannel(code) {
  const kind = backend();
  if (kind === 'local') {
    const bc = new BroadcastChannel(PREFIX + code);
    const me = randomId();
    let handler = () => {};
    bc.onmessage = (e) => { if (e.data.from !== me) handler(e.data.data, e.data.from); };
    return { send: (data) => bc.postMessage({ from: me, data }), onData: (fn) => { handler = fn; }, onLeave: () => {}, close: () => bc.close() };
  }
  if (kind === 'room') {
    const room = await window.claude.use('room');
    if (!room) throw new Error('Online play is not available in this view.');
    const r = await room.join(`cup-${code.toLowerCase()}`);
    let handler = () => {}, leave = () => {};
    r.on(TOPIC, (m) => { if (!m.sameTab) handler(m.data, m.peer); });
    r.onPeers((ch) => ch.left.forEach((p) => leave(p.peer)));
    return {
      send: (data) => r.emit(TOPIC, data).catch(() => {}),
      onData: (fn) => { handler = fn; },
      onLeave: (fn) => { leave = fn; },
      close: () => r.leave(),
    };
  }
  return null; // PeerJS is point-to-point; handled separately below.
}

// Pair two clients on a broadcast channel: guest says hello, host welcomes.
function pairOnChannel(ch, isHost, { onMessage, onClose }) {
  const me = randomId();
  let partner = null, partnerPeer = null, link = null;
  return new Promise((resolve) => {
    let helloTimer = null;
    const makeLink = () => {
      link = new Link((pkt) => ch.send({ from: me, to: partner, pkt }), onMessage);
      link.dispose = () => { clearInterval(helloTimer); ch.send({ bye: true, from: me }); setTimeout(() => ch.close(), 200); };
      resolve(link);
    };
    ch.onData((d, peer) => {
      if (!d || typeof d !== 'object') return;
      if (isHost && !partner && d.hello) {
        partner = d.hello; partnerPeer = peer;
        ch.send({ welcome: partner, from: me });
        makeLink();
      } else if (isHost && partner && d.hello === partner) {
        ch.send({ welcome: partner, from: me }); // our welcome got lost
      } else if (!isHost && !partner && d.welcome === me) {
        partner = d.from; partnerPeer = peer;
        clearInterval(helloTimer);
        makeLink();
      } else if (link && d.from === partner && d.to === me) {
        link.receive(d.pkt);
      }
      if (d.bye && d.from === partner) onClose();
    });
    ch.onLeave((peer) => { if (peer && peer === partnerPeer) onClose(); });
    if (!isHost) {
      const hello = () => ch.send({ hello: me });
      hello();
      helloTimer = setInterval(hello, 800);
    }
  });
}

async function loadPeer() {
  const mod = await import(PEERJS_URL);
  return mod.Peer ?? mod.default;
}

function peerLink(peer, conn, { onMessage, onClose }) {
  const link = new Link((pkt) => { if (conn.open) conn.send(pkt); }, onMessage);
  conn.on('data', (d) => link.receive(typeof d === 'string' ? JSON.parse(d) : d));
  conn.on('close', onClose);
  link.dispose = () => { conn.close(); peer.destroy(); };
  return link;
}

// --- public API ---------------------------------------------------------------

// Resolves { code, cancel }; onConnect(link) fires when a friend joins.
export async function hostRoom({ onConnect, onMessage, onClose }) {
  if (backend() !== 'peer') {
    const code = randomCode();
    const ch = await openChannel(code);
    pairOnChannel(ch, true, { onMessage, onClose }).then(onConnect);
    return { code, cancel: () => ch.close() };
  }
  const Peer = await loadPeer();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode();
    const peer = new Peer(PREFIX + code);
    const err = await new Promise((resolve) => {
      peer.on('open', () => resolve(null));
      peer.on('error', (e) => resolve(e));
    });
    if (err?.type === 'unavailable-id') { peer.destroy(); continue; }
    if (err) { peer.destroy(); throw new Error('Could not reach the matchmaking server.'); }
    let taken = false;
    peer.on('connection', (conn) => {
      if (taken) { conn.close(); return; }
      taken = true;
      conn.on('open', () => onConnect(peerLink(peer, conn, { onMessage, onClose })));
    });
    return { code, cancel: () => peer.destroy() };
  }
  throw new Error('Could not create a room. Try again.');
}

export async function joinRoom(rawCode, { onMessage, onClose }) {
  const code = normalizeCode(rawCode);
  if (code.length !== 5) throw new Error('Room codes are 5 characters.');
  if (backend() !== 'peer') {
    const ch = await openChannel(code);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`No game found for ${code}.`)), 12000));
    try {
      return await Promise.race([pairOnChannel(ch, false, { onMessage, onClose }), timeout]);
    } catch (e) { ch.close(); throw e; }
  }
  const Peer = await loadPeer();
  const peer = new Peer();
  await new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', () => reject(new Error('Could not reach the matchmaking server.')));
  });
  return new Promise((resolve, reject) => {
    const conn = peer.connect(PREFIX + code, { reliable: true });
    const fail = (msg) => { clearTimeout(timer); peer.destroy(); reject(new Error(msg)); };
    const timer = setTimeout(() => fail(`No game found for ${code}.`), 12000);
    peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? `No game found for ${code}.` : 'Connection failed.'));
    conn.on('open', () => { clearTimeout(timer); resolve(peerLink(peer, conn, { onMessage, onClose })); });
  });
}
