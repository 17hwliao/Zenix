import { Search, X } from 'lucide-react';
import CoverArt from './CoverArt';
import { formatTime } from './library';
import type { TrackView } from './types';
import type { AppearanceBackground, InstalledSource } from '../core/types';
import type { MusicSearch } from './useMusicSearch';
import PersonalBackdrop from './PersonalBackdrop';

type Props = {
  query: string;
  onQueryChange: (query: string) => void;
  search: MusicSearch;
  onPlayTrack: (track: TrackView, queue?: TrackView[]) => void;
  onShowResults: () => void;
  onClose: () => void;
  onOpenSources: () => void;
  background?: AppearanceBackground | null;
};

export default function SearchOverlay({ query, onQueryChange, search, onPlayTrack, onShowResults, onClose, onOpenSources, background }: Props) {
  const { enabled, selected, setSelected, pages, keyword, localResults, playableTracks, sourcesError, loadMore } = search;
  const renderTracks = (tracks: TrackView[], source?: InstalledSource) => <div className="yz-search-result-list">{tracks.map((track, index) => <div className="yz-search-result-row" key={track.id}>
    <button className="yz-search-result-play" disabled={Boolean(source && !source.manifest.capabilities.includes('resolvePlayback'))} title={source && !source.manifest.capabilities.includes('resolvePlayback') ? '此源仅支持浏览' : '播放歌曲'} onClick={() => { onPlayTrack(track, playableTracks); onClose(); }}>
      <span className="yz-search-result-index">{String(index + 1).padStart(2, '0')}</span><CoverArt title={track.title} coverUrl={track.coverUrl} />
      <span className="yz-search-result-title"><strong>{track.title}</strong><small>{track.artist || '未知艺术家'}</small></span>
      <span className="yz-search-result-album">{track.album || ''}</span><span className="yz-search-result-time">{formatTime(track.duration)}</span>
    </button>
  </div>)}</div>;
  return <>
    <button className="yz-search-dismiss" onClick={keyword ? onShowResults : onClose} aria-label={keyword ? '查看搜索结果贴纸' : '关闭搜索'} tabIndex={-1} />
    <div className="yz-search-overlay" role="dialog" aria-label="搜索音乐">
      <PersonalBackdrop background={background ?? null} scene="search" />
      <div className="yz-search-top">
        <form onSubmit={event => { event.preventDefault(); if (keyword) onShowResults(); }} className="yz-search-large"><Search size={20} />
          <input autoFocus value={query} onChange={event => onQueryChange(event.target.value)} placeholder="搜索音乐" aria-label="搜索音乐" />
          <button type="submit" title="查看搜索结果" aria-label="搜索"><Search size={18} /></button>
        </form>
        <button className="yz-search-close" onClick={onClose} title="关闭搜索" aria-label="关闭搜索"><X size={20} /></button>
      </div>
      <div className="yz-search-sources" role="tablist" aria-label="搜索来源">
        <button role="tab" aria-selected={selected === 'all'} className={selected === 'all' ? 'is-active' : ''} onClick={() => setSelected('all')}>全部音乐源</button>
        {enabled.map(source => <button key={source.id} role="tab" aria-selected={selected === source.id} className={selected === source.id ? 'is-active' : ''} onClick={() => setSelected(source.id)}>{source.manifest.name}</button>)}
        <button role="tab" aria-selected={selected === 'local'} className={selected === 'local' ? 'is-active' : ''} onClick={() => setSelected('local')}>本地</button>
        <button className="yz-search-manage" onClick={onOpenSources}>管理音乐源</button>
      </div>
      <div className="yz-search-results">
        {!keyword && <div className="yz-search-status">输入歌名、歌手或专辑开始搜索</div>}
        {sourcesError && <div className="yz-search-status" role="status">{sourcesError}</div>}
        {keyword && enabled.length === 0 && selected !== 'local' && <div className="yz-search-status"><span>尚未添加音乐源</span><button onClick={onOpenSources}>添加音乐源</button></div>}
        {keyword && selected !== 'local' && enabled.filter(source => selected === 'all' || selected === source.id).map(source => {
          const page = pages[source.id];
          return <section className="yz-search-source-group" key={source.id}><h3>{source.manifest.name}<small>{!page || page.loading ? '搜索中…' : page.items.length ? `${page.items.length} 首` : ''}</small></h3>
            {page?.items.length ? renderTracks(page.items, source) : <div className="yz-search-source-empty">{page?.error || (!page || page.loading ? '正在获取结果…' : '暂无结果')}</div>}
            {page?.nextCursor && <button className="yz-search-more" disabled={page.loading} onClick={() => loadMore(source)}>{page.loading ? '加载中…' : '加载更多'}</button>}
          </section>;
        })}
        {keyword && (selected === 'all' || selected === 'local') && <section className="yz-search-source-group"><h3>本地歌曲<small>备用</small></h3>{localResults.length ? renderTracks(localResults) : <div className="yz-search-source-empty">本地曲库没有匹配歌曲</div>}</section>}
      </div>
    </div>
  </>;
}
