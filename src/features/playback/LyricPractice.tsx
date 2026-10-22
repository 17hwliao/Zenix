import {useEffect,useRef,useState} from 'react';
import type {LyricLine,RawLyrics,Track} from '../../core/types';
import {parseLyrics} from '../../core/lyrics';
import {useLyricDisplay} from '../../core/listening';
import type {PlaybackFeatureInvoke} from './PlaybackFeaturesPanel';
import {recordingFor,recordingIdentity} from '../recording';
const expectedVersion=(track:Track)=>({id:track.id,remoteId:track.remoteId||'',replacementPlayback:track.replacementPlayback||'',playbackProviderId:track.playbackProviderId||'',recordingId:track.playbackRecording?.remoteId||'',recordingIdentity:recordingIdentity(recordingFor(track))});
export default function LyricPractice({track,readLyrics,invoke}:{track?:Track;readLyrics:(track:Track)=>Promise<RawLyrics|null>;invoke:PlaybackFeatureInvoke}){
 const version=track?JSON.stringify(expectedVersion(track)):'';
 const [display]=useLyricDisplay(track);
 const [lines,setLines]=useState<LyricLine[]>([]),[start,setStart]=useState(0),[end,setEnd]=useState(0),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState('');
 const current=useRef(version),request=useRef(0);current.current=version;
 useEffect(()=>{request.current++;setLines([]);setLoaded('');setStart(0);setEnd(0);setBusy(false);setMessage('');return()=>{request.current++;};},[version]);
 async function read(){if(!track)return;const token=++request.current,id=version;setBusy(true);try{const raw=await readLyrics(track);if(token!==request.current||current.current!==id)return;const next=raw?parseLyrics(raw):[];setLines(next);setLoaded(id);setEnd(Math.max(0,Math.min(1,next.length-1)));setMessage(next.length?'':'当前歌曲暂无带时间的歌词');}catch(error){if(token===request.current&&current.current===id)setMessage(String(error));}finally{if(token===request.current)setBusy(false);}}
 async function practice(){if(!track||loaded!==version)return;const token=request.current;setBusy(true);try{const until=lines[end+1]?.time??lines[end].endTime??recordingFor(track).duration,a=Math.max(0,lines[start].time+display.offset),b=Math.max(0,until+display.offset);if(!until||b<=a)throw Error('无法确定末句结束时间，请使用 A–B 时间选区');await invoke('practice',{enabled:true,start:a,end:b,expected:expectedVersion(track)});if(token===request.current)setMessage('已开始歌词范围循环');}catch(error){if(token===request.current)setMessage(String(error));}finally{if(token===request.current)setBusy(false);}}
 return <section><h3>按歌词选择练习片段</h3><p>选择起止句，以当前歌词校正时间设置循环；不同录音版本需要重新选区。</p><button disabled={!track||busy} onClick={()=>void read()}>读取当前歌词</button>{loaded===version&&lines.length>0&&<><label>开始句<select value={start} onChange={event=>setStart(Number(event.target.value))}>{lines.map((line,index)=><option key={index} value={index}>{line.text}</option>)}</select></label><label>结束句<select value={end} onChange={event=>setEnd(Number(event.target.value))}>{lines.map((line,index)=><option key={index} value={index}>{line.text}</option>)}</select></label><button disabled={busy||end<start} onClick={()=>void practice()}>循环所选歌词</button></>}{message&&<p role="status">{message}<button onClick={()=>setMessage('')}>关闭提示</button></p>}</section>;
}
