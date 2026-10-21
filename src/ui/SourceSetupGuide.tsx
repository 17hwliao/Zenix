import { useEffect, useRef, useState } from 'react';
import type { InstalledSource } from '../core/types';
import './SourceSetupGuide.css';

const labels: Record<string, string> = { tx: 'QQ 音乐', kw: '酷我音乐', kg: '酷狗音乐', wy: '网易云音乐', mg: '咪咕音乐' };
export default function SourceSetupGuide({ sources, configure, search }: {
  sources: InstalledSource[];
  configure(id: string, platform: string): Promise<void>;
  search(keyword: string, id: string): void;
}) {
  const enabled = sources.filter(source => source.enabled && source.manifest.capabilities.includes('search'));
  const [id, setId] = useState(''), [keyword, setKeyword] = useState('你不知道的事');
  const source = enabled.find(item => item.id === id) || enabled[0];
  const field = source?.kind === 'lx' ? source.manifest.settings.find(item => item.key === 'lxCatalog') : undefined;
  const current = source?.catalog || (source as (InstalledSource & { settings?: Record<string, string> }) | undefined)?.settings?.lxCatalog || field?.default || '';
  const [draft, setDraft] = useState({ id: '', base: '', value: '' });
  const platform = draft.id === source?.id && draft.base === current ? draft.value : current;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setMessage(''); }, [source?.id, current]);
  async function save() {
    if (!source || !platform || busy) return;
    setBusy(true); setMessage('');
    try { await configure(source.id, platform); if (alive.current) setMessage('搜索平台已保存，请搜索并点击歌曲的播放按钮试听。'); }
    catch (reason) { if (alive.current) setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="source-setup-guide" aria-label="音乐源首次使用与排查">
    <h3>先搜索，再试听</h3>
    <p>添加脚本只代表初始化成功。搜索平台提供歌曲名单，音频由音乐源的播放服务提供；两者需要分别确认。</p>
    {!source ? <p>先在下方添加可信音源或导入朋友的分享包，再回到这里搜索试听。不会自动添加或替换你的音源。</p> : <>
      <label>检查的音乐源<select aria-label="检查的音乐源" disabled={busy} value={source.id} onChange={event => setId(event.target.value)}>{enabled.map(item => <option key={item.id} value={item.id}>{item.manifest.name}</option>)}</select></label>
      {field?.type === 'select' && <div className="source-setup-platform"><label>搜索平台<select aria-label="首次使用搜索平台" disabled={busy} value={platform} onChange={event => setDraft({id: source.id, base: current, value: event.target.value})}>{field.options.map(value => <option key={value} value={value}>{labels[value] || value}</option>)}</select></label><button type="button" disabled={busy || platform === current} onClick={() => void save()}>{busy ? '保存中…' : '保存搜索平台'}</button></div>}
      <small>遇到限流或接口错误，可改用此源支持的 QQ、酷我或酷狗搜索。已有选择不会自动改变。</small>
      <form onSubmit={event => { event.preventDefault(); if (!busy && keyword.trim() && platform === current) search(keyword.trim(), source.id); }}>
        <label>试听歌曲<input aria-label="试听歌曲" maxLength={150} value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="输入熟悉的歌名" /></label>
        <button disabled={busy || !keyword.trim() || platform !== current}>搜索试听</button>
      </form>
      <small>打开搜索不会打断当前歌曲。点击结果中的播放按钮后，以播放诊断的“开始播放”记录为准；缓存播放不验证在线音源。</small>
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}
