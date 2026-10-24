import {readLocal} from '../../core/listening';
import type {RawLyrics} from '../../core/types';
import {command,type MobileSnapshot} from '../../mobile/native';
import {assistantLibraryContext} from './libraryContext';
import type {AssistantLibraryHost} from './libraryCommands';
export type AssistantNavigation={page:'home'|'playlist';id?:string;accept:()=>void};
export function libraryHost(mobile:boolean):AssistantLibraryHost{
 return {
  snapshot:async()=>{if(mobile){const value=await command<MobileSnapshot>('snapshot');return {...value,context:assistantLibraryContext()};}const {player}=await import('../../core/player');const personal=await window.yzqxy!.personal.load();return {personal,playback:structuredClone(player.snapshot),context:assistantLibraryContext()};},
  lyricOffset:id=>{const value=readLocal<{offset?:number}>(`zenix.lyric.${id}`,{}).offset;return typeof value==='number'&&Number.isFinite(value)?Math.max(-30,Math.min(30,value)):0;},
  lyrics:async track=>mobile?command<RawLyrics|null>('lyrics',{track}):track.source==='local'?window.yzqxy!.library.readLyrics(track.id):window.yzqxy!.sources.lyrics(track),
  navigate:async(page,id)=>{let accepted=false;window.dispatchEvent(new CustomEvent<AssistantNavigation>('zenix-assistant-navigate',{detail:{page,id,accept:()=>{accepted=true;}}}));if(!accepted)throw Error('当前界面暂时无法跳转，请返回播放器后再试。');window.dispatchEvent(new CustomEvent('zenix-assistant-navigation-applied'));},
  create:(name,track)=>mobile?command('personal',{operation:'createPlaylist',name,track}):window.yzqxy!.personal.createPlaylist(name,track),
  remove:(id,ids,expected)=>mobile?command('personal',{operation:'batchPlaylist',id,edit:'remove',ids,expected}):window.yzqxy!.personal.batch({id,edit:'remove',ids,expected}),
  collect:(kinds,tracks)=>mobile?command('personal',{operation:'collectMany',kinds,tracks}):window.yzqxy!.personal.collectMany(kinds,tracks),
 };
}
