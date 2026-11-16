import { useRef, useState, type ChangeEvent } from 'react';
import {
  Info,
  Mic2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Square,
  Trophy,
  Upload,
} from 'lucide-react';
import type { RawLyrics, Track } from '../../core/types';
import type {
  KaraokePerformanceView,
  KaraokePitchView,
  KaraokeUiPhase,
  KaraokeUiTrack,
} from './ui';
import {
  KaraokeErrorNotice,
  KaraokePerformanceStage,
  KaraokeResultDialog,
  MobileKaraokeSoloPage,
  performanceStatusLabel,
} from './ui';
import {
  activeKaraokeLineIndex,
  targetKaraokeMidi,
} from './adapter';
import { useKaraokeSession } from './useKaraokeSession';
import './KaraokePanel.css';

interface KaraokePanelProps {
  mobile: boolean;
  track?: Track;
  playbackWasPlaying?: boolean;
  readLyrics(track: Track): Promise<RawLyrics | null>;
  onBack(): void;
  onOpenConnections(): void;
}

function uiTrack(track: Track | undefined, durationMs: number): KaraokeUiTrack | null {
  if (!track) return null;
  return {
    recordingId: track.playbackRecording?.remoteId || track.remoteId || track.id,
    title: track.title,
    artist: track.artist,
    durationMs: durationMs || Math.max(0, track.duration * 1000),
    artworkUrl: track.coverUrl,
  };
}

function performanceStatus(status: ReturnType<typeof useKaraokeSession>['status']): KaraokePerformanceView['status'] {
  if (status === 'singing') return 'singing';
  if (status === 'paused') return 'paused';
  if (status === 'complete') return 'complete';
  return 'idle';
}

function SourceTools({
  disabled,
  hasTrack,
  sourceLabel,
  importing,
  onImport,
}: {
  disabled: boolean;
  hasTrack: boolean;
  sourceLabel: string;
  importing: boolean;
  onImport(file: File): Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const change = async(event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (selected) await onImport(selected);
  };
  return (
    <section className="karaoke-adapter-source" aria-labelledby="karaoke-adapter-source-title">
      <div>
        <span><Upload aria-hidden="true" /></span>
        <div>
          <h3 id="karaoke-adapter-source-title">音高参考</h3>
          <p>{sourceLabel || '正在检查歌曲自带音高资料'}</p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept=".mid,.midi,.ulstar,.ultrastar,.txt,.lrc"
        disabled={disabled || !hasTrack}
        onChange={event => void change(event)}
      />
      <button
        type="button"
        disabled={disabled || !hasTrack || importing}
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden="true" />{importing ? '正在导入' : '导入本地音高'}
      </button>
      <small>支持 MIDI、UltraStar 和带逐字音高的增强 LRC。导入失败会保留当前参考。</small>
    </section>
  );
}

export default function KaraokePanel({
  mobile,
  track,
  playbackWasPlaying = false,
  readLyrics,
  onBack,
  onOpenConnections,
}: KaraokePanelProps) {
  const session = useKaraokeSession({track, readLyrics});
  const [resultOpen, setResultOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const lines = session.descriptor?.pitchTrack?.lines ?? [];
  const durationMs = session.descriptor?.durationMs || Math.max(0, (session.sessionTrack?.duration || 0) * 1000);
  const currentTrack = uiTrack(session.sessionTrack, durationMs);
  const activeLineIndex = activeKaraokeLineIndex(lines, session.elapsedMs);
  const currentLine = activeLineIndex >= 0 ? lines[activeLineIndex] : null;
  const targetMidi = targetKaraokeMidi(currentLine, session.elapsedMs);
  const trustedPitch = lines.some(line => line.notes.length > 0);
  const detectedMidi = session.latestFrame?.midi ?? null;
  const pitch: KaraokePitchView = {
    status: !trustedPitch ? 'unsupported' : detectedMidi === null ? 'no-signal' : 'tracking',
    targetMidi,
    detectedMidi,
    confidence: session.latestFrame?.confidence ?? 0,
    energy: session.latestFrame?.energy ?? 0,
  };
  const lineProgress = currentLine && currentLine.endMs > currentLine.startMs
    ? Math.max(0, Math.min(1, (session.elapsedMs - currentLine.startMs) / (currentLine.endMs - currentLine.startMs)))
    : 0;
  const performanceView: KaraokePerformanceView = {
    status: performanceStatus(session.status),
    elapsedMs: session.elapsedMs,
    durationMs,
    activeLineIndex: Math.max(0, activeLineIndex),
    lineProgress,
    pitch,
    singerNames: ['我'],
  };
  const phase: KaraokeUiPhase = session.status === 'loading'
    ? 'loading'
    : session.status === 'failed'
      ? 'failed'
      : !session.sessionTrack || !lines.length
        ? 'empty'
        : session.status === 'complete'
          ? 'complete'
          : 'ready';
  const active = session.status === 'singing' || session.status === 'paused';
  const statusTitle = session.status === 'requesting'
    ? '等待麦克风权限'
    : session.status === 'singing'
      ? '正在采集你的歌声'
      : session.status === 'paused'
        ? '本轮演唱已暂停'
        : session.status === 'complete'
          ? '本轮演唱已完成'
          : !session.sessionTrack
            ? '请先播放一首歌曲'
            : !lines.length
              ? '当前歌曲没有逐句歌词'
              : undefined;
  const statusMessage = session.status === 'requesting'
    ? '允许麦克风后才会开始实时音高分析与评分。'
    : !session.sessionTrack
      ? 'K 歌会话只会读取当前播放歌曲；关闭工作台即可退出。'
      : !lines.length
        ? '可导入 MIDI、UltraStar 或增强 LRC 作为歌词与音高参考。'
        : !trustedPitch
          ? '歌曲有歌词时间线，但没有可信音高轨；本轮会如实标记“音准未评估”。'
          : undefined;
  const importFile = async(file: File) => {
    setImporting(true);
    try {
      const data = file.name.toLowerCase().endsWith('.mid') || file.name.toLowerCase().endsWith('.midi')
        ? await file.arrayBuffer()
        : await file.text();
      await session.importPitchReference({name: file.name, type: file.type, data});
    } finally {
      setImporting(false);
    }
  };

  const controls = (
    <div className="karaoke-adapter-controls" role="group" aria-label="单人 K 歌控制">
      {session.status === 'singing' ? (
        <button type="button" className="is-primary" onClick={session.pause}>
          <Pause aria-hidden="true" />暂停
        </button>
      ) : session.status === 'paused' ? (
        <button type="button" className="is-primary" onClick={() => void session.resume()}>
          <Play aria-hidden="true" />继续
        </button>
      ) : session.status === 'complete' ? (
        <button type="button" className="is-primary" onClick={() => void session.start()}>
          <RotateCcw aria-hidden="true" />再唱一次
        </button>
      ) : (
        <button
          type="button"
          className="is-primary"
          disabled={!lines.length || session.status === 'loading' || session.status === 'requesting'}
          onClick={() => void session.start()}
        >
          <Play aria-hidden="true" />{session.status === 'requesting' ? '请求麦克风' : '开始演唱'}
        </button>
      )}
      <button type="button" disabled={!active} onClick={session.finish}>
        <Square aria-hidden="true" />结束并评分
      </button>
    </div>
  );

  const resultCard = session.result ? (
    <section className="karaoke-adapter-result" aria-label="本轮评分摘要">
      <span><Trophy aria-hidden="true" /></span>
      <div>
        <small>{performanceStatusLabel(performanceView.status)}</small>
        <strong>{Math.round(session.result.total)} 分</strong>
        <p>{session.result.pitchEvaluated ? '已使用可信音高轨评估音准。' : '音准未评估：当前没有可信音高轨。'}</p>
      </div>
      <button type="button" onClick={() => setResultOpen(true)}>逐句点评</button>
    </section>
  ) : null;

  const notice = (
    <div className="karaoke-adapter-boundary" aria-label="独立 K 歌模式说明">
      <Info aria-hidden="true" />
      <span>
        <strong>独立单人练唱</strong>
        <p>{playbackWasPlaying
          ? '进入时会冻结当前歌曲，但普通播放器仍在按原状态运行；本页不会切换、暂停或改写播放队列。'
          : '本页不会切换、暂停或改写普通播放器与队列。'}</p>
      </span>
      <button type="button" onClick={onOpenConnections}>
        <Radio aria-hidden="true" />LAN 房间入口
      </button>
    </div>
  );

  if (mobile) {
    return (
      <div className="karaoke-adapter is-mobile" data-karaoke-adapter="mobile">
        <MobileKaraokeSoloPage
          track={currentTrack ?? {
            recordingId: 'unavailable',
            title: '尚未选择歌曲',
            artist: '返回播放器后开始播放一首歌',
            durationMs: 0,
          }}
          singerName="我"
          lyrics={lines}
          performance={performanceView}
          result={session.result}
          phase={phase}
          statusTitle={statusTitle}
          statusMessage={statusMessage}
          error={session.error}
          onDismissError={session.dismissError}
          onRetry={() => void session.start()}
          onBack={onBack}
          onStart={lines.length ? () => void session.start() : undefined}
          onPause={session.pause}
          onResume={() => void session.resume()}
          onFinish={session.finish}
        />
        {notice}
        <SourceTools
          disabled={active || session.status === 'requesting'}
          hasTrack={Boolean(session.sessionTrack)}
          sourceLabel={session.sourceLabel}
          importing={importing}
          onImport={importFile}
        />
      </div>
    );
  }

  return (
    <div className="karaoke-adapter karaoke-ui is-pc" data-karaoke-adapter="desktop">
      <header className="karaoke-adapter-head">
        <div>
          <span><Mic2 aria-hidden="true" />SOLO PRACTICE</span>
          <h2>单人 K 歌</h2>
          <p>使用当前歌曲创建独立练唱会话，不接管普通播放器和队列。</p>
        </div>
        <div className="karaoke-adapter-live">
          <i className={session.status === 'singing' ? 'is-live' : undefined} aria-hidden="true" />
          <span>
            <small>麦克风</small>
            <strong>{session.microphoneGranted ? '已授权' : session.status === 'requesting' ? '请求中' : '待开始'}</strong>
          </span>
        </div>
      </header>

      {notice}
      {session.error && (
        <KaraokeErrorNotice
          error={session.error}
          onDismiss={session.dismissError}
          onRetry={session.status === 'failed' ? () => void session.start() : undefined}
        />
      )}

      <div className="karaoke-adapter-layout">
        <KaraokePerformanceStage
          track={currentTrack}
          performance={performanceView}
          lyrics={lines}
        />
        <aside className="karaoke-adapter-side">
          <section className="karaoke-adapter-session" aria-labelledby="karaoke-adapter-session-title">
            <small>SESSION</small>
            <h3 id="karaoke-adapter-session-title">{statusTitle || '准备好后开始演唱'}</h3>
            <p>{statusMessage || '麦克风音频只用于本地实时音高分析；结束或关闭工作台时会立即释放。'}</p>
            {controls}
          </section>
          {resultCard}
          <SourceTools
            disabled={active || session.status === 'requesting'}
            hasTrack={Boolean(session.sessionTrack)}
            sourceLabel={session.sourceLabel}
            importing={importing}
            onImport={importFile}
          />
        </aside>
      </div>

      <KaraokeResultDialog
        open={resultOpen && Boolean(session.result)}
        score={session.result}
        lyrics={lines}
        onClose={() => setResultOpen(false)}
      />
    </div>
  );
}
