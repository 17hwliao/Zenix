import {playableTrack} from './types';
import {DesktopAudioSettings,DesktopDeviceSettings} from './DesktopListeningSettings';
import CatalogBrowser from './CatalogBrowser';
import { useEffect, useRef, useState } from 'react';
import { Database, Disc3, FolderOpen, ImagePlus, Keyboard, Radio, RefreshCw, Search, Sparkles, Trash2, Volume2, X } from 'lucide-react';
import type { AppearanceBackground } from '../core/types';
import { getSoundSettings, playUiSound, setSoundSettings, type SoundKind } from '../core/sounds';
import BackupSettings from './BackupSettings';
import SourceSettings from './SourceSettings';
import UpdateSettings from './UpdateSettings';
import { MusicToolsButton } from './MusicTools';
import GlassSelect from './GlassSelect';
import './SettingsModal.css';
import SettingsSearch, { type SettingSearchEntry, type SettingsTab } from './SettingsSearch';

type SettingsModalProps = {
  initialTab?: 'options' | 'appearance' | 'sources';
  tracks?: import('./types').TrackView[];
  reduceMotion: boolean;
  libraryBusy: boolean;
  appearanceBackground?: AppearanceBackground | null;
  appearanceBusy?: boolean;
  desktopLyricsVisible?: boolean;
  onToggleDesktopLyrics?: () => void;
  onChooseBackground?: () => void | Promise<void>;
  onClearBackground?: () => void | Promise<void>;
  onReduceMotionChange: (value: boolean) => void;
  onImportFolder: () => void | Promise<void>;
  onRefreshLibrary?: () => void | Promise<void>;
  onClose: () => void;
};

export default function SettingsModal({ tracks=[], initialTab = 'options', reduceMotion, libraryBusy, appearanceBackground, appearanceBusy, desktopLyricsVisible, onToggleDesktopLyrics, onChooseBackground, onClearBackground, onReduceMotionChange, onImportFolder, onRefreshLibrary, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [query,setQuery]=useState(''),[destination,setDestination]=useState<SettingSearchEntry>();
  const searchInput=useRef<HTMLInputElement>(null),content=useRef<HTMLDivElement>(null);
  const [previewError, setPreviewError] = useState(false);
  const [sounds, setSounds] = useState(getSoundSettings);
  const updateSounds = (change: Partial<typeof sounds>) => { const next = { ...sounds, ...change }; setSounds(next); setSoundSettings(next); };
  useEffect(() => setPreviewError(false), [appearanceBackground?.url]);
  useEffect(()=>{if(query.trim()&&content.current)content.current.scrollTop=0;},[query]);
  useEffect(()=>{
    if(query.trim()||!destination||!content.current)return;
    const container=content.current;let found:HTMLElement|null=null,previousTabIndex:string|null=null;
    const locate=()=>{if(found)return;const match=container.querySelector<HTMLElement>(destination.target);if(!match)return;found=match.closest<HTMLElement>('.yz-setting-row')||match;if(found instanceof HTMLDetailsElement)found.open=true;found.classList.add('yz-setting-search-target');previousTabIndex=found.getAttribute('tabindex');found.setAttribute('tabindex','-1');found.focus({preventScroll:true});found.scrollIntoView({block:'start',behavior:reduceMotion?'auto':'smooth'});observer.disconnect();};
    const observer=new MutationObserver(locate);observer.observe(container,{childList:true,subtree:true});locate();const timer=setTimeout(()=>{observer.disconnect();setDestination(undefined);},2400);
    return()=>{observer.disconnect();clearTimeout(timer);if(found){found.classList.remove('yz-setting-search-target');if(previousTabIndex===null)found.removeAttribute('tabindex');else found.setAttribute('tabindex',previousTabIndex);}};
  },[query,tab,destination,reduceMotion]);

  return <div className="yz-settings-backdrop" onClick={onClose}>
    <div className="yz-settings-modal yz-settings-redesign" role="dialog" aria-modal="true" aria-label="Zenix 选项" onClick={event => event.stopPropagation()}>
      <div className="yz-settings-top">
        <div className="yz-settings-heading"><span>ZENIX / PREFERENCES</span><h2>设置</h2></div>
        <div className="yz-settings-search"><Search size={18}/><input ref={searchInput} type="search" aria-label="搜索设置" placeholder="搜索设置，例如：歌单、快捷键" maxLength={100} value={query} onChange={event=>{setQuery(event.target.value);setDestination(undefined);}} onKeyDown={event=>{if(event.key==='Escape'&&query){event.preventDefault();event.stopPropagation();setQuery('');}}}/>{query&&<button type="button" aria-label="清空设置搜索" onClick={()=>{setQuery('');searchInput.current?.focus();}}><X size={16}/></button>}</div>
        <button className="yz-settings-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>
      </div>
      <div className="yz-settings-workspace">
        <div className="yz-settings-tabs" role="tablist" aria-label="选项分类" onClickCapture={()=>{setQuery('');setDestination(undefined);}} onKeyDown={event=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));const current=buttons.indexOf(document.activeElement as HTMLButtonElement);if(current<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)+buttons.length)%buttons.length;buttons[next]?.focus();buttons[next]?.click();}}>
          {([['options','播放与声音','输出设备 · 音效',Volume2],['appearance','外观','图片 · 动态背景',ImagePlus],['sources','音乐源','来源 · 网络设置',Radio],['devices','设备与快捷键','遥控 · 操作习惯',Keyboard],['library','歌手与专辑','浏览你的音乐',Disc3],['data','资料与更新','备份 · 歌单迁移',Database]] as const).map(([id,label,description,Icon])=><button role="tab" key={id} aria-selected={tab===id} className={tab===id?'is-active':''} onClick={()=>setTab(id)}><Icon size={20}/><span><strong>{label}</strong><small>{description}</small></span></button>)}
        </div>
        <div className="yz-settings-content" ref={content} key={tab}>
      {query.trim()&&<SettingsSearch query={query} choose={entry=>{setTab(entry.tab);setQuery('');setDestination(entry);}}/>}
      <div className="yz-settings-tab-content" hidden={Boolean(query.trim())}>
      {tab === 'options' && <div className="yz-settings-body">
        <div className="yz-settings-intro"><h2>播放与声音</h2><p>选择听歌的方式，调整你习惯的声音。</p></div>
        <DesktopAudioSettings/><div className="tool-actions yz-settings-quick-tools"><MusicToolsButton initial="timer"/><MusicToolsButton initial="widget"/></div>
        <div className="yz-setting-row"><div><strong>减少动效</strong><small>关闭页面间的过渡动画</small></div><button className={`yz-switch ${reduceMotion ? 'is-on' : ''}`} onClick={() => onReduceMotionChange(!reduceMotion)} role="switch" aria-checked={reduceMotion} aria-label="减少动效"><span /></button></div>
        <div className="yz-setting-row"><div><strong>刷新本地曲库</strong><small>重新读取已导入的音乐</small></div><button className="yz-round-button" onClick={() => void onRefreshLibrary?.()} disabled={!onRefreshLibrary || libraryBusy} aria-label="刷新本地曲库"><RefreshCw size={17} /></button></div>
        <div className="yz-setting-row"><div><strong>导入音乐</strong><small>选择本地音乐文件夹</small></div><button className="yz-round-button" onClick={() => void onImportFolder()} disabled={libraryBusy} aria-label="导入音乐"><FolderOpen size={17} /></button></div>
        <div className="yz-setting-row"><div><strong>桌面歌词</strong><small>悬停显示控制；锁定后点击穿透；Aa 可调整字体与颜色</small></div><button className={`yz-switch ${desktopLyricsVisible ? 'is-on' : ''}`} onClick={onToggleDesktopLyrics} disabled={!onToggleDesktopLyrics} role="switch" aria-checked={Boolean(desktopLyricsVisible)} aria-label="桌面歌词"><span /></button></div>
        <div className="yz-setting-row"><div><strong>界面音效</strong><small>进入、取消和滑动贴纸各自独立</small></div><button className={`yz-switch ${sounds.enabled ? 'is-on' : ''}`} onClick={() => { updateSounds({ enabled: !sounds.enabled }); if (!sounds.enabled) playUiSound('enter'); }} role="switch" aria-checked={sounds.enabled} aria-label="界面音效"><span /></button></div>
        {sounds.enabled && <div className="zenix-sound-options"><label className="zenix-sound-volume"><span>音效音量</span><input type="range" min={0} max={1} step={.01} value={sounds.volume} onChange={event => updateSounds({ volume: Number(event.target.value) })} aria-label="音效音量" /><small>{Math.round(sounds.volume * 100)}%</small></label>{(['enter', 'cancel', 'slide'] as SoundKind[]).map(kind => <div className="zenix-sound-choice" key={kind}><span>{kind === 'enter' ? '进入 / 播放' : kind === 'cancel' ? '取消 / 返回' : '滑动贴纸'}</span><GlassSelect label={`${kind}音效音色`} value={String(sounds[kind])} options={[1,2,3,4,5].map(n=>({value:String(n),label:`音色 ${n}`}))} onChange={value=>{updateSounds({[kind]:Number(value)});playUiSound(kind);}}/><button onClick={() => playUiSound(kind)} title={`试听${kind === 'enter' ? '进入' : kind === 'cancel' ? '取消' : '滑动'}音效`} aria-label={`试听${kind === 'enter' ? '进入' : kind === 'cancel' ? '取消' : '滑动'}音效`}><Volume2 size={15} /></button></div>)}</div>}
      </div>}
      {tab === 'appearance' && <div className="yz-settings-body yz-appearance-body">
        <div className="yz-settings-intro"><h2>你的背景</h2><p>让熟悉的画面陪伴每一次聆听。</p></div>
        <div className="yz-appearance-preview">
          {appearanceBackground?.kind === 'image' && !previewError && <img src={appearanceBackground.url} alt="当前自定义背景" onError={() => setPreviewError(true)} />}
          {appearanceBackground?.kind === 'video' && !previewError && <video src={appearanceBackground.url} autoPlay loop muted playsInline aria-label="当前自定义视频背景" onError={() => setPreviewError(true)} />}
          <div className="yz-appearance-preview-veil" />
          <span className="yz-appearance-preview-brand">Zenix<small>{appearanceBackground ? appearanceBackground.kind === 'video' ? '动态背景预览' : '照片背景预览' : '默认动态背景'}</small></span>
          {(!appearanceBackground || previewError) && <Sparkles className="yz-appearance-preview-icon" size={51} strokeWidth={.9} />}
        </div>
        <div className="yz-appearance-file"><strong>{appearanceBackground?.name || '尚未选择背景'}</strong><small>{previewError ? '无法播放或显示此文件，请尝试常见的 H.264 MP4、WebM 或图片格式。' : '开屏、首页、搜索与收藏面板会自动调整明暗和透明度；歌曲贴纸墙保持原貌。'}</small></div>
        <div className="yz-appearance-actions">
          <button className="yz-appearance-choose" onClick={() => void onChooseBackground?.()} disabled={appearanceBusy || !onChooseBackground}><ImagePlus size={16} />{appearanceBackground ? '更换图片或视频' : '选择图片或视频'}</button>
          {appearanceBackground && <button className="yz-appearance-remove" onClick={() => void onClearBackground?.()} disabled={appearanceBusy || !onClearBackground}><Trash2 size={15} />移除背景</button>}
        </div>
      </div>}
      {tab==='data'&&<div className="yz-settings-body"><div data-setting="updates"><UpdateSettings/></div><div data-setting="backup"><BackupSettings pickLocal={()=>Promise.resolve(onImportFolder())}/></div><div className="tool-actions" data-setting="music-tools"><MusicToolsButton/><MusicToolsButton initial="stats"/></div></div>}
      {tab==='devices'&&<div className="yz-settings-body"><DesktopDeviceSettings/><MusicToolsButton initial="widget"/><p data-setting="tray">关闭主窗口后 Zenix 会驻留托盘。完全退出请使用托盘菜单的“退出 Zenix”。</p></div>}
      {tab==='library'&&<div className="yz-settings-body"><CatalogBrowser tracks={tracks} play={(tracks,index)=>{void import('../core/player').then(({player})=>player.playTrack(playableTrack(tracks[index]),tracks.map(playableTrack)));}}/></div>}
      {tab === 'sources' && <div className="yz-settings-body yz-source-body"><SourceSettings /></div>}
      </div>
        </div>
      </div>
    </div>
  </div>;
}
