import { useEffect, useState } from 'react';
import { Mic2, Pause, Play, RotateCcw, Square, Trophy } from 'lucide-react';
import { formatKaraokeTime, performanceStatusLabel } from './model';
import {
  KaraokeErrorNotice,
  KaraokePageFrame,
  KaraokePerformanceStage,
  KaraokeResultDialog,
  KaraokeStatusNotice,
} from './components';
import type { MobileKaraokeSoloPageProps } from './types';
import './karaoke-ui.css';

export default function MobileKaraokeSoloPage({
  track,
  singerName,
  lyrics,
  performance,
  result,
  phase,
  statusTitle,
  statusMessage,
  error,
  onDismissStatus,
  onDismissError,
  onRetry,
  onBack,
  onStart,
  onPause,
  onResume,
  onFinish,
}: MobileKaraokeSoloPageProps) {
  const [resultOpen, setResultOpen] = useState(Boolean(result));
  useEffect(() => {
    if (result) setResultOpen(true);
  }, [result]);

  const disabled = phase === 'loading' || phase === 'failed' || phase === 'host-stopped';
  const elapsed = Math.max(0, performance.elapsedMs);
  const total = Math.max(0, performance.durationMs || track.durationMs);

  return (
    <KaraokePageFrame
      eyebrow="单人 K 歌"
      title="唱出你的这一刻"
      phase={phase}
      onBack={onBack}
      mobile
    >
      <KaraokeStatusNotice
        phase={phase}
        title={statusTitle}
        message={statusMessage}
        onDismiss={onDismissStatus}
      />
      {error && <KaraokeErrorNotice error={error} onDismiss={onDismissError} onRetry={onRetry} />}
      {phase === 'disconnected' && onRetry && (
        <div className="zenix-karaoke-connection-action">
          <span>连接已断开，当前演唱资料仍保留。</span>
          <button type="button" onClick={() => void onRetry()}>重新连接</button>
        </div>
      )}

      <section className="zenix-karaoke-mobile-track" aria-labelledby="zenix-karaoke-mobile-track-title">
        {track.artworkUrl
          ? <img src={track.artworkUrl} alt="" />
          : <span className="zenix-karaoke-mobile-art" aria-hidden="true"><Mic2 /></span>}
        <div>
          <small>{singerName} · {performanceStatusLabel(performance.status)}</small>
          <h2 id="zenix-karaoke-mobile-track-title">{track.title}</h2>
          <p>{track.artist}</p>
        </div>
      </section>

      <div className="zenix-karaoke-mobile-progress">
        <span>{formatKaraokeTime(elapsed)}</span>
        <div role="progressbar" aria-label="歌曲演唱进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(total ? Math.min(100, elapsed / total * 100) : 0)}>
          <i style={{'--karaoke-song-progress': total ? Math.min(1, elapsed / total) : 0} as React.CSSProperties} />
        </div>
        <span>{formatKaraokeTime(total)}</span>
      </div>

      <KaraokePerformanceStage
        track={track}
        performance={performance}
        lyrics={lyrics}
        compact
      />

      {phase === 'complete' && result && (
        <button type="button" className="zenix-karaoke-complete-inline" onClick={() => setResultOpen(true)}>
          <Trophy aria-hidden="true" />
          <span><strong>总分 {Math.round(result.total)}</strong><small>查看逐句点评</small></span>
        </button>
      )}

      <div className="zenix-karaoke-mobile-controls" role="group" aria-label="演唱控制">
        {performance.status === 'singing' ? (
          <button type="button" className="is-primary" aria-label="暂停演唱" disabled={disabled || !onPause} onClick={() => void onPause?.()}>
            <Pause aria-hidden="true" />暂停
          </button>
        ) : performance.status === 'paused' ? (
          <button type="button" className="is-primary" aria-label="继续演唱" disabled={disabled || !onResume} onClick={() => void onResume?.()}>
            <Play aria-hidden="true" />继续
          </button>
        ) : performance.status === 'complete' ? (
          <button type="button" className="is-primary" aria-label="再唱一次" disabled={disabled || !onStart} onClick={() => void onStart?.()}>
            <RotateCcw aria-hidden="true" />再唱一次
          </button>
        ) : (
          <button type="button" className="is-primary" aria-label="开始演唱" disabled={disabled || !onStart} onClick={() => void onStart?.()}>
            <Play aria-hidden="true" />开始演唱
          </button>
        )}
        <button type="button" aria-label="结束演唱" disabled={disabled || !onFinish || performance.status === 'idle'} onClick={() => void onFinish?.()}>
          <Square aria-hidden="true" />结束
        </button>
      </div>

      <p className="zenix-karaoke-mobile-hint">
        麦克风采音、伴奏播放和评分由主界面注入；这个页面只显示状态并触发回调。
      </p>

      <KaraokeResultDialog
        open={resultOpen && Boolean(result)}
        score={result}
        lyrics={lyrics}
        onClose={() => setResultOpen(false)}
      />
    </KaraokePageFrame>
  );
}
