import { Mic2, Radio, Users } from 'lucide-react';
import {
  activeKaraokeRecordingIds,
  currentQueueItem,
  findTrack,
  findViewerMember,
  memberNames,
  queueModeLabel,
} from './model';
import {
  KaraokeErrorNotice,
  KaraokeJoinRequests,
  KaraokeMemberList,
  KaraokePageFrame,
  KaraokePerformanceStage,
  KaraokeQueue,
  KaraokeResultDialog,
  KaraokeRoomActions,
  KaraokeRoomCode,
  KaraokeRoomSummary,
  KaraokeSongPicker,
  KaraokeStatusNotice,
  KaraokeWaitingPanel,
} from './components';
import { useEffect, useState } from 'react';
import type { MobileKaraokeRoomProps } from './types';
import './karaoke-ui.css';

export default function MobileKaraokeRoom({
  room,
  tracks,
  viewerMemberId,
  lyrics,
  performance,
  result,
  joinRequests = [],
  phase,
  statusTitle,
  statusMessage,
  error,
  onDismissStatus,
  onDismissError,
  onRetry,
  onCopyRoomCode,
  onSetReady,
  onAddToQueue,
  onRemoveQueueItem,
  onStartQueueItem,
  onPause,
  onResume,
  onSkip,
  onFinishCurrent,
  onStopRoom,
  onApproveJoin,
  onRejectJoin,
  onBack,
  onRetryConnection,
}: MobileKaraokeRoomProps) {
  const [resultOpen, setResultOpen] = useState(Boolean(result));
  useEffect(() => {
    if (result) setResultOpen(true);
  }, [result]);

  const viewer = findViewerMember(room, viewerMemberId);
  const isHost = viewer?.role === 'host';
  const current = currentQueueItem(room);
  const currentTrack = findTrack(tracks, current?.recordingId);
  const approvalBlocked = phase === 'waiting' || phase === 'rejected';
  const blocked = phase === 'loading' || phase === 'host-stopped' || phase === 'failed' || phase === 'disconnected' || approvalBlocked;
  const queuedRecordingIds = activeKaraokeRecordingIds(room);
  const canSetReady = viewer?.role !== 'listener';

  return (
    <KaraokePageFrame
      eyebrow="移动合唱房间"
      title={room.roomCode ? `房间 ${room.roomCode}` : 'K 歌房间'}
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
      {phase === 'disconnected' && onRetryConnection && (
        <div className="zenix-karaoke-connection-action">
          <span>房间资料仍保留，恢复连接后可继续。</span>
          <button type="button" onClick={() => void onRetryConnection()}>重新连接</button>
        </div>
      )}

      {!blocked && (
        <>
          <div className="zenix-karaoke-mobile-room-top">
            <KaraokeRoomCode roomCode={room.roomCode} onCopy={onCopyRoomCode} compact />
            {canSetReady ? (
              <button
                type="button"
                className="zenix-karaoke-ready-button"
                aria-pressed={viewer?.ready || false}
                disabled={!onSetReady || !viewer?.connected}
                onClick={() => void onSetReady?.(!viewer?.ready)}
              >
                <Users aria-hidden="true" />
                {viewer?.ready ? '取消准备' : '准备演唱'}
              </button>
            ) : (
              <span className="zenix-karaoke-listener-badge"><Users aria-hidden="true" />仅听众</span>
            )}
          </div>

          <KaraokePerformanceStage
            track={currentTrack}
            performance={performance}
            lyrics={lyrics}
            compact
          />

          <div className="zenix-karaoke-mobile-current">
            <Radio aria-hidden="true" />
            <span>
              <small>{performance ? '当前演唱' : '房间状态'}</small>
              <strong>{currentTrack?.title || '还没有开始演唱'}</strong>
              <b>{current ? `${memberNames(room, current.singerIds).join('、')} · ${queueModeLabel(current.mode)}` : '等待主持人选择歌曲'}</b>
            </span>
          </div>

          <KaraokeRoomSummary room={room} tracks={tracks} performance={performance} />
          <KaraokeRoomActions
            room={room}
            performance={performance}
            isHost={isHost}
            onPause={onPause}
            onResume={onResume}
            onSkip={onSkip}
            onFinishCurrent={onFinishCurrent}
            onStopRoom={onStopRoom}
          />

          <details className="zenix-karaoke-mobile-details">
            <summary><Users aria-hidden="true" />成员与待批准请求 <span>{joinRequests.filter((request) => request.status === 'waiting').length}</span></summary>
            <KaraokeMemberList room={room} viewerMemberId={viewerMemberId} onSetReady={onSetReady} />
            {isHost && <KaraokeJoinRequests requests={joinRequests} onApprove={onApproveJoin} onReject={onRejectJoin} />}
          </details>

          {isHost && (
            <KaraokeSongPicker
              tracks={tracks}
              queuedRecordingIds={queuedRecordingIds}
              onAdd={onAddToQueue}
            />
          )}

          <KaraokeQueue
            room={room}
            tracks={tracks}
            onRemove={onRemoveQueueItem}
            onStart={onStartQueueItem}
            isHost={Boolean(isHost)}
            viewerMemberId={viewerMemberId}
          />

          {result && phase === 'complete' && (
            <button type="button" className="zenix-karaoke-complete-inline" onClick={() => setResultOpen(true)}>
              <Mic2 aria-hidden="true" />
              <span><strong>本轮总分 {Math.round(result.total)}</strong><small>查看逐句点评</small></span>
            </button>
          )}
        </>
      )}

      {phase === 'waiting' && <KaraokeWaitingPanel roomCode={room.roomCode} />}

      {blocked && phase !== 'loading' && phase !== 'waiting' && (
        <section className="zenix-karaoke-terminal-state">
          <span aria-hidden="true">{phase === 'host-stopped' ? <Radio /> : phase === 'rejected' ? <Users /> : <Mic2 />}</span>
          <h2>{phase === 'host-stopped' ? '房间已停止' : phase === 'rejected' ? '加入请求未通过' : '当前无法操作'}</h2>
          <p>{phase === 'host-stopped' ? '主持人结束了本轮房间，已有资料仍保留在屏幕中。' : phase === 'rejected' ? '可以返回并核对房间码后重新申请。' : '恢复网络后可以继续。'}</p>
        </section>
      )}

      <KaraokeResultDialog
        open={resultOpen && Boolean(result)}
        score={result}
        lyrics={lyrics}
        onClose={() => setResultOpen(false)}
      />
    </KaraokePageFrame>
  );
}
