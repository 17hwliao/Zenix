import { useEffect, useState } from 'react';
import type { PersonalState, Track } from '../../core/types';
import './tasks.css';

type Invoke = <T>(args: Record<string, unknown>) => Promise<T>;
type Item = {track: Track; status: string; received?: number; total?: number; error?: string};
type Task = {id: string; name: string; status: string; pin: boolean; quality: string; items: Item[]; error?: string};
type State = {tasks: Task[]; policy: Record<string, string>; network: string; clearing?: boolean; cache: {usedBytes: number; limitMiB: number; enabled: boolean; writable?: boolean; error?: string; pinnedCount?: number}; error?: string};
const states: Record<string, string> = {queued: '排队中', running: '正在准备', waiting: '等待网络条件', paused: '已暂停', complete: '准备完成', failed: '部分失败', cancelled: '已取消', pending: '待处理', local: '使用本地文件'};
const bytes = (value: number) => `${(value / 1048576).toFixed(1)} MiB`;
export default function TasksPanel({invoke, personal, current}: {invoke: Invoke; personal?: PersonalState; current?: Track}) {
  const [state, setState] = useState<State>(), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState('');
  const [playlist, setPlaylist] = useState('current'), [quality, setQuality] = useState('high'), [group, setGroup] = useState('通勤'), [pin, setPin] = useState(true);
  useEffect(() => { let alive = true, pending = false;
    const refresh = async () => { if (pending || document.hidden) return; pending = true; try { const next = await invoke<State>({operation: 'offlineTasks', action: 'state'}); if (alive) setState(next); } catch (error) { if (alive) setMessage(error instanceof Error ? error.message : '任务读取失败'); } finally { pending = false; } };
    void refresh(); const timer = setInterval(() => void refresh(), 1200); return () => { alive = false; clearInterval(timer); };
  }, [invoke]);
  const act = async (args: Record<string, unknown>) => { if (busy) return; setBusy(true); setMessage(''); setDismissed(''); try { setState(await invoke<State>({operation: 'offlineTasks', ...args})); } catch (error) { setMessage(error instanceof Error ? error.message : '操作未完成'); } finally { setBusy(false); } };
  const selected = personal?.playlists.find(value => value.id === playlist);
  const tracks = playlist === 'current' ? current ? [current] : [] : selected?.tracks || [];
  const alert = message || state?.error || state?.cache.error || '';
  return <div className="zenix-offline-tasks">
    <section><h3>离线收纳盒</h3><p>准备完整音频后可离线重听。关闭此页面不会停止已开始的任务；本地歌曲使用原文件，不复制到缓存。</p>
      <div className="offline-fields"><label>准备内容<select value={playlist} onChange={event => setPlaylist(event.target.value)}><option value="current">当前歌曲</option>{personal?.playlists.map(value => <option key={value.id} value={value.id}>{value.name} · {value.tracks.length} 首</option>)}</select></label>
      <label>品质<select value={quality} onChange={event => setQuality(event.target.value)}><option value="standard">标准</option><option value="high">高品质</option><option value="lossless">无损</option></select></label>
      <label>使用场景<input maxLength={80} value={group} onChange={event => setGroup(event.target.value)} placeholder="例如通勤、睡前"/></label></div>
      <label className="offline-check"><input type="checkbox" checked={pin} onChange={event => setPin(event.target.checked)}/>固定保留，自动清理时跳过</label>
      <button disabled={busy || !tracks.length || state?.clearing || state?.cache.enabled === false || state?.cache.writable === false} onClick={() => void act({action: 'prepare', tracks, name: selected?.name || current?.title || '离线收纳', group: group.trim() || '离线收纳', quality, pin})}>准备 {tracks.length} 首歌曲</button>
      {state && <p>音频缓存 {bytes(state.cache.usedBytes)} / {state.cache.limitMiB} MiB · {state.cache.enabled ? '缓存已开启' : '请先开启音频缓存'}{typeof state.cache.pinnedCount === 'number' ? ` · 固定 ${state.cache.pinnedCount} 项` : ''}</p>}
    </section>
    <section><h3>网络使用偏好</h3><p>网络状态：{state?.network === 'unmetered' ? '非计费网络' : state?.network === 'metered' ? '计费网络' : '计费状态未知'}。无法识别时，“仅非计费网络”会等待，不猜测 Wi-Fi。已完整缓存的内容仍可读取；更新与局域网连接独立运行。</p>
      <div className="offline-fields">{([['audio', '音频联网'], ['lyrics', '歌词联网'], ['artwork', '封面联网'], ['preload', '后台离线准备']] as const).map(([key, label]) => <label key={key}>{label}<select disabled={busy || !state} value={state?.policy[key] || 'always'} onChange={event => void act({action: 'policy', policy: {[key]: event.target.value}})}><option value="always">允许联网</option><option value="unmetered">仅非计费网络</option><option value="never">禁止此类联网</option></select></label>)}</div>
    </section>
    <section><h3>后台任务</h3>{!state?.tasks.length && <p>暂无任务。</p>}{state?.tasks.slice().reverse().map(task => { const complete = task.items.filter(item => item.status === 'complete' || item.status === 'local').length; return <article key={task.id}><div className="offline-heading"><strong>{task.name}</strong><span>{states[task.status] || task.status} · {complete}/{task.items.length}</span></div>
      <progress value={complete} max={Math.max(1, task.items.length)} aria-label={`${task.name}完成数量`}/>
      {task.items.filter(item => item.status === 'running').map(item => <p key={item.track.id}>{item.track.title} · {item.total ? `${Math.min(100, Math.floor((item.received || 0) * 100 / item.total))}%` : `${bytes(item.received || 0)}，总大小未知`}</p>)}
      <div className="offline-actions">{['queued', 'running', 'waiting'].includes(task.status) && <button disabled={busy} onClick={() => void act({action: 'pause', id: task.id})}>暂停</button>}{['paused', 'cancelled'].includes(task.status) && <button disabled={busy} onClick={() => void act({action: 'resume', id: task.id})}>继续未完成项</button>}{task.status === 'failed' && <button disabled={busy} onClick={() => void act({action: 'retry', id: task.id})}>重试失败项</button>}{!['complete', 'cancelled'].includes(task.status) && <button disabled={busy} onClick={() => void act({action: 'cancel', id: task.id})}>取消任务</button>}{task.pin && <button disabled={busy} onClick={() => void act({action: 'unpin', id: task.id})}>解除本场景固定</button>}</div>
      {(task.error || task.items.some(item => item.error)) && <details><summary>查看失败原因</summary>{task.error && <p>{task.error}</p>}{task.items.filter(item => item.error).map(item => <p key={item.track.id}>{item.track.title}：{item.error}</p>)}</details>}
    </article>; })}</section>
    {alert && alert !== dismissed && <div className="offline-message" role="alert"><span>{alert}</span><button onClick={() => { setMessage(''); setDismissed(alert); }} aria-label="关闭任务提示">×</button></div>}
  </div>;
}
