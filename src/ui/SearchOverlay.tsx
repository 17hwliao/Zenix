import { FormEvent, useState } from 'react';
import { Search, X } from 'lucide-react';
import CoverArt from './CoverArt';
import { formatTime } from './library';
import type { TrackView } from './types';
import type { AppearanceBackground } from '../core/types';
import PersonalBackdrop from './PersonalBackdrop';

// The search tray stays above the sticker wall and uses the selected personal media.
type SearchSource = 'local' | 'custom';

type SearchOverlayProps = {
  query: string;
  onQueryChange: (query: string) => void;
  localTracks: TrackView[];
  onPlayTrack: (track: TrackView, queue?: TrackView[]) => void;
  onClose: () => void;
  background?: AppearanceBackground | null;
};

export default function SearchOverlay({ query, onQueryChange, localTracks, onPlayTrack, onClose, background }: SearchOverlayProps) {
  const [source, setSource] = useState<SearchSource>('local');
  const [submittedQuery, setSubmittedQuery] = useState(query.trim());
  const keyword = query.trim().toLocaleLowerCase();
  const localResults = keyword ? localTracks.filter(track => `${track.title} ${track.artist} ${track.album ?? ''}`.toLocaleLowerCase().includes(keyword)) : [];
  const results = source === 'local' ? localResults : [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  };

  return <>
    <button className="yz-search-dismiss" onClick={onClose} aria-label="关闭搜索" tabIndex={-1} />
    <div className="yz-search-overlay" role="dialog" aria-label="搜索音乐">
      <PersonalBackdrop background={background ?? null} scene="search" />
      <div className="yz-search-top">
        <form onSubmit={submit} className="yz-search-large"><Search size={20} /><input autoFocus value={query} onChange={event => onQueryChange(event.target.value)} placeholder="搜索音乐" aria-label="搜索音乐" /><button title="搜索" aria-label="搜索"><Search size={18} /></button></form>
        <button className="yz-search-close" onClick={onClose} title="关闭搜索" aria-label="关闭搜索"><X size={20} /></button>
      </div>
      <div className="yz-search-sources" role="tablist" aria-label="搜索来源">
        {([{ id: 'local', label: '本地' }, { id: 'custom', label: '自定义源' }] as const).map(item => <button key={item.id} role="tab" aria-selected={source === item.id} className={source === item.id ? 'is-active' : ''} onClick={() => setSource(item.id)}>{item.label}</button>)}
      </div>
      <div className="yz-search-results">
        {results.length ? <div className="yz-search-result-list">
          {results.map((track, index) => <button key={`${track.id}-${index}`} onClick={() => { onPlayTrack(track, results); onClose(); }}><span className="yz-search-result-index">{String(index + 1).padStart(2, '0')}</span><CoverArt title={track.title} coverUrl={track.coverUrl} /><span className="yz-search-result-title"><strong>{track.title}</strong><small>{track.artist || '未知艺术家'}</small></span><span className="yz-search-result-album">{track.album || ''}</span><span className="yz-search-result-time">{formatTime(track.duration)}</span></button>)}
        </div> : <div className="yz-search-status"><span>{source === 'custom' ? '自定义源尚未接入' : submittedQuery ? '未找到相关结果' : '搜索本地音乐'}</span></div>}
      </div>
    </div>
  </>;
}
