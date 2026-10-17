const path=require('node:path'),fs=require('node:fs');
class MusicWidget {
  constructor({BrowserWindow,command,showApp,folder,screen}){Object.assign(this,{BrowserWindow,command,showApp,screen});this.file=folder?path.join(folder,'music-widget-state.json'):null;this.layout={};try{if(this.file&&fs.statSync(this.file).size<4096)this.layout=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')this.layoutReadOnly=true;}this.window=null;this.state={title:'还没有播放歌曲',artist:'你的音乐，自成宇宙。',playing:false};}
  open(size='3x3'){
    const sizes={'3x3':[300,300],'4x2':[400,200],'4x1':[430,130]};if(!sizes[size])throw Error('无效组件尺寸');
    if(!this.window||this.window.isDestroyed()){
      this.window=new this.BrowserWindow({width:sizes[size][0],height:sizes[size][1],minWidth:260,minHeight:115,useContentSize:true,frame:false,transparent:true,resizable:true,alwaysOnTop:this.layout.pinned===true,show:false,webPreferences:{preload:path.join(__dirname,'../widget-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
      const bounds=this.layout.bounds;
      if(bounds&&['x','y','width','height'].every(key=>Number.isFinite(bounds[key]))&&this.screen){const area=this.screen.getDisplayMatching(bounds).workArea;this.window.setBounds({x:Math.max(area.x,Math.min(area.x+area.width-260,bounds.x)),y:Math.max(area.y,Math.min(area.y+area.height-115,bounds.y)),width:Math.max(260,Math.min(area.width,bounds.width)),height:Math.max(115,Math.min(area.height,bounds.height))});}
      this.window.on('moved',()=>{const win=this.window;if(!win||win.isDestroyed()||!this.screen)return;const b=win.getBounds(),area=this.screen.getDisplayMatching(b).workArea;const x=Math.abs(b.x-area.x)<14?area.x:Math.abs(b.x+b.width-area.x-area.width)<14?area.x+area.width-b.width:b.x;const y=Math.abs(b.y-area.y)<14?area.y:Math.abs(b.y+b.height-area.y-area.height)<14?area.y+area.height-b.height:b.y;if(x!==b.x||y!==b.y)win.setPosition(x,y);this.saveLayout();});
      this.window.on('resized',()=>this.saveLayout());this.window.on('close',()=>this.saveLayout());
      this.window.webContents.on('will-navigate' ,event=>event.preventDefault());this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      this.window.webContents.once('did-finish-load',()=>{this.sent='';this.update(this.state);this.window?.showInactive();});
      void this.window.loadFile(path.join(__dirname,'../music-widget.html'));this.window.on('closed',()=>{this.window=null;});
    }else{this.window.setContentSize(...sizes[size]);this.window.show();}return true;
  }
  update(args){this.state={...this.state,title:String(args.title||'还没有播放歌曲').slice(0,300),artist:String(args.artist||'').slice(0,300),playing:args.playing===true,pinned:this.layout.pinned===true};if(this.window&&!this.window.isDestroyed()){const key=JSON.stringify(this.state);if(this.sent!==key){this.sent=key;this.window.webContents.send('widget:state',this.state);}}}
  expired(){this.update({...this.state,playing:false});}
  trusted(event){return this.window&&!this.window.isDestroyed()&&event.sender===this.window.webContents&&event.senderFrame===event.sender.mainFrame;}
  action(action){if(['play-pause','previous','next'].includes(action))this.command(action);else if(action==='open')this.showApp();else if(action==='pin'&&this.window){this.layout.pinned=!this.layout.pinned;this.window.setAlwaysOnTop(this.layout.pinned);this.saveLayout();this.update(this.state);}else if(action==='compact'&&this.window)this.window.setContentSize(430,130);else if(action==='expand'&&this.window)this.window.setContentSize(300,300);else if(action==='close')this.close();}
  saveLayout(){if(!this.file||this.layoutReadOnly||!this.window||this.window.isDestroyed())return;this.layout.bounds=this.window.getBounds();try{fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.layout));fs.renameSync(this.file+'.tmp',this.file);}catch{ /* Layout preferences do not interrupt playback. */ }}
  close(){if(this.window&&!this.window.isDestroyed())this.window.close();}
}
module.exports={MusicWidget};
