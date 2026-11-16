import {
  KARAOKE_LIMITS,
  type KaraokeClientEvent,
  type KaraokeHostEvent,
  type KaraokeMember,
  type KaraokeLineScore,
  type KaraokeQueueItem,
  type KaraokeQueueMode,
  type KaraokeRole,
  type KaraokeRoomState,
  type KaraokeScore,
} from './contracts';
import { deepFreezeClone, frozenArray } from './immutable';
import type { KaraokeError, KaraokeErrorCode } from './result';

export interface RoomTransport {
  sendClientEvent(event: KaraokeClientEvent): Promise<void>;
  subscribeHostEvents(listener: (event: KaraokeHostEvent) => void): () => void;
  close(): void;
}

export interface MediaTransport {
  publishMedia(request: {
    readonly roomId: string;
    readonly recordingId: string;
    readonly streamId: string;
    readonly accompanimentUri: string;
  }): Promise<void>;
  subscribeMedia(listener: (event: {
    readonly recordingId: string;
    readonly streamId: string;
    readonly ended: boolean;
  }) => void): () => void;
  close(): void;
}

export interface KaraokeSessionCreateInput {
  roomId: string;
  roomCode: string;
  hostId: string;
  hostDisplayName: string;
  nowMs: number;
}

export interface KaraokeQueueAdd {
  recordingId: string;
  mode: KaraokeQueueMode;
  itemId?: string;
  singerIds?: readonly string[];
}

export type KaraokeSessionSuccess = Readonly<{
  ok: true;
  session: KaraokeSession;
  state: KaraokeRoomState;
}>;

export type KaraokeSessionFailure = Readonly<{
  ok: false;
  error: KaraokeError;
  state: KaraokeRoomState;
}>;

export type KaraokeSessionResult = KaraokeSessionSuccess | KaraokeSessionFailure;

const ROOM_STATUSES = new Set(['lobby', 'countdown', 'singing', 'paused', 'results', 'closed']);
const QUEUE_MODES = new Set<KaraokeQueueMode>(['solo', 'relay', 'chorus']);
const QUEUE_STATES = new Set<KaraokeQueueItem['state']>(['queued', 'countdown', 'singing', 'scored', 'skipped']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function monotonic(value: unknown, current: number): number {
  return Math.max(current, timestamp(value, current));
}

function failure(
  code: KaraokeErrorCode,
  message: string,
  state: KaraokeRoomState,
): KaraokeSessionFailure {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message }),
    state,
  });
}

function memberWith(member: KaraokeMember, patch: Partial<KaraokeMember>): KaraokeMember {
  return Object.freeze({ ...member, ...patch });
}

function itemWith(item: KaraokeQueueItem, patch: Partial<KaraokeQueueItem>): KaraokeQueueItem {
  return Object.freeze({ ...item, ...patch });
}

function cloneQueueItem(value: unknown): KaraokeQueueItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<KaraokeQueueItem>;
  const id = text(item.id);
  const recordingId = text(item.recordingId);
  if (!id || !recordingId || !QUEUE_MODES.has(item.mode as KaraokeQueueMode)) return null;
  if (!QUEUE_STATES.has(item.state as KaraokeQueueItem['state'])) return null;
  if (!Array.isArray(item.singerIds) || item.singerIds.length === 0) return null;
  const singerIds = [...new Set(item.singerIds.filter((id): id is string => typeof id === 'string' && !!id.trim()))];
  if (singerIds.length === 0) return null;
  const score = item.score === undefined ? undefined : cloneScore(item.score);
  if (item.score !== undefined && !score) return null;
  return deepFreezeClone({
    id,
    recordingId,
    mode: item.mode as KaraokeQueueMode,
    singerIds: frozenArray(singerIds),
    state: item.state as KaraokeQueueItem['state'],
    ...(score ? { score } : {}),
  });
}

function scorePercentage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function cloneScore(value: unknown): KaraokeScore | null {
  if (!value || typeof value !== 'object') return null;
  const score = value as Partial<KaraokeScore>;
  const {total, stability, longestCombo, bestLine, pitchEvaluated} = score;
  if (score.schema !== 1
    || !scorePercentage(total)
    || !scorePercentage(stability)
    || typeof longestCombo !== 'number'
    || !Number.isSafeInteger(longestCombo)
    || Number(longestCombo) < 0
    || !(bestLine === null || typeof bestLine === 'number' && Number.isSafeInteger(bestLine) && bestLine >= 0)
    || typeof pitchEvaluated !== 'boolean'
    || !Array.isArray(score.lines)
    || score.lines.length > KARAOKE_LIMITS.maxLyricLines) {
    return null;
  }
  const lines = (score.lines as readonly KaraokeLineScore[]).map((line) => {
    if (!line || typeof line !== 'object'
      || !Number.isSafeInteger(line.lineIndex)
      || line.lineIndex < 0
      || !Number.isFinite(line.startMs)
      || line.startMs < 0
      || !Number.isFinite(line.endMs)
      || line.endMs <= line.startMs
      || !(line.pitch === null || scorePercentage(line.pitch))
      || !(line.rhythm === null || scorePercentage(line.rhythm))
      || !scorePercentage(line.lyrics)
      || !scorePercentage(line.completeness)
      || !scorePercentage(line.breath)
      || !scorePercentage(line.total)
      || !Array.isArray(line.feedback)
      || line.feedback.length > 32
      || line.feedback.some((text) => typeof text !== 'string' || text.length > 500)) {
      return null;
    }
    return {
      ...line,
      feedback: frozenArray(line.feedback),
    };
  });
  if (lines.some((line) => line === null)) return null;
  if (bestLine !== null && !lines.some((line) => line?.lineIndex === bestLine)) return null;
  return deepFreezeClone({
    schema: 1,
    total,
    stability,
    longestCombo,
    bestLine,
    lines: frozenArray(lines as NonNullable<(typeof lines)[number]>[]),
    pitchEvaluated,
  });
}

function cloneMember(value: unknown): KaraokeMember | null {
  if (!value || typeof value !== 'object') return null;
  const member = value as Partial<KaraokeMember>;
  const id = text(member.id);
  const displayName = text(member.displayName);
  if (!id || !displayName) return null;
  if (!['host', 'singer', 'listener'].includes(member.role as KaraokeRole)) return null;
  return deepFreezeClone({
    id,
    displayName,
    role: member.role as KaraokeRole,
    ready: member.ready === true,
    connected: member.connected === true,
    joinedAtMs: timestamp(member.joinedAtMs),
    lastSeenAtMs: timestamp(member.lastSeenAtMs, timestamp(member.joinedAtMs)),
  });
}

function normalizeRestoredState(value: KaraokeRoomState): KaraokeRoomState | null {
  if (!value || typeof value !== 'object' || value.schema !== 1) return null;
  const roomId = text(value.roomId);
  const roomCode = text(value.roomCode);
  if (!roomId || !new RegExp(`^\\d{${KARAOKE_LIMITS.roomCodeLength}}$`).test(roomCode)) return null;
  if (!ROOM_STATUSES.has(value.status)) return null;
  if (!Array.isArray(value.members) || value.members.length === 0 || value.members.length > KARAOKE_LIMITS.maxMembers) return null;
  if (!Array.isArray(value.queue) || value.queue.length > KARAOKE_LIMITS.maxQueueItems) return null;
  const members = value.members.map(cloneMember);
  if (members.some((member) => member === null)) return null;
  const memberIds = new Set(members.map((member) => member!.id));
  if (memberIds.size !== members.length || members.filter((member) => member!.role === 'host').length !== 1) return null;
  const parsedQueue = value.queue
    .map(cloneQueueItem)
    .filter((item): item is KaraokeQueueItem => item !== null)
    .filter((item) => item.singerIds.every((id) => memberIds.has(id)));
  if (parsedQueue.length !== value.queue.length || new Set(parsedQueue.map((item) => item.id)).size !== parsedQueue.length) return null;

  let status = value.status;
  let currentItemId = value.currentItemId;
  let countdownEndsAtMs = value.countdownEndsAtMs;
  if (status === 'countdown' && (!currentItemId || !Number.isFinite(countdownEndsAtMs))) status = 'lobby';
  if (status === 'singing' && !currentItemId) status = 'lobby';
  if (status === 'closed') {
    currentItemId = undefined;
    countdownEndsAtMs = undefined;
  }
  if (currentItemId && !parsedQueue.some((item) => item.id === currentItemId)) {
    currentItemId = undefined;
    if (status === 'singing' || status === 'countdown' || status === 'paused') status = 'lobby';
    countdownEndsAtMs = undefined;
  }
  const activeStatus = status === 'countdown' || status === 'singing' || status === 'paused';
  const queue = parsedQueue.map((item) => {
    if (item.id === currentItemId && activeStatus) {
      return itemWith(item, { state: status === 'countdown' ? 'countdown' : 'singing' });
    }
    if (item.state === 'countdown' || item.state === 'singing') return itemWith(item, { state: 'queued' });
    return item;
  });

  return deepFreezeClone({
    schema: 1,
    roomId,
    roomCode,
    revision: Math.max(0, Math.floor(timestamp(value.revision))),
    status,
    hostMonotonicMs: timestamp(value.hostMonotonicMs),
    members: frozenArray(members as KaraokeMember[]),
    queue: frozenArray(queue),
    ...(currentItemId ? { currentItemId } : {}),
    ...(countdownEndsAtMs !== undefined && status === 'countdown' ? { countdownEndsAtMs } : {}),
  });
}

export class KaraokeSession {
  private constructor(private readonly roomState: KaraokeRoomState) {}

  static create(input: KaraokeSessionCreateInput): KaraokeSessionResult {
    const roomId = text(input?.roomId);
    const roomCode = text(input?.roomCode);
    const hostId = text(input?.hostId);
    const hostDisplayName = text(input?.hostDisplayName);
    const nowMs = timestamp(input?.nowMs);
    const emptyState = deepFreezeClone<KaraokeRoomState>({
      schema: 1,
      roomId: roomId || 'invalid-room',
      roomCode: roomCode || '000000',
      revision: 0,
      status: 'lobby',
      hostMonotonicMs: nowMs,
      members: [],
      queue: [],
    });
    if (!roomId || !new RegExp(`^\\d{${KARAOKE_LIMITS.roomCodeLength}}$`).test(roomCode)) {
      return failure('INVALID_INPUT', '房间 ID 或六位房间码无效', emptyState);
    }
    if (!hostId || !hostDisplayName) return failure('INVALID_INPUT', '主持人身份无效', emptyState);
    const host = Object.freeze({
      id: hostId,
      displayName: hostDisplayName,
      role: 'host' as const,
      ready: true,
      connected: true,
      joinedAtMs: nowMs,
      lastSeenAtMs: nowMs,
    });
    const state = deepFreezeClone<KaraokeRoomState>({ ...emptyState, members: frozenArray([host]) });
    const session = new KaraokeSession(state);
    return Object.freeze({ ok: true, session, state });
  }

  static restore(value: KaraokeRoomState): KaraokeSessionResult {
    const normalized = normalizeRestoredState(value);
    if (!normalized) {
      const fallback = deepFreezeClone<KaraokeRoomState>({
        schema: 1,
        roomId: 'invalid-room',
        roomCode: '000000',
        revision: 0,
        status: 'closed',
        hostMonotonicMs: 0,
        members: [],
        queue: [],
      });
      return failure('INVALID_INPUT', '房间快照损坏，无法恢复', fallback);
    }
    return Object.freeze({ ok: true, session: new KaraokeSession(normalized), state: normalized });
  }

  get state(): KaraokeRoomState {
    return this.roomState;
  }

  snapshot(): KaraokeRoomState {
    return this.roomState;
  }

  private succeed(next: KaraokeRoomState): KaraokeSessionSuccess {
    const state = deepFreezeClone<KaraokeRoomState>({ ...next, revision: this.roomState.revision + 1 });
    const session = new KaraokeSession(state);
    return Object.freeze({ ok: true, session, state });
  }

  private member(id: string): KaraokeMember | undefined {
    return this.roomState.members.find((member) => member.id === id);
  }

  private host(): KaraokeMember | undefined {
    return this.roomState.members.find((member) => member.role === 'host');
  }

  joinMember(memberId: string, displayName: string, nowMs: number, role: KaraokeRole = 'singer'): KaraokeSessionResult {
    if (this.roomState.status === 'closed') return failure('INVALID_TRANSITION', '房间已关闭', this.roomState);
    if (this.roomState.members.length >= KARAOKE_LIMITS.maxMembers) return failure('ROOM_FULL', '房间成员已满', this.roomState);
    const id = text(memberId);
    const name = text(displayName);
    if (!id || !name) return failure('INVALID_INPUT', '成员 ID 和昵称不能为空', this.roomState);
    if (role === 'host') return failure('INVALID_INPUT', '房间只能有一个主持人', this.roomState);
    if (this.member(id)) return failure('DUPLICATE_ID', '成员 ID 已存在', this.roomState);
    const at = monotonic(nowMs, this.roomState.hostMonotonicMs);
    const member = Object.freeze({
      id,
      displayName: name,
      role,
      ready: false,
      connected: true,
      joinedAtMs: at,
      lastSeenAtMs: at,
    });
    return this.succeed({
      ...this.roomState,
      hostMonotonicMs: at,
      members: frozenArray([...this.roomState.members, member]),
    });
  }

  setReady(actorId: string, memberId: string, ready: boolean, nowMs: number): KaraokeSessionResult {
    const actor = this.member(actorId);
    const target = this.member(memberId);
    if (!actor) return failure('MEMBER_NOT_FOUND', '操作成员不存在', this.roomState);
    if (!target) return failure('MEMBER_NOT_FOUND', '目标成员不存在', this.roomState);
    if (this.roomState.status === 'closed') return failure('INVALID_TRANSITION', '房间已关闭', this.roomState);
    if (target.role === 'listener') return failure('INVALID_INPUT', '听众不能准备演唱', this.roomState);
    if (actor.id !== target.id && actor.role !== 'host') return failure('HOST_REQUIRED', '只有本人或主持人可修改准备状态', this.roomState);
    if (!target.connected) return failure('INVALID_TRANSITION', '断线成员不能准备', this.roomState);
    const at = monotonic(nowMs, this.roomState.hostMonotonicMs);
    return this.succeed({
      ...this.roomState,
      hostMonotonicMs: at,
      members: frozenArray(this.roomState.members.map((member) => member.id === memberId
        ? memberWith(member, { ready, lastSeenAtMs: at })
        : member)),
    });
  }

  addQueueItem(actorId: string, input: KaraokeQueueAdd, nowMs: number): KaraokeSessionResult {
    const actor = this.member(actorId);
    if (!actor) return failure('MEMBER_NOT_FOUND', '操作成员不存在', this.roomState);
    if (actor.role === 'listener') return failure('HOST_REQUIRED', '听众不能添加 K 歌', this.roomState);
    if (this.roomState.status === 'closed' || this.roomState.status === 'results') {
      return failure('INVALID_TRANSITION', '当前状态不能添加歌曲', this.roomState);
    }
    if (this.roomState.queue.length >= KARAOKE_LIMITS.maxQueueItems) return failure('QUEUE_FULL', 'K 歌队列已满', this.roomState);
    const recordingId = text(input?.recordingId);
    if (!recordingId || !QUEUE_MODES.has(input?.mode)) return failure('INVALID_INPUT', '歌曲或 K 歌模式无效', this.roomState);
    if (this.roomState.queue.some((item) => item.recordingId === recordingId
      && ['queued', 'countdown', 'singing'].includes(item.state))) {
      return failure('INVALID_INPUT', '同一歌曲已经在当前 K 歌队列中', this.roomState);
    }
    const singerIds = [...new Set((input.singerIds?.length ? input.singerIds : [actor.id])
      .filter((id): id is string => typeof id === 'string' && !!id.trim()))];
    if (singerIds.length === 0) return failure('INVALID_INPUT', '至少需要一位演唱成员', this.roomState);
    if (input.mode === 'solo' && singerIds.length !== 1) return failure('INVALID_INPUT', 'solo 队列必须只有一位演唱者', this.roomState);
    if (singerIds.some((id) => !this.member(id))) return failure('MEMBER_NOT_FOUND', '队列包含不存在的成员', this.roomState);
    if (singerIds.some((id) => this.member(id)?.role === 'listener')) {
      return failure('INVALID_INPUT', '听众不能加入演唱队列', this.roomState);
    }
    const itemId = text(input.itemId) || `${recordingId}:${this.roomState.revision + 1}`;
    if (this.roomState.queue.some((item) => item.id === itemId)) return failure('DUPLICATE_ID', '队列项 ID 已存在', this.roomState);
    const at = monotonic(nowMs, this.roomState.hostMonotonicMs);
    const item: KaraokeQueueItem = Object.freeze({
      id: itemId,
      recordingId,
      mode: input.mode,
      singerIds: frozenArray(singerIds),
      state: 'queued',
    });
    return this.succeed({
      ...this.roomState,
      hostMonotonicMs: at,
      queue: frozenArray([...this.roomState.queue, item]),
    });
  }

  removeQueueItem(actorId: string, itemId: string, nowMs: number): KaraokeSessionResult {
    const actor = this.member(actorId);
    const item = this.roomState.queue.find((candidate) => candidate.id === itemId);
    if (!actor) return failure('MEMBER_NOT_FOUND', '操作成员不存在', this.roomState);
    if (!item) return failure('ITEM_NOT_FOUND', '队列项不存在', this.roomState);
    if (item.id === this.roomState.currentItemId) return failure('INVALID_TRANSITION', '当前歌曲不能直接从队列移除', this.roomState);
    if (actor.role !== 'host' && !item.singerIds.includes(actor.id)) {
      return failure('HOST_REQUIRED', '只有主持人或该曲演唱者可移除', this.roomState);
    }
    const at = monotonic(nowMs, this.roomState.hostMonotonicMs);
    return this.succeed({
      ...this.roomState,
      hostMonotonicMs: at,
      queue: frozenArray(this.roomState.queue.filter((candidate) => candidate.id !== itemId)),
    });
  }

  startCountdown(actorId: string, nowMs: number, durationMs = 3000): KaraokeSessionResult {
    const actor = this.member(actorId);
    if (!actor || actor.role !== 'host') return failure('HOST_REQUIRED', '只有主持人可开始倒计时', this.roomState);
    if (this.roomState.status !== 'lobby') return failure('INVALID_TRANSITION', '只有 lobby 可开始倒计时', this.roomState);
    const item = this.roomState.queue.find((candidate) => candidate.state === 'queued');
    if (!item) return failure('INVALID_TRANSITION', 'K 歌队列为空', this.roomState);
    for (const singerId of item.singerIds) {
      const singer = this.member(singerId);
      if (!singer?.connected || !singer.ready) return failure('INVALID_TRANSITION', '演唱成员尚未在线并准备', this.roomState);
    }
    const at = monotonic(nowMs, this.roomState.hostMonotonicMs);
    const safeDuration = Math.max(0, Math.min(30_000, Number.isFinite(durationMs) ? durationMs : 3000));
    return this.succeed({
      ...this.roomState,
      status: 'countdown',
      hostMonotonicMs: at,
      currentItemId: item.id,
      countdownEndsAtMs: at + safeDuration,
      queue: frozenArray(this.roomState.queue.map((candidate) => candidate.id === item.id
        ? itemWith(candidate, { state: 'countdown' })
        : candidate)),
    });
  }

  beginSinging(actorId: string, nowMs: number): KaraokeSessionResult {
    const actor = this.member(actorId);
    if (!actor || actor.role !== 'host') return failure('HOST_REQUIRED', '只有主持人可开始演唱', this.roomState);
    if (this.roomState.status !== 'countdown' || !this.roomState.currentItemId) {
      return failure('INVALID_TRANSITION', '当前不在倒计时', this.roomState);
    }
    const at = monotonic(nowMs, this.roomState.hostMonotonicMs);
    if (this.roomState.countdownEndsAtMs !== undefined && at < this.roomState.countdownEndsAtMs) {
      return failure('INVALID_TRANSITION', '倒计时尚未结束', this.roomState);
    }
    const current = this.roomState.queue.find((item) => item.id === this.roomState.currentItemId);
    if (!current || current.singerIds.every((id) => !this.member(id)?.connected)) {
      return failure('INVALID_TRANSITION', '当前歌曲没有在线演唱者', this.roomState);
    }
    return this.succeed({
      ...this.roomState,
      status: 'singing',
      hostMonotonicMs: at,
      countdownEndsAtMs: undefined,
      queue: frozenArray(this.roomState.queue.map((candidate) => candidate.id === this.roomState.currentItemId
        ? itemWith(candidate, { state: 'singing' })
        : candidate)),
    });
  }

  pause(actorId: string, nowMs: number): KaraokeSessionResult {
    const actor = this.member(actorId);
    if (!actor || actor.role !== 'host') return failure('HOST_REQUIRED', '只有主持人可暂停', this.roomState);
    if (this.roomState.status !== 'singing') return failure('INVALID_TRANSITION', '只有演唱中可暂停', this.roomState);
    return this.succeed({ ...this.roomState, status: 'paused', hostMonotonicMs: monotonic(nowMs, this.roomState.hostMonotonicMs) });
  }

  resume(actorId: string, nowMs: number): KaraokeSessionResult {
    const actor = this.member(actorId);
    if (!actor || actor.role !== 'host') return failure('HOST_REQUIRED', '只有主持人可继续', this.roomState);
    if (this.roomState.status !== 'paused') return failure('INVALID_TRANSITION', '当前未暂停', this.roomState);
    return this.succeed({ ...this.roomState, status: 'singing', hostMonotonicMs: monotonic(nowMs, this.roomState.hostMonotonicMs) });
  }

  finishCurrent(actorId: string, nowMs: number, score?: KaraokeScore): KaraokeSessionResult {
    const actor = this.member(actorId);
    if (!actor || actor.role !== 'host') return failure('HOST_REQUIRED', '只有主持人可结算', this.roomState);
    if ((this.roomState.status !== 'singing' && this.roomState.status !== 'paused') || !this.roomState.currentItemId) {
      return failure('INVALID_TRANSITION', '当前没有可结算歌曲', this.roomState);
    }
    const currentId = this.roomState.currentItemId;
    const queue = this.roomState.queue.map((item) => item.id === currentId
      ? itemWith(item, { state: 'scored', ...(score ? { score: deepFreezeClone(score) } : {}) })
      : item);
    const hasQueued = queue.some((item) => item.state === 'queued');
    return this.succeed({
      ...this.roomState,
      status: hasQueued ? 'lobby' : 'results',
      hostMonotonicMs: monotonic(nowMs, this.roomState.hostMonotonicMs),
      currentItemId: undefined,
      countdownEndsAtMs: undefined,
      queue: frozenArray(queue),
    });
  }

  skipCurrent(actorId: string, nowMs: number): KaraokeSessionResult {
    const actor = this.member(actorId);
    if (!actor || actor.role !== 'host') return failure('HOST_REQUIRED', '只有主持人可跳歌', this.roomState);
    if (!['countdown', 'singing', 'paused'].includes(this.roomState.status) || !this.roomState.currentItemId) {
      return failure('INVALID_TRANSITION', '当前没有可跳过的歌曲', this.roomState);
    }
    const currentId = this.roomState.currentItemId;
    const queue = this.roomState.queue.map((item) => item.id === currentId
      ? itemWith(item, { state: 'skipped' })
      : item);
    const hasQueued = queue.some((item) => item.state === 'queued');
    return this.succeed({
      ...this.roomState,
      status: hasQueued ? 'lobby' : 'results',
      hostMonotonicMs: monotonic(nowMs, this.roomState.hostMonotonicMs),
      currentItemId: undefined,
      countdownEndsAtMs: undefined,
      queue: frozenArray(queue),
    });
  }

  disconnect(memberId: string, nowMs: number): KaraokeSessionResult {
    const member = this.member(memberId);
    if (!member) return failure('MEMBER_NOT_FOUND', '成员不存在', this.roomState);
    const at = monotonic(nowMs, this.roomState.hostMonotonicMs);
    const members = this.roomState.members.map((candidate) => candidate.id === memberId
      ? memberWith(candidate, { connected: false, ready: false, lastSeenAtMs: at })
      : candidate);
    const current = this.roomState.queue.find((item) => item.id === this.roomState.currentItemId);
    const losesCountdownSinger = this.roomState.status === 'countdown'
      && !!current
      && current.singerIds.includes(memberId)
      && current.singerIds.every((id) => id === memberId || !members.find((candidate) => candidate.id === id)?.connected);
    return this.succeed({
      ...this.roomState,
      ...(losesCountdownSinger ? {
        status: 'lobby' as const,
        currentItemId: undefined,
        countdownEndsAtMs: undefined,
        queue: frozenArray(this.roomState.queue.map((item) => item.id === current?.id
          ? itemWith(item, { state: 'queued' })
          : item)),
      } : {}),
      hostMonotonicMs: at,
      members: frozenArray(members),
    });
  }

  reconnect(memberId: string, nowMs: number): KaraokeSessionResult {
    const member = this.member(memberId);
    if (!member) return failure('MEMBER_NOT_FOUND', '成员不存在', this.roomState);
    if (this.roomState.status === 'closed') return failure('INVALID_TRANSITION', '房间已关闭', this.roomState);
    const at = monotonic(nowMs, this.roomState.hostMonotonicMs);
    return this.succeed({
      ...this.roomState,
      hostMonotonicMs: at,
      members: frozenArray(this.roomState.members.map((candidate) => candidate.id === memberId
        ? memberWith(candidate, { connected: true, lastSeenAtMs: at })
        : candidate)),
    });
  }

  restoreQueue(actorId: string, items: readonly KaraokeQueueItem[], nowMs: number): KaraokeSessionResult {
    const actor = this.member(actorId);
    if (!actor || actor.role !== 'host') return failure('HOST_REQUIRED', '只有主持人可恢复 K 歌队列', this.roomState);
    if (this.roomState.status === 'closed') return failure('INVALID_TRANSITION', '房间已关闭', this.roomState);
    if (!Array.isArray(items) || items.length > KARAOKE_LIMITS.maxQueueItems) return failure('QUEUE_FULL', '恢复队列超过限制', this.roomState);
    const memberIds = new Set(this.roomState.members.map((member) => member.id));
    const restored = items.map(cloneQueueItem);
    if (restored.some((item) => item === null)) return failure('INVALID_INPUT', '恢复队列包含损坏项', this.roomState);
    const queue = (restored as KaraokeQueueItem[])
      .filter((item) => item.singerIds.every((id) => memberIds.has(id)))
      .map((item) => itemWith(item, { state: 'queued', score: undefined }));
    if (queue.length !== items.length || new Set(queue.map((item) => item.id)).size !== queue.length) {
      return failure('INVALID_INPUT', '恢复队列成员或 ID 无效', this.roomState);
    }
    return this.succeed({
      ...this.roomState,
      status: 'lobby',
      hostMonotonicMs: monotonic(nowMs, this.roomState.hostMonotonicMs),
      currentItemId: undefined,
      countdownEndsAtMs: undefined,
      queue: frozenArray(queue),
    });
  }

  stop(actorId: string, nowMs: number): KaraokeSessionResult {
    const actor = this.member(actorId);
    if (!actor || actor.role !== 'host') return failure('HOST_REQUIRED', '只有主持人可停止房间', this.roomState);
    if (this.roomState.status === 'closed') return failure('INVALID_TRANSITION', '房间已经关闭', this.roomState);
    return this.succeed({
      ...this.roomState,
      status: 'closed',
      hostMonotonicMs: monotonic(nowMs, this.roomState.hostMonotonicMs),
      currentItemId: undefined,
      countdownEndsAtMs: undefined,
    });
  }
}

export function createKaraokeSession(input: KaraokeSessionCreateInput): KaraokeSessionResult {
  return KaraokeSession.create(input);
}
