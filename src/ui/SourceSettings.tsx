import { useEffect, useState, type FormEvent } from 'react';
import { FilePlus2, FolderOpen, Globe2, Power, Trash2 } from 'lucide-react';
import type { AudioCacheStats, InstalledSource, SourcePreview } from '../core/types';
import { LX_PRESETS, type LxPreset } from './lxPresets';
import './SourceSettings.css';
import SourceBundleImport from './SourceBundleImport';
import { SourceNetworkOptions, DEFAULT_SOURCE_POLICY, type SourceNetworkPolicy } from './SourceNetworkOptions';

export default function SourceSettings() {
  const [sources, setSources] = useState<InstalledSource[]>([]);
  const [cache, setCache] = useState<AudioCacheStats | null>(null);
  const [quality, setQuality] = useState(() => localStorage.getItem('zenix.onlineQuality') || 'auto');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [permission, setPermission] = useState<SourceNetworkPolicy>(DEFAULT_SOURCE_POLICY);
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
  useEffect(() => { void window.yzqxy?.cache.stats().then(setCache).catch(() => {}); }, []);
  const configureCache = async (options: { enabled?: boolean; limitMiB?: number }) => {
    try { setCache(await window.yzqxy!.cache.configure(options)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const clearCache = async () => {
    if (!window.confirm('清除自动缓存的音频？近期播放记录、收藏、歌单和本地音乐文件都会保留。')) return;
    try { setCache(await window.yzqxy!.cache.clear()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
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
    try { const next = await action(); if (next) { if (preview) await window.yzqxy!.sources.cancelImport(preview.token); setPreview(next); setPermission(DEFAULT_SOURCE_POLICY); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const cancelPreview = () => { if (preview) void window.yzqxy!.sources.cancelImport(preview.token); setPreview(null); };
  const installPreview = () => {
    if (!preview) return;
    const token = preview.token;
    void run(async () => { const next = await window.yzqxy!.sources.confirmImport(token, permission); setPreview(null); setUrl(''); return next; });
  };
  const installPreset = async (preset: LxPreset) => {
    if (!preset.url || !window.yzqxy?.sources) return;
    setBusy(true); setError('');
    const urls = [presetInstalled(preset)?.origin.label || preset.url, preset.url];
    if (preset.url.startsWith('https://raw.githubusercontent.com/pdone/lx-music-source/')) urls.push(preset.url.replace('https://raw.githubusercontent.com/', 'https://ghproxy.net/raw.githubusercontent.com/'));
    let lastError = '';
    for (const address of [...new Set(urls)]) {
      let token = '';
      try {
        const next = await window.yzqxy.sources.importUrl(address);
        token = next.token;
        setSources(await window.yzqxy.sources.confirmImport(token));
        setBusy(false);
        return;
      } catch (reason) {
        if (token) void window.yzqxy.sources.cancelImport(token);
        lastError = reason instanceof Error ? reason.message : String(reason);
      }
    }
    setError(`${preset.name}添加失败：${lastError}`);
    setBusy(false);
  };
  const presetInstalled = (preset: LxPreset) => sources.find(source => source.origin.label === preset.url || source.origin.label.includes(`/lx-music-source/main/${preset.key}/latest.js`));
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
    <div className="yz-settings-intro"><h2>音乐源</h2><p>按首次接入时间依次尝试。每个源先获取所选音质，再逐级降低；该源仍不可播放时才切换到下一个。更新脚本不会改变顺序。</p></div>
    <label className="zenix-source-quality">播放音质<select value={quality} onChange={event => { setQuality(event.target.value); localStorage.setItem('zenix.onlineQuality', event.target.value); }}><option value="auto">自动 · 优先最高可用</option><option value="standard">标准</option><option value="high">最高高音质</option><option value="lossless">最高无损</option></select></label>
    {cache && <section className="zenix-audio-cache" aria-label="自动缓存">
      <div><strong>自动缓存</strong><small>播放过的在线歌曲会缓存在本机，再次播放优先读取缓存。近期播放记录、收藏与歌单独立保存。</small></div>
      <label>启用<input type="checkbox" checked={cache.enabled} onChange={event => void configureCache({ enabled: event.target.checked })} /></label>
      <label>容量上限<select value={cache.limitMiB} onChange={event => void configureCache({ limitMiB: Number(event.target.value) })}><option value={512}>512 MB</option><option value={1024}>1 GB</option><option value={2048}>2 GB</option><option value={5120}>5 GB</option></select></label>
      <small>已缓存 {cache.trackCount} 首 · {(cache.usedBytes / 1024 / 1024).toFixed(1)} MB；超过容量时先清理最久未使用的歌曲，30 天未使用的缓存会过期。</small>
      <small>封面与歌词缓存 {((cache.metadataBytes || 0) / 1024 / 1024).toFixed(1)} MB / {cache.metadataLimitMiB || 64} MB，30 天过期。</small>
      {cache.metadataError && <small role="status">{cache.metadataError}</small>}
      <button type="button" onClick={() => void clearCache()}>清除自动缓存</button>
    </section>}
    <section className="zenix-source-presets" aria-label="音乐源快捷添加">
      <div className="zenix-source-presets-head"><strong>快捷添加音乐源</strong><small>直接从上游下载最新脚本；播放效果以实际服务为准。</small></div>
      <div className="zenix-source-preset-list">{LX_PRESETS.map(preset => {
        const installed = presetInstalled(preset);
        return <div className="zenix-source-preset" key={preset.key}><div><strong>{preset.name}</strong><small>{preset.description}</small></div><button type="button" disabled={busy || !preset.url} onClick={() => void installPreset(preset)}>{!preset.url ? '链接失效' : installed ? '重新获取' : '一键添加'}</button></div>;
      })}</div>
    </section>
    <SourceBundleImport disabled={busy || Boolean(preview) || !window.yzqxy?.sources} onBusy={setBusy} install={async entry => {
      const bridge = window.yzqxy!.sources;
      let token = '';
      try {
        const next = entry.script !== undefined ? await bridge.importText(entry.script, entry.url) : await bridge.importUrl(entry.url);
        token = next.token;
        setSources(await bridge.confirmImport(token));
      } finally { if (token) await bridge.cancelImport(token).catch(() => {}); }
    }} />
    <div className="zenix-source-import">
      <button type="button" onClick={() => void loadPreview(() => window.yzqxy!.sources.importFile())} disabled={busy || !window.yzqxy?.sources}><FilePlus2 size={16} />导入源包 / 脚本</button>
      <button type="button" onClick={() => void loadPreview(() => window.yzqxy!.sources.importFolder())} disabled={busy || !window.yzqxy?.sources}><FolderOpen size={16} />源文件夹</button>
      <form onSubmit={importUrl}><Globe2 size={16} /><input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="粘贴 HTTP / HTTPS 源包或 .js 脚本地址" aria-label="音乐源地址" /><button type="submit" disabled={busy || !url.trim()}>导入</button></form>
    </div>
    {preview && <div className="zenix-source-preview"><strong>{preview.previousVersion ? `更新 ${preview.manifest.name} · ${preview.previousVersion} → ${preview.manifest.version}` : `安装 ${preview.manifest.name} · ${preview.manifest.version}`}</strong><small>{preview.origin.label}</small>{preview.kind === 'lx' ? <><p>支持的 搜索平台将在安装时检测。</p><p>音乐源脚本会在运行时请求公开网络地址。请只导入你信任的脚本；播放是否成功取决于脚本自己的服务。</p></> : <><p>能力：{preview.manifest.capabilities.filter(capability => capability !== 'resolveDownload').join(' · ')}</p><p>接口域名：{preview.manifest.network.apiHosts.join(' · ') || '无'}</p><p>媒体域名：{preview.manifest.network.mediaHosts.join(' · ') || '无'}</p><p>封面域名：{preview.manifest.network.artworkHosts.join(' · ') || '无'}</p></>}<SourceNetworkOptions compatible={preview.kind === 'lx'} policy={permission} onChange={setPermission} /><small>SHA-256 {preview.sha256.slice(0, 16)}…</small><div><button onClick={cancelPreview} disabled={busy}>取消</button><button onClick={installPreview} disabled={busy}>确认安装并启用</button></div></div>}
    <p className="zenix-source-hint">支持 .zenixsource JSON、自定义 .js 脚本及其 HTTPS 地址。搜索平台可在安装后的“源选项”中切换。<button className="zenix-source-folder-link" onClick={() => void window.yzqxy?.sources.openFolder()}>打开已安装源目录</button></p>
    {error && <p className="zenix-source-error" role="alert">{error}</p>}
    <div className="zenix-source-list">
      {sources.length === 0 && <div className="zenix-source-empty">还没有音乐源。添加后即可搜索在线歌曲。</div>}
      {sources.map((source, index) => <section key={source.id} className={`zenix-source-card${source.enabled ? '' : ' is-disabled'}`}>
        <div className="zenix-source-card-head"><span className="zenix-source-rank">{String(index + 1).padStart(2, '0')}</span><span className="zenix-source-dot" /><div><strong>{source.manifest.name}</strong><small>{source.kind === 'lx' ? '音乐源脚本' : 'Zenix 源'} · {source.manifest.version.startsWith('v') ? source.manifest.version : `v${source.manifest.version}`} · 接入于 {new Date(source.installedAt).toLocaleString()}</small></div><button title={source.enabled ? '停用音乐源' : '启用音乐源'} aria-label={source.enabled ? '停用音乐源' : '启用音乐源'} onClick={() => void run(() => window.yzqxy!.sources.setEnabled(source.id, !source.enabled))} disabled={busy}><Power size={16} /></button></div>
        <p>{source.manifest.capabilities.filter(capability => capability !== 'resolveDownload').map(capability => ({ search: '搜索', resolvePlayback: '播放', lyrics: '歌词', artwork: '封面' })[capability as 'search' | 'resolvePlayback' | 'lyrics' | 'artwork'] || capability).join(' · ')}</p>
        <small className="zenix-source-domains">{source.kind === 'lx' ? `搜索平台：${Object.keys(source.manifest.lxPlatforms || {}).join(' · ')} · 音乐源脚本运行时连接网络` : [...source.manifest.network.apiHosts, ...source.manifest.network.mediaHosts].join(' · ')}</small>
        {source.lastError && <small className="zenix-source-error">最近错误：{source.lastError}</small>}
        <div className="zenix-source-actions">
          {<button onClick={() => void openSettings(source)} disabled={busy}>{editing === source.id ? '收起选项' : '源选项'}</button>}
          <button title="移除" aria-label={`移除 ${source.manifest.name}`} onClick={() => { if (window.confirm(`移除音乐源“${source.manifest.name}”？已收藏的歌曲记录会保留。`)) void run(() => window.yzqxy!.sources.remove(source.id)); }} disabled={busy}><Trash2 size={14} /></button>
        </div>
        {editing === source.id && <form className="zenix-source-options" onSubmit={event => void saveSettings(event, source.id)}>
          {source.manifest.settings.map(field => <label key={field.key}>{field.key === 'lxCatalog' ? '搜索平台' : field.label}{field.type === 'select'
            ? <select value={values[field.key] ?? field.default} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))}>{field.options.map(option => <option key={option} value={option}>{source.kind === 'lx' ? source.manifest.lxPlatforms?.[option]?.name || option : option}</option>)}</select>
            : <input value={values[field.key] ?? field.default} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} />}</label>)}
          <SourceNetworkOptions compatible={source.kind === 'lx'} policy={{ allowHttp: values.__allowHttp === 'true', hosts: values.__allowedHosts ? values.__allowedHosts.split(',').map(host => host.trim()) : null }} onChange={policy => setValues(previous => ({ ...previous, __allowHttp: String(policy.allowHttp), __allowedHosts: policy.hosts?.join(',') || '' }))} />
          <button type="submit" disabled={busy}>保存源选项</button>
        </form>}
      </section>)}
    </div>
  </div>;
}
