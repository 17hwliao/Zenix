import {useEffect,useRef} from 'react';
import {useApplicationStyle} from '../features/themes/ApplicationStyleSettings';

/** Visual-only route feedback. Business/navigation commit independently of the
 * animation, and this canvas never intercepts input or remounts the player. */
export default function ApplicationTransition({identity,mobile=false,reduced=false}:{identity:string;mobile?:boolean;reduced?:boolean}) {
  const ref=useRef<HTMLCanvasElement>(null),previous=useRef(identity);
  const {value}=useApplicationStyle();
  useEffect(()=>{
    const changed=previous.current!==identity;previous.current=identity;
    const canvas=ref.current;if(!changed||!canvas||reduced||!value.motion||document.hidden||document.documentElement.dataset.uiMotion==='reduced')return;
    const media=matchMedia('(prefers-reduced-motion: reduce)');if(media.matches)return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),cell=30;
    canvas.width=Math.ceil(rect.width*dpr);canvas.height=Math.ceil(rect.height*dpr);ctx.scale(dpr,dpr);
    const cols=Math.ceil(rect.width/cell),rows=Math.ceil(rect.height/cell),started=performance.now();
    const color=getComputedStyle(document.documentElement).getPropertyValue('--primary-500').trim();let frame=0,disposed=false;
    canvas.style.opacity='1';
    const stop=()=>{disposed=true;cancelAnimationFrame(frame);canvas.style.opacity='0';ctx.clearRect(0,0,rect.width,rect.height);};
    const tick=(now:number)=>{if(disposed)return;const t=(now-started)/1000;ctx.clearRect(0,0,rect.width,rect.height);ctx.fillStyle=color;ctx.globalAlpha=.9;
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
        const phase=(1-y/Math.max(1,rows-1))*.65+(Math.cos(x/Math.max(1,cols-1)*Math.PI*5)*.5+.5)*.25+((x*17+y*31)%11)/110;
        const cover=Math.max(0,Math.min(1,(t-phase*.22)/.13)),reveal=Math.max(0,Math.min(1,(t-.36-(1-phase)*.23)/.18)),scale=Math.max(0,cover-reveal),size=(cell+.5)*scale;
        if(scale)ctx.fillRect(x*cell+(cell-size)/2,y*cell+(cell-size)/2,size,size);
      }
      if(t<.8)frame=requestAnimationFrame(tick);else stop();
    };
    frame=requestAnimationFrame(tick);const timeout=setTimeout(stop,1300);
    const visibility=()=>{if(document.hidden)stop();};window.addEventListener('resize',stop);media.addEventListener('change',stop);document.addEventListener('visibilitychange',visibility);
    return()=>{stop();clearTimeout(timeout);window.removeEventListener('resize',stop);media.removeEventListener('change',stop);document.removeEventListener('visibilitychange',visibility);};
  },[identity,value.motion,reduced]);
  return <canvas ref={ref} className={`zx-route-transition${mobile?' is-mobile':''}`} data-reduced={reduced||undefined} aria-hidden="true"/>;
}
