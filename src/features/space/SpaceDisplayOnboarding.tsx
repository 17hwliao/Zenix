import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {LayoutGrid,ListMusic,X} from 'lucide-react';
import type {SpacePresentationMode} from './presentationTypes';
import './spacePresentation.css';

type SpaceDisplayOnboardingProps={
  open:boolean;
  error?:string;
  onChoose:(mode:SpacePresentationMode)=>boolean;
};

export default function SpaceDisplayOnboarding({open,error,onChoose}:SpaceDisplayOnboardingProps){
  const dialogRef=useRef<HTMLDivElement>(null);
  const firstChoiceRef=useRef<HTMLButtonElement>(null);
  const [dismissed,setDismissed]=useState(false);
  const visible=open&&!dismissed;
  const chooseRef=useRef(onChoose);
  chooseRef.current=onChoose;
  const dismiss=()=>{if(!chooseRef.current('sticker'))setDismissed(true);};

  useEffect(()=>{
    if(!open)setDismissed(false);
  },[open]);

  useEffect(()=>{
    if(!visible)return;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const frame=requestAnimationFrame(()=>firstChoiceRef.current?.focus());
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();
        event.stopPropagation();
        if(!chooseRef.current('sticker'))setDismissed(true);
        return;
      }
      if(event.key!=='Tab')return;
      const focusable=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )||[]).filter(element=>element.getClientRects().length>0);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1],active=document.activeElement;
      if(event.shiftKey&&(active===first||!dialogRef.current?.contains(active))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(active===last||!dialogRef.current?.contains(active))){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',onKeyDown,true);
    return()=>{
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown',onKeyDown,true);
      document.body.style.overflow=previousOverflow;
      previousFocus?.focus();
    };
  },[visible]);

  if(!visible)return null;
  return createPortal(
    <div className="space-display-onboarding" onMouseDown={event=>{if(event.target===event.currentTarget)dismiss();}}>
      <div ref={dialogRef} className="space-display-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="space-display-onboarding-title" aria-describedby="space-display-onboarding-description">
        <button type="button" className="space-display-onboarding-close" aria-label="关闭展示选择并继续使用贴纸拼贴" onClick={dismiss}><X size={18}/></button>
        <header>
          <span>YOUR MUSIC SPACE</span>
          <h2 id="space-display-onboarding-title">选择音乐空间的展示方式</h2>
          <p id="space-display-onboarding-description">两种方式浏览同一份歌曲、搜索来源与播放队列。之后可以随时在设置中更改。</p>
        </header>
        <div className="space-display-onboarding-options" role="group" aria-label="音乐空间展示方式">
          <button ref={firstChoiceRef} type="button" className="space-display-onboarding-option is-recommended" data-space-display-choice="sticker" onClick={()=>onChoose('sticker')}>
            <span className="space-display-preview is-sticker" aria-hidden="true"><i/><i/><i/><i/><i/></span>
            <span className="space-display-option-copy"><strong><LayoutGrid size={18}/>贴纸拼贴</strong><small>拖动浏览、聚焦展开，保留音乐空间的贴纸风格。</small></span>
          </button>
          <button type="button" className="space-display-onboarding-option" data-space-display-choice="list" onClick={()=>onChoose('list')}>
            <span className="space-display-preview is-list" aria-hidden="true"><i/><i/><i/><i/></span>
            <span className="space-display-option-copy"><strong><ListMusic size={18}/>简约列表</strong><small>按行列查看歌曲信息、播放与现有资料操作。</small></span>
          </button>
        </div>
        {error&&<div className="space-display-onboarding-error" role="alert">{error}</div>}
        <footer>按 Esc 或关闭将使用默认的贴纸拼贴。</footer>
      </div>
    </div>,
    document.body,
  );
}
