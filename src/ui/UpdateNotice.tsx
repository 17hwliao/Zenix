import { useEffect, useState } from 'react';
import { invokeUpdate, updateSupported, updatesBusy, type UpdateState } from '../core/updates';
import UpdateSettings from './UpdateSettings';
export default function UpdateNotice() {
  const [state, setState] = useState<UpdateState>(), [expanded, setExpanded] = useState(false), [hidden, setHidden] = useState('');
  useEffect(() => {
    if (!updateSupported()) return;
    let stopped = false, timer: number | undefined;
    async function refresh() { try { const next = await invokeUpdate({ operation: 'state' }); if (stopped) return; setState(next); clearTimeout(timer); if (updatesBusy() || ['downloading', 'checking'].includes(next.status)) timer = window.setTimeout(() => void refresh(), 1000); } catch { /* No notification for unavailable native preview. */ } }
    window.addEventListener('zenix-update-state', refresh); void refresh();
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('zenix-update-state', refresh); };
  }, []);
  if (!state || !['available', 'downloading', 'ready'].includes(state.status) || hidden === `${state.version}/${state.status}`) return null;
  return <aside className="zenix-update-notice">{expanded && <UpdateSettings />}<div><button onClick={() => setExpanded(value => !value)}>{state.status === 'downloading' ? `正在更新 · ${state.progress}%` : state.status === 'ready' ? '更新已就绪 · 点击安装' : `Zenix ${state.version} 可更新`}</button><button aria-label="隐藏更新提醒" onClick={() => { setHidden(`${state.version}/${state.status}`); setExpanded(false); }}>×</button></div></aside>;
}
