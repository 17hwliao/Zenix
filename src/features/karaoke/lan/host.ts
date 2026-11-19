import {
  KARAOKE_LIMITS,
  type KaraokeClientEvent,
  type KaraokeQueueMode,
  type KaraokeRole,
  type KaraokeRoomState,
} from '../contracts';
import { deepFreezeClone, frozenArray } from '../immutable';
import {
  KaraokeSession,
  type KaraokeSessionResult,
} from '../session';
import type { KaraokeErrorCode } from '../result';
import { KaraokeLanGrantService } from './auth';
import {
  generateKaraokeLanInvite,
  generateKaraokeRoomCode,
  InMemoryKaraokeRoomCodeGuard,
  normalizeKaraokeRoomCode,
  type KaraokeLanInvite,
  type KaraokeRoomCodeCollisionGuard,
} from './code';
import { randomKaraokeLanId } from './crypto';
import { nextBattleState, resetBattleState } from './battle';
import { normalizeScoreLine } from './score';
import { isPublicKaraokeText, karaokeSongSummary } from '../song-summary';
import {
  KaraokeLanMediaManager,
  type KaraokeMediaAdapterFactory,
} from './media';
import {
  createKaraokeLanClockSample,
  createKaraokeLanEnvelope,
  createKaraokeLanErrorEnvelopePayload,
  karaokeLanUtf8Bytes,
  KaraokeLanRateLimiter,
  KaraokeLanReconnectPolicy,
  parseKaraokeLanEnvelope,
} from './protocol';
import {
  KARAOKE_LAN_LIMITS,
  lanFailure,
  lanOk,
  type KaraokeLanApprovalResult,
  type KaraokeLanAuthorization,
  type KaraokeLanControlResponse,
  type KaraokeLanEnvelope,
  type KaraokeLanEnvelopeType,
  type KaraokeLanError,
  type KaraokeLanHostStartResult,
  type KaraokeLanJoinRequest,
  type KaraokeLanPendingJoin,
  type KaraokeLanResult,
} from './types';

const HOST_EVENT_TYPES = new Set<KaraokeLanEnvelopeType>([
  'join.pending',
  'join.approved',
  'join.rejected',
  'room.snapshot',
  'room.error',
  'room.closed',
  'clock.pong',
  'heartbeat.ack',
]);

const MEMBER_EVENT_TYPES = new Set<KaraokeLanEnvelopeType>([
  'member.ready',
  'queue.add',
  'queue.remove',
  'score.line',
  'session.leave',
  'clock.sample',
  'clock.ping',
  'heartbeat.ping',
]);

export interface KaraokeLanHostCreateInput {
  readonly hostId: string;
  readonly hostDisplayName: string;
  readonly nowMs: number;
  readonly roomId?: string;
  readonly roomCode?: string;
  readonly joinPassword?: string;
  readonly inviteLifetimeMs?: number;
  readonly tokenLifetimeMs?: number;
  readonly codeGuard?: KaraokeRoomCodeCollisionGuard;
  readonly mediaAdapter?: KaraokeMediaAdapterFactory;
}

interface PendingEntry {
  pending: KaraokeLanPendingJoin;
}

interface CachedControl {
  readonly sequence: number;
  readonly response: KaraokeLanControlResponse;
}

interface MemberRuntime {
  readonly authorization: KaraokeLanAuthorization;
  readonly reconnect: KaraokeLanReconnectPolicy;
  disconnectedAtMs?: number;
  lastSeenAtMs: number;
}

type HostListener = (event: KaraokeLanEnvelope) => void;

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeRecordingId(value: unknown): string | null {
  const id = boundedText(value, 256);
  if (!id
    || /[\s/\\?#&=]/u.test(id)
    || /^[a-z][a-z0-9+.-]*:\/\//iu.test(id)
    || /^(?:file|data|blob):/iu.test(id)) return null;
  return id;
}

function mapSessionError(code: KaraokeErrorCode): KaraokeLanError['code'] {
  switch (code) {
    case 'ROOM_FULL':
    case 'QUEUE_FULL':
    case 'MEMBER_NOT_FOUND':
    case 'HOST_REQUIRED':
    case 'INVALID_TRANSITION':
    case 'LIMIT_EXCEEDED':
    case 'ITEM_NOT_FOUND':
      return code;
    case 'DUPLICATE_ID':
      return 'DUPLICATE_JOIN';
    default:
      return 'INVALID_INPUT';
  }
}

export class KaraokeLanHost {
  private lifecycle: 'created' | 'started' | 'stopped' = 'created';
  private readonly pending = new Map<string, PendingEntry>();
  private readonly nonceToPending = new Map<string, string>();
  private readonly members = new Map<string, MemberRuntime>();
  private readonly subscribers = new Map<string, Set<HostListener>>();
  private readonly outgoingSequences = new Map<string, number>();
  private readonly incomingSequences = new Map<string, number>();
  private readonly generatedClientSequences = new Map<string, number>();
  private readonly cachedControls = new Map<string, CachedControl>();
  private readonly rateLimiter = new KaraokeLanRateLimiter();
  private readonly scoreRateLimiter = new KaraokeLanRateLimiter(KARAOKE_LAN_LIMITS.scoreEventRateLimit, KARAOKE_LAN_LIMITS.eventRateWindowMs);
  private readonly submittedLineKeys = new Set<string>();
  private hostAuthorization: KaraokeLanAuthorization;

  private constructor(
    private session: KaraokeSession,
    private readonly hostId: string,
    private readonly hostDisplayName: string,
    private readonly roomId: string,
    private readonly roomCode: string,
    private readonly inviteExpiresAtMs: number,
    private readonly tokenLifetimeMs: number,
    private readonly joinPassword: string,
    private readonly codeGuard: KaraokeRoomCodeCollisionGuard,
    private readonly mediaManager: KaraokeLanMediaManager | undefined,
    private readonly grants: KaraokeLanGrantService,
    hostAuthorization: KaraokeLanAuthorization,
  ) {
    this.hostAuthorization = hostAuthorization;
  }

  static create(input: KaraokeLanHostCreateInput): KaraokeLanResult<KaraokeLanHost> {
    const hostId = boundedText(input?.hostId, KARAOKE_LAN_LIMITS.maxClientIdLength);
    const hostDisplayName = boundedText(
      input?.hostDisplayName,
      KARAOKE_LAN_LIMITS.maxDisplayNameLength,
    );
    if (!hostId || !hostDisplayName || !isPublicKaraokeText(hostDisplayName, KARAOKE_LAN_LIMITS.maxDisplayNameLength) || !validTime(input?.nowMs)) {
      return lanFailure('INVALID_INPUT', '主持人或启动时间无效', false);
    }
    if (input.joinPassword !== undefined && typeof input.joinPassword !== 'string') {
      return lanFailure('INVALID_INPUT', '房间加入密码无效', false);
    }
    const joinPassword = input.joinPassword ?? '';
    if (joinPassword.length > KARAOKE_LAN_LIMITS.maxPasswordLength) {
      return lanFailure('INVALID_INPUT', '房间加入密码过长', false);
    }
    if (input.inviteLifetimeMs !== undefined
      && (!Number.isFinite(input.inviteLifetimeMs) || input.inviteLifetimeMs <= 0)) {
      return lanFailure('INVALID_INPUT', '邀请有效期无效', false);
    }
    if (input.tokenLifetimeMs !== undefined
      && (!Number.isFinite(input.tokenLifetimeMs) || input.tokenLifetimeMs <= 0)) {
      return lanFailure('INVALID_INPUT', '房间 token 有效期无效', false);
    }
    const inviteLifetimeMs = Math.max(
      1_000,
      Math.min(
        24 * 60 * 60_000,
        Math.floor(input.inviteLifetimeMs ?? KARAOKE_LAN_LIMITS.defaultInviteLifetimeMs),
      ),
    );
    const tokenLifetimeMs = Math.max(
      60_000,
      Math.min(
        7 * 24 * 60 * 60_000,
        Math.floor(input.tokenLifetimeMs ?? KARAOKE_LAN_LIMITS.defaultTokenLifetimeMs),
      ),
    );
    const guard = input.codeGuard ?? new InMemoryKaraokeRoomCodeGuard();
    let roomCode: string;
    if (input.roomCode !== undefined) {
      const normalized = normalizeKaraokeRoomCode(input.roomCode);
      if (!normalized) return lanFailure('INVALID_INPUT', '房间码必须是六位数字', false);
      if (!guard.reserve(normalized)) {
        return lanFailure('ROOM_CODE_COLLISION', '六位房间码已被占用', true);
      }
      roomCode = normalized;
    } else {
      const generated = generateKaraokeRoomCode({ guard });
      if (!generated.ok) return generated;
      roomCode = generated.value;
    }
    let roomId = input.roomId?.trim();
    if (!roomId) {
      const generatedRoomId = randomKaraokeLanId('karaoke-room');
      if (!generatedRoomId.ok) {
        guard.release(roomCode);
        return generatedRoomId;
      }
      roomId = generatedRoomId.value;
    }
    if (!roomId || roomId.length > KARAOKE_LAN_LIMITS.maxRoomIdLength) {
      guard.release(roomCode);
      return lanFailure('INVALID_INPUT', '房间 ID 无效', false);
    }
    const created = KaraokeSession.create({
      roomId,
      roomCode,
      hostId,
      hostDisplayName,
      nowMs: input.nowMs,
    });
    if (!created.ok) {
      guard.release(roomCode);
      return lanFailure(mapSessionError(created.error.code), created.error.message, false);
    }
    const grants = new KaraokeLanGrantService();
    const hostAuthorization = grants.issue({
      roomId,
      memberId: hostId,
      role: 'host',
      expiresAtMs: input.nowMs + tokenLifetimeMs,
    });
    if (!hostAuthorization.ok) {
      guard.release(roomCode);
      return hostAuthorization;
    }
    const host = new KaraokeLanHost(
      created.session,
      hostId,
      hostDisplayName,
      roomId,
      roomCode,
      input.nowMs + inviteLifetimeMs,
      tokenLifetimeMs,
      joinPassword,
      guard,
      input.mediaAdapter
        ? new KaraokeLanMediaManager(input.mediaAdapter, grants)
        : undefined,
      grants,
      hostAuthorization.value,
    );
    return lanOk(host);
  }

  get state(): KaraokeRoomState {
    return this.session.state;
  }

  get id(): string {
    return this.roomId;
  }

  get code(): string {
    return this.roomCode;
  }

  get status(): 'created' | 'started' | 'stopped' {
    return this.lifecycle;
  }

  get media(): KaraokeLanMediaManager | undefined {
    return this.mediaManager;
  }

  start(nowMs: number): KaraokeLanResult<KaraokeLanHostStartResult> {
    if (this.lifecycle === 'stopped') {
      return lanFailure('ROOM_CLOSED', 'K 歌房间已停止', false);
    }
    if (!validTime(nowMs)) return lanFailure('INVALID_INPUT', '启动时间无效', false);
    if (nowMs >= this.inviteExpiresAtMs) {
      return lanFailure('INVITE_EXPIRED', '房间邀请已过期，请重新创建房间', false);
    }
    if (this.lifecycle === 'created') this.lifecycle = 'started';
    const invite = generateKaraokeLanInvite({
      roomId: this.roomId,
      roomCode: this.roomCode,
      hostName: this.hostDisplayName,
      expiresAtMs: this.inviteExpiresAtMs,
      passwordRequired: !!this.joinPassword,
    });
    if (!invite.ok) return invite;
    return lanOk(Object.freeze({
      authorization: this.hostAuthorization,
      roomId: this.roomId,
      roomCode: this.roomCode,
      inviteExpiresAtMs: this.inviteExpiresAtMs,
      invite: invite.value,
    }));
  }

  invitation(nowMs = 0): KaraokeLanResult<KaraokeLanInvite> {
    if (nowMs > 0 && nowMs >= this.inviteExpiresAtMs) {
      return lanFailure('INVITE_EXPIRED', '房间邀请已过期', false);
    }
    return generateKaraokeLanInvite({
      roomId: this.roomId,
      roomCode: this.roomCode,
      hostName: this.hostDisplayName,
      expiresAtMs: this.inviteExpiresAtMs,
      passwordRequired: !!this.joinPassword,
    });
  }

  requestJoin(
    input: KaraokeLanJoinRequest,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanPendingJoin> {
    const notStarted = this.requireStarted();
    if (notStarted) return notStarted;
    if (!validTime(nowMs)) return lanFailure('INVALID_INPUT', '加入时间无效', false);
    const roomCode = normalizeKaraokeRoomCode(input?.roomCode);
    if (!roomCode) return lanFailure('INVALID_INPUT', '六位房间码无效', false);
    if (roomCode !== this.roomCode) {
      return lanFailure('ROOM_NOT_FOUND', '未找到对应 K 歌房间', false);
    }
    const displayName = boundedText(input?.displayName, KARAOKE_LAN_LIMITS.maxDisplayNameLength);
    const clientNonce = boundedText(input?.clientNonce, KARAOKE_LAN_LIMITS.maxClientIdLength);
    if (!displayName || !isPublicKaraokeText(displayName, KARAOKE_LAN_LIMITS.maxDisplayNameLength) || !clientNonce) {
      return lanFailure('INVALID_INPUT', '昵称或客户端 nonce 无效', false);
    }
    if (nowMs >= this.inviteExpiresAtMs
      || (input.inviteExpiresAtMs !== undefined && nowMs >= input.inviteExpiresAtMs)) {
      return lanFailure('INVITE_EXPIRED', '房间邀请已过期', false);
    }
    if (this.nonceToPending.has(clientNonce)) {
      return lanFailure('DUPLICATE_JOIN', '该客户端已提交过加入申请', false);
    }
    if (this.session.state.members.length >= KARAOKE_LIMITS.maxMembers) {
      return lanFailure('ROOM_FULL', 'K 歌房间成员已满', true);
    }
    const pendingCount = [...this.pending.values()]
      .filter((entry) => entry.pending.status === 'pending').length;
    if (pendingCount >= KARAOKE_LAN_LIMITS.maxPendingJoins) {
      return lanFailure('PENDING_LIMIT', '等待主持人批准的申请过多', true);
    }
    if (this.pending.size >= KARAOKE_LAN_LIMITS.maxPendingJoins * 4) {
      this.pruneResolvedPending();
      if (this.pending.size >= KARAOKE_LAN_LIMITS.maxPendingJoins * 4) {
        return lanFailure('PENDING_LIMIT', '房间加入申请历史已满', true);
      }
    }
    const password = typeof input.password === 'string' ? input.password : '';
    if (password.length > KARAOKE_LAN_LIMITS.maxPasswordLength
      || (!!this.joinPassword && password !== this.joinPassword)) {
      return lanFailure('WRONG_PASSWORD', '房间密码错误', false);
    }
    const pendingId = randomKaraokeLanId('karaoke-pending');
    if (!pendingId.ok) return pendingId;
    const pending: KaraokeLanPendingJoin = Object.freeze({
      schema: 1,
      pendingId: pendingId.value,
      roomId: this.roomId,
      roomCode: this.roomCode,
      clientNonce,
      displayName,
      requestedAtMs: nowMs,
      status: 'pending' as const,
    });
    this.pending.set(pending.pendingId, { pending });
    this.nonceToPending.set(clientNonce, pending.pendingId);
    this.sendToRoomHost('join.pending', {
      pendingId: pending.pendingId,
      displayName,
      requestedAtMs: nowMs,
    }, nowMs);
    return lanOk(pending);
  }

  approveJoin(
    hostAuthorization: KaraokeLanAuthorization,
    pendingId: string,
    nowMs: number,
    role: Exclude<KaraokeRole, 'host'> = 'singer',
    side?: 'blue' | 'red' | 'none',
  ): KaraokeLanResult<KaraokeLanApprovalResult> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    const entry = this.pending.get(pendingId);
    if (!entry) return lanFailure('MEMBER_NOT_FOUND', '加入申请不存在或已清理', false);
    if (entry.pending.status === 'rejected') {
      return lanFailure('JOIN_REJECTED', '加入申请已被拒绝', false);
    }
    if (entry.pending.status === 'approved') {
      return lanFailure('JOIN_ALREADY_RESOLVED', '加入申请已经批准', false);
    }
    if (role !== 'singer' && role !== 'listener') {
      return lanFailure('INVALID_INPUT', '成员角色无效', false);
    }
    if (this.session.state.members.length >= KARAOKE_LIMITS.maxMembers) {
      return lanFailure('ROOM_FULL', 'K 歌房间成员已满', true);
    }
    const memberId = randomKaraokeLanId(`karaoke-${role}`, 10);
    if (!memberId.ok) return memberId;
    let joined = this.session.joinMember(
      memberId.value,
      entry.pending.displayName,
      nowMs,
      role,
    );
    if (!joined.ok) return this.fromSessionFailure(joined);
    if (side && role === 'singer') {
      joined = joined.session.setMemberSide(host.value.memberId, memberId.value, side, nowMs);
      if (!joined.ok) return this.fromSessionFailure(joined);
    }
    const tooLarge = this.snapshotFailure(joined.state);
    if (tooLarge) return tooLarge;
    const authorization = this.grants.issue({
      roomId: this.roomId,
      memberId: memberId.value,
      role,
      expiresAtMs: nowMs + this.tokenLifetimeMs,
    });
    if (!authorization.ok) return authorization;
    this.session = joined.session;
    this.members.set(memberId.value, {
      authorization: authorization.value,
      reconnect: new KaraokeLanReconnectPolicy(),
      lastSeenAtMs: nowMs,
    });
    entry.pending = Object.freeze({
      ...entry.pending,
      status: 'approved' as const,
      memberId: memberId.value,
    });
    this.pending.set(entry.pending.pendingId, entry);
    this.sendToRoomHost('join.approved', {
      pendingId: entry.pending.pendingId,
      memberId: memberId.value,
    }, nowMs);
    this.broadcastSnapshot(nowMs);
    return lanOk(Object.freeze({
      authorization: authorization.value,
      memberId: memberId.value,
      displayName: entry.pending.displayName,
      pendingId: entry.pending.pendingId,
    }));
  }

  acceptJoin(
    hostAuthorization: KaraokeLanAuthorization,
    pendingId: string,
    nowMs: number,
    role: Exclude<KaraokeRole, 'host'> = 'singer',
  ): KaraokeLanResult<KaraokeLanApprovalResult> {
    return this.approveJoin(hostAuthorization, pendingId, nowMs, role);
  }

  rejectJoin(
    hostAuthorization: KaraokeLanAuthorization,
    pendingId: string,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanPendingJoin> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    const entry = this.pending.get(pendingId);
    if (!entry) return lanFailure('MEMBER_NOT_FOUND', '加入申请不存在或已清理', false);
    if (entry.pending.status === 'approved') {
      return lanFailure('JOIN_ALREADY_RESOLVED', '加入申请已经批准', false);
    }
    if (entry.pending.status === 'rejected') {
      return lanFailure('JOIN_REJECTED', '加入申请已被拒绝', false);
    }
    entry.pending = Object.freeze({
      ...entry.pending,
      status: 'rejected' as const,
    });
    this.pending.set(entry.pending.pendingId, entry);
    this.sendToRoomHost('join.rejected', {
      pendingId,
      reason: 'host-rejected',
    }, nowMs);
    return lanOk(entry.pending);
  }

  pendingJoins(
    hostAuthorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<readonly KaraokeLanPendingJoin[]> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    return lanOk(frozenArray(
      [...this.pending.values()]
        .filter((entry) => entry.pending.status === 'pending')
        .map((entry) => entry.pending),
    ));
  }

  subscribe(
    authorization: KaraokeLanAuthorization,
    listener: HostListener,
    nowMs: number,
  ): KaraokeLanResult<() => void> {
    const valid = this.grants.validate(authorization, this.roomId, nowMs);
    if (!valid.ok) {
      if (valid.error.code === 'TOKEN_EXPIRED' || valid.error.code === 'TOKEN_INVALID') {
        this.mediaManager?.closeMember(authorization?.memberId ?? '', valid.error.code);
      }
      return valid;
    }
    if (!this.session.state.members.some((member) => member.id === valid.value.memberId)) {
      return lanFailure('MEMBER_NOT_FOUND', '成员已不在房间', false);
    }
    if (typeof listener !== 'function') {
      return lanFailure('INVALID_INPUT', '订阅回调无效', false);
    }
    const subscriptions = this.subscribers.get(valid.value.memberId) ?? new Set<HostListener>();
    subscriptions.add(listener);
    this.subscribers.set(valid.value.memberId, subscriptions);
    this.touch(valid.value.memberId, nowMs);
    this.sendSnapshotTo(valid.value.memberId, nowMs);
    return lanOk(() => {
      subscriptions.delete(listener);
      if (subscriptions.size === 0) this.subscribers.delete(valid.value.memberId);
    });
  }

  sendStructuredError(
    authorization: KaraokeLanAuthorization,
    error: KaraokeLanError,
    nowMs: number,
  ): KaraokeLanResult<void> {
    if (!authorization || authorization.roomId !== this.roomId) {
      return lanFailure('INVALID_INPUT', '错误消息接收成员无效', false);
    }
    this.sendTo(
      authorization.memberId,
      'room.error',
      createKaraokeLanErrorEnvelopePayload(error),
      nowMs,
    );
    return lanOk(undefined);
  }

  handleJoinEnvelope(
    raw: string | KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    const parsed = parseKaraokeLanEnvelope(raw);
    if (!parsed.ok) return parsed;
    const envelope = parsed.value;
    if (envelope.type !== 'join.request'
      || envelope.source !== 'client'
      || envelope.roomId !== this.roomId
      || envelope.recipientId !== this.hostId) {
      return lanFailure('INVALID_ENVELOPE', '加入消息的目标或类型无效', false);
    }
    const limit = this.rateLimiter.consume(`join:${envelope.senderId}`, nowMs);
    if (!limit.ok) return limit;
    const duplicate = this.duplicateControl(envelope.senderId, envelope.sequence);
    if (duplicate) return lanOk(duplicate);
    const payload = envelope.payload as Partial<KaraokeLanJoinRequest>;
    if (payload.clientNonce !== envelope.senderId) {
      return lanFailure('INVALID_ENVELOPE', '加入消息 nonce 与发送方不一致', false);
    }
    const joined = this.requestJoin({
      roomCode: String(payload.roomCode ?? ''),
      displayName: String(payload.displayName ?? ''),
      clientNonce: String(payload.clientNonce ?? ''),
      ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
      ...(typeof payload.inviteExpiresAtMs === 'number'
        ? { inviteExpiresAtMs: payload.inviteExpiresAtMs }
        : {}),
    }, nowMs);
    if (!joined.ok) return joined;
    const response: KaraokeLanControlResponse = Object.freeze({
      status: 'applied' as const,
      duplicate: false,
      type: 'join.pending' as const,
      payload: Object.freeze({
        pendingId: joined.value.pendingId,
        status: joined.value.status,
      }),
    });
    this.rememberControl(envelope.senderId, envelope.sequence, response);
    return lanOk(response);
  }

  handleRaw(
    authorization: KaraokeLanAuthorization,
    raw: string | KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    const parsed = parseKaraokeLanEnvelope(raw);
    return parsed.ok
      ? this.handleEnvelope(authorization, parsed.value, nowMs)
      : parsed;
  }

  handleEnvelope(
    authorization: KaraokeLanAuthorization,
    envelope: KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    const valid = this.requireAuthorization(authorization, nowMs);
    if (!valid.ok) return valid;
    if (envelope.source !== 'client'
      || envelope.roomId !== this.roomId
      || envelope.senderId !== valid.value.memberId
      || envelope.recipientId !== this.hostId
      || !MEMBER_EVENT_TYPES.has(envelope.type)) {
      return lanFailure('INVALID_ENVELOPE', '成员消息来源、成员或目标无效', false);
    }
    if (envelope.type !== 'score.line') {
      const limit = this.rateLimiter.consume(valid.value.memberId, nowMs);
      if (!limit.ok) return limit;
      const duplicate = this.duplicateControl(envelope.senderId, envelope.sequence);
      if (duplicate) return lanOk(duplicate);
    }
    this.touch(valid.value.memberId, nowMs);
    let result: KaraokeLanResult<KaraokeLanControlResponse>;
    switch (envelope.type) {
      case 'member.ready':
        result = this.handleReady(authorization, envelope, nowMs);
        break;
      case 'queue.add':
        result = this.handleQueueAdd(authorization, envelope, nowMs);
        break;
      case 'queue.remove':
        result = this.handleQueueRemove(authorization, envelope, nowMs);
        break;
      case 'score.line':
        result = this.handleScoreLine(authorization, envelope, nowMs);
        break;
      case 'session.leave':
        result = this.handleLeaveEnvelope(authorization, envelope, nowMs);
        break;
      case 'clock.sample':
      case 'clock.ping':
        result = this.handleClock(authorization, envelope, nowMs);
        break;
      case 'heartbeat.ping':
        result = this.handleHeartbeat(authorization, envelope, nowMs);
        break;
      default:
        result = lanFailure('INVALID_ENVELOPE', '不支持的成员消息', false);
    }
    if (result.ok && envelope.type !== 'score.line') {
      this.rememberControl(envelope.senderId, envelope.sequence, result.value);
    }
    return result;
  }

  handleClientEvent(
    authorization: KaraokeLanAuthorization,
    event: KaraokeClientEvent,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    if (!event || typeof event !== 'object' || event.type === 'join.requested') {
      return lanFailure('INVALID_INPUT', '成员事件无效', false);
    }
    const valid = this.requireAuthorization(authorization, nowMs);
    if (!valid.ok) return valid;
    const sequence = this.nextIncomingSequence(valid.value.memberId);
    const envelope = createKaraokeLanEnvelope({
      type: event.type,
      source: 'client',
      roomId: this.roomId,
      senderId: authorization.memberId,
      recipientId: this.hostId,
      sequence,
      sentAtMs: nowMs,
      payload: event,
    });
    return envelope.ok
      ? this.handleEnvelope(authorization, envelope.value, nowMs)
      : envelope;
  }

  disconnect(
    authorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    const valid = this.requireAuthorization(authorization, nowMs);
    if (!valid.ok) return valid;
    if (valid.value.role === 'host') {
      return lanFailure('INVALID_TRANSITION', '主持人应停止房间而非断线离开', false);
    }
    const existing = this.session.state.members.find(
      (member) => member.id === valid.value.memberId,
    );
    if (existing && !existing.connected) return lanOk(this.session.state);
    const disconnected = this.session.disconnect(valid.value.memberId, nowMs);
    if (!disconnected.ok) return this.fromSessionFailure(disconnected);
    if (this.snapshotFailure(disconnected.state)) return this.snapshotFailure(disconnected.state)!;
    this.session = disconnected.session;
    const runtime = this.members.get(valid.value.memberId);
    if (runtime) {
      runtime.disconnectedAtMs = nowMs;
      runtime.lastSeenAtMs = nowMs;
    }
    this.mediaManager?.closeMember(valid.value.memberId, 'disconnected');
    this.broadcastSnapshot(nowMs);
    return lanOk(this.session.state);
  }

  reconnect(
    authorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    const valid = this.requireAuthorization(authorization, nowMs);
    if (!valid.ok) return valid;
    const runtime = this.members.get(valid.value.memberId);
    if (!runtime) return lanFailure('MEMBER_NOT_FOUND', '成员运行时不存在', false);
    const member = this.session.state.members.find(
      (candidate) => candidate.id === valid.value.memberId,
    );
    if (member?.connected) return lanOk(this.session.state);
    if (runtime.reconnect.attempts >= KARAOKE_LAN_LIMITS.maxReconnectAttempts
      && member?.connected === false) {
      return lanFailure('RECONNECT_EXHAUSTED', '重连次数已用尽', false);
    }
    const reconnected = this.session.reconnect(valid.value.memberId, nowMs);
    if (!reconnected.ok) return this.fromSessionFailure(reconnected);
    if (this.snapshotFailure(reconnected.state)) return this.snapshotFailure(reconnected.state)!;
    this.session = reconnected.session;
    runtime.disconnectedAtMs = undefined;
    runtime.lastSeenAtMs = nowMs;
    runtime.reconnect.reset();
    this.broadcastSnapshot(nowMs);
    return lanOk(this.session.state);
  }

  recordReconnectFailure(
    authorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<{
    readonly attempt: number;
    readonly delayMs: number;
    readonly exhausted: boolean;
  }> {
    const valid = this.requireAuthorization(authorization, nowMs);
    if (!valid.ok) return valid;
    const runtime = this.members.get(valid.value.memberId);
    if (!runtime) return lanFailure('MEMBER_NOT_FOUND', '成员运行时不存在', false);
    const member = this.session.state.members.find(
      (candidate) => candidate.id === valid.value.memberId,
    );
    if (member?.connected) {
      return lanFailure('INVALID_TRANSITION', '成员当前在线，无需记录重连失败', true);
    }
    return runtime.reconnect.fail();
  }

  leave(
    authorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    const valid = this.requireAuthorization(authorization, nowMs);
    if (!valid.ok) return valid;
    if (valid.value.role === 'host') {
      return lanFailure('HOST_REQUIRED', '主持人退出等同于停止房间', false);
    }
    return this.removeMember(valid.value.memberId, nowMs, 'left');
  }

  kick(
    hostAuthorization: KaraokeLanAuthorization,
    memberId: string,
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    if (memberId === this.hostId) {
      return lanFailure('INVALID_INPUT', '不能踢出主持人', false);
    }
    return this.removeMember(memberId, nowMs, 'kicked');
  }

  stop(
    hostAuthorization: KaraokeLanAuthorization,
    nowMs: number,
    reason = 'host-stopped',
  ): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    return this.stopInternal(nowMs, reason);
  }

  assignSide(
    hostAuthorization: KaraokeLanAuthorization,
    memberId: string,
    side: 'blue' | 'red' | 'none',
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    const normalizedMemberId = boundedText(memberId, 128);
    if (!normalizedMemberId) return lanFailure('INVALID_INPUT', '成员 ID 无效', false);
    const changed = this.session.setMemberSide(host.value.memberId, normalizedMemberId, side, nowMs);
    return this.commitHostMutation(changed, nowMs);
  }

  startQueueItem(
    hostAuthorization: KaraokeLanAuthorization,
    itemId: string,
    nowMs: number,
    countdownMs = 0,
  ): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    if ((this.state.battle.settlingUntilMs ?? 0) > nowMs) return lanFailure('INVALID_TRANSITION', '正在确认上一轮分数', true);
    const normalizedItemId = boundedText(itemId, 256);
    if (!normalizedItemId) return lanFailure('INVALID_INPUT', '队列项 ID 无效', false);
    const item = this.session.state.queue.find(item => item.id === normalizedItemId);
    const roundSingers = item?.mode === 'chorus' ? this.session.state.members
      .filter(member => member.side !== 'none' && member.connected && member.ready).map(member => member.id) : undefined;
    const countedDown = this.session.startQueueItem(
      host.value.memberId,
      normalizedItemId,
      nowMs,
      countdownMs,
      roundSingers,
    );
    if (!countedDown.ok) return this.fromSessionFailure(countedDown);
    const next = countdownMs > 0 ? countedDown : countedDown.session.beginSinging(host.value.memberId, nowMs);
    const result = this.commitHostMutation(next, nowMs);
    if (result.ok) this.submittedLineKeys.clear();
    return result;
  }

  restart(hostAuthorization: KaraokeLanAuthorization, nowMs: number): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    if ((this.state.battle.settlingUntilMs ?? 0) > nowMs) return lanFailure('INVALID_TRANSITION', '正在确认上一轮分数', true);
    const {status, members, queue} = this.session.state;
    if (status !== 'results' && status !== 'lobby') {
      return lanFailure('INVALID_TRANSITION', '请先结束当前歌曲，再重新开始对局', true);
    }
    const available = new Set(members.map(member => member.id));
    const seen = new Set<string>();
    const replay = queue.filter(item => {
      if (seen.has(item.recordingId) || !item.singerIds.every(id => available.has(id))) return false;
      seen.add(item.recordingId);
      return true;
    });
    const result = this.commitHostMutation(this.session.restoreQueue(host.value.memberId, replay, nowMs), nowMs);
    if (result.ok) this.submittedLineKeys.clear();
    return result;
  }

  pause(
    hostAuthorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    return this.commitHostMutation(this.session.pause(host.value.memberId, nowMs), nowMs);
  }

  resume(
    hostAuthorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    return this.commitHostMutation(this.session.resume(host.value.memberId, nowMs), nowMs);
  }

  skipCurrent(
    hostAuthorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    return this.commitHostMutation(
      this.session.skipCurrent(host.value.memberId, nowMs),
      nowMs,
    );
  }

  finishCurrent(
    hostAuthorization: KaraokeLanAuthorization,
    nowMs: number,
    acceptLateScores = false,
  ): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    const state = this.session.state;
    const singers = state.queue.find(item => item.id === state.currentItemId)?.singerIds ?? [];
    const waitingForReconnect = singers.some(id => state.members.find(member => member.id === id)?.connected === false);
    const settlingUntilMs = acceptLateScores
      ? nowMs + (waitingForReconnect ? KARAOKE_LAN_LIMITS.disconnectGraceMs : 2500)
      : undefined;
    return this.commitHostMutation(
      this.session.finishCurrent(host.value.memberId, nowMs, undefined, settlingUntilMs),
      nowMs,
    );
  }

  tick(nowMs: number): KaraokeLanResult<{
    readonly disconnected: readonly string[];
    readonly removed: readonly string[];
    readonly closed: boolean;
  }> {
    if (!validTime(nowMs)) {
      return lanFailure('INVALID_INPUT', '生命周期检查时间无效', false);
    }
    if (this.lifecycle === 'stopped') {
      return lanOk(Object.freeze({
        disconnected: Object.freeze([]),
        removed: Object.freeze([]),
        closed: true,
      }));
    }
    const disconnected: string[] = [];
    const removed: string[] = [];
    const hostValid = this.grants.validate(
      this.hostAuthorization,
      this.roomId,
      nowMs,
    );
    if (!hostValid.ok) {
      this.stopInternal(nowMs, hostValid.error.code === 'TOKEN_EXPIRED'
        ? 'host-token-expired'
        : 'host-token-invalid');
      return lanOk(Object.freeze({
        disconnected: frozenArray([]),
        removed: frozenArray([]),
        closed: true,
      }));
    }
    for (const [memberId, runtime] of this.members) {
      const member = this.session.state.members.find((candidate) => candidate.id === memberId);
      if (!member) continue;
      const valid = this.grants.validate(runtime.authorization, this.roomId, nowMs);
      if (!valid.ok) {
        const result = this.removeMember(memberId, nowMs, 'token-expired');
        if (result.ok) removed.push(memberId);
        continue;
      }
      const stale = member.connected
        && nowMs - runtime.lastSeenAtMs > KARAOKE_LAN_LIMITS.heartbeatTimeoutMs;
      if (stale) {
        const result = this.session.disconnect(memberId, nowMs);
        if (result.ok) {
          this.session = result.session;
          runtime.disconnectedAtMs = nowMs;
          this.mediaManager?.closeMember(memberId, 'heartbeat-timeout');
          disconnected.push(memberId);
        }
      } else if (!member.connected
        && runtime.disconnectedAtMs !== undefined
        && nowMs - runtime.disconnectedAtMs > KARAOKE_LAN_LIMITS.disconnectGraceMs) {
        const result = this.removeMember(memberId, nowMs, 'disconnect-expired');
        if (result.ok) removed.push(memberId);
      }
    }
    const {status, countdownEndsAtMs} = this.session.state;
    const {settlingUntilMs, ...battle} = this.session.state.battle;
    if (settlingUntilMs !== undefined && nowMs >= settlingUntilMs) {
      this.commitHostMutation(this.session.updateBattle(battle, nowMs), nowMs);
    }
    if (status === 'countdown' && countdownEndsAtMs !== undefined && nowMs >= countdownEndsAtMs) {
      const begun = this.commitHostMutation(this.session.beginSinging(this.hostId, nowMs), nowMs);
      if (!begun.ok) this.commitHostMutation(this.session.skipCurrent(this.hostId, nowMs), nowMs);
    } else if (disconnected.length || removed.length) this.broadcastSnapshot(nowMs);
    return lanOk(Object.freeze({
      disconnected: frozenArray(disconnected),
      removed: frozenArray(removed),
      closed: false,
    }));
  }

  recovery(
    hostAuthorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    const host = this.requireHost(hostAuthorization, nowMs, 'room-control');
    if (!host.ok) return host;
    return lanOk(deepFreezeClone(this.session.state));
  }

  private requireStarted(): KaraokeLanResult<never> | null {
    if (this.lifecycle === 'stopped' || this.session.state.status === 'closed') {
      return lanFailure('ROOM_CLOSED', 'K 歌房间已停止', false);
    }
    return this.lifecycle === 'created'
      ? lanFailure('ROOM_NOT_STARTED', 'K 歌房间尚未启动', true)
      : null;
  }

  private requireHost(
    authorization: KaraokeLanAuthorization,
    nowMs: number,
    capability: 'room-control',
  ): KaraokeLanResult<KaraokeLanAuthorization> {
    const checked = this.requireStarted();
    if (checked) return checked;
    const valid = this.grants.requireCapability(
      authorization,
      this.roomId,
      capability,
      nowMs,
    );
    if (!valid.ok) return valid;
    return valid.value.role === 'host'
      ? valid
      : lanFailure('HOST_REQUIRED', '只有主持人可执行此操作', false);
  }

  private requireAuthorization(
    authorization: KaraokeLanAuthorization,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanAuthorization> {
    const checked = this.requireStarted();
    if (checked) return checked;
    const valid = this.grants.validate(authorization, this.roomId, nowMs);
    if (!valid.ok) {
      if (valid.error.code === 'TOKEN_EXPIRED' || valid.error.code === 'TOKEN_INVALID') {
        this.mediaManager?.closeMember(authorization?.memberId ?? '', valid.error.code);
      }
      return valid;
    }
    if (!this.session.state.members.some((member) => member.id === valid.value.memberId)) {
      return lanFailure('MEMBER_NOT_FOUND', '成员已不在房间', false);
    }
    return valid;
  }

  private handleReady(
    authorization: KaraokeLanAuthorization,
    envelope: KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    const payload = envelope.payload as { readonly ready?: unknown };
    if (typeof payload.ready !== 'boolean') {
      return lanFailure('INVALID_INPUT', '准备状态必须是布尔值', false);
    }
    const changed = this.session.setReady(
      authorization.memberId,
      authorization.memberId,
      payload.ready,
      nowMs,
    );
    return this.commitMutation(changed, envelope.type, nowMs, { ready: payload.ready });
  }

  private handleQueueAdd(
    authorization: KaraokeLanAuthorization,
    envelope: KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    const permission = this.grants.requireCapability(
      authorization,
      this.roomId,
      'queue',
      nowMs,
    );
    if (!permission.ok) return permission;
    const payload = envelope.payload as {
      readonly recordingId?: unknown;
      readonly mode?: unknown;
      readonly song?: unknown;
    };
    const recordingId = safeRecordingId(payload.recordingId);
    const mode = payload.mode;
    const song = karaokeSongSummary(payload.song);
    if (!recordingId || (mode !== 'solo' && mode !== 'relay' && mode !== 'chorus')) {
      return lanFailure('INVALID_INPUT', '队列歌曲或模式无效', false);
    }
    if (payload.song !== undefined && !song) return lanFailure('INVALID_INPUT', '歌曲摘要无效', false);
    const changed = this.session.addQueueItem(
      authorization.memberId,
      { recordingId, mode: mode as KaraokeQueueMode, song },
      nowMs,
    );
    return this.commitMutation(changed, envelope.type, nowMs, { recordingId, mode });
  }

  private handleQueueRemove(
    authorization: KaraokeLanAuthorization,
    envelope: KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    const permission = this.grants.requireCapability(
      authorization,
      this.roomId,
      'queue',
      nowMs,
    );
    if (!permission.ok) return permission;
    const payload = envelope.payload as { readonly itemId?: unknown };
    const itemId = boundedText(payload.itemId, 256);
    if (!itemId) return lanFailure('INVALID_INPUT', '队列项 ID 无效', false);
    const changed = this.session.removeQueueItem(authorization.memberId, itemId, nowMs);
    return this.commitMutation(changed, envelope.type, nowMs, { itemId });
  }

  private handleLeaveEnvelope(
    authorization: KaraokeLanAuthorization,
    envelope: KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    const left = this.leave(authorization, nowMs);
    if (!left.ok) return left;
    return lanOk(Object.freeze({
      status: 'applied' as const,
      duplicate: false,
      type: envelope.type,
      payload: Object.freeze({ memberId: authorization.memberId }),
    }));
  }

  private handleClock(
    authorization: KaraokeLanAuthorization,
    envelope: KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    const payload = envelope.payload as {
      readonly clientSendMs?: unknown;
      readonly sampleId?: unknown;
    };
    if (!validTime(payload.clientSendMs)) {
      return lanFailure('INVALID_INPUT', '客户端时钟样本无效', false);
    }
    const sample = createKaraokeLanClockSample({
      sampleId: typeof payload.sampleId === 'string'
        ? payload.sampleId
        : `sequence-${envelope.sequence}`,
      clientSendMs: payload.clientSendMs,
      serverReceiveMs: nowMs,
      serverSendMs: nowMs,
    });
    if (!sample.ok) return sample;
    const responsePayload = Object.freeze({ ...sample.value });
    this.sendTo(authorization.memberId, 'clock.pong', responsePayload, nowMs);
    return lanOk(Object.freeze({
      status: 'applied' as const,
      duplicate: false,
      type: 'clock.pong' as const,
      payload: responsePayload,
    }));
  }

  private handleHeartbeat(
    authorization: KaraokeLanAuthorization,
    envelope: KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    this.touch(authorization.memberId, nowMs);
    const payload = Object.freeze({
      serverMonotonicMs: nowMs,
      memberId: authorization.memberId,
    });
    this.sendTo(authorization.memberId, 'heartbeat.ack', payload, nowMs);
    return lanOk(Object.freeze({
      status: 'applied' as const,
      duplicate: false,
      type: 'heartbeat.ack' as const,
      payload,
    }));
  }

  private handleScoreLine(
    authorization: KaraokeLanAuthorization,
    envelope: KaraokeLanEnvelope,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    const permission = this.grants.requireCapability(
      authorization,
      this.roomId,
      'sing',
      nowMs,
    );
    if (!permission.ok) return permission;
    const scoreRate = this.scoreRateLimiter.consume(authorization.memberId, nowMs);
    if (!scoreRate.ok) return scoreRate;
    const payload = envelope.payload as {
      readonly itemId?: unknown;
      readonly lineIndex?: unknown;
      readonly revision?: unknown;
      readonly lineScore?: unknown;
      readonly clientSentAtMs?: unknown;
    };
    const normalized = normalizeScoreLine(payload);
    if (!normalized.ok) return normalized;
    const state = this.session.state;
    const current = state.queue.find((item) => item.id === normalized.value.itemId);
    const singing = current?.id === state.currentItemId && current?.state === 'singing';
    const settling = current?.id === state.battle.itemId && current?.state === 'scored'
      && (state.battle.settlingUntilMs ?? 0) > nowMs;
    if (!current || (!singing && !settling)) {
      return lanFailure('INVALID_TRANSITION', '分数事件不属于当前演唱歌曲', false);
    }
    if (normalized.value.revision !== state.battle.revision) {
      return lanFailure('INVALID_TRANSITION', '分数事件修订号已过期', true, {
        revision: state.battle.revision ?? state.revision,
      });
    }
    const member = state.members.find((candidate) => candidate.id === authorization.memberId);
    if (!member?.connected || member.side === 'none' || !current.singerIds.includes(member.id)) {
      return lanFailure('PERMISSION_DENIED', '只有本轮在线演唱成员可以提交分数', false);
    }
    const lineKey = `${authorization.memberId}:${normalized.value.itemId}:${normalized.value.lineIndex}:${normalized.value.revision}`;
    if (this.submittedLineKeys.has(lineKey)) {
      return lanOk(Object.freeze({
        status: 'duplicate' as const,
        duplicate: true,
        type: 'score.line' as const,
        payload: Object.freeze({ itemId: normalized.value.itemId, lineIndex: normalized.value.lineIndex }),
      }));
    }
    const battle = nextBattleState(state.battle, normalized.value.itemId, {
      memberId: authorization.memberId,
      side: member.side === 'blue' ? 'blue' : 'red',
      delta: normalized.value.lineScore.total,
    });
    const changed = this.session.updateBattle(battle, nowMs);
    const committed = this.commitMutation(changed, envelope.type, nowMs, {
      itemId: normalized.value.itemId,
      lineIndex: normalized.value.lineIndex,
    });
    if (committed.ok) this.submittedLineKeys.add(lineKey);
    return committed;
  }

  private commitMutation(
    result: KaraokeSessionResult,
    type: KaraokeLanEnvelopeType,
    nowMs: number,
    payload: Readonly<Record<string, unknown>>,
  ): KaraokeLanResult<KaraokeLanControlResponse> {
    if (!result.ok) return this.fromSessionFailure(result);
    const tooLarge = this.snapshotFailure(result.state);
    if (tooLarge) return tooLarge;
    this.session = result.session;
    this.broadcastSnapshot(nowMs);
    return lanOk(Object.freeze({
      status: 'applied' as const,
      duplicate: false,
      type,
      payload: Object.freeze({ ...payload, revision: result.state.revision }),
    }));
  }

  private commitHostMutation(
    result: KaraokeSessionResult,
    nowMs: number,
  ): KaraokeLanResult<KaraokeRoomState> {
    if (!result.ok) return this.fromSessionFailure(result);
    if (this.snapshotFailure(result.state)) return this.snapshotFailure(result.state)!;
    this.session = result.session;
    this.broadcastSnapshot(nowMs);
    return lanOk(this.session.state);
  }

  private removeMember(
    memberId: string,
    nowMs: number,
    reason: string,
  ): KaraokeLanResult<KaraokeRoomState> {
    const next = this.stateWithoutMember(memberId, nowMs);
    if (!next) return lanFailure('MEMBER_NOT_FOUND', '成员不存在或快照无法更新', false);
    this.session = next;
    this.grants.revokeMember(this.roomId, memberId);
    this.mediaManager?.closeMember(memberId, reason);
    this.incomingSequences.delete(memberId);
    this.generatedClientSequences.delete(memberId);
    this.cachedControls.delete(memberId);
    this.members.delete(memberId);
    this.sendTo(memberId, 'room.error', reason === 'token-expired'
      ? {
        code: 'TOKEN_EXPIRED',
        message: 'K 歌房间 token 已过期',
        recoverable: false,
      }
      : {
        code: reason === 'kicked' ? 'PERMISSION_DENIED' : 'MEMBER_NOT_FOUND',
        message: reason === 'kicked' ? '你已被主持人移出 K 歌房间' : '已离开 K 歌房间',
        recoverable: false,
      }, nowMs);
    this.subscribers.delete(memberId);
    this.outgoingSequences.delete(memberId);
    this.broadcastSnapshot(nowMs);
    return lanOk(this.session.state);
  }

  private stateWithoutMember(memberId: string, nowMs: number): KaraokeSession | null {
    const current = this.session.state;
    if (!current.members.some((member) => member.id === memberId)) return null;
    if (memberId === this.hostId) return null;
    const members = current.members.filter((member) => member.id !== memberId);
    const queue = current.queue.map((item) => {
      if (item.state === 'scored' || item.state === 'skipped') return item;
      const singerIds = item.singerIds.filter((id) => id !== memberId);
      if (singerIds.length) return {...item, singerIds: frozenArray(singerIds)};
      if (item.id === current.currentItemId) return {...item, state: 'skipped' as const};
      return {...item, singerIds: frozenArray([this.hostId])};
    });
    const active = current.status === 'countdown'
      || current.status === 'singing'
      || current.status === 'paused';
    const lostActiveItem = active && queue.find(item => item.id === current.currentItemId)?.state === 'skipped';
    const candidate: KaraokeRoomState = deepFreezeClone({
      ...current,
      revision: current.revision + 1,
      hostMonotonicMs: Math.max(current.hostMonotonicMs, nowMs),
      members: frozenArray(members),
      queue: frozenArray(queue),
      ...(lostActiveItem
        ? {
          status: queue.some(item => item.state === 'queued') ? 'lobby' as const : 'results' as const,
          currentItemId: undefined,
          countdownEndsAtMs: undefined,
          battle: resetBattleState(),
        } : {}),
    } as KaraokeRoomState);
    const restored = KaraokeSession.restore(candidate);
    return restored.ok ? restored.session : null;
  }

  private stopInternal(nowMs: number, reason: string): KaraokeLanResult<KaraokeRoomState> {
    if (this.lifecycle === 'stopped') {
      return lanFailure('ROOM_CLOSED', 'K 歌房间已停止', false);
    }
    const stopped = this.session.stop(this.hostId, nowMs);
    if (!stopped.ok) return this.fromSessionFailure(stopped);
    if (this.snapshotFailure(stopped.state)) return this.snapshotFailure(stopped.state)!;
    this.session = stopped.session;
    this.lifecycle = 'stopped';
    for (const entry of this.pending.values()) {
      if (entry.pending.status === 'pending') {
        entry.pending = Object.freeze({ ...entry.pending, status: 'rejected' as const });
      }
    }
    this.broadcastSnapshot(nowMs);
    for (const memberId of this.subscribers.keys()) {
      this.sendTo(memberId, 'room.closed', {
        reason,
        state: this.session.state,
        hostSentMonotonicMs: this.session.state.hostMonotonicMs,
      }, nowMs);
    }
    this.grants.revokeRoom(this.roomId);
    this.submittedLineKeys.clear();
    this.mediaManager?.closeRoom(this.roomId, reason);
    this.members.clear();
    this.subscribers.clear();
    this.codeGuard.release(this.roomCode);
    return lanOk(this.session.state);
  }

  private snapshotFailure(state: KaraokeRoomState): KaraokeLanResult<never> | null {
    let bytes = 0;
    try {
      bytes = karaokeLanUtf8Bytes(JSON.stringify(state));
    } catch {
      return lanFailure('SNAPSHOT_INVALID', '房间快照无法序列化', false);
    }
    return bytes <= KARAOKE_LAN_LIMITS.maxSnapshotBytes
      ? null
      : lanFailure('SNAPSHOT_TOO_LARGE', '房间快照超过大小限制', false, {
        maxBytes: KARAOKE_LAN_LIMITS.maxSnapshotBytes,
        bytes,
      });
  }

  private broadcastSnapshot(nowMs: number): void {
    for (const memberId of this.subscribers.keys()) {
      this.sendSnapshotTo(memberId, nowMs);
    }
  }

  private sendSnapshotTo(memberId: string, nowMs: number): void {
    this.sendTo(memberId, 'room.snapshot', {
      state: this.session.state,
      hostSentMonotonicMs: this.session.state.hostMonotonicMs,
    }, nowMs);
  }

  private sendToRoomHost(
    type: 'join.pending' | 'join.approved' | 'join.rejected',
    payload: Readonly<Record<string, unknown>>,
    nowMs: number,
  ): void {
    this.sendTo(this.hostId, type, payload, nowMs);
  }

  private sendTo(
    recipientId: string,
    type: KaraokeLanEnvelopeType,
    payload: Readonly<Record<string, unknown>>,
    nowMs: number,
  ): void {
    if (!HOST_EVENT_TYPES.has(type)) return;
    const subscriptions = this.subscribers.get(recipientId);
    if (!subscriptions?.size) return;
    const sequence = (this.outgoingSequences.get(recipientId) ?? 0) + 1;
    const envelope = createKaraokeLanEnvelope({
      type,
      source: 'host',
      roomId: this.roomId,
      senderId: this.hostId,
      recipientId,
      sequence,
      sentAtMs: nowMs,
      payload,
    });
    if (!envelope.ok) return;
    let bytes = 0;
    try {
      bytes = karaokeLanUtf8Bytes(JSON.stringify(envelope.value));
    } catch {
      return;
    }
    if (bytes > KARAOKE_LAN_LIMITS.maxMessageBytes) return;
    this.outgoingSequences.set(recipientId, sequence);
    for (const listener of [...subscriptions]) {
      try {
        listener(envelope.value);
      } catch {
        subscriptions.delete(listener);
      }
    }
  }

  private duplicateControl(
    senderId: string,
    sequence: number,
  ): KaraokeLanControlResponse | null {
    const last = this.incomingSequences.get(senderId) ?? 0;
    if (sequence > last) return null;
    const cached = this.cachedControls.get(senderId);
    if (cached?.sequence === sequence) {
      return Object.freeze({
        ...cached.response,
        status: 'duplicate' as const,
        duplicate: true,
      });
    }
    return Object.freeze({
      status: 'duplicate' as const,
      duplicate: true,
      type: 'room.error' as const,
      payload: Object.freeze({
        code: 'STALE_SEQUENCE',
        message: '迟到或重复消息已忽略',
        recoverable: true,
      }),
    });
  }

  private rememberControl(
    senderId: string,
    sequence: number,
    response: KaraokeLanControlResponse,
  ): void {
    this.incomingSequences.set(senderId, Math.max(
      this.incomingSequences.get(senderId) ?? 0,
      sequence,
    ));
    this.cachedControls.set(senderId, { sequence, response });
    if (this.incomingSequences.size > 256) {
      const oldest = this.incomingSequences.keys().next().value;
      if (oldest) {
        this.incomingSequences.delete(oldest);
        this.cachedControls.delete(oldest);
      }
    }
  }

  private nextIncomingSequence(memberId: string): number {
    const sequence = Math.max(
      this.incomingSequences.get(memberId) ?? 0,
      this.generatedClientSequences.get(memberId) ?? 0,
    ) + 1;
    this.generatedClientSequences.set(memberId, sequence);
    return sequence;
  }

  private touch(memberId: string, nowMs: number): void {
    const runtime = this.members.get(memberId);
    if (runtime) runtime.lastSeenAtMs = nowMs;
  }

  private fromSessionFailure<T>(
    result: Extract<KaraokeSessionResult, { readonly ok: false }>,
  ): KaraokeLanResult<T> {
    return lanFailure(
      mapSessionError(result.error.code),
      result.error.message,
      result.error.code !== 'HOST_REQUIRED' && result.error.code !== 'ROOM_FULL',
    );
  }

  private pruneResolvedPending(): void {
    for (const [pendingId, entry] of this.pending) {
      if (entry.pending.status !== 'pending') {
        this.pending.delete(pendingId);
        this.nonceToPending.delete(entry.pending.clientNonce);
        return;
      }
    }
  }
}

export function createKaraokeLanHost(
  input: KaraokeLanHostCreateInput,
): KaraokeLanResult<KaraokeLanHost> {
  return KaraokeLanHost.create(input);
}

export function createKaraokeLanError(
  error: KaraokeLanError,
  input: {
    readonly roomId: string;
    readonly hostId: string;
    readonly recipientId: string;
    readonly sequence: number;
    readonly sentAtMs: number;
  },
): KaraokeLanResult<KaraokeLanEnvelope> {
  return createKaraokeLanEnvelope({
    type: 'room.error',
    source: 'host',
    roomId: input.roomId,
    senderId: input.hostId,
    recipientId: input.recipientId,
    sequence: input.sequence,
    sentAtMs: input.sentAtMs,
    payload: createKaraokeLanErrorEnvelopePayload(error),
  });
}
