import { useState } from 'react';
import type { TrackView as Track } from './types';
import './ListeningTools.css';
export type QueueEdit = (operation: string, args: Record<string, unknown>) => Promise<unknown>;
export default function QueueEditor({queue, currentId, edit}: {queue: Track[]; currentId?: string; edit: QueueEdit}) {
  const [expanded,setExpanded]=useState(false),[limit,setLimit]=useState(60);
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [undo, setUndo] = useState<{tracks: Track[]; expected: string[]} | null>(null);
  const ids = queue.map(track => track.id), checked = selected.filter(id => ids.includes(id));
  async function action(operation: string, args: Record<string, unknown>) {
    setBusy(true); setError('');
    try { await edit(operation, {...args, expected: ids}); if (operation === 'remove') { const removed = args.ids as string[]; setUndo({tracks: queue, expected: ids.filter(id => !removed.includes(id))}); setSelected([]); } else setUndo(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '队列操作失败'); } finally { setBusy(false); }
  }
  return <details className="listening-panel" aria-label="整理播放队列" onToggle={event=>setExpanded(event.currentTarget.open)}><summary>整理队列 · {queue.length} 首</summary>
    <div className="listening-row"><button disabled={busy} onClick={() => setSelected(checked.length === queue.length ? [] : ids)}>{checked.length === queue.length && queue.length ? '取消全选' : '全选'}</button><button disabled={busy || !checked.length} onClick={() => void action('remove', {ids: checked})}>移出选中 {checked.length || ''}</button>{undo && <button disabled={busy || JSON.stringify(undo.expected) !== JSON.stringify(ids)} onClick={async () => {setBusy(true);try{await edit('restore', {tracks: undo.tracks, expected: undo.expected});setUndo(null);}catch(e){setError(String(e));}finally{setBusy(false);}}}>撤销移除</button>}</div>
    <div className="listening-collection">{(expanded?queue.slice(0,limit):[]).map((song, index) => <div className={`listening-queue-row${song.id === currentId ? ' listening-selected-track' : ''}`} key={song.id} draggable={!busy} onDragStart={event => event.dataTransfer.setData('text/zenix-queue', String(index))} onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault();const value=event.dataTransfer.getData('text/zenix-queue');if(value)void action('move', {from: +value, to: index});}}><input type="checkbox" aria-label={`选择 ${song.title}`} checked={checked.includes(song.id)} onChange={event => setSelected(event.target.checked ? [...checked, song.id] : checked.filter(id => id !== song.id))}/><span style={{flex:1}}>{index + 1}. {song.title}{song.id === currentId ? ' · 当前' : ''}<small>{song.artist}</small></span><button aria-label={`上移 ${song.title}`} disabled={busy || !index} onClick={() => void action('move', {from: index, to: index - 1})}>↑</button><button aria-label={`下移 ${song.title}`} disabled={busy || index === queue.length - 1} onClick={() => void action('move', {from: index, to: index + 1})}>↓</button></div>)}{expanded&&queue.length>limit&&<button onClick={()=>setLimit(value=>value+60)}>继续显示 · 共 {queue.length} 首</button>}</div>
    {error && <p role="alert">{error}</p>}
  </details>;
}
