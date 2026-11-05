import type {ToolResult} from './contracts';

const MAX_LINES = 30;
const MAX_LINE_LENGTH = 400;
type Data = Record<string, unknown>;
const record = (value: unknown): Data | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : undefined;
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value.slice(0, MAX_LINES) : [];
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
const text = (value: unknown): string => typeof value === 'string' ? value
  .replace(/(?:https?:\/\/|file:\/\/|content:\/\/)[^\s<>"']+/gi, '[地址已省略]')
  .replace(/(?:[a-z]:[\\/]|\\\\)[^\n\r<>"']+/gi, '[路径已省略]')
  .replace(/(?:^|\s)\/(?:[^\s/]+\/)+[^\s]*/g, ' [路径已省略]')
  .replace(/\b[a-z0-9-]+:(?:track|playlist|candidate|device):[a-z0-9-]+\b/gi, '[引用已省略]')
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_LENGTH) : '';
const duration = (value: unknown): string => {
  const seconds = count(value);
  if (seconds === undefined) return '';
  const minutes = Math.floor(seconds / 60), remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};
const song = (value: unknown): string => {
  const row = record(value);
  if (!row) return '';
  const title = text(row.title) || text(row.label) || '未提供歌名';
  const parts = [title];
  if (text(row.artist)) parts.push(`歌手：${text(row.artist)}`);
  if (text(row.album)) parts.push(`专辑：${text(row.album)}`);
  if (duration(row.duration)) parts.push(`时长：${duration(row.duration)}`);
  if (count(row.year) !== undefined) parts.push(`年份：${count(row.year)}`);
  if (row.source === 'local') parts.push('本地歌曲');
  const saved = record(row.saved);
  if (saved && typeof saved.liked === 'boolean') parts.push(saved.liked ? '已喜欢' : '未喜欢');
  if (saved && typeof saved.favorites === 'boolean') parts.push(saved.favorites ? '已收藏' : '未收藏');
  const progress = record(row.progress);
  if (progress && duration(progress.position)) parts.push(`进度：${duration(progress.position)}${progress.playing === true ? '，播放中' : ''}`);
  if (typeof row.coverAvailable === 'boolean') parts.push(row.coverAvailable ? '有封面' : '暂无封面');
  if (text(row.lyrics)) parts.push(`当前歌词：${text(row.lyrics)}`);
  else if (row.lyricsStatus === 'unavailable' || row.lyrics === null) parts.push('暂无可用歌词');
  return parts.join(' · ');
};
const taskStatus: Record<string, string> = {
  queued: '排队中', pending: '等待中', running: '进行中', waiting: '等待条件',
  complete: '已完成', completed: '已完成', local: '已缓存', failed: '失败', error: '失败',
  cancelled: '已取消', cancelling: '正在取消', paused: '已暂停', unknown: '结果待核实',
};

/** Only allowlisted business fields are presented; never serialize internal objects or identifiers. */
export function resultSummaryLines(result?: ToolResult): string[] {
  const data = record(result?.data);
  if (!data) return [];
  const output: string[] = [];
  const add = (value: string) => {
    const line = text(value);
    if (line && output.length < MAX_LINES) output.push(line);
  };
  for (const item of rows(data.items)) add(text(item));
  if (typeof data.detail === 'string') for (const line of data.detail.split(/\r?\n/).slice(0, MAX_LINES)) add(line);
  if (text(data.order)) add(`顺序：${text(data.order)}`);
  for (const value of rows(data.songs)) add(song(value));
  if (data.song) add(song(data.song));

  const context = record(data.context) || data;
  if (context.current === null) add('当前没有正在播放的歌曲。');
  else if (record(context.current)) add(`当前歌曲：${song(context.current)}`);
  for (const value of rows(context.selected)) {
    const selected = song(value);
    if (selected) add(`界面选中：${selected}`);
  }
  if (context.selectionStatus === 'none') add('界面尚未选中歌曲。');
  else if (context.selectionStatus === 'unavailable') add('暂时无法读取界面选择。');
  const playlist = record(context.playlist);
  if (playlist) add(`当前歌单：${text(playlist.label) || text(playlist.name) || '未命名歌单'}${count(playlist.count) !== undefined ? `，${count(playlist.count)} 首` : ''}`);
  for (const value of rows(data.playlists)) {
    const row = record(value);
    if (row) add(`歌单：${text(row.label) || text(row.name) || '未命名歌单'}${count(row.count) !== undefined ? `，${count(row.count)} 首` : ''}`);
  }
  const playback = record(context.playback) || (typeof context.playing === 'boolean' ? context : undefined);
  if (playback) {
    const parts: string[] = [];
    if (playback.loading === true) parts.push('正在加载');
    else if (typeof playback.playing === 'boolean') parts.push(playback.playing ? '播放中' : '已暂停');
    if (typeof playback.volume === 'number' && Number.isFinite(playback.volume) && playback.volume >= 0 && playback.volume <= 1) parts.push(`音量 ${Math.round(playback.volume * 100)}%`);
    if (playback.repeat === 'one') parts.push('单曲循环');
    else if (playback.repeat === 'all') parts.push('列表循环');
    else if (playback.repeat === 'off') parts.push('顺序播放');
    if (playback.shuffle === true) parts.push('随机播放');
    if (count(playback.queueCount) !== undefined) parts.push(`队列 ${count(playback.queueCount)} 首`);
    if (parts.length) add(`播放状态：${parts.join('，')}`);
  }
  if (typeof context.roaming === 'boolean') add(context.roaming ? '漫游已开启。' : '漫游未开启。');
  const device = record(context.device);
  if (device?.status === 'unavailable') add('协作设备暂时不可用。');
  else if (device && text(device.label)) add(`协作设备：${text(device.label)}`);

  for (const value of rows(data.tasks)) {
    const row = record(value);
    if (!row) continue;
    const kind = row.kind === 'cache' ? '缓存任务' : row.kind === 'playback' ? '播放任务' : '后台任务';
    const label = text(row.name) || kind;
    const status = typeof row.status === 'string' && Object.hasOwn(taskStatus, row.status) ? taskStatus[row.status] : undefined;
    const total = count(row.total), complete = count(row.complete);
    add(`${label}：${status || '状态待核实'}${total !== undefined && complete !== undefined ? `，已完成 ${complete}/${total}` : ''}`);
  }
  const stats = record(data.stats) || data;
  const listeningSeconds = count(stats.seconds);
  if (listeningSeconds !== undefined) add(`累计听歌 ${Math.floor(listeningSeconds / 60)} 分 ${listeningSeconds % 60} 秒。`);
  if (count(stats.plays) !== undefined) add(`播放 ${count(stats.plays)} 次。`);
  if (count(stats.uniqueTracks) !== undefined) add(`听过 ${count(stats.uniqueTracks)} 首不同歌曲。`);
  for (const value of rows(stats.topTracks)) {
    const row = record(value);
    if (row) add(`常听歌曲：${song(row)}${count(row.plays) !== undefined ? `，${count(row.plays)} 次` : ''}`);
  }
  return output;
}
