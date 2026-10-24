import {useEffect,useRef} from 'react';
type Request={action:string;args:Record<string,unknown>;accept:()=>void};
export function requestAssistantUi(action:string,args:Record<string,unknown>={}){
 let accepted=false;window.dispatchEvent(new CustomEvent<Request>('zenix-assistant-control',{detail:{action,args,accept:()=>{accepted=true;}}}));
 if(!accepted)throw Error('当前页面暂时无法执行此操作，请返回播放器后重试。');
 if(action!=='tasks'&&action!=='connections')window.dispatchEvent(new CustomEvent('zenix-assistant-navigation-applied'));
}
export function useAssistantUi(handler:(action:string,args:Record<string,unknown>)=>boolean){
 const latest=useRef(handler);latest.current=handler;
 useEffect(()=>{const receive=(event:Event)=>{const request=(event as CustomEvent<Request>).detail;if(latest.current(request.action,request.args))request.accept();};window.addEventListener('zenix-assistant-control',receive);return()=>window.removeEventListener('zenix-assistant-control',receive);},[]);
}
