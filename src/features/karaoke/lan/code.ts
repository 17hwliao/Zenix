import { KARAOKE_LIMITS } from '../contracts';
import {
  KARAOKE_LAN_LIMITS,
  lanFailure,
  lanOk,
  type KaraokeLanResult,
} from './types';

const ROOM_CODE_LENGTH = KARAOKE_LIMITS.roomCodeLength;

export function normalizeKaraokeRoomCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\s-]+/gu, '');
  return new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`, 'u').test(normalized)
    ? normalized
    : null;
}

export interface KaraokeRoomCodeCollisionGuard {
  reserve(roomCode: string): boolean;
  release(roomCode: string): void;
  has(roomCode: string): boolean;
}

export class InMemoryKaraokeRoomCodeGuard implements KaraokeRoomCodeCollisionGuard {
  private readonly reserved = new Set<string>();

  reserve(roomCode: string): boolean {
    const normalized = normalizeKaraokeRoomCode(roomCode);
    if (!normalized || this.reserved.has(normalized)) return false;
    this.reserved.add(normalized);
    return true;
  }

  release(roomCode: string): void {
    const normalized = normalizeKaraokeRoomCode(roomCode);
    if (normalized) this.reserved.delete(normalized);
  }

  has(roomCode: string): boolean {
    const normalized = normalizeKaraokeRoomCode(roomCode);
    return !!normalized && this.reserved.has(normalized);
  }
}

export interface KaraokeRoomCodeGenerationOptions {
  readonly guard?: KaraokeRoomCodeCollisionGuard;
  readonly attempts?: number;
  readonly nextDigit?: () => number;
}

function secureDigit(): number {
  const bytes = new Uint8Array(1);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random source unavailable');
  do {
    cryptoApi.getRandomValues(bytes);
  } while (bytes[0] >= 250);
  return bytes[0] % 10;
}

export function generateKaraokeRoomCode(
  options: KaraokeRoomCodeGenerationOptions = {},
): KaraokeLanResult<string> {
  const guard = options.guard ?? new InMemoryKaraokeRoomCodeGuard();
  const attempts = Math.max(1, Math.min(256, Math.floor(options.attempts ?? 64)));
  const nextDigit = options.nextDigit ?? secureDigit;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let code = '';
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      const digit = nextDigit();
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
        return lanFailure('INVALID_INPUT', '房间码随机源返回了无效数字', false);
      }
      code += String(digit);
    }
    if (guard.reserve(code)) return lanOk(code);
  }
  return lanFailure('ROOM_CODE_COLLISION', '无法生成未占用的六位房间码', true, {
    attempts,
  });
}

export interface KaraokeLanInviteData {
  readonly schema: 1;
  readonly kind: 'zenix-karaoke-invite';
  readonly roomId: string;
  readonly roomCode: string;
  readonly hostName: string;
  readonly expiresAtMs: number;
  readonly passwordRequired: boolean;
}

export interface KaraokeLanInvite {
  readonly data: KaraokeLanInviteData;
  readonly qrPayload: string;
  readonly shareText: string;
}

export interface KaraokeLanInviteInput {
  readonly roomId: string;
  readonly roomCode: string;
  readonly hostName: string;
  readonly expiresAtMs: number;
  readonly passwordRequired?: boolean;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

export function generateKaraokeLanInvite(
  input: KaraokeLanInviteInput,
): KaraokeLanResult<KaraokeLanInvite> {
  const roomId = boundedText(input?.roomId, KARAOKE_LAN_LIMITS.maxRoomIdLength);
  const roomCode = normalizeKaraokeRoomCode(input?.roomCode);
  const hostName = boundedText(input?.hostName, KARAOKE_LAN_LIMITS.maxDisplayNameLength);
  const expiresAtMs = input?.expiresAtMs;
  if (!roomId || !roomCode || !hostName
    || typeof expiresAtMs !== 'number'
    || !Number.isSafeInteger(expiresAtMs)
    || expiresAtMs <= 0) {
    return lanFailure('INVALID_INPUT', '邀请数据无效', false);
  }
  const data: KaraokeLanInviteData = Object.freeze({
    schema: 1,
    kind: 'zenix-karaoke-invite',
    roomId,
    roomCode,
    hostName,
    expiresAtMs,
    passwordRequired: input.passwordRequired === true,
  });
  const query = new URLSearchParams({
    v: '1',
    room: roomId,
    code: roomCode,
    host: hostName,
    expires: String(expiresAtMs),
    passwordRequired: data.passwordRequired ? '1' : '0',
  });
  const qrPayload = `zenix-karaoke://join?${query.toString()}`;
  return lanOk(Object.freeze({
    data,
    qrPayload,
    shareText: `加入 ${hostName} 的 K 歌房间 ${roomCode}\n${qrPayload}`,
  }));
}

export function parseKaraokeLanInvite(
  payload: unknown,
  nowMs = 0,
): KaraokeLanResult<KaraokeLanInviteData> {
  const source = boundedText(payload, 2048);
  if (!source) return lanFailure('INVALID_INPUT', '邀请载荷为空或过大', false);
  const embedded = source.match(/zenix-karaoke:\/\/join\?\S+/iu)?.[0] ?? source;
  let parsed: URL;
  try {
    parsed = new URL(embedded);
  } catch {
    return lanFailure('INVALID_INPUT', '邀请链接格式无效', false);
  }
  if (parsed.protocol !== 'zenix-karaoke:' || parsed.hostname !== 'join') {
    return lanFailure('INVALID_INPUT', '不是 Zenix K 歌邀请', false);
  }
  if (parsed.searchParams.get('v') !== '1') {
    return lanFailure('UNSUPPORTED_VERSION', '邀请版本不受支持', false);
  }
  const roomId = boundedText(
    parsed.searchParams.get('room'),
    KARAOKE_LAN_LIMITS.maxRoomIdLength,
  );
  const roomCode = normalizeKaraokeRoomCode(parsed.searchParams.get('code'));
  const hostName = boundedText(
    parsed.searchParams.get('host'),
    KARAOKE_LAN_LIMITS.maxDisplayNameLength,
  );
  const expiresAtMs = Number(parsed.searchParams.get('expires'));
  const passwordFlag = parsed.searchParams.get('passwordRequired');
  if (!roomId || !roomCode || !hostName
    || !Number.isSafeInteger(expiresAtMs)
    || expiresAtMs <= 0
    || (passwordFlag !== '0' && passwordFlag !== '1')) {
    return lanFailure('INVALID_INPUT', '邀请字段缺失或无效', false);
  }
  if (nowMs > 0 && nowMs >= expiresAtMs) {
    return lanFailure('INVITE_EXPIRED', '房间邀请已过期', false);
  }
  return lanOk(Object.freeze({
    schema: 1,
    kind: 'zenix-karaoke-invite',
    roomId,
    roomCode,
    hostName,
    expiresAtMs,
    passwordRequired: passwordFlag === '1',
  }));
}
