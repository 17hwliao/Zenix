import type {PersonalState,PlayerState,Track} from '../../src/core/types';
import type {AssistantLibraryHost} from '../../src/features/assistant/libraryCommands';
/** Isolated example library. Never reads a client profile or controls the real player. */
export function createAssistantDemo(changed:()=>void){
 const song=(id:string,title:string,artist:string):Track=>({id,title,artist,path:'',audioUrl:'',source:'custom',providerId:'demo',remoteId:id,duration:240});
 const songs=[song('demo-1','晴天','周杰伦'),song('demo-2','像风一样','薛之谦'),song('demo-3','如果的事','范玮琪 / 张韶涵')];
 const personal:PersonalState={liked:[],favorites:[],history:songs.map((track,index)=>({id:track.id,track,playedAt:Date.now()-index*1000})),playlists:[{id:'demo-list',name:'通勤',tracks:structuredClone(songs)}]};
 const playback={track:{...songs[0],playlistId:'demo-list'},queue:[songs[1],songs[0],songs[2]],queueIndex:1,position:15,playing:false} as PlayerState;
 let page='主页',playlistId:string|undefined;
 const host:AssistantLibraryHost={
  snapshot:async()=>structuredClone({personal,playback,context:{playlistId,collection:playlistId?'playlist':'home'}}),
  lyrics:async()=>({text:'[00:00]示例歌词第一句\n[00:12]这是独立验收使用的原创示例歌词\n[00:25]音乐继续向前',format:'lrc',source:'custom'}),
  navigate:async(next,id)=>{page=next==='home'?'主页':personal.playlists.find(list=>list.id===id)!.name;playlistId=next==='home'?undefined:id;changed();},
  create:async(name,track)=>{if(personal.playlists.some(list=>list.name===name))throw Error('已有同名歌单');personal.playlists.push({id:crypto.randomUUID(),name,tracks:track?[track]:[]});changed();return structuredClone(personal);},
  remove:async(id,ids,expected)=>{const list=personal.playlists.find(row=>row.id===id)!;if(JSON.stringify(list.tracks.map(track=>track.id))!==JSON.stringify(expected))throw Error('歌单已经变化');list.tracks=list.tracks.filter(track=>!ids.includes(track.id));changed();return structuredClone(personal);},
  collect:async(kinds,tracks)=>{for(const kind of kinds as ('liked'|'favorites')[])for(const track of tracks)if(!personal[kind].some(row=>row.id===track.id))personal[kind].push(structuredClone(track));changed();return structuredClone(personal);},
 };
 return {host,describe:()=>({page,personal:structuredClone(personal)})};
}
