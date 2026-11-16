import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Captions,Database,Disc3,FolderOpen,ImagePlus,Keyboard,MonitorSmartphone,Search,Settings2,Sparkles,Trash2,Volume2,X} from 'lucide-react';
import {version as appVersion} from '../../package.json';
import {command,isAndroid,mobilePlatform,supportsOverlay,type MobileSnapshot,type MobileUpdate} from './native';
import {MobileAudioSettings,MobileRemoteSettings} from './ListeningSettings';
import {MusicToolsButton,type ToolInvoke} from '../ui/MusicTools';
import BackupSettings from '../ui/BackupSettings';
import UpdateSettings from '../ui/UpdateSettings';
import CatalogBrowser from '../ui/CatalogBrowser';
import GlassSelect from '../ui/GlassSelect';
import LyricControls from '../ui/LyricControls';
import {useLyricDisplay,type LyricDisplay} from '../core/listening';
import {SettingsSearchResults,type SearchableSetting} from '../ui/SettingsSearch';
import type {Track} from '../core/types';
import SpaceAppearanceSettings from '../features/space/SpaceAppearanceSettings';
import FeatureLauncher from '../features/FeatureLauncher';
import ThemeSettings from '../features/themes/ThemeSettings';
import '../features/themes/settings-surfaces.css';
import './MobileSettings.css';

const tools:ToolInvoke = args => command('features',args);
type Category = 'playback' | 'sources' | 'space' | 'assistant' | 'devices' | 'data';
type Entry = SearchableSetting & {
  key: Category;
  target: string;
  android?:boolean;
  overlay?:boolean;
};

const categoryIds = new Set<Category>(['playback','sources','space','assistant','devices','data']);
const entries:readonly Entry[] = [
  {title:'音乐源管理',category:'音乐源',description:'导入、分享和排列音乐源',keywords:'HTTP 网络 配置 平台 打包 来源',key:'sources',target:''},
  {title:'播放品质与缓存',category:'播放',description:'音质、完整缓存、容量及离线播放',keywords:'无损 flac 音质 自动 下载 清理 缓存',key:'playback',target:'cache'},
  {title:'均衡器与声音预设',category:'播放',description:'原声、人声、低音及自定义频段',keywords:'EQ 声音 音效',key:'playback',target:'eq',android:true},
  {title:'睡眠定时器',category:'播放',description:'倒计时或指定时间停止播放',keywords:'停止 定时 关闭',key:'playback',target:'tools'},
  {title:'纯歌词',category:'播放',description:'当前句与前后各两句，越远越小并淡出',keywords:'纯净 歌词 五句 缩放 移动布局',key:'playback',target:'pure-lyrics'},
  {title:'歌词校正与显示',category:'播放',description:'校正当前歌曲时间、字号、行距与翻译',keywords:'歌词 偏移 时间 字重 翻译 颜色',key:'playback',target:'lyric-display'},
  {title:'悬浮歌词',category:'播放',description:'跨应用歌词、字体、颜色和布局',keywords:'歌词 授权 锁定 字号 桌面',key:'playback',target:'overlay',overlay:true},
  {title:'歌词主题',category:'音乐空间',description:'黑胶夜、影院幕布、CD 机、极简留白及本地主题',keywords:'主题 皮肤 theme 纯歌词 导入 背景',key:'space',target:'themes'},
  {title:'音乐空间展示',category:'音乐空间',description:'贴纸拼贴与简约列表',keywords:'歌曲 展示 风格 贴纸 列表 卡片',key:'space',target:'space-presentation'},
  {title:'背景与外观',category:'音乐空间',description:'图片、动态视频和首页卡片透明度',keywords:'主题 壁纸 背景 卡片',key:'space',target:'appearance'},
  {title:'简约列表视觉',category:'音乐空间',description:'黑白中性底、黑银边框与 44px 操作',keywords:'列表 歌曲 样式 银边',key:'space',target:'simple-list'},
  {title:'音乐助手',category:'助手',description:'打开星音助手、皮肤、语音和远程模型设置',keywords:'星音 AI 桌宠 悬浮 语音',key:'assistant',target:'assistant'},
  {title:'歌单分享与迁移',category:'资料与更新',description:'平台歌单链接、文本导入、歌单文件与局域网迁移',keywords:'转移 歌单 导出 导入 平台 分享 LAN IP',key:'data',target:'tools'},
  {title:'听歌统计与回忆',category:'资料与更新',description:'聆听时长和音乐回忆卡',keywords:'回忆卡 统计 排行 记录',key:'data',target:'tools'},
  {title:'资料备份与恢复',category:'资料与更新',description:'备份喜欢、收藏、歌单等资料',keywords:'数据 迁移 备份 恢复',key:'data',target:'backup',android:true},
  {title:'应用更新',category:'资料与更新',description:'检查更新、自动下载和安装',keywords:'版本 更新 升级 正式 预览',key:'data',target:'updates'},
  {title:'遥控电脑播放',category:'设备与下载',description:'应用内配对电脑，控制播放、进度和音量',keywords:'遥控 PC 手机 IP 连接 配对 局域网',key:'devices',target:'remote',android:true},
  {title:'系统声音与输出',category:'设备与下载',description:'打开系统声音设置，管理耳机与扬声器',keywords:'输出 蓝牙 耳机 扬声器 音量',key:'devices',target:'system-output',android:true},
  {title:'桌面音乐组件',category:'设备与下载',description:'将播放控制和歌曲信息放到桌面',keywords:'小组件 小窗 3x3 4x2',key:'devices',target:'widget'},
  {title:'歌手与专辑',category:'资料与更新',description:'浏览已收录的歌手、专辑与歌曲',keywords:'艺术家 唱片 本地 收藏',key:'data',target:'catalog'},
];

type Props = {
  state:MobileSnapshot;
  category:string;
  setCategory:(value:string)=>void;
  act:<T=unknown>(action:string,args?:Record<string,unknown>)=>Promise<T|undefined>;
  accept:(value:MobileUpdate)=>void;
  source:()=>void;
  transparency:number;
  changeTransparency:(value:number)=>void;
  clearCache:()=>void;
  licenses:(text:string)=>void;
  play:(track:Track,tracks:Track[])=>void;
};

export default function MobileSettings({
  state,
  category,
  setCategory,
  act,
  accept,
  source,
  transparency,
  changeTransparency,
  clearCache,
  licenses,
  play,
}:Props) {
  const activeCategory:Category = categoryIds.has(category as Category) ? category as Category : 'playback';
  const [query,setQuery] = useState('');
  const [target,setTarget] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const searching = Boolean(query.trim());
  const profile = state.profile || {name:'Zenix',bio:''};
  const player = state.playback;
  const background = state.appearance?.background;
  const [lyric,changeLyric] = useLyricDisplay(player.track,profile.lyricSize || 26);

  const lyrics = (patch:Partial<LyricDisplay>) => {
    changeLyric(patch);
    if (patch.offset !== undefined && player.track) void act('lyricsConfigure',{id:player.track.id,offset:patch.offset});
  };

  useEffect(() => {
    if (searching) root.current?.scrollIntoView({block:'start',behavior:'auto'});
  },[searching]);

  useEffect(() => {
    if (query.trim() || !target) return;
    const element = root.current?.querySelector<HTMLElement>(`[data-mobile-setting="${target}"]`);
    if (!element) return;
    const details = element.closest<HTMLDetailsElement>('details') || element.querySelector<HTMLDetailsElement>('details');
    if (details) details.open = true;
    element.classList.add('is-search-target');
    const previousTabIndex = element.getAttribute('tabindex');
    element.setAttribute('tabindex','-1');
    element.focus({preventScroll:true});
    element.scrollIntoView({block:'start',behavior:'auto'});
    const timer = window.setTimeout(() => setTarget(''),2600);
    return () => {
      window.clearTimeout(timer);
      element.classList.remove('is-search-target');
      if (previousTabIndex === null) element.removeAttribute('tabindex');
      else element.setAttribute('tabindex',previousTabIndex);
    };
  },[activeCategory,query,target]);

  const choose = (entry:Entry) => {
    search.current?.blur();
    setQuery('');
    if (entry.key === 'sources') {
      source();
      return;
    }
    setCategory(entry.key);
    setTarget(entry.target);
  };

  const selectCategory = (next:Category) => {
    if (next === 'sources') {
      source();
      return;
    }
    setCategory(next);
    setQuery('');
    setTarget('');
  };

  return <section ref={root} className="mobile-settings">
    <div className="section-heading">
      <div><h1>设置</h1><p>找到一项设置，或直接搜索。</p></div>
    </div>
    <div className="mobile-settings-search">
      <Search size={18}/>
      <input ref={search} type="search" aria-label="搜索设置" placeholder="搜索主题、纯歌词、音效或更新" value={query} maxLength={100} onChange={event => {
        setQuery(event.target.value);
        setTarget('');
      }} onKeyDown={event => {
        if (event.key === 'Escape' && query) {
          event.stopPropagation();
          setQuery('');
        }
      }}/>
      {query && <button type="button" aria-label="清空设置搜索" onClick={() => {
        setQuery('');
        search.current?.focus();
      }}><X size={17}/></button>}
    </div>
    <nav className="listening-settings-tabs" aria-label="设置分类">
      {([
        ['playback','播放',Volume2],
        ['sources','音乐源',Settings2],
        ['space','音乐空间',ImagePlus],
        ['assistant','助手',Sparkles],
        ['devices','设备与下载',Keyboard],
        ['data','资料与更新',Database],
      ] as const).map(([key,label,Icon]) => <button type="button" aria-pressed={activeCategory === key} className={activeCategory === key ? 'is-active' : ''} key={key} onClick={() => selectCategory(key)}>
        <Icon size={18}/><span>{label}</span>
      </button>)}
    </nav>

    {query.trim() && <SettingsSearchResults query={query} items={entries.filter(entry => (!entry.android || isAndroid) && (!entry.overlay || supportsOverlay))} choose={choose}/>}

    {!query.trim() && <div className="mobile-settings-content">
      {activeCategory === 'playback' && <>
        <div className="mobile-settings-tools" data-mobile-setting="tools">
          <MusicToolsButton initial="timer" personal={state.personal} invoke={tools} platform={mobilePlatform}/>
        </div>
        <section className="settings-card" data-mobile-setting="cache">
          <div className="mobile-setting-heading"><div><h3>音乐与缓存</h3><p>播放品质和离线内容。</p></div><span>{player.quality === 'lossless' ? '优先无损' : '自动降级'}</span></div>
          <button type="button" className="mobile-settings-link" onClick={source}><Settings2/>管理音乐源<ArrowRight/></button>
          <div className="mobile-settings-field"><span>播放品质</span><GlassSelect label="播放品质" value={player.quality || 'high'} options={[{value:'high',label:'优先高品质，自动降级'},{value:'lossless',label:'优先无损，自动降级'}]} onChange={quality => void act('mode',{quality})}/></div>
          <div className="mobile-setting-row"><div><strong>自动缓存</strong><small>完整缓存可离线播放；HLS 暂不保证整首离线。</small></div><button type="button" className={`toggle ${state.cache.enabled ? 'on' : ''}`} aria-label="自动缓存" aria-pressed={state.cache.enabled} onClick={() => void act('cacheConfigure',{enabled:!state.cache.enabled})}><span/></button></div>
          <div className="mobile-settings-field"><span>缓存上限</span><GlassSelect label="缓存上限" value={String(state.cache.limitMiB)} options={[128,256,512,1024,2048].map(value => ({value:String(value),label:`${value} MiB`}))} onChange={value => void act('cacheConfigure',{limitMiB:Number(value)})}/></div>
          <div className="mobile-setting-data"><span>已用 {(state.cache.usedBytes/1024/1024).toFixed(1)} MiB</span><span>自动清理旧缓存</span>{state.cache.metadataLimitMiB && <span>歌词缓存 {((state.cache.metadataBytes||0)/1024/1024).toFixed(1)} / {state.cache.metadataLimitMiB} MiB</span>}</div>
          <div className="mobile-settings-actions"><button type="button" onClick={clearCache}><Trash2/>清理缓存</button><button type="button" onClick={() => void act('pickLocal')}><FolderOpen/>导入本地歌曲</button></div>
        </section>
        {isAndroid && <details className="mobile-settings-advanced" data-mobile-setting="eq">
          <summary><span><strong>均衡器与声音预设</strong><small>按设备与耳机调整频段</small></span></summary>
          <MobileAudioSettings value={player.audioSettings}/>
        </details>}
        <section className="settings-card" data-mobile-setting="pure-lyrics">
          <div className="mobile-setting-heading"><div><h3>纯歌词</h3><p>当前句与前后各两句；越远越小并降低透明度。</p></div><span>五句景深</span></div>
          <div className="mobile-setting-row"><div><strong>当前句</strong><small>居中滚动，切句时可中断上一段过渡。</small></div><Captions size={19}/></div>
        </section>
        <section className="settings-card" data-mobile-setting="lyric-display">
          <div className="mobile-setting-heading"><div><h3>歌词显示</h3><p>{player.track ? `当前歌曲：${player.track.title}` : '播放歌曲后可校正当前版本。'}</p></div><Captions size={19}/></div>
          {player.track && <LyricControls value={lyric} change={lyrics}/>}
          <label>默认字体大小<input type="range" min={18} max={38} value={profile.lyricSize || 26} onChange={event => void act('profile',{...profile,lyricSize:+event.target.value})}/></label>
          <label>歌词颜色<input type="color" value={profile.lyricColor || '#c5e9ff'} onChange={event => void act('profile',{...profile,lyricColor:event.target.value})}/></label>
        </section>
        {supportsOverlay && <details className="mobile-settings-advanced" data-mobile-setting="overlay">
          <summary><span><strong>悬浮歌词</strong><small>在其他应用上方显示歌词</small></span><span>{state.overlay?.enabled ? '已开启' : '已关闭'}</span></summary>
          <p>锁定后只有小锁按钮接收触摸。</p>
          <button type="button" className="pill" onClick={async () => {
            if (!state.overlay?.enabled) await act('notifications');
            await act('overlayEnable',{enabled:!state.overlay?.enabled});
          }}><Captions/>{state.overlay?.enabled ? '关闭悬浮歌词' : state.overlay?.permitted ? '打开悬浮歌词' : '授权并打开悬浮歌词'}</button>
          <label>字号<input aria-label="悬浮歌词字号" type="range" min={14} max={30} value={state.overlay?.fontSize || 20} onChange={event => void act('overlayConfigure',{fontSize:+event.target.value})}/></label>
          <label>颜色<input aria-label="悬浮歌词颜色" type="color" value={state.overlay?.color || '#c5e9ff'} onChange={event => void act('overlayConfigure',{color:event.target.value})}/></label>
          <div className="mobile-settings-field"><span>字体</span><GlassSelect label="悬浮歌词字体" value={state.overlay?.font || 'sans-serif-medium'} options={[{value:'sans-serif-medium',label:'无衬线'},{value:'serif',label:'衬线'},{value:'monospace',label:'等宽'}]} onChange={font => void act('overlayConfigure',{font})}/></div>
          <div className="mobile-settings-field"><span>布局</span><GlassSelect label="悬浮歌词布局" value={state.overlay?.compact ? 'compact' : 'standard'} options={[{value:'standard',label:'标准三行'},{value:'compact',label:'紧凑三行'}]} onChange={layout => void act('overlayConfigure',{compact:layout === 'compact'})}/></div>
        </details>}
      </>}

      {activeCategory === 'assistant' && <section className="settings-card" data-mobile-setting="assistant">
        <div className="mobile-setting-heading"><div><h3>音乐助手</h3><p>星音外观、语音、桌宠和远程模型设置集中在音乐工作台。</p></div><Sparkles size={19}/></div>
        <FeatureLauncher mobileSnapshot={state}/>
      </section>}

      {activeCategory === 'space' && <>
        <ThemeSettings/>
        <div data-mobile-setting="space-presentation"><SpaceAppearanceSettings allowOrbit={false}/></div>
        <section className="settings-card" data-mobile-setting="simple-list">
          <div className="mobile-setting-heading"><div><h3>简约列表</h3><p>沿用独立黑白银边 tokens，保留 44px 播放与管理操作。</p></div><span>紧凑行</span></div>
        </section>
        <section className="settings-card" data-mobile-setting="appearance">
          <div className="mobile-setting-heading"><div><h3>背景与外观</h3><p>{background?.name || '默认中性背景'}</p></div><ImagePlus size={19}/></div>
          <label htmlFor="card-transparency">卡片透明度<output>{transparency}%</output></label>
          <input id="card-transparency" type="range" min={0} max={90} step={5} value={transparency} onChange={event => changeTransparency(+event.target.value)}/>
          <div className="mobile-settings-actions"><button type="button" onClick={() => void act('pickBackground')}><ImagePlus/>选择图片或视频</button>{background && <button type="button" onClick={() => void act('clearBackground')}>恢复默认背景</button>}</div>
        </section>
      </>}

      {activeCategory === 'devices' && <>
        {isAndroid && <div data-mobile-setting="remote"><MobileRemoteSettings/></div>}
        <section className="settings-card" data-mobile-setting="widget">
          <div className="mobile-setting-heading"><div><h3>桌面音乐组件</h3><p>把播放控制与歌曲信息放到桌面。</p></div><MonitorSmartphone size={19}/></div>
          <MusicToolsButton initial="widget" personal={state.personal} invoke={tools} platform={mobilePlatform}/>
        </section>
        <section className="settings-card" data-mobile-setting="system-output">
          <div className="mobile-setting-heading"><div><h3>系统声音与输出</h3><p>蓝牙、耳机与扬声器由系统管理。</p></div><Volume2 size={19}/></div>
          {isAndroid && <button type="button" onClick={() => void act('systemSoundSettings')}>打开系统声音设置<ArrowRight/></button>}
        </section>
      </>}

      {activeCategory === 'data' && <>
        <div data-mobile-setting="backup"><BackupSettings invoke={tools} disabled={!isAndroid} browser={() => ({profile:{},transparency})} changed={async () => accept(await command<MobileSnapshot>('snapshot'))} pickLocal={() => command('pickLocal')}/></div>
        <section className="settings-card" data-mobile-setting="updates">
          <UpdateSettings/>
          <div className="mobile-setting-data"><span>Zenix {mobilePlatform}</span><span>{appVersion} · GPL-3.0</span></div>
          <button type="button" onClick={async() => {
            const text = await act<string>('licenses');
            if (text) licenses(text);
          }}>开源许可与致谢<ArrowRight/></button>
          <p>音乐源与资料保存在应用私有目录。</p>
        </section>
        <div className="tool-actions mobile-settings-tools" data-mobile-setting="tools">
          {(['share','stats'] as const).map(tool => <MusicToolsButton key={tool} initial={tool} personal={state.personal} invoke={tools} platform={mobilePlatform}/>)}
        </div>
        <details className="mobile-settings-advanced" data-mobile-setting="catalog">
          <summary><span><strong>歌手与专辑</strong><small>浏览已收录的歌手、专辑与歌曲</small></span><Disc3 size={18}/></summary>
          <CatalogBrowser tracks={[...(state.localTracks || []),...state.personal.liked,...state.personal.favorites,...state.personal.history.map(item => item.track),...player.queue]} play={(tracks,index) => play(tracks[index] as Track,tracks as Track[])}/>
        </details>
      </>}
    </div>}
  </section>;
}
