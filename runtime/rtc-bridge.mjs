// Browser transport for the local IKEMEN net.Conn and GGPO transport adapters.
// Match synchronization is verified in browser loopback; Internet/Chromebook QA is separate.
// Keep IKEMEN's control bytes and GGPO packet bytes unchanged.
export class IkemenRTCBridge extends EventTarget {
  constructor(pc, { role, buildId, nickname = '', controlId = 0, rollbackId = 1, maxControlBytes = 4 * 1024 * 1024, maxPackets = 256 } = {}) {
    super();
    this.listeners = [];
    if (!['host', 'guest'].includes(role) || !buildId) throw new TypeError('role and content buildId required');
    this.pc = pc;
    this.role = role;
    this.buildId = buildId;
    this.peerNickname = '';
    this.maxControlBytes = maxControlBytes;
    this.maxPackets = maxPackets;
    this.controlChunks = [];
    this.controlLength = 0;
    this.packets = [];
    this.closed = false;
    this.closeReason = '';
    this.ready = false;
    this.peerVerified = false;
    this.stats = { controlSent: 0, controlReceived: 0, packetsSent: 0, packetsReceived: 0, packetsDropped: 0 };

    // Negotiated IDs are identical on both peers. No datachannel-event race.
    this.control = pc.createDataChannel('ikemen-control', {
      negotiated: true, id: controlId, ordered: true, protocol: 'pangyo-ikemen-v1',
    });
    this.rollback = pc.createDataChannel('ikemen-rollback', {
      negotiated: true, id: rollbackId, ordered: false, maxRetransmits: 0, protocol: 'pangyo-ggpo-v1',
    });
    for (const channel of [this.control, this.rollback]) {
      channel.binaryType = 'arraybuffer';
      channel.bufferedAmountLowThreshold = 64 * 1024;
      channel.addEventListener('close', () => this.close('channel closed'));
      channel.addEventListener('error', () => this.close('channel error'));
      channel.addEventListener('bufferedamountlow', () => this.dispatchEvent(new Event('writable')));
    }
    this.control.addEventListener('open', () => {
      this.control.send(JSON.stringify({ protocol: 1, buildId, role, nickname }));
      this.checkReady();
    });
    this.rollback.addEventListener('open', () => this.checkReady());
    this.control.addEventListener('message', event => this.receiveControl(event.data));
    this.rollback.addEventListener('message', event => this.receivePacket(event.data));
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close('peer connection ' + pc.connectionState);
    });
  }

  addEventListener(type, callback, options) {
    super.addEventListener(type, callback, options);
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    if (callback && !this.listeners.some(item => item.type === type && item.callback === callback && item.capture === capture)) {
      this.listeners.push({ type, callback, capture });
    }
  }

  removeEventListener(type, callback, options) {
    super.removeEventListener(type, callback, options);
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    this.listeners = this.listeners.filter(item => item.type !== type || item.callback !== callback || item.capture !== capture);
  }

  // Call only once Go.run has settled. A native process drops its callbacks on
  // exit; a WASM instance leaves JS functions behind that must never resume it.
  shutdownAfterEngineExit() {
    for (const item of this.listeners) super.removeEventListener(item.type, item.callback, item.capture);
    this.listeners.length = 0;
    if (globalThis.__ikemenRTC === this) delete globalThis.__ikemenRTC;
    this.close('engine exited');
  }

  checkReady() {
    if (!this.closed && !this.ready && this.peerVerified && this.control.readyState === 'open' && this.rollback.readyState === 'open') {
      this.ready = true;
      this.dispatchEvent(new Event('ready'));
    }
  }

  receiveControl(data) {
    if (this.closed) return;
    if (!this.peerVerified) {
      try {
        if (typeof data !== 'string' || data.length > 1024) throw new Error('missing transport hello');
        const hello = JSON.parse(data);
        if (hello.protocol !== 1 || hello.buildId !== this.buildId || hello.role === this.role || !['host', 'guest'].includes(hello.role)) {
          throw new Error('build or role mismatch');
        }
        if (typeof hello.nickname === 'string') {
          this.peerNickname = [...hello.nickname.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 16).join('');
        }
        this.peerVerified = true;
        this.checkReady();
      } catch (error) { this.close(error.message); }
      return;
    }
    if (!(data instanceof ArrayBuffer) || data.byteLength > 16384) return this.close('invalid control frame');
    if (this.controlLength + data.byteLength > this.maxControlBytes) return this.close('control receive overflow');
    if (!data.byteLength) return;
    this.controlChunks.push(new Uint8Array(data));
    this.controlLength += data.byteLength;
    this.stats.controlReceived += data.byteLength;
    this.dispatchEvent(new Event('control'));
  }

  receivePacket(data) {
    if (this.closed) return;
    // Channels are independently ordered; initial GGPO datagrams may precede the
    // reliable hello. Drop until verified; GGPO retries synchronization packets.
    if (!this.peerVerified) return;
    if (!(data instanceof ArrayBuffer) || data.byteLength < 1 || data.byteLength > 8192) return this.close('invalid rollback packet');
    if (this.packets.length >= this.maxPackets) {
      this.packets.shift();
      this.stats.packetsDropped++;
    }
    this.packets.push(new Uint8Array(data));
    this.stats.packetsReceived++;
    this.dispatchEvent(new Event('packet'));
  }

  // Exact-length read matches IKEMEN's scalar reads, which assume Read fills b.
  // null means wait; closed/closeReason distinguishes EOF from a pending read.
  readControl(length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.maxControlBytes) throw new RangeError('invalid read size');
    if (this.controlLength < length) return null;
    const result = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const chunk = this.controlChunks[0];
      const count = Math.min(chunk.length, length - offset);
      result.set(chunk.subarray(0, count), offset);
      if (count === chunk.length) this.controlChunks.shift();
      else this.controlChunks[0] = chunk.subarray(count);
      offset += count;
    }
    this.controlLength -= length;
    return result;
  }

  writeControl(bytes) {
    if (this.closed) throw new Error(this.closeReason || 'closed');
    if (!this.ready || this.control.bufferedAmount > 256 * 1024) return 0;
    if (!(bytes instanceof Uint8Array)) throw new TypeError('expected Uint8Array');
    // The Go net.Conn adapter must loop until every byte has been accepted.
    const count = Math.min(bytes.length, 16384);
    if (count) this.control.send(bytes.slice(0, count));
    this.stats.controlSent += count;
    return count;
  }

  readPacket() { return this.packets.shift() ?? null; }

  sendPacket(bytes) {
    if (this.closed) throw new Error(this.closeReason || 'closed');
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 8192) throw new RangeError('invalid packet');
    if (!this.ready || this.rollback.bufferedAmount > 64 * 1024) {
      this.stats.packetsDropped++;
      return false;
    }
    this.rollback.send(bytes);
    this.stats.packetsSent++;
    return true;
  }

  waitReady(timeoutMs = 15000) {
    if (this.ready) return Promise.resolve();
    if (this.closed) return Promise.reject(new Error(this.closeReason));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.removeEventListener('ready', onReady);
        this.removeEventListener('close', onClose);
      };
      const onReady = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); reject(new Error(this.closeReason)); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('WebRTC connection timed out')); }, timeoutMs);
      this.addEventListener('ready', onReady);
      this.addEventListener('close', onClose);
    });
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.closeReason = reason;
    this.control.close();
    this.rollback.close();
    this.pc.close();
    this.controlChunks.length = 0;
    this.controlLength = 0;
    this.packets.length = 0;
    this.dispatchEvent(new Event('close'));
  }
}
