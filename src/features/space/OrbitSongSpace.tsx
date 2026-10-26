import {useEffect,useMemo,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import type {SongPresentationProps} from './presentationTypes';
import {orbitBrowseIndex,orbitHit,orbitLayout,orbitPoint,orbitSlots} from './orbitGeometry';
import './orbitSongSpace.css';

type Drag={pointer:number;branch:number|null;y:number;x:number;moved:boolean};
export default function OrbitSongSpace(props:SongPresentationProps){
 const {tracks,selectedId,currentId,playing,cardScale,onFocus,onPlay,onExpand,renderCover,renderActions}=props;
 const stage=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:800,height:560}),[phases,setPhases]=useState([0,0,0,0]);
 const drag=useRef<Drag|null>(null),suppress=useRef(false),pointers=useRef(new Set<number>());
 const layout=useMemo(()=>orbitLayout(size.width,size.height,cardScale),[size,cardScale]);
 const focused=tracks.find(track=>track.id===selectedId)||tracks[0];
 // Keep branch allocation stable when search appends results. Selection never changes allocation.
 const branches=useMemo(()=>Array.from({length:4},(_,b)=>tracks.filter((_,i)=>i%4===b)),[tracks]);
 const slots=useMemo(()=>orbitSlots(layout,branches.map(items=>items.length),phases),[layout,branches,phases]);
 const turn=(branch:number|null,delta:number)=>setPhases(old=>old.map((phase,i)=>branch===null||i===branch?phase+delta:phase));
 const browse=(branch:number,delta:number)=>{const items=branches[branch];if(!items.length)return;const index=orbitBrowseIndex(phases[branch]+delta,items.length);turn(branch,delta);onFocus(items[index]);};
 useEffect(()=>{const release=(event:PointerEvent)=>{pointers.current.delete(event.pointerId);if(drag.current?.pointer===event.pointerId){suppress.current=drag.current.moved;drag.current=null;}};const clear=()=>{if(drag.current)suppress.current=true;drag.current=null;pointers.current.clear();};window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);return()=>{window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);};},[]);
 useEffect(()=>{const node=stage.current;if(!node)return;const observer=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;if(width>0&&height>0)setSize({width,height});});observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{const node=stage.current;if(!node)return;const wheel=(event:WheelEvent)=>{
  if(document.hidden||(event.target as Element).closest('button:not(.orbit-card-focus),a,input,select,[data-orbit-actions]'))return;
  if(event.ctrlKey)return; // Do not consume browser/system accessibility zoom.
  event.preventDefault();const rect=node.getBoundingClientRect(),card=(event.target as Element).closest<HTMLElement>('[data-branch]'),branch=card?Number(card.dataset.branch):orbitHit(layout,event.clientX-rect.left,event.clientY-rect.top),delta=Math.max(-.3,Math.min(.3,(event.deltaY||event.deltaX)/450));
  setPhases(old=>old.map((phase,i)=>branch===null||branch===i?phase+delta:phase));
 };node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[layout]);
 const end=(event:ReactPointerEvent<HTMLDivElement>)=>{pointers.current.delete(event.pointerId);if(drag.current?.pointer===event.pointerId){if(drag.current.moved)suppress.current=true;drag.current=null;}if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
 const down=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(event.button!==0)return;
  if(pointers.current.size===0)suppress.current=false;
  pointers.current.add(event.pointerId);if(pointers.current.size!==1){drag.current=null;suppress.current=true;return;}
  if((event.target as Element).closest('button:not(.orbit-card-focus),a,input,select,[data-orbit-actions]'))return;
  suppress.current=false;const rect=event.currentTarget.getBoundingClientRect(),card=(event.target as Element).closest<HTMLElement>('[data-branch]');drag.current={pointer:event.pointerId,branch:card?Number(card.dataset.branch):orbitHit(layout,event.clientX-rect.left,event.clientY-rect.top),x:event.clientX,y:event.clientY,moved:false};((event.target as Element).closest<HTMLElement>('.orbit-card-focus')||event.currentTarget).setPointerCapture(event.pointerId);
 };
 const move=(event:ReactPointerEvent<HTMLDivElement>)=>{const d=drag.current;if(!d||d.pointer!==event.pointerId||pointers.current.size!==1)return;const dx=event.clientX-d.x,dy=event.clientY-d.y;if(!d.moved&&Math.hypot(dx,dy)<6)return;
  // Satellites can be unmounted by collision filtering during a turn. Once a
  // gesture is a drag, capture must belong to the stable stage rather than a card.
  if(!d.moved)event.currentTarget.setPointerCapture(event.pointerId);
  d.moved=true;suppress.current=true;turn(d.branch,(d.branch===null?(Math.abs(dx)>Math.abs(dy)?dx:dy)*.004:dy*.006));d.x=event.clientX;d.y=event.clientY;};
 const focus=(id:string)=>{if(suppress.current){suppress.current=false;return;}const track=tracks.find(item=>item.id===id);if(track)onFocus(track);};
 const current=focused?.id===currentId;
 return <section className="orbit-song-space" aria-label="环绕歌曲空间" data-testid="orbit-space">
  <p className="orbit-instruction">中心拖动或滚轮转动全部轨道 · 在轨道上上下拖动可单独浏览</p>
  <div ref={stage} className="orbit-stage" data-testid="orbit-stage" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={event=>{suppress.current=true;end(event);}} onLostPointerCapture={event=>{if(event.target===event.currentTarget&&drag.current?.pointer===event.pointerId){drag.current=null;suppress.current=true;}}} onClickCapture={event=>{if(suppress.current){event.preventDefault();event.stopPropagation();suppress.current=false;}}}>
   <svg className="orbit-paths" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">{branches.map((_,branch)=>{const points=Array.from({length:81},(_,n)=>orbitPoint(layout,branch,n/80*Math.PI*2));return <path key={branch} d={points.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ')+' Z'}/>;})}</svg>
   {slots.map(slot=>{const track=branches[slot.branch][slot.index];if(track.id===focused?.id)return null;return <article key={slot.key} className={`orbit-card${track.id===currentId?' is-current':''}`} data-testid="orbit-card" data-branch={slot.branch} data-track-id={track.id} style={{left:0,top:0,transform:`translate3d(${slot.rect.x}px,${slot.rect.y}px,0)`,width:slot.rect.width,height:slot.rect.height}}>
    <button className="orbit-card-focus" aria-label={`查看 ${track.title} · ${track.artist}`} onClick={()=>focus(track.id)}>{renderCover(track)}<span>{track.title}</span><small>{track.artist}</small></button>
   </article>;})}
   {focused?<article className="orbit-focus-card" data-testid="orbit-focus-card" data-track-id={focused.id} style={{left:layout.focus.x,top:layout.focus.y,width:layout.focus.width,height:layout.focus.height}}>
    <div className="orbit-focus-cover">{renderCover(focused)}</div><strong title={focused.title}>{focused.title}</strong><span title={focused.artist}>{focused.artist}</span>
    <div className="orbit-focus-buttons"><button onClick={()=>onPlay(focused)} aria-label={`播放 ${focused.title}`}>{current&&playing?'正在播放':'播放'}</button>{current&&onExpand&&<button onClick={onExpand} aria-label="放大当前播放器">放大</button>}</div>
   </article>:<p className="orbit-empty">还没有歌曲，搜索或导入后即可浏览。</p>}
  </div>
  {focused&&renderActions&&<div data-orbit-actions className="orbit-actions orbit-focus-actionbar" aria-label={`${focused.title} 的歌曲操作`}>{renderActions(focused)}</div>}
  <div className="orbit-branches" aria-label="轨道浏览">{branches.map((items,branch)=><div className="orbit-branch" key={branch} data-testid={`orbit-branch-${branch}`} data-phase={phases[branch]} onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(['ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(event.key)){event.preventDefault();browse(branch,event.key==='ArrowUp'||event.key==='ArrowLeft'?-1:1);}}} tabIndex={items.length?0:-1} role="group" aria-label={`轨道 ${branch+1}，${items.length} 首，方向键浏览并聚焦`}>
   <button disabled={!items.length} aria-label={`轨道 ${branch+1} 上一首并聚焦`} onClick={()=>browse(branch,-1)}>‹</button><span>轨道 {branch+1}<small>{items.length?`${orbitBrowseIndex(phases[branch],items.length)+1} / ${items.length}`:'0 首'}</small></span><button disabled={!items.length} aria-label={`轨道 ${branch+1} 下一首并聚焦`} onClick={()=>browse(branch,1)}>›</button>
  </div>)}</div>
  <p className="orbit-footnote">共 {tracks.length} 首 · 交叠和背面的卡片暂时隐藏，可通过各轨道继续浏览</p>
 </section>;
}
