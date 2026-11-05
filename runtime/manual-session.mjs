import { IkemenRTCBridge } from './rtc-bridge.mjs';

const prefix = 'PGRTC1.';
const maxCodeLength = 131072;

async function pack(value) {
  const text = JSON.stringify(value);
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return prefix + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function unpack(code) {
  code = code.trim();
  if (!code.startsWith(prefix) || code.length > maxCodeLength || !/^[A-Za-z0-9_-]+$/.test(code.slice(prefix.length))) {
    throw new Error('Invalid connection code');
  }
  const binary = atob(code.slice(prefix.length).replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new Error('Connection code is too large'); }
    chunks.push(value);
  }
  return JSON.parse(await new Blob(chunks).text());
}

function waitForICE(pc, timeoutMs = 20000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', changed); };
    const changed = () => {
      if (pc.iceGatheringState === 'complete') { cleanup(); resolve(); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('ICE gathering timed out; retry without STUN or check the network')); }, timeoutMs);
    pc.addEventListener('icegatheringstatechange', changed);
  });
}

// One session = one host and one guest. No server, account, or automatic room
// discovery. The caller may supply STUN/TURN servers; none are contacted by default.
export class ManualIkemenSession {
  constructor({ role, buildId, iceServers = [], nickname = '' }) {
    this.role = role;
    this.buildId = buildId;
    this.nickname = [...String(nickname)].slice(0, 16).join('');
    this.peerNickname = '';
    this.pc = new RTCPeerConnection({ iceServers });
    this.bridge = new IkemenRTCBridge(this.pc, { role, buildId });
    this.bridge.addEventListener('close', () => {
      if (globalThis.__ikemenRTC === this.bridge) delete globalThis.__ikemenRTC;
    });
  }

  async code() {
    await waitForICE(this.pc);
    return pack({ protocol: 1, buildId: this.buildId, nickname: this.nickname, description: this.pc.localDescription.toJSON() });
  }

  async decode(code, expectedType) {
    const info = await unpack(code);
    if (info.protocol !== 1 || info.buildId !== this.buildId) throw new Error('Both players must use the same game build');
    if (info.description?.type !== expectedType || typeof info.description.sdp !== 'string') throw new Error('Wrong connection code type');
    this.peerNickname = typeof info.nickname === 'string' ? [...info.nickname].slice(0, 16).join('') : '';
    return info.description;
  }

  async createOfferCode() {
    if (this.role !== 'host') throw new Error('Only the host creates an offer');
    await this.pc.setLocalDescription(await this.pc.createOffer());
    return this.code();
  }

  async acceptOfferCode(code) {
    if (this.role !== 'guest') throw new Error('Only the guest accepts an offer');
    await this.pc.setRemoteDescription(await this.decode(code, 'offer'));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    return this.code();
  }

  async acceptAnswerCode(code) {
    if (this.role !== 'host') throw new Error('Only the host accepts an answer');
    await this.pc.setRemoteDescription(await this.decode(code, 'answer'));
  }

  async attachEngine(timeoutMs = 30000) {
    await this.bridge.waitReady(timeoutMs);
    if (this.bridge.closed || !this.bridge.ready) throw new Error('Connection closed before engine attachment');
    globalThis.__ikemenRTC = this.bridge;
    return this.bridge;
  }

  close() {
    this.bridge.close('session closed');
    if (globalThis.__ikemenRTC === this.bridge) delete globalThis.__ikemenRTC;
  }
}
