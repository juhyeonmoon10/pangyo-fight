import { IkemenRTCBridge } from './rtc-bridge.mjs';

const prefix = 'pangyo-fight-room-v1-';
const lobbyLabel = 'pangyo-room-v1';
const roomLifetime = 5 * 60 * 1000;
const serviceTimeout = 20000;
const connectTimeout = 30000;

function roomError(code) {
  return Object.assign(new Error(code), { code });
}

function randomCode() {
  // Rejection sampling keeps leading zeroes and gives all six-digit codes equal weight.
  const word = new Uint32Array(1);
  do { crypto.getRandomValues(word); } while (word[0] >= 4294000000);
  return String(word[0] % 1000000).padStart(6, '0');
}

const abortError = () => new DOMException('Room cancelled', 'AbortError');

export class RoomSession extends EventTarget {
  constructor({ role, buildId, nickname = '' }) {
    super();
    if (!['host', 'guest'].includes(role) || !buildId) throw new TypeError('role and buildId required');
    this.role = role;
    this.buildId = buildId;
    this.nickname = [...String(nickname)].slice(0, 16).join('');
    this.bridge = null;
    this.peer = null;
    this.connection = null;
    this.closed = false;
    this.admitted = false;
    this.signalingReleased = false;
    this.started = false;
    this.closeReason = '';
    this.abort = () => this.finish(abortError(), false);
    this.dismissals = new Map();
  }

  get peerNickname() { return this.bridge?.peerNickname || ''; }

  deadline(ms, code) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(roomError(code)), ms);
  }

  async start({ code, onCode, signal }) {
    if (this.started || this.closed) throw roomError('ROOM_CLOSED');
    this.started = true;
    if (signal?.aborted) throw abortError();
    if (!globalThis.RTCPeerConnection || !globalThis.crypto?.randomUUID) throw roomError('ROOM_BROWSER');
    // The standalone upstream browser build contains its own dependencies.
    // Loading it only in numbered-room mode keeps manual and local play independent.
    try { await import('./vendor/peerjs-1.5.5.min.js'); }
    catch { throw roomError('ROOM_SERVICE'); }
    if (this.closed || signal?.aborted) throw abortError();
    this.signal = signal;
    signal?.addEventListener('abort', this.abort, { once: true });
    window.addEventListener('pagehide', this.abort, { once: true });
    return new Promise((resolve, reject) => {
      this.resolvePair = resolve;
      this.rejectPair = reject;
      this.deadline(serviceTimeout, 'ROOM_SERVICE');
      this.register(code, onCode, 0);
    });
  }

  register(inputCode, onCode, attempt) {
    const host = this.role === 'host';
    const code = host ? randomCode() : inputCode;
    const id = host ? prefix + code : 'pangyo-fight-guest-' + crypto.randomUUID();
    let peer;
    try { peer = new window.peerjs.Peer(id, { secure: true }); }
    catch { this.finish(roomError('ROOM_BROWSER')); return; }
    this.peer = peer;
    const current = () => !this.closed && this.peer === peer;
    peer.on('open', () => {
      if (!current()) return;
      if (host) {
        this.expiresAt = Date.now() + roomLifetime;
        this.deadline(roomLifetime, 'ROOM_EXPIRED');
        onCode?.(code);
      } else {
        this.deadline(connectTimeout, 'ROOM_TIMEOUT');
        try {
          const connection = peer.connect(prefix + code, {
            label: lobbyLabel, serialization: 'json', reliable: true,
            metadata: { protocol: 1, buildId: this.buildId },
          });
          this.bind(connection);
        } catch { this.finish(roomError('ROOM_CONNECTION')); }
      }
    });
    peer.on('connection', connection => {
      if (!current()) { connection.close(); return; }
      if (!host || connection.label !== lobbyLabel) { connection.close(); return; }
      if (this.connection) { this.dismiss(connection, 'ROOM_FULL'); return; }
      if (!this.expiresAt || Date.now() >= this.expiresAt) {
        this.finish(roomError('ROOM_EXPIRED'));
        return;
      }
      if (connection.metadata?.protocol !== 1 || connection.metadata?.buildId !== this.buildId) {
        this.dismiss(connection, 'ROOM_BUILD');
        return;
      }
      this.deadline(connectTimeout, 'ROOM_TIMEOUT');
      try { this.bind(connection); } catch { this.finish(roomError('ROOM_CONNECTION')); }
    });
    peer.on('call', call => call.close());
    peer.on('error', error => {
      if (!current() || this.signalingReleased) return;
      if (host && error.type === 'unavailable-id' && attempt < 4) {
        this.peer = null;
        peer.destroy();
        this.register(inputCode, onCode, attempt + 1);
      } else if (error.type === 'peer-unavailable') {
        if (!host) this.finish(roomError('ROOM_NOT_FOUND'));
      } else if (error.type === 'browser-incompatible') {
        this.finish(roomError('ROOM_BROWSER'));
      } else if (error.type !== 'webrtc') {
        this.finish(roomError('ROOM_SERVICE'));
      }
    });
    const lost = () => {
      if (current() && !this.signalingReleased) this.finish(roomError('ROOM_SERVICE'));
    };
    peer.on('disconnected', lost);
    peer.on('close', lost);
  }

  // Reject only this entrant. Closing their connection is delayed so the reason
  // can arrive even on a high-latency link. The active pair keeps its own PC.
  dismiss(connection, code) {
    const cleanUp = () => {
      clearTimeout(this.dismissals.get(connection));
      this.dismissals.delete(connection);
    };
    this.dismissals.set(connection, setTimeout(() => { cleanUp(); connection.close(); }, connectTimeout));
    connection.on('close', cleanUp);
    connection.on('error', () => { cleanUp(); connection.close(); });
    connection.on('open', () => {
      if (!this.closed) connection.send({ error: code });
    });
  }

  bind(connection) {
    this.connection = connection;
    // PeerJS uses one in-band channel for admission. Set up both negotiated
    // channels synchronously, before its pending offer/answer can complete.
    this.bridge = new IkemenRTCBridge(connection.peerConnection, {
      role: this.role, buildId: this.buildId, nickname: this.nickname, controlId: 32, rollbackId: 33,
    });
    this.bridge.addEventListener('ready', () => this.releaseSignaling());
    this.bridge.addEventListener('close', () => {
      if (this.closed) return;
      const code = this.bridge.closeReason.includes('mismatch') ? 'ROOM_BUILD' : 'ROOM_CLOSED';
      this.finish(roomError(code));
    });
    connection.on('close', () => this.finish(roomError('ROOM_CLOSED')));
    connection.on('error', () => this.finish(roomError('ROOM_CONNECTION')));
    if (this.role === 'host') {
      connection.on('open', () => {
        if (this.closed) return;
        connection.send({ accepted: true });
        this.admit();
      });
    } else {
      connection.on('data', message => {
        if (this.admitted || this.closed) return;
        if (message?.accepted === true) this.admit();
        else {
          const code = ['ROOM_FULL', 'ROOM_BUILD', 'ROOM_EXPIRED'].includes(message?.error) ? message.error : 'ROOM_CONNECTION';
          this.finish(roomError(code));
        }
      });
    }
  }

  admit() {
    this.admitted = true;
    this.resolvePair?.();
    this.resolvePair = this.rejectPair = null;
    this.releaseSignaling();
  }

  releaseSignaling() {
    if (this.closed || this.signalingReleased || !this.admitted || !this.bridge?.ready) return;
    this.signalingReleased = true;
    clearTimeout(this.timer);
    // Disconnect only the rendezvous socket. destroy() would also close the match.
    this.peer.disconnect();
  }

  async attachEngine(timeoutMs = connectTimeout) {
    if (!this.admitted || this.closed) throw roomError(this.closeReason || 'ROOM_CLOSED');
    try { await this.bridge.waitReady(timeoutMs); }
    catch {
      const error = roomError(this.closeReason || 'ROOM_TIMEOUT');
      this.finish(error);
      throw error;
    }
    if (this.closed || !this.bridge.ready) throw roomError(this.closeReason || 'ROOM_CLOSED');
    globalThis.__ikemenRTC = this.bridge;
    return this.bridge;
  }

  finish(error, notify = true) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = typeof error.code === 'string' ? error.code : 'ROOM_CLOSED';
    clearTimeout(this.timer);
    this.signal?.removeEventListener('abort', this.abort);
    window.removeEventListener('pagehide', this.abort);
    for (const timer of this.dismissals.values()) clearTimeout(timer);
    this.dismissals.clear();
    if (this.bridge && globalThis.__ikemenRTC === this.bridge) delete globalThis.__ikemenRTC;
    this.bridge?.close(this.closeReason);
    this.peer?.destroy();
    this.rejectPair?.(error);
    this.resolvePair = this.rejectPair = null;
    if (notify) this.dispatchEvent(new CustomEvent('close', { detail: error }));
  }

  close() { this.finish(abortError(), false); }
}

export async function createRoom(session, { onCode, signal } = {}) {
  if (session.role !== 'host') throw roomError('ROOM_INVALID');
  return session.start({ onCode, signal });
}

export async function joinRoom(session, code, { signal } = {}) {
  if (session.role !== 'guest' || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw roomError('ROOM_INVALID');
  return session.start({ code, signal });
}
