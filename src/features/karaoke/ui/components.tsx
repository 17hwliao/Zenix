import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  LoaderCircle,
  Mic2,
  Music2,
  RotateCcw,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import type {
  KaraokeLyricLine,
  KaraokeQueueItem,
  KaraokeQueueMode,
  KaraokeRoomState,
  KaraokeScore,
} from '../contracts';
import {
  clampUnit,
  feedbackRows,
  findTrack,
  getFiveLineLyricWindow,
  joinStatusLabel,
  karaokePhaseCopy,
  memberNames,
  memberRoleLabel,
  noteName,
  performanceStatusLabel,
  pitchOffsetLabel,
  queueModeLabel,
  queueStateLabel,
} from './model';
import type {
  KaraokeJoinRequestView,
  KaraokePerformanceView,
  KaraokeUiAction,
  KaraokeUiError,
  KaraokeUiPhase,
  KaraokeUiTrack,
  KaraokeUiValueAction,
} from './types';

export function KaraokeStatusNotice({
  phase,
  title,
  message,
  onDismiss,
}: {
  phase: KaraokeUiPhase;
  title?: string;
  message?: string;
  onDismiss?: KaraokeUiAction;
}) {
  const copy = karaokePhaseCopy(phase);
  const isAlert = phase === 'rejected' || phase === 'failed' || phase === 'host-stopped';
  return (
    <div
      className={`zenix-karaoke-status zenix-karaoke-status--${phase}`}
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      data-karaoke-phase={phase}
    >
      <span className="zenix-karaoke-status-mark" aria-hidden="true">
        {phase === 'loading' || phase === 'reconnecting'
          ? <LoaderCircle className="zenix-karaoke-spin" />
          : isAlert ? <AlertCircle /> : <Check />}
      </span>
      <span className="zenix-karaoke-status-copy">
        <strong>{title || copy.title}</strong>
        <span>{message || copy.message}</span>
      </span>
      {onDismiss && (
        <button type="button" className="zenix-karaoke-icon-button" aria-label="关闭状态提示" onClick={() => void onDismiss()}>
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function KaraokeErrorNotice({
  error,
  onDismiss,
  onRetry,
}: {
  error: KaraokeUiError;
  onDismiss?: KaraokeUiAction;
  onRetry?: KaraokeUiAction;
}) {
  return (
    <div className="zenix-karaoke-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <span>
        <strong>{error.code ? `${error.code} · ` : ''}{error.message}</strong>
        {error.recoverable && <small>可以重试；已同步的房间资料不会被清除。</small>}
      </span>
      <span className="zenix-karaoke-error-actions">
        {onRetry && error.recoverable !== false && (
          <button type="button" onClick={() => void onRetry()}>
            <RotateCcw aria-hidden="true" />重试
          </button>
        )}
        {onDismiss && (
          <button type="button" className="zenix-karaoke-icon-button" aria-label="关闭错误提示" onClick={() => void onDismiss()}>
            <X aria-hidden="true" />
          </button>
        )}
      </span>
    </div>
  );
}

export function KaraokeLyricStack({
  lyrics,
  activeLineIndex,
  lineProgress,
  compact = false,
}: {
  lyrics: readonly KaraokeLyricLine[];
  activeLineIndex: number;
  lineProgress: number;
  compact?: boolean;
}) {
  const slots = getFiveLineLyricWindow(lyrics, activeLineIndex);
  const current = slots.find((slot) => slot.depth === 0)?.line;
  return (
    <div className={`zenix-karaoke-lyrics${compact ? ' is-compact' : ''}`}>
      {lyrics.length === 0 ? (
        <div className="zenix-karaoke-lyrics-empty">
          <Music2 aria-hidden="true" />
          <span>这首歌暂时没有可显示的逐句歌词</span>
        </div>
      ) : (
        <ol aria-label="五句歌词窗口">
          {slots.map((slot) => (
            <li
              key={slot.depth}
              className={slot.depth === 0 ? 'is-current' : undefined}
              data-karaoke-lyric-slot={slot.depth}
              data-depth={slot.depth}
              aria-current={slot.depth === 0 && slot.line ? 'true' : undefined}
              aria-hidden={slot.line ? undefined : 'true'}
            >
              <span>{slot.line?.text || '\u00a0'}</span>
              {slot.line?.translation && <small>{slot.line.translation}</small>}
            </li>
          ))}
        </ol>
      )}
      <div
        className="zenix-karaoke-line-progress"
        role="progressbar"
        aria-label={current ? `当前句进度：${current.text}` : '当前句进度'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clampUnit(lineProgress) * 100)}
      >
        <span style={{'--karaoke-progress': clampUnit(lineProgress)} as CSSProperties} />
      </div>
    </div>
  );
}

export function KaraokePitchMonitor({
  pitch,
  compact = false,
}: {
  pitch: KaraokePerformanceView['pitch'];
  compact?: boolean;
}) {
  const confidence = Math.round(clampUnit(pitch.confidence) * 100);
  return (
    <section className={`zenix-karaoke-pitch${compact ? ' is-compact' : ''}`} aria-labelledby="zenix-karaoke-pitch-title">
      <header>
        <span><Mic2 aria-hidden="true" /></span>
        <div>
          <strong id="zenix-karaoke-pitch-title">实时音高</strong>
          <small>{pitchOffsetLabel(pitch)}</small>
        </div>
        <output>{confidence}% 置信度</output>
      </header>
      <div className="zenix-karaoke-pitch-scale" aria-hidden="true">
        <span>目标 {noteName(pitch.targetMidi)}</span>
        <div>
          <i className="zenix-karaoke-pitch-target" style={{'--karaoke-midi': pitch.targetMidi === null ? 0.5 : clampUnit((pitch.targetMidi - 36) / 48)} as CSSProperties} />
          {pitch.detectedMidi !== null && (
            <i className="zenix-karaoke-pitch-detected" style={{'--karaoke-midi': clampUnit((pitch.detectedMidi - 36) / 48)} as CSSProperties} />
          )}
        </div>
        <span>检测 {noteName(pitch.detectedMidi)}</span>
      </div>
    </section>
  );
}

export function KaraokePerformanceStage({
  track,
  performance,
  lyrics,
  compact = false,
}: {
  track: KaraokeUiTrack | null;
  performance?: KaraokePerformanceView;
  lyrics: readonly KaraokeLyricLine[];
  compact?: boolean;
}) {
  const status = performance?.status ?? 'idle';
  return (
    <section className={`zenix-karaoke-stage${compact ? ' is-compact' : ''}`} aria-labelledby="zenix-karaoke-now-title">
      <header className="zenix-karaoke-now">
        <span className={`zenix-karaoke-live-dot${status === 'singing' ? ' is-live' : ''}`} aria-hidden="true" />
        <div>
          <small>当前演唱 · {performanceStatusLabel(status)}</small>
          <h3 id="zenix-karaoke-now-title">{track?.title || '等待下一首歌'}</h3>
          <p>{track?.artist || '主持人选择歌曲后会在这里显示演唱状态'}</p>
        </div>
        {performance?.countdownMs !== undefined && performance.status === 'countdown' && (
          <strong className="zenix-karaoke-countdown" aria-label={`倒计时 ${Math.max(0, Math.ceil(performance.countdownMs / 1000))} 秒`}>
            {Math.max(0, Math.ceil(performance.countdownMs / 1000))}
          </strong>
        )}
      </header>
      {performance?.singerNames?.length ? (
        <p className="zenix-karaoke-singers">
          <Users aria-hidden="true" />{performance.singerNames.join(' · ')}
        </p>
      ) : null}
      <KaraokeLyricStack
        lyrics={lyrics}
        activeLineIndex={performance?.activeLineIndex ?? 0}
        lineProgress={performance?.lineProgress ?? 0}
        compact={compact}
      />
      {performance && <KaraokePitchMonitor pitch={performance.pitch} compact={compact} />}
    </section>
  );
}

export function KaraokeMemberList({
  room,
  viewerMemberId,
  onSetReady,
}: {
  room: KaraokeRoomState;
  viewerMemberId: string;
  onSetReady?: KaraokeUiValueAction<boolean>;
}) {
  return (
    <section className="zenix-karaoke-panel" aria-labelledby="zenix-karaoke-members-title">
      <header>
        <span>成员</span>
        <small>{room.members.length}/{4} 人在房间</small>
      </header>
      <h3 id="zenix-karaoke-members-title" className="zenix-visually-hidden">房间成员</h3>
      <ul className="zenix-karaoke-member-list">
        {room.members.map((member) => (
          <li key={member.id} className={member.connected ? undefined : 'is-offline'}>
            <span className="zenix-karaoke-avatar" aria-hidden="true">{member.displayName.slice(0, 1)}</span>
            <span className="zenix-karaoke-member-copy">
              <strong>{member.displayName}{member.id === viewerMemberId ? '（你）' : ''}</strong>
              <small>{memberRoleLabel(member)} · {!member.connected ? '已断开' : member.role === 'listener' ? '仅听众' : member.ready ? '已准备' : '未准备'}</small>
            </span>
            {member.id === viewerMemberId && member.role !== 'listener' && (
              <button
                type="button"
                className="zenix-karaoke-pill"
                aria-pressed={member.ready}
                aria-label={member.ready ? '取消准备' : '准备演唱'}
                disabled={!onSetReady || !member.connected}
                onClick={() => void onSetReady?.(!member.ready)}
              >
                {member.ready ? '取消准备' : '准备'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function KaraokeJoinRequests({
  requests,
  onApprove,
  onReject,
}: {
  requests: readonly KaraokeJoinRequestView[];
  onApprove?: KaraokeUiValueAction<string>;
  onReject?: KaraokeUiValueAction<string>;
}) {
  if (requests.length === 0) return null;
  return (
    <section className="zenix-karaoke-panel" aria-labelledby="zenix-karaoke-requests-title">
      <header>
        <span>加入请求</span>
        <small>{requests.filter((request) => request.status === 'waiting').length} 个待处理</small>
      </header>
      <h3 id="zenix-karaoke-requests-title">等待批准的成员</h3>
      <ul className="zenix-karaoke-request-list">
        {requests.map((request) => (
          <li key={request.id}>
            <span>
              <strong>{request.displayName}</strong>
              <small>{joinStatusLabel(request.status)}{request.note ? ` · ${request.note}` : ''}</small>
            </span>
            {request.status === 'waiting' && (
              <span className="zenix-karaoke-request-actions">
                <button type="button" disabled={!onApprove} onClick={() => void onApprove?.(request.id)}>批准</button>
                <button type="button" disabled={!onReject} onClick={() => void onReject?.(request.id)}>拒绝</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function KaraokeQueue({
  room,
  tracks,
  onRemove,
  onStart,
  isHost,
  viewerMemberId,
}: {
  room: KaraokeRoomState;
  tracks: readonly KaraokeUiTrack[];
  onRemove?: KaraokeUiValueAction<string>;
  onStart?: KaraokeUiValueAction<string>;
  isHost: boolean;
  viewerMemberId?: string;
}) {
  return (
    <section className="zenix-karaoke-panel zenix-karaoke-queue" aria-labelledby="zenix-karaoke-queue-title">
      <header>
        <span>歌曲队列</span>
        <small>{room.queue.length} 首</small>
      </header>
      <h3 id="zenix-karaoke-queue-title">接下来演唱</h3>
      {room.queue.length === 0 ? (
        <div className="zenix-karaoke-empty">
          <Music2 aria-hidden="true" />
          <span>队列还是空的，从曲目列表添加一首歌。</span>
        </div>
      ) : (
        <ol>
          {room.queue.map((item, index) => {
            const track = findTrack(tracks, item.recordingId);
            const singers = memberNames(room, item.singerIds);
            const current = item.id === room.currentItemId || item.state === 'countdown' || item.state === 'singing';
            const canRemove = isHost || Boolean(viewerMemberId && item.singerIds.includes(viewerMemberId));
            return (
              <li key={item.id} className={current ? 'is-current' : undefined}>
                <span className="zenix-karaoke-queue-index">{String(index + 1).padStart(2, '0')}</span>
                {track?.artworkUrl ? <img src={track.artworkUrl} alt="" /> : <span className="zenix-karaoke-queue-art" aria-hidden="true"><Music2 /></span>}
                <span className="zenix-karaoke-queue-copy">
                  <strong>{track?.title || item.recordingId}</strong>
                  <small>{track?.artist || '曲目资料待同步'} · {singers.join('、')} · {queueModeLabel(item.mode)}</small>
                </span>
                <span className={`zenix-karaoke-queue-state is-${item.state}`}>{queueStateLabel(item.state)}</span>
                {isHost && item.state === 'queued' && (
                  <button
                    type="button"
                    className="zenix-karaoke-icon-button"
                    aria-label={`开始 ${track?.title || item.recordingId}`}
                    disabled={!onStart}
                    onClick={() => void onStart?.(item.id)}
                  >
                    <Mic2 aria-hidden="true" />
                  </button>
                )}
                {canRemove && (
                  <button
                    type="button"
                    className="zenix-karaoke-icon-button zenix-karaoke-remove"
                    aria-label={`从队列移除 ${track?.title || item.recordingId}`}
                    disabled={!onRemove || current}
                    onClick={() => void onRemove?.(item.id)}
                  >
                    <X aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function KaraokeSongPicker({
  tracks,
  queuedRecordingIds,
  onAdd,
}: {
  tracks: readonly KaraokeUiTrack[];
  queuedRecordingIds?: ReadonlySet<string>;
  onAdd?: KaraokeUiValueAction<{ recordingId: string; mode: KaraokeQueueMode }>;
}) {
  const [recordingId, setRecordingId] = useState(tracks[0]?.recordingId || '');
  const [mode, setMode] = useState<KaraokeQueueMode>('solo');
  const selectable = useMemo(
    () => tracks.filter((track) => !queuedRecordingIds?.has(track.recordingId)),
    [tracks, queuedRecordingIds],
  );
  const selectId = useId();
  useEffect(() => {
    if (!selectable.some((track) => track.recordingId === recordingId)) {
      setRecordingId(selectable[0]?.recordingId || '');
    }
  }, [recordingId, selectable]);
  return (
    <section className="zenix-karaoke-panel zenix-karaoke-song-picker" aria-labelledby="zenix-karaoke-picker-title">
      <header>
        <span>添加歌曲</span>
        <small>{tracks.length} 首可用</small>
      </header>
      <h3 id="zenix-karaoke-picker-title">从可演唱曲目选择</h3>
      {tracks.length === 0 ? (
        <p className="zenix-karaoke-muted">当前没有可演唱曲目。主 Agent 可通过 <code>tracks</code> 注入曲目资料。</p>
      ) : (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (recordingId && onAdd) void onAdd({recordingId, mode});
        }}>
          <label htmlFor={selectId}>歌曲</label>
          <select id={selectId} value={recordingId} onChange={(event) => setRecordingId(event.target.value)}>
            {selectable.map((track) => <option key={track.recordingId} value={track.recordingId}>{track.title} · {track.artist}</option>)}
          </select>
          <div className="zenix-karaoke-mode-switch" role="group" aria-label="演唱模式">
            {(['solo', 'relay', 'chorus'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>
                {queueModeLabel(value)}
              </button>
            ))}
          </div>
          <button type="submit" className="zenix-karaoke-primary" disabled={!onAdd || !recordingId || selectable.length === 0}>
            加入队列
          </button>
        </form>
      )}
    </section>
  );
}

export function KaraokeRoomCode({
  roomCode,
  onCopy,
  compact = false,
}: {
  roomCode: string;
  onCopy?: KaraokeUiValueAction<string>;
  compact?: boolean;
}) {
  return (
    <div className={`zenix-karaoke-room-code${compact ? ' is-compact' : ''}`}>
      <span>
        <small>房间码</small>
        <strong aria-label={`房间码 ${roomCode.split('').join(' ')}`}>{roomCode}</strong>
      </span>
      <button type="button" disabled={!onCopy} onClick={() => void onCopy?.(roomCode)}>
        <Check aria-hidden="true" />复制
      </button>
    </div>
  );
}

function useResultDialogFocus(open: boolean, onClose: KaraokeUiAction) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);
  return dialogRef;
}

export function KaraokeResultDialog({
  open,
  score,
  lyrics,
  onClose,
}: {
  open: boolean;
  score: KaraokeScore | null | undefined;
  lyrics: readonly KaraokeLyricLine[];
  onClose: KaraokeUiAction;
}) {
  const titleId = useId();
  const summaryId = useId();
  const dialogRef = useResultDialogFocus(open, onClose);
  if (!open || !score) return null;
  const rows = feedbackRows(score, lyrics);
  return (
    <div className="zenix-karaoke-dialog-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) void onClose();
    }}>
      <div
        ref={dialogRef}
        className="zenix-karaoke-result-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        tabIndex={-1}
      >
        <header>
          <span><Trophy aria-hidden="true" /></span>
          <div>
            <small>K 歌演唱结果</small>
            <h2 id={titleId}>本轮完成</h2>
          </div>
          <button type="button" className="zenix-karaoke-icon-button" aria-label="关闭演唱结果" onClick={() => void onClose()}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="zenix-karaoke-result-summary" id={summaryId}>
          <strong>{Math.round(score.total)}<small>总分</small></strong>
          <span>稳定性 <b>{Math.round(score.stability)}</b></span>
          <span>最长连击 <b>{score.longestCombo}</b></span>
          <span>音高评估 <b>{score.pitchEvaluated ? '已启用' : '无可信参考'}</b></span>
        </div>
        <section className="zenix-karaoke-feedback" aria-labelledby={`${titleId}-feedback`}>
          <h3 id={`${titleId}-feedback`}>逐句点评</h3>
          {rows.length === 0 ? <p className="zenix-karaoke-muted">评分没有提供逐句记录。</p> : (
            <ol>
              {rows.map((row) => (
                <li key={row.lineIndex}>
                  <span className="zenix-karaoke-feedback-score">{Math.round(row.total)}</span>
                  <span>
                    <strong>{row.text}</strong>
                    <small>音高 {row.pitch === null ? '未评估' : Math.round(row.pitch)} · 节奏 {row.rhythm === null ? '未评估' : Math.round(row.rhythm)} · 完整度 {Math.round(row.completeness)}</small>
                    {row.feedback.length > 0 && <p>{row.feedback.join('；')}</p>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <footer>
          <button type="button" className="zenix-karaoke-primary" onClick={() => void onClose()}>返回房间</button>
        </footer>
      </div>
    </div>
  );
}

export function KaraokeRoomActions({
  room,
  performance,
  isHost,
  onPause,
  onResume,
  onSkip,
  onFinishCurrent,
  onStopRoom,
}: {
  room: KaraokeRoomState;
  performance?: KaraokePerformanceView;
  isHost: boolean;
  onPause?: KaraokeUiAction;
  onResume?: KaraokeUiAction;
  onSkip?: KaraokeUiAction;
  onFinishCurrent?: KaraokeUiAction;
  onStopRoom?: KaraokeUiAction;
}) {
  if (!isHost) return null;
  const active = room.status === 'singing' || room.status === 'paused' || performance?.status === 'singing' || performance?.status === 'paused';
  return (
    <div className="zenix-karaoke-room-actions" role="group" aria-label="主持人控制">
      {room.status === 'paused' || performance?.status === 'paused' ? (
        <button type="button" disabled={!onResume} onClick={() => void onResume?.()}>继续演唱</button>
      ) : (
        <button type="button" disabled={!onPause || !active} onClick={() => void onPause?.()}>暂停</button>
      )}
      <button type="button" disabled={!onSkip || !active} onClick={() => void onSkip?.()}>跳过当前</button>
      <button type="button" disabled={!onFinishCurrent || !active} onClick={() => void onFinishCurrent?.()}>结束并评分</button>
      <button type="button" className="is-danger" disabled={!onStopRoom || room.status === 'closed'} onClick={() => void onStopRoom?.()}>结束房间</button>
    </div>
  );
}

export function KaraokeRoomSummary({
  room,
  tracks,
  performance,
}: {
  room: KaraokeRoomState;
  tracks: readonly KaraokeUiTrack[];
  performance?: KaraokePerformanceView;
}) {
  const current = room.queue.find((item) => item.id === room.currentItemId) ?? null;
  const currentTrack = findTrack(tracks, current?.recordingId);
  return (
    <div className="zenix-karaoke-room-summary">
      <span>
        <small>房间状态</small>
        <strong>{{lobby: '大厅', countdown: '倒计时', singing: '演唱中', paused: '已暂停', results: '本轮结束', closed: '已关闭'}[room.status]}</strong>
      </span>
      <span>
        <small>当前歌曲</small>
        <strong>{currentTrack?.title || '等待选歌'}</strong>
      </span>
      <span>
        <small>演唱者</small>
        <strong>{current ? memberNames(room, current.singerIds).join('、') : '—'}</strong>
      </span>
      <span>
        <small>时间</small>
        <strong>{performance ? `${Math.floor(performance.elapsedMs / 60000)}:${String(Math.floor(performance.elapsedMs / 1000) % 60).padStart(2, '0')}` : '—'}</strong>
      </span>
    </div>
  );
}

export function KaraokePageFrame({
  title,
  eyebrow,
  phase,
  onClose,
  onBack,
  children,
  mobile = false,
}: {
  title: string;
  eyebrow: string;
  phase: KaraokeUiPhase;
  onClose?: KaraokeUiAction;
  onBack?: KaraokeUiAction;
  children: ReactNode;
  mobile?: boolean;
}) {
  return (
    <main className={`karaoke-ui zenix-karaoke-page${mobile ? ' is-mobile' : ' is-desktop'}`} data-karaoke-phase={phase}>
      <header className="zenix-karaoke-page-header">
        <div>
          {(onBack || onClose) && (
            <button type="button" className="zenix-karaoke-back" aria-label="返回" onClick={() => void (onBack || onClose)?.()}>
              <ArrowLeft aria-hidden="true" />返回
            </button>
          )}
          <span>{eyebrow}</span>
          <h1>{title}</h1>
        </div>
        <span className="zenix-karaoke-brand" aria-hidden="true">ZENIX · KARAOKE</span>
      </header>
      {children}
    </main>
  );
}

export function KaraokeSetupForm({
  mode,
  onCreate,
  onJoin,
}: {
  mode: 'host' | 'guest';
  onCreate?: KaraokeUiValueAction<{ hostDisplayName: string }>;
  onJoin?: KaraokeUiValueAction<{ roomCode: string; displayName: string }>;
}) {
  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const nameId = useId();
  const codeId = useId();
  const host = mode === 'host';
  const submit = host ? onCreate : onJoin;
  return (
    <section className="zenix-karaoke-setup" aria-labelledby="zenix-karaoke-setup-title">
      <span className="zenix-karaoke-setup-mark" aria-hidden="true">{host ? <Music2 /> : <Users />}</span>
      <div>
        <small>{host ? 'HOST A CONCERT' : 'JOIN A ROOM'}</small>
        <h2 id="zenix-karaoke-setup-title">{host ? '创建你的 K 歌房间' : '加入朋友的 K 歌房间'}</h2>
        <p>{host ? '生成房间码，批准成员加入，再安排合唱或接唱顺序。' : '输入六位房间码和昵称，等待主持人批准后即可点歌。'}</p>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (host && displayName.trim() && onCreate) void onCreate({hostDisplayName: displayName.trim()});
        if (!host && displayName.trim() && /^\d{6}$/.test(roomCode) && onJoin) {
          void onJoin({displayName: displayName.trim(), roomCode});
        }
      }}>
        <label htmlFor={nameId}>显示名称</label>
        <input id={nameId} value={displayName} maxLength={32} autoComplete="nickname" placeholder="其他人会看到这个名字" onChange={(event) => setDisplayName(event.target.value)} />
        {!host && (
          <>
            <label htmlFor={codeId}>六位房间码</label>
            <input id={codeId} value={roomCode} maxLength={6} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
          </>
        )}
        <button type="submit" className="zenix-karaoke-primary" disabled={!submit || !displayName.trim() || (!host && !/^\d{6}$/.test(roomCode))}>
          {host ? '创建房间' : '申请加入'}
        </button>
      </form>
    </section>
  );
}

export function KaraokeWaitingPanel({ roomCode }: { roomCode?: string }) {
  return (
    <section className="zenix-karaoke-waiting" aria-live="polite">
      <LoaderCircle className="zenix-karaoke-spin" aria-hidden="true" />
      <h2>等待主持人批准</h2>
      <p>加入请求已经发送。批准后会在这里显示房间成员和歌曲队列。</p>
      {roomCode && <strong>{roomCode}</strong>}
    </section>
  );
}
