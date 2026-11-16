import type { KaraokeRole } from '../contracts';

export const KARAOKE_LAN_PROTOCOL = 'zenix.karaoke.lan' as const;
export const KARAOKE_LAN_PROTOCOL_VERSION = 1 as const;

export const KARAOKE_LAN_LIMITS = Object.freeze({
  maxMembers: 4,
  maxPendingJoins: 12,
  maxMediaSessions: 4,
  maxMessageBytes: 96 * 1024,
  maxSnapshotBytes: 64 * 1024,
  maxDisplayNameLength: 40,
  maxRoomIdLength: 128,
  maxClientIdLength: 128,
  maxPasswordLength: 128,
  eventRateLimit: 20,
  eventRateWindowMs: 10_000,
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 15_000,
  maxReconnectAttempts: 5,
  reconnectBaseDelayMs: 250,
  reconnectMaxDelayMs: 4_000,
  defaultInviteLifetimeMs: 10 * 60_000,
  defaultTokenLifetimeMs: 4 * 60 * 60_000,
  disconnectGraceMs: 60_000,
});

export type KaraokeLanErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_ENVELOPE'
  | 'UNSUPPORTED_VERSION'
  | 'MESSAGE_TOO_LARGE'
  | 'SNAPSHOT_TOO_LARGE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_NOT_STARTED'
  | 'ROOM_CLOSED'
  | 'ROOM_FULL'
  | 'PENDING_LIMIT'
  | 'DUPLICATE_JOIN'
  | 'JOIN_REJECTED'
  | 'JOIN_ALREADY_RESOLVED'
  | 'WRONG_PASSWORD'
  | 'INVITE_EXPIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'HOST_REQUIRED'
  | 'MEMBER_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'STALE_SEQUENCE'
  | 'SNAPSHOT_INVALID'
  | 'RECONNECT_EXHAUSTED'
  | 'INVALID_TRANSITION'
  | 'QUEUE_FULL'
  | 'LIMIT_EXCEEDED'
  | 'ROOM_CODE_COLLISION'
  | 'MEDIA_UNAVAILABLE';

export type KaraokeLanErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface KaraokeLanError {
  readonly code: KaraokeLanErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: KaraokeLanErrorDetails;
}

export type KaraokeLanResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: KaraokeLanError }>;

export function lanOk<T>(value: T): KaraokeLanResult<T> {
  return Object.freeze({ ok: true as const, value });
}

export function lanFailure<T = never>(
  code: KaraokeLanErrorCode,
  message: string,
  recoverable = true,
  details?: KaraokeLanErrorDetails,
): KaraokeLanResult<T> {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code,
      message,
      recoverable,
      ...(details ? { details: Object.freeze({ ...details }) } : {}),
    }),
  });
}

export type KaraokeLanCapability =
  | 'room-control'
  | 'sing'
  | 'queue'
  | 'return-media';

export interface KaraokeLanAuthorization {
  readonly schema: 1;
  readonly roomId: string;
  readonly memberId: string;
  readonly role: KaraokeRole;
  readonly token: string;
  readonly expiresAtMs: number;
  readonly capabilities: readonly KaraokeLanCapability[];
}

export type KaraokeLanEnvelopeType =
  | 'join.request'
  | 'join.pending'
  | 'join.approve'
  | 'join.reject'
  | 'join.approved'
  | 'join.rejected'
  | 'room.snapshot'
  | 'room.error'
  | 'room.closed'
  | 'member.ready'
  | 'queue.add'
  | 'queue.remove'
  | 'session.leave'
  | 'clock.sample'
  | 'clock.ping'
  | 'clock.pong'
  | 'heartbeat.ping'
  | 'heartbeat.ack';

export interface KaraokeLanEnvelope<T = unknown> {
  readonly schema: 1;
  readonly protocol: typeof KARAOKE_LAN_PROTOCOL;
  readonly version: typeof KARAOKE_LAN_PROTOCOL_VERSION;
  readonly type: KaraokeLanEnvelopeType;
  readonly source: 'client' | 'host';
  readonly roomId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly sequence: number;
  readonly sentAtMs: number;
  readonly payload: T;
}

export interface KaraokeLanPendingJoin {
  readonly schema: 1;
  readonly pendingId: string;
  readonly roomId: string;
  readonly roomCode: string;
  readonly clientNonce: string;
  readonly displayName: string;
  readonly requestedAtMs: number;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly memberId?: string;
}

export interface KaraokeLanHostStartResult {
  readonly authorization: KaraokeLanAuthorization;
  readonly roomId: string;
  readonly roomCode: string;
  readonly inviteExpiresAtMs: number;
  readonly invite: {
    readonly data: Readonly<{
      readonly schema: 1;
      readonly kind: 'zenix-karaoke-invite';
      readonly roomId: string;
      readonly roomCode: string;
      readonly hostName: string;
      readonly expiresAtMs: number;
      readonly passwordRequired: boolean;
    }>;
    readonly qrPayload: string;
    readonly shareText: string;
  };
}

export interface KaraokeLanApprovalResult {
  readonly authorization: KaraokeLanAuthorization;
  readonly memberId: string;
  readonly displayName: string;
  readonly pendingId: string;
}

export interface KaraokeLanJoinRequest {
  readonly roomCode: string;
  readonly displayName: string;
  readonly clientNonce: string;
  readonly password?: string;
  readonly inviteExpiresAtMs?: number;
}

export interface KaraokeLanControlResponse {
  readonly status: 'applied' | 'duplicate' | 'rejected';
  readonly duplicate: boolean;
  readonly type: KaraokeLanEnvelopeType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface KaraokeLanClockSample {
  readonly sampleId: string;
  readonly clientSendMs: number;
  readonly serverReceiveMs: number;
  readonly serverSendMs: number;
  readonly roundTripMs: number;
  readonly offsetMs: number;
}
