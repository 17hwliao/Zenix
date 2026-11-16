import type {
  KaraokeLyricLine,
  KaraokeMember,
  KaraokeQueueItem,
  KaraokeQueueMode,
  KaraokeRoomState,
  KaraokeScore,
} from '../contracts';
import type {
  KaraokeJoinStatus,
  KaraokePerformanceStatus,
  KaraokePitchView,
  KaraokeUiPhase,
  KaraokeUiTrack,
} from './types';

const PHASE_COPY: Readonly<Record<KaraokeUiPhase, Readonly<{title: string; message: string}>>> = Object.freeze({
  loading: Object.freeze({title: '正在载入 K 歌空间', message: '正在读取房间、歌曲和演唱资料。'}),
  ready: Object.freeze({title: '房间已就绪', message: '成员和歌曲状态已同步。'}),
  empty: Object.freeze({title: '暂无可演唱内容', message: '等待成员添加歌曲，或从曲目列表选择一首歌。'}),
  waiting: Object.freeze({title: '等待主持人批准', message: '加入请求已经发送，请保持此页面打开。'}),
  approved: Object.freeze({title: '已加入房间', message: '你已获得这个 K 歌房间的演唱与点歌权限。'}),
  rejected: Object.freeze({title: '加入请求未通过', message: '可以核对房间码后重新申请加入。'}),
  disconnected: Object.freeze({title: '连接已断开', message: '房间资料仍保留，恢复连接后可继续。'}),
  reconnecting: Object.freeze({title: '正在重新连接', message: '正在恢复房间同步，请稍候。'}),
  'host-stopped': Object.freeze({title: '主持人已结束房间', message: '本轮演唱已经停止，房间不再接受新状态。'}),
  failed: Object.freeze({title: '操作失败', message: '当前操作没有完成，请查看错误信息后重试。'}),
  complete: Object.freeze({title: '本轮演唱已完成', message: '总分和逐句点评已经生成。'}),
});

export interface KaraokeLyricWindowSlot {
  depth: -2 | -1 | 0 | 1 | 2;
  absoluteIndex: number | null;
  line: KaraokeLyricLine | null;
}

export interface KaraokeFeedbackRow {
  lineIndex: number;
  text: string;
  total: number;
  pitch: number | null;
  rhythm: number | null;
  completeness: number;
  feedback: readonly string[];
}

export function karaokePhaseCopy(phase: KaraokeUiPhase): Readonly<{title: string; message: string}> {
  return PHASE_COPY[phase];
}

export function getFiveLineLyricWindow(
  lines: readonly KaraokeLyricLine[],
  activeIndex: number,
): readonly KaraokeLyricWindowSlot[] {
  const normalizedActive = lines.length
    ? Math.max(0, Math.min(lines.length - 1, Number.isFinite(activeIndex) ? Math.floor(activeIndex) : 0))
    : -1;
  return [-2, -1, 0, 1, 2].map((depth) => {
    const absoluteIndex = normalizedActive < 0 ? -1 : normalizedActive + depth;
    return {
      depth: depth as KaraokeLyricWindowSlot['depth'],
      absoluteIndex: absoluteIndex >= 0 && absoluteIndex < lines.length ? absoluteIndex : null,
      line: absoluteIndex >= 0 && absoluteIndex < lines.length ? lines[absoluteIndex] ?? null : null,
    };
  });
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function formatKaraokeTime(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0) / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function findTrack(
  tracks: readonly KaraokeUiTrack[],
  recordingId: string | undefined,
): KaraokeUiTrack | null {
  if (!recordingId) return null;
  return tracks.find((track) => track.recordingId === recordingId) ?? null;
}

export function findViewerMember(room: KaraokeRoomState, viewerMemberId: string): KaraokeMember | null {
  return room.members.find((member) => member.id === viewerMemberId) ?? null;
}

export function currentQueueItem(room: KaraokeRoomState): KaraokeQueueItem | null {
  if (room.currentItemId) {
    return room.queue.find((item) => item.id === room.currentItemId) ?? null;
  }
  return room.queue.find((item) => item.state === 'countdown' || item.state === 'singing') ?? null;
}

export function activeKaraokeRecordingIds(room?: KaraokeRoomState): ReadonlySet<string> {
  return new Set((room?.queue ?? [])
    .filter((item) => item.state === 'queued' || item.state === 'countdown' || item.state === 'singing')
    .map((item) => item.recordingId));
}

export function memberNames(room: KaraokeRoomState, memberIds: readonly string[]): readonly string[] {
  return memberIds.map((id) => room.members.find((member) => member.id === id)?.displayName ?? id);
}

export function queueModeLabel(mode: KaraokeQueueMode): string {
  return {solo: '独唱', relay: '接唱', chorus: '合唱'}[mode];
}

export function queueStateLabel(state: KaraokeQueueItem['state']): string {
  return {queued: '待唱', countdown: '倒计时', singing: '演唱中', scored: '已评分', skipped: '已跳过'}[state];
}

export function memberRoleLabel(member: KaraokeMember): string {
  return {host: '主持人', singer: '演唱者', listener: '听众'}[member.role];
}

export function joinStatusLabel(status: KaraokeJoinStatus): string {
  return {waiting: '等待批准', approved: '已批准', rejected: '已拒绝'}[status];
}

export function performanceStatusLabel(status: KaraokePerformanceStatus): string {
  return {idle: '尚未开始', countdown: '准备开始', singing: '演唱中', paused: '已暂停', complete: '已完成'}[status];
}

export function noteName(midi: number | null): string {
  if (midi === null || !Number.isFinite(midi)) return '—';
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const note = Math.round(midi);
  return `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

export function pitchOffsetLabel(pitch: KaraokePitchView): string {
  if (pitch.status === 'unsupported') return '当前录音没有可信音高参考';
  if (pitch.status === 'no-signal' || pitch.detectedMidi === null) return '未检测到稳定歌声';
  if (pitch.targetMidi === null) return '没有目标音高';
  const offset = pitch.detectedMidi - pitch.targetMidi;
  if (Math.abs(offset) <= 0.5) return '音准稳定';
  return offset < 0 ? '音高偏低' : '音高偏高';
}

export function feedbackRows(
  score: KaraokeScore,
  lyrics: readonly KaraokeLyricLine[],
): readonly KaraokeFeedbackRow[] {
  return score.lines.map((line) => ({
    lineIndex: line.lineIndex,
    text: lyrics.find((lyric) => lyric.index === line.lineIndex)?.text || `第 ${line.lineIndex + 1} 句`,
    total: line.total,
    pitch: line.pitch,
    rhythm: line.rhythm,
    completeness: line.completeness,
    feedback: line.feedback,
  }));
}
