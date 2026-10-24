import type {ControlHost} from './controlCommands';
import {libraryHost} from './libraryHost';
import {command} from '../../mobile/native';
import {readSpace,writeSpace,commitSpace,captureSpace,type SpaceState} from '../space/state';
import {readLocal,writeLocal} from '../../core/listening';
import {updatePreferences,invokeUpdate} from '../../core/updates';
import {requestAssistantUi} from './controlUi';
import {followHandoff} from '../connections/handoffCoordinator';
import {pauseHost} from '../featureHost';
export function controlHost(mobile:boolean):ControlHost{
 const library=libraryHost(mobile);
 const invoke=async<T,>(args:Record<string,unknown>):Promise<T>=>{
  if(args.operation==='collaboration')return mobile?command<T>('collaboration',args):window.yzqxy!.desktop.invoke<T>(args);
  if(args.operation==='spaceFeatures'&&!mobile)return (await import('../space/desktop')).desktopSpaceFeature<T>(args);
  return mobile?command<T>('features',args):window.yzqxy!.companion!.invoke(args) as Promise<T>;
 };
 return {library,invoke,ui:requestAssistantUi,capture:captureSpace,
  space:()=>mobile?command('features',{operation:'spaceFeatures',action:'read'}):Promise.resolve(readSpace()),
  saveSpace:async(value:SpaceState)=>{if(!mobile)return commitSpace(value);const saved=await invoke<SpaceState>({operation:'spaceFeatures',action:'save',value});writeSpace(saved);return saved;},
  mode:async()=>{if(mobile)await command('mode',{repeat:'one',shuffle:false});else{const {player}=await import('../../core/player');player.setRepeat('one');if(player.snapshot.shuffle)player.setShuffle(false);}},
  volume:async value=>{if(mobile)await command('volume',{value});else(await import('../../core/player')).player.setVolume(value);},
  offset:async(id,delta)=>{const key=`zenix.lyric.${id}`,raw=readLocal<Record<string,unknown>>(key,{}),offset=Math.max(-30,Math.min(30,(typeof raw.offset==='number'&&Number.isFinite(raw.offset)?raw.offset:0)+delta));writeLocal(key,{...raw,offset});if(localStorage.getItem(key)!==JSON.stringify({...raw,offset}))throw Error('歌词设置未能保存。');if(mobile)await command('lyricsConfigure',{id,offset});return offset;},
  overlayOff:async()=>{if(mobile)await command('overlayEnable',{enabled:false});else{const overlay=window.yzqxy!.desktopLyrics;if(await overlay.isVisible())await overlay.toggle();}},
  updates:()=>invokeUpdate({operation:'check',channel:updatePreferences().channel}),
  transfer:async(kind,signal)=>{
   if(!mobile)throw Error('当前已经在电脑上，请从已配对手机发起这条指令。');
   const status=await invoke<{phase:string}>({operation:'collaboration',action:'status'});signal?.throwIfAborted();
   if(status.phase!=='connected'){requestAssistantUi('connections');throw Error('尚未连接电脑，请先完成局域网配对。');}
   const state=await invoke<{permissions?:{handoff:boolean;submission:boolean}}>({operation:'collaboration',action:'state'});signal?.throwIfAborted();
   if(!state.permissions?.[kind])throw Error('电脑尚未授予这项协作权限，请在电脑的设备协作中允许。');
   const {playback}=await library.snapshot();signal?.throwIfAborted();
   if(!playback.track)throw Error('请先选择歌曲。');if(playback.track.source==='local')throw Error('本地音频无法通过歌曲清单接力，请先在电脑导入原文件。');
   const ticket=await invoke<{id:string}>({operation:'collaboration',action:'send',payload:{kind,track:playback.track,...(kind==='handoff'?{queue:playback.queue,position:playback.position,playing:playback.playWhenReady??playback.playing}:{})}});
   if(kind==='handoff'&&(playback.playWhenReady??playback.playing))followHandoff(invoke,ticket.id,{id:playback.track.id,selection:playback.selectionRevision},expected=>pauseHost(true,expected));
   return {reply:'请求已发送，等待电脑确认；手机继续保留当前播放。可在设备协作中查看或取消尚未处理的请求。'};
  },
 };
}
