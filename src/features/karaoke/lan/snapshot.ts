import { KaraokeSession } from '../session';
import { deepFreezeClone } from '../immutable';
import type { KaraokeRoomState } from '../contracts';
import {
  parseKaraokeLanEnvelope,
  karaokeLanUtf8Bytes,
} from './protocol';
import {
  KARAOKE_LAN_LIMITS,
  lanFailure,
  lanOk,
  type KaraokeLanEnvelope,
  type KaraokeLanResult,
} from './types';

const FORBIDDEN_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'uri',
  'audiourl',
  'audio',
  'path',
  'filepath',
  'headers',
  'authorization',
  'profile',
  'personal',
  'playlist',
  'playlists',
  'settings',
]);

const SENSITIVE_STRING = /(?:https?:\/\/|file:\/\/|blob:|data:(?:audio|video)\/|bearer\s+|[?&]token=)/iu;

function containsForbiddenKey(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'string') return SENSITIVE_STRING.test(value);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenKey(item, seen));
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.replace(/[-_]/gu, '').toLowerCase())) return true;
    if (containsForbiddenKey(child, seen)) return true;
  }
  return false;
}

export interface KaraokeLanSnapshotPayload {
  readonly state: KaraokeRoomState;
  readonly hostSentMonotonicMs: number;
}

export interface KaraokeLanAcceptedSnapshot {
  readonly status: 'applied' | 'duplicate';
  readonly duplicate: boolean;
  readonly state: KaraokeRoomState;
  readonly sequence: number;
}

export class KaraokeLanSnapshotConsumer {
  private lastSequence = 0;
  private currentState: KaraokeRoomState | null = null;

  constructor(
    private readonly expected: {
      readonly roomId: string;
      readonly roomCode: string;
      readonly hostId: string;
      readonly memberId: string;
    },
  ) {}

  accept(
    input: KaraokeLanEnvelope | string,
  ): KaraokeLanResult<KaraokeLanAcceptedSnapshot> {
    const parsed = parseKaraokeLanEnvelope(input);
    if (!parsed.ok) return parsed;
    const envelope = parsed.value;
    if (envelope.source !== 'host'
      || envelope.senderId !== this.expected.hostId
      || envelope.recipientId !== this.expected.memberId
      || envelope.roomId !== this.expected.roomId
      || (envelope.type !== 'room.snapshot' && envelope.type !== 'room.closed')) {
      return lanFailure('SNAPSHOT_INVALID', '快照来源、房间或接收成员不匹配', false);
    }
    if (envelope.sequence <= this.lastSequence && this.currentState) {
      return lanOk(Object.freeze({
        status: 'duplicate' as const,
        duplicate: true,
        state: this.currentState,
        sequence: this.lastSequence,
      }));
    }
    const payload = envelope.payload as Partial<KaraokeLanSnapshotPayload>;
    if (!payload || typeof payload !== 'object'
      || !payload.state
      || typeof payload.hostSentMonotonicMs !== 'number'
      || !Number.isSafeInteger(payload.hostSentMonotonicMs)
      || payload.hostSentMonotonicMs < 0) {
      return lanFailure('SNAPSHOT_INVALID', '快照载荷无效', false);
    }
    if (containsForbiddenKey(payload.state)) {
      return lanFailure('SNAPSHOT_INVALID', '快照包含禁止传输的本地或授权字段', false);
    }
    let snapshotBytes: number;
    try {
      snapshotBytes = karaokeLanUtf8Bytes(JSON.stringify(payload.state));
    } catch {
      return lanFailure('SNAPSHOT_INVALID', '快照无法序列化', false);
    }
    if (snapshotBytes > KARAOKE_LAN_LIMITS.maxSnapshotBytes) {
      return lanFailure('SNAPSHOT_TOO_LARGE', '快照超过大小限制', false, {
        maxBytes: KARAOKE_LAN_LIMITS.maxSnapshotBytes,
      });
    }
    const restored = KaraokeSession.restore(payload.state);
    if (!restored.ok
      || restored.state.roomId !== this.expected.roomId
      || restored.state.roomCode !== this.expected.roomCode
      || restored.state.members.filter((member) => member.id === this.expected.hostId
        && member.role === 'host').length !== 1
      || restored.state.members.some((member) => member.id === this.expected.memberId)
        === false) {
      return lanFailure('SNAPSHOT_INVALID', '快照与已确认的房间、主持人或成员不一致', false);
    }
    if (payload.hostSentMonotonicMs !== restored.state.hostMonotonicMs
      || (envelope.type === 'room.closed' && restored.state.status !== 'closed')) {
      return lanFailure('SNAPSHOT_INVALID', '快照时钟或关闭状态不一致', false);
    }
    if (this.currentState?.status === 'closed' && restored.state.status !== 'closed') {
      return lanFailure('SNAPSHOT_INVALID', '已关闭房间不能由快照重新打开', false);
    }
    if (this.currentState && restored.state.revision < this.currentState.revision) {
      return lanFailure('STALE_SEQUENCE', '快照修订号倒退', true);
    }
    this.lastSequence = envelope.sequence;
    this.currentState = restored.state;
    return lanOk(Object.freeze({
      status: 'applied' as const,
      duplicate: false,
      state: restored.state,
      sequence: envelope.sequence,
    }));
  }

  get state(): KaraokeRoomState | null {
    return this.currentState;
  }

  get sequence(): number {
    return this.lastSequence;
  }
}

export interface KaraokeLanRecovery {
  readonly schema: 1;
  readonly kind: 'zenix-karaoke-recovery';
  readonly savedAtMs: number;
  readonly state: KaraokeRoomState;
}

export function serializeKaraokeLanRecovery(
  state: KaraokeRoomState,
  savedAtMs: number,
): KaraokeLanResult<KaraokeLanRecovery> {
  if (!Number.isSafeInteger(savedAtMs) || savedAtMs < 0 || containsForbiddenKey(state)) {
    return lanFailure('INVALID_INPUT', '恢复快照包含无效或禁止持久化的字段', false);
  }
  const restored = KaraokeSession.restore(state);
  if (!restored.ok) return lanFailure('SNAPSHOT_INVALID', restored.error.message, false);
  const recovery: KaraokeLanRecovery = Object.freeze({
    schema: 1,
    kind: 'zenix-karaoke-recovery',
    savedAtMs,
    state: restored.state,
  });
  let bytes: number;
  try {
    bytes = karaokeLanUtf8Bytes(JSON.stringify(recovery));
  } catch {
    return lanFailure('INVALID_INPUT', '恢复快照无法序列化', false);
  }
  return bytes <= KARAOKE_LAN_LIMITS.maxSnapshotBytes
    ? lanOk(recovery)
    : lanFailure('SNAPSHOT_TOO_LARGE', '恢复快照超过大小限制', false, {
      maxBytes: KARAOKE_LAN_LIMITS.maxSnapshotBytes,
    });
}

export function restoreKaraokeLanRecovery(
  value: unknown,
): KaraokeLanResult<KaraokeRoomState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return lanFailure('SNAPSHOT_INVALID', '恢复快照格式无效', false);
  }
  const recovery = value as Partial<KaraokeLanRecovery>;
  if (recovery.schema !== 1
    || recovery.kind !== 'zenix-karaoke-recovery'
    || !Number.isSafeInteger(recovery.savedAtMs)
    || (recovery.savedAtMs ?? -1) < 0
    || !recovery.state
    || containsForbiddenKey(value)) {
    return lanFailure('SNAPSHOT_INVALID', '恢复快照字段无效或包含敏感数据', false);
  }
  const restored = KaraokeSession.restore(recovery.state);
  return restored.ok
    ? lanOk(restored.state)
    : lanFailure('SNAPSHOT_INVALID', restored.error.message, false);
}
