import {useEffect,useMemo,useRef,useState} from 'react';
import type {
  InstalledSource,
  KaraokeGeneratedChart,
  KaraokeGenerationLyricLine,
  KaraokeGenerationProgress,
  KaraokeGenerationResult,
  KaraokeSeparationState,
  RawLyrics,
  Track,
} from '../../core/types';
import {recordingIdentity} from '../recording';
import type {KaraokeImportFile} from './adapter';
import {
  generatedBackingTrack,
  generatedBackingDigest,
  progressStage,
  timedLyricsFromRaw,
  unavailableGenerationMessage,
  type LocalGenerationState,
  type LocalGenerationStage,
} from './local-generation';
import {discardRevokedBlobCandidate,discoverAccompaniment,verifyAccompaniment,type AccompanimentDiscoveryResult} from './prep-accompaniment';
import {confirmPreparedChart,discoverChart,loadOpenChartCandidate,validatePreparedChart,type ChartDiscovery,type VerifiedChart} from './prep-chart';
import {readPairing,removePairing,savePairing} from './prep-pairing';
import {comparableLength} from './solo-assets';
import {prepareSoloAudio,type SoloAudio} from './solo-audio';
import type {OpenChart} from './open-charts';

type Phase<T> = T | {status:'pending'|'cancelled';message?:string};
type ChartDraft = {
  file:KaraokeImportFile;
  chart:VerifiedChart;
  source:'imported'|'open'|'generated';
  generated?:KaraokeGeneratedChart;
};
type Preview = {track:Track;playing:boolean;loading:boolean;verified:boolean};
type SplitResult = KaraokeSeparationState;
type SplitApi = {
  lookup(track:Track,requestId:string):Promise<SplitResult>;
  inspect(track:Track,requestId:string):Promise<SplitResult>;
  generate(track:Track,requestId:string):Promise<SplitResult>;
  cancel(requestId:string):Promise<void>;
};
type GenerationApi = SplitApi & {
  generateWithChart(
    track:Track,
    requestId:string,
    lyrics:readonly KaraokeGenerationLyricLine[],
    options:{schemaVersion:1},
  ):Promise<KaraokeGenerationResult>;
  onGenerationProgress(callback:(progress:KaraokeGenerationProgress)=>void):()=>void;
};
type GenerationRun = {
  request:AbortController;
  requestId:string;
  originalKey:string;
  stage:LocalGenerationStage;
};

const reference = (track?:Track) => track ? JSON.stringify([recordingIdentity(track),track.size,track.modifiedAt,track.duration]) : '';
const readableError = (error:unknown,message:string) => error instanceof Error ? error.message : message;

const hasIndependentSource = (original:Track,candidate:Track) => (
  reference(original)!==reference(candidate) && candidate.id!==original.id && (
    candidate.source === 'local' || Boolean(candidate.remoteId && candidate.providerId)
  )
);

function localLibraryTrack(track:Track, library:readonly Track[]):Track {
  return track.source==='local' && !track.audioUrl
    ? library.find(row=>row.source==='local' && reference(track)===reference(row)) ?? track
    : track;
}

function splitTrack(source:Track, result:SplitResult):Track | undefined {
  if (result.status!=='cached' || !/^[a-f0-9]{64}$/.test(result.key ?? '') || !result.duration || !Number.isFinite(result.duration) || result.duration<=0) return;
  if (!comparableLength(source.duration,result.duration)) return;
  return {id:'karaoke-separated:'+result.key,title:source.title+' · 本地生成', artist:source.artist,
    source:'local',path:'',audioUrl:'yzqxy://karaoke-backing/'+result.key,duration:result.duration};
}
export function useKaraokePreparation(
  original:Track | undefined,
  tracks:readonly Track[],
  sources:readonly InstalledSource[],
  mobile:boolean,
  readLyrics:(track:Track)=>Promise<RawLyrics | null>,
) {
  const [backing,setBacking] = useState<Phase<AccompanimentDiscoveryResult>>({status:'pending'});
  const [chart,setChart] = useState<Phase<ChartDiscovery>>({status:'pending'});
  const [pair,setPair] = useState<Track>();
  const [draft,setDraft] = useState<ChartDraft>();
  const [preview,setPreview] = useState<Preview>();
  const [working,setWorking] = useState(false);
  const [notice,setNotice] = useState('');
  const [split,setSplit] = useState<SplitResult>();
  const [generation,setGeneration] = useState<LocalGenerationState>({status:'idle'});
  const baseSearch=useRef<AbortController>(undefined);
  const chartSearch=useRef<AbortController>(undefined);
  const currentAction=useRef<AbortController>(undefined);
  const generationRun=useRef<GenerationRun>(undefined);
  const currentPreview=useRef<{request:AbortController; audio?:SoloAudio}>(undefined);
  const pairRef=useRef<Track>(undefined);
  const pairingUrl=useRef('');
  const localDigest=useRef<string>(undefined);
  const trustedChart=useRef<{pair:string; chart:VerifiedChart}>(undefined);
  const previewed=useRef<Track>(undefined);
  const deferredBacking=useRef(false);
  const choice=useRef(false);
  const chartChoice=useRef(false);
  const library=useRef(tracks);library.current=tracks;
  const sourcesRef=useRef(sources);sourcesRef.current=sources;
  const alive=useRef(false);
  const active=useRef(false);
  const [retry,setRetry]=useState(0);
  const [chartRetry,setChartRetry]=useState(0);
  const originalRef=useRef(original);originalRef.current=original;
  const readLyricsRef=useRef(readLyrics);readLyricsRef.current=readLyrics;
  const splitApi = !mobile ? window.yzqxy?.karaokeSeparation : undefined;
  const generationApi = splitApi?.generateWithChart && typeof splitApi.onGenerationProgress==='function'
    ? splitApi as GenerationApi : undefined;
  const sourceSignature=useMemo(()=>JSON.stringify(sources.filter(source=>source.enabled).map(source=>[
    source.id,source.catalog,source.sha256,source.manifest.version,source.manifest.capabilities,source.networkPolicy,
  ])),[sources]);
  const originalKey=reference(original);
  const originalKeyRef=useRef(originalKey);originalKeyRef.current=originalKey;

  function disposePreview(reset=true) {
    const current=currentPreview.current;
    currentPreview.current=undefined;
    current?.request.abort();current?.audio?.dispose();
    if (reset) {
      previewed.current=undefined;
      if (alive.current) setPreview(undefined);
    }
  }

  useEffect(()=>{
    alive.current=true;
    return ()=>{
      alive.current=false;
      disposePreview(false);
      currentAction.current?.abort();
      generationRun.current?.request.abort();
      generationRun.current=undefined;
      if (pairingUrl.current) URL.revokeObjectURL(pairingUrl.current);
    };
  },[]);

  useEffect(()=>{
    if (!generationApi) return;
    return generationApi.onGenerationProgress(progress=>{
      const current=generationRun.current;
      if (!current || current.request.signal.aborted || progress.requestId!==current.requestId
        || originalKeyRef.current!==current.originalKey || active.current) return;
      const stage=progressStage(progress.stage);
      if (!stage || stage===current.stage) return;
      current.stage=stage;
      setGeneration({status:'running',stage});
    });
  },[generationApi]);

  useEffect(()=>{
    return ()=>{
      currentAction.current?.abort();
      currentAction.current=undefined;
      generationRun.current?.request.abort();
      generationRun.current=undefined;
      choice.current=false;
      chartChoice.current=false;
      trustedChart.current=undefined;
      setGeneration({status:'idle'});
      setWorking(false);
    };
  },[originalKey]);

  function acceptPair(value?:Track,url='',digest?:string) {
    if (pairingUrl.current && pairingUrl.current!==url) URL.revokeObjectURL(pairingUrl.current);
    pairingUrl.current=url;
    localDigest.current=digest || generatedBackingDigest(value);
    pairRef.current=value;
    trustedChart.current=undefined;
    chartChoice.current=false;
    setDraft(undefined);
    setPair(value);
  }

  useEffect(()=>{
    const selected=originalRef.current;
    if (!selected || choice.current) return;
    const request=new AbortController();
    baseSearch.current=request;
    setBacking({status:'pending'});
    setSplit(undefined);
    void (async()=>{
      let saved:Awaited<ReturnType<typeof readPairing>>;
      try {saved=await readPairing(selected);}
      catch {if (!request.signal.aborted && !choice.current) setNotice('已确认的伴奏暂时无法读取，仍会查询可用音源。');}
      if (request.signal.aborted || choice.current) return;
      let url='', digest:string|undefined;
      try {
        let preferred=saved?.track ? localLibraryTrack(saved.track,library.current) : undefined;
        if (preferred && saved?.file) {
          digest=await digestBlob(saved.file,request.signal);
          url=URL.createObjectURL(saved.file);
          preferred={...preferred,audioUrl:url};
        }
        let generatedTrack:Track|undefined;
        if (splitApi && !preferred) {
          try {
            const details=await runSplit(splitApi,'lookup',selected,request.signal);
            if (request.signal.aborted || choice.current) return;
            generatedTrack=splitTrack(selected,details);
            if (generatedTrack) setSplit(details);
          } catch { /* A cache lookup is optional; network discovery still runs. */ }
        }
        preferred ??= generatedTrack;
        let result=await discoverAccompaniment(selected,sourcesRef.current,mobile,request.signal,preferred,{localTracks:library.current});
        if (request.signal.aborted || choice.current) return;
        if (url) {
          const checked=discardRevokedBlobCandidate(result,url);
          if (checked!==result) setNotice('已忽略无法播放的旧伴奏文件。');
          result=checked;
        }
        if (result.status==='ready' && result.track) {
          if (active.current) {deferredBacking.current=true;return;}
          acceptPair(result.track,url,digest);
          url='';
        } else if (!active.current && pairRef.current) {
          acceptPair(undefined);
        }
        setBacking(result);
        if ((result.status==='missing' || result.status==='error') && splitApi && !generatedTrack) {
          try {
            const details=await runSplit(splitApi,'inspect',selected,request.signal);
            if (request.signal.aborted || choice.current) return;
            if (active.current) {deferredBacking.current=true;return;}
            setSplit(details);
            const generated=splitTrack(selected,details);
            if (generated && await verifyAccompaniment(generated,sourcesRef.current,false,request.signal)) {
              if (request.signal.aborted || choice.current) return;
              if (active.current) {deferredBacking.current=true;return;}
              acceptPair(generated);
              setBacking({status:'ready',candidates:[],track:generated,message:'已复用本地生成的伴奏。'});
            }
          } catch {
            if (!request.signal.aborted && !choice.current) setSplit({status:'unavailable',message:'暂时无法检查本地分离服务。'});
          }
        }
      } catch {
        if (!request.signal.aborted && !choice.current) setBacking({status:'error',candidates:[],message:'伴奏准备失败，可以重新查找或导入文件。'});
      } finally {if(url) URL.revokeObjectURL(url);}
    })();
    return ()=>request.abort();
  },[originalKey,sourceSignature,mobile,retry,splitApi]);

  useEffect(()=>{
    const selected=originalRef.current;
    if (!selected || chartChoice.current) return;
    const request=new AbortController();
    chartSearch.current=request;
    setChart({status:'pending'});
    const key=reference(pair);
    void discoverChart(selected,request.signal,pair ? {accompaniment:pair,accompanimentDigest:localDigest.current} : undefined).then(result=>{
      if (request.signal.aborted || chartChoice.current || reference(pairRef.current)!==key) return;
      trustedChart.current=result.chart ? {pair:key,chart:result.chart} : undefined;
      setChart(result);
    },()=>{
      if (!request.signal.aborted && !chartChoice.current) setChart({status:'error',candidates:[],message:'曲谱查询失败，可以重新查找或直接跟唱。'});
    });
    return ()=>request.abort();
  },[originalKey,pair,chartRetry]);

  function claimAction() {
    if (!original || active.current || currentAction.current) return;
    const request=new AbortController();
    currentAction.current=request;
    setWorking(true);setNotice('');
    return request;
  }
  function releaseAction(request:AbortController) {
    if (currentAction.current!==request) return;
    currentAction.current=undefined;
    if (alive.current) setWorking(false);
  }
  function cancelGeneration(message='已取消本地伴奏与曲谱生成。') {
    const current=generationRun.current;
    if (!current) return;
    generationRun.current=undefined;
    current.request.abort(new DOMException(message,'AbortError'));
    if (currentAction.current===current.request) currentAction.current=undefined;
    if (alive.current) {
      setGeneration({status:'cancelled'});
      setWorking(false);
    }
  }
  function cancelAction() {
    if (generationRun.current) {cancelGeneration();return;}
    currentAction.current?.abort();
    currentAction.current=undefined;
    disposePreview();
    setWorking(false);
  }
  function cancelSearch() {
    baseSearch.current?.abort();
    chartSearch.current?.abort();
    setBacking(value=>value.status==='pending' ? {status:'cancelled'} : value);
    setChart(value=>value.status==='pending' ? {status:'cancelled'} : value);
  }
  function retryBacking() {
    choice.current=false;
    setNotice('');
    setRetry(value=>value+1);
  }
  function lockForRound() {
    active.current=true;
    disposePreview();
    if (generationRun.current) cancelGeneration('开始演唱后，未完成的本地生成已停止。');
    // Lookups can finish in the background; any new pair is applied when the
    // current round has released its decoder and scoring chart.
  }

  async function listen(track:Track) {
    if (!original || active.current || !hasIndependentSource(original,track)) return;
    disposePreview();
    const request=new AbortController();
    const playing={request} as {request:AbortController;audio?:SoloAudio};
    currentPreview.current=playing;
    previewed.current=undefined;
    setPreview({track,loading:true,playing:false,verified:false});
    setNotice('');
    const stop=()=>{
      if (currentPreview.current!==playing) return;
      disposePreview(false);
      setPreview({track,loading:false,playing:false,verified:previewed.current===track});
    };
    const reject=(message:string)=>{if (currentPreview.current===playing) {previewed.current=undefined;setNotice(message);stop();}};
    try {
      const audio=await prepareSoloAudio(track,mobile,request.signal,{
        ended:stop,stopped:stop,failed:reject,
      },0,true);
      if (request.signal.aborted) {audio.dispose();return;}
      playing.audio=audio;
      await audio.play();
      if (!request.signal.aborted && currentPreview.current===playing) {
        previewed.current=track;
        setPreview({track,loading:false,playing:true,verified:true});
      }
    } catch {reject('此伴奏暂时无法试听，可换另一条或导入文件。');}
  }

  async function confirmPair(candidate:Track) {
    if (!original || !hasIndependentSource(original,candidate) || previewed.current!==candidate) return;
    const request=claimAction();if(!request)return;
    disposePreview();
    try {
      const verified=await verifyAccompaniment(candidate,sources,mobile,request.signal);
      request.signal.throwIfAborted();
      if (!verified || !comparableLength(original.duration,verified.duration)) throw Error('伴奏未通过播放与时长验证，请选同一时间轴的版本。');
      choice.current=true;baseSearch.current?.abort();chartSearch.current?.abort();
      acceptPair(verified);
      setBacking({status:'ready',candidates:[],track:verified,message:'已确认并验证伴奏。'});
      try {await savePairing(original,verified);}
      catch {if(!request.signal.aborted) setNotice('伴奏本轮可用，但未能保存自动配对。');}
    } catch (error) {if(!request.signal.aborted) setNotice(readableError(error,'无法确认伴奏。'));}
    finally {releaseAction(request);}
  }

  async function importPair(file:File) {
    if (!original) return;
    if (file.size<=0 || file.size>500*1024*1024) {setNotice('请选择小于 500 MiB 的伴奏文件。');return;}
    const request=claimAction();if(!request)return;
    disposePreview();
    let url=URL.createObjectURL(file);
    try {
      const candidate:Track={id:'karaoke-file:'+crypto.randomUUID(),title:file.name,artist:original.artist,duration:0,source:'local',path:'',audioUrl:url};
      const verified=await verifyAccompaniment(candidate,sources,mobile,request.signal);
      request.signal.throwIfAborted();
      if (!verified) throw Error('无法解码这个文件，请尝试 MP3、WAV 或 FLAC。');
      if (!comparableLength(original.duration,verified.duration)) throw Error('伴奏与原声的时长差异较大，请换用同一录音的伴奏。');
      const digest=file.size<=32*1024*1024 ? await digestBlob(file,request.signal) : undefined;
      choice.current=true;baseSearch.current?.abort();chartSearch.current?.abort();
      acceptPair(verified,url,digest);url='';
      setBacking({status:'ready',candidates:[],track:verified,message:'已导入可播的本地伴奏。'});
      try {await savePairing(original,verified,file);}
      catch (error) {if(!request.signal.aborted) setNotice(readableError(error,'伴奏本轮可用，但未能保存自动配对。'));}
    } catch(error) {if(!request.signal.aborted) setNotice(readableError(error,'无法导入伴奏。'));}
    finally {if(url) URL.revokeObjectURL(url);releaseAction(request);}
  }

  async function removePair() {
    if (!original || !pairRef.current) return;
    const request=claimAction();if(!request)return;
    try {
      await removePairing(original);
      request.signal.throwIfAborted();
      choice.current=true;baseSearch.current?.abort();chartSearch.current?.abort();
      acceptPair(undefined);
      setBacking({status:'missing',candidates:[],message:'已解除伴奏配对。'});
    } catch {if (!request.signal.aborted) setNotice('无法解除已保存的伴奏配对。');}
    finally {releaseAction(request);}
  }

  async function stageChart(
    loader:(signal:AbortSignal)=>Promise<KaraokeImportFile> | KaraokeImportFile,
    source:'imported'|'open'='imported',
  ) {
    if (!original || !pairRef.current) return;
    const selectedPair=pairRef.current;
    const request=claimAction();if(!request)return;
    try {
      const file=await loader(request.signal);
      request.signal.throwIfAborted();
      if (selectedPair!==pairRef.current) throw Error('伴奏已经变化，请重新选择曲谱。');
      const parsed=await validatePreparedChart(file,{original,accompaniment:selectedPair,accompanimentDigest:localDigest.current},request.signal);
      request.signal.throwIfAborted();
      if (selectedPair!==pairRef.current) throw Error('伴奏已经变化，请重新选择曲谱。');
      setDraft({file,chart:parsed,source});
    } catch(error) {if(!request.signal.aborted) setNotice(readableError(error,'无法核对曲谱。'));}
    finally {releaseAction(request);}
  }
  function stageOpenChart(chart:OpenChart) {
    if (original) void stageChart(signal=>loadOpenChartCandidate(chart,original,signal),'open');
  }
  async function confirmChart() {
    const current=pairRef.current;
    if (!original || !current || !draft) return;
    const request=claimAction();if(!request)return;
    try {
      const verified=await confirmPreparedChart(draft.file,{original,accompaniment:current,accompanimentDigest:localDigest.current},request.signal);
      request.signal.throwIfAborted();
      if (pairRef.current!==current) return;
      chartSearch.current?.abort();chartChoice.current=true;
      trustedChart.current={pair:reference(current),chart:verified};
      setChart({status:'ready',candidates:[],chart:verified,message:verified.persisted?'曲谱已确认并保存。'
        :verified.persistenceError?'曲谱已确认，本轮可用，但未能保存到本机。':'曲谱已确认，仅本次选曲可用。'});
      setDraft(undefined);
    } catch(error) {if(!request.signal.aborted) setNotice(readableError(error,'无法确认曲谱。'));}
    finally {releaseAction(request);}
  }

  async function generate() {
    if (!original || !generationApi || active.current || generationRun.current) return;
    const selected=original;
    const selectedKey=reference(selected);
    const existingPair=pairRef.current;
    const request=claimAction();if(!request)return;
    const requestId=crypto.randomUUID();
    const run:GenerationRun={request,requestId,originalKey:selectedKey,stage:'preparing'};
    generationRun.current=run;
    setGeneration({status:'running',stage:'preparing'});
    try {
      let rawLyrics:RawLyrics | null = null;
      try {rawLyrics=await readLyricsRef.current(selected);}
      catch {if (!request.signal.aborted) setNotice('歌词暂时无法读取，仍会尝试生成伴奏；逐句曲谱可能不可用。');}
      request.signal.throwIfAborted();
      if (generationRun.current!==run || originalKeyRef.current!==selectedKey || active.current) return;
      const lyrics=timedLyricsFromRaw(rawLyrics,selected.duration);
      run.stage='separating';
      setGeneration({status:'running',stage:'separating'});
      const result=await runGeneration(generationApi,selected,requestId,lyrics,request.signal);
      request.signal.throwIfAborted();
      if (generationRun.current!==run || originalKeyRef.current!==selectedKey || active.current) return;
      if (result.status==='cancelled') {
        setGeneration({status:'cancelled'});
        return;
      }
      if (result.status==='unavailable') {
        setGeneration({
          status:'unavailable',
          code:result.code,
          message:unavailableGenerationMessage(result.code,result.message),
        });
        return;
      }
      const generated=generatedBackingTrack(selected,result.backing);
      if (!generated) throw Error('生成的伴奏标识、时长或来源身份无效。');
      const verified=await verifyAccompaniment(generated,sourcesRef.current,false,request.signal);
      request.signal.throwIfAborted();
      if (!verified || !comparableLength(selected.duration,verified.duration)) {
        throw Error('生成的伴奏未通过播放与时长验证。');
      }
      if (generationRun.current!==run || originalKeyRef.current!==selectedKey || active.current) return;

      if (result.status==='partial' && existingPair && pairRef.current===existingPair) {
        setGeneration({status:'partial',backing:verified,chartFailure:result.chartFailure});
        return;
      }

      choice.current=true;baseSearch.current?.abort();chartSearch.current?.abort();
      acceptPair(verified);
      chartChoice.current=true;
      setBacking({status:'ready',candidates:[],track:verified,message:'本地生成的伴奏已验证，曲谱仍需核对。'});
      void savePairing(selected,verified).catch(()=>{
        if (!request.signal.aborted && generationRun.current===run) setNotice('生成的伴奏本轮可用，但未能保存自动配对。');
      });

      if (result.status==='partial') {
        setGeneration({status:'partial',backing:verified,chartFailure:result.chartFailure});
        setChart({status:'missing',candidates:[],message:result.chartFailure});
        return;
      }

      run.stage='validating';
      setGeneration({status:'running',stage:'validating'});
      const file:KaraokeImportFile={name:result.chart.name,type:'text/plain',data:result.chart.data};
      let prepared:VerifiedChart;
      try {
        prepared=await validatePreparedChart(file,{original:selected,accompaniment:verified},request.signal);
      } catch (error) {
        request.signal.throwIfAborted();
        const chartFailure='自动曲谱未通过 Zenix 校验：'+readableError(error,'无法解析自动曲谱。');
        setGeneration({status:'partial',backing:verified,chartFailure});
        setChart({status:'missing',candidates:[],message:chartFailure});
        return;
      }
      request.signal.throwIfAborted();
      if (generationRun.current!==run || originalKeyRef.current!==selectedKey || active.current) return;
      setDraft({file,chart:prepared,source:'generated',generated:result.chart});
      setChart({status:'review',candidates:[],message:'已生成曲谱草稿，请核对时间轴后再启用评分。'});
      setGeneration({
        status:'ready',
        backing:verified,
        chartName:result.chart.name,
        noteCount:result.chart.noteCount,
        lineCount:result.chart.lineCount,
        message:'伴奏已验证，曲谱草稿待你确认。',
      });
    } catch(error) {
      if (!request.signal.aborted && generationRun.current===run && originalKeyRef.current===selectedKey) {
        setGeneration({status:'error',message:readableError(error,'本地伴奏与曲谱生成失败。')});
      }
    }
    finally {
      if (generationRun.current===run) generationRun.current=undefined;
      releaseAction(request);
    }
  }

  function discardDraft() {
    const source=draft?.source;
    setDraft(undefined);
    if (source==='generated') {
      setChart({status:'missing',candidates:[],message:'生成的曲谱草稿已取消核对，可以重新生成或导入曲谱。'});
    }
  }

  return {backing,chart,pair,draft,preview,working,notice,split,generation,
    canSplit:!!splitApi,canGenerate:!!generationApi,
    verifiedChart:trustedChart.current?.pair===reference(pair) ? trustedChart.current?.chart : undefined,
    clearNotice:()=>setNotice(''),discardDraft,cancelSearch,cancelAction,
    cancelGeneration:()=>cancelGeneration(),retryBacking,
    retryChart:()=>{chartChoice.current=false;setChartRetry(value=>value+1);},
    lockForRound,unlockRound:()=>{
      active.current=false;
      if (deferredBacking.current) {
        deferredBacking.current=false;
        if (!choice.current) setRetry(value=>value+1);
      }
    },
    listen,stopPreview:()=>{
      disposePreview(false);
      setPreview(value=>value ? {...value,loading:false,playing:false} : value);
    },confirmPair,importPair,removePair,stageChart,stageOpenChart,confirmChart,generate};
}

async function digestBlob(blob:Blob,signal:AbortSignal):Promise<string> {
  signal.throwIfAborted();
  const bytes=await blob.arrayBuffer();
  signal.throwIfAborted();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  signal.throwIfAborted();
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function runSplit(api:SplitApi,method:'lookup'|'inspect'|'generate', track:Track,signal:AbortSignal) {
  signal.throwIfAborted();
  const id=crypto.randomUUID();
  const cancel=()=>{void api.cancel(id).catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try {
    const result=await api[method](track,id);
    signal.throwIfAborted();
    return result;
  } finally {signal.removeEventListener('abort',cancel);}
}

function waitForGenerationRetry(signal:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    if (signal.aborted) {reject(signal.reason);return;}
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},100);
    signal.addEventListener('abort',abort,{once:true});
  });
}

async function runGeneration(
  api:GenerationApi,
  track:Track,
  requestId:string,
  lyrics:KaraokeGenerationLyricLineSnapshot,
  signal:AbortSignal,
):Promise<KaraokeGenerationResult> {
  signal.throwIfAborted();
  const cancel=()=>{void api.cancel(requestId).catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try {
    for (let attempt=0;attempt<50;attempt+=1) {
      const result=await api.generateWithChart(track,requestId,lyrics,{schemaVersion:1});
      signal.throwIfAborted();
      if (result.status!=='unavailable' || result.code!=='busy' || attempt===49) return result;
      await waitForGenerationRetry(signal);
    }
    throw Error('本地生成仍在收尾，请稍后重试。');
  } finally {signal.removeEventListener('abort',cancel);}
}

type KaraokeGenerationLyricLineSnapshot=ReturnType<typeof timedLyricsFromRaw>;
