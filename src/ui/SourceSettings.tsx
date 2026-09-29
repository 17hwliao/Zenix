import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, FilePlus2, FolderOpen, Globe2, Pause, Play, Power, Trash2 } from 'lucide-react';
import type { DownloadTask, InstalledSource, SourcePreview } from '../core/types';
import './SourceSettings.css';

export default function SourceSettings() {
  const [sources, setSources] = useState<InstalledSource[]>([]);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  const [quality, setQuality] = useState(() => localStorage.getItem('zenix.onlineQuality') || 'high');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const bridge = window.yzqxy?.sources;
    if (!bridge) return;
    void bridge.list().then(setSources).catch(reason => setError(String(reason)));
    return bridge.onChanged(setSources);
  }, []);
  useEffect(() => {
    const bridge = window.yzqxy?.sources;
    if (!bridge) return;
    void bridge.downloads().then(setDownloads).catch(() => {});
    return bridge.onDownloadsChanged(setDownloads);
  }, []);
  useEffect(() => () => { if (preview) void window.yzqxy?.sources.cancelImport(preview.token); }, [preview]);
  const run = async (action: () => Promise<InstalledSource[] | null>) => {
    setBusy(true); setError('');
    try { const next = await action(); if (next) setSources(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const importUrl = (event: FormEvent) => {
    event.preventDefault();
    const address = url.trim(); if (!address) return;
    void loadPreview(() => window.yzqxy!.sources.importUrl(address));
  };
  const loadPreview = async (action: () => Promise<SourcePreview | null>) => {
    setBusy(true); setError('');
    try { const next = await action(); if (next) { if (preview) await window.yzqxy!.sources.cancelImport(preview.token); setPreview(next); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const cancelPreview = () => { if (preview) void window.yzqxy!.sources.cancelImport(preview.token); setPreview(null); };
  const installPreview = () => {
    if (!preview) return;
    const token = preview.token;
    void run(async () => { const next = await window.yzqxy!.sources.confirmImport(token); setPreview(null); setUrl(''); return next; });
  };
  const openSettings = async (source: InstalledSource) => {
    if (editing === source.id) { setEditing(null); return; }
    try { setValues(await window.yzqxy!.sources.getSettings(source.id)); setEditing(source.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const saveSettings = async (event: FormEvent, id: string) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await window.yzqxy!.sources.configure(id, values); setEditing(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="zenix-source-settings">
    <div className="yz-settings-intro"><h2>音乐源</h2><p>添加你信任的源，在线音乐会出现在搜索中。本地曲库始终可用。</p></div>
    <label className="zenix-source-quality">首选音质<select value={quality} onChange={event => { setQuality(event.target.value); localStorage.setItem('zenix.onlineQuality', event.target.value); }}><option value="standard">标准</option><option value="high">高音质</option><option value="lossless">无损</option></select></label>
    <div className="zenix-source-import">
      <button type="button" onClick={() => void loadPreview(() => window.yzqxy!.sources.importFile())} disabled={busy || !window.yzqxy?.sources}><FilePlus2 size={16} />导入源包</button>
      <button type="button" onClick={() => void loadPreview(() => window.yzqxy!.sources.importFolder())} disabled={busy || !window.yzqxy?.sources}><FolderOpen size={16} />源文件夹</button>
      <form onSubmit={importUrl}><Globe2 size={16} /><input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="粘贴 HTTPS 源包地址" aria-label="音乐源地址" /><button type="submit" disabled={busy || !url.trim()}>导入</button></form>
    </div>
    {preview && <div className="zenix-source-preview"><strong>{preview.previousVersion ? `更新 ${preview.manifest.name} · ${preview.previousVersion} → ${preview.manifest.version}` : `安装 ${preview.manifest.name} · ${preview.manifest.version}`}</strong><small>{preview.origin.label}</small><p>能力：{preview.manifest.capabilities.join(' · ')}</p><p>接口域名：{preview.manifest.network.apiHosts.join(' · ') || '无'}</p><p>媒体域名：{preview.manifest.network.mediaHosts.join(' · ') || '无'}</p><p>封面域名：{preview.manifest.network.artworkHosts.join(' · ') || '无'}</p><small>SHA-256 {preview.sha256.slice(0, 16)}…</small><div><button onClick={cancelPreview} disabled={busy}>取消</button><button onClick={installPreview} disabled={busy}>确认安装并启用</button></div></div>}
    <p className="zenix-source-hint">支持 .zenixsource 文件或含 manifest.json 与 index.js 的文件夹。<button className="zenix-source-folder-link" onClick={() => void window.yzqxy?.sources.openFolder()}>打开已安装源目录</button></p>
    {error && <p className="zenix-source-error" role="alert">{error}</p>}
    <div className="zenix-source-list">
      {sources.length === 0 && <div className="zenix-source-empty">还没有音乐源。添加后即可搜索在线歌曲。</div>}
      {sources.map((source, index) => <section key={source.id} className={`zenix-source-card${source.enabled ? '' : ' is-disabled'}`}>
        <div className="zenix-source-card-head"><span className="zenix-source-dot" /><div><strong>{source.manifest.name}</strong><small>{source.id} · v{source.manifest.version}</small></div><button title={source.enabled ? '停用音乐源' : '启用音乐源'} aria-label={source.enabled ? '停用音乐源' : '启用音乐源'} onClick={() => void run(() => window.yzqxy!.sources.setEnabled(source.id, !source.enabled))} disabled={busy}><Power size={16} /></button></div>
        <p>{source.manifest.capabilities.map(capability => ({ search: '搜索', resolvePlayback: '播放', lyrics: '歌词', artwork: '封面', resolveDownload: '下载' })[capability as 'search' | 'resolvePlayback' | 'lyrics' | 'artwork' | 'resolveDownload'] || capability).join(' · ')}</p>
        <small className="zenix-source-domains">{[...source.manifest.network.apiHosts, ...source.manifest.network.mediaHosts].join(' · ')}</small>
        {source.lastError && <small className="zenix-source-error">最近错误：{source.lastError}</small>}
        <div className="zenix-source-actions">
          {source.manifest.settings.length > 0 && <button onClick={() => void openSettings(source)} disabled={busy}>{editing === source.id ? '收起选项' : '源选项'}</button>}
          <button title="上移" aria-label={`上移 ${source.manifest.name}`} onClick={() => void run(() => window.yzqxy!.sources.move(source.id, -1))} disabled={busy || index === 0}><ArrowUp size={14} /></button>
          <button title="下移" aria-label={`下移 ${source.manifest.name}`} onClick={() => void run(() => window.yzqxy!.sources.move(source.id, 1))} disabled={busy || index === sources.length - 1}><ArrowDown size={14} /></button>
          <button title="移除" aria-label={`移除 ${source.manifest.name}`} onClick={() => { if (window.confirm(`移除音乐源“${source.manifest.name}”？已收藏的歌曲记录会保留。`)) void run(() => window.yzqxy!.sources.remove(source.id)); }} disabled={busy}><Trash2 size={14} /></button>
        </div>
        {editing === source.id && <form className="zenix-source-options" onSubmit={event => void saveSettings(event, source.id)}>
          {source.manifest.settings.map(field => <label key={field.key}>{field.label}{field.type === 'select'
            ? <select value={values[field.key] ?? field.default} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))}>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
            : <input value={values[field.key] ?? field.default} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} />}</label>)}
          <button type="submit" disabled={busy}>保存源选项</button>
        </form>}
      </section>)}
    </div>
    <section className="zenix-downloads"><h3>下载任务</h3>{downloads.length === 0 && <p>还没有下载歌曲。可在搜索结果中点击下载图标。</p>}{downloads.map(task => <div className="zenix-download-row" key={task.id}><div><strong>{task.track.title}</strong><small>{task.track.artist} · {task.status === 'completed' ? '已下载' : task.status === 'failed' ? `失败：${task.error}` : task.status === 'paused' ? '已暂停' : task.status === 'queued' ? '排队中' : task.status === 'resolving' ? '正在解析' : task.total ? `${Math.round(task.received / task.total * 100)}%` : `${Math.round(task.received / 1024)} KB`}</small></div>{task.status === 'completed' ? <button title="查看文件" aria-label={`查看 ${task.track.title} 文件`} onClick={() => void window.yzqxy!.sources.showDownload(task.id)}><FolderOpen size={15} /></button> : ['downloading', 'resolving', 'queued'].includes(task.status) ? <button title="暂停下载" aria-label={`暂停 ${task.track.title}`} onClick={() => void window.yzqxy!.sources.pauseDownload(task.id)}><Pause size={15} /></button> : <button title="继续下载" aria-label={`继续 ${task.track.title}`} onClick={() => void window.yzqxy!.sources.resumeDownload(task.id)}><Play size={15} /></button>}{task.total > 0 && <span className="zenix-download-progress" style={{ width: `${Math.min(100, task.received / task.total * 100)}%` }} />}</div>)}</section>
  </div>;
}
