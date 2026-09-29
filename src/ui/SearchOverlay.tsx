import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Download, Search, X } from 'lucide-react';
import CoverArt from './CoverArt';
import { formatTime } from './library';
import type { TrackView } from './types';
import type { AppearanceBackground, InstalledSource, Track } from '../core/types';
import PersonalBackdrop from './PersonalBackdrop';

type Props = { query: string; onQueryChange: (query: string) => void; localTracks: TrackView[]; onPlayTrack: (track: TrackView, queue?: TrackView[]) => void; onClose: () => void; onOpenSources: () => void; background?: AppearanceBackground | null };
type Result = { items: TrackView[]; nextCursor: string | null; loading: boolean; error: string };

export default function SearchOverlay({ query, onQueryChange, localTracks, onPlayTrack, onClose, onOpenSources, background }: Props) {
  const [sources, setSources] = useState<InstalledSource[]>([]);
  const [selected, setSelected] = useState('all');
  const [results, setResults] = useState<Record<string, Result>>({});
  const [searchText, setSearchText] = useState(query.trim());
  const [notice, setNotice] = useState('');
  const serial = useRef(0);
  const enabled = useMemo(() => sources.filter(source => source.enabled && source.manifest.capabilities.includes('search')), [sources]);
  const enabledKey = enabled.map(source => `${source.id}:${source.manifest.version}`).join('|');
  const localResults = useMemo(() => { const keyword = searchText.toLocaleLowerCase(); return keyword ? localTracks.filter(track => `${track.title} ${track.artist} ${track.album ?? ''}`.toLocaleLowerCase().includes(keyword)).slice(0, 50) : []; }, [localTracks, searchText]);
  useEffect(() => { const bridge = window.yzqxy?.sources; if (!bridge) return; void bridge.list().then(setSources).catch(() => {}); return bridge.onChanged(setSources); }, []);
  useEffect(() => { const timer = window.setTimeout(() => setSearchText(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    const token = ++serial.current; setResults({});
    if (searchText && window.yzqxy?.sources) for (const source of enabled) {
      setResults(previous => ({ ...previous, [source.id]: { items: [], nextCursor: null, loading: true, error: '' } }));
      void window.yzqxy.sources.search(source.id, searchText).then(page => { if (serial.current === token) setResults(previous => ({ ...previous, [source.id]: { items: page.items as TrackView[], nextCursor: page.nextCursor, loading: false, error: '' } })); }).catch(reason => { if (serial.current === token) setResults(previous => ({ ...previous, [source.id]: { items: [], nextCursor: null, loading: false, error: String(reason) } })); });
    }
    return () => { serial.current++; };
  }, [searchText, enabledKey]);
  const loadMore = (source: InstalledSource) => {
    const old = results[source.id]; if (!old?.nextCursor || old.loading) return;
    const token = serial.current; setResults(previous => ({ ...previous, [source.id]: { ...previous[source.id], loading: true } }));
    void window.yzqxy!.sources.search(source.id, searchText, old.nextCursor).then(page => {
      if (serial.current !== token) return;
      setResults(previous => { const current = previous[source.id]; const ids = new Set(current.items.map(track => track.id)); return { ...previous, [source.id]: { items: [...current.items, ...(page.items as TrackView[]).filter(track => !ids.has(track.id))], nextCursor: page.nextCursor, loading: false, error: '' } }; });
    }).catch(reason => { if (serial.current === token) setResults(previous => ({ ...previous, [source.id]: { ...previous[source.id], loading: false, error: String(reason) } })); });
  };
  const renderTracks = (tracks: TrackView[], source?: InstalledSource) => <div className="yz-search-result-list">{tracks.map((track, index) => <div className="yz-search-result-row" key={`${track.id}-${index}`}><button className="yz-search-result-play" disabled={Boolean(source && !source.manifest.capabilities.includes('resolvePlayback'))} title={source && !source.manifest.capabilities.includes('resolvePlayback') ? '此源仅支持浏览' : '播放歌曲'} onClick={() => { onPlayTrack(track, tracks); onClose(); }}><span className="yz-search-result-index">{String(index + 1).padStart(2, '0')}</span><CoverArt title={track.title} coverUrl={track.coverUrl} /><span className="yz-search-result-title"><strong>{track.title}</strong><small>{track.artist || '未知艺术家'}</small></span><span className="yz-search-result-album">{track.album || ''}</span><span className="yz-search-result-time">{formatTime(track.duration)}</span></button>{source?.manifest.capabilities.includes('resolveDownload') && <button className="yz-search-download" title="下载歌曲" aria-label={`下载 ${track.title}`} onClick={() => void window.yzqxy?.sources.download({ ...track, audioUrl: track.audioUrl || '' } as Track, localStorage.getItem('zenix.onlineQuality') || 'high').then(() => setNotice(`已加入下载：${track.title}`)).catch(reason => setNotice(String(reason)))}><Download size={15} /></button>}</div>)}</div>;
  return <><button className="yz-search-dismiss" onClick={onClose} aria-label="关闭搜索" tabIndex={-1} /><div className="yz-search-overlay" role="dialog" aria-label="搜索音乐"><PersonalBackdrop background={background ?? null} scene="search" /><div className="yz-search-top"><form onSubmit={(event: FormEvent) => { event.preventDefault(); setSearchText(query.trim()); }} className="yz-search-large"><Search size={20} /><input autoFocus value={query} onChange={event => onQueryChange(event.target.value)} placeholder="搜索音乐" aria-label="搜索音乐" /><button title="搜索" aria-label="搜索"><Search size={18} /></button></form><button className="yz-search-close" onClick={onClose} title="关闭搜索" aria-label="关闭搜索"><X size={20} /></button></div>
    <div className="yz-search-sources" role="tablist" aria-label="搜索来源"><button role="tab" aria-selected={selected === 'all'} className={selected === 'all' ? 'is-active' : ''} onClick={() => setSelected('all')}>全部音乐源</button>{enabled.map(source => <button key={source.id} role="tab" aria-selected={selected === source.id} className={selected === source.id ? 'is-active' : ''} onClick={() => setSelected(source.id)}>{source.manifest.name}</button>)}<button role="tab" aria-selected={selected === 'local'} className={selected === 'local' ? 'is-active' : ''} onClick={() => setSelected('local')}>本地</button><button className="yz-search-manage" onClick={onOpenSources}>管理音乐源</button></div>
    <div className="yz-search-results">{!searchText && <div className="yz-search-status">输入歌名、歌手或专辑开始搜索</div>}{searchText && enabled.length === 0 && selected !== 'local' && <div className="yz-search-status"><span>尚未添加音乐源</span><button onClick={onOpenSources}>添加音乐源</button></div>}{searchText && selected !== 'local' && enabled.filter(source => selected === 'all' || selected === source.id).map(source => { const page = results[source.id]; return <section className="yz-search-source-group" key={source.id}><h3>{source.manifest.name}<small>{page?.loading ? '搜索中…' : page?.items.length ? `${page.items.length} 首` : ''}</small></h3>{page?.items.length ? renderTracks(page.items, source) : <div className="yz-search-source-empty">{page?.error || (page?.loading ? '正在获取结果…' : '暂无结果')}</div>}{page?.nextCursor && <button className="yz-search-more" disabled={page.loading} onClick={() => loadMore(source)}>{page.loading ? '加载中…' : '加载更多'}</button>}</section>; })}{searchText && (selected === 'all' || selected === 'local' || enabled.length === 0) && <section className="yz-search-source-group"><h3>本地歌曲<small>备用</small></h3>{localResults.length ? renderTracks(localResults) : <div className="yz-search-source-empty">本地曲库没有匹配歌曲</div>}</section>}</div>{notice && <div className="yz-search-download-notice" role="status">{notice}</div>}
  </div></>;
}
