import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { desktopTool, type ToolInvoke } from './MusicTools';
import { useDialogFocus } from './useDialogFocus';
import { useGlassConfirm } from './useGlassConfirm';
import { canonical, cleanProfile, PROFILE_FIELDS } from '../core/backupFormat';
import './MusicTools.css';
import './ReliabilityTools.css';

const labels: Record<string, string> = { liked: '喜欢', favorites: '收藏', playlists: '歌单', history: '播放历史', profile: '个人资料', appearance: '外观', stats: '听歌统计' };
type Preview = { token: string; counts: Record<string, number>; localCount: number; playlists: { name: string; count: number }[] };
type BrowserData = { profile: Record<string, unknown>; transparency: number };
type Info = { undoAvailable: boolean; recovery?: Result | null; backgroundBytes: number; metadataBytes?: number; statsBytes?: number; profileBytes?: number; backgroundKind?: string | null };
type Result = { added?: number; skipped?: number; unavailable?: number; linked?: number; browser?: BrowserData; previousBrowser?: BrowserData; sections?: string[]; undoAvailable?: boolean; browserReceipt?: boolean };
const browserData = (): BrowserData => { let profile = {}; try { profile = JSON.parse(localStorage.getItem('zenix.profile.card.v2') || '{}'); } catch {} return { profile: cleanProfile({...profile,...(!Object.hasOwn(profile,'name') && localStorage.getItem('zenix.profile.name') ? {name:localStorage.getItem('zenix.profile.name')} : {}),...(!Object.hasOwn(profile,'tagline') && localStorage.getItem('zenix.profile.tagline') ? {tagline:localStorage.getItem('zenix.profile.tagline')} : {})}), transparency: 0 }; };
function applyBrowser(result: Result) {
  if (!result.browser) return;
  if (result.sections?.includes('profile')) { const current = JSON.parse(localStorage.getItem('zenix.profile.card.v2') || '{}'); for(const key of PROFILE_FIELDS)delete current[key]; const next = { ...current, ...result.browser.profile }; localStorage.setItem('zenix.profile.card.v2', JSON.stringify(next)); if(next.name===undefined)localStorage.removeItem('zenix.profile.name');else localStorage.setItem('zenix.profile.name',String(next.name));if(next.tagline===undefined && next.bio===undefined)localStorage.removeItem('zenix.profile.tagline');else localStorage.setItem('zenix.profile.tagline',String(next.tagline || next.bio || '')); window.dispatchEvent(new CustomEvent('zenix:profile-restored')); }
}
export default function BackupSettings({ invoke = desktopTool, browser = browserData, changed, pickLocal, disabled = false }: {
  invoke?: ToolInvoke; browser?: () => BrowserData; changed?: () => Promise<void> | void; pickLocal?: () => Promise<unknown>; disabled?: boolean;
}) {
  const { confirm, dialog } = useGlassConfirm();
  const [mode, setMode] = useState<'create' | 'restore'>(), [selected, setSelected] = useState(['liked', 'favorites', 'playlists']);
  const [info, setInfo] = useState<Info>(), [preview, setPreview] = useState<Preview>(), [media, setMedia] = useState(false), [video, setVideo] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { if (disabled) return; let active = true; invoke<Info>({ operation: 'backupInfo' }).then(async value => { if (!active) return; setInfo(value); if (value.recovery) { const current = canonical(browser().profile); if (current !== canonical(value.recovery.browser?.profile) && current !== canonical(value.recovery.previousBrowser?.profile)) throw Error('上次恢复已中断，当前名片又有修改。快照已保留，请确认后完成中断恢复'); applyBrowser(value.recovery); await invoke({ operation: 'backupAcknowledge', browser: browser() }); await changed?.(); setMessage('已完成上次中断的名片同步，现有资料已保留'); } setInfo({ ...value, recovery: null, undoAvailable: value.recovery?.undoAvailable ?? value.undoAvailable }); }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : String(error)); }); return () => { active = false; }; }, [invoke, disabled]);
  const run = async (operation: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(''); try { await operation(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const toggle = (key: string) => setSelected(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]);
  const close = () => { if (busy) return; setMode(undefined); setPreview(undefined); void invoke({ operation: 'backupDiscard' }).catch(() => {}); };
  const focus = useDialogFocus(Boolean(mode), close);
  const updateBrowser = async (result: Result, before: BrowserData) => { try { applyBrowser(result); if (result.browserReceipt) await invoke({ operation: 'backupAcknowledge', browser: browser() }); } catch (error) { const undone = await invoke<Result>({ operation: 'backupUndo', browser: result.browser || before }); applyBrowser({ browser: before, sections: result.sections }); if (undone.browserReceipt) await invoke({ operation: 'backupAcknowledge', browser: before }); throw error; } await changed?.(); };
  const restore = () => void run(async () => {
    if (!preview || !(await confirm({ title: '合并备份资料', message: `将合并${selected.map(key => labels[key]).join('、')}。同名不同内容歌单会另建副本，恢复前会保存撤销快照。`, confirmLabel: '确认恢复' }))) return;
    const before = browser(), result = await invoke<Result>({ operation: 'backupApply', token: preview.token, sections: selected, browser: before }); await updateBrowser(result, before);
    setInfo(previous => ({ ...previous!, undoAvailable: true })); setPreview(undefined); setMode(undefined); setMessage(`恢复完成：新增 ${result.added || 0} 首记录，跳过 ${result.skipped || 0} 项；${result.unavailable || 0} 首本地歌曲待关联。`);
  });
  const estimated = ((info?.metadataBytes || 0) + (selected.includes('stats') ? info?.statsBytes || 0 : 0) + (selected.includes('profile') ? info?.profileBytes || new TextEncoder().encode(JSON.stringify(browser().profile)).length : 0) + (media ? (info?.backgroundBytes || 0) * 4 / 3 : 0)) / 1024 / 1024;
  return <section className="reliability-card glass"><h3>资料备份</h3><p>电脑与安卓使用同一种 .zenixbackup 文件。喜欢、收藏、歌单默认备份；音频缓存、音乐文件和音乐源脚本另行管理。</p>
    <div className="backup-actions"><button disabled={disabled || busy} onClick={() => { setSelected(['liked', 'favorites', 'playlists']); setMedia(false); setVideo(false); setMode('create'); }}>创建备份</button>
      <button disabled={disabled || busy} onClick={() => void run(async () => { const value = await invoke<Preview | null>({ operation: 'backupRead' }); if (!value) return; setPreview(value); setSelected(['liked', 'favorites', 'playlists'].filter(key => key in value.counts)); setMode('restore'); })}>恢复备份</button>
      {info?.undoAvailable && <button disabled={busy} onClick={() => void run(async () => { if (!(await confirm({ title: '撤销上次恢复', message: '还原到恢复前的资料。恢复后如果已有新修改，会保留资料并拒绝整体撤销。', confirmLabel: '撤销恢复' }))) return; const before = browser(); const result = await invoke<Result>({ operation: 'backupUndo', browser: before }); applyBrowser(result); if (result.browserReceipt) await invoke({ operation: 'backupAcknowledge', browser: browser() }); await changed?.(); setInfo(previous => ({ ...previous!, undoAvailable: false })); setMessage('已撤销上次恢复'); })}>撤销上次恢复</button>}
    </div>{info?.recovery && <button disabled={busy} onClick={() => void run(async () => { if (!(await confirm({ title: '完成中断恢复', message: '同步中断记录对应的名片。确认后将替换当前名片内容，现有歌单与其他资料保留。', confirmLabel: '还原名片' }))) return; applyBrowser(info.recovery!); await invoke({ operation: 'backupAcknowledge', browser: browser() }); await changed?.(); setInfo(previous => ({ ...previous!, recovery: null, undoAvailable: info.recovery?.undoAvailable ?? false })); setMessage('已完成中断恢复'); })}>完成中断恢复</button>}<p>本地歌曲只保存名称、歌手、专辑与时长，找不到原文件时保留记录。先导入本机音乐文件或文件夹，再重新关联。</p>
    <div className="backup-actions">{pickLocal && <button disabled={busy || disabled} onClick={() => void run(async () => { await pickLocal(); setMessage('本地音乐导入完成，可重新关联'); })}>选择本地音乐</button>}<button disabled={busy || disabled} onClick={() => void run(async () => { const result = await invoke<Result>({ operation: 'backupRelink' }); await changed?.(); setMessage(`已关联 ${result.linked || 0} 首本地歌曲`); })}>重新关联本地歌曲</button></div>
    {message && <p role="status">{message}</p>}
    {mode && createPortal(<div className="zenix-tools-backdrop zenix-reliability-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) close(); }}><section className="zenix-tools glass backup-dialog" ref={focus} tabIndex={-1} role="dialog" aria-modal="true" aria-label={mode === 'create' ? '创建资料备份' : '恢复资料备份'}><header><h2>{mode === 'create' ? '创建资料备份' : '恢复预览'}</h2><button disabled={busy} onClick={close} aria-label="关闭资料备份"><X/></button></header>
      <div className="backup-preview">{Object.keys(labels).filter(key => mode === 'create' || key in (preview?.counts || {})).map(key => <label key={key}>{labels[key]}{mode === 'restore' && <small>{preview?.counts[key]} {key === 'stats' ? '天' : '项'}</small>}<input type="checkbox" disabled={busy} checked={selected.includes(key)} onChange={() => toggle(key)}/></label>)}
      {mode === 'create' && selected.includes('appearance') && <><label><input type="checkbox" disabled={busy || !info?.backgroundBytes} checked={media} onChange={event => { setMedia(event.target.checked); if (!event.target.checked) setVideo(false); }}/>包括背景媒体</label>{info?.backgroundKind === 'video' && media && <label><input type="checkbox" disabled={busy} checked={video} onChange={event => setVideo(event.target.checked)}/>包括视频背景（单独确认）</label>}<p>图片上限 12 MiB，MP4/WebM 视频上限 32 MiB；超过上限时可取消媒体，只备份资料。</p></>}
      {mode === 'create' && <p>估计文件大小：约 {estimated.toFixed(1)} MiB，最终以保存结果为准。</p>}
      {preview && <><p>文件格式与完整性已校验。包含 {preview.localCount} 首本地歌曲记录；找不到文件会保留为待关联。</p>{preview.playlists.map((list, index) => <p key={index}>{list.name} · {list.count} 首</p>)}<p>个人资料和外观需手动勾选才会恢复。统计合并取同一天、同一首歌的较大记录，避免重复累计。</p></>}
      </div><footer><button disabled={busy} onClick={close}>取消</button><button disabled={busy || !selected.length || (mode === 'create' && media && info?.backgroundKind === 'video' && !video)} onClick={mode === 'restore' ? restore : () => void run(async () => { const result = await invoke<{ saved: boolean; bytes: number } | null>({ operation: 'backupCreate', sections: selected, browser: browser(), includeBackground: selected.includes('appearance') && media, includeVideo: video }); if (result?.saved) { setMode(undefined); setMessage(`备份已保存，大小 ${(result.bytes / 1024 / 1024).toFixed(1)} MiB`); } })}>{busy ? '处理中…' : mode === 'restore' ? '合并恢复' : '保存备份'}</button></footer>{message && <p role="alert">{message}</p>}
    </section></div>, document.body)}{dialog}
  </section>;
}
