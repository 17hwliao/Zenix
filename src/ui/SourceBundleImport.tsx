import { useEffect, useRef, useState } from 'react';
import { FilePlus2, LoaderCircle } from 'lucide-react';
import { MAX_BUNDLE_BYTES, parseSourceBundle, verifySourceEntry, type SourceBundle, type SourceBundleEntry } from '../core/sourceBundle';
import './SourceBundleImport.css';
import { invokeUpdate, updateSupported } from '../core/updates';

type Result = { name: string; url: string; error?: string };
type Props = { disabled?: boolean; install(entry: SourceBundleEntry): Promise<void>; onBusy?(busy: boolean): void };

export default function SourceBundleImport({ disabled, install, onBusy }: Props) {
  const input = useRef<HTMLInputElement>(null), stopped = useRef(false), mounted = useRef(true), running = useRef(false);
  const [bundle, setBundle] = useState<SourceBundle | null>(null), [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]), [active, setActive] = useState(''), [error, setError] = useState('');
  const [address, setAddress] = useState(''), [fetching, setFetching] = useState(false);
  const [managedAddress, setManagedAddress] = useState(() => { try { const value = localStorage.getItem('zenix.sources.bundleUrl'); if (!value) return ''; const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopped.current = true; }; }, []);
  async function read(file?: File) {
    if (!file) return;
    setError(''); setBundle(null); setResults([]);
    try { if (file.size > MAX_BUNDLE_BYTES) throw new Error('分享源包不能超过 8 MiB'); setBundle(parseSourceBundle(await file.text())); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function start(retry = false) {
    if (!bundle || running.current) return;
    const pending = retry ? bundle.sources.filter(entry => results.some(result => result.url === entry.url && result.error)) : bundle.sources;
    if (!pending.length) return;
    stopped.current = false; running.current = true; setBusy(true); onBusy?.(true); setError('');
    let next = retry ? results.filter(result => !result.error) : [];
    setResults(next);
    try {
      for (const entry of pending) {
        if (stopped.current) break;
        if (mounted.current) setActive(entry.name);
        let result: Result = { name: entry.name, url: entry.url };
        try { await verifySourceEntry(entry); await install(entry); }
        catch (reason) { result = { name: entry.name, url: entry.url, error: reason instanceof Error ? reason.message : String(reason) }; }
        next = [...next, result];
        if (mounted.current) setResults(next);
      }
    } finally {
      running.current = false;
      if (mounted.current) { setActive(''); setBusy(false); }
      onBusy?.(false);
    }
  }
  async function loadLink(managed = false) {
    setError(''); setFetching(true); onBusy?.(true);
    try {
      const url = managed ? managedAddress : address.trim();
      const text = await invokeUpdate<string>({ operation: 'sourceBundle', ...(url ? { url } : {}) });
      if (new TextEncoder().encode(text).length > MAX_BUNDLE_BYTES) throw new Error('分享源包不能超过 8 MiB');
      if (mounted.current) { setBundle(parseSourceBundle(text)); setResults([]); }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (mounted.current) setFetching(false); onBusy?.(false); }
  }
  const failures = results.filter(result => result.error).length;
  return <section className="zenix-bundle-import" aria-label="音乐源分享包">
    <input ref={input} hidden type="file" disabled={busy || disabled} onChange={event => { void read(event.target.files?.[0]); event.target.value = ''; }} />
    <button type="button" className="zenix-bundle-pick" disabled={busy || fetching || disabled} onClick={() => input.current?.click()}><FilePlus2 size={17} />导入分享源包</button>
    <button type="button" className="zenix-bundle-pick" disabled={busy || fetching || disabled || !updateSupported()} onClick={() => void loadLink(true)}>载入专用源包</button>
    <div className="zenix-bundle-link"><input type="url" aria-label="分享源包链接" placeholder="粘贴 .zenixsources 的 HTTPS 分享链接" value={address} onChange={event => setAddress(event.target.value)} /><button type="button" disabled={busy || fetching || disabled || !address.trim() || !updateSupported()} onClick={() => void loadLink()}>{fetching ? '正在获取…' : '获取源包'}</button></div>
    {address.trim() && <button type="button" disabled={busy || fetching || disabled} onClick={() => { try { const url = new URL(address.trim()); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('请填写无用户名和密码的 HTTPS 分享链接'); localStorage.setItem('zenix.sources.bundleUrl', url.href); setManagedAddress(url.href); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>设为我的专用源入口</button>}
    {managedAddress && <small>专用源入口：{new URL(managedAddress).hostname} · 包更新后再次载入即可</small>}
    {!bundle && <small>选择收到的 .zenixsources 文件，一次添加多个音乐源。</small>}
    {bundle && <div className="zenix-bundle-preview"><strong>{bundle.name} · {bundle.sources.length} 个音乐源</strong>
      <p>确认后会运行包内脚本；缺少脚本的条目将从原始地址获取。仅添加你信任的分享包。</p>
      <ol>{bundle.sources.map((entry, index) => <li key={entry.url}><span>{String(index + 1).padStart(2, '0')} · {entry.name}</span><small>{entry.script ? '内含脚本' : '联网获取'} · {new URL(entry.url).hostname}</small></li>)}</ol>
      <div role="status" aria-live="polite">{busy ? <><LoaderCircle size={15} className="zenix-bundle-spin" />正在添加 {active} · {results.length}/{bundle.sources.length}</> : results.length > 0 ? `已成功 ${results.length - failures} 个，失败 ${failures} 个${results.length < bundle.sources.length ? '，剩余未处理' : ''}` : '按上述顺序添加；已有同地址的源更新后保留原顺序。'}</div>
      {failures > 0 && <ul className="zenix-bundle-errors">{results.filter(result => result.error).map(result => <li key={result.url}>{result.name}：{result.error}</li>)}</ul>}
      <footer>{busy ? <button type="button" onClick={() => { stopped.current = true; }}>完成当前后停止</button> : <><button type="button" onClick={() => { setBundle(null); setResults([]); }}>关闭</button>{failures > 0 && <button type="button" disabled={disabled} onClick={() => void start(true)}>重试失败项</button>}<button type="button" disabled={disabled} onClick={() => void start()}>{results.length ? '重新导入全部' : '确认批量添加'}</button></>}</footer>
    </div>}
    {error && <p className="zenix-bundle-errors" role="alert">{error}</p>}
  </section>;
}
