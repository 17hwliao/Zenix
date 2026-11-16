import {createRoot} from 'react-dom/client';
import type {
  DesktopKaraokePageProps,
  KaraokeJoinRequestView,
  KaraokePerformanceView,
  KaraokeUiTrack,
  MobileKaraokeRoomProps,
  MobileKaraokeSoloPageProps,
} from '../../src/features/karaoke/ui';
import DesktopKaraokePage from '../../src/features/karaoke/ui/DesktopKaraokePage';
import MobileKaraokeRoom from '../../src/features/karaoke/ui/MobileKaraokeRoom';
import MobileKaraokeSoloPage from '../../src/features/karaoke/ui/MobileKaraokeSoloPage';
import type {
  KaraokeLyricLine,
  KaraokeRoomState,
  KaraokeScore,
} from '../../src/features/karaoke/contracts';

const tracks: readonly KaraokeUiTrack[] = Object.freeze([
  {
    recordingId: 'recording-wind',
    title: '像风一样——这是一首用于验证移动端超长标题不会撑破容器的测试歌曲',
    artist: '测试歌手与很长的联合署名',
    durationMs: 212_000,
  },
  {recordingId: 'recording-light', title: '落在生命里的光', artist: '测试歌手', durationMs: 196_000},
  {recordingId: 'recording-night', title: '夜航', artist: '合成乐队', durationMs: 238_000},
]);

const lyrics: readonly KaraokeLyricLine[] = Object.freeze([
  {index: 0, startMs: 0, endMs: 12_000, text: '第一句歌词从远处轻轻靠近', notes: []},
  {index: 1, startMs: 12_000, endMs: 24_000, text: '第二句把故事的轮廓照亮', translation: 'The second line lights up the story', notes: []},
  {index: 2, startMs: 24_000, endMs: 38_000, text: '当前这一句应该最清晰最醒目', notes: []},
  {index: 3, startMs: 38_000, endMs: 50_000, text: '下一句继续向前没有停下', notes: []},
  {index: 4, startMs: 50_000, endMs: 64_000, text: '第五句留在这五句歌词窗口里', notes: []},
  {index: 5, startMs: 64_000, endMs: 76_000, text: '窗口外还有第六句', notes: []},
]);

const room: KaraokeRoomState = {
  schema: 1,
  roomId: 'fixture-room',
  roomCode: '482915',
  revision: 9,
  status: 'singing',
  hostMonotonicMs: 42_000,
  members: [
    {id: 'host', displayName: '主持人小夏', role: 'host', ready: true, connected: true, joinedAtMs: 1_000, lastSeenAtMs: 42_000},
    {id: 'singer', displayName: '演唱者阿遥', role: 'singer', ready: true, connected: true, joinedAtMs: 2_000, lastSeenAtMs: 42_000},
    {id: 'listener', displayName: '听众小岚', role: 'listener', ready: false, connected: false, joinedAtMs: 3_000, lastSeenAtMs: 20_000},
  ],
  queue: [
    {id: 'current', recordingId: 'recording-wind', mode: 'chorus', singerIds: ['host', 'singer'], state: 'singing'},
    {id: 'next', recordingId: 'recording-light', mode: 'solo', singerIds: ['singer'], state: 'queued'},
    {id: 'done', recordingId: 'recording-night', mode: 'relay', singerIds: ['host'], state: 'scored'},
  ],
  currentItemId: 'current',
};

const performance: KaraokePerformanceView = {
  status: 'singing',
  elapsedMs: 31_250,
  durationMs: 212_000,
  activeLineIndex: 2,
  lineProgress: .46,
  pitch: {
    status: 'tracking',
    targetMidi: 64,
    detectedMidi: 66,
    confidence: .82,
    energy: .67,
  },
  singerNames: ['主持人小夏', '演唱者阿遥'],
};

const joinRequests: readonly KaraokeJoinRequestView[] = [
  {id: 'request-1', displayName: '等待中的朋友', status: 'waiting', note: '想加入合唱'},
  {id: 'request-2', displayName: '已经批准的朋友', status: 'approved'},
  {id: 'request-3', displayName: '房间码输错的朋友', status: 'rejected'},
];

const score: KaraokeScore = {
  schema: 1,
  total: 88.4,
  stability: 91.2,
  longestCombo: 37,
  bestLine: 2,
  pitchEvaluated: true,
  lines: lyrics.slice(0, 5).map((line) => ({
    lineIndex: line.index,
    startMs: line.startMs,
    endMs: line.endMs,
    pitch: 84 + line.index,
    rhythm: 90 - line.index,
    lyrics: 96,
    completeness: line.index === 4 ? 72 : 94,
    breath: 86,
    total: 90 - line.index * 2,
    feedback: line.index === 2 ? ['音准稳定', '副歌进入很自然'] : ['保持当前节奏'],
  })),
};

const noop = () => undefined;

export const desktopHostProps: DesktopKaraokePageProps = {
  viewerMode: 'host',
  room,
  tracks,
  viewerMemberId: 'host',
  lyrics,
  performance,
  joinRequests,
  phase: 'ready',
  onCreateRoom: noop,
  onJoinRoom: noop,
  onCopyRoomCode: noop,
  onSetReady: noop,
  onAddToQueue: noop,
  onRemoveQueueItem: noop,
  onStartQueueItem: noop,
  onPause: noop,
  onResume: noop,
  onSkip: noop,
  onFinishCurrent: noop,
  onStopRoom: noop,
  onApproveJoin: noop,
  onRejectJoin: noop,
  onClose: noop,
};

export const desktopCompleteProps: DesktopKaraokePageProps = {
  ...desktopHostProps,
  phase: 'complete',
  result: score,
};

export const desktopGuestProps: DesktopKaraokePageProps = {
  ...desktopHostProps,
  viewerMode: 'guest',
  viewerMemberId: 'singer',
};

export const mobileSoloProps: MobileKaraokeSoloPageProps = {
  track: tracks[0],
  singerName: '移动端演唱者',
  lyrics,
  performance,
  phase: 'ready',
  onBack: noop,
  onStart: noop,
  onPause: noop,
  onResume: noop,
  onFinish: noop,
};

export const mobileSoloCompleteProps: MobileKaraokeSoloPageProps = {
  ...mobileSoloProps,
  performance: {...performance, status: 'complete', elapsedMs: 212_000, activeLineIndex: 4, lineProgress: 1},
  phase: 'complete',
  result: score,
};

export const mobileRoomProps: MobileKaraokeRoomProps = {
  ...desktopHostProps,
  phase: 'disconnected',
  onRetryConnection: noop,
};

export const mobileRoomReadyProps: MobileKaraokeRoomProps = {
  ...desktopHostProps,
  phase: 'ready',
  onRetryConnection: noop,
};

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  const root = document.getElementById('root');
  const mode = new URLSearchParams(location.search).get('mode') || 'mobile-solo';
  if (root) {
    createRoot(root).render(mode === 'mobile-room'
      ? <MobileKaraokeRoom {...mobileRoomProps} />
      : mode === 'mobile-room-ready'
        ? <MobileKaraokeRoom {...mobileRoomReadyProps} />
      : mode === 'desktop-complete'
        ? <DesktopKaraokePage {...desktopCompleteProps} />
      : mode === 'desktop'
        ? <DesktopKaraokePage {...desktopHostProps} />
        : <MobileKaraokeSoloPage {...mobileSoloProps} />);
  }
}
