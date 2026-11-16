import { useEffect, useMemo, useState } from 'react';
import { Mic2, Radio, Sparkles, Users } from 'lucide-react';
import {
  currentQueueItem,
  findTrack,
  findViewerMember,
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
  KaraokeSetupForm,
  KaraokeSongPicker,
  KaraokeStatusNotice,
  KaraokeWaitingPanel,
} from './components';
import type { DesktopKaraokePageProps } from './types';
import './karaoke-ui.css';

export default function DesktopKaraokePage({
  viewerMode,
  room,
  tracks = [],
  viewerMemberId = '',
  lyrics = [],
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
  onCreateRoom,
  onJoinRoom,
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
  onClose,
}: DesktopKaraokePageProps) {
  const [resultOpen, setResultOpen] = useState(Boolean(result));
  useEffect(() => {
    if (result) setResultOpen(true);
  }, [result]);

  const viewer = room ? findViewerMember(room, viewerMemberId) : null;
  const isHost = viewer?.role === 'host' || viewerMode === 'host';
  const currentItem = room ? currentQueueItem(room) : null;
  const currentTrack = room ? findTrack(tracks, currentItem?.recordingId) : null;
  const queuedRecordingIds = useMemo(
    () => new Set(room?.queue.map((item) => item.recordingId) || []),
    [room?.queue],
  );
  const blocked = phase === 'loading' || phase === 'failed' || phase === 'host-stopped';
  const showWaiting = phase === 'waiting';

  return (
    <KaraokePageFrame
      eyebrow={isHost ? '桌面演唱会 · 主持人' : '桌面演唱会 · 房间成员'}
      title={room ? `K 歌房间 ${room.roomCode}` : viewerMode === 'host' ? 'K 歌演唱会' : '加入 K 歌演唱会'}
      phase={phase}
      onClose={onClose}
    >
      <KaraokeStatusNotice
        phase={phase}
        title={statusTitle}
        message={statusMessage}
        onDismiss={onDismissStatus}
      />
      {error && (
        <KaraokeErrorNotice
          error={error}
          onDismiss={onDismissError}
          onRetry={onRetry}
        />
      )}
      {phase === 'disconnected' && onRetry && (
        <div className="zenix-karaoke-connection-action">
          <span>房间资料仍在屏幕上；恢复连接后继续同步。</span>
          <button type="button" onClick={() => void onRetry()}>重新连接</button>
        </div>
      )}

      {phase === 'loading' && (
        <section className="zenix-karaoke-loading-page" aria-label="正在载入 K 歌房间">
          <span className="zenix-karaoke-skeleton is-wide" />
          <span className="zenix-karaoke-skeleton" />
          <span className="zenix-karaoke-skeleton" />
        </section>
      )}

      {!room && !blocked && !showWaiting && phase !== 'empty' && phase !== 'complete' && (
        <KaraokeSetupForm
          mode={viewerMode}
          onCreate={onCreateRoom}
          onJoin={onJoinRoom}
        />
      )}

      {showWaiting && <KaraokeWaitingPanel roomCode={room?.roomCode} />}

      {phase === 'host-stopped' && (
        <section className="zenix-karaoke-terminal-state" aria-labelledby="zenix-karaoke-stopped-title">
          <span aria-hidden="true"><Radio /></span>
          <small>ROOM CLOSED</small>
          <h2 id="zenix-karaoke-stopped-title">{statusTitle || '主持人已结束房间'}</h2>
          <p>{statusMessage || '本轮演唱已经停止。你仍可以关闭页面并返回音乐空间。'}</p>
          {onClose && <button type="button" className="zenix-karaoke-primary" onClick={() => void onClose()}>返回音乐空间</button>}
        </section>
      )}

      {room && !blocked && phase !== 'waiting' && (
        <div className="zenix-karaoke-room-layout" data-karaoke-room-status={room.status}>
          <section className="zenix-karaoke-room-main">
            <div className="zenix-karaoke-room-head">
              <div>
                <span className="zenix-karaoke-overline"><Sparkles aria-hidden="true" />LIVE ROOM</span>
                <h2>{isHost ? '主持这场演唱会' : '准备轮到你'}</h2>
                <p>{isHost ? '批准成员、整理队列，并控制当前演唱。' : '查看当前演唱、准备状态和接下来的歌曲。'}</p>
              </div>
              <KaraokeRoomCode roomCode={room.roomCode} onCopy={onCopyRoomCode} />
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

            <KaraokePerformanceStage
              track={currentTrack}
              performance={performance}
              lyrics={lyrics}
            />

            {currentItem && (
              <div className="zenix-karaoke-current-caption">
                <Mic2 aria-hidden="true" />
                <span>
                  <strong>{currentTrack?.title || currentItem.recordingId}</strong>
                  <small>{queueModeLabel(currentItem.mode)} · {currentItem.state === 'queued' ? '等待开始' : currentItem.state === 'singing' ? '正在演唱' : currentItem.state}</small>
                </span>
              </div>
            )}
          </section>

          <aside className="zenix-karaoke-room-side" aria-label="房间成员和歌曲队列">
            <KaraokeMemberList room={room} viewerMemberId={viewerMemberId} onSetReady={onSetReady} />
            {isHost && (
              <KaraokeJoinRequests
                requests={joinRequests}
                onApprove={onApproveJoin}
                onReject={onRejectJoin}
              />
            )}
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
              isHost={isHost}
            />
          </aside>
        </div>
      )}

      {phase === 'empty' && !room && (
        <section className="zenix-karaoke-terminal-state">
          <span aria-hidden="true"><Users /></span>
          <h2>还没有可加入的房间</h2>
          <p>房间快照为空。主持人创建房间后，成员可以通过六位房间码加入。</p>
        </section>
      )}

      {phase === 'complete' && result && (
        <section className="zenix-karaoke-complete-card" aria-label="演唱完成">
          <div>
            <small>ROUND COMPLETE</small>
            <h2>本轮总分 {Math.round(result.total)}</h2>
            <p>逐句点评和稳定性详情已经生成。</p>
          </div>
          <button type="button" className="zenix-karaoke-primary" onClick={() => setResultOpen(true)}>查看详细评分</button>
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
