import { useEffect, useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import { readLinkedPlaylist, playlistPlatforms, type LinkedPlaylist, type PlaylistResponse } from '../core/playlistLinks';
import type { ToolInvoke } from './MusicTools';

export default function PlaylistLinkImport({ invoke, disabled, onPreview }: { invoke: ToolInvoke; disabled: boolean; onPreview: (value: any) => void }) {
  const [input, setInput] = useState(''), [preview, setPreview] = useState<LinkedPlaylist>(), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [partial, setPartial] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined), mounting = useRef(true), saving = useRef(false);
  useEffect(() => { mounting.current = true; return () => { mounting.current = false; controller.current?.abort(); }; }, []);
  async function load() {
    if (busy) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setPreview(undefined); setPartial(false); setMessage('正在解析歌单');
    try {
      const result = await readLinkedPlaylist(input, args => invoke<PlaylistResponse>({ operation: 'playlistRequest', ...args }), abort.signal, text => { if (!abort.signal.aborted) setMessage(text); });
      if (!abort.signal.aborted && mounting.current) { setPreview(result); setName(result.name); setMessage('请核对曲目，确认后创建独立歌单'); }
    } catch (error) { if (!abort.signal.aborted && mounting.current) setMessage(error instanceof Error ? error.message : '歌单读取失败，请重试'); }
    finally { if (mounting.current && controller.current === abort) { setBusy(false); controller.current = undefined; } }
  }
  async function save() {
    if (!preview || !name.trim() || busy || disabled || saving.current || !preview.complete && !partial) return;
    saving.current = true; setBusy(true);
    try {
      const value = await invoke<{ pending: { token: string } }>({ operation: 'playlistPreview', bundle: { format: 'zenix-playlist', schemaVersion: 1, playlists: [{ name: name.trim(), tracks: preview.tracks }] } });
      if (mounting.current) onPreview(value);
      const saved = await invoke({ operation: 'importConfirm', token: value.pending.token });
      if (mounting.current) { onPreview(saved); setPreview(undefined); setMessage('已创建独立歌单；同名歌单会自动区分，原有歌单保持保留'); }
    } catch (error) { if (mounting.current) setMessage(error instanceof Error ? error.message : '导入失败，请重试；若已有待确认清单，可在下方继续确认'); }
    finally { saving.current = false; if (mounting.current) setBusy(false); }
  }
  return <section className="playlist-link-import"><h3><Link2 size={17}/> 从音乐平台带来歌单</h3>
    <p>支持 QQ 音乐、网易云音乐、酷我音乐的公开歌单。复制平台的分享文字或链接，先预览，再确认导入。</p>
    <label className="tool-field">歌单分享文字或链接<textarea value={input} disabled={busy} maxLength={8192} onChange={event => { setInput(event.target.value); setPreview(undefined); setMessage(''); }} placeholder="例如 https://y.qq.com/n/ryqq/playlist/…" rows={3}/></label>
    <div className="tool-actions"><button disabled={busy || disabled || !input.trim()} onClick={() => void load()}>{preview ? '重新解析' : '解析歌单'}</button>{busy && controller.current && <button onClick={() => { controller.current?.abort(); setMessage('已取消，不会保存歌单'); setBusy(false); }}>取消解析</button>}</div>
    {preview && <div className="playlist-link-preview"><strong>{playlistPlatforms[preview.platform]} · {preview.tracks.length} 首可导入{preview.total !== null ? ` / 原歌单 ${preview.total} 首` : ''}</strong>
      <p>{preview.complete ? '已读取完整公开清单' : '清单不完整或完整性无法确认'}</p>{preview.warnings.map((warning, index) => <p role="note" key={index}>{warning}</p>)}
      <label className="tool-field">新歌单名称<input value={name} maxLength={100} onChange={event => setName(event.target.value)}/></label>
      <ol>{preview.tracks.slice(0, 30).map(track => <li key={track.id}><b>{track.title}</b><small>{track.artist || '未知歌手'}</small></li>)}</ol>{preview.tracks.length > 30 && <small>预览显示前 30 首，导入包含上方全部可导入曲目。</small>}
      {!preview.complete && <label className="playlist-partial"><input type="checkbox" checked={partial} onChange={event => setPartial(event.target.checked)}/>我了解这不是完整歌单，只导入本次成功读取的曲目</label>}
      <button disabled={busy || disabled || !name.trim() || !preview.complete && !partial} onClick={() => void save()}>导入为新歌单</button>
    </div>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    <small>仅迁移曲目信息，不迁移音频、平台账号或会员权限；播放使用自己的音乐源。私密或登录后可见的歌单请先在原平台公开。</small>
  </section>;
}
