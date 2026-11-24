import type {Track} from '../../core/types';
import {importKaraokePitchReference, type KaraokeImportFile} from './adapter';
import type {KaraokeTrackDescriptor} from './contracts';
import {fetchOpenChart, matchesOpenChart, openCharts, type OpenChart} from './open-charts';

const MAX_BYTES = 2 * 1024 * 1024;
const DATABASE = 'zenix-karaoke-prep-charts';
const STORE = 'verified';

export interface ChartBinding {
  original: Track;
  accompaniment: Track;
  /** Optional content digests supplied by the owner of the original or accompaniment bytes. */
  originalDigest?: string;
  accompanimentDigest?: string;
}

export interface VerifiedChart {
  descriptor: KaraokeTrackDescriptor;
  name: string;
  /** SHA-256 of the exact imported chart file, not of its linked audio. */
  sha256: string;
}

export interface ChartDiscovery {
  status: 'ready' | 'review' | 'missing' | 'error';
  candidates: readonly OpenChart[];
  chart?: VerifiedChart;
  message?: string;
}

type IDBMode = 'readonly' | 'readwrite';
interface StoredChart {
  key: string;
  version: 1;
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
  at: number;
}

const digestPattern = /^[a-f\d]{64}$/i;

async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value => value.toString(16).padStart(2,'0')).join('');
}

function version(track: Track, contentDigest?: string): readonly unknown[] | null {
  if (!track.id || track.id.length > 32768 || !Number.isFinite(track.duration) || track.duration <= 0 || track.duration > 86400) return null;
  if (contentDigest !== undefined) {
    if (!digestPattern.test(contentDigest)) return null;
    return ['sha256',contentDigest.toLowerCase(),Math.round(track.duration*1000)];
  }
  if (track.source === 'local') {
    if (!Number.isFinite(track.size) || track.size! <= 0 || !Number.isFinite(track.modifiedAt) || track.modifiedAt! <= 0) return null;
    return ['local',track.id,track.size,track.modifiedAt,Math.round(track.duration*1000)];
  }
  if ((track.source !== 'custom' && track.source !== 'online') || !track.providerId || !track.remoteId
    || track.providerId.length > 300 || track.remoteId.length > 32768) return null;
  return ['catalog',track.providerId,track.remoteId,Math.round(track.duration*1000),track.album || ''];
}

async function bindingKey(binding: ChartBinding, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted();
  const original = version(binding.original,binding.originalDigest);
  const backing = version(binding.accompaniment,binding.accompanimentDigest);
  if (!original || !backing) return null;
  const key = await hash(new TextEncoder().encode(JSON.stringify([original,backing])));
  signal.throwIfAborted();
  return key;
}

function open(signal: AbortSignal): Promise<IDBDatabase> {
  signal.throwIfAborted();
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DATABASE,1);
    let closed = false;
    const cleanup = () => signal.removeEventListener('abort',abort);
    const fail = (cause: unknown) => {closed=true;cleanup();reject(cause);};
    const abort = () => fail(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    request.onupgradeneeded = () => {
      if (closed) {request.transaction?.abort();return;}
      request.result.createObjectStore(STORE,{keyPath:'key'}).createIndex('recent','at');
    };
    request.onblocked = () => fail(Error('已校验曲谱库被其他窗口占用。'));
    request.onerror = () => fail(request.error ?? Error('无法读取已校验曲谱。'));
    request.onsuccess = () => {
      cleanup();
      const db = request.result;
      db.onversionchange = () => db.close();
      if (closed || signal.aborted) {db.close();reject(signal.reason);return;}
      resolve(db);
    };
  });
}

async function transaction<T>(mode: IDBMode, signal: AbortSignal, run: (store:IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open(signal);
  try {
    signal.throwIfAborted();
    return await new Promise<T>((resolve,reject) => {
      const tx = db.transaction(STORE,mode);
      const abort = () => {try {tx.abort();} catch{/* Already inactive. */}};
      const cleanup = () => signal.removeEventListener('abort',abort);
      signal.addEventListener('abort',abort,{once:true});
      tx.onabort = () => {cleanup();reject(signal.aborted ? signal.reason : tx.error ?? Error('已校验曲谱操作失败。'));};
      tx.oncomplete = () => {
        cleanup();
        if (signal.aborted) reject(signal.reason);
        else resolve(request.result);
      };
      let request: IDBRequest<T>;
      try {request = run(tx.objectStore(STORE));}
      catch (error) {cleanup();abort();reject(error);}
    });
  } finally {db.close();}
}

function bytesOf(file: KaraokeImportFile): Uint8Array<ArrayBuffer> {
  if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 240) throw Error('曲谱文件名无效。');
  if (typeof file.data === 'string' ? file.data.length > MAX_BYTES : file.data.byteLength > MAX_BYTES) {
    throw Error('曲谱文件超过 2 MiB。');
  }
  const bytes = typeof file.data === 'string'
    ? new TextEncoder().encode(file.data)
    : file.data instanceof Uint8Array ? Uint8Array.from(file.data) : new Uint8Array(file.data.slice(0));
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw Error('曲谱文件为空或超过 2 MiB。');
  return bytes;
}

export async function validatePreparedChart(file: KaraokeImportFile, binding: ChartBinding, signal: AbortSignal): Promise<VerifiedChart> {
  signal.throwIfAborted();
  const bytes = bytesOf(file);
  if (![binding.original.duration,binding.accompaniment.duration].every(value => Number.isFinite(value) && value > 0 && value <= 86400)) {
    throw Error('需要原曲和伴奏的时长才能确认曲谱时间轴。');
  }
  const backingMs = Math.round(binding.accompaniment.duration*1000);
  // Parse once on a longer axis so parsers cannot trim away the out-of-range notes.
  const checked = await importKaraokePitchReference({name:file.name,data:bytes},{...binding.original,duration:86_401});
  signal.throwIfAborted();
  if (!checked.ok) throw Error(checked.error.message);
  const lines = checked.value.pitchTrack!.lines;
  const timelineMs = Math.min(backingMs,Math.round(binding.original.duration*1000));
  const notesWithinTimeline = lines.every(line => line.notes.every(note => note.startMs < timelineMs && note.endMs <= timelineMs+50));
  if (!notesWithinTimeline) throw Error('曲谱音符超过原声或伴奏的时长，请使用对应版本。');
  const parsed = await importKaraokePitchReference({name:file.name,data:bytes},binding.original);
  signal.throwIfAborted();
  if (!parsed.ok) throw Error(parsed.error.message);
  const sha256 = await hash(bytes);
  signal.throwIfAborted();
  return {descriptor:parsed.value,name:file.name,sha256};
}

/** Called only after the user confirms this exact accompaniment and chart play on the same timeline. */
export async function confirmPreparedChart(
  file: KaraokeImportFile,
  binding: ChartBinding,
  signal: AbortSignal,
): Promise<VerifiedChart & {persisted: boolean; persistenceError?: string}> {
  const bytes = bytesOf(file);
  const chart = await validatePreparedChart({name:file.name,data:bytes},binding,signal);
  const key = await bindingKey(binding,signal);
  signal.throwIfAborted();
  if (!key) return {...chart,persisted:false};
  const row: StoredChart = {key,version:1,name:chart.name,sha256:chart.sha256,bytes,at:Date.now()};
  try {
    await transaction('readwrite',signal,store => store.put(row));
    return {...chart,persisted:true};
  } catch (error) {
    signal.throwIfAborted();
    return {...chart,persisted:false,persistenceError:error instanceof Error ? error.message : '无法保存曲谱。'};
  }
}

export async function forgetPreparedChart(binding: ChartBinding, signal: AbortSignal): Promise<void> {
  const key = await bindingKey(binding,signal);
  if (key) await transaction('readwrite',signal,store => store.delete(key));
}

export async function loadOpenChartCandidate(candidate: OpenChart, track: Track, signal: AbortSignal): Promise<KaraokeImportFile> {
  signal.throwIfAborted();
  if (!matchesOpenChart(candidate,track.title,track.artist)) throw Error('该曲谱的歌名或歌手与当前录音不符。');
  // Publisher fingerprint authenticates the chart file, not its alignment to local playback.
  return {name:candidate.title+'.txt',data:await fetchOpenChart(candidate,signal)};
}

export async function discoverChart(track: Track, signal: AbortSignal, binding?: Omit<ChartBinding,'original'>): Promise<ChartDiscovery> {
  signal.throwIfAborted();
  const candidates = openCharts.filter(row => matchesOpenChart(row,track.title,track.artist));
  if (binding) {
    const exact = {...binding,original:track};
    try {
      const key = await bindingKey(exact,signal);
      const row: unknown = key ? await transaction('readonly',signal,store => store.get(key)) : undefined;
      signal.throwIfAborted();
      if (row !== undefined) {
        const saved = row as Partial<StoredChart> | null;
        if (!saved || saved.version !== 1 || saved.key !== key || typeof saved.name !== 'string'
          || !(saved.bytes instanceof Uint8Array) || saved.bytes.length === 0 || saved.bytes.length > MAX_BYTES
          || typeof saved.sha256 !== 'string' || !digestPattern.test(saved.sha256)) {
          throw Error('本地曲谱记录损坏。');
        }
        const chart = await validatePreparedChart({name:saved.name,data:saved.bytes},exact,signal);
        if (chart.sha256 !== saved.sha256) throw Error('本地曲谱校验失败。');
        return {status:'ready',chart,candidates};
      }
    } catch {
      signal.throwIfAborted();
      return {status:'error',candidates,message:'无法读取或校验已配对曲谱，可以重新确认曲谱或直接跟唱。'};
    }
  }
  return candidates.length
    ? {status:'review',candidates,message:'找到同名同歌手的开放曲谱，确认与这条伴奏对齐后才可评分。'}
    : {status:'missing',candidates,message:'暂无匹配曲谱，可继续不计分演唱。'};
}
