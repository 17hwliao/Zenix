import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, X } from 'lucide-react';
import { invokeUpdate, updateIsIOS, updatePreferences, updateSupported, updatesBusy, type UpdateState } from '../core/updates';
import { UpdateReminders, updateReminderKey } from '../core/updateReminders';
import './UpdateSettings.css';
export default function UpdateNotice() {
  const [state, setState] = useState<UpdateState>(), [openKey, setOpenKey] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reminders] = useState(() => new UpdateReminders(window.localStorage));
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const channel = updatePreferences().channel;
  const key = state ? updateReminderKey(state, channel) : '';
  const visible = Boolean(state && key && openKey === key);
  useEffect(() => {
    if (!updateSupported()) return;
    let stopped = false, timer: number | undefined, serial = 0;
    async function refresh() {
      const token = ++serial;
      try {
        const next = await invokeUpdate({ operation: 'state' }); if (stopped || token !== serial) return;
        setState(next); clearTimeout(timer);
        if (reminders.shouldShow(next, updatePreferences().channel)) setOpenKey(updateReminderKey(next, updatePreferences().channel));
        if (updatesBusy() || ['downloading', 'checking'].includes(next.status)) timer = window.setTimeout(() => void refresh(), 1000);
      } catch { /* No notification for unavailable native preview. */ }
    }
    window.addEventListener('zenix-update-state', refresh); void refresh();
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('zenix-update-state', refresh); };
  }, [reminders]);
  const close = () => { if (state) reminders.dismiss(state, channel); setOpenKey(''); setError(''); };
  useEffect(() => {
    const element = dialog.current; if (!visible || !element) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    element.showModal(); closeButton.current?.focus();
    return () => { element.close(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, [visible]);
  async function action(operation: 'download' | 'install' | 'cancel') {
    if (operation === 'install' && !updateIsIOS() && !window.confirm('安装更新会重启应用，正在播放的音乐将暂停。现在安装？')) return;
    setBusy(true); setError('');
    try { setState(await invokeUpdate({ operation })); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  if (!visible || !state) return null;
  return <dialog ref={dialog} className="zenix-update-dialog" aria-labelledby="zenix-update-title" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="zenix-updates" onClick={event => event.stopPropagation()}>
      <header><div><small>ZENIX · 新版本</small><h2 id="zenix-update-title">Zenix {state.version}</h2></div><button ref={closeButton} aria-label="关闭更新提醒" onClick={close}><X size={18} /></button></header>
      <h3>这次更新的亮点</h3><p className="zenix-update-notes">{state.notes?.trim() || '该版本暂未提供更新说明。你可以选择稍后在应用更新中查看和安装。'}</p>
      <p role="status">{state.message}</p>
      {state.status === 'downloading' && <><progress max={100} value={state.progress} aria-label="更新下载进度" /><span>{state.progress}%</span></>}
      {error && <p role="alert">{error}</p>}
      <footer><button onClick={close}>暂不更新</button>
        {['available', 'error'].includes(state.status) && <button disabled={busy} onClick={() => void action(updateIsIOS() ? 'install' : 'download')}><ArrowDownToLine size={15} />{updateIsIOS() ? '打开发行渠道' : state.status === 'error' ? '重试下载' : '下载更新'}</button>}
        {state.status === 'ready' && <button disabled={busy} onClick={() => void action('install')}>安装并重启</button>}
        {state.status === 'downloading' && <button disabled={busy} onClick={() => void action('cancel')}>取消下载</button>}
      </footer>
    </section>
  </dialog>;
}
