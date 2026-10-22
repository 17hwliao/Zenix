import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Captions,Database,Disc3,FolderOpen,ImagePlus,MonitorSmartphone,Search,Settings2,Trash2,Volume2,X} from 'lucide-react';
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
import './MobileSettings.css';
import FeatureLauncher from '../features/FeatureLauncher';

const tools:ToolInvoke=args=>command('features',args);
type Category='playback'|'lyrics'|'appearance'|'data'|'devices'|'library';
type Entry=SearchableSetting&{key:Category|'sources';target:string;android?:boolean;overlay?:boolean};
const entries:Entry[]=[
  {title:'音乐源管理',category:'播放',description:'导入、分享和排列音乐源',keywords:'HTTP 网络 配置 平台 打包',key:'sources',target:''},
  {title:'播放品质与缓存',category:'播放',description:'音质、完整缓存、容量及离线播放',keywords:'无损 flac 音质 自动 清理 缓存',key:'playback',target:'cache'},
  {title:'均衡器与声音预设',category:'播放',description:'原声、人声、低音及自定义频段',keywords:'EQ 声音 音效',key:'playback',target:'eq',android:true},
  {title:'睡眠定时器',category:'播放',description:'倒计时或指定时间停止播放',keywords:'停止 定时 关闭',key:'playback',target:'tools'},
  {title:'桌面音乐组件',category:'播放',description:'系统桌面的音乐控制小组件',keywords:'小窗 小组件 3x3 4x2',key:'playback',target:'tools'},
  {title:'歌词校正与显示',category:'歌词',description:'校正当前歌曲时间、字号、行距与翻译',keywords:'歌词 偏移 时间 字重 翻译',key:'lyrics',target:'lyric-display'},
  {title:'悬浮歌词',category:'歌词',description:'跨应用歌词、字体、颜色和布局',keywords:'歌词 授权 锁定 字号',key:'lyrics',target:'overlay',overlay:true},
  {title:'背景与外观',category:'外观',description:'图片、动态视频和首页卡片透明度',keywords:'主题 壁纸 背景 卡片',key:'appearance',target:'appearance'},
  {title:'歌单分享与迁移',category:'资料与更新',description:'QQ、网易云、酷我歌单链接、文本导入、歌单文件与局域网迁移',keywords:'转移 歌单 导出 导入 平台 分享 LAN IP',key:'data',target:'tools'},
  {title:'听歌统计与回忆',category:'资料与更新',description:'聆听时长和音乐回忆卡',keywords:'回忆卡 统计 排行 记录',key:'data',target:'tools'},
  {title:'资料备份与恢复',category:'资料与更新',description:'备份喜欢、收藏、歌单等资料',keywords:'数据 迁移 备份 恢复',key:'data',target:'backup',android:true},
  {title:'应用更新',category:'资料与更新',description:'检查更新、自动下载和安装',keywords:'版本 更新 升级 正式 预览',key:'data',target:'updates'},
  {title:'遥控电脑播放',category:'设备连接',description:'应用内配对电脑，控制播放、进度和音量',keywords:'遥控 PC 手机 IP 连接 配对 局域网',key:'devices',target:'remote',android:true},
  {title:'系统声音与输出',category:'设备连接',description:'打开系统声音设置，管理耳机与扬声器',keywords:'输出 蓝牙 耳机 扬声器 音量',key:'devices',target:'system-output',android:true},
  {title:'歌手与专辑',category:'歌手与专辑',description:'浏览已收录的歌手、专辑与歌曲',keywords:'艺术家 唱片 本地 收藏',key:'library',target:'catalog'},
];
type Props={state:MobileSnapshot;category:string;setCategory:(value:string)=>void;act:<T=unknown>(action:string,args?:Record<string,unknown>)=>Promise<T|undefined>;accept:(value:MobileUpdate)=>void;source:()=>void;transparency:number;changeTransparency:(value:number)=>void;clearCache:()=>void;licenses:(text:string)=>void;play:(track:Track,tracks:Track[])=>void};
export default function MobileSettings({state,category,setCategory,act,accept,source,transparency,changeTransparency,clearCache,licenses,play}:Props){
  const [query,setQuery]=useState(''),[target,setTarget]=useState(''),search=useRef<HTMLInputElement>(null),root=useRef<HTMLElement>(null);
  const searching=Boolean(query.trim());
  useEffect(()=>{if(searching)root.current?.scrollIntoView({block:'start',behavior:'auto'});},[searching]);
  const profile=state.profile||{name:'Zenix',bio:''},player=state.playback,background=state.appearance?.background;
  const [lyric,changeLyric]=useLyricDisplay(player.track,profile.lyricSize||26);
  function lyrics(patch:Partial<LyricDisplay>){changeLyric(patch);if(patch.offset!==undefined&&player.track)void act('lyricsConfigure',{id:player.track.id,offset:patch.offset});}
  useEffect(()=>{if(query.trim()||!target)return;const frame=requestAnimationFrame(()=>{const element=root.current?.querySelector<HTMLElement>(`[data-mobile-setting="${target}"]`);if(target==='eq'||target==='lyric-display'){const details=element?.querySelector('details');if(details)details.open=true;}element?.scrollIntoView({block:'start',behavior:'auto'});});const timer=setTimeout(()=>setTarget(''),2400);return()=>{cancelAnimationFrame(frame);clearTimeout(timer);};},[category,query,target]);
  const choose=(entry:Entry)=>{search.current?.blur();setQuery('');if(entry.key==='sources'){source();return;}setCategory(entry.key);setTarget(entry.target);};
  return <section ref={root} className="mobile-settings"><div className="section-heading"><div><small>ZENIX / PREFERENCES</small><h1>播放器设置</h1></div></div>
    <div className="mobile-settings-search"><Search size={18}/><input ref={search} type="search" aria-label="搜索设置" placeholder="搜索设置、歌词、歌单…" value={query} maxLength={100} onChange={event=>{setQuery(event.target.value);setTarget('');}} onKeyDown={event=>{if(event.key==='Escape'&&query){event.stopPropagation();setQuery('');}}}/>{query&&<button aria-label="清空设置搜索" onClick={()=>{setQuery('');search.current?.focus();}}><X size={17}/></button>}</div>
    <nav className="listening-settings-tabs" aria-label="设置分类">{([['playback','播放',Volume2],['lyrics','歌词',Captions],['appearance','外观',ImagePlus],['data','资料与更新',Database],['devices','设备连接',MonitorSmartphone],['library','歌手与专辑',Disc3]] as const).map(([key,label,Icon])=><button aria-pressed={category===key} className={category===key?'is-active':''} key={key} onClick={()=>{setCategory(key);setQuery('');setTarget('');}}><Icon size={18}/><span>{label}</span></button>)}</nav>
    {query.trim()&&<SettingsSearchResults query={query} items={entries.filter(entry=>(!entry.android||isAndroid)&&(!entry.overlay||supportsOverlay))} choose={choose}/>}
    <div hidden={Boolean(query.trim())} className={target?'mobile-settings-located':''} data-target={target}>
      <div className="mobile-settings-tools"><FeatureLauncher mobileSnapshot={state}/></div>
      {(category==='playback'||category==='data')&&<div className="tool-actions mobile-settings-tools" data-mobile-setting="tools">{(['share','stats','timer','widget'] as const).map(tool=><MusicToolsButton key={tool} initial={tool} personal={state.personal} invoke={tools} platform={mobilePlatform}/>)}</div>}
      {category==='playback'&&<div className="settings-card" data-mobile-setting="cache"><h3>音乐与缓存</h3><button className="mobile-settings-link" onClick={source}><Settings2/>管理音乐源<ArrowRight/></button><div className="mobile-settings-field"><span>播放品质</span><GlassSelect label="播放品质" value={player.quality||'high'} options={[{value:'high',label:'优先高品质，自动降级'},{value:'lossless',label:'优先无损，自动降级'}]} onChange={quality=>void act('mode',{quality})}/></div><label>自动缓存<button className={`toggle ${state.cache.enabled?'on':''}`} aria-label="自动缓存" aria-pressed={state.cache.enabled} onClick={()=>void act('cacheConfigure',{enabled:!state.cache.enabled})}><span/></button></label><div className="mobile-settings-field"><span>缓存上限</span><GlassSelect label="缓存上限" value={String(state.cache.limitMiB)} options={[128,256,512,1024,2048].map(value=>({value:String(value),label:`${value} MiB`}))} onChange={value=>void act('cacheConfigure',{limitMiB:Number(value)})}/></div><p>完整缓存可离线播放；未听完通常只有部分片段，HLS 暂不保证整首离线。</p><p>已用 {(state.cache.usedBytes/1024/1024).toFixed(1)} MiB · 自动清理旧缓存</p>{state.cache.metadataLimitMiB&&<p>歌词缓存 {((state.cache.metadataBytes||0)/1024/1024).toFixed(1)} / {state.cache.metadataLimitMiB} MiB</p>}<div className="mobile-settings-actions"><button onClick={clearCache}><Trash2/>清理缓存</button><button onClick={()=>void act('pickLocal')}><FolderOpen/>导入本地歌曲</button></div></div>}
      {category==='playback'&&isAndroid&&<div data-mobile-setting="eq"><MobileAudioSettings value={player.audioSettings}/></div>}
      {category==='lyrics'&&supportsOverlay&&<div className="settings-card" data-mobile-setting="overlay"><h3>悬浮歌词</h3><p>在其他应用上显示歌词；锁定后只有小锁按钮接收触摸。</p><button className="pill" onClick={async()=>{if(!state.overlay?.enabled)await act('notifications');await act('overlayEnable',{enabled:!state.overlay?.enabled});}}><Captions/>{state.overlay?.enabled?'关闭悬浮歌词':state.overlay?.permitted?'打开悬浮歌词':'授权并打开悬浮歌词'}</button><label>字号<input aria-label="悬浮歌词字号" type="range" min={14} max={30} value={state.overlay?.fontSize||20} onChange={event=>void act('overlayConfigure',{fontSize:+event.target.value})}/></label><label>颜色<input aria-label="悬浮歌词颜色" type="color" value={state.overlay?.color||'#c5e9ff'} onChange={event=>void act('overlayConfigure',{color:event.target.value})}/></label><div className="mobile-settings-field"><span>字体</span><GlassSelect label="悬浮歌词字体" value={state.overlay?.font||'sans-serif-medium'} options={[{value:'sans-serif-medium',label:'无衬线'},{value:'serif',label:'衬线'},{value:'monospace',label:'等宽'}]} onChange={font=>void act('overlayConfigure',{font})}/></div><div className="mobile-settings-field"><span>布局</span><GlassSelect label="悬浮歌词布局" value={state.overlay?.compact?'compact':'standard'} options={[{value:'standard',label:'标准三行'},{value:'compact',label:'紧凑三行'}]} onChange={layout=>void act('overlayConfigure',{compact:layout==='compact'})}/></div></div>}
      {category==='lyrics'&&<div className="settings-card" data-mobile-setting="lyric-display"><h3>应用内歌词</h3><p>{player.track?`当前歌曲：${player.track.title}`:'播放歌曲后可校正当前歌曲的歌词时间。'}</p>{player.track&&<LyricControls value={lyric} change={lyrics}/>}<label>默认字体大小<input type="range" min={18} max={38} value={profile.lyricSize||26} onChange={event=>void act('profile',{...profile,lyricSize:+event.target.value})}/></label><label>歌词颜色<input type="color" value={profile.lyricColor||'#c5e9ff'} onChange={event=>void act('profile',{...profile,lyricColor:event.target.value})}/></label></div>}
      {category==='appearance'&&<div data-mobile-setting="appearance"><div className="settings-card"><h3>首页卡片</h3><label htmlFor="card-transparency">卡片透明度<output>{transparency}%</output></label><input id="card-transparency" type="range" min={0} max={90} step={5} value={transparency} onChange={event=>changeTransparency(+event.target.value)}/></div><div className="settings-card"><h3>个性背景</h3><p>{background?.name||'默认深蓝宇宙'}</p><button className="pill" onClick={()=>void act('pickBackground')}><ImagePlus/>选择图片或视频</button>{background&&<button onClick={()=>void act('clearBackground')}>恢复默认背景</button>}</div></div>}
      {category==='data'&&<><div data-mobile-setting="backup"><BackupSettings invoke={tools} disabled={!isAndroid} browser={()=>({profile:{},transparency})} changed={async()=>accept(await command<MobileSnapshot>('snapshot'))} pickLocal={()=>command('pickLocal')}/></div><div className="settings-card" data-mobile-setting="updates"><UpdateSettings/><h3>Zenix {mobilePlatform}</h3><p>{appVersion} · GPL-3.0</p><button onClick={async()=>{const text=await act<string>('licenses');if(text)licenses(text);}}>开源许可与致谢<ArrowRight/></button><p>音乐源与资料保存在应用私有目录。</p></div></>}
      {category==='devices'&&<>{isAndroid&&<MobileRemoteSettings/>}<div className="settings-card" data-mobile-setting="system-output"><h3>系统声音与输出</h3><p>蓝牙、耳机与扬声器由系统管理。手机播放控制也可通过通知栏、锁屏和耳机媒体按键使用。</p>{isAndroid&&<button onClick={()=>void act('systemSoundSettings')}>打开系统声音设置<ArrowRight/></button>}</div></>}
      {category==='library'&&<div data-mobile-setting="catalog"><CatalogBrowser tracks={[...(state.localTracks||[]),...state.personal.liked,...state.personal.favorites,...state.personal.history.map(item=>item.track),...player.queue]} play={(tracks,index)=>play(tracks[index] as Track,tracks as Track[])}/></div>}
    </div>
  </section>;
}
