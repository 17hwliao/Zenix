import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent,PointerEvent as ReactPointerEvent} from 'react';
import {animate,motion,useMotionValue,useReducedMotion,useTransform,type MotionValue,type AnimationPlaybackControls} from 'framer-motion';
import type {SongPresentationProps} from './presentationTypes';
import {orbitDragDelta,orbitHit,orbitLayout,orbitLaneTransform,orbitProjection,orbitSlots,type OrbitLayout,type OrbitSlot} from './orbitGeometry';
import './orbitSongSpace.css';

type Track=SongPresentationProps['tracks'][number];
 type Flight={id:number;incoming:Track;outgoing:Track;from:DOMRect;to:DOMRect};
 type Drag={pointer:number;branch:number|null;y:number;x:number;moved:boolean};
const spring={type:'spring' as const,stiffness:155,damping:25,mass:.7,restDelta:.001,restSpeed:.001};
const lightSpring={...spring,stiffness:280,damping:32,mass:.65};
function Rail({layout,branch,front}:{layout:MotionValue<OrbitLayout>;branch:number;front:boolean}){
 const path=useRef<SVGPathElement>(null);
 useLayoutEffect(()=>{
  const update=(value:OrbitLayout)=>path.current?.setAttribute('transform',orbitLaneTransform(value,branch));
  update(layout.get());
  return layout.on('change',update);
 },[layout,branch]);
 return <path ref={path} data-lane={branch} d={front?'M1 0 A1 1 0 0 1 -1 0':'M-1 0 A1 1 0 0 1 1 0'}/>;
}
function Satellite({slot,layout,oriented,phase,count,track,current,cover,onFocus,light,hidden}:{slot:OrbitSlot;layout:OrbitLayout;oriented:MotionValue<OrbitLayout>;phase:MotionValue<number>;count:number;track:SongPresentationProps['tracks'][number];current:boolean;cover:SongPresentationProps['renderCover'];onFocus:(id:string,node:HTMLElement)=>void;light:boolean;hidden:boolean}){
 const projection=useTransform(()=>orbitProjection(oriented.get(),slot.branch,slot.virtualIndex,phase.get(),count));
 const transform=useTransform(projection,p=>`translate3d(${p.x}px,${p.y}px,0) scale(${p.scale}) rotateX(${light?0:p.rotateX}deg) rotateY(${light?0:p.rotateY}deg) rotateZ(${light?0:p.rotateZ}deg)`);
 const opacity=useTransform(projection,p=>p.opacity),zIndex=useTransform(projection,p=>p.zIndex),visibility=useTransform(projection,p=>p.opacity>.01?'visible' as const:'hidden' as const);
 const [visible,setVisible]=useState(()=>projection.get().opacity>.01);
 const visibleRef=useRef(visible);
 useEffect(()=>{const update=()=>{const next=projection.get().opacity>.01;if(next!==visibleRef.current){visibleRef.current=next;setVisible(next);}};update();return projection.on('change',update);},[projection]);
 return <motion.article className={`orbit-card${current?' is-current':''}`} data-testid="orbit-card" data-branch={slot.branch} data-slot={slot.key} data-track-id={track.id} style={{left:0,top:0,transform,opacity,zIndex,visibility,width:layout.cardWidth,height:layout.cardHeight}} aria-hidden={!visible||hidden} data-in-flight={hidden||undefined}>
  <button className="orbit-card-focus" tabIndex={visible&&!hidden?0:-1} aria-label={`查看 ${track.title} · ${track.artist}`} onClick={event=>onFocus(track.id,event.currentTarget.parentElement!)}>{cover(track)}<span>{track.title}</span><small>{track.artist}</small></button>
 </motion.article>;
}
export default function OrbitSongSpace(props:SongPresentationProps){
 const {tracks,selectedId,currentId,playing,cardScale,motionLevel='full',onFocus,onPlay,onExpand,renderCover}=props;
 const stage=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:800,height:560}),[bases,setBases]=useState([0,0,0,0]);
 const target=useRef([0,0,0,0]),controls=useRef<(AnimationPlaybackControls|undefined)[]>([]),systemReduced=useReducedMotion();
 const reduced=Boolean(systemReduced||motionLevel==='reduced'),light=Boolean(systemReduced||motionLevel!=='full');
 const basesRef=useRef([0,0,0,0]);
 const p0=useMotionValue(0),p1=useMotionValue(0),p2=useMotionValue(0),p3=useMotionValue(0),motionPhases=useMemo(()=>[p0,p1,p2,p3],[p0,p1,p2,p3]);
 const drag=useRef<Drag|null>(null),suppress=useRef(false),pointers=useRef(new Set<number>());
 const [hotLane,setHotLane]=useState<number|null>(null),[flight,setFlight]=useState<Flight|null>(null),[positions,setPositions]=useState<Map<string,string>>(()=>new Map());
 const hover=useRef(false),flightId=useRef(0),pauseUntil=useRef(0);
 const centerCover=useRef<HTMLDivElement>(null);
 const layout=useMemo(()=>orbitLayout(size.width,size.height,cardScale),[size,cardScale]);
 const axis=useMotionValue(0),axisTarget=useRef(0),axisAnimation=useRef<AnimationPlaybackControls|undefined>(undefined);
 const oriented=useTransform(axis,value=>orbitLayout(size.width,size.height,cardScale,Math.sin(value)*.32));
 const focused=tracks.find(track=>track.id===selectedId)||tracks[0];
 const byId=useMemo(()=>new Map(tracks.map(track=>[track.id,track])),[tracks]);
 const branches=useMemo(()=>{
  const result:Track[][]=[[],[],[],[]];
  const complete=[...positions].every(([key,value])=>byId.has(key)&&byId.has(value));
  tracks.forEach((track,index)=>result[index%4].push((complete&&byId.get(positions.get(track.id)??''))||track));
  return result;
 },[tracks,positions,byId]);
 useEffect(()=>{setPositions(previous=>{
  if(![...previous].some(([key,value])=>!byId.has(key)||!byId.has(value)))return previous;
  // If a source removes a song, return its permutation cycle to the original slots.
  const next=new Map(previous);
  for(const key of previous.keys()){
   if(byId.has(key)&&byId.has(previous.get(key)!))continue;
   let cursor:string|undefined=key;
   while(cursor!==undefined&&next.has(cursor)){const value:string|undefined=next.get(cursor);next.delete(cursor);cursor=value;}
  }
  return next;
 });},[byId]);
 const slots=useMemo(()=>orbitSlots(layout,branches.map(items=>items.length),bases),[layout,branches,bases]);
 const publishTargets=(next:number[])=>{
  target.current=next;
  if(stage.current)stage.current.dataset.phases=next.join(',');
 };
 const turn=(branch:number|null,delta:number,immediate=false)=>{
  pauseUntil.current=performance.now()+1100;
  if(branch===null){
   axisTarget.current+=delta*.75;axisAnimation.current?.stop();
   if(immediate||reduced)axis.set(axisTarget.current);
   else axisAnimation.current=animate(axis,axisTarget.current,light?lightSpring:spring);
  }
  publishTargets(target.current.map((phase,i)=>branch===null||i===branch?phase+delta:phase));
  motionPhases.forEach((phase,i)=>{if(branch!==null&&i!==branch)return;controls.current[i]?.stop();if(immediate||reduced)phase.set(target.current[i]);else controls.current[i]=animate(phase,target.current[i],light?lightSpring:spring);});
 };
 useEffect(()=>{
  if(reduced||tracks.length<2||!stage.current)return;
  let frame=0,last=0,visible=false;
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;});observer.observe(stage.current);
  const tick=(time:number)=>{
   frame=requestAnimationFrame(tick);
   const dt=last?Math.min(time-last,40):0;last=time;
   if(!visible||document.hidden||hover.current||pointers.current.size||time<pauseUntil.current||stage.current?.querySelector(':focus-visible'))return;
   axisTarget.current=axis.get()+dt*(light?.000053:.000094);axis.set(axisTarget.current);
   motionPhases.forEach((phase,i)=>{
    if(!branches[i].length)return;
    const next=phase.get()+dt*(light?.000025:.000047)*(i%2?-1:1);
    target.current[i]=next;phase.set(next);
   });
   if(stage.current)stage.current.dataset.phases=target.current.join(',');
  };
  frame=requestAnimationFrame(tick);return()=>{observer.disconnect();cancelAnimationFrame(frame);};
 },[reduced,light,tracks.length,branches,motionPhases]);
 useEffect(()=>{if(reduced){setFlight(null);axisAnimation.current?.stop();axis.set(axisTarget.current);}},[reduced,axis]);
 useEffect(()=>()=>axisAnimation.current?.stop(),[]);
 useEffect(()=>{const off=motionPhases.map((phase,i)=>phase.on('change',value=>{const base=Math.floor(value);if(basesRef.current[i]===base)return;basesRef.current=basesRef.current.map((item,index)=>index===i?base:item);setBases(basesRef.current);}));return()=>{off.forEach(stop=>stop());controls.current.forEach(control=>control?.stop());};},[motionPhases]);
 useEffect(()=>{if(reduced)motionPhases.forEach((phase,i)=>{controls.current[i]?.stop();phase.set(target.current[i]);});},[reduced,motionPhases]);
 useEffect(()=>{const release=(event:PointerEvent)=>{pointers.current.delete(event.pointerId);if(drag.current?.pointer===event.pointerId){suppress.current=drag.current.moved;drag.current=null;}};const clear=()=>{if(drag.current)suppress.current=true;drag.current=null;pointers.current.clear();controls.current.forEach(control=>control?.stop());motionPhases.forEach((phase,i)=>phase.set(target.current[i]));};window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);return()=>{window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);};},[motionPhases]);
 useEffect(()=>{const node=stage.current;if(!node)return;const observer=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;if(width>0&&height>0)setSize({width,height});});observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{const node=stage.current;if(!node)return;const wheel=(event:WheelEvent)=>{
  if(document.hidden||(event.target as Element).closest('button:not(.orbit-card-focus),a,input,select')||event.ctrlKey)return;
  event.preventDefault();const branch=locate(event.target as Element,event.clientX,event.clientY),unit=event.deltaMode===1?16:event.deltaMode===2?size.height:1,delta=Math.max(-.45,Math.min(.45,(event.deltaY||event.deltaX)*unit/650));
  turn(branch,delta);
 };node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[layout,reduced,light,motionPhases,branches,oriented]);
 const locate=(element:Element,x:number,y:number)=>{
  const card=element.closest<HTMLElement>('[data-branch]'),rect=stage.current!.getBoundingClientRect();
  const lane=card?Number(card.dataset.branch):orbitHit(oriented.get(),x-rect.left,y-rect.top);
  return lane!==null&&branches[lane]?.length?lane:null;
 };
 const handleKeyDown=(event:KeyboardEvent<HTMLDivElement>)=>{
  const card=(event.target as Element).closest<HTMLElement>('[data-branch]');
  if(event.target!==event.currentTarget&&!card)return;
  const previous=event.key==='ArrowLeft'||event.key==='ArrowUp';
  if(!previous&&event.key!=='ArrowRight'&&event.key!=='ArrowDown')return;
  event.preventDefault();
  turn(card?Number(card.dataset.branch):null,previous?-1:1);
 };
 const end=(event:ReactPointerEvent<HTMLDivElement>)=>{pointers.current.delete(event.pointerId);if(drag.current?.pointer===event.pointerId){if(drag.current.moved)suppress.current=true;drag.current=null;}if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
 const down=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(event.button!==0)return;
  if(pointers.current.size===0)suppress.current=false;
  pointers.current.add(event.pointerId);if(pointers.current.size!==1){drag.current=null;suppress.current=true;return;}
  if((event.target as Element).closest('button:not(.orbit-card-focus),a,input,select'))return;
  const branch=locate(event.target as Element,event.clientX,event.clientY);
  axisAnimation.current?.stop();axisTarget.current=axis.get();
  // Continue from the visible position when interrupting a spring, never its old destination.
  const next=[...target.current];motionPhases.forEach((phase,i)=>{if(branch===null||branch===i){controls.current[i]?.stop();next[i]=phase.get();}});publishTargets(next);
  suppress.current=false;drag.current={pointer:event.pointerId,branch,x:event.clientX,y:event.clientY,moved:false};((event.target as Element).closest<HTMLElement>('.orbit-card-focus')||event.currentTarget).setPointerCapture(event.pointerId);
 };
 const move=(event:ReactPointerEvent<HTMLDivElement>)=>{
  const d=drag.current;
  if(event.pointerType==='mouse'){hover.current=true;setHotLane(d?d.branch:locate(event.target as Element,event.clientX,event.clientY));}
  if(!d||d.pointer!==event.pointerId||pointers.current.size!==1)return;
  const dx=event.clientX-d.x,dy=event.clientY-d.y;
  if(!d.moved&&Math.hypot(dx,dy)<6)return;
  if(!d.moved)event.currentTarget.setPointerCapture(event.pointerId);
  d.moved=true;suppress.current=true;
  const rect=event.currentTarget.getBoundingClientRect();
  const delta=d.branch===null?(Math.abs(dx)>Math.abs(dy)?dx:dy)*.004:orbitDragDelta(oriented.get(),d.branch,d.x-rect.x,d.y-rect.y,event.clientX-rect.x,event.clientY-rect.y,branches[d.branch].length);
  turn(d.branch,delta,true);d.x=event.clientX;d.y=event.clientY;
 };
 const focus=(id:string,node:HTMLElement)=>{
  const track=byId.get(id);
  if(!track||!focused||focused.id===id)return;
  pauseUntil.current=performance.now()+1100;
  axisAnimation.current?.stop();axisTarget.current=axis.get();
  controls.current.forEach(control=>control?.stop());
  publishTargets(motionPhases.map(phase=>phase.get()));
  const bounds=stage.current?.getBoundingClientRect(),cover=centerCover.current?.getBoundingClientRect(),card=node.getBoundingClientRect();
  const offset=(r:DOMRect,b:DOMRect)=>new DOMRect(r.x-b.x,r.y-b.y,r.width,r.height);
  if(!reduced&&bounds&&cover&&card.width&&card.height)setFlight({id:++flightId.current,incoming:track,outgoing:focused,from:offset(card,bounds),to:offset(cover,bounds)});
  setPositions(previous=>{
   const next=new Map(previous);
   const slot=(value:string)=>[...previous].find(([,id])=>id===value)?.[0]??value;
   const from=slot(track.id),to=slot(focused.id);
   if(from===focused.id)next.delete(from);else next.set(from,focused.id);
   if(to===track.id)next.delete(to);else next.set(to,track.id);
   return next;
  });
  onFocus(track);
 };
 const current=focused?.id===currentId;
 return <section className="orbit-song-space" aria-label="环绕歌曲空间" data-testid="orbit-space" data-motion={reduced?'reduced':light?'light':'full'}>
  <div ref={stage} className="orbit-stage" data-testid="orbit-stage" data-hot-lane={hotLane??undefined} tabIndex={tracks.length?0:-1} role="group" aria-label="星轨，方向键旋转" onKeyDown={handleKeyDown} onPointerEnter={()=>{hover.current=true;}} onPointerLeave={()=>{hover.current=false;setHotLane(null);}} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={event=>{suppress.current=true;end(event);}} onLostPointerCapture={event=>{if(event.target===event.currentTarget&&drag.current?.pointer===event.pointerId){drag.current=null;suppress.current=true;}}} onClickCapture={event=>{if(suppress.current){suppress.current=false;if(event.detail>0){event.preventDefault();event.stopPropagation();}}}}>
   {[false,true].map(front=><svg key={String(front)} className={`orbit-paths ${front?'is-front':'is-back'}`} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">{branches.map((items,branch)=>items.length?<Rail key={branch} layout={oriented} branch={branch} front={front}/>:null)}</svg>)}
   {slots.map(slot=>{const track=branches[slot.branch][slot.index];if(track.id===focused?.id)return null;return <Satellite key={slot.key} slot={slot} layout={layout} oriented={oriented} phase={motionPhases[slot.branch]} count={branches[slot.branch].length} track={track} current={track.id===currentId} cover={renderCover} onFocus={focus} light={light} hidden={flight?.outgoing.id===track.id}/>;})}
   {focused?<article className="orbit-focus-card" data-testid="orbit-focus-card" data-track-id={focused.id} style={{left:layout.focus.x,top:layout.focus.y,width:layout.focus.width,height:layout.focus.height}}>
    <div ref={centerCover} className="orbit-focus-cover" data-in-flight={flight?.incoming.id===focused.id||undefined}>{renderCover(focused)}</div><div className="orbit-focus-meta"><strong title={focused.title}>{focused.title}</strong><span title={focused.artist}>{focused.artist}</span>
    <div className="orbit-focus-buttons"><button onClick={()=>onPlay(focused)} aria-label={`播放 ${focused.title}`}>{current&&playing?'正在播放':'播放'}</button>{current&&onExpand&&<button onClick={onExpand} aria-label="放大当前播放器">放大</button>}</div></div>
   </article>:<p className="orbit-empty">还没有歌曲</p>}
   {flight&&([[flight.incoming,flight.from,flight.to],[flight.outgoing,flight.to,flight.from]] as const).map(([song,a,b],index)=>{
    return <motion.div key={`${flight.id}:${index}`} className="orbit-flight" aria-hidden="true" style={{left:a.x,top:a.y,width:a.width,height:a.height,zIndex:40-index}}
     initial={{x:0,y:0,scaleX:1,scaleY:1}} animate={{x:b.x-a.x,y:b.y-a.y,scaleX:b.width/a.width,scaleY:b.height/a.height}}
     transition={{duration:light?.22:.38,ease:[.22,.7,.25,1]}} onAnimationComplete={()=>{if(index===0)setFlight(current=>current?.id===flight.id?null:current);}}>{renderCover(song)}</motion.div>;
   })}
  </div>
 </section>;
}
