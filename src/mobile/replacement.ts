import {command} from './native';
import type {Track,PersonalState} from '../core/types';
export async function inspectMobileReplacement(id:string,song:Track,signal:AbortSignal,candidate?:Track):Promise<PersonalState>{
  return mobileReplacementRequest('replacementRun',{id,trackId:song.id,candidate},signal);
}
export async function mutateMobileReplacement(args:Record<string,unknown>,signal?:AbortSignal):Promise<PersonalState>{
  return signal?mobileReplacementRequest('replacementEdit',args,signal):command<PersonalState>('personal',{operation:'batchPlaylist',...args});
}
async function mobileReplacementRequest(action:string,args:Record<string,unknown>,signal:AbortSignal):Promise<PersonalState>{
  signal.throwIfAborted();const requestId=crypto.randomUUID();
  let rejectAbort:(error:unknown)=>void=()=>{};
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const cancel=()=>{void command('replacementCancel',{requestId}).catch(()=>{});rejectAbort(signal.reason||new DOMException('已取消','AbortError'));};
  signal.addEventListener('abort',cancel,{once:true});
  try{return await Promise.race([command<PersonalState>(action,{...args,requestId}),aborted]);}
  finally{signal.removeEventListener('abort',cancel);}
}
