export type Activity={id:string;name:string;state:'running'|'cancelling'|'cancelled'|'complete'|'failed';done:number;total:number;message:string;result?:unknown;importBusy?:boolean;importToken?:string};
type Invoke=<T>(args:Record<string,unknown>)=>Promise<T>;
type Work=(signal:AbortSignal,report:(done:number,total:number,message:string)=>void)=>Promise<unknown>;
let snapshot:Activity[]=[];
const listeners=new Set<()=>void>(),operations=new Map<string,{work:Work;controller:AbortController}>();
function update(id:string,patch:Partial<Activity>){snapshot=snapshot.map(row=>row.id===id?{...row,...patch}:row);listeners.forEach(fn=>fn());}
export const activitySnapshot=()=>snapshot;
export const observeActivities=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
async function execute(id:string){const operation=operations.get(id);if(!operation)return;const {controller,work}=operation;update(id,{state:'running',message:''});try{const result=await work(controller.signal,(done,total,message)=>{if(!controller.signal.aborted)update(id,{done,total,message});});controller.signal.throwIfAborted();update(id,{state:'complete',result,message:'处理完成'});}catch(error){update(id,{state:controller.signal.aborted?'cancelled':'failed',message:controller.signal.aborted?'已取消，已经保存的结果保留':error instanceof Error?error.message:String(error)});}}
export function startActivity(name:string,work:Work){while(snapshot.length>=20){const old=snapshot.find(row=>!['running','cancelling'].includes(row.state)&&!row.importBusy&&!row.importToken);if(!old)throw Error('后台任务已满，请等待或取消已有任务');snapshot=snapshot.filter(row=>row.id!==old.id);operations.delete(old.id);}const id=crypto.randomUUID();snapshot=[...snapshot,{id,name,state:'running',done:0,total:0,message:''}];operations.set(id,{work,controller:new AbortController()});listeners.forEach(fn=>fn());void execute(id);return id;}
export function cancelActivity(id:string){const operation=operations.get(id),row=snapshot.find(row=>row.id===id);if(!operation||row?.state!=='running')return;update(id,{state:'cancelling',message:'正在取消当前操作'});operation.controller.abort();}
export function retryActivity(id:string){const row=snapshot.find(row=>row.id===id),old=operations.get(id);if(!old||!row||!['failed','cancelled'].includes(row.state))return;operations.set(id,{work:old.work,controller:new AbortController()});void execute(id);}
export function finishActivity(id:string){const row=snapshot.find(row=>row.id===id);if(row?.importBusy||row?.importToken)return;snapshot=snapshot.filter(row=>row.id!==id);operations.delete(id);listeners.forEach(fn=>fn());}
export async function confirmActivityImport(id:string,invoke:Invoke){
 const row=snapshot.find(row=>row.id===id);
 if(!row||row.state!=='complete')throw Error('后台解析结果已失效');
 if(row.importBusy)return;
 const result=row.result as {playlists?:unknown[]}|undefined;
 if(!result?.playlists)throw Error('此任务没有歌单解析结果');
 update(id,{importBusy:true});
 try{
  let token=row.importToken;
  if(token){const status=await invoke<{pending?:{token?:string}}>({operation:'lanStatus'});if(status.pending?.token!==token){update(id,{importToken:undefined});throw Error('导入预览已由其他入口处理，请先核对现有歌单，再决定是否重新导入');}}
  if(!token){const preview=await invoke<{pending?:{token?:string}}>({operation:'playlistPreview',bundle:{format:'zenix-playlist',schemaVersion:1,playlists:result.playlists}});token=preview.pending?.token;if(!token)throw Error('未能建立歌单导入预览');update(id,{importToken:token});}
  await invoke({operation:'importConfirm',token});
  update(id,{importBusy:false,importToken:undefined});finishActivity(id);
 }finally{update(id,{importBusy:false});}
}
export async function discardActivityImport(id:string,invoke:Invoke){
 const row=snapshot.find(row=>row.id===id);if(!row?.importToken||row.importBusy)return;
 update(id,{importBusy:true});
 try{const status=await invoke<{pending?:{token?:string}}>({operation:'lanStatus'});if(status.pending?.token!==row.importToken){update(id,{importToken:undefined});throw Error('导入预览已由其他入口处理，未更改其他待接收歌单');}await invoke({operation:'importDiscard',token:row.importToken});update(id,{importToken:undefined});}
 finally{update(id,{importBusy:false});}
}
