import { useEffect, useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import { readLinkedPlaylist, playlistPlatforms, type LinkedPlaylist, type PlaylistResponse } from '../core/playlistLinks';
import type { ToolInvoke } from './MusicTools';
import { readPlaylistFile, readTextPlaylist, type FilePlaylistPreview, type TextOrder } from '../core/playlistFiles';
import {startActivity} from '../features/tasks/activities';

export default function PlaylistLinkImport({ invoke, disabled, onPreview, initialInput = '' }: { invoke: ToolInvoke; disabled: boolean; onPreview: (value: any) => void; initialInput?: string }) {
  const [input, setInput] = useState(initialInput), [preview, setPreview] = useState<LinkedPlaylist>(), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [partial, setPartial] = useState(false);
  const [mode, setMode] = useState<'link'|'text'|'file'>(()=>initialInput && !/https?:\/\//i.test(initialInput)?'text':'link'), [order, setOrder] = useState<TextOrder>('auto');
  const [filePreview, setFilePreview] = useState<FilePlaylistPreview>(), [file, setFile] = useState<{name:string;bytes:Uint8Array}>();
  const [automatic, setAutomatic] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined), mounting = useRef(true), saving = useRef(false);
  useEffect(() => { mounting.current = true; return () => { mounting.current = false; controller.current?.abort(); }; }, []);
  async function load() {
    if (busy) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setPreview(undefined); setFilePreview(undefined); setPartial(false); setMessage('正在解析歌单');
    try {
      if (mode !== 'link') {
        let selected = file;
        if (mode === 'file' && !selected) {
          const value = await invoke<{name:string;base64:string}|null>({ operation: 'playlistReadFile' });
          if (!value || abort.signal.aborted) return;
          selected = { name: value.name, bytes: Uint8Array.from(atob(value.base64), c => c.charCodeAt(0)) }; setFile(selected);
        }
        abort.signal.throwIfAborted();
        const result = mode === 'text' ? readTextPlaylist(input, order) : readPlaylistFile(selected!.bytes, selected!.name, order);
        if (mounting.current) { setFilePreview(result); setName(result.lists[0].name); setAutomatic(true); setMessage('请核对歌名与歌手，确认后创建独立歌单'); }
        return;
      }
      const result = await readLinkedPlaylist(input, args => invoke<PlaylistResponse>({ operation: 'playlistRequest', ...args }), abort.signal, text => { if (!abort.signal.aborted) setMessage(text); });
      if (!abort.signal.aborted && mounting.current) { setPreview(result); setName(result.name); setAutomatic(false); setMessage('请核对曲目，确认后创建独立歌单'); }
    } catch (error) { if (!abort.signal.aborted && mounting.current) setMessage(error instanceof Error ? error.message : '歌单读取失败，请重试'); }
    finally { if (mounting.current && controller.current === abort) { setBusy(false); controller.current = undefined; } }
  }
  async function save() {
    if ((!preview && !filePreview) || !name.trim() || busy || disabled || saving.current || preview && !preview.complete && !partial) return;
    saving.current = true; setBusy(true);
    try {
      const lists = filePreview ? filePreview.lists.map((list, index) => ({ ...list, name: index === 0 ? name.trim() : list.name, autoReplacement: automatic })) : [{ name: name.trim(), tracks: preview!.tracks, autoReplacement: automatic }];
      const value = await invoke<{ pending: { token: string } }>({ operation: 'playlistPreview', bundle: { format: 'zenix-playlist', schemaVersion: 1, playlists: lists } });
      if (mounting.current) onPreview(value);
      const saved = await invoke({ operation: 'importConfirm', token: value.pending.token });
      if (mounting.current) { onPreview(saved); setPreview(undefined); setFilePreview(undefined); setMessage('已创建独立歌单；同名歌单会自动区分，原有歌单保持保留'); }
    } catch (error) { if (mounting.current) setMessage(error instanceof Error ? error.message : '导入失败，请重试；若已有待确认清单，可在下方继续确认'); }
    finally { saving.current = false; if (mounting.current) setBusy(false); }
  }
  function background(){try{const text=input,selected=file,format=order,currentMode=mode;startActivity('后台解析歌单',async(signal,report)=>{report(0,1,'正在读取歌曲清单');let playlists;if(currentMode==='link'){const value=await readLinkedPlaylist(text,args=>invoke<PlaylistResponse>({operation:'playlistRequest',...args}),signal,message=>report(0,1,message));signal.throwIfAborted();if(!value.complete)throw Error('公开清单不完整，请在前台预览确认后导入');playlists=[{name:value.name,tracks:value.tracks,autoReplacement:true}];}else{signal.throwIfAborted();const value=currentMode==='text'?readTextPlaylist(text,format):readPlaylistFile(selected!.bytes,selected!.name,format);playlists=value.lists.map(list=>({...list,autoReplacement:true}));}signal.throwIfAborted();report(1,1,'已解析，请在工作台预览并确认导入');return {playlists};});setMessage('已移到工作台的后台任务，解析后需明确确认导入');}catch(error){setMessage(String(error));}}
  return <section className="playlist-link-import"><h3><Link2 size={17}/> 从音乐平台带来歌单</h3>
    <p>支持 QQ、网易云、酷我的公开分享链接，以及文本歌单。先预览，再确认导入。</p>
    <div className="tool-actions" aria-label="歌单导入方式">{([{id:'link',label:'分享链接'},{id:'file',label:'文本文件'},{id:'text',label:'粘贴文本'}] as const).map(item=><button key={item.id} disabled={busy} aria-pressed={mode===item.id} onClick={()=>{setMode(item.id);setInput('');setPreview(undefined);setFilePreview(undefined);setFile(undefined);setMessage('');}}>{item.label}</button>)}</div>
    {mode !== 'file' && <label className="tool-field">{mode==='link'?'歌单分享文字或链接':'歌曲清单（每行一首）'}<textarea value={input} disabled={busy} maxLength={mode==='link'?8192:500000} onChange={event => { setInput(event.target.value); setPreview(undefined); setFilePreview(undefined); setMessage(''); }} placeholder={mode==='link'?'粘贴音乐 App 复制的歌单分享内容':'歌名 - 歌手\n或：歌手《歌名》\n也支持带“歌名、歌手、专辑”表头的 CSV / 制表符文本'} rows={mode==='link'?3:6}/></label>}
    {mode !== 'link' && <label className="tool-field">文本识别顺序<select value={order} disabled={busy} onChange={event=>{setOrder(event.target.value as TextOrder);setFilePreview(undefined);}}><option value="auto">智能识别（表头优先）</option><option value="title-first">歌名在前，歌手在后</option><option value="artist-first">歌手在前，歌名在后</option></select><small>纯歌名也可导入；未指定歌手时可能匹配到翻唱或其他版本，请核对播放结果。</small></label>}
    {mode==='file' && <p>{file?.name || '选择 UTF-8 .txt／.csv／.tsv 文件（最大 2 MiB）。'}{file && <button disabled={busy} onClick={()=>{setFile(undefined);setFilePreview(undefined);}}>更换文件</button>}</p>}
    <div className="tool-actions"><button disabled={busy || disabled || mode!=='file'&&!input.trim()} onClick={() => void load()}>{preview || filePreview ? '重新解析' : '解析歌单'}</button>{busy && controller.current && <button onClick={() => { controller.current?.abort(); setMessage('已取消，不会保存歌单'); setBusy(false); }}>取消解析</button>}</div>
    {preview && <div className="playlist-link-preview"><strong>{playlistPlatforms[preview.platform]} · {preview.tracks.length} 首可导入{preview.total !== null ? ` / 原歌单 ${preview.total} 首` : ''}</strong>
      <p>{preview.complete ? '已读取完整公开清单' : '清单不完整或完整性无法确认'}</p>{preview.warnings.map((warning, index) => <p role="note" key={index}>{warning}</p>)}
      <label className="tool-field">新歌单名称<input value={name} maxLength={100} onChange={event => setName(event.target.value)}/></label>
      <ol>{preview.tracks.slice(0, 30).map(track => <li key={track.id}><b>{track.title}</b><small>{track.artist || '未知歌手'}</small></li>)}</ol>{preview.tracks.length > 30 && <small>预览显示前 30 首，导入包含上方全部可导入曲目。</small>}
      {!preview.complete && <label className="playlist-partial"><input type="checkbox" checked={partial} onChange={event => setPartial(event.target.checked)}/>我了解这不是完整歌单，只导入本次成功读取的曲目</label>}
      <label className="playlist-partial"><input type="checkbox" checked={automatic} onChange={event=>setAutomatic(event.target.checked)}/>播放此歌单时自动搜索匹配可播放版本（最多三个候选）</label>
      <button disabled={busy || disabled || !name.trim() || !preview.complete && !partial} onClick={() => void save()}>导入为新歌单</button>
    </div>}
    {filePreview && <div className="playlist-link-preview"><strong>{filePreview.lists.length} 个歌单 · {filePreview.lists.reduce((sum,list)=>sum+list.tracks.length,0)} 首可导入</strong>{filePreview.warnings.map((warning,index)=><p role="note" key={index}>{warning}</p>)}<label className="tool-field">{filePreview.lists.length>1?'第一个歌单名称':'新歌单名称'}<input value={name} maxLength={100} onChange={event=>setName(event.target.value)}/></label>{filePreview.lists.map((list,index)=><div key={index}><b>{index===0?name:list.name} · {list.tracks.length} 首</b><ol>{list.tracks.slice(0,30).map(track=><li key={track.id}><b>{track.title}</b><small>{track.artist||'未指定歌手'}</small></li>)}</ol>{list.tracks.length>30&&<small>预览前 30 首，确认后导入全部 {list.tracks.length} 首。</small>}</div>)}<label className="playlist-partial"><input type="checkbox" checked={automatic} onChange={event=>setAutomatic(event.target.checked)}/>播放此歌单时自动搜索匹配可播放版本（最多三个候选）</label><button disabled={busy||disabled||!name.trim()} onClick={()=>void save()}>导入为新歌单</button></div>}
    <button disabled={busy||disabled||(mode==='file'?!file:!input.trim())} onClick={background}>在后台解析，稍后确认导入</button>
    {message && <p role="status" aria-live="polite">{message}</p>}
    <small>仅迁移曲目信息，不迁移音频、平台账号或会员权限；播放使用自己的音乐源。私密或登录后可见的歌单请先在原平台公开。</small>
  </section>;
}
