import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Captions,Database,FolderOpen,ImagePlus,Keyboard,MonitorSmartphone,Radio,RefreshCw,Search,Sparkles,Volume2,X} from 'lucide-react';
import type {AppearanceBackground} from '../core/types';
import {getSoundSettings,playUiSound,setSoundSettings,type SoundKind} from '../core/sounds';
import {DesktopAudioSettings,DesktopDeviceSettings} from './DesktopListeningSettings';
import BackupSettings from './BackupSettings';
import CatalogBrowser from './CatalogBrowser';
import FeatureLauncher from '../features/FeatureLauncher';
import SpaceAppearanceSettings from '../features/space/SpaceAppearanceSettings';
import ThemeSettings from '../features/themes/ThemeSettings';
import GlassSelect from './GlassSelect';
import {MusicToolsButton} from './MusicTools';
import SettingsSearch,{type SettingSearchEntry,type SettingsTab} from './SettingsSearch';
import SourceSettings from './SourceSettings';
import UpdateSettings from './UpdateSettings';
import {useDialogFocus} from './useDialogFocus';
import {playableTrack} from './types';
import '../features/themes/settings-surfaces.css';
import './SettingsModal.css';

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

const tabs = [
  ['playback','播放','声音与歌词',Volume2],
  ['sources','音乐源','来源与缓存',Radio],
  ['space','音乐空间','主题与展示',ImagePlus],
  ['assistant','助手','星音与模型',Sparkles],
  ['devices','设备与下载','遥控与组件',Keyboard],
  ['data','资料与更新','备份与版本',Database],
] as const satisfies readonly (readonly [SettingsTab,string,string,typeof Volume2])[];

function initialCategory(value: SettingsModalProps['initialTab']): SettingsTab {
  if (value === 'sources') return 'sources';
  if (value === 'appearance') return 'space';
  return 'playback';
}

function SettingRow({setting,title,description,status,children,className=''}:{
  setting:string;
  title:string;
  description:string;
  status?:string;
  children?:ReactNode;
  className?:string;
}) {
  return <div className={`yz-setting-row ${className}`.trim()} data-setting={setting}>
    <div className="yz-setting-copy">
      <strong>{title}</strong>
      <small>{description}</small>
      {status && <span className="yz-setting-status">{status}</span>}
    </div>
    {children && <div className="yz-setting-control">{children}</div>}
  </div>;
}

export default function SettingsModal({
  tracks=[],
  initialTab='options',
  reduceMotion,
  libraryBusy,
  appearanceBackground,
  appearanceBusy,
  desktopLyricsVisible,
  onToggleDesktopLyrics,
  onChooseBackground,
  onClearBackground,
  onReduceMotionChange,
  onImportFolder,
  onRefreshLibrary,
  onClose,
}: SettingsModalProps) {
  const [tab,setTab] = useState<SettingsTab>(() => initialCategory(initialTab));
  const [query,setQuery] = useState('');
  const [destination,setDestination] = useState<SettingSearchEntry>();
  const searchInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const dialog = useDialogFocus<HTMLDivElement>(true,onClose);
  const [previewError,setPreviewError] = useState(false);
  const [sounds,setSounds] = useState(getSoundSettings);
  const updateSounds = (change:Partial<typeof sounds>) => {
    const next = {...sounds,...change};
    setSounds(next);
    setSoundSettings(next);
  };

  useEffect(() => setPreviewError(false),[appearanceBackground?.url]);
  useEffect(() => {
    if (query.trim() && content.current) content.current.scrollTop = 0;
  },[query]);

  useEffect(() => {
    if (query.trim() || !destination || !content.current) return;
    const container = content.current;
    let found:HTMLElement|null = null;
    let previousTabIndex:string|null = null;
    const locate = () => {
      if (found) return;
      const match = container.querySelector<HTMLElement>(destination.target);
      if (!match) return;
      found = match.closest<HTMLElement>('[data-setting],.yz-setting-row') || match;
      const details = found.closest<HTMLDetailsElement>('details') || (found instanceof HTMLDetailsElement ? found : match.closest<HTMLDetailsElement>('details'));
      if (details) details.open = true;
      found.classList.add('yz-setting-search-target');
      previousTabIndex = found.getAttribute('tabindex');
      found.setAttribute('tabindex','-1');
      found.focus({preventScroll:true});
      found.scrollIntoView({block:'start',behavior:reduceMotion ? 'auto' : 'smooth'});
      observer.disconnect();
    };
    const observer = new MutationObserver(locate);
    observer.observe(container,{childList:true,subtree:true});
    locate();
    const timer = window.setTimeout(() => {
      observer.disconnect();
      setDestination(undefined);
    },2600);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      if (found) {
        found.classList.remove('yz-setting-search-target');
        if (previousTabIndex === null) found.removeAttribute('tabindex');
        else found.setAttribute('tabindex',previousTabIndex);
      }
    };
  },[query,tab,destination,reduceMotion]);

  return <div className="yz-settings-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div ref={dialog} className="yz-settings-modal yz-settings-redesign" role="dialog" aria-modal="true" aria-labelledby="zenix-settings-title" tabIndex={-1}>
      <header className="yz-settings-top">
        <div className="yz-settings-heading">
          <h2 id="zenix-settings-title">设置</h2>
          <p>找到一项设置，或直接搜索。</p>
        </div>
        <div className="yz-settings-search">
          <Search size={18}/>
          <input ref={searchInput} type="search" aria-label="搜索设置" placeholder="搜索主题、纯歌词、音效或更新" maxLength={100} value={query} onChange={event => {
            setQuery(event.target.value);
            setDestination(undefined);
          }} onKeyDown={event => {
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery('');
            }
          }}/>
          {query && <button type="button" aria-label="清空设置搜索" onClick={() => {
            setQuery('');
            searchInput.current?.focus();
          }}><X size={16}/></button>}
        </div>
        <button className="yz-settings-close" type="button" onClick={onClose} aria-label="关闭设置"><X size={20}/></button>
      </header>

      <div className="yz-settings-workspace">
        <nav className="yz-settings-category-tabs" role="tablist" aria-label="设置分类" onClickCapture={() => {
          setQuery('');
          setDestination(undefined);
        }} onKeyDown={event => {
          if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (current < 0) return;
          event.preventDefault();
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (current + (['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
          buttons[nextIndex]?.focus();
          buttons[nextIndex]?.click();
        }}>
          {tabs.map(([id,label,description,Icon]) => <button type="button" role="tab" key={id} id={`settings-tab-${id}`} aria-selected={tab === id} aria-controls={`settings-panel-${id}`} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
            <Icon size={19}/>
            <span><strong>{label}</strong><small>{description}</small></span>
          </button>)}
        </nav>

        <div className="yz-settings-content" ref={content}>
          {query.trim() ? <SettingsSearch query={query} choose={entry => {
            setTab(entry.tab);
            setQuery('');
            setDestination(entry);
          }}/> : <div className="yz-settings-tab-content" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
            {tab === 'playback' && <div className="yz-settings-body">
              <div className="yz-settings-intro"><h2>播放</h2><p>声音、输出、歌词和本地曲库。</p></div>
              <details className="yz-settings-advanced" data-setting="audio-advanced">
                <summary><span><strong>高级音频</strong><small>输出设备、均衡器与预设</small></span><span className="yz-setting-status">按需展开</span></summary>
                <DesktopAudioSettings/>
              </details>
              <div className="yz-settings-quick-tools"><MusicToolsButton initial="timer"/></div>
              <div className="yz-settings-list">
                <SettingRow setting="pure-lyrics" title="纯歌词" description="当前句与前后各两句；越远越小并降低透明度。" status="五句景深">
                  <Captions size={18}/>
                </SettingRow>
                <SettingRow setting="lyrics" title="歌词显示" description="字号、行距、翻译和当前歌曲的时间校正。" status="跟随主题 / 可校正">
                  <span className="yz-setting-value">主题接管</span>
                </SettingRow>
                <SettingRow setting="desktop-lyrics" title="桌面歌词" description="在其他窗口上方显示同步歌词。" status={desktopLyricsVisible ? '已显示' : '已关闭'}>
                  <button type="button" className={`yz-switch ${desktopLyricsVisible ? 'is-on' : ''}`} onClick={onToggleDesktopLyrics} disabled={!onToggleDesktopLyrics} role="switch" aria-checked={Boolean(desktopLyricsVisible)} aria-label="桌面歌词"><span/></button>
                </SettingRow>
                <SettingRow setting="reduce-motion" title="减少动效" description="缩短页面、设置和歌词切换动画。" status={reduceMotion ? '已减少' : '标准'}>
                  <button type="button" className={`yz-switch ${reduceMotion ? 'is-on' : ''}`} onClick={() => onReduceMotionChange(!reduceMotion)} role="switch" aria-checked={reduceMotion} aria-label="减少动效"><span/></button>
                </SettingRow>
                <SettingRow setting="ui-sounds" title="界面音效" description="播放、返回和滑动贴纸的声音反馈。" status={sounds.enabled ? `音量 ${Math.round(sounds.volume*100)}%` : '已关闭'}>
                  <button type="button" className={`yz-switch ${sounds.enabled ? 'is-on' : ''}`} onClick={() => {
                    updateSounds({enabled:!sounds.enabled});
                    if (!sounds.enabled) playUiSound('enter');
                  }} role="switch" aria-checked={sounds.enabled} aria-label="界面音效"><span/></button>
                </SettingRow>
              </div>
              {sounds.enabled && <details className="yz-settings-advanced">
                <summary><span><strong>音效细节</strong><small>音量与三类操作音色</small></span></summary>
                <div className="zenix-sound-options">
                  <label className="zenix-sound-volume"><span>音效音量</span><input type="range" min={0} max={1} step={.01} value={sounds.volume} onChange={event => updateSounds({volume:Number(event.target.value)})} aria-label="音效音量"/><small>{Math.round(sounds.volume*100)}%</small></label>
                  {(['enter','cancel','slide'] as SoundKind[]).map(kind => <div className="zenix-sound-choice" key={kind}>
                    <span>{kind === 'enter' ? '进入 / 播放' : kind === 'cancel' ? '取消 / 返回' : '滑动贴纸'}</span>
                    <GlassSelect label={`${kind}音效音色`} value={String(sounds[kind])} options={[1,2,3,4,5].map(number => ({value:String(number),label:`音色 ${number}`}))} onChange={value => {
                      updateSounds({[kind]:Number(value)});
                      playUiSound(kind);
                    }}/>
                    <button type="button" onClick={() => playUiSound(kind)} title={`试听${kind === 'enter' ? '进入' : kind === 'cancel' ? '取消' : '滑动'}音效`} aria-label={`试听${kind === 'enter' ? '进入' : kind === 'cancel' ? '取消' : '滑动'}音效`}><Volume2 size={15}/></button>
                  </div>)}
                </div>
              </details>}
              <div className="yz-settings-list">
                <SettingRow setting="refresh-library" title="刷新本地曲库" description="重新读取已导入的音乐文件夹。">
                  <button type="button" className="yz-round-button" onClick={() => void onRefreshLibrary?.()} disabled={!onRefreshLibrary || libraryBusy} aria-label="刷新本地曲库"><RefreshCw size={17}/></button>
                </SettingRow>
                <SettingRow setting="import-music" title="导入音乐" description="选择本地音乐文件夹。">
                  <button type="button" className="yz-round-button" onClick={() => void onImportFolder()} disabled={libraryBusy} aria-label="导入音乐"><FolderOpen size={17}/></button>
                </SettingRow>
              </div>
            </div>}

            {tab === 'sources' && <div className="yz-settings-body">
              <div className="yz-settings-intro"><h2>音乐源</h2><p>管理来源、播放品质、网络权限与离线缓存。</p></div>
              <SourceSettings/>
            </div>}

            {tab === 'space' && <div className="yz-settings-body">
              <div className="yz-settings-intro"><h2>音乐空间</h2><p>主题只改变歌词与视觉，不移动歌曲或歌单。</p></div>
              <ThemeSettings/>
              <div data-setting="space-presentation"><SpaceAppearanceSettings/></div>
              <div className="yz-settings-list">
                <SettingRow setting="simple-list" title="简约列表" description="当前列表沿用贴纸空间的数据契约，以独立黑银 tokens 叠加视觉。" status="紧凑行 · 44px 操作">
                  <MonitorSmartphone size={18}/>
                </SettingRow>
              </div>
              <details className="yz-settings-advanced">
                <summary><span><strong>背景与卡片</strong><small>图片、视频和首页透明度</small></span><span className="yz-setting-status">{appearanceBackground?.name || '默认背景'}</span></summary>
                <div className="yz-appearance-preview">
                  {appearanceBackground?.kind === 'image' && !previewError && <img src={appearanceBackground.url} alt="当前自定义背景" onError={() => setPreviewError(true)}/>}
                  {appearanceBackground?.kind === 'video' && !previewError && <video src={appearanceBackground.url} autoPlay loop muted playsInline aria-label="当前自定义视频背景" onError={() => setPreviewError(true)}/>}
                  <div className="yz-appearance-preview-veil"/>
                  <span className="yz-appearance-preview-brand">Zenix<small>{appearanceBackground ? appearanceBackground.kind === 'video' ? '动态背景' : '照片背景' : '默认背景'}</small></span>
                  {(!appearanceBackground || previewError) && <Sparkles className="yz-appearance-preview-icon" size={42} strokeWidth={.8}/>}
                </div>
                <div className="yz-appearance-file"><strong>{appearanceBackground?.name || '尚未选择背景'}</strong><small>{previewError ? '无法显示此文件，请尝试 H.264 MP4、WebM 或常见图片格式。' : '歌曲贴纸墙保持原貌。'}</small></div>
                <div className="yz-appearance-actions">
                  <button type="button" className="yz-appearance-choose" onClick={() => void onChooseBackground?.()} disabled={appearanceBusy || !onChooseBackground}><ImagePlus size={16}/>{appearanceBackground ? '更换图片或视频' : '选择图片或视频'}</button>
                  {appearanceBackground && <button type="button" className="yz-appearance-remove" onClick={() => void onClearBackground?.()} disabled={appearanceBusy || !onClearBackground}>移除背景</button>}
                </div>
              </details>
            </div>}

            {tab === 'assistant' && <div className="yz-settings-body">
              <div className="yz-settings-intro"><h2>助手</h2><p>星音的外观、语音、远程模型与本地音乐指令集中在音乐工作台。</p></div>
              <div className="yz-settings-list">
                <SettingRow setting="assistant" title="音乐助手" description="打开星音助手、皮肤、语音、桌宠与远程模型设置。" status="独立工作台">
                  <FeatureLauncher/>
                </SettingRow>
              </div>
            </div>}

            {tab === 'devices' && <div className="yz-settings-body">
              <div className="yz-settings-intro"><h2>设备与下载</h2><p>遥控、快捷键、桌面组件和离线内容入口。</p></div>
              <DesktopDeviceSettings/>
              <div className="yz-settings-quick-tools" data-setting="widget"><MusicToolsButton initial="widget"/></div>
              <p className="yz-settings-note" data-setting="tray">关闭主窗口后 Zenix 会驻留托盘。完全退出请使用托盘菜单的“退出 Zenix”。</p>
            </div>}

            {tab === 'data' && <div className="yz-settings-body">
              <div className="yz-settings-intro"><h2>资料与更新</h2><p>备份、迁移、版本和已收录的歌手与专辑。</p></div>
              <div data-setting="updates"><UpdateSettings/></div>
              <div data-setting="backup"><BackupSettings pickLocal={() => Promise.resolve(onImportFolder())}/></div>
              <div className="tool-actions" data-setting="music-tools"><MusicToolsButton/><MusicToolsButton initial="stats"/></div>
              <details className="yz-settings-advanced" data-setting="library">
                <summary><span><strong>歌手与专辑</strong><small>浏览已收录的音乐</small></span></summary>
                <CatalogBrowser tracks={tracks} play={(items,index) => {
                  void import('../core/player').then(({player}) => player.playTrack(playableTrack(items[index]),items.map(playableTrack)));
                }}/>
              </details>
            </div>}
          </div>}
        </div>
      </div>
    </div>
  </div>;
}
