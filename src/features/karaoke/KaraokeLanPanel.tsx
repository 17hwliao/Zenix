import {useEffect, useMemo, useState} from 'react';
import type {InstalledSource, RawLyrics, Track} from '../../core/types';
import {KaraokeRoomTransport, type KaraokeTransportState} from './lan/transport';
import {publicKaraokeTrack} from './round-track';
import {useKaraokeRound} from './useKaraokeRound';
import DesktopKaraokePage from './ui/DesktopKaraokePage';
import MobileKaraokeRoom from './ui/MobileKaraokeRoom';
import MobileKaraokeJoin from './ui/MobileKaraokeJoin';
import type {KaraokeUiPhase, KaraokeUiError, KaraokeUiTrack} from './ui/types';
import {setKaraokeVoiceLock} from './voice-lock';

const uiPhase: Record<KaraokeTransportState['phase'], KaraokeUiPhase> = {
  idle: 'ready', opening: 'loading', waiting: 'waiting', connected: 'approved',
  reconnecting: 'reconnecting', rejected: 'rejected', closed: 'host-stopped', failed: 'failed',
};

export default function KaraokeLanPanel({mobile, tracks, sources, readLyrics, reducedMotion, onBack}: {
  mobile: boolean;
  tracks: readonly Track[];
  sources: readonly InstalledSource[];
  readLyrics(track: Track): Promise<RawLyrics | null>;
  reducedMotion: boolean;
  onBack(): void;
}) {
  const transport = useMemo(() => new KaraokeRoomTransport(mobile), [mobile]);
  const [state, setState] = useState(transport.state);
  const [mode, setMode] = useState<'host' | 'guest'>(mobile ? 'guest' : 'host');
  const [copyError, setCopyError] = useState<KaraokeUiError | null>(null);

  useEffect(() => {
    const stop = transport.subscribe(setState);
    return () => {stop(); void transport.close();};
  }, [transport]);
  const ownsVoice = Boolean(state.room && (state.phase === 'connected' || state.phase === 'reconnecting'));
  useEffect(() => {
    if (!ownsVoice) return;
    setKaraokeVoiceLock(true, mobile);
    return () => setKaraokeVoiceLock(false, mobile);
  }, [ownsVoice, mobile]);
  const round = useKaraokeRound({room: state.room, viewerMemberId: state.memberId, tracks, sources, readLyrics, mobile,
    clockOffsetMs: state.clockOffsetMs, submit: event => transport.send(event), closed: !ownsVoice});

  const catalog = useMemo(() => {
    const map = new Map<string, {entry: NonNullable<ReturnType<typeof publicKaraokeTrack>>; display: KaraokeUiTrack}>();
    for (const track of tracks) {
      const entry = publicKaraokeTrack(track);
      if (!entry || map.has(entry.recordingId)) continue;
      map.set(entry.recordingId, {entry, display: {...entry.song, recordingId: entry.recordingId, artworkUrl: track.coverUrl}});
    }
    return map;
  }, [tracks]);
  const choices = useMemo(() => {
    const merged = new Map([...catalog].map(([key, entry]) => [key, entry.display]));
    for (const item of state.room?.queue ?? []) {
      if (item.song && !merged.has(item.recordingId)) merged.set(item.recordingId, {...item.song, recordingId: item.recordingId});
    }
    return [...merged.values()];
  }, [catalog, state.room?.queue]);

  async function copyInvite(value: string) {
    const content = state.invitation && !value.includes('\n')
      ? `Zenix 局域网 K 歌\n地址：${value.includes('#') ? value : state.invitation.addresses[0]}\n房号：${state.invitation.roomCode}`
      : value;
    try {
      await navigator.clipboard.writeText(content);
      setCopyError(null);
    } catch {
      setCopyError({message: '无法写入剪贴板，请从房间连接信息手动复制。', recoverable: true});
    }
  }

  const notice = {
    phase: uiPhase[state.phase],
    error: copyError || state.error || round.roundError,
    onDismissError: () => {setCopyError(null); transport.dismissError(); round.dismissError();},
    onRetry: mode === 'guest' && state.phase === 'failed' ? () => transport.retry() : undefined,
  };
  const buttons = {
    onSetReady: (ready: boolean) => {
      transport.send({type: 'member.ready', ready});
      if (ready) void round.enableMicrophone();
    },
    onAddToQueue: ({recordingId}: {recordingId: string}) => {
      const song = catalog.get(recordingId)?.entry.song ?? state.room?.queue.find(item => item.recordingId === recordingId && item.song)?.song;
      if (song) transport.send({type: 'queue.add', recordingId, song, mode: 'chorus'});
    },
    onRemoveQueueItem: (itemId: string) => transport.send({type: 'queue.remove', itemId}),
  };
  const microphone = round.allowsMicrophone && (
    <div className="zenix-karaoke-connection-action">
      <span>{round.microphoneStatus === 'active' ? '麦克风已开启 · 本机逐句评分'
        : round.microphoneStatus === 'requesting' ? '正在等待麦克风授权'
          : '麦克风未开启 · 本机分数暂不评估'}</span>
      {round.microphoneStatus !== 'active' && <button type="button"
        disabled={round.microphoneStatus === 'requesting' || state.phase !== 'connected'}
        onClick={() => void round.enableMicrophone()}>开启麦克风</button>}
    </div>
  );
  const roomView = {
    tracks: choices, viewerMemberId: state.memberId ?? '', lyrics: round.lyrics,
    performance: round.performance, grade: round.grade, reducedMotion, ...notice, ...buttons,
  };

  if (mobile) {
    return state.room && state.phase !== 'closed'
      ? <>{microphone}<MobileKaraokeRoom {...roomView} room={state.room}
        microphoneStatus={round.microphoneStatus}
        onRetryConnection={notice.onRetry}
        pendingScoreCount={state.pendingScoreCount} unsubmittedScoreCount={state.unsubmittedScoreCount}
        onBack={onBack} /></>
      : <MobileKaraokeJoin {...notice} onJoin={value => transport.join(value)} onBack={onBack} />;
  }
  return <DesktopKaraokePage {...roomView} microphoneControl={microphone}
    viewerMode={mode} room={state.room} invite={state.invitation} joinRequests={state.requests.map(request => ({...request, status: 'waiting'}))}
    onChangeViewerMode={value => {setMode(value); void transport.close();}}
    onCreateLanRoom={value => transport.create({displayName: value.hostDisplayName, password: value.password})}
    onJoinLanRoom={value => transport.join(value)}
    onCopyInvite={copyInvite} onCopyRoomCode={copyInvite}
    onApproveLanJoin={({id, side}) => transport.approve(id, side === 'none' ? 'listener' : 'singer', side === 'blue' || side === 'red' ? side : undefined)}
    onRejectJoin={id => transport.reject(id)}
    onAssignSide={({memberId, side}) => transport.assignSide(memberId, side)}
    onStartQueueItem={id => transport.start(id)}
    onPause={() => transport.pause()} onResume={() => transport.resume()} onSkip={() => transport.skip()}
    onFinishCurrent={() => transport.finish()} onRestart={() => transport.restart()}
    onStopRoom={() => transport.closeRoom()} onClose={onBack}
  />;
}
