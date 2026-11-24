import type {Track} from '../../core/types';
import {recordingIdentity} from '../recording';

interface Pairing {original:string; track:Track; file?:Blob;}

function key(track:Track) {
  return JSON.stringify([recordingIdentity(track),track.modifiedAt ?? null,track.size ?? null]);
}

function storable(track:Track):Track {
  return {id:track.id,title:track.title,artist:track.artist,album:track.album,duration:track.duration,
    providerId:track.providerId,remoteId:track.remoteId,source:track.source,modifiedAt:track.modifiedAt,size:track.size,
    path:'',audioUrl:/^yzqxy:\/\/karaoke-backing\/[a-f0-9]{64}$/.test(track.audioUrl)?track.audioUrl:''};
}

async function store<T>(mode:IDBTransactionMode, perform:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const pending=indexedDB.open('zenix-karaoke-pairs',1);
    let blocked=false;
    pending.onupgradeneeded=()=>pending.result.createObjectStore('pairs',{keyPath:'original'});
    pending.onerror=()=>reject(pending.error);
    pending.onblocked=()=>{blocked=true;reject(Error('伴奏资料暂时无法打开'));};
    pending.onsuccess=()=>{const database=pending.result;database.onversionchange=()=>database.close();if(blocked)database.close();else resolve(database);};
  });
  try {
    return await new Promise<T>((resolve,reject)=>{
      const tx=db.transaction('pairs',mode);
      tx.onabort=()=>reject(tx.error ?? Error('伴奏资料写入取消'));
      const request=perform(tx.objectStore('pairs'));
      tx.oncomplete=()=>resolve(request.result);
    });
  } finally {db.close();}
}

export async function readPairing(track:Track):Promise<Pairing | undefined> {
  const original=key(track);
  const row=await store('readonly',db=>db.get(original)) as Pairing | undefined;
  if (!row || row.original!==original || typeof row.track?.id!=='string' || typeof row.track?.audioUrl!=='string') return undefined;
  return {original,track:storable(row.track),...(row.file instanceof Blob ? {file:row.file}:{})};
}

export async function savePairing(original:Track, track:Track, file?:Blob):Promise<void> {
  // User files stay in the system file or library; a requested reusable file
  // may be kept locally, but must not silently consume unbounded storage.
  if (file && file.size>32*1024*1024) throw Error('此文件超过 32 MiB，本轮可用，无法保存为自动配对。');
  if (track.source==='local' && track.id.startsWith('karaoke-file:') && !file) throw Error('临时伴奏无法保存。');
  await store('readwrite',db=>db.put({original:key(original),track:storable(track),...(file?{file}:{})}));
}

export async function removePairing(original:Track):Promise<void> {
  await store('readwrite',db=>db.delete(key(original)));
}
