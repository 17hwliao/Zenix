import {speechChunks} from './speechText';
import {useCallback,useEffect,useRef,useState} from 'react';
import {command,isAndroid,isNativeMobile,observeAssistantVoice} from '../../mobile/native';
import {executeAssistant} from '../featureHost';
import {understand,type Intent} from './intent';
import type {AssistantPlan,AssistantResult} from './libraryCommands';
import {HoldRecording} from './recording';
import SkinCharacter from './SkinCharacter';
import './conversation.css';

type Invoke=<T=unknown>(args:Record<string,unknown>)=>Promise<T>;
type Session={token:string;held:boolean;source:'pointer'|'keyboard';recording?:InstanceType<typeof HoldRecording>;native:boolean};
type Phase='idle'|'preparing'|'listening'|'thinking'|'executing'|'talking'|'shy'|'greeting'|'cheer'|'success'|'failure';
/** One host owns recognition and command dispatch; character rendering never owns the player. */
export default function AssistantConversation({mobile=false,invoke:provided,execute:providedExecute}:{mobile?:boolean;invoke?:Invoke;execute?:(action:string,args:Record<string,unknown>)=>Promise<unknown>}){
 const [executing,setExecuting]=useState(false),[open,setOpen]=useState(false),[phase,setPhase]=useState<Phase>('idle'),[text,setText]=useState(''),[heard,setHeard]=useState(''),[reply,setReply]=useState('按住说话，松开发送；上滑或 Escape 取消。'),[pending,setPending]=useState<Intent>(),[spoken,setSpoken]=useState(()=>{try{return localStorage.getItem('zenix.assistant.spoken.v1')!=='false';}catch{return true;}});
 const active=useRef<Session|undefined>(undefined),revision=useRef(0),working=useRef(false),alive=useRef(true),shyTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),reaction=useRef(0),pointerY=useRef(0),speechOutput=useRef<SpeechSynthesisUtterance|undefined>(undefined);
 const [plan,setPlan]=useState<AssistantPlan>(),[items,setItems]=useState<string[]>([]),[detail,setDetail]=useState('');
 const planned=useRef<AssistantPlan|undefined>(undefined),naming=useRef<AssistantResult['ask']>(undefined),requestAbort=useRef<AbortController|undefined>(undefined);
 const reading=useRef<{stop?:()=>void}|undefined>(undefined);
 const native=mobile&&isAndroid&&isNativeMobile;
 const invoke=useCallback<Invoke>(async args=>provided?provided(args):mobile?command('features',args):window.yzqxy?.companion?window.yzqxy.companion.invoke(args) as never:Promise.reject(Error('请在 Zenix 客户端使用语音助手')),[provided,mobile]);
 const experience=useCallback((state:Phase,message?:string)=>{if(!alive.current)return;setPhase(state);if(message!==undefined)setReply(message);window.dispatchEvent(new CustomEvent('zenix-assistant-state',{detail:{state,text:message}}));if(!mobile)void invoke({operation:'assistant',action:'feedback',state,text:message||''}).catch(()=>{});},[invoke,mobile]);
 const silence=useCallback(()=>{const session=reading.current;reading.current=undefined;session?.stop?.();if(native)void invoke({operation:'assistant',action:'speechSilence'}).catch(()=>{});else if(typeof speechSynthesis!=='undefined')speechSynthesis.cancel();speechOutput.current=undefined;},[native,invoke]);
 const answer=useCallback(async(message:string,emotion:Phase,token:number,messages?:string[])=>{
  if(!alive.current||token!==revision.current)return;experience(emotion,message);
  if(!spoken)return;
  const session:{stop?:()=>void}={};reading.current?.stop?.();reading.current=session;
  const valid=()=>alive.current&&token===revision.current&&reading.current===session;
  const parts=speechChunks([message,...(messages||[])]);
  // Speech is interruptible output, not a pending data write. It must not block push-to-talk.
  void (async()=>{
   experience(emotion==='shy'?'shy':'talking',message);
   try{for(const part of parts){if(!valid())return;
    if(native){const value=await invoke<{spoken:boolean}>({operation:'assistant',action:'speechSpeak',text:part});if(!valid())return;if(!value.spoken)throw Error('系统语音不可用');}
    else{if(typeof speechSynthesis==='undefined')throw Error('系统语音不可用');await new Promise<void>((resolve,reject)=>{const utterance=new SpeechSynthesisUtterance(part);utterance.lang='zh-CN';utterance.rate=1.04;const voice=speechSynthesis.getVoices().find(item=>/^zh/i.test(item.lang));if(voice)utterance.voice=voice;speechOutput.current=utterance;session.stop=resolve;utterance.onend=()=>{session.stop=undefined;resolve();};utterance.onerror=()=>{session.stop=undefined;reject(Error('语音回复未完成'));};speechSynthesis.speak(utterance);});}
   }if(valid())experience(emotion,message);
   }catch{if(valid())experience(emotion,message+'（语音回复未完成，文字结果已保留）');}
   finally{if(reading.current===session){reading.current=undefined;speechOutput.current=undefined;}}
  })();
 },[spoken,native,invoke,experience]);
 const present=useCallback(async(result:unknown,fallback:string,token:number)=>{
  if(!alive.current||token!==revision.current)return;
  if(result&&typeof result==='object'&&'kind' in result&&result.kind==='confirmation'){
   const next=result as AssistantPlan;planned.current=next;setPlan(next);setItems([]);setDetail('');experience('thinking',next.summary);return;
  }
  const value=result&&typeof result==='object'&&'reply' in result?result as AssistantResult:undefined;
  setItems(value?.items||[]);setDetail(value?.detail||'');naming.current=value?.ask;await answer(value?.reply||fallback,'success',token,value?.speech);
 },[experience,answer]);
 const confirmPlan=useCallback(async()=>{
  const next=planned.current;if(!next||working.current)return;planned.current=undefined;setPlan(undefined);working.current=true;setExecuting(true);const token=revision.current;experience('executing','正在保存已确认的操作…');
  try{await present(await next.commit(),'操作已保存。',token);}catch(error){if(alive.current&&token===revision.current)await answer(error instanceof Error?error.message:String(error),'failure',token);}finally{working.current=false;if(alive.current)setExecuting(false);}
 },[present,experience,answer]);
 const execute=useCallback(async(intent:Intent,token:number)=>{
  if(!intent.action||token!==revision.current||working.current)return;requestAbort.current?.abort();const controller=new AbortController();requestAbort.current=controller;working.current=true;setExecuting(true);setPending(undefined);planned.current=undefined;setPlan(undefined);naming.current=undefined;experience('executing',`正在${intent.reply}…`);
  try{const result=providedExecute?await providedExecute(intent.action,intent.args||{}):await executeAssistant(mobile,intent.action,intent.args||{},invoke,()=>window.dispatchEvent(new CustomEvent('zenix-open-workbench',{detail:{tab:'tasks'}})),controller.signal);await present(result,intent.action==='search'?`已打开${intent.reply}的结果，请选择想听的版本。`:`已${intent.reply}。`,token);}catch(error){if(alive.current&&token===revision.current)await answer(error instanceof Error?error.message:String(error),'failure',token);}finally{working.current=false;if(alive.current)setExecuting(false);}
 },[providedExecute,mobile,invoke,experience,answer,present]);
 const accept=useCallback(async(value:{transcript:string;confidence?:number},token=++revision.current)=>{
  if(!alive.current||token!==revision.current||working.current)return;setOpen(true);setText(value.transcript);setHeard(value.transcript);setItems([]);setDetail('');const confidence=value.confidence===undefined||value.confidence<0?.5:value.confidence;
  let intent=understand(value.transcript,confidence);
  if(/^(取消|算了|不要了|不执行)[。！!]?$/.test(value.transcript.trim())){requestAbort.current?.abort();planned.current=undefined;setPlan(undefined);naming.current=undefined;setPending(undefined);experience('idle','已取消，未执行待确认操作。');return;}
  if(planned.current&&/^(确认|确定|执行|是的)[。！!]*$/.test(value.transcript.trim())){if(confidence<.62){experience('thinking','请点击确认按钮，避免识别错误。');return;}await confirmPlan();return;}
  const question=naming.current;naming.current=undefined;
  if(question&&intent.kind==='unknown'&&!/^(不要|别|取消|删除|清空|移除|搜索|打开|返回|播放|创建|新建)/.test(value.transcript.trim())){const name=value.transcript.trim().replace(/^(?:叫|名字叫|命名为)/,'').replace(/^[《“"]|[》”"]$/g,'').trim();intent={kind:'action',action:question.action,args:{...question.args,name},reply:'创建歌单'};}
  planned.current=undefined;setPlan(undefined);requestAbort.current?.abort();experience('thinking',`听到：${value.transcript||'没有清晰的语音'}`);
  if(intent.kind==='confirm'){setPending(intent);experience('thinking',`我理解为“${intent.reply}”，识别把握不足，请确认。`);return;}
  setPending(undefined);if(intent.kind==='action'){await execute(intent,token);return;}
  await answer(intent.reply,intent.emotion==='shy'?'shy':intent.kind==='unknown'?'failure':'success',token);
 },[execute,answer,experience,confirmPlan]);
 const cancel=useCallback(()=>{
  const session=active.current;active.current=undefined;revision.current++;const wasWorking=working.current;requestAbort.current?.abort();planned.current=undefined;setPlan(undefined);naming.current=undefined;setItems([]);setDetail('');session?.recording?.cancel();if(session)void invoke({operation:'assistant',action:'speechCancel',token:session.token}).catch(()=>{});silence();setPending(undefined);experience('idle',wasWorking?'已停止等待；已发出的音乐操作不会撤回。':'已取消，本次语音不会执行。');
 },[invoke,silence,experience]);
 const begin=useCallback(async(source:'pointer'|'keyboard')=>{
  if(active.current||working.current)return;setItems([]);setDetail('');clearTimeout(shyTimer.current);silence();const token=++revision.current;const session:Session={token:crypto.randomUUID(),held:true,source,native};active.current=session;setOpen(true);setPending(undefined);experience('preparing','正在准备麦克风，请在提示“正在听”后说话…');
  try{
   if(native){const permission=await invoke<{permitted:boolean}>({operation:'assistant',action:'speechPermission'});if(active.current!==session||!session.held)return;if(!permission.permitted)throw Error('未允许麦克风，请授权后再按住说话');const result=invoke<{transcript:string;confidence?:number}>({operation:'assistant',action:'speechBegin',token:session.token});void result.then(value=>{if(active.current!==session||token!==revision.current)return;active.current=undefined;void accept(value,token);}).catch(error=>{if(active.current===session&&token===revision.current){active.current=undefined;experience('failure',String(error));}});return;}
   const recording=session.recording=new HoldRecording();const ready=await recording.start();if(active.current!==session||!session.held){recording.cancel();return;}if(ready)experience('listening','正在听 · 松开发送，Escape 取消');
  }catch(error){if(active.current===session){active.current=undefined;session.recording?.cancel();experience('failure',error instanceof Error?error.message:String(error));}}
 },[native,invoke,experience,silence,accept]);
 const release=useCallback(async()=>{
  const session=active.current;if(!session||!session.held)return;session.held=false;
  if(phase==='preparing'){cancel();return;}
  const token=revision.current;experience('thinking','已松开，正在识别这句话…');
  try{if(session.native){await invoke({operation:'assistant',action:'speechStop',token:session.token});return;}const wav=session.recording!.finish();const value=await invoke<{transcript:string;confidence?:number}>({operation:'assistant',action:'speechRecognize',token:session.token,wav});if(active.current!==session||token!==revision.current)return;active.current=undefined;await accept(value,token);}catch(error){if(active.current===session&&token===revision.current){active.current=undefined;experience('failure',error instanceof Error?error.message:String(error));}}
 },[phase,cancel,experience,invoke,accept]);
 const handlers=useRef({begin,release,cancel,accept});handlers.current={begin,release,cancel,accept};
 useEffect(()=>{alive.current=true;let removeVoice:(()=>void)|undefined;if(native)void observeAssistantVoice(value=>{if(active.current&&active.current.token===value.token&&active.current.held){if(value.phase==='listening')experience('listening','正在听 · 松开发送，上滑取消');else if(value.phase==='captured')experience('thinking','系统已收好这句话，松开发送；也可取消后重说。');}}).then(handle=>{if(!alive.current)void handle.remove();else removeVoice=()=>{void handle.remove();};}).catch(()=>{});const blur=()=>{if(active.current)handlers.current.cancel();},hidden=()=>{if(document.hidden){if(active.current)handlers.current.cancel();silence();}},down=(event:KeyboardEvent)=>{if(event.key==='Escape'&&(active.current||working.current||planned.current||naming.current||reading.current)){event.preventDefault();event.stopImmediatePropagation();handlers.current.cancel();return;}if(mobile||event.code!=='Space'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing)return;const node=event.target;if(node instanceof Element&&node.closest('input,textarea,select,[contenteditable="true"],button,a,[role="button"],[role="slider"]'))return;event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)void handlers.current.begin('keyboard');},up=(event:KeyboardEvent)=>{if(event.code==='Space'&&active.current?.source==='keyboard'){event.preventDefault();event.stopImmediatePropagation();void handlers.current.release();}},request=()=>{setOpen(true);},cancelRequest=()=>handlers.current.cancel();
  window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',hidden);window.addEventListener('zenix-assistant-conversation',request);window.addEventListener('zenix-assistant-cancel',cancelRequest);
  const startStop=mobile?undefined:window.yzqxy?.companion?.onVoiceStart?.(()=>{if(active.current)handlers.current.cancel();else silence();});const input=(event:Event)=>{if(active.current||working.current)return;silence();void handlers.current.accept({transcript:String((event as CustomEvent).detail?.text||''),confidence:1});};window.addEventListener('zenix-assistant-input',input);const stop=mobile?undefined:window.yzqxy?.companion?.onVoice?.(value=>{if(active.current||working.current)return;silence();void handlers.current.accept(value);});
  return()=>{alive.current=false;requestAbort.current?.abort();removeVoice?.();revision.current++;active.current?.recording?.cancel();if(active.current)void invoke({operation:'assistant',action:'speechCancel',token:active.current.token}).catch(()=>{});active.current=undefined;silence();clearTimeout(shyTimer.current);window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('zenix-assistant-conversation',request);window.removeEventListener('zenix-assistant-cancel',cancelRequest);stop?.();startStop?.();window.removeEventListener('zenix-assistant-input',input);};
 },[mobile,native,invoke,silence,experience]);
 function shy(){if(active.current||working.current)return;silence();const token=++revision.current;const mood=(['shy','greeting','cheer'] as const)[reaction.current++%3];void answer(mood==='shy'?'突然被你碰到，有一点害羞……':mood==='greeting'?'你好呀，星音在这里。':'和你一起听歌很开心！',mood,token);clearTimeout(shyTimer.current);shyTimer.current=setTimeout(()=>{if(token===revision.current)experience('idle');},3500);}
 return <aside className={`assistant-conversation ${mobile?'is-mobile':''}`} aria-label="星音语音助手">
  {open&&<section className="assistant-chat" aria-label="与星音交流"><header><strong>星音 · 音乐助手</strong><button aria-label="关闭语音助手" onClick={()=>{cancel();setOpen(false);}}>×</button></header><div className="assistant-chat-character" data-state={phase} data-animated="true"><button aria-label="轻触星音：害羞回应" onClick={shy}><SkinCharacter state={phase} invoke={invoke}/></button><span className="assistant-expression" aria-hidden="true">{phase==='shy'?'♡':phase==='listening'?'•••':phase==='thinking'?'⋯':phase==='success'?'✦':''}</span></div><p role="status">{reply}</p>{items.length>0&&<ul className="assistant-results" aria-label="检索结果">{items.map((item,index)=><li key={index}>{item}</li>)}</ul>}{detail&&<pre className="assistant-lyrics" aria-label="歌曲资料与歌词">{detail}</pre>}{plan&&<div className="assistant-plan" role="group" aria-label="确认资料操作"><p>{plan.summary}</p>{plan.items.length>0&&<ul>{plan.items.map((item,index)=><li key={index}>{item}</li>)}</ul>}<div className="assistant-confirm"><button disabled={executing} onClick={()=>void confirmPlan()}>确认执行</button><button onClick={cancel}>取消操作</button></div></div>}{heard&&<small>听到：“{heard}”</small>}<form onSubmit={event=>{event.preventDefault();if(active.current||working.current)return;silence();void accept({transcript:text,confidence:1});}}><label>你想说的话<input value={text} maxLength={200} onChange={event=>{setText(event.target.value);setPending(undefined);}} placeholder="例如：帮我搜索像风一样"/></label><button disabled={!text.trim()||!!active.current||executing}>发送</button></form>{pending&&<div className="assistant-confirm"><button onClick={()=>void execute(pending,revision.current)}>确认：{pending.reply}</button><button onClick={cancel}>取消</button></div>}{phase==='talking'&&<button onClick={()=>{silence();experience('idle','已停止朗读，文字结果保留。');}}>停止朗读</button>}<label className="assistant-spoken"><input type="checkbox" checked={spoken} onChange={event=>{setSpoken(event.target.checked);if(!event.target.checked)silence();try{localStorage.setItem('zenix.assistant.spoken.v1',String(event.target.checked));}catch{}}}/>语音回复</label><small>{mobile?'按住悬浮麦克风说话，松开发送，上滑取消。':'在应用空白处按住空格说话；输入框中的空格照常输入。'}</small>{(active.current||working.current)&&<button onClick={cancel}>取消本次对话</button>}</section>}
  <div className="assistant-voice-dock"><button className="assistant-talk-toggle" aria-label="打开星音对话" onClick={()=>{if(open)cancel();setOpen(value=>!value);}}>星音</button><button className="assistant-hold-voice" disabled={executing} data-phase={phase} aria-label={mobile?'按住与星音说话':'按住说话，也可按住空格'} aria-pressed={phase==='listening'} onContextMenu={event=>event.preventDefault()} onPointerDown={event=>{if(event.button!==0||!event.isPrimary)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);pointerY.current=event.clientY;void begin('pointer');}} onPointerMove={event=>{if(active.current?.source==='pointer'&&pointerY.current-event.clientY>72)cancel();}} onPointerUp={event=>{if(active.current?.source==='pointer')void release();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={cancel} onLostPointerCapture={()=>{if(active.current?.held&&active.current.source==='pointer')cancel();}} onKeyDown={event=>{if(event.code==='Space'||event.key==='Enter'){event.preventDefault();if(!event.repeat)void begin('keyboard');}}} onKeyUp={event=>{if(event.code==='Space'||event.key==='Enter'){event.preventDefault();void release();}}}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8"/></svg><span>{phase==='listening'?'松开发送':phase==='thinking'?'识别中':phase==='preparing'?'准备中':phase==='executing'?'执行中':'按住说话'}</span></button></div>
 </aside>;
}
