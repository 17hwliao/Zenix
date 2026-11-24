import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, Radio, Users } from 'lucide-react';
import { KaraokeBattle, KaraokeGradeNotice, type KaraokeGradeFeedback } from './KaraokeBattle';
import { formatKaraokeInviteText, KARAOKE_INVITE_ADDRESS_LIMIT, readKaraokeInviteText } from './karaoke-invitation';
import {
  activeKaraokeRecordingIds,
  currentQueueItem,
  findTrack,
  findViewerMember,
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
import type { DesktopKaraokePageProps, KaraokeJoinRequestView, KaraokeUiAction, KaraokeUiError, KaraokeUiValueAction } from './types';
import './karaoke-ui.css';
import './karaoke-desktop-lan.css';

export interface KaraokeLanCreateFields {
  hostDisplayName: string;
  password?: string;
}

export interface KaraokeLanJoinFields {
  address: string;
  displayName: string;
  roomCode: string;
  password?: string;
}

export type KaraokeLanApprovalSide = 'auto' | 'blue' | 'red' | 'none';

export interface DesktopKaraokeLanProps extends DesktopKaraokePageProps {
  invite?: {addresses: readonly string[]; passwordRequired?: boolean};
  grade?: KaraokeGradeFeedback | null;
  reducedMotion?: boolean;
  microphoneControl?: ReactNode;
  onChangeViewerMode?: KaraokeUiValueAction<'host' | 'guest'>;
  onCreateLanRoom?: KaraokeUiValueAction<KaraokeLanCreateFields>;
  onJoinLanRoom?: KaraokeUiValueAction<KaraokeLanJoinFields>;
  onCopyInvite?: KaraokeUiValueAction<string>;
  onApproveLanJoin?: KaraokeUiValueAction<{id: string; side: KaraokeLanApprovalSide}>;
  onAssignSide?: KaraokeUiValueAction<{memberId: string; side: 'blue' | 'red'}>;
  onRestart?: KaraokeUiAction;
}

function LanSetup({
  mode,
  waiting,
  onCreate,
  onJoin,
}: {
  mode: 'host' | 'guest';
  waiting: boolean;
  onCreate?: KaraokeUiValueAction<KaraokeLanCreateFields>;
  onJoin?: KaraokeUiValueAction<KaraokeLanJoinFields>;
}) {
  const id = useId();
  const host = mode === 'host';
  const [displayName, setDisplayName] = useState('');
  const [address, setAddress] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<KaraokeUiError | null>(null);
  const [invalidAddress, setInvalidAddress] = useState(false);
  const submitting = useRef(false);
  const fieldId = (field: string) => `${id}-${field}`;
  const canSubmit = Boolean(displayName.trim()) && (host
    ? Boolean(onCreate)
    : Boolean(onJoin && address.trim() && /^\d{6}$/.test(roomCode)));
  return (
    <section className="zenix-karaoke-setup zenix-karaoke-lan-setup" aria-labelledby={fieldId('heading')}>
      <div>
        <h2 id={fieldId('heading')}>{host ? '创建 K 歌房间' : '加入 K 歌房间'}</h2>
        <p>{host ? '把邀请发给同一局域网的朋友。' : '在地址栏粘贴主持人复制的完整邀请，地址和房号会自动填入。'}</p>
      </div>
      <form onKeyDown={(event) => {
        if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
      }} onSubmit={async (event) => {
        event.preventDefault();
        if (!canSubmit || waiting || submitting.current) return;
        const parsedAddress = host ? null : readKaraokeInviteText(address);
        if (!host && !parsedAddress) {
          setInvalidAddress(true);
          return;
        }
        submitting.current = true;
        setPending(true);
        setError(null);
        const name = displayName.trim();
        try {
          if (host) await onCreate?.({hostDisplayName: name, password: password || undefined});
          else if (parsedAddress) await onJoin?.({address: parsedAddress.address, roomCode, displayName: name, password: password || undefined});
        } catch (failure) {
          setError({message: failure instanceof Error ? failure.message : '房间连接失败，请重试'});
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}>
        <label htmlFor={fieldId('name')}>昵称</label>
        <input id={fieldId('name')} value={displayName} maxLength={40} autoComplete="nickname" required onChange={(event) => setDisplayName(event.target.value)} />
        {!host && (
          <>
            <label htmlFor={fieldId('address')}>房主地址</label>
            <input
              id={fieldId('address')}
              value={address}
              maxLength={KARAOKE_INVITE_ADDRESS_LIMIT}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="粘贴完整邀请或地址"
              aria-invalid={invalidAddress || undefined}
              aria-describedby={invalidAddress ? fieldId('address-error') : undefined}
              required
              onChange={(event) => {
                setAddress(event.target.value);
                setInvalidAddress(false);
              }}
              onPaste={(event) => {
                const invite = readKaraokeInviteText(event.clipboardData.getData('text'));
                if (!invite) return;
                event.preventDefault();
                setAddress(invite.address);
                if (invite.roomCode) setRoomCode(invite.roomCode);
                setInvalidAddress(false);
              }}
            />
            {invalidAddress && <small id={fieldId('address-error')} role="alert">请粘贴主持人复制的完整邀请或地址。</small>}
            <label htmlFor={fieldId('code')}>六位房间码</label>
            <input id={fieldId('code')} value={roomCode} maxLength={9} inputMode="numeric" autoComplete="off" required onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
          </>
        )}
        <label htmlFor={fieldId('password')}>房间口令（可选）</label>
        <input id={fieldId('password')} type="password" value={password} maxLength={128} autoComplete="off" onChange={(event) => setPassword(event.target.value)} />
        {error && <KaraokeErrorNotice error={error} onDismiss={() => setError(null)} />}
        <button className="zenix-karaoke-primary" type="submit" disabled={waiting || pending || !canSubmit}>
          {waiting ? '等待房主批准' : pending ? '正在连接…' : host ? '创建房间' : '申请加入'}
        </button>
      </form>
    </section>
  );
}

function InviteDetails({invite, roomCode, onCopy}: {
  invite: NonNullable<DesktopKaraokeLanProps['invite']>;
  roomCode: string;
  onCopy?: DesktopKaraokeLanProps['onCopyInvite'];
}) {
  return (
    <section className="zenix-karaoke-lan-invite" aria-label="房间连接地址">
      <strong>局域网连接地址</strong>
      {invite.addresses.length > 0 ? (
        <ul>
          {invite.addresses.map((address) => {
            const endpoint = address.split('#', 1)[0];
            return (
              <li key={address}>
                <code>{endpoint}</code>
                {onCopy && (
                  <button type="button" aria-label={`复制连接信息 ${endpoint}`} onClick={() => void onCopy(formatKaraokeInviteText(address, roomCode))}>
                    <Copy aria-hidden="true" />复制邀请
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p>没有找到可用的局域网地址。</p>}
      {invite.passwordRequired && <small>加入时需要房间口令。</small>}
    </section>
  );
}

function JoinApprovals({requests, onApprove, onReject}: {
  requests: readonly KaraokeJoinRequestView[];
  onApprove: NonNullable<DesktopKaraokeLanProps['onApproveLanJoin']>;
  onReject?: DesktopKaraokeLanProps['onRejectJoin'];
}) {
  const waiting = requests.filter((request) => request.status === 'waiting');
  return (
    <section className="zenix-karaoke-panel" aria-label="加入请求">
      <header><span>加入请求</span><small>{waiting.length} 个待处理</small></header>
      {waiting.length === 0 ? <p className="zenix-karaoke-muted">暂无待批准成员。</p> : (
        <ul className="zenix-karaoke-lan-approvals">
          {waiting.map((request) => <JoinApproval key={request.id} {...{request, onApprove, onReject}} />)}
        </ul>
      )}
    </section>
  );
}

function JoinApproval({request, onApprove, onReject}: {
  request: KaraokeJoinRequestView;
  onApprove: NonNullable<DesktopKaraokeLanProps['onApproveLanJoin']>;
  onReject?: DesktopKaraokeLanProps['onRejectJoin'];
}) {
  const [side, setSide] = useState<KaraokeLanApprovalSide>('auto');
  const [error, setError] = useState<KaraokeUiError | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const action = async (approve: boolean) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      if (approve) await onApprove({id: request.id, side});
      else await onReject?.(request.id);
    } catch (failure) {
      setError({message: failure instanceof Error ? failure.message : '处理加入请求失败'});
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <li>
      <strong>{request.displayName}</strong>
      {(request.note || request.requestedAtMs) && <small>{[
        request.note,
        request.requestedAtMs && new Date(request.requestedAtMs).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
      ].filter(Boolean).join(' · ')}</small>}
      <select aria-label={`${request.displayName} 的房间角色`} value={side} disabled={pending} onChange={(event) => setSide(event.target.value as KaraokeLanApprovalSide)}>
        <option value="auto">自动分队</option>
        <option value="blue">蓝方</option>
        <option value="red">红方</option>
        <option value="none">听众</option>
      </select>
      <div className="zenix-karaoke-lan-approve-actions">
        <button type="button" disabled={pending} onClick={() => void action(true)}>批准</button>
        <button type="button" disabled={pending || !onReject} onClick={() => void action(false)}>拒绝</button>
      </div>
      {error && <KaraokeErrorNotice error={error} onDismiss={() => setError(null)} />}
    </li>
  );
}

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
  invite,
  grade,
  reducedMotion,
  microphoneControl,
  onChangeViewerMode,
  onCreateLanRoom,
  onJoinLanRoom,
  onCopyInvite,
  onApproveLanJoin,
  onAssignSide,
  onRestart,
  onClose,
}: DesktopKaraokeLanProps) {
  const [resultOpen, setResultOpen] = useState(Boolean(result));
  useEffect(() => {
    if (result) setResultOpen(true);
  }, [result]);

  const viewer = room ? findViewerMember(room, viewerMemberId) : null;
  const isHost = room ? viewer?.role === 'host' : viewerMode === 'host';
  const currentItem = room ? currentQueueItem(room) : null;
  const currentTrack = room ? findTrack(tracks, currentItem?.recordingId) : null;
  const queuedRecordingIds = useMemo(
    () => activeKaraokeRecordingIds(room),
    [room],
  );
  const connectionInterrupted = phase === 'disconnected' || phase === 'reconnecting';
  const blocked = phase === 'loading' || phase === 'failed' || connectionInterrupted
    || phase === 'host-stopped' || phase === 'waiting' || phase === 'rejected';
  const lan = Boolean(onCreateLanRoom || onJoinLanRoom || invite);
  const canSetUp = !room && (lan || phase !== 'waiting') && !['reconnecting', 'host-stopped', 'empty', 'complete'].includes(phase)
    && (phase !== 'loading' || lan);
  const canSetSide = room?.status === 'lobby' || room?.status === 'results';
  const activeRound = room?.status === 'countdown' || room?.status === 'singing' || room?.status === 'paused';
  const inviteDetails = isHost && invite && room && <InviteDetails invite={invite} roomCode={room.roomCode} onCopy={onCopyInvite} />;

  return (
    <KaraokePageFrame
      eyebrow={isHost ? '局域网 K 歌 · 主持人' : '局域网 K 歌'}
      title={room ? `K 歌房间 ${room.roomCode}` : 'K 歌房间'}
      phase={phase}
      onClose={onClose}
    >
      {(!lan || phase !== 'ready' || statusTitle || statusMessage) && (
        <KaraokeStatusNotice
          phase={phase}
          title={statusTitle}
          message={statusMessage}
          onDismiss={onDismissStatus}
        />
      )}
      {error && (
        <KaraokeErrorNotice
          error={error}
          onDismiss={onDismissError}
          onRetry={onRetry}
        />
      )}
      {connectionInterrupted && onRetry && (
        <div className="zenix-karaoke-connection-action">
          <span>已保留最近一次同步的比分。</span>
          <button type="button" disabled={phase === 'reconnecting'} onClick={() => void onRetry()}>
            {phase === 'reconnecting' ? '正在重新连接…' : '重新连接'}
          </button>
        </div>
      )}

      {phase === 'loading' && !canSetUp && (
        <section className="zenix-karaoke-loading-page" aria-label="正在载入 K 歌房间">
          <span className="zenix-karaoke-skeleton is-wide" />
          <span className="zenix-karaoke-skeleton" />
          <span className="zenix-karaoke-skeleton" />
        </section>
      )}

      {canSetUp && (
        <div className="zenix-karaoke-lan-launch">
          {onChangeViewerMode && (
            <div className="zenix-karaoke-lan-mode" role="group" aria-label="房间操作">
              <button type="button" aria-pressed={viewerMode === 'host'} disabled={phase === 'loading'} onClick={() => void onChangeViewerMode('host')}>创建房间</button>
              <button type="button" aria-pressed={viewerMode === 'guest'} disabled={phase === 'loading'} onClick={() => void onChangeViewerMode('guest')}>加入房间</button>
            </div>
          )}
          {lan ? (
            <LanSetup key={viewerMode} mode={viewerMode} waiting={phase === 'waiting'} onCreate={onCreateLanRoom} onJoin={onJoinLanRoom} />
          ) : <KaraokeSetupForm mode={viewerMode} onCreate={onCreateRoom} onJoin={onJoinRoom} />}
        </div>
      )}

      {phase === 'waiting' && !lan && <KaraokeWaitingPanel roomCode={room?.roomCode} />}

      {room && (connectionInterrupted || phase === 'host-stopped') && (
        <KaraokeBattle room={room} reducedMotion={true} />
      )}

      {phase === 'host-stopped' && (
        <section className="zenix-karaoke-terminal-state" aria-labelledby="zenix-karaoke-stopped-title">
          <span aria-hidden="true"><Radio /></span>
          <h2 id="zenix-karaoke-stopped-title">{statusTitle || '主持人已结束房间'}</h2>
          {statusMessage && <p>{statusMessage}</p>}
          {onClose && <button type="button" className="zenix-karaoke-primary" onClick={() => void onClose()}>返回音乐空间</button>}
        </section>
      )}

      {room && !blocked && (
        <div className="zenix-karaoke-room-layout" data-karaoke-room-status={room.status} data-lan-room={lan || undefined}>
          <section className="zenix-karaoke-room-main">
            <div className="zenix-karaoke-room-head">
              <div>
                <h2>红蓝对战</h2>
              </div>
              <KaraokeRoomCode roomCode={room.roomCode} onCopy={onCopyRoomCode} />
            </div>

            {!activeRound && inviteDetails}
            {isHost && (
              <div className="zenix-karaoke-lan-controls">
                <KaraokeRoomActions
                  room={room}
                  performance={performance}
                  isHost
                  onPause={onPause}
                  onResume={onResume}
                  onSkip={onSkip}
                  onFinishCurrent={onFinishCurrent}
                  onStopRoom={onStopRoom}
                />
                {onRestart && room.status === 'results' && (
                  <button type="button" disabled={room.battle?.settlingUntilMs !== undefined} onClick={() => void onRestart()}>重新比赛</button>
                )}
              </div>
            )}
            <KaraokeBattle room={room} reducedMotion={reducedMotion} />
            {(!lan || !activeRound) && <KaraokeRoomSummary room={room} tracks={tracks} performance={performance} />}
            <div className="zenix-karaoke-lan-performance">
              <KaraokeGradeNotice grade={grade} reducedMotion={reducedMotion} />
              <KaraokePerformanceStage track={currentTrack} performance={performance} lyrics={lyrics} />
              {microphoneControl}
            </div>
          </section>

          <aside className="zenix-karaoke-room-side" aria-label="房间成员和歌曲队列">
            {activeRound && inviteDetails}
            <KaraokeMemberList room={room} viewerMemberId={viewerMemberId} onSetReady={onSetReady} />
            {isHost && onAssignSide && canSetSide && (
              <section className="zenix-karaoke-panel" aria-label="调整阵营">
                <header><span>调整阵营</span></header>
                <div className="zenix-karaoke-lan-assignments">
                  {room.members.filter((member) => member.role !== 'listener').map((member) => (
                    <label key={member.id}>
                      {member.displayName}
                      <select
                        aria-label={`${member.displayName} 的阵营`}
                        value={member.side}
                        onChange={(event) => {
                          const side = event.target.value;
                          if (side === 'red' || side === 'blue') void onAssignSide({memberId: member.id, side});
                        }}
                      >
                        {member.side === 'none' && <option value="none" disabled>未分队</option>}
                        <option value="blue">蓝方</option>
                        <option value="red">红方</option>
                      </select>
                    </label>
                  ))}
                </div>
              </section>
            )}
            {isHost && (
              onApproveLanJoin
                ? <JoinApprovals requests={joinRequests} onApprove={onApproveLanJoin} onReject={onRejectJoin} />
                : <KaraokeJoinRequests requests={joinRequests} onApprove={onApproveJoin} onReject={onRejectJoin} />
            )}
            {viewer && viewer.role !== 'listener' && (
              <div className={lan ? 'zenix-karaoke-lan-pick' : undefined}>
                <KaraokeSongPicker
                  tracks={tracks}
                  queuedRecordingIds={queuedRecordingIds}
                  onAdd={onAddToQueue}
                  chorusOnly={lan}
                />
              </div>
            )}
            <KaraokeQueue
              room={room}
              tracks={tracks}
              onRemove={onRemoveQueueItem}
              onStart={room.battle?.settlingUntilMs === undefined ? onStartQueueItem : undefined}
              isHost={isHost}
              viewerMemberId={viewerMemberId}
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
