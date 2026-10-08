import { MoreHorizontal, Pause, Play } from 'lucide-react';
import type { Track } from '../core/types';
import { Art } from './Player';
import { useSongGesture } from './useSongGesture';

export default function SearchResults({ songs, currentId, playing, play, menu }: { songs: Track[]; currentId?: string; playing: boolean; play: (song: Track) => void; menu: (song: Track) => void }) {
  return <div className="mobile-search-results" aria-label="搜索结果">{songs.map(song => <Result key={song.id} song={song} current={song.id === currentId} playing={playing} play={() => play(song)} menu={() => menu(song)}/>)}</div>;
}
function Result({ song, current, playing, play, menu }: { song: Track; current: boolean; playing: boolean; play: () => void; menu: () => void }) {
  const gesture = useSongGesture(menu);
  return <article className={`mobile-search-result glass ${current ? 'is-current' : ''}`}>
    <button className="search-result-info" {...gesture.handlers} onClick={menu} aria-label={`查看 ${song.title}`}><Art track={song}/><span><strong>{song.title}</strong><small>{song.artist}{song.album ? ` · ${song.album}` : ''}</small>{current && <small className="search-playing-label">{playing ? '正在播放' : '当前歌曲'}</small>}</span></button>
    <button aria-label={`${current && playing ? '暂停' : '播放'} ${song.title}`} onClick={play}>{current && playing ? <Pause/> : <Play/>}</button><button aria-label={`更多 ${song.title}`} onClick={menu}><MoreHorizontal/></button>
  </article>;
}
