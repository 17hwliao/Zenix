const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const model=require('../../src/features/personal/model.cjs');
class PersonalFeatures {
  constructor({folder,personal,broadcast=()=>{},exclusive}) {this.file=path.join(folder,'personal-features.json');this.personal=personal;this.broadcast=broadcast;this.exclusive=exclusive||((fn)=>fn());this.state=model.empty();this.queue=Promise.resolve();this.failure='';this.pending=null;}
  async write(file,value){const temporary=`${file}.${randomUUID()}.tmp`;try{await fs.writeFile(temporary,JSON.stringify(value),'utf8');await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}}
  async read(file){const stat=await fs.stat(file);if(stat.size>model.LIMITS.bytes)throw Error('私人资料过大，已保留原文件');return JSON.parse(await fs.readFile(file,'utf8'));}
  async load(){try{this.state=model.clean(await this.read(this.file));}catch(error){if(error.code!=='ENOENT'){this.failure='私人资料无法读取，已保留原文件并停止写入';throw Error(this.failure);}}
    return this.snapshot();}
  snapshot(){return structuredClone({...this.state,journal:this.personal.playlistJournal||this.state.journal,notice:this.personal.journalNotice||''});}
  assertWritable(){if(this.failure)throw Error(this.failure);}
  async persist(next){this.assertWritable();const cleaned=model.clean({...next,journal:[]});await this.write(this.file,cleaned);this.state=cleaned;return this.snapshot();}
  serial(fn){const run=this.queue.catch(()=>{}).then(()=>{this.assertWritable();return fn();});this.queue=run.catch(()=>{});return run;}
  async invoke(args){return this.serial(()=>this.exclusive(async()=>{
    switch(args.action){
      case 'read':return this.snapshot();
      case 'collectionAdd':{if(!['liked','favorites'].includes(args.kind))throw Error('收藏分类无效');const track=model.trackRef(args.track);if(track.source==='local'||!track.remoteId)throw Error('跨端收藏需要有效在线歌曲引用');const before=this.personal.snapshot();if(before[args.kind].some(row=>model.key(row)===model.key(track)))return before;const next=structuredClone(before);next[args.kind].unshift({...track,path:'',audioUrl:''});this.personal.data=next;try{await this.personal.save();}catch(error){this.personal.data=before;throw error;}this.broadcast('personal:changed',this.personal.snapshot());return this.personal.snapshot();}
      case 'bookmarkAdd':return this.persist(model.addBookmark(this.state,args,randomUUID,Date.now()));
      case 'bookmarkDelete':{const next=this.snapshot();next.bookmarks=next.bookmarks.filter(row=>row.id!==args.id);next.revision++;return this.persist(next);}
      case 'lyricsSave':return this.persist(model.saveLyrics(this.state,args.track,args.text,Date.now()));
      case 'search':return model.search(this.state,this.personal.snapshot(),String(args.query||'').slice(0,500));
      case 'undo':{const result=model.undo({...this.state,journal:this.personal.playlistJournal||[]},this.personal.snapshot(),args.id),before=this.personal.snapshot(),journal=this.personal.playlistJournal;this.personal.data=result.personal;this.personal.playlistJournal=result.state.journal;try{await this.personal.save({skipJournal:true});}catch(error){this.personal.data=before;this.personal.playlistJournal=journal;throw error;}this.broadcast('personal:changed',this.personal.snapshot());return this.snapshot();}
      case 'backupExport':{const extension={...this.snapshot(),journal:[]},payload=JSON.stringify({personal:{},extensions:{personalFeatures:extension}});return JSON.stringify({format:'zenix-backup',schemaVersion:1,createdAt:Date.now(),payload,sha256:createHash('sha256').update(payload).digest('hex')});}
      case 'backupPreview':{if(typeof args.text!=='string'||Buffer.byteLength(args.text)>model.LIMITS.bytes)throw Error('备份文件超过12 MiB');const raw=JSON.parse(args.text);if(raw.format!=='zenix-backup'||raw.schemaVersion!==1||typeof raw.payload!=='string'||raw.sha256!==createHash('sha256').update(raw.payload).digest('hex'))throw Error('备份格式或完整性校验失败');const payload=JSON.parse(raw.payload);if(!payload.extensions?.personalFeatures)throw Error('此备份没有私人书签扩展，请使用常规资料备份入口恢复歌单');const incoming=model.clean(payload.extensions.personalFeatures);this.pending={token:randomUUID(),incoming,revision:this.state.revision};return {...model.previewMerge(this.state,incoming),token:this.pending.token};}
      case 'backupApply':{if(!this.pending||args.token!==this.pending.token||this.state.revision!==this.pending.revision)throw Error('资料或预览已变化，请重新预览');const next=model.merge(this.state,this.pending.incoming,randomUUID);await this.persist(next);this.pending=null;return this.snapshot();}
      case 'backupDiscard':this.pending=null;return true;
      default:throw Error('未知私人资料操作');
    }
  }));}
}
module.exports={PersonalFeatures};
