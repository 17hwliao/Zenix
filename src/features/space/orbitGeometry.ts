/** Stateless geometry: coordinates are relative to the measured stage, never the window. */
export const ORBIT_BRANCHES = 4;
export type OrbitRect = {x:number;y:number;width:number;height:number};
export type OrbitLayout = {width:number;height:number;rx:number;ry:number;cardWidth:number;cardHeight:number;focus:OrbitRect};
export function orbitLayout(width:number,height:number,scale:number):OrbitLayout {
 const w=Math.max(1,width),h=Math.max(1,height),s=Number.isFinite(scale)?Math.max(.65,Math.min(1.25,scale)):1;
 // Size is an actual preference, not silently capped by viewport height. Collision
 // filtering can show fewer satellites; branch controls always expose every song.
 const compact=w<600;
 const cardWidth=(compact?Math.min(56,w*.185):Math.min(96,w*.10))*s,cardHeight=cardWidth*1.25;
 const fw=compact?Math.min(128,w*.32):180,fh=Math.min(compact?180:240,h-20);
 const radius=Math.min(.40,.5-(cardHeight/2+8)/h,.5-(cardWidth/2+8)/w);
 return {width:w,height:h,rx:w*Math.max(.12,radius),ry:h*.145,cardWidth,cardHeight,focus:{x:(w-fw)/2,y:(h-fh)/2,width:fw,height:fh}};
}
export function orbitPoint(layout:OrbitLayout,branch:number,theta:number) {
 // Rotate in normalized stage space so portrait layouts retain four distinct paths.
 const tilt=branch*Math.PI/4,x=layout.rx/layout.width*Math.cos(theta),y=.145*Math.sin(theta);
 return {x:layout.width*(.5+x*Math.cos(tilt)-y*Math.sin(tilt)),y:layout.height*(.5+x*Math.sin(tilt)+y*Math.cos(tilt))};
}
export function orbitHit(layout:OrbitLayout,x:number,y:number):number|null {
 const center=layout.focus;
 if(x>=center.x-14&&x<=center.x+center.width+14&&y>=center.y-14&&y<=center.y+center.height+14)return null;
 const nx=x/layout.width-.5,ny=y/layout.height-.5;let nearest=-1,distance=Infinity;
 for(let b=0;b<4;b++){const a=b*Math.PI/4,c=Math.cos(a),s=Math.sin(a),u=nx*c+ny*s,v=-nx*s+ny*c;const d=Math.abs(Math.sqrt((u/(layout.rx/layout.width))**2+(v/.145)**2)-1);if(d<distance){distance=d;nearest=b;}}
 return distance<.42?nearest:null;
}
export function overlaps(a:OrbitRect,b:OrbitRect,gap=8){return a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;}
export function orbitBrowseIndex(phase:number,count:number){return count?((Math.floor(phase)%count)+count)%count:-1;}
export type OrbitSlot={branch:number;index:number;theta:number;rect:OrbitRect;key:string};
export function orbitSlots(layout:OrbitLayout,counts:number[],phases:number[]):OrbitSlot[]{
 const accepted:OrbitSlot[]=[];
 for(let branch=0;branch<4;branch++){
  const count=counts[branch]||0;if(!count)continue;
  const phase=phases[branch]||0,base=Math.floor(phase),frac=phase-base,seen=new Set<number>();
  for(let offset=0;offset<2;offset++){
   const index=((base+offset)%count+count)%count;if(seen.has(index))continue;seen.add(index);
   const theta=(offset-frac)*Math.PI,p=orbitPoint(layout,branch,theta),rect={x:p.x-layout.cardWidth/2,y:p.y-layout.cardHeight/2,width:layout.cardWidth,height:layout.cardHeight};
   if(rect.x<6||rect.y<6||rect.x+rect.width>layout.width-6||rect.y+rect.height>layout.height-6||overlaps(rect,layout.focus,2)||accepted.some(slot=>overlaps(rect,slot.rect,4)))continue;
   accepted.push({branch,index,theta,rect,key:`${branch}:${index}`});
  }
 }
 return accepted;
}
