import { useEffect, useState } from 'react';
import { RefreshCw, ArrowDownToLine, ExternalLink } from 'lucide-react';
import { invokeUpdate, updateIsIOS, updatePreferences, saveUpdatePreferences, updateSupported, type UpdateState } from '../core/updates';
import { version } from '../../package.json';
import './UpdateSettings.css';
export default function UpdateSettings() {
  const [state, setState] = useState<UpdateState>({ status: 'idle', currentVersion: version, progress: 0, message: '尚未检查更新' });
  const [preferences, setPreferences] = useState(updatePreferences), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const supported = updateSupported(), ios = updateIsIOS();
  useEffect(() => {
    if (!supported) return;
    let disposed = false, timer: number | undefined;
    async function refresh() { try { const next = await invokeUpdate({ operation: 'state' }); if (disposed) return; setState(next); clearTimeout(timer); if (busy || next.status === 'downloading' || next.status === 'checking') timer = window.setTimeout(() => void refresh(), 800); } catch { /* The action surfaces its own error. */ } }
    void refresh(); window.addEventListener('zenix-update-state', refresh);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('zenix-update-state', refresh); };
  }, [supported, busy]);
  async function action(operation: 'check' | 'download' | 'cancel' | 'install', channel = preferences.channel) {
    if (operation === 'install' && !ios && !window.confirm('安装更新会重启应用，正在播放的音乐将暂停。现在安装？')) return;
    setBusy(true); setError('');
    try { setState(await invokeUpdate({ operation, channel })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  const save = (change: Partial<typeof preferences>) => { const next = { ...preferences, ...change }; setPreferences(next); saveUpdatePreferences(next); if (change.channel) { localStorage.removeItem('zenix.updates.lastCheck'); if (supported) void action('check', next.channel); } };
  return <section className="zenix-updates glass"><h3>应用更新 <small>v{state.currentVersion}{state.currentBuild ? ` · r${state.currentBuild}` : ''}</small></h3>
    <label>自动检查更新<input type="checkbox" checked={preferences.automatic} onChange={event => save({ automatic: event.target.checked })} /></label>
    {!ios && <label>自动下载，安装前确认<input type="checkbox" checked={preferences.autoDownload} onChange={event => save({ autoDownload: event.target.checked })} /></label>}
    <label>更新通道<select value={preferences.channel} disabled={busy || state.status === 'downloading'} onChange={event => save({ channel: event.target.value as 'stable' | 'preview' })}><option value="stable">正式版</option><option value="preview">预览版</option></select></label>
    <p role="status">{supported ? state.message : '浏览器预览不执行应用安装'}</p>
    {state.status === 'downloading' && <><progress max={100} value={state.progress} /><span>{state.progress}%</span></>}
    {state.notes && <p className="zenix-update-notes">{state.notes}</p>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" disabled={!supported || busy || state.status === 'downloading'} onClick={() => void action('check')}><RefreshCw size={15} />检查更新</button>
      {state.status === 'available' && <button disabled={busy} onClick={() => void action(ios ? 'install' : 'download')}>{ios ? <ExternalLink size={15} /> : <ArrowDownToLine size={15} />}{ios ? '打开发行渠道' : '下载更新'}</button>}
      {state.status === 'ready' && <button disabled={busy} onClick={() => void action('install')}>安装并重启</button>}
      {state.status === 'downloading' && <button onClick={() => void action('cancel')}>取消下载</button>}
      {state.status === 'error' && state.version && !ios && <button disabled={busy} onClick={() => void action('download')}>重试下载</button>}
    </footer>{ios && <small>由 TestFlight 或 App Store 安装更新，保留个人资料。</small>}
  </section>;
}
