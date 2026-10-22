import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { desktopTool, type ToolInvoke } from './MusicTools';
import { useDialogFocus } from './useDialogFocus';
import { useGlassConfirm } from './useGlassConfirm';
import { canonical, cleanProfile, PROFILE_FIELDS } from '../core/backupFormat';
import {captureFeatureSettings,applyFeatureSettings} from '../features/settingsBackup';
import './MusicTools.css';
import './ReliabilityTools.css';

const labels: Record<string, string> = { liked: '喜欢', favorites: '收藏', playlists: '歌单', history: '播放历史', profile: '个人资料', appearance: '外观', stats: '听歌统计', personalFeatures: '私人书签与歌词',featureSettings:'空间、版本、网络与助手设置' };
type Preview = { token: string; counts: Record<string, number>; localCount: number; playlists: { name: string; count: number }[];settingsDiff?:{key:string;label:string;status:string}[] };
type BrowserData = { profile: Record<string, unknown>; transparency: number;settings?:ReturnType<typeof captureFeatureSettings>;settingsError?:string };
type Info = { undoAvailable: boolean; recovery?: Result | null; backgroundBytes: number; metadataBytes?: number; statsBytes?: number; profileBytes?: number; backgroundKind?: string | null };
type Result = { added?: number; skipped?: number; unavailable?: number; linked?: number; browser?: BrowserData; previousBrowser?: BrowserData; sections?: string[]; undoAvailable?: boolean; browserReceipt?: boolean;receiptId?:string;backendPending?:boolean };
const browserData = (): BrowserData => { let profile = {}; try { profile = JSON.parse(localStorage.getItem('zenix.profile.card.v2') || '{}'); } catch {} return { profile: cleanProfile({...profile,...(!Object.hasOwn(profile,'name') && localStorage.getItem('zenix.profile.name') ? {name:localStorage.getItem('zenix.profile.name')} : {}),...(!Object.hasOwn(profile,'tagline') && localStorage.getItem('zenix.profile.tagline') ? {tagline:localStorage.getItem('zenix.profile.tagline')} : {})}), transparency: 0 }; };
function applyBrowser(result:Result){
  if(!result.browser)return;
  const profile=result.sections?.includes('profile'),features=result.sections?.includes('featureSettings')&&result.browser.settings;
  if(profile&&result.previousBrowser){const current=canonical(browserData().profile);if(current!==canonical(result.previousBrowser.profile)&&current!==canonical(result.browser.profile))throw Error('个人资料已有新修改，恢复快照已保留');}
  if(features&&!result.previousBrowser?.settings)throw Error('缺少设置恢复前快照，未覆盖当前设置');
  const written:{key:string;old:string|null;value:string|null}[]=[];let appliedSettings=false;
  const write=(key:string,value:string|null)=>{const old=localStorage.getItem(key);if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);written.push({key,old,value});};
  try{
    if(features){applyFeatureSettings(result.browser.settings,result.previousBrowser!.settings);appliedSettings=true;}
    if(profile){const current=JSON.parse(localStorage.getItem('zenix.profile.card.v2')||'{}');for(const key of PROFILE_FIELDS)delete current[key];const next={...current,...result.browser.profile};write('zenix.profile.card.v2',JSON.stringify(next));write('zenix.profile.name',next.name===undefined?null:String(next.name));write('zenix.profile.tagline',next.tagline===undefined&&next.bio===undefined?null:String(next.tagline||next.bio||''));window.dispatchEvent(new CustomEvent('zenix:profile-restored'));}
  }catch(error){
    for(const row of written.reverse())if(localStorage.getItem(row.key)===row.value)try{if(row.old===null)localStorage.removeItem(row.key);else localStorage.setItem(row.key,row.old);}catch{}
    if(appliedSettings)try{applyFeatureSettings(result.previousBrowser!.settings,result.browser.settings);}catch{}
    throw error;
  }
}
export default function BackupSettings({ invoke = desktopTool, browser = browserData, changed, pickLocal, disabled = false }: {
  invoke?: ToolInvoke; browser?: () => BrowserData; changed?: () => Promise<void> | void; pickLocal?: () => Promise<unknown>; disabled?: boolean;
}) {
  const { confirm, dialog } = useGlassConfirm();
  const readBrowser=():BrowserData=>{const current=browser();try{return {...current,settings:captureFeatureSettings()};}catch(error){return {...current,settingsError:error instanceof Error?error.message:String(error)};}};
  const [mode, setMode] = useState<'create' | 'restore'>(), [selected, setSelected] = useState(['liked', 'favorites', 'playlists']);
  const [info, setInfo] = useState<Info>(), [preview, setPreview] = useState<Preview>(), [media, setMedia] = useState(false), [video, setVideo] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''),[replaceSettings,setReplaceSettings]=useState(false);
  useEffect(()=>{if(disabled)return;let active=true;void invoke<Info>({operation:'backupInfo',browser:readBrowser()}).then(value=>{if(!active)return;setInfo(value);if(value.recovery)setMessage(value.recovery.backendPending?'检测到未完成的恢复。原资料与快照已保留，请选择恢复到操作前，或保留当前资料。':'检测到待确认的界面恢复。请明确选择补齐界面资料，或保留当前设置。');}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:String(error));});return()=>{active=false;};},[invoke,disabled]);
  const run = async (operation: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(''); try { await operation(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const toggle = (key: string) => setSelected(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]);
  const close = () => { if (busy) return; setMode(undefined); setPreview(undefined); void invoke({ operation: 'backupDiscard' }).catch(() => {}); };
  const focus = useDialogFocus(Boolean(mode), close);
  const updateBrowser=async(result:Result,_before:BrowserData)=>{try{applyBrowser(result);if(result.browserReceipt)await invoke({operation:'backupAcknowledge',browser:readBrowser(),receiptId:result.receiptId});}catch(error){if(result.browserReceipt){const value=await invoke<Info>({operation:'backupInfo',browser:readBrowser()});setInfo(value);}throw error;}await changed?.();};
  const restore = () => void run(async () => {
    if (!preview || !(await confirm({ title: '合并备份资料', message: `将合并${selected.map(key => labels[key]).join('、')}。同名不同内容歌单会另建副本，恢复前会保存撤销快照。`, confirmLabel: '确认恢复' }))) return;
    const before = readBrowser(), result = await invoke<Result>({ operation: 'backupApply', token: preview.token, sections: selected, browser: before,featureSettingsMode:replaceSettings?'replace':'merge' }); await updateBrowser(result, before);
    setInfo(previous => ({ ...previous!, undoAvailable: true })); setPreview(undefined); setMode(undefined); setMessage(`恢复完成：新增 ${result.added || 0} 首记录，跳过 ${result.skipped || 0} 项；${result.unavailable || 0} 首本地歌曲待关联。`);
  });
  const estimated = ((info?.metadataBytes || 0) + (selected.includes('stats') ? info?.statsBytes || 0 : 0) + (selected.includes('profile') ? info?.profileBytes || new TextEncoder().encode(JSON.stringify(readBrowser().profile)).length : 0) + (media ? (info?.backgroundBytes || 0) * 4 / 3 : 0)) / 1024 / 1024;
  return <section className="reliability-card glass"><h3>资料备份</h3><p>电脑与安卓使用同一种 .zenixbackup 文件。喜欢、收藏、歌单默认备份；音频缓存、音乐文件和音乐源脚本另行管理。</p>
    <div className="backup-actions"><button disabled={disabled || busy} onClick={() => { setSelected(['liked', 'favorites', 'playlists']); setMedia(false); setVideo(false); setReplaceSettings(false);setMode('create'); }}>创建备份</button>
      <button disabled={disabled || busy} onClick={() => void run(async () => { const value = await invoke<Preview | null>({ operation: 'backupRead',browser:readBrowser() }); if (!value) return; setPreview(value); setSelected(['liked', 'favorites', 'playlists'].filter(key => key in value.counts)); setReplaceSettings(false);setMode('restore'); })}>恢复备份</button>
      {info?.undoAvailable && <button disabled={busy} onClick={() => void run(async () => { if (!(await confirm({ title: '撤销上次恢复', message: '还原到恢复前的资料。恢复后如果已有新修改，会保留资料并拒绝整体撤销。', confirmLabel: '撤销恢复' }))) return; const before = readBrowser(); const result = await invoke<Result>({ operation: 'backupUndo', browser: before }); applyBrowser(result); if (result.browserReceipt) await invoke({ operation: 'backupAcknowledge', browser: readBrowser(),receiptId:result.receiptId }); await changed?.(); setInfo(previous => ({ ...previous!, undoAvailable: false })); setMessage('已撤销上次恢复'); })}>撤销上次恢复</button>}
    </div>{info?.recovery&&<button disabled={busy} onClick={()=>void run(async()=>{
      const pending=info.recovery!;if(!(await confirm({title:pending.backendPending?'恢复到操作前':'完成中断恢复',message:pending.backendPending?'仅在相关资料仍与恢复前或本次写入结果一致时，恢复到操作前；检测到之后的新修改会停止操作并保留资料。':'仅在当前内容仍与恢复前或目标快照一致时补齐界面资料；有新修改时保留当前内容。',confirmLabel:pending.backendPending?'确认恢复到操作前':'补齐界面资料'})))return;
      const result=pending.backendPending?await invoke<Result>({operation:'backupRecover',receiptId:pending.receiptId,browser:readBrowser()}):pending;
      applyBrowser(result);if(result.browserReceipt)await invoke({operation:'backupAcknowledge',browser:readBrowser(),receiptId:result.receiptId});await changed?.();setInfo(await invoke<Info>({operation:'backupInfo',browser:readBrowser()}));setMessage('已完成所选恢复操作，现有资料已保留');
    })}>{info.recovery.backendPending?'恢复到操作前':'完成中断恢复'}</button>}{info?.recovery&&(info.recovery.backendPending||info.recovery.sections?.some(section=>section==='featureSettings'||section==='profile'))&&<button disabled={busy} onClick={()=>void run(async()=>{if(!(await confirm({title:'保留当前资料',message:'结束待处理恢复，保留现在的资料和设置。原快照继续保留，本次不再提供会覆盖当前资料的整体撤销。',confirmLabel:'保留当前资料'})))return;await invoke({operation:'backupKeepCurrent',receiptId:info.recovery!.receiptId,browser:readBrowser()});setInfo(previous=>({...previous!,recovery:null,undoAvailable:false}));setMessage('已保留当前资料与设置，原快照仍保留');})}>保留当前资料并结束恢复</button>}<p>本地歌曲只保存名称、歌手、专辑与时长，找不到原文件时保留记录。先导入本机音乐文件或文件夹，再重新关联。</p>
    <div className="backup-actions">{pickLocal && <button disabled={busy || disabled} onClick={() => void run(async () => { await pickLocal(); setMessage('本地音乐导入完成，可重新关联'); })}>选择本地音乐</button>}<button disabled={busy || disabled} onClick={() => void run(async () => { const result = await invoke<Result>({ operation: 'backupRelink' }); await changed?.(); setMessage(`已关联 ${result.linked || 0} 首本地歌曲`); })}>重新关联本地歌曲</button></div>
    {message && <p role="status">{message}</p>}
    {mode && createPortal(<div className="zenix-tools-backdrop zenix-reliability-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) close(); }}><section className="zenix-tools glass backup-dialog" ref={focus} tabIndex={-1} role="dialog" aria-modal="true" aria-label={mode === 'create' ? '创建资料备份' : '恢复资料备份'}><header><h2>{mode === 'create' ? '创建资料备份' : '恢复预览'}</h2><button disabled={busy} onClick={close} aria-label="关闭资料备份"><X/></button></header>
      <div className="backup-preview">{Object.keys(labels).filter(key => mode === 'create' || key in (preview?.counts || {})).map(key => <label key={key}>{labels[key]}{mode === 'restore' && <small>{preview?.counts[key]} {key === 'stats' ? '天' : '项'}</small>}<input type="checkbox" disabled={busy} checked={selected.includes(key)} onChange={() => toggle(key)}/></label>)}
      {mode === 'create' && selected.includes('appearance') && <><label><input type="checkbox" disabled={busy || !info?.backgroundBytes} checked={media} onChange={event => { setMedia(event.target.checked); if (!event.target.checked) setVideo(false); }}/>包括背景媒体</label>{info?.backgroundKind === 'video' && media && <label><input type="checkbox" disabled={busy} checked={video} onChange={event => setVideo(event.target.checked)}/>包括视频背景（单独确认）</label>}<p>图片上限 12 MiB，MP4/WebM 视频上限 32 MiB；超过上限时可取消媒体，只备份资料。</p></>}
      {mode === 'create' && <p>估计文件大小：约 {estimated.toFixed(1)} MiB，最终以保存结果为准。</p>}
      {preview?.settingsDiff&&selected.includes('featureSettings')&&<div><h4>功能设置差异</h4>{preview.settingsDiff.map(row=><p key={row.key}>{row.label}：{row.status}</p>)}<label><input type="checkbox" disabled={busy} checked={replaceSettings} onChange={event=>setReplaceSettings(event.target.checked)}/>使用备份中的设置（不勾选时保留本机冲突项，仅补充缺失内容）</label><p>替换前保留撤销快照；不包含皮肤包、音频、来源密钥或系统权限。</p></div>}{preview && <><p>文件格式与完整性已校验。包含 {preview.localCount} 首本地歌曲记录；找不到文件会保留为待关联。</p>{preview.playlists.map((list, index) => <p key={index}>{list.name} · {list.count} 首</p>)}<p>个人资料和外观需手动勾选才会恢复。统计合并取同一天、同一首歌的较大记录，避免重复累计。</p></>}
      </div><footer><button disabled={busy} onClick={close}>取消</button><button disabled={busy || !selected.length || (mode === 'create' && media && info?.backgroundKind === 'video' && !video)} onClick={mode === 'restore' ? restore : () => void run(async () => { const result = await invoke<{ saved: boolean; bytes: number } | null>({ operation: 'backupCreate', sections: selected, browser: readBrowser(), includeBackground: selected.includes('appearance') && media, includeVideo: video }); if (result?.saved) { setMode(undefined); setMessage(`备份已保存，大小 ${(result.bytes / 1024 / 1024).toFixed(1)} MiB`); } })}>{busy ? '处理中…' : mode === 'restore' ? '合并恢复' : '保存备份'}</button></footer>{message && <p role="alert">{message}</p>}
    </section></div>, document.body)}{dialog}
  </section>;
}
