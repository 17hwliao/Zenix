/** Pure projection for the music-space lanes. The personal homepage uses its own 3D ring. */
export const ORBIT_BRANCHES = 4;
export type OrbitRect = {x:number;y:number;width:number;height:number};
export type OrbitLane = {angle:number;rx:number;ry:number;stretchX:number};
export type OrbitLayout = {width:number;height:number;rx:number;ry:number;cardWidth:number;cardHeight:number;focus:OrbitRect;lanes:OrbitLane[]};
export function orbitLayout(width:number,height:number,scale:number,tilt=0):OrbitLayout {
 const w=Math.max(1,width),h=Math.max(1,height),s=Number.isFinite(scale)?Math.max(.65,Math.min(1.25,scale)):1,compact=w<600;
 const cardWidth=(compact?Math.min(82,w*.22):Math.min(150,w*.11))*s,cardHeight=cardWidth*1.32;
 const fw=compact?Math.min(150,w*.39):Math.min(286,w*.36),fh=Math.min(compact?222:378,h-24);
 const freeX=Math.max(.05,.5-(cardWidth*.64+12)/w),freeY=Math.max(.05,.5-(cardHeight*.64+12)/h);
 // Different minor radii keep the four paths apart away from their crossings.
 // Fit each lane independently, including the projected card's full footprint.
 const lanes=[.37,.30,.22,.14].map((minor,branch)=>{
  const angle=branch*Math.PI/4+tilt,major=.48-branch*.012,c=Math.cos(angle),sn=Math.sin(angle);
  const extentX=Math.hypot(major*c,minor*sn),extentY=Math.hypot(major*sn,minor*c),fit=Math.min(1,freeX/extentX,freeY/extentY)*(1-branch*.02);
  const stretchX=compact?Math.min(1.55,freeX/(extentX*fit)):.94;
  return {angle,rx:major*fit,ry:minor*fit,stretchX};
 });
 return {width:w,height:h,rx:lanes[0].rx*w,ry:lanes[0].ry*h,cardWidth,cardHeight,focus:{x:(w-fw)/2,y:(h-fh)/2,width:fw,height:fh},lanes};
}
export function orbitPoint(layout:OrbitLayout,branch:number,theta:number) {
 const lane=layout.lanes[branch],c=Math.cos(lane.angle),s=Math.sin(lane.angle),u=lane.rx*Math.cos(theta),v=lane.ry*Math.sin(theta);
 return {x:layout.width*(.5+(u*c-v*s)*lane.stretchX),y:layout.height*(.5+u*s+v*c)};
}
/** Project a unit SVG semicircle onto exactly the same ellipse as its song cards. */
export function orbitLaneTransform(layout:OrbitLayout,branch:number){
 const {angle,rx,ry,stretchX}=layout.lanes[branch],c=Math.cos(angle),s=Math.sin(angle),{width:w,height:h}=layout;
 return `matrix(${rx*c*w*stretchX} ${rx*s*h} ${-ry*s*w*stretchX} ${ry*c*h} ${w/2} ${h/2})`;
}
export function orbitHit(layout:OrbitLayout,x:number,y:number):number|null {
 const center=layout.focus;
 if(x>=center.x-14&&x<=center.x+center.width+14&&y>=center.y-14&&y<=center.y+center.height+14)return null;
 const nx=x/layout.width-.5,ny=y/layout.height-.5;let nearest=-1,distance=Infinity;
 for(let b=0;b<ORBIT_BRANCHES;b++){
  const {angle,rx,ry,stretchX}=layout.lanes[b],c=Math.cos(angle),s=Math.sin(angle),u=nx/stretchX*c+ny*s,v=-nx/stretchX*s+ny*c;
  const d=Math.abs(Math.hypot(u/rx,v/ry)-1)*Math.min(rx*layout.width,ry*layout.height);
  if(d<distance){distance=d;nearest=b;}
 }
 return distance<28?nearest:null;
}
export function overlaps(a:OrbitRect,b:OrbitRect,gap=8){return a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;}
export function orbitBrowseIndex(phase:number,count:number){return count?((Math.floor(phase)%count)+count)%count:-1;}
export function orbitCapacity(layout:OrbitLayout){return layout.width<600?3:4;}
/** Signed angular movement around an ellipse, independent of its tilt or aspect ratio. */
export function orbitDragDelta(layout:OrbitLayout,branch:number,x:number,y:number,nextX:number,nextY:number,count=orbitCapacity(layout)){
 const {angle,rx,ry,stretchX}=layout.lanes[branch],c=Math.cos(angle),s=Math.sin(angle);
 const theta=(px:number,py:number)=>{const u=(px/layout.width-.5)/stretchX,v=py/layout.height-.5;return Math.atan2((-u*s+v*c)/ry,(u*c+v*s)/rx);};
 const a=theta(x,y),b=theta(nextX,nextY),delta=Math.atan2(Math.sin(b-a),Math.cos(b-a));
 return -delta*Math.min(count,orbitCapacity(layout))/(Math.PI*2);
}
export function orbitProjection(layout:OrbitLayout,branch:number,virtualIndex:number,phase:number,count:number){
 const capacity=orbitCapacity(layout),step=Math.PI*2/Math.min(count,capacity),t=(virtualIndex-phase)*step;
 const theta=count<=capacity?((t+Math.PI/2)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI/2:t;
 const angle=theta+branch*.16,p=orbitPoint(layout,branch,angle),depth=Math.sin(angle),scale=.92+depth*.16;
 // Recycle identities only at the rear midpoint; entering and leaving cards fade
 // behind the centre, instead of swapping a visible cover at a phase boundary.
 const edge=Math.min(theta+Math.PI/2,Math.PI*1.5-theta),fade=count<=capacity?1:Math.max(0,Math.min(1,edge/.24));
 const width=layout.cardWidth*scale,height=layout.cardHeight*scale;
 // Let foreground cards cross the cover's edges, keeping its middle readable.
 const overCover=Math.abs(p.x-layout.width/2)<layout.focus.width/2&&p.y>layout.focus.y&&p.y<layout.focus.y+layout.focus.height-90;
 const zIndex=depth>0&&overCover?10:10+Math.round(depth*(depth>0?16:8));
 return {theta,depth,scale,opacity:fade*(.75+.25*(depth+1)/2),zIndex,rotateX:depth*-5,rotateY:Math.cos(angle)*-24,rotateZ:Math.cos(angle)*Math.sin(layout.lanes[branch].angle)*4,rect:{x:p.x-width/2,y:p.y-height/2,width,height},x:p.x-layout.cardWidth/2,y:p.y-layout.cardHeight/2};
}
export type OrbitSlot={branch:number;index:number;virtualIndex:number;key:string};
export function orbitSlots(layout:OrbitLayout,counts:number[],phases:number[]):OrbitSlot[]{
 const slots:OrbitSlot[]=[];
 for(let branch=0;branch<ORBIT_BRANCHES;branch++){
  const count=counts[branch]||0;if(!count)continue;
  const capacity=orbitCapacity(layout);
  if(count<=capacity){for(let index=0;index<count;index++)slots.push({branch,index,virtualIndex:index,key:`${branch}:${index}`});continue;}
  const base=Math.floor(phases[branch]||0),seen=new Set<number>();
  // A small stable buffer spans both sides of the currently visible half-turn.
  // Small queues use the closest representative, avoiding duplicate song cards.
  const offsets=Array.from({length:capacity+2},(_,i)=>i-Math.ceil(capacity/4));
  for(const offset of offsets){const virtualIndex=base+offset,index=orbitBrowseIndex(virtualIndex,count);if(seen.has(index))continue;seen.add(index);slots.push({branch,index,virtualIndex,key:`${branch}:${virtualIndex}`});}
 }
 return slots;
}
