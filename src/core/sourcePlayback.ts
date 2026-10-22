import {resolveReplacement} from './desktopReplacement';
import type { Track, InstalledSource, SourceProgress } from './types';
import { sourceDeadline, sourceRequest } from './sourceDeadline';
import { sameRecordingMetadata } from './searchGroups';
import { matchesImportedMetadata } from './playlistLinks';

type QualityTier = 'lossless24' | 'lossless' | 'high' | 'standard';

function qualityOrder(preference: string): QualityTier[] {
  return preference === 'standard' ? ['standard'] : preference === 'high' ? ['high', 'standard'] : ['lossless24', 'lossless', 'high', 'standard'];
}

function availableQualities(source: InstalledSource, track: Track, preference: string): QualityTier[] {
  const desired = qualityOrder(preference);
  if (source.kind === 'lx') {
    let platform = '';
    let knownFormats: string[] | null = null;
    try {
      const info = JSON.parse(atob((track.remoteId || '').replace(/-/g, '+').replace(/_/g, '/')));
      platform = info.source || '';
      // Only these catalogs expose actual per-song availability, rather than guessed types.
      if (['kg', 'mg'].includes(platform) && Array.isArray(info.types)) knownFormats = info.types.map((item: { type: string }) => item.type);
    } catch {}
    const formats = source.manifest.lxPlatforms?.[platform]?.qualitys || [];
    const formatFor = { lossless24: 'flac24bit', lossless: 'flac', high: '320k', standard: '128k' };
    return desired.filter(tier => formats.includes(formatFor[tier]) && (!knownFormats || knownFormats.includes(formatFor[tier])));
  }
  const supported = source.manifest.qualities;
  return desired.filter(tier => tier !== 'lossless24' && (!supported.length || supported.includes(tier)));
}

export async function resolveOriginalTrack(track: Track, failedAttempts: readonly string[], report: (progress: SourceProgress) => void, signal: AbortSignal): Promise<Track> {
  const bridge = window.yzqxy?.sources;
  if (!bridge) throw new Error('音乐源只在桌面版中可用');
  const preference = localStorage.getItem('zenix.onlineQuality') || 'auto';
  const failures: string[] = [];
  let lastIssue = '';
  const notify = (phase: SourceProgress['phase'], message: string, detail = lastIssue || undefined) => {
    signal.throwIfAborted();
    report({ phase, message, detail });
  };
  const failed = (reason: unknown) => {
    signal.throwIfAborted();
    lastIssue = /timeout|timed out|超时/i.test(reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason))
      ? '刚才的连接超时，正在自动尝试备用方案'
      : '刚才的资源未能播放，正在自动尝试备用方案';
    notify('retrying', '本次尝试未成功，正在继续');
  };
  if (!failedAttempts.length) {
    notify('cache', '正在查找本地缓存', '有缓存时直接播放，无需重新连接');
    const local = await sourceDeadline(() => bridge.cachedBest(track, qualityOrder(preference)), signal, 0).catch(() => { signal.throwIfAborted(); return null; });
    if (local) return { ...track, ...local, coverUrl: track.coverUrl || local.coverUrl };
  }
  notify('resolving', '正在查找可用资源');
  const sources = (await sourceDeadline(() => bridge.list(), signal, 0)).filter(source => source.enabled && source.manifest.capabilities.includes('resolvePlayback'));
  const diagnostics = await sourceDeadline(() => bridge.diagnostics?.() || Promise.resolve(null), signal, 0)
    .catch(() => { signal.throwIfAborted(); return null; });
  if (diagnostics?.smooth) sources.sort((a, b) => (diagnostics.sources[b.id]?.lastPlayedAt || 0) - (diagnostics.sources[a.id]?.lastPlayedAt || 0));
  if (track.preferredPlaybackProviderId) sources.sort((a,b)=>Number(b.id === track.preferredPlaybackProviderId)-Number(a.id === track.preferredPlaybackProviderId));
  if (!sources.length) throw new Error('没有启用可播放的音乐源；请在音乐源设置中启用至少一个源。');
  let lxPlatform = '';
  try { lxPlatform = JSON.parse(atob((track.remoteId || '').replace(/-/g, '+').replace(/_/g, '/'))).source || ''; } catch {}
  const attempted: string[] = [];
  for (const [sourceIndex, source] of sources.entries()) {
    notify(attempted.length ? 'switching' : 'resolving', attempted.length ? '正在换用备用连接' : '正在连接播放服务');
    attempted.push(source.manifest.name);
    const sourceLabel = `${source.manifest.name} · ${attempted.length}/${sources.length}`;
    notify('resolving', `正在查找资源 · ${sourceLabel}`);
    const direct = source.id === track.providerId
      ? track
      : source.kind === 'lx' && lxPlatform && source.manifest.lxPlatforms?.[lxPlatform]
        ? { ...track, id: `source:${encodeURIComponent(source.id)}:${encodeURIComponent(track.remoteId || '')}`, providerId: source.id, audioUrl: '' }
        : null;
    const seen = new Set<string>();
    let unavailable = false;
    const tryCandidate = async (candidate: Track): Promise<Track | null> => {
      if (!candidate.remoteId || seen.has(candidate.remoteId)) return null;
      seen.add(candidate.remoteId);
      for (const tier of availableQualities(source, candidate, preference)) {
        if (unavailable) break;
        if (failedAttempts.includes(`${source.id}:${tier}`)) continue;
        try {
          const qualityName = { lossless24: '高解析无损', lossless: '无损', high: '高品质', standard: '标准' }[tier];
          notify('resolving', `正在获取${qualityName}音频 · ${sourceLabel}`);
          const resolved = await sourceRequest(requestId => bridge.resolve(candidate, tier, track.id, true, requestId), signal, 0);
          if (resolved.audioUrl) {
            notify('connecting', `地址已取得，正在连接音频 · ${sourceLabel}`);
            return { ...track, ...resolved, coverUrl: track.coverUrl || resolved.coverUrl, playbackProviderId: resolved.playbackProviderId || source.id, playbackQuality: tier,playbackRecording:resolved.playbackRecording || (resolved.playbackProviderId==='cache'?undefined:{id:candidate.id,title:candidate.title,artist:candidate.artist,album:candidate.album,source:candidate.source,providerId:source.id,remoteId:candidate.remoteId,duration:candidate.duration}) };
          }
          failures.push(`${source.manifest.name}的${tier}音质无法播放`);
          failed('音频不可播放');
        } catch (reason) {
          failed(reason);
          unavailable = /timeout|超时|ECONN|ENOTFOUND|DNS|network|fetch failed|HTTP 5\d\d|网络请求失败/i.test(String(reason));
          failures.push(`${source.manifest.name}的${tier}音质：${reason instanceof Error ? reason.message : String(reason)}`);
        }
      }
      return null;
    };
    if (direct) {
      const playable = await tryCandidate(direct);
      if (playable) return playable;
    }
    if (unavailable || !source.manifest.capabilities.includes('search')) continue;
    try {
      notify('switching', '正在寻找同一首歌的备用资源');
      const page = await sourceRequest(requestId => bridge.search(source.id, track.title, null, 50, requestId,true), signal, 0);
      const matches = page.items.filter(candidate => sameRecordingMetadata(track, candidate) || matchesImportedMetadata(track, candidate))
        .sort((left, right) => Math.abs(left.duration - track.duration) - Math.abs(right.duration - track.duration));
      for (const candidate of matches.slice(0, 2)) {
        if (unavailable) break;
        const playable = await tryCandidate(candidate);
        if (playable) return playable;
      }
      if (!matches.length && !direct) failures.push(`${source.manifest.name}没有匹配的歌曲`);
    } catch (reason) {
      failed(reason);
      failures.push(`${source.manifest.name}搜索失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }
  const last = failures.at(-1)?.replace(/^Error invoking remote method '[^']+': Error:\s*/, '') || '没有匹配资源';
  throw new Error(`已按顺序尝试 ${attempted.join(' → ') || '全部可用音乐源'}，仍未找到可播放音频。${last}`);
}

export function resolveCustomTrack(track:Track,failed:readonly string[],report:(progress:SourceProgress)=>void,signal:AbortSignal):Promise<Track>{return resolveReplacement(track,failed,report,signal,()=>resolveOriginalTrack(track,failed,report,signal));}
