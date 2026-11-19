import {
  KARAOKE_LAN_LIMITS,
  KARAOKE_LAN_PROTOCOL,
  KARAOKE_LAN_PROTOCOL_VERSION,
  lanFailure,
  lanOk,
  type KaraokeLanClockSample,
  type KaraokeLanEnvelope,
  type KaraokeLanEnvelopeType,
  type KaraokeLanError,
  type KaraokeLanResult,
} from './types';

const ENVELOPE_TYPES = new Set<KaraokeLanEnvelopeType>([
  'join.request',
  'join.pending',
  'join.approve',
  'join.reject',
  'join.approved',
  'join.rejected',
  'room.snapshot',
  'room.error',
  'room.closed',
  'member.ready',
  'queue.add',
  'queue.remove',
  'score.line',
  'session.leave',
  'clock.sample',
  'clock.ping',
  'clock.pong',
  'heartbeat.ping',
  'heartbeat.ack',
]);

const encoder = new TextEncoder();

export function karaokeLanUtf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function validIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function createKaraokeLanEnvelope<T>(input: {
  readonly type: KaraokeLanEnvelopeType;
  readonly source: 'client' | 'host';
  readonly roomId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly sequence: number;
  readonly sentAtMs: number;
  readonly payload: T;
}): KaraokeLanResult<KaraokeLanEnvelope<T>> {
  if (!ENVELOPE_TYPES.has(input?.type)
    || (input?.source !== 'client' && input?.source !== 'host')
    || !validIdentifier(input?.roomId, KARAOKE_LAN_LIMITS.maxRoomIdLength)
    || !validIdentifier(input?.senderId, KARAOKE_LAN_LIMITS.maxClientIdLength)
    || !validIdentifier(input?.recipientId, KARAOKE_LAN_LIMITS.maxClientIdLength)
    || !Number.isSafeInteger(input?.sequence)
    || input.sequence < 1
    || !validTimestamp(input?.sentAtMs)) {
    return lanFailure('INVALID_ENVELOPE', '控制面消息 envelope 无效', false);
  }
  return lanOk(Object.freeze({
    schema: 1 as const,
    protocol: KARAOKE_LAN_PROTOCOL,
    version: KARAOKE_LAN_PROTOCOL_VERSION,
    type: input.type,
    source: input.source,
    roomId: input.roomId,
    senderId: input.senderId,
    recipientId: input.recipientId,
    sequence: input.sequence,
    sentAtMs: input.sentAtMs,
    payload: input.payload,
  }));
}

export function parseKaraokeLanEnvelope(
  raw: string | unknown,
  maxBytes = KARAOKE_LAN_LIMITS.maxMessageBytes,
): KaraokeLanResult<KaraokeLanEnvelope> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (karaokeLanUtf8Bytes(raw) > maxBytes) {
      return lanFailure('MESSAGE_TOO_LARGE', '控制面消息超过大小限制', false, {
        maxBytes,
      });
    }
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return lanFailure('INVALID_ENVELOPE', '控制面消息不是有效 JSON', false);
    }
  } else if (raw && typeof raw === 'object') {
    let serialized: string;
    try {
      serialized = JSON.stringify(raw);
    } catch {
      return lanFailure('INVALID_ENVELOPE', '控制面消息无法序列化', false);
    }
    if (karaokeLanUtf8Bytes(serialized) > maxBytes) {
      return lanFailure('MESSAGE_TOO_LARGE', '控制面消息超过大小限制', false, {
        maxBytes,
      });
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return lanFailure('INVALID_ENVELOPE', '控制面消息必须是对象', false);
  }
  const envelope = value as Partial<KaraokeLanEnvelope>;
  if (envelope.protocol !== KARAOKE_LAN_PROTOCOL) {
    return lanFailure('INVALID_ENVELOPE', '控制面协议标识无效', false);
  }
  if (envelope.version !== KARAOKE_LAN_PROTOCOL_VERSION) {
    return lanFailure('UNSUPPORTED_VERSION', '控制面协议版本不受支持', false);
  }
  if (envelope.schema !== 1
    || !ENVELOPE_TYPES.has(envelope.type as KaraokeLanEnvelopeType)
    || (envelope.source !== 'client' && envelope.source !== 'host')
    || !validIdentifier(envelope.roomId, KARAOKE_LAN_LIMITS.maxRoomIdLength)
    || !validIdentifier(envelope.senderId, KARAOKE_LAN_LIMITS.maxClientIdLength)
    || !validIdentifier(envelope.recipientId, KARAOKE_LAN_LIMITS.maxClientIdLength)
    || !Number.isSafeInteger(envelope.sequence)
    || (envelope.sequence ?? 0) < 1
    || !validTimestamp(envelope.sentAtMs)
    || !envelope.payload
    || typeof envelope.payload !== 'object'
    || Array.isArray(envelope.payload)) {
    return lanFailure('INVALID_ENVELOPE', '控制面消息字段无效', false);
  }
  return lanOk(Object.freeze({
    schema: 1 as const,
    protocol: KARAOKE_LAN_PROTOCOL,
    version: KARAOKE_LAN_PROTOCOL_VERSION,
    type: envelope.type as KaraokeLanEnvelopeType,
    source: envelope.source,
    roomId: envelope.roomId,
    senderId: envelope.senderId,
    recipientId: envelope.recipientId,
    sequence: envelope.sequence as number,
    sentAtMs: envelope.sentAtMs,
    payload: envelope.payload,
  }));
}

export function serializeKaraokeLanEnvelope(
  envelope: KaraokeLanEnvelope,
  maxBytes = KARAOKE_LAN_LIMITS.maxMessageBytes,
): KaraokeLanResult<string> {
  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch {
    return lanFailure('INVALID_ENVELOPE', '控制面消息无法序列化', false);
  }
  return karaokeLanUtf8Bytes(serialized) <= maxBytes
    ? lanOk(serialized)
    : lanFailure('MESSAGE_TOO_LARGE', '控制面消息超过大小限制', false, {
      maxBytes,
    });
}

export function createKaraokeLanErrorEnvelopePayload(
  error: KaraokeLanError,
): Readonly<{
  code: KaraokeLanError['code'];
  message: string;
  recoverable: boolean;
  details?: KaraokeLanError['details'];
}> {
  return Object.freeze({
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    ...(error.details ? { details: error.details } : {}),
  });
}

export class KaraokeLanRateLimiter {
  private readonly events = new Map<string, number[]>();

  constructor(
    private readonly limit: number = KARAOKE_LAN_LIMITS.eventRateLimit,
    private readonly windowMs = KARAOKE_LAN_LIMITS.eventRateWindowMs,
  ) {}

  consume(key: string, nowMs: number): KaraokeLanResult<number> {
    if (!key || !Number.isSafeInteger(nowMs) || nowMs < 0) {
      return lanFailure('INVALID_INPUT', '限流键或时间无效', false);
    }
    const cutoff = nowMs - this.windowMs;
    const existing = this.events.get(key) ?? [];
    const active = existing.filter((at) => at > cutoff);
    if (active.length >= this.limit) {
      this.events.set(key, active);
      return lanFailure('RATE_LIMITED', '控制面消息发送过快', true, {
        retryAfterMs: (active[0] ?? nowMs) + this.windowMs - nowMs,
      });
    }
    active.push(nowMs);
    this.events.set(key, active.slice(-this.limit));
    if (this.events.size > 256) {
      for (const [candidate, samples] of this.events) {
        if (samples.every((at) => at <= cutoff)) this.events.delete(candidate);
        if (this.events.size <= 192) break;
      }
    }
    return lanOk(this.limit - active.length);
  }
}

export class KaraokeLanReconnectPolicy {
  private used = 0;

  constructor(
    private readonly maxAttempts = KARAOKE_LAN_LIMITS.maxReconnectAttempts,
    private readonly baseDelayMs = KARAOKE_LAN_LIMITS.reconnectBaseDelayMs,
    private readonly maxDelayMs = KARAOKE_LAN_LIMITS.reconnectMaxDelayMs,
  ) {}

  fail(): KaraokeLanResult<{
    readonly attempt: number;
    readonly delayMs: number;
    readonly exhausted: boolean;
  }> {
    if (this.used >= this.maxAttempts) {
      return lanFailure('RECONNECT_EXHAUSTED', '重连次数已用尽', false, {
        maxAttempts: this.maxAttempts,
      });
    }
    this.used += 1;
    const delayMs = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * (2 ** (this.used - 1)),
    );
    return lanOk(Object.freeze({
      attempt: this.used,
      delayMs,
      exhausted: this.used >= this.maxAttempts,
    }));
  }

  reset(): void {
    this.used = 0;
  }

  get attempts(): number {
    return this.used;
  }
}

export function createKaraokeLanClockSample(input: {
  readonly sampleId: string;
  readonly clientSendMs: number;
  readonly serverReceiveMs: number;
  readonly serverSendMs: number;
}): KaraokeLanResult<KaraokeLanClockSample> {
  if (!validIdentifier(input?.sampleId, KARAOKE_LAN_LIMITS.maxClientIdLength)
    || !validTimestamp(input?.clientSendMs)
    || !validTimestamp(input?.serverReceiveMs)
    || !validTimestamp(input?.serverSendMs)
    || input.serverSendMs < input.serverReceiveMs) {
    return lanFailure('INVALID_INPUT', '时钟采样参数无效', false);
  }
  const roundTripMs = input.serverSendMs - input.clientSendMs;
  const offsetMs = input.serverReceiveMs - (
    input.clientSendMs + roundTripMs / 2
  );
  return lanOk(Object.freeze({
    sampleId: input.sampleId,
    clientSendMs: input.clientSendMs,
    serverReceiveMs: input.serverReceiveMs,
    serverSendMs: input.serverSendMs,
    roundTripMs,
    offsetMs,
  }));
}
