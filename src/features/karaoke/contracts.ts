/** Stable K-song boundary. Nothing in this module may mutate the ordinary player or personal library. */
export type KaraokePlatform = 'pc' | 'android';
export type KaraokeRole = 'host' | 'singer' | 'listener';
export type AccompanimentKind = 'local-file' | 'source-official' | 'separated' | 'channel-cancel';

export interface AccompanimentDescriptor {
  kind: AccompanimentKind;
  label: string;
  /** A private local path or source URL. Never include this value in room state or analytics. */
  uri: string;
  /** Present for derived audio so old separations cannot be reused for a different recording/model. */
  cacheKey?: string;
  fingerprint?: string;
  modelVersion?: string;
  /** Channel cancellation is a rehearsal fallback, never a professional pitch reference. */
  rehearsalOnly: boolean;
}

export interface PitchFrame {
  atMs: number;
  /** MIDI note number, or null when the analyzer cannot identify a stable pitch. */
  midi: number | null;
  confidence: number;
  energy: number;
}

export interface PitchNote {
  startMs: number;
  endMs: number;
  midi: number;
  lyric?: string;
}

export interface KaraokeLyricLine {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  translation?: string;
  notes: readonly PitchNote[];
}

export interface PitchTrack {
  schema: 1;
  source: 'midi' | 'ultrastar' | 'enhanced-lrc' | 'manual';
  lines: readonly KaraokeLyricLine[];
}

export interface KaraokeTrackDescriptor {
  schema: 1;
  recordingId: string;
  title: string;
  artist: string;
  durationMs: number;
  accompaniment: AccompanimentDescriptor;
  pitchTrack?: PitchTrack;
}

export interface KaraokeScoreWeights {
  pitch: number;
  rhythm: number;
  lyrics: number;
  completeness: number;
  breath: number;
}

export interface KaraokeLineScore {
  lineIndex: number;
  startMs: number;
  endMs: number;
  pitch: number | null;
  rhythm: number | null;
  lyrics: number;
  completeness: number;
  breath: number;
  total: number;
  feedback: readonly string[];
}

export interface KaraokeScore {
  schema: 1;
  total: number;
  stability: number;
  longestCombo: number;
  bestLine: number | null;
  lines: readonly KaraokeLineScore[];
  /** True only when a trusted pitch track exists; otherwise pitch stays null. */
  pitchEvaluated: boolean;
}

export type KaraokeRoomStatus = 'lobby' | 'countdown' | 'singing' | 'paused' | 'results' | 'closed';
export type KaraokeQueueMode = 'solo' | 'relay' | 'chorus';

export interface KaraokeMember {
  id: string;
  displayName: string;
  role: KaraokeRole;
  ready: boolean;
  connected: boolean;
  joinedAtMs: number;
  lastSeenAtMs: number;
}

export interface KaraokeQueueItem {
  id: string;
  recordingId: string;
  mode: KaraokeQueueMode;
  singerIds: readonly string[];
  state: 'queued' | 'countdown' | 'singing' | 'scored' | 'skipped';
  score?: KaraokeScore;
}

export interface KaraokeRoomState {
  schema: 1;
  roomId: string;
  roomCode: string;
  revision: number;
  status: KaraokeRoomStatus;
  hostMonotonicMs: number;
  members: readonly KaraokeMember[];
  queue: readonly KaraokeQueueItem[];
  currentItemId?: string;
  countdownEndsAtMs?: number;
}

export type KaraokeClientEvent =
  | {type: 'join.requested'; roomCode: string; displayName: string; clientNonce: string}
  | {type: 'member.ready'; ready: boolean}
  | {type: 'queue.add'; recordingId: string; mode: KaraokeQueueMode}
  | {type: 'queue.remove'; itemId: string}
  | {type: 'clock.sample'; clientSendMs: number; clientReceiveMs?: number}
  | {type: 'session.leave'};

export type KaraokeHostEvent =
  | {type: 'room.snapshot'; state: KaraokeRoomState; hostSentMonotonicMs: number}
  | {type: 'join.approved'; sessionToken: string; member: KaraokeMember}
  | {type: 'join.rejected'; reason: string}
  | {type: 'room.error'; code: string; message: string; recoverable: boolean}
  | {type: 'room.closed'; reason: string};

/** A room token grants only this K-song room. It never grants remote-control or library permissions. */
export interface KaraokeSessionGrant {
  schema: 1;
  roomId: string;
  memberId: string;
  token: string;
  expiresAtMs: number;
  capabilities: readonly ('sing' | 'queue' | 'return-media')[];
}

export const KARAOKE_LIMITS = Object.freeze({
  maxMembers: 4,
  maxQueueItems: 64,
  roomCodeLength: 6,
  maxPitchFrames: 60 * 60 * 8,
  maxLyricLines: 4000,
  clockSamples: 7,
});
