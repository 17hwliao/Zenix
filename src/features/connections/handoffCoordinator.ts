type Expected={id:string;selection?:number};
type Invoke=<T>(args:Record<string,unknown>)=>Promise<T>;
const jobs=new Map<string,{timer:ReturnType<typeof setTimeout>|null}>();
/** Pending receipts belong to the handoff, not to the settings panel lifetime. */
export function followHandoff(invoke:Invoke,id:string,expected:Expected,pause:(expected:Expected)=>Promise<void>|void){
  if(jobs.has(id))return;const job={timer:null as ReturnType<typeof setTimeout>|null};jobs.set(id,job);let failures=0;
  const finish=()=>{if(job.timer)clearTimeout(job.timer);jobs.delete(id);};
  const poll=async()=>{try{const state=await invoke<{tickets?:{id:string;status:string}[]}>({operation:'collaboration',action:'state'});const ticket=state.tickets?.find(value=>value.id===id);if(!ticket){finish();return;}if(ticket.status==='accepted'){finish();await pause(expected);window.dispatchEvent(new CustomEvent('zenix-handoff-status',{detail:'接收端已确认，原设备按当前播放状态完成接力。'}));return;}if(!['pending','processing'].includes(ticket.status)){finish();return;}failures=0;}catch{if(++failures>=3){finish();window.dispatchEvent(new CustomEvent('zenix-handoff-status',{detail:'接力回执暂不可达，原设备继续播放。'}));return;}}job.timer=setTimeout(()=>void poll(),1500);};
  void poll();
}
