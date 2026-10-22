import type {Track} from '../core/types';
import {command,type MobileSnapshot} from '../mobile/native';
import {recordingFor,recordingIdentity} from './recording';

export async function openRecording(mobile:boolean,song:Track,queue:Track[],seconds:number|null,signal:AbortSignal){
 signal.throwIfAborted();
 if(mobile){
  const initial=await command<MobileSnapshot>('snapshot');signal.throwIfAborted();
  const current=initial.playback.track&&recordingFor(initial.playback.track,initial.personal);
  const selected=current&&recordingIdentity(current)===recordingIdentity(song)?initial:await command<MobileSnapshot>('play',{tracks:queue,index:queue.findIndex(track=>track.id===song.id)});
  signal.throwIfAborted();
  if(!selected.playback.track)throw Error('未能选择书签对应的歌曲');
  if(seconds!==null)await command('seek',{seconds,expected:{selectionRevision:selected.playback.selectionRevision,id:selected.playback.track.id,recordingIdentity:recordingIdentity(song)}});
 }else{
  const {player}=await import('../core/player');signal.throwIfAborted();
  const current=player.snapshot.track&&recordingFor(player.snapshot.track);
  const same=current&&recordingIdentity(current)===recordingIdentity(song);
  const preparing=same?undefined:player.playTrack(song,queue);
  const selected=player.snapshot;if(!selected.track)throw Error('未能选择书签对应的歌曲');
  const expected={selectionRevision:selected.selectionRevision,id:selected.track.id,recordingIdentity:recordingIdentity(song)};
  await preparing;signal.throwIfAborted();
  if(seconds!==null)player.seek(seconds,expected);
 }
}
