import type { KaraokeRole } from '../contracts';
import { randomKaraokeLanToken } from './crypto';
import {
  KARAOKE_LAN_LIMITS,
  lanFailure,
  lanOk,
  type KaraokeLanAuthorization,
  type KaraokeLanCapability,
  type KaraokeLanResult,
} from './types';

const VALID_CAPABILITIES: readonly KaraokeLanCapability[] = Object.freeze([
  'room-control',
  'sing',
  'queue',
  'return-media',
]);

const ROLE_CAPABILITIES: Readonly<
  Record<KaraokeRole, readonly KaraokeLanCapability[]>
> = Object.freeze({
  host: Object.freeze(['room-control', 'sing', 'queue', 'return-media'] as const),
  singer: Object.freeze(['sing', 'queue', 'return-media'] as const),
  listener: Object.freeze(['return-media'] as const),
});

export function getKaraokeLanRoleCapabilities(
  role: KaraokeRole,
): readonly KaraokeLanCapability[] {
  return ROLE_CAPABILITIES[role] ?? ROLE_CAPABILITIES.listener;
}

export function isKaraokeLanCapability(
  value: unknown,
): value is KaraokeLanCapability {
  return typeof value === 'string'
    && (VALID_CAPABILITIES as readonly string[]).includes(value);
}

export interface KaraokeLanGrantInput {
  readonly roomId: string;
  readonly memberId: string;
  readonly role: KaraokeRole;
  readonly expiresAtMs: number;
}

interface StoredGrant {
  readonly authorization: KaraokeLanAuthorization;
  revoked: boolean;
}

export class KaraokeLanGrantService {
  private readonly grants = new Map<string, StoredGrant>();
  private readonly memberTokens = new Map<string, Set<string>>();

  issue(input: KaraokeLanGrantInput): KaraokeLanResult<KaraokeLanAuthorization> {
    const roomId = typeof input?.roomId === 'string' ? input.roomId.trim() : '';
    const memberId = typeof input?.memberId === 'string' ? input.memberId.trim() : '';
    const expiresAtMs = input?.expiresAtMs;
    if (!roomId || roomId.length > KARAOKE_LAN_LIMITS.maxRoomIdLength
      || !memberId || memberId.length > KARAOKE_LAN_LIMITS.maxClientIdLength
      || !['host', 'singer', 'listener'].includes(input?.role)
      || typeof expiresAtMs !== 'number'
      || !Number.isSafeInteger(expiresAtMs)
      || expiresAtMs <= 0) {
      return lanFailure('INVALID_INPUT', '房间授权参数无效', false);
    }
    const token = randomKaraokeLanToken(32);
    if (!token.ok) return token;
    const authorization: KaraokeLanAuthorization = Object.freeze({
      schema: 1,
      roomId,
      memberId,
      role: input.role,
      token: token.value,
      expiresAtMs,
      capabilities: Object.freeze([...getKaraokeLanRoleCapabilities(input.role)]),
    });
    this.grants.set(token.value, { authorization, revoked: false });
    const key = this.memberKey(roomId, memberId);
    const tokens = this.memberTokens.get(key) ?? new Set<string>();
    tokens.add(token.value);
    this.memberTokens.set(key, tokens);
    return lanOk(authorization);
  }

  validate(
    authorization: KaraokeLanAuthorization | string,
    roomId: string,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanAuthorization> {
    const token = typeof authorization === 'string' ? authorization : authorization?.token;
    if (typeof token !== 'string' || token.length < 24) {
      return lanFailure('TOKEN_INVALID', 'K 歌房间 token 无效', false);
    }
    const stored = this.grants.get(token);
    if (!stored || stored.revoked || stored.authorization.roomId !== roomId) {
      return lanFailure('TOKEN_INVALID', 'K 歌房间 token 不属于当前房间', false);
    }
    if (nowMs >= stored.authorization.expiresAtMs) {
      return lanFailure('TOKEN_EXPIRED', 'K 歌房间 token 已过期', false);
    }
    return lanOk(stored.authorization);
  }

  requireCapability(
    authorization: KaraokeLanAuthorization | string,
    roomId: string,
    capability: KaraokeLanCapability,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanAuthorization> {
    const valid = this.validate(authorization, roomId, nowMs);
    if (!valid.ok) return valid;
    if (!valid.value.capabilities.includes(capability)) {
      return lanFailure('PERMISSION_DENIED', '该 K 歌 token 不具备此房间权限', false, {
        capability,
      });
    }
    return valid;
  }

  revoke(token: string): boolean {
    const stored = this.grants.get(token);
    if (!stored) return false;
    stored.revoked = true;
    this.grants.delete(token);
    return true;
  }

  revokeMember(roomId: string, memberId: string): number {
    const tokens = this.memberTokens.get(this.memberKey(roomId, memberId));
    if (!tokens) return 0;
    let count = 0;
    for (const token of tokens) {
      const stored = this.grants.get(token);
      if (stored) {
        stored.revoked = true;
        this.grants.delete(token);
        count += 1;
      }
    }
    this.memberTokens.delete(this.memberKey(roomId, memberId));
    return count;
  }

  revokeRoom(roomId: string): number {
    let count = 0;
    for (const [token, stored] of this.grants) {
      if (stored.authorization.roomId === roomId) {
        stored.revoked = true;
        this.grants.delete(token);
        count += 1;
      }
    }
    for (const key of this.memberTokens.keys()) {
      if (key.startsWith(`${roomId}\u0000`)) this.memberTokens.delete(key);
    }
    return count;
  }

  private memberKey(roomId: string, memberId: string): string {
    return `${roomId}\u0000${memberId}`;
  }
}
