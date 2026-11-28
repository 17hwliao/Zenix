import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Heart,Play,SlidersHorizontal,X} from 'lucide-react';
import {appearanceKey,defaults,readAppearance,saveAppearance,styles,type Appearance} from '../../../public/ui/appearance.js';
import UiSoundSettings from '../../ui/UiSoundSettings';
import './application-style-settings.css';

export const styleNames = {default:'Default',glass:'Glass',neon:'Neon',paper:'Paper',sharp:'Sharp'};
const styleLabels = {default:'暗格经典',glass:'玻璃拟态',neon:'霓虹赛博',paper:'纸墨温润',sharp:'硬朗折角'};
const colors = [{id:'cyan',name:'Zenbot 冰青',color:'#38bdf8'},{id:'red',name:'Bento 绯红',color:'#e63946'},{id:'orange',name:'暖橙',color:'#f97316'},{id:'blue',name:'深海电蓝',color:'#3b82f6'},{id:'purple',name:'极光紫',color:'#a855f7'},{id:'green',name:'松针翠绿',color:'#22c55e'}] as const;
export function useApplicationStyle() {
  const [snapshot,setSnapshot] = useState(()=>readAppearance());
  useEffect(()=>{const update=()=>setSnapshot(readAppearance());const storage=(e:StorageEvent)=>{if(e.key===appearanceKey||e.key===null)update();};window.addEventListener('zenix:appearance-changed',update);window.addEventListener('storage',storage);return()=>{window.removeEventListener('zenix:appearance-changed',update);window.removeEventListener('storage',storage);};},[]);
  const change=(patch:Partial<Appearance>,reset=false)=>{try{saveAppearance({...snapshot.value,...patch},{reset});setSnapshot(readAppearance());}catch(error){setSnapshot(previous=>({...previous,error:error instanceof Error?error.message:'外观未能保存，请重试。'}));}};
  return {...snapshot,change};
}
export function StyleQuickControls({onOpen}:{onOpen():void}) {
  const {value,change,error}=useApplicationStyle();
  return <section className="zx-style-quick"><header><h2>Style<span>.</span></h2><button type="button" onClick={onOpen} aria-label="调节全局 Style 与按钮"><SlidersHorizontal size={15}/>调节</button></header><div className="zx-swatches">{colors.map(c=><button key={c.id} type="button" style={{'--swatch':c.color} as React.CSSProperties} aria-label={c.name} aria-pressed={value.accent===c.id} onClick={()=>change({accent:c.id})}/>)}</div><div className="zx-style-pills">{styles.map(s=><button type="button" key={s} aria-pressed={value.style===s} onClick={()=>change({style:s,frame:false})}>{styleNames[s]}</button>)}</div>{error&&<p role="alert">{error}</p>}</section>;
}
export function StyleButton() {
  const [open,setOpen]=useState(false);const {value}=useApplicationStyle();
  return <><button type="button" className="zx-action zx-style-trigger" onClick={()=>setOpen(true)}><SlidersHorizontal size={16}/>Style<span>{styleNames[value.style]}</span></button>{open&&<StyleDialog onClose={()=>setOpen(false)}/>}</>;
}
export function StyleDialog({onClose}:{onClose():void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>{ref.current?.close();previous?.focus();};},[]);
  return createPortal(<dialog className="zx-style-dialog" ref={ref} aria-labelledby="zx-style-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}><header><div><small>MAKE IT YOURS</small><h2 id="zx-style-title">Style.</h2></div><button type="button" aria-label="关闭 Style 设置" onClick={onClose}><X size={20}/></button></header><div className="zx-style-scroll"><ApplicationStyleSettings/><UiSoundSettings/></div><footer><button type="button" className="zx-action" onClick={onClose}>完成调节</button></footer></dialog>,document.body);
}
export default function ApplicationStyleSettings() {
  const {value,change,error}=useApplicationStyle();
  return <section className="zenix-style-settings" data-setting="application-style" data-mobile-setting="application-style"><header><div><h3>全局 Style</h3><p>首页、内页、按钮和浮层，共用你的外观选择。</p></div><span>{styleNames[value.style]}</span></header>
    {error&&<p role="alert">{error}</p>}
    <fieldset><legend>视觉模式</legend><div className="zx-style-segment">{(['dark','light','system'] as const).map((mode,i)=><button key={mode} type="button" aria-pressed={value.mode===mode} onClick={()=>change({mode})}>{['黑色','浅色','跟随系统'][i]}</button>)}</div></fieldset>
    <fieldset><legend>界面材质</legend><div className="zx-materials">{styles.map(s=><button key={s} type="button" data-style-option={s} aria-pressed={value.style===s} onClick={()=>change({style:s,frame:false})}><i aria-hidden="true"/><strong>{styleNames[s]}</strong><small>{styleLabels[s]}</small></button>)}</div><label className="zx-style-switch"><span>Chamfer 九宫格外框</span><input type="checkbox" role="switch" checked={value.frame} onChange={e=>change({frame:e.target.checked})}/></label></fieldset>
    <fieldset><legend>强调色</legend><div className="zx-swatches">{colors.map(c=><button key={c.id} type="button" aria-label={c.name} title={c.name} style={{'--swatch':c.color} as React.CSSProperties} aria-pressed={value.accent===c.id} onClick={()=>change({accent:c.id})}/>)}</div></fieldset>
    <fieldset><legend>按钮设计</legend><div className="zx-style-segment">{(['blog','solid','outline','pixel'] as const).map((button,i)=><button type="button" key={button} aria-pressed={value.button===button} onClick={()=>change({button})}>{['博客原版','实心','描边','像素压边'][i]}</button>)}</div><div className="zx-button-sandbox"><small>LIVE PREVIEW</small><div><button className="zx-button-sample" type="button"><Play size={16}/>播放音乐</button><button className="zx-button-sample" type="button"><Heart size={16}/>加入收藏</button></div></div><label className="zx-style-switch"><span>按钮切角外框</span><input type="checkbox" role="switch" checked={value.buttonFrame} onChange={e=>change({buttonFrame:e.target.checked})}/></label><div className="zx-style-ranges">{([{id:'radius',label:'圆角 / 切角',min:0,max:24,step:1},{id:'stroke',label:'描边',min:1,max:3,step:.5},{id:'depth',label:'按压厚度',min:0,max:8,step:1},{id:'height',label:'按钮高度',min:36,max:52,step:1}] as const).map(r=><label key={r.id}><span>{r.label}</span><output>{value[r.id]} px</output><input type="range" aria-label={r.label} min={r.min} max={r.max} step={r.step} value={value[r.id]} onChange={e=>change({[r.id]:Number(e.target.value)})}/></label>)}</div></fieldset>
    <label className="zx-style-switch"><span>像素网格页面转场<small>遵循系统和应用的减少动态效果设置。</small></span><input type="checkbox" role="switch" checked={value.motion} onChange={e=>change({motion:e.target.checked})}/></label>
    <button type="button" className="zx-style-reset" onClick={()=>change({...defaults},true)}>恢复默认：黑色 / Neon / 绯红</button>
  </section>;
}
