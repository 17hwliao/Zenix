import type {
  KaraokeLyricLine,
  KaraokeQueueMode,
  KaraokeRoomState,
  KaraokeScore,
} from '../contracts';

export type KaraokeUiPhase =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'waiting'
  | 'approved'
  | 'rejected'
  | 'disconnected'
  | 'reconnecting'
  | 'host-stopped'
  | 'failed'
  | 'complete';

export type KaraokeUiAction = () => void | Promise<void>;
export type KaraokeUiValueAction<T> = (value: T) => void | Promise<void>;

export interface KaraokeUiError {
  code?: string;
  message: string;
  recoverable?: boolean;
}

export interface KaraokeUiTrack {
  recordingId: string;
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl?: string;
}

export type KaraokeJoinStatus = 'waiting' | 'approved' | 'rejected';

export interface KaraokeJoinRequestView {
  id: string;
  displayName: string;
  status: KaraokeJoinStatus;
  requestedAtMs?: number;
  note?: string;
}

export type KaraokePitchStatus = 'tracking' | 'no-signal' | 'unsupported';

export interface KaraokePitchView {
  status: KaraokePitchStatus;
  targetMidi: number | null;
  detectedMidi: number | null;
  confidence: number;
  energy: number;
}

export type KaraokePerformanceStatus = 'idle' | 'countdown' | 'singing' | 'paused' | 'complete';

export interface KaraokePerformanceView {
  status: KaraokePerformanceStatus;
  elapsedMs: number;
  durationMs: number;
  activeLineIndex: number;
  lineProgress: number;
  pitch: KaraokePitchView;
  countdownMs?: number;
  singerNames?: readonly string[];
}

export interface KaraokeUiStatusProps {
  phase: KaraokeUiPhase;
  statusTitle?: string;
  statusMessage?: string;
  error?: KaraokeUiError | null;
  onDismissStatus?: KaraokeUiAction;
  onDismissError?: KaraokeUiAction;
  onRetry?: KaraokeUiAction;
}

export interface KaraokeRoomSharedProps extends KaraokeUiStatusProps {
  room: KaraokeRoomState;
  tracks: readonly KaraokeUiTrack[];
  viewerMemberId: string;
  lyrics: readonly KaraokeLyricLine[];
  performance?: KaraokePerformanceView;
  result?: KaraokeScore | null;
  joinRequests?: readonly KaraokeJoinRequestView[];
  onCopyRoomCode?: KaraokeUiValueAction<string>;
  onSetReady?: KaraokeUiValueAction<boolean>;
  onAddToQueue?: KaraokeUiValueAction<{ recordingId: string; mode: KaraokeQueueMode }>;
  onRemoveQueueItem?: KaraokeUiValueAction<string>;
  onStartQueueItem?: KaraokeUiValueAction<string>;
  onPause?: KaraokeUiAction;
  onResume?: KaraokeUiAction;
  onSkip?: KaraokeUiAction;
  onFinishCurrent?: KaraokeUiAction;
  onStopRoom?: KaraokeUiAction;
  onApproveJoin?: KaraokeUiValueAction<string>;
  onRejectJoin?: KaraokeUiValueAction<string>;
  onBack?: KaraokeUiAction;
  onRetryConnection?: KaraokeUiAction;
}

export interface DesktopKaraokePageProps extends KaraokeUiStatusProps {
  viewerMode: 'host' | 'guest';
  room?: KaraokeRoomState;
  tracks?: readonly KaraokeUiTrack[];
  viewerMemberId?: string;
  lyrics?: readonly KaraokeLyricLine[];
  performance?: KaraokePerformanceView;
  result?: KaraokeScore | null;
  joinRequests?: readonly KaraokeJoinRequestView[];
  onCreateRoom?: KaraokeUiValueAction<{ hostDisplayName: string }>;
  onJoinRoom?: KaraokeUiValueAction<{ roomCode: string; displayName: string }>;
  onCopyRoomCode?: KaraokeUiValueAction<string>;
  onSetReady?: KaraokeUiValueAction<boolean>;
  onAddToQueue?: KaraokeUiValueAction<{ recordingId: string; mode: KaraokeQueueMode }>;
  onRemoveQueueItem?: KaraokeUiValueAction<string>;
  onStartQueueItem?: KaraokeUiValueAction<string>;
  onPause?: KaraokeUiAction;
  onResume?: KaraokeUiAction;
  onSkip?: KaraokeUiAction;
  onFinishCurrent?: KaraokeUiAction;
  onStopRoom?: KaraokeUiAction;
  onApproveJoin?: KaraokeUiValueAction<string>;
  onRejectJoin?: KaraokeUiValueAction<string>;
  onClose?: KaraokeUiAction;
}

export interface MobileKaraokeSoloPageProps extends KaraokeUiStatusProps {
  track: KaraokeUiTrack;
  singerName: string;
  lyrics: readonly KaraokeLyricLine[];
  performance: KaraokePerformanceView;
  result?: KaraokeScore | null;
  onBack?: KaraokeUiAction;
  onStart?: KaraokeUiAction;
  onPause?: KaraokeUiAction;
  onResume?: KaraokeUiAction;
  onFinish?: KaraokeUiAction;
}

export interface MobileKaraokeRoomProps extends KaraokeRoomSharedProps {}
