let skin=null,timer,resetTimer,options={},state='idle',gesture=null,moveFrame=0;
const character=document.getElementById('character'),message=document.getElementById('message'),grip=document.getElementById('grip');
const defaultShape=document.getElementById('default-template').innerHTML;
const labels={idle:'待机',listening:'正在聆听',thinking:'正在思考',executing:'正在执行',success:'已完成',failure:'执行失败',shy:'害羞',greeting:'招手',cheer:'开心',talking:'正在回复'};
function render(){
 clearInterval(timer);
 const animated=!document.hidden&&!options.hidden&&!options.reduced&&options.motion!=='reduced';
 document.body.dataset.animated=String(animated);document.body.dataset.light=String(options.motion==='light');document.body.dataset.state=state;document.body.dataset.locked=String(!!options.locked);document.body.dataset.musical=String(animated&&options.music!==false&&options.playing===true&&state==='idle');
 grip.textContent=options.locked?'位置已锁定':'拖动角色移动';character.setAttribute('aria-label','Zenix 音乐助手：'+labels[state]);
 if(!skin){if(!character.querySelector('.pet-portrait'))character.innerHTML=defaultShape;return;}
 const image=document.createElement('img');image.alt=skin.config.name;image.className='pet-body';image.draggable=false;image.onerror=()=>{skin=null;message.textContent='皮肤无法显示，已恢复默认';render();};character.replaceChildren(image);
 const animation=skin.config.animations[state]||skin.config.animations.idle;let index=0;
 function frame(){image.src='data:image/png;base64,'+skin.images[skin.config.frames[animation.frames[index]]];index=animation.loop?(index+1)%animation.frames.length:Math.min(index+1,animation.frames.length-1);}
 frame();if(animated&&animation.frames.length>1)timer=setInterval(frame,1000/Math.min(animation.fps,options.fps||12));
}
async function act(action){if(state==='executing')return;clearTimeout(resetTimer);state='executing';message.textContent=labels[state];render();try{await window.zenixPet.act(action);state='success';message.textContent='';}catch{state='failure';message.textContent='操作未完成，请打开主窗口';}render();resetTimer=setTimeout(()=>{state='idle';render();},1800);}
async function finish(event,cancel=false){const session=gesture;if(!session||session.id!==event.pointerId)return;gesture=null;cancelAnimationFrame(moveFrame);moveFrame=0;document.body.dataset.dragging='false';try{if(session.failed){await window.zenixPet.drag('cancel',session.token);return;}if(session.target.hasPointerCapture(session.id))session.target.releasePointerCapture(session.id);if(session.dragging){await session.ready;const result=await window.zenixPet.drag(cancel?'cancel':'end',session.token);if(!cancel&&!result.stale&&!result.locked&&!result.moved&&!session.moved&&session.target===character)shy();}else if(!cancel&&!session.moved&&session.target===character)shy();}catch{message.textContent='拖动未完成，可以松开后重试';}}
for(const target of [character,grip]){
 target.addEventListener('pointerdown',event=>{if(event.button!==0||event.isPrimary===false||gesture)return;event.preventDefault();const session={id:event.pointerId,token:crypto.randomUUID(),target,dragging:!options.locked,x:event.clientX,y:event.clientY,moved:false,ready:Promise.resolve()};gesture=session;target.setPointerCapture(event.pointerId);if(session.dragging)session.ready=window.zenixPet.drag('start',session.token).catch(error=>{session.failed=true;message.textContent='无法开始拖动，请重新操作';});});
 target.addEventListener('pointermove',event=>{const session=gesture;if(session&&session.id===event.pointerId)session.moved ||= Math.hypot(event.clientX-session.x,event.clientY-session.y)>=4;if(!session||session.id!==event.pointerId||!session.dragging||session.failed||moveFrame)return;moveFrame=requestAnimationFrame(async()=>{moveFrame=0;try{await session.ready;if(gesture!==session||options.locked||session.failed)return;const result=await window.zenixPet.drag('move',session.token);if(gesture===session)document.body.dataset.dragging=String(result.moved);}catch{message.textContent='拖动未完成，可以松开后重试';}});});
 target.addEventListener('pointerup',event=>void finish(event));target.addEventListener('pointercancel',event=>void finish(event,true));target.addEventListener('lostpointercapture',event=>{if(gesture?.id===event.pointerId)void finish(event,true);});
}
character.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();shy();}});
window.zenixPet.onOptions(value=>{options=value||{};if(gesture&&options.locked){const session=gesture;void window.zenixPet.drag('cancel',session.token).catch(()=>{});gesture=null;document.body.dataset.dragging='false';}render();});window.zenixPet.onSkin(value=>{skin=value;render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&gesture){const session=gesture;void finish({pointerId:session.id},true);}render();});
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>void act(button.dataset.action)));
document.getElementById('close').onclick=()=>window.close();render();

function shy(){if(voiceSession)return;clearTimeout(resetTimer);state=['shy','greeting','cheer'][reaction++%3];message.textContent=state==='shy'?'有一点点害羞…… ♡':state==='greeting'?'你好呀，星音在这里':'和你一起听歌很开心！';render();resetTimer=setTimeout(()=>{state='idle';message.textContent='';render();},3500);}
let voiceSession=null,reaction=0;
async function beginVoice(source){
 if(voiceSession)return;clearTimeout(resetTimer);const session={token:crypto.randomUUID(),source,held:true,ready:false,recording:new window.zenixHoldRecording.HoldRecording()};voiceSession=session;
 state='thinking';message.textContent='正在准备麦克风…';document.body.dataset.voice='true';render();
 try{await window.zenixPet.speech({action:'speechStart',token:session.token});if(voiceSession!==session)return;const ready=await session.recording.start();if(voiceSession!==session||!session.held){session.recording.cancel();return;}session.ready=ready;state='listening';message.textContent='正在听 · 松开发送，Escape 取消';render();}catch(error){if(voiceSession===session){voiceSession=null;session.recording.cancel();state='failure';message.textContent=String(error);document.body.dataset.voice='false';render();}}
}
function cancelVoice(){const session=voiceSession;voiceSession=null;if(session){session.recording.cancel();void window.zenixPet.speech({action:'speechCancel',token:session.token}).catch(()=>{});}state='idle';message.textContent='已取消，本次语音不会执行';document.body.dataset.voice='false';render();}
async function endVoice(){const session=voiceSession;if(!session||!session.held)return;session.held=false;if(!session.ready){cancelVoice();return;}state='thinking';message.textContent='正在识别…';render();try{const value=await window.zenixPet.speech({action:'speechRecognize',token:session.token,wav:session.recording.finish()});if(voiceSession!==session)return;voiceSession=null;document.body.dataset.voice='false';message.textContent=value.transcript?`听到：${value.transcript}`:'没有听清，请重试';render();}catch(error){if(voiceSession===session){voiceSession=null;state='failure';message.textContent=String(error);document.body.dataset.voice='false';render();}}}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&voiceSession){event.preventDefault();cancelVoice();return;}if(event.code!=='Space'||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||event.isComposing)return;if(event.target.closest('button,input,textarea,select')&&event.target.id!=='voice')return;event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)void beginVoice('keyboard');},true);
document.addEventListener('keyup',event=>{if(event.code==='Space'&&voiceSession?.source==='keyboard'){event.preventDefault();void endVoice();}},true);
window.addEventListener('blur',()=>{if(voiceSession)cancelVoice();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&voiceSession)cancelVoice();});
const voiceButton=document.getElementById('voice');
voiceButton.addEventListener('pointerdown',event=>{if(event.button!==0||!event.isPrimary)return;event.preventDefault();voiceButton.setPointerCapture(event.pointerId);void beginVoice('pointer');});
voiceButton.addEventListener('pointerup',event=>{void endVoice();if(voiceButton.hasPointerCapture(event.pointerId))voiceButton.releasePointerCapture(event.pointerId);});
voiceButton.addEventListener('pointercancel',cancelVoice);voiceButton.addEventListener('lostpointercapture',()=>{if(voiceSession?.held)cancelVoice();});
window.zenixPet.onFeedback?.(value=>{if(voiceSession?.held)return;if(!['idle','listening','thinking','executing','success','failure','talking','shy','greeting','cheer'].includes(value?.state))return;clearTimeout(resetTimer);state=value.state;message.textContent=String(value.text||'');render();});
