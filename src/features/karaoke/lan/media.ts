import type { KaraokeRole } from '../contracts';
import type { KaraokeLanGrantService } from './auth';
import {
  KARAOKE_LAN_LIMITS,
  lanFailure,
  lanOk,
  type KaraokeLanAuthorization,
  type KaraokeLanResult,
} from './types';

export type KaraokeLanMediaState =
  | 'connecting'
  | 'negotiating'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed';

export interface KaraokeLanOpusOptions {
  readonly codec: 'opus';
  readonly sampleRate: 48_000;
  readonly channels: 1 | 2;
  readonly application: 'lowdelay' | 'voip';
}

export interface KaraokeMediaPeerContext {
  readonly roomId: string;
  readonly memberId: string;
  readonly role: KaraokeRole;
  readonly recordingId: string;
  readonly opus: KaraokeLanOpusOptions;
}

export interface KaraokeMediaPeerAdapter {
  createOffer(): Promise<string>;
  applyAnswer(answerSdp: string): Promise<void>;
  addIceCandidate(candidate: string): Promise<void>;
  close(): void;
}

export interface KaraokeMediaAdapterFactory {
  createPeer(context: KaraokeMediaPeerContext): Promise<KaraokeMediaPeerAdapter>;
}

export interface KaraokeLanMediaSessionView {
  readonly sessionId: string;
  readonly roomId: string;
  readonly memberId: string;
  readonly recordingId: string;
  readonly state: KaraokeLanMediaState;
  readonly opus: KaraokeLanOpusOptions;
  readonly closeReason?: string;
}

interface MediaEntry {
  readonly sessionId: string;
  readonly owner: Readonly<{
    roomId: string;
    memberId: string;
    role: KaraokeRole;
  }>;
  readonly recordingId: string;
  readonly opus: KaraokeLanOpusOptions;
  state: KaraokeLanMediaState;
  closeReason?: string;
  readonly peer: KaraokeMediaPeerAdapter;
  readonly offerSdp: string;
}

let sessionCounter = 0;

function mediaFailure<T = never>(
  message: string,
  details?: Readonly<Record<string, string | number | boolean | null>>,
): KaraokeLanResult<T> {
  return lanFailure('MEDIA_UNAVAILABLE', message, true, details);
}

function view(entry: MediaEntry): KaraokeLanMediaSessionView {
  return Object.freeze({
    sessionId: entry.sessionId,
    roomId: entry.owner.roomId,
    memberId: entry.owner.memberId,
    recordingId: entry.recordingId,
    state: entry.state,
    opus: entry.opus,
    ...(entry.closeReason ? { closeReason: entry.closeReason } : {}),
  });
}

export class KaraokeLanMediaManager {
  private readonly sessions = new Map<string, MediaEntry>();

  constructor(
    private readonly adapter: KaraokeMediaAdapterFactory,
    private readonly grants: KaraokeLanGrantService,
    private readonly maxSessions = KARAOKE_LAN_LIMITS.maxMediaSessions,
  ) {}

  async start(
    authorization: KaraokeLanAuthorization,
    input: {
      readonly roomId: string;
      readonly recordingId: string;
      readonly channels?: 1 | 2;
      readonly nowMs: number;
    },
  ): Promise<KaraokeLanResult<{
    readonly sessionId: string;
    readonly offerSdp: string;
    readonly view: KaraokeLanMediaSessionView;
  }>> {
    const valid = this.grants.requireCapability(
      authorization,
      input?.roomId,
      'return-media',
      input?.nowMs,
    );
    if (!valid.ok) return valid;
    if (valid.value.role === 'listener') {
      return lanFailure('PERMISSION_DENIED', '听众不能发布 K 歌媒体', false);
    }
    const recordingId = typeof input?.recordingId === 'string'
      ? input.recordingId.trim()
      : '';
    if (!recordingId || recordingId.length > 256) {
      return lanFailure('INVALID_INPUT', '媒体 recordingId 无效', false);
    }
    if (input.channels !== undefined && input.channels !== 1 && input.channels !== 2) {
      return lanFailure('INVALID_INPUT', 'Opus 声道数无效', false);
    }
    if (!this.sessions.has(valid.value.memberId)) {
      this.pruneClosed();
      if (this.sessions.size >= this.maxSessions) {
        return lanFailure('LIMIT_EXCEEDED', '媒体会话数量已达到上限', false);
      }
    }
    this.closeMember(valid.value.memberId, 'replaced');
    const opus: KaraokeLanOpusOptions = Object.freeze({
      codec: 'opus' as const,
      sampleRate: 48_000 as const,
      channels: input.channels ?? 1,
      application: 'lowdelay' as const,
    });
    let peer: KaraokeMediaPeerAdapter | null = null;
    try {
      peer = await this.adapter.createPeer(Object.freeze({
        roomId: valid.value.roomId,
        memberId: valid.value.memberId,
        role: valid.value.role,
        recordingId,
        opus,
      }));
      const offerSdp = await peer.createOffer();
      if (typeof offerSdp !== 'string' || !offerSdp.trim()) {
        peer.close();
        return mediaFailure('媒体适配器未生成有效的 WebRTC offer');
      }
      sessionCounter += 1;
      const sessionId = `karaoke-media-${sessionCounter}`;
      const entry: MediaEntry = {
        sessionId,
        owner: Object.freeze({
          roomId: valid.value.roomId,
          memberId: valid.value.memberId,
          role: valid.value.role,
        }),
        recordingId,
        opus,
        state: 'negotiating',
        peer,
        offerSdp,
      };
      this.sessions.set(valid.value.memberId, entry);
      return lanOk(Object.freeze({
        sessionId,
        offerSdp,
        view: view(entry),
      }));
    } catch {
      peer?.close();
      return mediaFailure('无法建立 WebRTC/Opus 媒体会话');
    }
  }

  async applyAnswer(
    authorization: KaraokeLanAuthorization,
    sessionId: string,
    answerSdp: string,
    nowMs: number,
  ): Promise<KaraokeLanResult<KaraokeLanMediaSessionView>> {
    const selected = this.authorizedEntry(authorization, sessionId, nowMs);
    if (!selected.ok) return selected;
    if (typeof answerSdp !== 'string' || !answerSdp.trim()) {
      return lanFailure('INVALID_INPUT', 'WebRTC answer 无效', false);
    }
    const entry = selected.value;
    try {
      await entry.peer.applyAnswer(answerSdp);
      entry.state = 'connected';
      return lanOk(view(entry));
    } catch {
      this.closeEntry(entry, 'negotiation-failed');
      entry.state = 'failed';
      return mediaFailure('WebRTC answer 协商失败');
    }
  }

  async addIceCandidate(
    authorization: KaraokeLanAuthorization,
    sessionId: string,
    candidate: string,
    nowMs: number,
  ): Promise<KaraokeLanResult<KaraokeLanMediaSessionView>> {
    const selected = this.authorizedEntry(authorization, sessionId, nowMs);
    if (!selected.ok) return selected;
    if (typeof candidate !== 'string'
      || !candidate
      || candidate.length > KARAOKE_LAN_LIMITS.maxMessageBytes) {
      return lanFailure('INVALID_INPUT', 'ICE candidate 无效', false);
    }
    try {
      await selected.value.peer.addIceCandidate(candidate);
      return lanOk(view(selected.value));
    } catch {
      this.closeEntry(selected.value, 'ice-failed');
      return mediaFailure('ICE candidate 应用失败');
    }
  }

  markReconnecting(
    authorization: KaraokeLanAuthorization,
    sessionId: string,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanMediaSessionView> {
    const selected = this.authorizedEntry(authorization, sessionId, nowMs);
    if (!selected.ok) return selected;
    selected.value.state = 'reconnecting';
    return lanOk(view(selected.value));
  }

  markConnected(
    authorization: KaraokeLanAuthorization,
    sessionId: string,
    nowMs: number,
  ): KaraokeLanResult<KaraokeLanMediaSessionView> {
    const selected = this.authorizedEntry(authorization, sessionId, nowMs);
    if (!selected.ok) return selected;
    selected.value.state = 'connected';
    return lanOk(view(selected.value));
  }

  closeMember(memberId: string, reason = 'member-left'): boolean {
    const entry = this.sessions.get(memberId);
    if (!entry) return false;
    this.closeEntry(entry, reason);
    return true;
  }

  closeRoom(roomId: string, reason = 'room-closed'): number {
    let closed = 0;
    for (const entry of [...this.sessions.values()]) {
      if (entry.owner.roomId === roomId) {
        this.closeEntry(entry, reason);
        closed += 1;
      }
    }
    return closed;
  }

  closeAll(reason = 'shutdown'): number {
    let closed = 0;
    for (const entry of [...this.sessions.values()]) {
      this.closeEntry(entry, reason);
      closed += 1;
    }
    return closed;
  }

  snapshot(): readonly KaraokeLanMediaSessionView[] {
    return Object.freeze([...this.sessions.values()].map(view));
  }

  private authorizedEntry(
    authorization: KaraokeLanAuthorization,
    sessionId: string,
    nowMs: number,
  ): KaraokeLanResult<MediaEntry> {
    const valid = this.grants.requireCapability(
      authorization,
      authorization?.roomId,
      'return-media',
      nowMs,
    );
    if (!valid.ok) {
      if (valid.error.code === 'TOKEN_EXPIRED' || valid.error.code === 'TOKEN_INVALID') {
        this.closeMember(authorization.memberId, 'token-invalid');
      }
      return valid;
    }
    if (!sessionId) return lanFailure('INVALID_INPUT', '媒体会话 ID 无效', false);
    const entry = this.sessions.get(valid.value.memberId);
    if (!entry || entry.sessionId !== sessionId) {
      return lanFailure('INVALID_TRANSITION', '媒体会话不存在或已关闭', false);
    }
    if (entry.state === 'closed' || entry.state === 'failed') {
      return lanFailure('INVALID_TRANSITION', '媒体会话已结束', false);
    }
    return lanOk(entry);
  }

  private closeEntry(entry: MediaEntry, reason: string): void {
    if (entry.state === 'closed') return;
    try {
      entry.peer.close();
    } finally {
      entry.state = 'closed';
      entry.closeReason = reason;
    }
  }

  private pruneClosed(): void {
    for (const [memberId, entry] of this.sessions) {
      if (entry.state === 'closed' || entry.state === 'failed') {
        this.sessions.delete(memberId);
      }
    }
  }
}
