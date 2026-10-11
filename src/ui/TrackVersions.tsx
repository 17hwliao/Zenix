import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { InstalledSource, SourceDiagnosticsState } from '../core/types';
import type { TrackView } from './types';
import { useDialogFocus } from './useDialogFocus';
import './MusicTools.css';
import './ReliabilityTools.css';

export default function TrackVersions<T extends TrackView>({ track, selected, sources, select, load }: {
  track: T; selected: T; sources: InstalledSource[]; select: (track: T) => void; load: () => Promise<SourceDiagnosticsState>;
}) {
  const [open, setOpen] = useState(false), [diagnostics, setDiagnostics] = useState<SourceDiagnosticsState>();
  const ref = useDialogFocus(open, () => setOpen(false));
  useEffect(() => { if (!open) return; let active = true; load().then(value => { if (active) setDiagnostics(value); }).catch(() => {}); return () => { active = false; }; }, [open, load]);
  const alternatives = (track.searchAlternatives || [track]) as T[];
  if (track.source !== 'custom') return null;
  return <><button type="button" onClick={event => { event.stopPropagation(); setOpen(true); }} aria-label="版本与来源">版本与来源{alternatives.length > 1 ? ` (${alternatives.length})` : ''}</button>
    {open && createPortal(<div className="zenix-tools-backdrop zenix-reliability-backdrop" onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }} onClick={event => event.stopPropagation()}><section className="zenix-tools version-dialog" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="版本与来源"><header><h2>版本与来源</h2><button aria-label="关闭版本与来源" onClick={() => setOpen(false)}><X/></button></header><p>选择来源不会打断当前播放，回到贴纸后点击播放生效。已声明的品质以实际返回音频为准。</p><div className="version-options">{alternatives.map(candidate => { const source = sources.find(item => item.id === candidate.providerId), row = diagnostics?.sources[candidate.providerId || '']; const declared = source ? [...new Set([...(source.manifest.qualities || []), ...Object.values(source.manifest.lxPlatforms || {}).flatMap(platform => platform.qualitys)])].join(' / ') : ''; return <button key={candidate.id} disabled={!source?.enabled || !source.manifest.capabilities.includes('resolvePlayback')} aria-pressed={candidate.id === selected.id} onClick={() => select(candidate)}><strong>{candidate.title} · {candidate.artist}</strong><small>{candidate.album || '专辑未知'} · {candidate.duration ? `${Math.floor(candidate.duration / 60)}:${String(Math.round(candidate.duration % 60)).padStart(2, '0')}` : '时长未知'}</small><small>{source?.manifest.name || '来源未安装'}{declared && ` · 声明品质：${declared}`}</small><small>{row?.attempts ? `近 7 天取得地址 ${row.resolved}/${row.attempts}，开始播放 ${row.played}/${row.resolved}` : '此来源暂无实际播放记录'}</small>{candidate.id === selected.id && <small>已选为待播放来源</small>}</button>; })}</div><footer><button onClick={() => setOpen(false)}>返回贴纸</button></footer></section></div>, document.body)}
  </>;
}
