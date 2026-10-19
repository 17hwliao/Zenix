export type CameraPoint = {x:number;y:number};
export type StickerCamera = CameraPoint & {scale:number};
export type CameraBounds = {left:number;top:number;right:number;bottom:number};
export const MIN_STICKER_SCALE = .6;
export const MAX_STICKER_SCALE = 2;

const midpoint=(a:CameraPoint,b:CameraPoint):CameraPoint=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const distance=(a:CameraPoint,b:CameraPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
function panAxis(value:number,start:number,end:number,extent:number,origin:number){
  let low=extent-end-24,high=24-start;
  if(end-start<extent-32)low=high=(extent-(end-start))/2-start;
  // Focus may deliberately place an edge poster in the middle of empty space.
  // A new gesture can move back into bounds without jumping on its first frame.
  return Math.max(Math.min(low,origin),Math.min(Math.max(high,origin),value));
}

/** Coordinates are relative to the viewport; all animation stays on one plane. */
export class StickerCameraGesture {
  private pointers=new Map<number,CameraPoint>();
  private origin:StickerCamera={x:0,y:0,scale:1};
  private anchor:CameraPoint={x:0,y:0};
  private span=1;
  moved=false;
  get count(){return this.pointers.size;}
  has(id:number){return this.pointers.has(id);}
  ids(){return [...this.pointers.keys()];}
  down(id:number,point:CameraPoint,camera:StickerCamera){
    if(this.count>=2&&!this.has(id))return false;
    if(!this.count)this.moved=false;
    this.pointers.set(id,point);this.rebase(camera);
    if(this.count===2)this.moved=true;
    return true;
  }
  private rebase(camera:StickerCamera){
    this.origin={...camera};const points=[...this.pointers.values()];
    if(points.length===2){this.anchor=midpoint(points[0],points[1]);this.span=Math.max(1,distance(points[0],points[1]));}
    else if(points.length)this.anchor={...points[0]};
  }
  move(id:number,point:CameraPoint,bounds:CameraBounds,size:{width:number;height:number}):StickerCamera|undefined{
    if(!this.has(id))return;
    this.pointers.set(id,point);const points=[...this.pointers.values()];
    if(points.length===2){
      const center=midpoint(points[0],points[1]);
      const scale=Math.max(MIN_STICKER_SCALE,Math.min(MAX_STICKER_SCALE,this.origin.scale*distance(points[0],points[1])/this.span)),ratio=scale/this.origin.scale;
      return {scale,x:center.x-(this.anchor.x-this.origin.x)*ratio,y:center.y-(this.anchor.y-this.origin.y)*ratio};
    }
    const dx=point.x-this.anchor.x,dy=point.y-this.anchor.y;
    if(!this.moved&&Math.hypot(dx,dy)<=8)return;
    this.moved=true;const {scale}=this.origin;
    return {scale,x:panAxis(this.origin.x+dx,bounds.left*scale,bounds.right*scale,size.width,this.origin.x),y:panAxis(this.origin.y+dy,bounds.top*scale,bounds.bottom*scale,size.height,this.origin.y)};
  }
  up(id:number,camera:StickerCamera){if(!this.pointers.delete(id))return;this.rebase(camera);}
  cancel(){this.pointers.clear();this.moved=false;}
}
