import type {PersonalState,Track} from '../core/types';
/** A time bookmark follows the actual recording, rather than its playlist alias. */
export function recordingFor(track:Track,personal?:PersonalState):Track{
  if(track.playbackRecording)return {...track.playbackRecording,path:track.source==='local'?track.path:'',audioUrl:track.source==='local'?track.audioUrl:''};
  const original=personal?.playlists.filter(list=>!track.playlistId||list.id===track.playlistId).flatMap(list=>list.tracks).find(row=>row.id===track.id);
  const target=track.replacementPlayback&&(track.replacement?.target||original?.replacement?.target);
  return target?{...target,path:'',audioUrl:''}:track;
}
export function recordingIdentity(track:Partial<Track>){return `${track.source||'custom'}\0${track.providerId||''}\0${track.remoteId||track.id||''}`;}
