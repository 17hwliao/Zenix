const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { createBundle, decodeBundle, restoreTracks, MAX_BYTES } = require('../playlist-format.cjs');
const { readBoundedFile } = require('./bounded-file.cjs');
const { PlaylistLan } = require('./playlist-lan.cjs');
const { ListeningStore } = require('./listening-store.cjs');
class Companion {
  constructor({ folder, personal, library, dialog, getWindow, broadcast, app, widget }) {
    Object.assign(this, {personal,library,dialog,getWindow,broadcast,app,widget}); this.pending = null; this.importing = false; this.timer = null; this.timerState = { endsAt: 0 };
    this.stats = new ListeningStore(folder);
    this.lan = new PlaylistLan(bundle => this.preview(bundle));
  }
  preview(bundle) { if (this.pending) throw Error('请先导入或放弃当前待接收歌单'); this.pending = { token: randomUUID(), bundle }; return this.status(); }
  status() { return { ...this.lan.status(), pending: this.pending ? { token: this.pending.token, playlists: this.pending.bundle.playlists.map(list=>({name:list.name,count:list.tracks.length,localCount:list.tracks.filter(track=>track.source==='local').length})) } : null }; }
  bundle(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length>100) throw Error('请先选择歌单');
    const lists = this.personal.snapshot().playlists.filter(list=>ids.includes(list.id));
    if (lists.length !== new Set(ids).size) throw Error('歌单已变化，请重新选择'); return createBundle(lists);
  }
  async invoke(args) {
    switch(args.operation) {
      case 'exportFile': {
        const bundle = this.bundle(args.ids); const result = await this.dialog.showSaveDialog(this.getWindow(), { title: '导出 Zenix 歌单', defaultPath: `${bundle.playlists.length===1 ? bundle.playlists[0].name.replace(/[\\/:*?"<>|]/g,'_') : 'Zenix-歌单'}.zenixlist`, filters: [{name:'Zenix 歌单',extensions:['zenixlist']}] });
        if (result.canceled || !result.filePath) return false; await fs.writeFile(result.filePath, JSON.stringify(bundle), 'utf8'); return true;
      }
      case 'importFile': {
        if(this.pending)throw Error('请先处理当前待接收歌单');
        const result = await this.dialog.showOpenDialog(this.getWindow(), { title: '导入 Zenix 歌单', properties: ['openFile'], filters: [{name:'Zenix 歌单',extensions:['zenixlist']}] });
        if (result.canceled) return this.status();
        return this.preview(decodeBundle((await readBoundedFile(result.filePaths[0], MAX_BYTES)).toString('utf8')));
      }
      case 'importConfirm': {
        if(this.importing || !this.pending || args.token!==this.pending.token) throw Error('导入预览已失效或正在导入');
        this.importing=true;
        try {const pending = this.pending; const state = await this.personal.importPlaylists(restoreTracks(pending.bundle, this.library.snapshot().tracks));
        if(this.pending===pending)this.pending=null; this.broadcast('personal:changed',state); return this.status();}finally{this.importing=false;}
      }
      case 'importDiscard': if(this.importing)throw Error('正在导入歌单');this.pending=null; return this.status();
      case 'lanStart': if(this.pending)throw Error('请先处理当前待接收歌单'); await this.lan.start(); return this.status();
      case 'lanStop': this.lan.stop(); return this.status();
      case 'lanStatus': return this.status();
      case 'lanSend': await this.lan.send(String(args.address||''),String(args.code||'').replace(/[\s-]/g,''),this.bundle(args.ids)); return true;
      case 'statsRecord': await this.stats.record(args.track,args.seconds,args.plays); return true;
      case 'stats': return this.stats.query(args.from,args.to);
      case 'timerSet': {
        const minutes = Number(args.minutes); if(!Number.isFinite(minutes)||minutes<1||minutes>720)throw Error('定时范围为 1–720 分钟');
        clearTimeout(this.timer); this.timerState={endsAt:Date.now()+minutes*60000};
        this.timer=setTimeout(()=>{this.timerState={endsAt:0}; this.broadcast('media:command','pause'); this.widget?.expired();},minutes*60000); return this.timerState;
      }
      case 'timerCancel': clearTimeout(this.timer);this.timerState={endsAt:0};return this.timerState;
      case 'timerState': return this.timerState;
      case 'saveImage': {
        if (typeof args.base64!=='string' || args.base64.length>6*1024*1024)throw Error('回忆卡图片无效');
        const bytes=Buffer.from(args.base64,'base64'); if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('图片格式无效');
        const result=await this.dialog.showSaveDialog(this.getWindow(),{title:'保存音乐回忆卡',defaultPath:'Zenix-音乐回忆.png',filters:[{name:'PNG 图片',extensions:['png']}]});if(result.canceled)return false;await fs.writeFile(result.filePath,bytes);return true;
      }
      case 'widgetOpen': return this.widget.open(args.size);
      case 'widgetUpdate': this.widget.update(args); return true;
      default: throw Error('未知音乐工具操作');
    }
  }
  stop(){this.lan.stop();clearTimeout(this.timer);this.widget?.close();}
}
module.exports={Companion};
