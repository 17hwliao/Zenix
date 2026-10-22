import {readSpace,commitSpace} from './state';
export async function desktopSpaceFeature<T=unknown>(args:Record<string,unknown>):Promise<T>{if(args.action==='read')return readSpace() as T;if(args.action==='save')return commitSpace(args.value) as T;if(args.action==='roaming'){const {roaming}=await import('../../core/roaming');return await roaming.feature(args) as T;}throw Error('未知音乐空间操作');}
