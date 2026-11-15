// Online play over WebRTC using PeerJS. The free PeerJS cloud server only introduces the two
// browsers; game messages and video then go directly between them.

const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const ID_PREFIX = "handduel-v1-";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

let peerLib;
function loadPeerJs() {
  if (window.Peer) return Promise.resolve(window.Peer);
  peerLib ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PEERJS_URL;
    s.onload = () => resolve(window.Peer);
    s.onerror = () => {
      peerLib = null;
      reject(new Error("Couldn't load the online module. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return peerLib;
}

export function makeRoomCode() {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return [...a].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
}

export function cleanCode(s) {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

/**
 * Callbacks: onOpen(), onMessage(obj), onStream(MediaStream), onClose(reason), onError(message)
 */
export class Net {
  constructor(callbacks) {
    this.cb = callbacks;
    this.peer = null;
    this.conn = null;
    this.call = null;
    this.isHost = false;
    this.localStream = null;
    this.closed = false;
  }

  async host(code) {
    const Peer = await loadPeerJs();
    this.isHost = true;
    this.code = code;
    this.peer = new Peer(ID_PREFIX + code);
    this._wirePeer();
    await this._opened();
    this.peer.on("connection", (conn) => {
      if (this.conn) {
        conn.on("open", () => {
          conn.send({ t: "full" });
          setTimeout(() => conn.close(), 300);
        });
        return;
      }
      this._wireConn(conn);
    });
  }

  async join(code) {
    const Peer = await loadPeerJs();
    this.isHost = false;
    this.code = code;
    this.peer = new Peer();
    this._wirePeer();
    await this._opened();
    this._wireConn(this.peer.connect(ID_PREFIX + code, { reliable: true }));
    // PeerJS reports a wrong code as a peer error, but not always quickly.
    this.joinTimer = setTimeout(() => {
      if (!this.conn?.open) this._fail("Couldn't reach that room. Check the code and try again.");
    }, 12000);
  }

  _opened() {
    return new Promise((resolve, reject) => {
      this.peer.once("open", resolve);
      this.peer.once("error", reject);
    });
  }

  _wirePeer() {
    this.peer.on("error", (err) => {
      const msg =
        {
          "unavailable-id": "That room code is already in use.",
          "peer-unavailable": "No room with that code. Check it and try again.",
          network: "Lost connection to the matchmaking server.",
          "browser-incompatible": "This browser doesn't support online play.",
        }[err.type] || `Online error: ${err.type || err.message || err}`;
      this._fail(msg, err.type);
    });
    this.peer.on("call", (call) => {
      call.answer(this.localStream || undefined);
      this._wireCall(call);
    });
    this.peer.on("disconnected", () => {
      // Lost the matchmaking server only; the direct link may still be fine. Try to rejoin it.
      if (!this.closed) this.peer.reconnect();
    });
  }

  _wireConn(conn) {
    this.conn = conn;
    conn.on("open", () => {
      clearTimeout(this.joinTimer);
      this._startHeartbeat();
      this.cb.onOpen?.();
    });
    conn.on("data", (d) => {
      this.lastSeen = Date.now();
      if (d?.t === "ping") return;
      if (d?.t === "bye") {
        this.cb.onClose?.("Your opponent left the match.");
        this.close();
        return;
      }
      this.cb.onMessage?.(d);
    });
    conn.on("close", () => {
      if (!this.closed) this.cb.onClose?.("Your opponent left the match.");
      this.close();
    });
    conn.on("error", (e) => this._fail(`Connection error: ${e.message || e}`));
  }

  // A closed tab often doesn't fire PeerJS's close event, so: say goodbye when leaving,
  // ping every 2 s, and give up after 10 s of silence.
  _startHeartbeat() {
    this.lastSeen = Date.now();
    this.heartbeat = setInterval(() => {
      this.send({ t: "ping" });
      if (Date.now() - this.lastSeen > 10000) {
        this.cb.onClose?.("Lost connection to your opponent.");
        this.close();
      }
    }, 2000);
    this.onPageHide = () => this.send({ t: "bye" });
    window.addEventListener("pagehide", this.onPageHide);
  }

  _wireCall(call) {
    this.call = call;
    call.on("stream", (s) => this.cb.onStream?.(s));
  }

  /** Send our camera to the opponent (they answer with theirs, if they have one). */
  startVideo() {
    if (!this.localStream || !this.conn) return;
    this._wireCall(this.peer.call(this.conn.peer, this.localStream));
  }

  /** Swap the outgoing camera track (e.g. after switching front/back camera). */
  replaceVideoTrack(stream) {
    this.localStream = stream;
    const track = stream?.getVideoTracks()[0];
    const sender = this.call?.peerConnection?.getSenders().find((s) => s.track?.kind === "video");
    if (track && sender) sender.replaceTrack(track);
  }

  send(obj) {
    if (this.conn?.open) this.conn.send(obj);
  }

  _fail(msg, type) {
    if (this.closed) return;
    this.cb.onError?.(msg, type);
  }

  close() {
    if (this.closed) return;
    this.send({ t: "bye" });
    this.closed = true;
    clearTimeout(this.joinTimer);
    clearInterval(this.heartbeat);
    if (this.onPageHide) window.removeEventListener("pagehide", this.onPageHide);
    try {
      this.call?.close();
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      /* already closed */
    }
  }
}

/** SHA-256 hex digest, for commit-reveal so neither side can wait and copy the other's throw. */
// crypto.subtle only exists on HTTPS/localhost, so plain-http LAN addresses use the JS version.
export async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  if (!globalThis.crypto?.subtle) return sha256js(bytes);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256js(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  view.setUint32(padded.length - 4, (len << 3) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

export function nonce() {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return [...a].map((n) => n.toString(36)).join("");
}
