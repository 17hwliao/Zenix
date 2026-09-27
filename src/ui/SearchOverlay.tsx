import { FormEvent, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import CoverArt from './CoverArt';
import { formatTime } from './library';
import type { TrackView } from './types';

// Full-screen search surface for anonymous online results and the local library.
type SearchSource = 'netease' | 'local' | 'navidrome';

type SearchOverlayProps = {
  initialSource: SearchSource;
  query: string;
  onQueryChange: (query: string) => void;
  localTracks: TrackView[];
  onlineResults: TrackView[];
  onlineSearching: boolean;
  onlineHasMore: boolean;
  onSearchOnline?: (query: string) => void | Promise<void>;
  onLoadMore?: () => void | Promise<void>;
  onPlayTrack: (track: TrackView, queue?: TrackView[]) => void;
  onClose: () => void;
};

export default function SearchOverlay({ initialSource, query, onQueryChange, localTracks, onlineResults, onlineSearching, onlineHasMore, onSearchOnline, onLoadMore, onPlayTrack, onClose }: SearchOverlayProps) {
  const [source, setSource] = useState<SearchSource>(initialSource);
  const [submittedQuery, setSubmittedQuery] = useState(query.trim());
  const keyword = query.trim().toLocaleLowerCase();
  const localResults = keyword ? localTracks.filter(track => `${track.title} ${track.artist} ${track.album ?? ''}`.toLocaleLowerCase().includes(keyword)) : [];
  const results = source === 'local' ? localResults : source === 'netease' ? onlineResults : [];
  const isLoading = source === 'netease' && onlineSearching && onlineResults.length === 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    if (source === 'netease' && query.trim()) void onSearchOnline?.(query.trim());
  };

  return (
    <div className="yz-search-overlay">
      <div className="yz-search-top">
        <form onSubmit={submit} className="yz-search-large"><Search size={20} /><input autoFocus value={query} onChange={event => onQueryChange(event.target.value)} placeholder="搜索音乐" aria-label="搜索音乐" /><button title="搜索" aria-label="搜索"><Search size={18} /></button></form>
        <button className="yz-search-close" onClick={onClose} title="关闭搜索" aria-label="关闭搜索"><X size={20} /></button>
      </div>
      <div className="yz-search-sources" role="tablist" aria-label="搜索来源">
        {([{ id: 'netease', label: '网易云' }, { id: 'local', label: '本地' }, { id: 'navidrome', label: 'Navidrome' }] as const).map(item => <button key={item.id} role="tab" aria-selected={source === item.id} className={source === item.id ? 'is-active' : ''} onClick={() => { setSource(item.id); if (item.id === 'netease' && query.trim()) void onSearchOnline?.(query.trim()); }}>{item.label}</button>)}
      </div>
      <div className="yz-search-results">
        {isLoading ? <div className="yz-search-status"><Loader2 className="yz-spin" size={24} /><span>正在搜索...</span></div> : results.length ? <div className="yz-search-result-list">
          {results.map((track, index) => <button key={`${track.id}-${index}`} onClick={() => { onPlayTrack(track, results); onClose(); }}><span className="yz-search-result-index">{String(index + 1).padStart(2, '0')}</span><CoverArt title={track.title} coverUrl={track.coverUrl} /><span className="yz-search-result-title"><strong>{track.title}</strong><small>{track.artist || '未知艺术家'}</small></span><span className="yz-search-result-album">{track.album || ''}</span><span className="yz-search-result-time">{formatTime(track.duration)}</span></button>)}
          {source === 'netease' && onlineHasMore && <button className="yz-search-more" onClick={() => void onLoadMore?.()} disabled={!onLoadMore || onlineSearching}>{onlineSearching ? '加载中...' : '加载更多'}</button>}
        </div> : <div className="yz-search-status"><span>{source === 'navidrome' ? '未连接 Navidrome' : submittedQuery || source === 'local' ? '未找到相关结果' : '搜索音乐'}</span></div>}
      </div>
    </div>
  );
}
