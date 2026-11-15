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
export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function nonce() {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return [...a].map((n) => n.toString(36)).join("");
}
