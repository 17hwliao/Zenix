import {useEffect,useState} from 'react';
export type AppCompanionSettings={scale:number;wandering:boolean;locked:boolean;hidden:boolean;reduced:boolean};
export function readAppCompanion():AppCompanionSettings {
  try{const ui=JSON.parse(localStorage.getItem('zenix.assistant.ui.v1')||'{}'),size=Number(localStorage.getItem('zenix.assistant.zenbot-scale.v1')||.7);return{scale:Number.isFinite(size)?Math.min(1.25,Math.max(.45,size)):.7,wandering:localStorage.getItem('zenix.assistant.zenbot-roaming.v2')!=='false',locked:ui.locked===true,hidden:ui.hidden===true,reduced:ui.reduced===true};}
  catch{return{scale:.7,wandering:true,locked:false,hidden:false,reduced:false};}
}
export function useAppCompanion(){const[value,setValue]=useState(readAppCompanion);useEffect(()=>{const update=()=>setValue(readAppCompanion());window.addEventListener('zenix-assistant-ui',update);window.addEventListener('zenix-assistant-figure',update);window.addEventListener('storage',update);return()=>{window.removeEventListener('zenix-assistant-ui',update);window.removeEventListener('zenix-assistant-figure',update);window.removeEventListener('storage',update);};},[]);return value;}
export type CompanionPoint={x:number;y:number;vx:number;vy:number;direction:1|-1;mode:'idle'|'walk'|'falling'|'dragged';restUntil:number};
export const clamp=(value:number,max:number)=>Math.max(0,Math.min(value,Math.max(0,max)));
export function stepAppCompanion(state:CompanionPoint,bounds:{width:number;height:number;bodyWidth:number;bodyHeight:number},seconds:number,now:number,options:{walk:boolean;paused:boolean;reduced:boolean}):CompanionPoint{
  const right=Math.max(0,bounds.width-bounds.bodyWidth),floor=Math.max(0,bounds.height-bounds.bodyHeight),next={...state,x:clamp(state.x,right),y:clamp(state.y,floor)};
  if(next.mode==='dragged')return next;
  const dt=Math.max(0,Math.min(.05,seconds));
  if(options.reduced)return{...next,y:floor,vx:0,vy:0,mode:'idle'};
  if(next.y<floor||next.mode==='falling'){
    next.vy+=1450*dt;next.x=clamp(next.x+next.vx*dt,right);next.y=clamp(next.y+next.vy*dt,floor);next.vx*=Math.exp(-dt*1.4);next.mode='falling';
    if(next.y>=floor){next.vx=0;next.vy=0;next.mode='idle';next.restUntil=now+900;}
  }else{next.mode=options.walk&&!options.paused&&now>=next.restUntil?'walk':'idle';if(next.mode==='walk'){next.x=clamp(next.x+next.direction*27*dt,right);if(next.x<=0||next.x>=right)next.direction=next.x<=0?1:-1;}}
  return next;
}
export type CompanionAnchor={left:number;width:number;viewportWidth:number};
export function companionChatRight(anchor:CompanionAnchor|null|undefined,panelWidth=366,margin=12,gap=12):number{
  if(!anchor||anchor.viewportWidth<=0||anchor.width<=0)return 22;
  const vw=anchor.viewportWidth,actualWidth=Math.min(panelWidth,Math.max(0,vw-margin*2));
  const leftSide=anchor.left-gap-actualWidth,rightSide=anchor.left+anchor.width+gap;
  const x=anchor.left+anchor.width/2>=vw/2
    ?(leftSide>=margin?leftSide:rightSide+actualWidth<=vw-margin?rightSide:vw-margin-actualWidth)
    :(rightSide+actualWidth<=vw-margin?rightSide:leftSide>=margin?leftSide:margin);
  const clamped=Math.max(margin,Math.min(x,Math.max(margin,vw-margin-actualWidth)));
  return Math.round(vw-(clamped+actualWidth));
}
