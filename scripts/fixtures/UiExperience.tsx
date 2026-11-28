import React from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {useApplicationExperience} from '../../src/ui/useApplicationExperience';
import {getSoundSettings, playUiSound, setSoundSettings} from '../../src/core/sounds';
import UiSoundSettings from '../../src/ui/UiSoundSettings';
const played: {url:string;volume:number}[]=[];
const nativePlayed: number[] = [];
let holdDecode = false, finishDecode: (()=>void)|undefined, contexts=0, closedContexts=0;
class FakeAudioContext {
  state='running'; destination={};
  constructor(){contexts++;}
  resume(){return Promise.resolve();}
  close(){this.state='closed';closedContexts++;return Promise.resolve();}
  decodeAudioData(){return holdDecode?new Promise(resolve=>{finishDecode=()=>resolve({duration:.1});}):Promise.resolve({duration:.1});}
  createGain(){return {gain:{value:0},connect(){},disconnect(){}};}
  createBufferSource(){const source={buffer:null,onended:null as (()=>void)|null,connect(gain:any){(source as any).gain=gain;},disconnect(){},stop(){source.onended?.();},start(){nativePlayed.push((source as any).gain.gain.value);}};return source;}
}
(window as any).AudioContext=FakeAudioContext;
class FakeAudio {
  paused=true; ended=false; currentTime=0; volume=1; preload='';
  constructor(public src:string) {}
  pause() {this.paused=true;}
  play() {this.paused=false;played.push({url:this.src,volume:this.volume});return Promise.resolve();}
  removeAttribute() {this.src='';} load() {}
}
(window as any).Audio=FakeAudio;
localStorage.setItem('zenix.ui-sounds.v1',JSON.stringify({enabled:true,volume:.8,enter:1,cancel:1,slide:1}));
const mobile=new URLSearchParams(location.search).has('mobile');
function Owner(){useApplicationExperience(mobile);return null;}
function Fixture(){useApplicationExperience(mobile);return <main style={{padding:24}}>
  <button id="plain">普通按钮</button><button id="explicit" onClick={()=>playUiSound('cancel')}>显式返回音效</button>
  <button id="nested" onClick={()=>{playUiSound('enter');playUiSound('enter');}}>嵌套处理</button>
  <button id="disabled" disabled>不可操作</button><div role="button" id="aria-disabled" aria-disabled="true">暂不可操作</div>
  <label id="toggle-label">开关<input type="checkbox" id="checkbox"/></label><input id="typing"/><input id="range" type="range"/>
  <div data-ui-sound="off"><button id="silent">静音区域</button></div>
  <div className="zenix-karaoke-modes"><button id="microphone">K 歌录制控制</button></div>
  <button className="assistant-hold-voice" id="voice-microphone">按住说话</button>
  <UiSoundSettings/>
  {createPortal(<section className="zenix-glass-dialog-card"><h2>确认操作</h2><p>同一套配色与声音反馈</p><button id="portal">弹层操作</button></section>,document.body)}
  <section className="yz-settings-modal yz-settings-redesign" id="settings-surface">设置</section>
  <section className="zenix-pocket-chat"><header className="zenix-pocket-header">袖珍聊天</header><div className="zenix-chat-workspace" id="chat-palette">聊天</div></section>
</main>;}
const first=createRoot(document.getElementById('root')!),second=createRoot(document.getElementById('second')!);
first.render(<React.StrictMode><Fixture/></React.StrictMode>);second.render(<Owner/>);
(window as any).feedbackFixture={played,nativePlayed,get contexts(){return contexts;},get closedContexts(){return closedContexts;},get pendingDecode(){return Boolean(finishDecode);},holdDecode:()=>{holdDecode=true;},finishDecode:()=>finishDecode?.(),settings:getSoundSettings,configure:(patch:object)=>setSoundSettings({...getSoundSettings(),...patch}),unmountFirst:()=>first.unmount(),unmountSecond:()=>second.unmount()};
