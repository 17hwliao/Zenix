import {player} from '../../core/player';
import type {Track} from '../../core/types';
import {versionPreferences} from './preferences';
import {replacementContext} from '../../core/desktopReplacement';
export async function desktopPlaybackFeature<T=unknown>(action:string,args:Record<string,unknown>={}):Promise<T>{
  if(action==='preferences')return versionPreferences.read() as T;
  if(action==='preferencesSave')return versionPreferences.write(versionPreferences.clean(args.value)) as T;
  if(action==='replacementInfo'){const track=player.snapshot.track;if(!track)return null as T;const ctx=await replacementContext(track);return (ctx?.song.replacement||track.replacement||null) as T;}
  if(action==='state')return player.practiceState() as T;
  if(action==='practice')return player.configurePractice(args) as T;
  if(action==='preview')return await player.previewVersion(args.track as Track,Number(args.start||0),Number(args.length||20)) as T;
  if(action==='previewStop')return await player.stopPreview(true) as T;
  if(action==='recover'){if(args.trackId&&player.snapshot.track?.id!==args.trackId)throw Error('当前歌曲已变化');await player.play();return player.snapshot as T;}
  throw Error('未知播放工具操作');
}
