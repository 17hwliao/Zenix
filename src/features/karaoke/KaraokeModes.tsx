import {lazy,Suspense,useEffect,useId,useMemo,useRef,useState} from 'react';
import {Mic2,Search,Users} from 'lucide-react';
import type {InstalledSource,RawLyrics,Track} from '../../core/types';
import {recordingFor,recordingIdentity} from '../recording';
import KaraokeSongSearch from './KaraokeSongSearch';
import './KaraokeModes.css';

const SoloPanel = lazy(() => import('./KaraokePanel'));
const LanPanel = lazy(() => import('./KaraokeLanPanel'));

export default function KaraokeModes({mobile,tracks,sources,readLyrics,reducedMotion,playbackWasPlaying,onBack}: {
  mobile: boolean;
  tracks: readonly Track[];
  sources: readonly InstalledSource[];
  readLyrics(track: Track): Promise<RawLyrics | null>;
  reducedMotion: boolean;
  playbackWasPlaying: boolean;
  onBack(): void;
}) {
  const [mode,setMode] = useState<'solo'|'lan'>('solo');
  const [selection,setSelection] = useState<Track>();
  const [searchOpen,setSearchOpen] = useState(false);
  const searchId = useId();
  const searchButton = useRef<HTMLButtonElement>(null);
  const choices = useMemo(() => {
    const list = new Map<string,Track>();
    for (const input of tracks) {
      const track = recordingFor(input);
      if (track.availability === 'unavailable') continue;
      const identity = encodeURIComponent(recordingIdentity(track));
      if (!list.has(identity)) list.set(identity,track);
    }
    if (selection) list.set(encodeURIComponent(recordingIdentity(selection)),selection);
    return list;
  },[tracks,selection]);
  const track = selection ?? choices.values().next().value;
  const selected = track ? encodeURIComponent(recordingIdentity(track)) : undefined;
  useEffect(() => {
    if (!selection && track) setSelection(track);
  },[selection,track]);

  return <div className="zenix-karaoke-modes">
    <div className="zenix-karaoke-mode-header">
      <div className="zenix-karaoke-mode-buttons" role="group" aria-label="K 歌模式">
        <button type="button" aria-pressed={mode === 'solo'} onClick={() => setMode('solo')}><Mic2 size={17} aria-hidden="true"/>个人练唱</button>
        <button type="button" aria-pressed={mode === 'lan'} onClick={() => {
          setSearchOpen(false);
          setMode('lan');
        }}><Users size={17} aria-hidden="true"/>局域网对战</button>
      </div>
      {mode === 'solo' && <div className="zenix-karaoke-song-controls">
        {choices.size > 0 && <label className="zenix-karaoke-solo-picker">练唱歌曲<select aria-label="练唱歌曲" value={selected} onChange={event => setSelection(choices.get(event.target.value))}>
          {[...choices].map(([id,song]) => <option key={id} value={id}>{song.title}{song.artist ? ` · ${song.artist}` : ''}</option>)}
        </select></label>}
        <button ref={searchButton} type="button" aria-expanded={searchOpen} aria-controls={searchOpen ? searchId : undefined}
          onClick={() => setSearchOpen(open => !open)}><Search size={16} aria-hidden="true"/>搜索歌曲</button>
      </div>}
    </div>
    {mode === 'solo' && searchOpen && <KaraokeSongSearch id={searchId} mobile={mobile} tracks={[...choices.values()]} sources={sources} onSelect={song => {
      setSelection(recordingFor(song));
      setSearchOpen(false);
      searchButton.current?.focus();
    }}/>}
    <Suspense fallback={<div className="zenix-feature-karaoke-loading" role="status">正在准备 K 歌</div>}>
      {mode === 'solo' ? <SoloPanel key={selected ?? 'empty'} mobile={mobile} track={track} tracks={[...choices.values()]} sources={sources} playbackWasPlaying={playbackWasPlaying} readLyrics={readLyrics}/>
        : <LanPanel mobile={mobile} tracks={tracks} sources={sources} readLyrics={readLyrics} reducedMotion={reducedMotion} onBack={onBack}/>}
    </Suspense>
  </div>;
}
