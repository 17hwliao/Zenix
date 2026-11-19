import {useId, useRef, useState, type FormEvent} from 'react';
import {parseKaraokeAddress} from '../lan/secure-channel';
import {KaraokeErrorNotice, KaraokePageFrame, KaraokeStatusNotice, KaraokeWaitingPanel} from './components';
import type {KaraokeUiAction, KaraokeUiStatusProps, KaraokeUiValueAction} from './types';
import './karaoke-ui.css';
import './karaoke-mobile.css';

export interface KaraokeJoinInput {
  address: string;
  roomCode: string;
  displayName: string;
  password?: string;
}

export interface MobileKaraokeJoinProps extends KaraokeUiStatusProps {
  onJoin: KaraokeUiValueAction<KaraokeJoinInput>;
  onBack?: KaraokeUiAction;
}

export function normalizeKaraokeGuestAddress(value: string): string | null {
  if (value.length > 128) return null;
  try {
    const {endpoint, publicKey} = parseKaraokeAddress(value.replace(/：/g, ':'));
    return `${endpoint}#${publicKey}`;
  } catch {
    return null;
  }
}

export function readKaraokeGuestInvite(value: string): {address: string; roomCode?: string} | null {
  if (value.length > 4096) return null;
  const lines = value.trim().split(/\r?\n/);
  const address = lines.map((line) => normalizeKaraokeGuestAddress(
    line.replace(/^\s*(?:房主地址|局域网(?:连接)?地址|连接地址|地址)\s*[：:]\s*/u, ''),
  )).find(Boolean);
  if (!address) return null;
  const roomCode = lines.map((line) => line.trim().match(/^(?:(?:房间码|房间号|房号)\s*[：:]\s*)?(\d{6})$/u)?.[1])
    .find(Boolean);
  return roomCode ? {address, roomCode} : {address};
}

export default function MobileKaraokeJoin({
  phase, statusTitle, statusMessage, error, onDismissError, onDismissStatus, onRetry, onJoin, onBack,
}: MobileKaraokeJoinProps) {
  const [address, setAddress] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitPending = useRef(false);
  const [validated, setValidated] = useState(false);
  const [localError, setLocalError] = useState('');
  const formId = useId();
  const normalizedAddress = normalizeKaraokeGuestAddress(address);
  const badAddress = validated && !normalizedAddress;
  const badCode = validated && !/^\d{6}$/.test(roomCode);
  const badName = validated && !displayName.trim();
  const waiting = phase === 'waiting';
  const busy = submitting || phase === 'loading' || phase === 'reconnecting';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitPending.current || busy) return;
    setValidated(true);
    const name = displayName.trim();
    if (!normalizedAddress || !/^\d{6}$/.test(roomCode) || !name) return;
    submitPending.current = true;
    setSubmitting(true);
    setLocalError('');
    try {
      await onJoin({address: normalizedAddress, roomCode, displayName: name, ...(password ? {password} : {})});
    } catch {
      setLocalError('未能提交加入请求，请核对房间信息后重试。');
    } finally {
      submitPending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <KaraokePageFrame title="加入 K 歌房间" eyebrow="局域网 K 歌" phase={phase} onBack={onBack} mobile>
      {waiting ? <KaraokeWaitingPanel roomCode={roomCode} /> : (
        phase === 'loading' || phase === 'reconnecting' || phase === 'rejected' || phase === 'host-stopped' ? (
          <KaraokeStatusNotice phase={phase} title={statusTitle} message={statusMessage} onDismiss={onDismissStatus} />
        ) : null
      )}
      {error && <KaraokeErrorNotice error={error} onDismiss={onDismissError} onRetry={onRetry} />}
      {!error && localError && (
        <KaraokeErrorNotice error={{message: localError}} onDismiss={() => setLocalError('')} />
      )}
      {!waiting && (
        <form className="zenix-karaoke-mobile-join" onSubmit={(event) => void submit(event)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
          }} noValidate>
          <p>与房主电脑连接同一个局域网，再输入房主分享的信息。</p>
          <label htmlFor={`${formId}-address`}>房主地址</label>
          <input id={`${formId}-address`} name="address" type="text" inputMode="url" autoComplete="off"
            autoCapitalize="none" spellCheck={false} value={address} maxLength={128} placeholder="粘贴房主的完整连接地址"
            aria-invalid={badAddress || undefined} aria-describedby={badAddress ? `${formId}-address-error` : undefined}
            onChange={(event) => setAddress(event.target.value)}
            onPaste={(event) => {
              const invitation = readKaraokeGuestInvite(event.clipboardData.getData('text'));
              if (!invitation) return;
              event.preventDefault();
              setAddress(invitation.address);
              if (invitation.roomCode) setRoomCode(invitation.roomCode);
            }}
            required />
          {badAddress && <small id={`${formId}-address-error`}>请粘贴房主分享的完整连接地址，保留 # 后的房间校验信息。</small>}
          <label htmlFor={`${formId}-code`}>六位房号</label>
          <input id={`${formId}-code`} name="roomCode" type="text" inputMode="numeric" autoComplete="off"
            value={roomCode} maxLength={6} placeholder="000000" aria-invalid={badCode || undefined}
            aria-describedby={badCode ? `${formId}-code-error` : undefined}
            onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
          {badCode && <small id={`${formId}-code-error`}>请输入六位数字房号。</small>}
          <label htmlFor={`${formId}-name`}>昵称</label>
          <input id={`${formId}-name`} name="displayName" type="text" autoComplete="nickname" value={displayName}
            maxLength={40} aria-invalid={badName || undefined} aria-describedby={badName ? `${formId}-name-error` : undefined}
            onChange={(event) => setDisplayName(event.target.value)} required />
          {badName && <small id={`${formId}-name-error`}>请输入房间里显示的昵称。</small>}
          <label htmlFor={`${formId}-password`}>房间口令 <span>选填</span></label>
          <input id={`${formId}-password`} name="password" type="password" autoComplete="off" value={password}
            maxLength={128} onChange={(event) => setPassword(event.target.value)} />
          <button type="submit" className="zenix-karaoke-primary" disabled={busy}>
            {busy ? '正在连接…' : '申请加入'}
          </button>
        </form>
      )}
    </KaraokePageFrame>
  );
}
