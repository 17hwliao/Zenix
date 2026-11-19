import type { KaraokeClientEvent, KaraokeRoomState, KaraokeSide } from '../contracts';
import { createKaraokeLanHost, type KaraokeLanHost } from './host';
import { normalizeKaraokeRoomCode } from './code';
import { KaraokeLanRateLimiter, KaraokeLanReconnectPolicy } from './protocol';
import { KaraokeLanSnapshotConsumer } from './snapshot';
import { KARAOKE_LAN_LIMITS, type KaraokeLanAuthorization, type KaraokeLanEnvelope, type KaraokeLanResult } from './types';
import { createKaraokeRoomNetwork, type KaraokeRoomNetwork, type KaraokeSocketEvent } from './network';
import {
  createKaraokeHandshakeKey, KaraokeSecureChannel, makeKaraokeChallenge,
  parseKaraokeAddress, validKaraokeEndpoint, type KaraokeHandshakeKey,
} from './secure-channel';

export interface KaraokeTransportError {
  code: string;
  message: string;
  recoverable: boolean;
}

interface JoinForm {
  address: string;
  roomCode: string;
  displayName: string;
  password?: string;
}

export interface KaraokeTransportState {
  phase: 'idle' | 'opening' | 'waiting' | 'connected' | 'reconnecting' | 'rejected' | 'closed' | 'failed';
  room?: KaraokeRoomState;
  memberId?: string;
  invitation?: { addresses: string[]; roomCode: string; passwordRequired: boolean };
  requests: { id: string; displayName: string; requestedAtMs: number; note: string }[];
  error?: KaraokeTransportError;
  clockOffsetMs: number;
  pendingScoreCount?: number;
  unsubmittedScoreCount?: number;
}

interface Peer {
  id: string;
  address: string;
  challenge?: string;
  channel?: KaraokeSecureChannel;
  inbound: Promise<void>;
  outbound: Promise<void>;
  pendingCount: number;
  queuedSend: number;
  inFlightScores: Set<number>;
  pendingId?: string;
  authorization?: KaraokeLanAuthorization;
  unsubscribe?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

interface Guest {
  form: JoinForm;
  endpoint: string;
  publicKey: string;
  peer?: Peer;
  consumer?: KaraokeLanSnapshotConsumer;
  memberId?: string;
  resume?: string;
  lastResponse: number;
  clockRtt: number;
  reconnect: KaraokeLanReconnectPolicy;
  retry?: ReturnType<typeof setTimeout>;
  offlineAt?: number;
  serial: number;
  pending: Map<number, Extract<KaraokeClientEvent, { type: 'score.line' }>>;
}

interface Host {
  engine: KaraokeLanHost;
  authorization: KaraokeLanAuthorization;
  key: KaraokeHandshakeKey;
  peers: Map<string, Peer>;
  authorizations: Map<string, KaraokeLanAuthorization>;
  attempts: KaraokeLanRateLimiter;
}

const INITIAL: KaraokeTransportState = { phase: 'idle', requests: [], clockOffsetMs: 0, pendingScoreCount: 0, unsubmittedScoreCount: 0 };
const MAX_PENDING_LINES = 128;
const HANDSHAKE_TIMEOUT = 8_000;
const APPROVAL_TIMEOUT = 120_000;
const CHILD_EVENTS = new Set(['member.ready', 'queue.add', 'queue.remove', 'score.line']);
let guestSequence = 0;

function peerFor(id: string, address: string): Peer {
  return { id, address, inbound: Promise.resolve(), outbound: Promise.resolve(), pendingCount: 0, queuedSend: 0, inFlightScores: new Set(), cancelled: false };
}

function failure(code: string, message: string, recoverable = true): KaraokeTransportError {
  return { code, message, recoverable };
}

function asError(error: unknown): KaraokeTransportError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error && 'recoverable' in error) return error as KaraokeTransportError;
  return failure('TRANSPORT_FAILED', error instanceof Error ? error.message : 'K 歌连接失败，请重试');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('K 歌消息格式无效');
  return value as Record<string, unknown>;
}

function readText(value: unknown, length: number): string {
  if (typeof value !== 'string' || value.length > length) throw Error('K 歌连接信息无效');
  return value;
}

function readId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw Error('K 歌消息序号无效');
  return value;
}

function unwrap<T>(value: KaraokeLanResult<T>): T {
  if (!value.ok) throw value.error;
  return value.value;
}

export class KaraokeRoomTransport {
  private snapshot: KaraokeTransportState = INITIAL;
  private readonly listeners = new Set<(state: KaraokeTransportState) => void>();
  private readonly network: KaraokeRoomNetwork;
  private host?: Host;
  private guest?: Guest;
  private unlisten?: () => void;
  private heartbeat?: ReturnType<typeof setInterval>;
  private operation = 0;
  private teardown = Promise.resolve();

  constructor(private readonly mobile: boolean, network?: KaraokeRoomNetwork) {
    this.network = network ?? createKaraokeRoomNetwork(mobile);
  }

  get state(): KaraokeTransportState { return this.snapshot; }

  subscribe(listener: (state: KaraokeTransportState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  private update(fields: Partial<KaraokeTransportState>) {
    this.snapshot = { ...this.snapshot, ...fields };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private report(error: unknown) {
    this.update({ error: asError(error) });
  }

  dismissError() { this.update({ error: undefined }); }

  private async observe(operation: number) {
    const unlisten = await this.network.observe(event => {
      if (operation === this.operation) this.onSocket(event);
    });
    if (operation !== this.operation) {
      unlisten();
      return false;
    }
    this.unlisten = unlisten;
    return true;
  }

  async create(input: { displayName: string; password?: string }): Promise<void> {
    if (this.mobile) return;
    const operation = ++this.operation;
    await this.closeActive();
    if (operation !== this.operation) return;
    this.update({ ...INITIAL, phase: 'opening', error: undefined, room: undefined, memberId: undefined, invitation: undefined });
    try {
      if (!await this.observe(operation)) return;
      const key = await createKaraokeHandshakeKey();
      if (operation !== this.operation) return;
      const engine = unwrap(createKaraokeLanHost({
        hostId: crypto.randomUUID(), hostDisplayName: input.displayName,
        joinPassword: input.password, nowMs: Date.now(),
      }));
      const started = unwrap(engine.start(Date.now()));
      const host: Host = { engine, authorization: started.authorization, key, peers: new Map(), authorizations: new Map(), attempts: new KaraokeLanRateLimiter(8) };
      this.host = host;
      const endpoints = await this.network.invoke<string[]>({ action: 'listen' });
      if (operation !== this.operation) return;
      if (!Array.isArray(endpoints) || !endpoints.length || !endpoints.every(validKaraokeEndpoint)) throw Error('没有可用的局域网接口');
      this.update({
        phase: 'connected', memberId: started.authorization.memberId, room: engine.state,
        invitation: { addresses: endpoints.map(endpoint => endpoint + '#' + key.publicKey), roomCode: engine.code, passwordRequired: !!input.password },
      });
      this.heartbeat = setInterval(() => this.tickHost(host), 500);
    } catch (error) {
      if (operation !== this.operation) return;
      await this.closeActive();
      if (operation === this.operation) this.update({ phase: 'failed', error: asError(error) });
    }
  }

  async join(form: JoinForm): Promise<void> {
    const operation = ++this.operation;
    await this.closeActive();
    if (operation !== this.operation) return;
    this.update({ ...INITIAL, phase: 'opening', error: undefined, room: undefined, memberId: undefined, invitation: undefined });
    try {
      const { endpoint, publicKey } = parseKaraokeAddress(form.address);
      const roomCode = normalizeKaraokeRoomCode(form.roomCode);
      if (!roomCode || !form.displayName.trim() || form.displayName.trim().length > KARAOKE_LAN_LIMITS.maxDisplayNameLength
        || (form.password?.length ?? 0) > KARAOKE_LAN_LIMITS.maxPasswordLength) {
        throw failure('INVALID_INPUT', '请填写六位房号、昵称及有效口令');
      }
      if (!await this.observe(operation)) return;
      const guest: Guest = {
        form: { ...form, roomCode, displayName: form.displayName.trim() }, endpoint, publicKey,
        lastResponse: Date.now(), clockRtt: Infinity,
        reconnect: new KaraokeLanReconnectPolicy(), serial: 0, pending: new Map(),
      };
      this.guest = guest;
      await this.connectGuest(guest);
      if (this.guest === guest) this.heartbeat = setInterval(() => this.tickGuest(guest), KARAOKE_LAN_LIMITS.heartbeatIntervalMs);
    } catch (error) {
      if (operation !== this.operation) return;
      await this.closeActive();
      if (operation === this.operation) this.update({ phase: 'failed', error: asError(error) });
    }
  }

  private async connectGuest(guest: Guest) {
    const peer = peerFor('guest-' + ++guestSequence, guest.endpoint);
    guest.peer = peer;
    peer.timeout = setTimeout(() => this.loseGuest(guest, peer, 'UNREACHABLE'), HANDSHAKE_TIMEOUT);
    await this.network.invoke({ action: 'connect', address: guest.endpoint, id: peer.id });
  }

  private onSocket(event: KaraokeSocketEvent) {
    const host = this.host;
    if (host) {
      if (event.type === 'open') {
        const peer = peerFor(event.id, event.address);
        peer.challenge = makeKaraokeChallenge();
        host.peers.set(peer.id, peer);
        peer.timeout = setTimeout(() => this.dropHostPeer(host, peer), HANDSHAKE_TIMEOUT);
        void this.rawSend(peer, JSON.stringify({ v: 1, challenge: peer.challenge })).catch(() => this.dropHostPeer(host, peer));
      } else {
        const peer = host.peers.get(event.id);
        if (!peer) return;
        if (event.type === 'message' && typeof event.data === 'string') {
          this.enqueue(peer, () => this.receiveHost(host, peer, event.data!), () => this.dropHostPeer(host, peer));
        } else this.enqueue(peer, async () => this.dropHostPeer(host, peer), () => this.dropHostPeer(host, peer));
      }
      return;
    }
    const guest = this.guest;
    const peer = guest?.peer;
    if (!guest || !peer || peer.id !== event.id) return;
    if (event.type === 'message' && typeof event.data === 'string') {
      this.enqueue(peer, () => this.receiveGuest(guest, peer, event.data!), error => this.loseGuest(guest, peer, asError(error).code));
    } else if (event.type !== 'open') {
      this.enqueue(peer, async () => this.loseGuest(guest, peer, event.code), () => this.loseGuest(guest, peer, event.code));
    }
  }

  private enqueue(peer: Peer, task: () => Promise<void>, onError: (error: unknown) => void) {
    if (peer.pendingCount >= 32) {
      onError(Error('K 歌消息积压'));
      return;
    }
    peer.pendingCount++;
    peer.inbound = peer.inbound.then(async () => {
      if (!peer.cancelled) await task();
    }).catch(onError).finally(() => { peer.pendingCount--; });
  }

  private rawSend(peer: Peer, data: string) {
    if (peer.cancelled) return Promise.reject(Error('K 歌连接已关闭'));
    return this.network.invoke({ action: 'send', id: peer.id, data });
  }

  private sendSecure(peer: Peer, message: unknown): Promise<void> {
    if (peer.queuedSend >= 32) return Promise.reject(Error('K 歌消息积压'));
    peer.queuedSend++;
    const outgoing = peer.outbound.then(async () => {
      if (!peer.channel || peer.cancelled) throw Error('K 歌连接已关闭');
      const frame = await peer.channel.seal(message);
      await this.rawSend(peer, frame);
    });
    // A failed encrypted write consumed a sequence. No further frames should
    // continue on that connection. Callers close or reconnect on rejection.
    peer.outbound = outgoing;
    void outgoing.finally(() => { peer.queuedSend--; }).catch(() => {});
    return outgoing;
  }

  private async receiveHost(host: Host, peer: Peer, data: string) {
    if (!peer.channel) {
      if (!host.attempts.consume(peer.address, Date.now()).ok || data.length > 2_048) throw Error('加入尝试过多');
      const raw = object(JSON.parse(data));
      if (raw.v !== 1 || !peer.challenge) throw Error('连接协议不兼容');
      peer.channel = await KaraokeSecureChannel.create('host', host.key, readText(raw.key, 87), peer.challenge);
      const message = await peer.channel.open(readText(raw.data, 1_900));
      if (this.host !== host || peer.cancelled) return;
      clearTimeout(peer.timeout);
      try {
        if (message.op === 'resume') {
          const resume = readText(message.resume, 128);
          const authorization = host.authorizations.get(resume);
          if (!authorization) throw failure('MEMBER_NOT_FOUND', '房间授权已过期，请重新申请加入', false);
          if ([...host.peers.values()].some(other => other !== peer && other.authorization?.memberId === authorization.memberId)) {
            // Keep the current socket. A recent reconnect attempt will retry
            // once the original close has reached the server.
            throw failure('CONNECTION_BUSY', '正在等待旧连接关闭');
          }
          unwrap(host.engine.reconnect(authorization, Date.now()));
          await this.attachApproved(host, peer, authorization, resume);
        } else {
          if (message.op !== 'join') throw Error('加入请求无效');
          const pending = unwrap(host.engine.requestJoin({
            roomCode: readText(message.roomCode, 6),
            displayName: readText(message.displayName, KARAOKE_LAN_LIMITS.maxDisplayNameLength),
            password: readText(message.password, KARAOKE_LAN_LIMITS.maxPasswordLength),
            clientNonce: crypto.randomUUID(),
          }, Date.now()));
          peer.pendingId = pending.pendingId;
          peer.timeout = setTimeout(() => this.dropHostPeer(host, peer), APPROVAL_TIMEOUT);
          this.refreshHost(host);
          await this.sendSecure(peer, { op: 'waiting' });
        }
      } catch (error) {
        await this.sendSecure(peer, { op: 'denied', error: asError(error) });
        this.dropHostPeer(host, peer);
      }
      return;
    }
    if (!peer.authorization) throw Error('房间申请尚未批准');
    const message = await peer.channel.open(data);
    if (this.host !== host || peer.cancelled) return;
    if (message.op === 'ping') {
      const receivedAt = Date.now();
      const time = readId(message.time);
      const response = host.engine.handleClientEvent(peer.authorization, { type: 'clock.sample', clientSendMs: time }, receivedAt);
      if (!response.ok) throw response.error;
      await this.sendSecure(peer, { op: 'pong', time, receivedAt, sentAt: Date.now() });
      return;
    }
    if (message.op === 'leave') {
      unwrap(host.engine.leave(peer.authorization, Date.now()));
      this.dropHostPeer(host, peer);
      return;
    }
    if (message.op !== 'event') throw Error('K 歌操作无效');
    const event = object(message.event);
    if (typeof event.type !== 'string' || !CHILD_EVENTS.has(event.type)) throw Error('K 歌操作无效');
    const id = readId(message.id);
    const result = host.engine.handleClientEvent(peer.authorization, event as KaraokeClientEvent, Date.now());
    this.refreshHost(host);
    const accepted = result.ok && (result.value.status === 'applied' || result.value.status === 'duplicate' && result.value.type === event.type);
    const error = result.ok ? failure('STALE_SEQUENCE', '这条操作未得到房主确认') : result.error;
    await this.sendSecure(peer, { op: 'ack', id, ...(accepted ? {} : { error }) });
  }

  private async attachApproved(host: Host, peer: Peer, authorization: KaraokeLanAuthorization, resume: string) {
    peer.authorization = authorization;
    peer.pendingId = undefined;
    clearTimeout(peer.timeout);
    await this.sendSecure(peer, {
      op: 'welcome', roomId: host.engine.id, hostId: host.authorization.memberId,
      memberId: authorization.memberId, resume, hostTime: Date.now(),
    });
    if (this.host !== host || peer.cancelled) return;
    peer.unsubscribe = unwrap(host.engine.subscribe(authorization, envelope => {
      void this.sendSecure(peer, { op: 'snapshot', envelope }).catch(() => this.dropHostPeer(host, peer));
    }, Date.now()));
    this.refreshHost(host);
  }

  approve(id: string, role: 'singer' | 'listener', side?: 'blue' | 'red') {
    const host = this.host;
    const peer = [...(host?.peers.values() ?? [])].find(candidate => candidate.pendingId === id);
    if (!host || !peer) return;
    try {
      const { authorization } = unwrap(host.engine.approveJoin(host.authorization, id, Date.now(), role, side));
      const resume = makeKaraokeChallenge();
      host.authorizations.set(resume, authorization);
      void this.attachApproved(host, peer, authorization, resume).catch(error => {
        if (this.host !== host) return;
        this.dropHostPeer(host, peer);
        this.report(error);
      });
    } catch (error) { this.report(error); }
  }

  reject(id: string) {
    const host = this.host;
    const peer = [...(host?.peers.values() ?? [])].find(candidate => candidate.pendingId === id);
    if (!host || !peer) return;
    try {
      unwrap(host.engine.rejectJoin(host.authorization, id, Date.now()));
      peer.pendingId = undefined;
      this.refreshHost(host);
      void this.sendSecure(peer, { op: 'denied', error: failure('JOIN_REJECTED', '房主拒绝了加入申请', false) })
        .finally(() => this.dropHostPeer(host, peer)).catch(() => {});
    } catch (error) { this.report(error); }
  }

  private dropHostPeer(host: Host, peer: Peer) {
    if (host.peers.get(peer.id) !== peer) return;
    host.peers.delete(peer.id);
    this.releasePeer(peer);
    if (this.host === host && host.engine.status === 'started') {
      if (peer.pendingId) host.engine.rejectJoin(host.authorization, peer.pendingId, Date.now());
      if (peer.authorization) host.engine.disconnect(peer.authorization, Date.now());
      this.refreshHost(host);
    }
  }

  private refreshHost(host: Host) {
    if (this.host !== host) return;
    const joined = host.engine.pendingJoins(host.authorization, Date.now());
    const requests = joined.ok ? joined.value.flatMap(entry => {
      const peer = [...host.peers.values()].find(candidate => candidate.pendingId === entry.pendingId);
      return peer ? [{ id: entry.pendingId, displayName: entry.displayName, requestedAtMs: entry.requestedAtMs, note: peer.address }] : [];
    }) : [];
    if (this.state.room === host.engine.state && JSON.stringify(requests) === JSON.stringify(this.state.requests)) return;
    this.update({ room: host.engine.state, requests });
  }

  private tickHost(host: Host) {
    if (this.host !== host) return;
    const tick = host.engine.tick(Date.now());
    if (!tick.ok) return;
    for (const [resume, authorization] of host.authorizations) {
      if (!host.engine.state.members.some(member => member.id === authorization.memberId)) host.authorizations.delete(resume);
    }
    for (const peer of host.peers.values()) {
      if (peer.authorization && [...tick.value.disconnected, ...tick.value.removed].includes(peer.authorization.memberId)) this.dropHostPeer(host, peer);
    }
    if (tick.value.closed) void this.closeRoom();
    else this.refreshHost(host);
  }

  private async receiveGuest(guest: Guest, peer: Peer, data: string) {
    if (!peer.channel) {
      if (data.length > 256) throw Error('房主握手无效');
      const challenge = object(JSON.parse(data));
      if (challenge.v !== 1) throw failure('UNSUPPORTED_VERSION', '房间连接版本不兼容', false);
      const key = await createKaraokeHandshakeKey();
      peer.channel = await KaraokeSecureChannel.create('guest', key, guest.publicKey, readText(challenge.challenge, 32));
      const message = guest.resume
        ? { op: 'resume', resume: guest.resume }
        : { op: 'join', roomCode: guest.form.roomCode, displayName: guest.form.displayName, password: guest.form.password ?? '' };
      await this.rawSend(peer, JSON.stringify({ v: 1, key: key.publicKey, data: await peer.channel.seal(message) }));
      return;
    }
    const message = await peer.channel.open(data);
    if (this.guest !== guest || guest.peer !== peer || peer.cancelled) return;
    const now = Date.now();
    guest.lastResponse = now;
    switch (message.op) {
      case 'waiting':
        clearTimeout(peer.timeout);
        peer.timeout = setTimeout(() => this.loseGuest(guest, peer, 'APPROVAL_TIMEOUT'), APPROVAL_TIMEOUT);
        this.update({ phase: 'waiting' });
        return;
      case 'denied': {
        const error = this.wireError(message.error);
        if (error.code === 'CONNECTION_BUSY' && guest.resume) this.loseGuest(guest, peer);
        else {
          this.releasePeer(peer);
          guest.peer = undefined;
          if (['MEMBER_NOT_FOUND', 'TOKEN_EXPIRED', 'ROOM_CLOSED'].includes(error.code)) guest.resume = undefined;
          const dropped = guest.pending.size;
          guest.pending.clear();
          this.updatePendingScores(guest, dropped);
          this.update({ phase: error.code === 'JOIN_REJECTED' ? 'rejected' : 'failed', error });
        }
        return;
      }
      case 'welcome': {
        clearTimeout(peer.timeout);
        peer.timeout = setTimeout(() => this.loseGuest(guest, peer, 'UNREACHABLE'), HANDSHAKE_TIMEOUT);
        const hostId = readText(message.hostId, 128);
        const roomId = readText(message.roomId, 128);
        const memberId = readText(message.memberId, 128);
        if (guest.memberId && guest.memberId !== memberId) throw Error('重连成员身份变化');
        guest.resume = readText(message.resume, 128);
        guest.memberId = memberId;
        guest.consumer ??= new KaraokeLanSnapshotConsumer({ hostId, roomId, memberId, roomCode: guest.form.roomCode });
        if (!Number.isFinite(guest.clockRtt)) this.update({ clockOffsetMs: readId(message.hostTime) - now });
        await this.sendSecure(peer, { op: 'ping', time: now });
        return;
      }
      case 'snapshot': {
        const envelope = object(message.envelope) as unknown as KaraokeLanEnvelope;
        if (envelope.type === 'room.error') {
          this.report(this.wireError(envelope.payload));
          return;
        }
        if (envelope.type !== 'room.snapshot' && envelope.type !== 'room.closed') return;
        if (!guest.consumer) throw Error('房间授权尚未确认');
        const restored = unwrap(guest.consumer.accept(envelope)).state;
        if (restored.status === 'closed') {
          this.update({ phase: 'closed', room: restored });
          await this.closeActive();
          return;
        }
        const previousPhase = this.state.phase;
        clearTimeout(peer.timeout);
        guest.offlineAt = undefined;
        guest.reconnect.reset();
        this.update({ phase: 'connected', memberId: guest.memberId, room: restored, ...(previousPhase === 'reconnecting' ? { error: undefined } : {}) });
        this.dropStaleScores(guest, peer, restored);
        this.flushGuestScores(guest, peer);
        return;
      }
      case 'pong': {
        const time = readId(message.time);
        const start = readId(message.receivedAt);
        const end = readId(message.sentAt);
        const rtt = now - time - (end - start);
        if (rtt >= 0 && rtt <= guest.clockRtt) {
          guest.clockRtt = rtt;
          this.update({ clockOffsetMs: ((start - time) + (end - now)) / 2 });
        }
        return;
      }
      case 'ack': {
        const id = readId(message.id);
        peer.inFlightScores.delete(id);
        if (guest.pending.delete(id)) this.updatePendingScores(guest, message.error ? 1 : 0);
        if (message.error) this.report(this.wireError(message.error));
        this.flushGuestScores(guest, peer);
        return;
      }
      default:
        throw Error('房主消息无法识别');
    }
  }

  private wireError(value: unknown): KaraokeTransportError {
    const error = object(value);
    return failure(readText(error.code, 80), readText(error.message, 500), error.recoverable === true);
  }

  private dropStaleScores(guest: Guest, peer: Peer, room: KaraokeRoomState) {
    let dropped = 0;
    for (const [id, line] of guest.pending) {
      if (peer.inFlightScores.has(id)) continue;
      const settling = line.itemId === room.battle.itemId && room.battle.settlingUntilMs !== undefined;
      if ((!settling && line.itemId !== room.currentItemId) || line.revision !== room.battle.revision || Date.now() - line.clientSentAtMs > KARAOKE_LAN_LIMITS.disconnectGraceMs) {
        guest.pending.delete(id);
        dropped++;
      }
    }
    if (dropped) {
      this.updatePendingScores(guest, dropped);
      this.report(failure('SCORE_NOT_EVALUATED', '上轮尚未确认的分数已失效，记为未评估'));
    }
  }

  private tickGuest(guest: Guest) {
    if (this.guest !== guest || !guest.peer?.channel || this.state.phase !== 'connected') return;
    const peer = guest.peer;
    const time = Date.now();
    if (time - guest.lastResponse > KARAOKE_LAN_LIMITS.heartbeatTimeoutMs) {
      this.loseGuest(guest, peer);
      return;
    }
    void this.sendSecure(peer, { op: 'ping', time }).catch(() => this.loseGuest(guest, peer));
  }

  private loseGuest(guest: Guest, peer: Peer, code?: string) {
    if (this.guest !== guest || guest.peer !== peer) return;
    this.releasePeer(peer);
    guest.peer = undefined;
    if (!guest.resume) {
      const error = code === 'PORT_REFUSED' ? failure('PORT_REFUSED', '房主端口拒绝连接，请核对端口或防火墙设置')
        : code === 'UNSUPPORTED_VERSION' ? failure(code, '房间连接版本不兼容', false)
        : code === 'APPROVAL_TIMEOUT' ? failure(code, '等待房主批准超时，可重新申请')
        : failure('UNREACHABLE', '未能与房主建立可信连接，请确认双方处于同一局域网并核对完整地址');
      this.update({ phase: 'failed', error });
      return;
    }
    this.scheduleReconnect(guest);
  }

  private scheduleReconnect(guest: Guest) {
    if (this.guest !== guest) return;
    if (guest.retry) clearTimeout(guest.retry);
    guest.offlineAt ??= Date.now();
    const delay = guest.reconnect.fail();
    if (!delay.ok || Date.now() - guest.offlineAt >= KARAOKE_LAN_LIMITS.disconnectGraceMs) {
      const dropped = guest.pending.size;
      guest.pending.clear();
      this.updatePendingScores(guest, dropped);
      this.update({ phase: 'failed', error: failure('RECONNECT_EXHAUSTED',
        dropped ? '重连失败，未确认的分数记为未评估' : '重连失败，请重新申请加入房间') });
      return;
    }
    this.update({ phase: 'reconnecting' });
    guest.retry = setTimeout(() => {
      guest.retry = undefined;
      if (this.guest !== guest) return;
      void this.connectGuest(guest).catch(() => {
        if (guest.peer) this.loseGuest(guest, guest.peer);
      });
    }, delay.value.delayMs);
  }

  private sendGuestEvent(guest: Guest, peer: Peer, id: number, event: KaraokeClientEvent) {
    void this.sendSecure(peer, { op: 'event', id, event }).catch(() => this.loseGuest(guest, peer));
  }

  private updatePendingScores(guest: Guest, dropped = 0) {
    this.update({ pendingScoreCount: guest.pending.size, unsubmittedScoreCount: (this.state.unsubmittedScoreCount ?? 0) + dropped });
  }

  private flushGuestScores(guest: Guest, peer: Peer) {
    if (this.state.phase !== 'connected') return;
    for (const [id, event] of guest.pending) {
      if (peer.inFlightScores.size >= 4) break;
      if (peer.inFlightScores.has(id)) continue;
      peer.inFlightScores.add(id);
      this.sendGuestEvent(guest, peer, id, event);
    }
  }

  send(event: KaraokeClientEvent) {
    const host = this.host;
    if (host) {
      const result = host.engine.handleClientEvent(host.authorization, event, Date.now());
      if (!result.ok) this.report(result.error);
      this.refreshHost(host);
      return;
    }
    const guest = this.guest;
    if (!guest || !guest.resume) return;
    const id = ++guest.serial;
    if (event.type === 'score.line' && (this.state.phase === 'connected' || this.state.phase === 'reconnecting')) {
      if (guest.pending.size >= MAX_PENDING_LINES) {
        this.updatePendingScores(guest, 1);
        this.report(failure('SCORE_NOT_EVALUATED', '尚未同步的分数过多，这句记为未评估'));
        return;
      }
      guest.pending.set(id, event);
      this.updatePendingScores(guest);
      if (guest.peer) this.flushGuestScores(guest, guest.peer);
      return;
    }
    if (event.type === 'score.line') return;
    if (this.state.phase === 'connected' && guest.peer) this.sendGuestEvent(guest, guest.peer, id, event);
  }

  private hostAction(action: (host: Host, now: number) => KaraokeLanResult<KaraokeRoomState>) {
    if (!this.host) return;
    const result = action(this.host, Date.now());
    if (!result.ok) this.report(result.error);
    this.refreshHost(this.host);
  }

  assignSide(id: string, side: KaraokeSide) { this.hostAction((host, now) => host.engine.assignSide(host.authorization, id, side, now)); }
  start(itemId: string) { this.hostAction((host, now) => host.engine.startQueueItem(host.authorization, itemId, now, 3000)); }
  pause() { this.hostAction((host, now) => host.engine.pause(host.authorization, now)); }
  resume() { this.hostAction((host, now) => host.engine.resume(host.authorization, now)); }
  skip() { this.hostAction((host, now) => host.engine.skipCurrent(host.authorization, now)); }
  finish() { this.hostAction((host, now) => host.engine.finishCurrent(host.authorization, now, true)); }
  restart() { this.hostAction((host, now) => host.engine.restart(host.authorization, now)); }

  async retry() {
    const guest = this.guest;
    if (!guest || this.state.phase !== 'failed') return;
    if (!guest.resume || Date.now() - (guest.offlineAt ?? 0) >= KARAOKE_LAN_LIMITS.disconnectGraceMs) {
      await this.join(guest.form);
      return;
    }
    guest.reconnect.reset();
    this.update({ error: undefined });
    this.scheduleReconnect(guest);
  }

  async closeRoom() {
    const operation = ++this.operation;
    await this.closeActive();
    if (operation === this.operation) this.update({ ...INITIAL, phase: 'closed', room: undefined, memberId: undefined, invitation: undefined, error: undefined });
  }

  async close() {
    const operation = ++this.operation;
    await this.closeActive();
    if (operation === this.operation) this.update({ ...INITIAL, room: undefined, memberId: undefined, invitation: undefined, error: undefined });
  }

  private releasePeer(peer: Peer, close = true) {
    peer.cancelled = true;
    clearTimeout(peer.timeout);
    peer.unsubscribe?.();
    if (close) void this.network.invoke({ action: 'close', id: peer.id }).catch(() => {});
  }

  private closeActive(): Promise<void> {
    // Serialize stop with disposal from older create/join operations so
    // their native cleanup cannot close a newer room.
    this.teardown = this.teardown.then(() => this.disposeActive());
    return this.teardown;
  }

  private async disposeActive() {
    const host = this.host;
    const guest = this.guest;
    this.host = undefined;
    this.guest = undefined;
    this.unlisten?.();
    this.unlisten = undefined;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    if (host) {
      if (host.engine.status === 'started') host.engine.stop(host.authorization, Date.now());
      await Promise.allSettled([...host.peers.values()].map(peer => peer.outbound));
      for (const peer of host.peers.values()) this.releasePeer(peer, false);
      host.peers.clear();
      host.authorizations.clear();
    }
    if (guest) {
      clearTimeout(guest.retry);
      guest.pending.clear();
      if (guest.peer) {
        if (guest.resume && guest.peer.channel) await this.sendSecure(guest.peer, { op: 'leave' }).catch(() => {});
        this.releasePeer(guest.peer, false);
      }
    }
    if (guest || host) await this.network.invoke({ action: 'stop' }).catch(() => {});
  }
}
