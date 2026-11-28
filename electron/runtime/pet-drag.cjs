// Cursor positions and BrowserWindow bounds both use Electron's DIP coordinates.
// Never accept renderer-supplied screen coordinates or a target window handle.
class PetDrag {
  constructor({getWindow,screen,isLocked,now=()=>performance.now()}){Object.assign(this,{getWindow,screen,isLocked,now});this.session=null;}
  cancel(){this.session=null;}
  handle({phase,token}={}){
    if(!['start','move','end','cancel'].includes(phase))throw Error('无效桌宠拖动操作');
    if(typeof token!=='string'||!/^[\w-]{1,80}$/.test(token))throw Error('无效拖动会话');
    const win=this.getWindow();
    if(!win||win.isDestroyed()||this.isLocked()){this.cancel();return {moved:false,locked:this.isLocked()};}
    if(phase!=='start'&&this.session?.token!==token)return {moved:false,stale:true};
    if(phase==='cancel'){this.cancel();return {moved:false};}
    if(!this.screen)throw Error('桌宠拖动暂不可用');
    const cursor=this.screen.getCursorScreenPoint();
    if(!Number.isFinite(cursor.x)||!Number.isFinite(cursor.y))throw Error('无法读取鼠标位置');
    if(phase==='start'){this.session={token,win,cursor,bounds:win.getBounds(),moved:false,samples:[{...cursor,at:this.now()}]};return {moved:false};}
    const session=this.session;
    if(!session||session.win!==win)return {moved:false};
    const dx=cursor.x-session.cursor.x,dy=cursor.y-session.cursor.y;
    const at=this.now();session.samples.push({...cursor,at});session.samples=session.samples.filter(sample=>at-sample.at<=120).slice(-12);
    if(Math.hypot(dx,dy)>=4)session.moved=true;
    if(session.moved){
      const area=this.screen.getDisplayNearestPoint(cursor).workArea,b=win.getBounds();
      const x=Math.round(Math.max(area.x,Math.min(area.x+Math.max(0,area.width-b.width),session.bounds.x+dx)));
      const y=Math.round(Math.max(area.y,Math.min(area.y+Math.max(0,area.height-b.height),session.bounds.y+dy)));
      if(x!==b.x||y!==b.y)win.setPosition(x,y,false);
    }
    const moved=session.moved,first=session.samples[0],elapsed=Math.max(16,at-first.at);
    const velocity={x:(cursor.x-first.x)/elapsed*1000,y:(cursor.y-first.y)/elapsed*1000};
    if(phase==='end')this.cancel();return {moved,...(phase==='end'?{velocity}:{} )};
  }
}
module.exports={PetDrag};
