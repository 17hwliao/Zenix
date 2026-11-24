import {sourceDeadline, sourceRequest} from '../../core/sourceDeadline';
import type {InstalledSource, SourceSearchPage, Track} from '../../core/types';
import {recordingFor} from '../recording';
import {comparableLength,isInstrumentalVersion} from './solo-assets';

export type AccompanimentDiscoveryResult = {
  status: 'ready' | 'review' | 'missing' | 'error';
  candidates: Track[];
  track?: Track;
  message?: string;
};

export function discardRevokedBlobCandidate(result: AccompanimentDiscoveryResult, revokedUrl: string): AccompanimentDiscoveryResult {
  if (!revokedUrl || result.status !== 'review') return result;
  const candidates = result.candidates.filter(candidate => candidate.audioUrl !== revokedUrl);
  if (!candidates.length) return {status:'error',candidates:[],message:'已保存的伴奏文件无法再播放，音乐源也没有找到可用候选。'};
  return {...result,candidates,message:'已忽略无法播放的旧伴奏文件，请核对剩余候选。'};
}

const catalogIds = ['kw', 'kg', 'tx', 'wy', 'mg'];
const qualities = ['high', 'standard', 'lossless', 'lossless24'];
const instrumentalLabels = /纯伴奏|纯音乐|无人声|无主唱|伴奏|\binstrumental\b|\bkaraoke\b/giu;
const hasInstrumentalLabel = /纯伴奏|纯音乐|无人声|无主唱|伴奏|\binstrumental\b|\bkaraoke\b/iu;
const versionLabels = /现场(?:版)?|演唱会|翻唱|消音|人声提取|原版|原调|(?:变调|升调|降调)(?:\s*[+-]?\d+\s*(?:半音|key)?)?|加速|减速|\blive\b|\bcover\b|\bsped[\s-]+up\b|\bslowed\b|\bpitch[\s-]+shift(?:ed)?\b/giu;

const normalized = (s: string) => s.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').toLowerCase().trim();
const textKey = (s: string) => normalized(s).replace(/[\s\p{P}\p{S}]/gu, '');
const bareTitle = (s: string) => textKey(normalized(s).replace(instrumentalLabels, '').replace(versionLabels, ''));
const editions = (s: string) => (normalized(s).match(versionLabels) || []).map(textKey).sort().join('|');

function isLX(source: InstalledSource | undefined): boolean {
  return source?.kind === 'lx' || source?.id.startsWith('lx.') === true;
}

function defaultCatalog(source: InstalledSource): string | undefined {
  const settings = (source as InstalledSource & {settings?: {lxCatalog?: unknown}}).settings;
  const platform = source.catalog
    || (typeof settings?.lxCatalog === 'string' ? settings.lxCatalog : undefined)
    || source.manifest.settings?.find(field => field.key === 'lxCatalog')?.default
    || Object.keys(source.manifest.lxPlatforms || {}).find(key => catalogIds.includes(key));
  return platform && catalogIds.includes(platform) ? platform : undefined;
}

/** An LX script is a playback provider; search is shared by scripts using one platform. */
export function accompanimentSearchGroups(sources: readonly InstalledSource[]): InstalledSource[][] {
  const groups = new Map<string, InstalledSource[]>();
  for (const source of sources) {
    if (!source.enabled || !source.manifest.capabilities.includes('search')) continue;
    const catalog = isLX(source) ? defaultCatalog(source) : undefined;
    const group = catalog ? 'lx:'+catalog : 'source:'+source.id;
    groups.set(group, [...(groups.get(group) || []), source]);
  }
  return [...groups.values()];
}

function lxId(track: Track): {platform:string;key:string} | undefined {
  const value = track.remoteId;
  if (!value || value.length > 6000 || !/^[\w-]+={0,2}$/.test(value)) return;
  try {
    const row = JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/'))) as {source?:unknown;songmid?:unknown};
    if (typeof row.source !== 'string' || !catalogIds.includes(row.source)) return;
    const key = typeof row.songmid === 'number' || typeof row.songmid === 'string' ? String(row.songmid) : '';
    if (key && key.length <= 250 && !/[\u0000-\u001f]/.test(key)) return {platform:row.source,key};
  } catch { /* this is not LX metadata */ }
}

function candidateKey(track: Track, installed: readonly InstalledSource[]): string {
  const source = installed.find(row => row.id === track.providerId);
  const lx = isLX(source) || track.providerId === 'lx.playlist:catalog' ? lxId(track) : undefined;
  return lx ? JSON.stringify(['lx',lx.platform,lx.key])
    : JSON.stringify([track.source,track.providerId || '',track.remoteId || track.id]);
}

function isRemoteTrack(track: Track): boolean {
  return (track.source === 'custom' || track.source === 'online')
    && typeof track.providerId === 'string' && Boolean(track.providerId) && track.providerId.length <= 240
    && typeof track.remoteId === 'string' && Boolean(track.remoteId) && track.remoteId.length <= 32768;
}

/** A title match is useful for discovery, never sufficient to bind a recording. */
export function canOfferAccompaniment(original: Track, row: Track): boolean {
  if (!row || typeof row.id !== 'string' || !row.id || typeof row.title !== 'string' || !row.title
    || typeof row.artist !== 'string' || row.id === original.id || row.availability === 'unavailable'
    || !(row.source === 'local' || isRemoteTrack(row))) return false;
  if (isInstrumentalVersion(original,row)) return true;
  return hasInstrumentalLabel.test(normalized(row.title)) &&
    Boolean(bareTitle(original.title)) && bareTitle(original.title) === bareTitle(row.title);
}

function alignmentDistance(original: Track, row: Track): number {
  const delta = original.duration > 0 && row.duration > 0 ? Math.min(90,Math.abs(original.duration - row.duration)) : 55;
  const editionDiff = editions(original.title) !== editions(row.title) ? 120 : 0;
  const artistDiff = original.artist && textKey(original.artist) !== textKey(row.artist) ? 75 : 0;
  return delta + editionDiff + artistDiff;
}

/** Do not carry ephemeral media URLs, saved replacement directives or source art to a confirmed pair. */
function remoteCandidate(row: Track): Track {
  return {id:row.id, title:row.title, artist:row.artist, album:row.album, duration:row.duration,
    path:'', audioUrl:'', source:row.source, providerId:row.providerId, remoteId:row.remoteId};
}

function playingOptions(candidate: Track, sources: readonly InstalledSource[]): Track[] {
  const direct = sources.find(source => source.id === candidate.providerId);
  const lc = isLX(direct) || candidate.providerId === 'lx.playlist:catalog' ? lxId(candidate) : undefined;
  if (!lc) return direct?.enabled && direct.manifest.capabilities.includes('resolvePlayback') ? [candidate] : [];
  const options: Track[] = [];
  for (const source of sources) {
    if (!source.enabled || !isLX(source) || !source.manifest.capabilities.includes('resolvePlayback')
      || !source.manifest.lxPlatforms?.[lc.platform]) continue;
    options.push(source.id === candidate.providerId ? candidate : {
      ...candidate,
      id: 'source:'+encodeURIComponent(source.id)+':'+encodeURIComponent(candidate.remoteId!),
      providerId: source.id,
    });
  }
  return options.sort((a,b)=>Number(b.providerId===candidate.providerId)-Number(a.providerId===candidate.providerId));
}

function allowedQualities(candidate: Track, sources: readonly InstalledSource[]): string[] {
  const source = sources.find(row => row.id === candidate.providerId);
  if (!source) return [];
  if (isLX(source)) {
    const lc = lxId(candidate);
    const types = lc && source.manifest.lxPlatforms?.[lc.platform]?.qualitys;
    const lx = {'high':'320k','standard':'128k','lossless':'flac','lossless24':'flac24bit'} as const;
    return types ? qualities.filter(quality=>types.includes(lx[quality as keyof typeof lx])) : [];
  }
  return qualities.filter(quality => source.manifest.qualities.includes(quality));
}

function knownAudioAddress(track: Track): string | undefined {
  if (track.source !== 'local') return;
  const value = track.audioUrl || track.path || '';
  return /^(?:blob:|file:|yzqxy:\/\/(?:audio|karaoke-backing)\/)/.test(value) ? value : undefined;
}

type NativeVerification = (candidate: Track, signal: AbortSignal) => Promise<{durationMs:number} | boolean>;

async function verifyOnMobile(candidate: Track, signal: AbortSignal): Promise<{durationMs:number}> {
  const {command} = await import('../../mobile/native');
  signal.throwIfAborted();
  const round = 'solo-probe:' + crypto.randomUUID();
  const abort = () => { void command('karaokeProbe',{operation:'stop',round}).catch(()=>{}); };
  signal.addEventListener('abort',abort,{once:true});
  try {
    return await sourceDeadline(()=>command<{durationMs:number}>('karaokeProbe',{operation:'probe',round,track:candidate}),signal,0);
  } finally { signal.removeEventListener('abort',abort); }
}

function inspectDecodedAudio(url: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve,reject) => {
    if (signal.aborted) {reject(signal.reason);return;}
    const audio = new Audio();
    const token = /^yzqxy:\/\/stream\/([\da-f-]{36})$/i.exec(url)?.[1];
    let unlisten: (()=>void) | undefined;
    const cleanup = () => {
      signal.removeEventListener('abort',abort);
      unlisten?.();
      audio.removeEventListener('canplay',ready);
      audio.removeEventListener('error',fail);
      audio.removeAttribute('src');
      audio.load();
    };
    const ready = () => {
      const duration = audio.duration;
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(Error('伴奏时长无效'));
    };
    const fail = () => {cleanup();reject(Error('伴奏暂时无法解码'));};
    const abort = () => {cleanup();reject(signal.reason);};
    if (token) unlisten = window.yzqxy?.sources.onStreamFailure?.(event=>{if (event.token===token) fail();});
    signal.addEventListener('abort',abort,{once:true});
    audio.addEventListener('canplay',ready,{once:true});
    audio.addEventListener('error',fail,{once:true});
    audio.muted = true;
    audio.preload = 'auto';
    audio.src = url;
  });
}

/** Confirm an already paired track; never resolve the ordinary player's playlist replacement. */
export async function verifyAccompaniment(
  candidate: Track, sources: readonly InstalledSource[], mobile: boolean, signal: AbortSignal,
  verifyNative?: NativeVerification,
): Promise<Track | undefined> {
  signal.throwIfAborted();
  if (candidate.availability === 'unavailable') return;
  const localUrl = knownAudioAddress(candidate);
  if (localUrl) {
    try {
      const duration = await inspectDecodedAudio(localUrl,signal);
      return {...candidate,duration};
    } catch {signal.throwIfAborted(); return;}
  }
  if (mobile) {
    try {
      const verification = await (verifyNative || verifyOnMobile)(candidate,signal);
      if (verification === true && verifyNative) return candidate;
      if (typeof verification === 'object' && verification && Number.isFinite(verification.durationMs) && verification.durationMs > 0) {
        return {...candidate,duration:verification.durationMs/1000};
      }
      return;
    }
    catch {signal.throwIfAborted();return;}
  }
  if (!isRemoteTrack(candidate)) return;
  const bridge = window.yzqxy?.sources;
  if (!bridge) return;
  const original = remoteCandidate(candidate);
  try {
    const cached = await sourceDeadline(()=>bridge.cachedBest(original,qualities),signal,0);
    // Cache lookup keys can have aliases. Require recorded media identity in the
    // cache itself rather than trusting an alias or the requested title.
    if (cached?.playbackRecording && candidateKey(cached.playbackRecording as Track,sources) === candidateKey(original,sources)) {
      await sourceRequest(id=>bridge.probe(cached.audioUrl,id),signal,0);
      const duration = await inspectDecodedAudio(cached.audioUrl,signal);
      return {...original,duration};
    }
  } catch {signal.throwIfAborted();}
  for (const target of playingOptions(original,sources)) {
    for (const quality of allowedQualities(target,sources)) {
      try {
        // Cache was validated separately. Bypass it on verification without deleting ordinary playback data.
        const resolved = await sourceRequest(id=>bridge.resolve(target,quality,'',true,id,false,true),signal,0);
        if (!resolved.audioUrl || !resolved.playbackRecording
          || candidateKey(resolved.playbackRecording as Track,sources) !== candidateKey(target,sources)) continue;
        await sourceRequest(id=>bridge.probe(resolved.audioUrl,id),signal,0);
        const duration = await inspectDecodedAudio(resolved.audioUrl,signal);
        return {...target,duration};
      } catch {signal.throwIfAborted();}
    }
  }
}

export async function discoverAccompaniment(
  selected: Track, sources: readonly InstalledSource[], mobile: boolean, signal: AbortSignal, confirmed?: Track,
  options: {localTracks?: readonly Track[]; verifyNative?: NativeVerification} = {},
): Promise<AccompanimentDiscoveryResult> {
  signal.throwIfAborted();
  const original = recordingFor(selected);
  const originalKey = candidateKey(original,sources);
  const candidates = new Map<string,Track>();
  if (confirmed && candidateKey(confirmed,sources) !== originalKey) {
    const ready = await verifyAccompaniment(confirmed,sources,mobile,signal,options.verifyNative);
    signal.throwIfAborted();
    if (ready && comparableLength(original.duration,ready.duration) && comparableLength(confirmed.duration,ready.duration)) {
      return {status:'ready',track:ready,candidates:[ready],message:'已验证原先确认的伴奏资源。'};
    }
    candidates.set(candidateKey(confirmed,sources),confirmed);
  }
  const offer = (rows: readonly Track[]) => {
    for (const row of rows) {
      if (!canOfferAccompaniment(original,row)) continue;
      const clean = isRemoteTrack(row) ? remoteCandidate(row) : row;
      const key = candidateKey(clean,sources);
      if (key === originalKey) continue;
      if (!candidates.has(key)) candidates.set(key,clean);
    }
  };
  offer(options.localTracks || []);
  const groups = accompanimentSearchGroups(sources);
  const keyword = (original.title.trim().slice(0,108) + ' 伴奏').trim();
  let completed = 0, failed = 0, cursor = 0;
  // Bound simultaneous native searches; when cancelled the desktop abort reaches
  // its IPC request ID, while Android drops results and dispatches no new ones.
  const query = async (source: InstalledSource): Promise<SourceSearchPage> => {
    if (mobile) {
      const {command} = await import('../../mobile/native');
      return sourceDeadline(()=>command<SourceSearchPage>('search',{id:source.id,keyword}),signal,0);
    }
    const bridge = window.yzqxy?.sources;
    if (!bridge) throw Error('未连接桌面音乐源');
    return sourceRequest(id=>bridge.search(source.id,keyword,null,25,id,true),signal,0);
  };
  const search = async () => {
    while (cursor < groups.length) {
      signal.throwIfAborted();
      const [representative] = groups[cursor++];
      try {
        const result = await query(representative);
        signal.throwIfAborted();
        if (!Array.isArray(result?.items)) throw Error('无效搜索回执');
        offer(result.items);
        completed++;
      } catch {signal.throwIfAborted();failed++;}
    }
  };
  // Wait for workers to acknowledge cancellation before finishing the request.
  await Promise.allSettled(Array.from({length:Math.min(3,groups.length)},search));
  signal.throwIfAborted();
  const ordered = [...candidates.values()]
    .sort((a,b)=>Number(b===confirmed)-Number(a===confirmed) || alignmentDistance(original,a)-alignmentDistance(original,b))
    .slice(0,12);
  if (ordered.length) return {status:'review',candidates:ordered,message:confirmed
    ? '原先确认的伴奏未能重新验证，请试听确认或重新选择。'
    : '找到伴奏候选；同名、歌手和时长相近还不能证明是同一录音。'};
  if (failed) return {status:'error',candidates:[],message:completed
    ? '部分源查询失败，暂不能确定是否有伴奏。'
    : '音乐源查询失败，请重试或导入本地伴奏。'};
  return {status:'missing',candidates:[],message:groups.length
    ? '没有找到明确标为伴奏且歌名相符的候选。'
    : '没有启用可搜索的音乐源；可导入本地伴奏。'};
}
