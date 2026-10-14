import React from 'react';
import { createRoot } from 'react-dom/client';
import ZenixShell from '../../src/ui/ZenixShell';
import LatticePlayer from '../../src/ui/LatticePlayer';
const noop = () => {};
const root = createRoot(document.getElementById('root')!);
const fixture = { toggles: 0, plays: [] as string[], renderWall: (count: number) => {
  const wall = Array.from({length:count},(_,i)=>track(String(i)));
  root.render(<LatticePlayer track={wall[0]} hasPlayback={false} displayTracks={wall} queue={[]} queueIndex={-1} personal={{liked:[],favorites:[],history:[],playlists:[]}} playing={false} position={0} duration={120} volume={.5} muted={false} shuffle={false} repeat="all" lyrics={[]} onPlayTrack={noop} onBack={noop} onTogglePlay={noop} onPrevious={noop} onNext={noop} onSeek={noop} onVolumeChange={noop} onOpenQueue={noop} onExpandPlayer={noop} onOpenSettings={noop} onOpenSearch={noop}/>);
} };
(window as any).fixture = fixture;
localStorage.clear(); localStorage.setItem('zenix.ui-sounds.v1', '{"enabled":false}');
const track = (id: string) => ({ id, title: `Fixture ${id}`, artist: 'Regression Artist', album: 'Fixture', source: 'local' as const, path: '', audioUrl: '', duration: 120 });
const songs = [track('A'), track('B')];
root.render(<ZenixShell tracks={songs} queue={songs} currentTrack={songs[0]} personal={{ liked: [songs[1]], favorites: [], history: songs.map(item => ({ id: item.id, track: item, playedAt: 1 })), playlists: [] }}
  playing={false} position={30} duration={120} volume={.5} lyrics={[{ time: 0, text: 'Fixture first line' }, { time: 20, text: '当前播放的歌词' }, { time: 60, text: 'Fixture final line' }]}
  onPlayTrack={item => fixture.plays.push(item.id)} onTogglePlay={() => fixture.toggles++} onPrevious={noop} onNext={noop} onSeek={noop} onVolumeChange={noop} onImportFolder={noop} />);
