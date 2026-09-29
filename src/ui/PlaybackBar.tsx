import { ListMusic, Pause, Play, Repeat2, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import CoverArt from './CoverArt';
import TrackQuickActions from './TrackQuickActions';
import { formatTime } from './library';
import type { TrackView, RepeatMode } from './types';
import type { PersonalState } from '../core/types';
const QUALITY_LABELS: Record<string, string> = { standard: '标准', high: '高音质', lossless: '无损', offline: '离线' };

// A glass playback capsule shared by the library and lyric surfaces.
interface PlaybackBarProps {
  track: TrackView;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  surface: 'home' | 'player';
  personal: PersonalState;
  onToggleSaved?: (kind: 'liked' | 'favorites', track: TrackView) => void;
  onAddToPlaylist?: (id: string, track: TrackView) => void;
  onCreatePlaylist?: (name: string, track: TrackView) => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute?: () => void;
  onToggleShuffle?: () => void;
  onCycleRepeat?: () => void;
  onOpenPlayer: () => void;
  onOpenQueue: () => void;
}

export default function PlaybackBar(props: PlaybackBarProps) {
  const {
    track, playing, position, duration, volume, muted, shuffle, repeat, surface, personal, onToggleSaved, onAddToPlaylist, onCreatePlaylist,
    onTogglePlay, onPrevious, onNext, onSeek, onVolumeChange, onToggleMute,
    onToggleShuffle, onCycleRepeat, onOpenPlayer, onOpenQueue,
  } = props;
  const total = duration || track.duration || 0;
  const progress = total ? Math.min(100, Math.max(0, (position / total) * 100)) : 0;

  return (
    <div className={`yz-playerbar yz-playerbar--${surface}`}>
      <div className="yz-playerbar-main">
        <button className="yz-playerbar-track" onClick={onOpenPlayer} title="打开播放页">
          <CoverArt title={track.title} coverUrl={track.coverUrl} className="yz-playerbar-art" />
          <span className="yz-playerbar-tracktext"><strong>{track.title}</strong><small>{track.artist || '未知艺术家'}{track.actualQuality ? ` · ${QUALITY_LABELS[track.actualQuality] || track.actualQuality}` : ''}</small></span>
        </button>
        <div className="yz-playerbar-center">
          <button className="yz-icon-button yz-playerbar-secondary" onClick={onPrevious} title="上一首" aria-label="上一首"><SkipBack size={17} fill="currentColor" /></button>
          <button className="yz-play-button" onClick={onTogglePlay} title={playing ? '暂停' : '播放'} aria-label={playing ? '暂停' : '播放'}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button className="yz-icon-button yz-playerbar-secondary" onClick={onNext} title="下一首" aria-label="下一首"><SkipForward size={17} fill="currentColor" /></button>
        </div>
        <div className="yz-playerbar-end">
          <TrackQuickActions track={track} personal={personal} onToggleSaved={onToggleSaved} onAddToPlaylist={onAddToPlaylist} onCreatePlaylist={onCreatePlaylist} compact />
          <button className={`yz-icon-button yz-playerbar-secondary ${shuffle ? 'is-active' : ''}`} onClick={onToggleShuffle} disabled={!onToggleShuffle} title="随机播放" aria-label="随机播放"><Shuffle size={17} /></button>
          <button className={`yz-icon-button yz-playerbar-secondary ${repeat !== 'off' ? 'is-active' : ''}`} onClick={onCycleRepeat} disabled={!onCycleRepeat} title={repeat === 'one' ? '单曲循环' : repeat === 'all' ? '列表循环' : '循环关闭'} aria-label="切换循环模式">
            {repeat === 'one' ? <Repeat1 size={17} /> : <Repeat2 size={17} />}
          </button>
          <button className="yz-icon-button" onClick={onOpenQueue} title="播放队列" aria-label="播放队列"><ListMusic size={18} /></button>
        </div>
      </div>
      <div className="yz-playerbar-detail">
        <span>{formatTime(position)}</span>
        <input
          className="yz-range yz-seek"
          type="range"
          min="0"
          max={Math.max(total, 1)}
          step="0.1"
          value={Math.min(position, Math.max(total, 1))}
          onChange={event => onSeek(Number(event.target.value))}
          aria-label="播放进度"
          style={{ '--range-fill': `${progress}%` } as React.CSSProperties}
        />
        <span>{formatTime(total)}</span>
        <div className="yz-playerbar-volume">
          <button className="yz-icon-button" onClick={() => onToggleMute ? onToggleMute() : onVolumeChange(muted || volume === 0 ? 0.7 : 0)} title="静音" aria-label="切换静音">
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input className="yz-range" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={event => onVolumeChange(Number(event.target.value))} aria-label="音量" style={{ '--range-fill': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties} />
        </div>
      </div>
    </div>
  );
}
