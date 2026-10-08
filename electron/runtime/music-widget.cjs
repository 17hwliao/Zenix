const path=require('node:path');
class MusicWidget {
  constructor({BrowserWindow,command,showApp}){Object.assign(this,{BrowserWindow,command,showApp});this.window=null;this.state={title:'还没有播放歌曲',artist:'你的音乐，自成宇宙。',playing:false};}
  open(size='3x3'){
    const sizes={'3x3':[300,300],'4x2':[400,200],'4x1':[430,130]};if(!sizes[size])throw Error('无效组件尺寸');
    if(!this.window||this.window.isDestroyed()){
      this.window=new this.BrowserWindow({width:sizes[size][0],height:sizes[size][1],minWidth:260,minHeight:115,frame:false,transparent:true,resizable:true,show:false,webPreferences:{preload:path.join(__dirname,'../widget-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
      this.window.webContents.on('will-navigate',event=>event.preventDefault());this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      this.window.webContents.once('did-finish-load',()=>{this.update(this.state);this.window?.showInactive();});
      void this.window.loadFile(path.join(__dirname,'../music-widget.html'));this.window.on('closed',()=>{this.window=null;});
    }else{this.window.setSize(...sizes[size]);this.window.show();}return true;
  }
  update(args){this.state={title:String(args.title||'还没有播放歌曲').slice(0,300),artist:String(args.artist||'').slice(0,300),playing:args.playing===true};if(this.window&&!this.window.isDestroyed())this.window.webContents.send('widget:state',this.state);}
  expired(){this.update({...this.state,playing:false});}
  trusted(event){return this.window&&!this.window.isDestroyed()&&event.sender===this.window.webContents&&event.senderFrame===event.sender.mainFrame;}
  action(action){if(['play-pause','previous','next'].includes(action))this.command(action);else if(action==='open')this.showApp();else if(action==='close')this.close();}
  close(){if(this.window&&!this.window.isDestroyed())this.window.close();}
}
module.exports={MusicWidget};
