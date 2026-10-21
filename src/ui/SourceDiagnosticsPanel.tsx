import { useEffect, useState } from 'react';
import type { InstalledSource, SourceDiagnosticsState } from '../core/types';
import './ReliabilityTools.css';

export default function SourceDiagnosticsPanel({ sources, load, configure }: {
  sources: InstalledSource[]; load: () => Promise<SourceDiagnosticsState>; configure: (smooth: boolean) => Promise<SourceDiagnosticsState>;
}) {
  const [state, setState] = useState<SourceDiagnosticsState>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = async (smooth?: boolean) => { setBusy(true); setError(''); try { setState(await (smooth === undefined ? load() : configure(smooth))); } catch { setError('无法读取播放诊断，请重试'); } finally { setBusy(false); } };
  useEffect(() => { let active = true; load().then(value => { if (active) setState(value); }).catch(() => { if (active) setError('无法读取播放诊断'); }); return () => { active = false; }; }, [load]);
  return <section className="reliability-card glass"><h3>播放诊断</h3><p>最近 7 天、每源最多 80 次实际尝试。取得地址不等于播放成功；缓存播放不计入音乐源记录。</p>
    <label><input type="checkbox" checked={state?.smooth === true} disabled={!state || busy} onChange={event => void refresh(event.target.checked)} />流畅优先</label>
    <p>{state?.smooth ? '优先尝试近期真正播放成功的源，其他源保持原顺序。播放品质保持你的选择。' : '按你排列的音乐源顺序尝试；失败不会关闭音乐源。'}</p>
    {sources.map(source => { const row = state?.sources[source.id]; return <div className="diagnostic-row" key={source.id}><strong>{source.manifest.name}</strong><small>{row?.played ? '近期已有实际播放成功记录，不保证每首可播' : row?.resolved ? '已取得音频地址，尚未确认播放成功' : row?.attempts ? '最近尝试未取得音频，请检查搜索平台或更换音源' : '尚未验证播放，请先搜索试听'}</small>{row?.attempts ? <small>取得地址 {row.resolved}/{row.attempts} · 开始播放 {row.played}/{row.resolved} · 平均解析 {(row.averageMs / 1000).toFixed(1)} 秒{row.lastFailure && <span>最近失败：{row.lastFailure}</span>}</small> : <small>暂无记录</small>}</div>; })}
    <button disabled={busy} onClick={() => void refresh()}>{busy ? '读取中…' : '刷新记录'}</button>{error && <p role="alert">{error}</p>}
  </section>;
}
