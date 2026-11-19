const prefix = 'zenix-karaoke-1';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_FRAME = 144 * 1024;
const MAX_CONTENT = 100 * 1024;

export function encodeKaraokeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeKaraokeBytes(value: unknown, expectedLength?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > MAX_FRAME || !/^[\w-]+$/u.test(value)) throw Error('K 歌连接编码无效');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if ((expectedLength !== undefined && bytes.byteLength !== expectedLength) || encodeKaraokeBytes(bytes) !== value) {
    throw Error('K 歌连接编码无效');
  }
  return bytes;
}

export function validKaraokeEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^((?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}):([1-9]\d{0,4})$/u.exec(value);
  if (!match || Number(match[2]) > 65535) return false;
  const [a, b, c, d] = match[1].split('.').map(Number);
  return [a, b, c, d].every(n => n <= 255)
    && (a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168);
}

export function parseKaraokeAddress(value: string): { endpoint: string; publicKey: string } {
  const [endpoint, publicKey, extra] = value.trim().split('#');
  if (extra !== undefined || !validKaraokeEndpoint(endpoint) || !publicKey) throw Error('请复制房主显示的完整局域网地址');
  decodeKaraokeBytes(publicKey, 65);
  return { endpoint, publicKey };
}

export interface KaraokeHandshakeKey {
  secret: CryptoKey;
  publicKey: string;
}

export async function createKaraokeHandshakeKey(): Promise<KaraokeHandshakeKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return {
    secret: pair.privateKey,
    publicKey: encodeKaraokeBytes(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
  };
}

export function makeKaraokeChallenge(): string {
  return encodeKaraokeBytes(crypto.getRandomValues(new Uint8Array(24)));
}

export class KaraokeSecureChannel {
  private sent = 0;
  private received = 0;

  private constructor(
    private readonly outgoing: CryptoKey,
    private readonly incoming: CryptoKey,
  ) {}

  static async create(
    side: 'host' | 'guest',
    local: KaraokeHandshakeKey,
    remoteKey: string,
    challenge: string,
  ): Promise<KaraokeSecureChannel> {
    const remote = await crypto.subtle.importKey('raw', decodeKaraokeBytes(remoteKey, 65), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: remote }, local.secret, 256);
    const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const hostKey = side === 'host' ? local.publicKey : remoteKey;
    const guestKey = side === 'guest' ? local.publicKey : remoteKey;
    const salt = decodeKaraokeBytes(challenge, 24);
    const derive = (direction: string) => crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode([prefix, direction, hostKey, guestKey].join('|')) },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
    const [host, guest] = await Promise.all([derive('host'), derive('guest')]);
    return side === 'host' ? new KaraokeSecureChannel(host, guest) : new KaraokeSecureChannel(guest, host);
  }

  private iv(sequence: number): Uint8Array<ArrayBuffer> {
    const value = new Uint8Array(12);
    new DataView(value.buffer).setBigUint64(4, BigInt(sequence));
    return value;
  }

  async seal(value: unknown): Promise<string> {
    const bytes = encoder.encode(JSON.stringify(value));
    if (bytes.byteLength > MAX_CONTENT || this.sent >= Number.MAX_SAFE_INTEGER) throw Error('K 歌消息超出连接上限');
    const result = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: this.iv(++this.sent) }, this.outgoing, bytes);
    return encodeKaraokeBytes(new Uint8Array(result));
  }

  async open(value: string): Promise<Record<string, unknown>> {
    const bytes = decodeKaraokeBytes(value);
    if (bytes.byteLength < 16 || bytes.byteLength > MAX_CONTENT + 16 || this.received >= Number.MAX_SAFE_INTEGER) throw Error('K 歌消息长度无效');
    const next = this.received + 1;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.iv(next) }, this.incoming, bytes);
    const parsed: unknown = JSON.parse(decoder.decode(plain));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('K 歌消息格式无效');
    this.received = next;
    return parsed as Record<string, unknown>;
  }
}
