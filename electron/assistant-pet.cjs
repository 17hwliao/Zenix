let resetTimer, options = {}, state = 'idle', gesture = null, moveFrame = 0;
let voiceSession = null, karaokeVoiceLocked = false, renderer, figureId, interaction = '', lastDrag = false;
let gaze = {x: 0, y: 0}, stroke = 0, lastPointer, lastPet = 0, clickTimer;
let lastHit = true, resizeTimer, pointerActive = false;
const character = document.getElementById('character'), message = document.getElementById('message'), grip = document.getElementById('grip');
const menu = document.getElementById('pet-menu');
function hoverPet(value) {if(pointerActive===value)return;pointerActive=value;void window.zenixPetInteraction.hover(value).catch(()=>{});}
const labels = {idle:'待机',listening:'正在聆听',thinking:'正在思考',executing:'正在执行',success:'已完成',failure:'执行失败',shy:'害羞',greeting:'招手',cheer:'开心',talking:'正在回复'};
function render() {
  const animated = !document.hidden && !options.hidden && !options.reduced && options.motion !== 'reduced';
  const movement = options.movement || {};
  const busy = ['listening','thinking','executing','talking'].includes(state);
  const action = ['dragged','falling','landed'].includes(movement.mode) ? movement.mode : interaction || (!busy && !['idle','walk'].includes(movement.mode) ? movement.mode : state);
  document.body.dataset.animated = String(animated);
  document.body.dataset.state = state;
  document.body.dataset.movement = movement.mode || 'idle';
  document.body.dataset.locked = String(!!options.locked);
  document.body.dataset.musical = String(animated && options.music !== false && options.playing === true && state === 'idle');
  grip.title = options.locked ? '位置已锁定' : '拖动拎起 · 双击聊天';
  character.setAttribute('aria-label', (options.figure?.id === 'whale' ? 'DeepSeek 鲸鱼娘' : 'Zenbot') + '：' + (labels[state] || state));
  const nextFigure = options.figure?.id === 'whale' ? 'whale' : 'zenbot';
  if (renderer && figureId !== nextFigure) {renderer.dispose(); renderer = undefined;}
  if (!renderer && window.ZenixZenbot) {
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:100%;height:100%;pointer-events:none';
    character.replaceChildren(canvas);
    figureId = nextFigure;
    renderer = new window.ZenixZenbot.Renderer(canvas, new URL('../dist/assistant/' + nextFigure, location.href).href, {figure: nextFigure});
    renderer.ready.catch(() => {message.textContent = '人物素材加载失败，请重新打开助手';});
  }
  renderer?.setState(action, {animated, direction: movement.direction || 1, tilt: movement.tilt || 0, gaze, motion: action === 'idle' && movement.mode === 'walk' ? 'walk' : undefined});
}
function react(kind = 'tap') {
  if (voiceSession || ['thinking','executing','talking'].includes(state)) return;
  clearTimeout(resetTimer);
  interaction = kind;
  message.textContent = kind === 'pet' ? '摸摸头，收到啦 ♡' : kind === 'tap' ? '我在这里。双击可以聊天' : '';
  void window.zenixPetInteraction.perform(kind).catch(() => {});
  render();
  resetTimer = setTimeout(() => {interaction = ''; message.textContent = ''; render();}, 1800);
}
async function finish(event, cancel = false) {
  const session = gesture;
  if (!session || session.id !== event.pointerId) return;
  gesture = null;
  cancelAnimationFrame(moveFrame); moveFrame = 0;
  document.body.dataset.dragging = 'false';
  lastDrag = session.moved;
  try {
    if (session.target.hasPointerCapture(session.id)) session.target.releasePointerCapture(session.id);
    await session.ready;
    const result = session.dragging ? await window.zenixPet.drag(cancel ? 'cancel' : 'end', session.token) : {moved: session.moved};
    if (!cancel && !session.failed && !result.stale && !session.moved && !result.moved && session.target === character) {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => react(), 230);
    }
  } catch {message.textContent = '拖动未完成，可以松开后重试';}
  render();
}
for (const target of [character, grip]) {
  target.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || gesture) return;
    event.preventDefault();
    menu.hidden = true; lastDrag = false;
    clearTimeout(clickTimer); clearTimeout(resetTimer); interaction = '';
    const session = {id:event.pointerId, token:crypto.randomUUID(), target, dragging:!options.locked, x:event.clientX, y:event.clientY, moved:false, ready:Promise.resolve()};
    gesture = session;
    target.setPointerCapture(event.pointerId);
    if (session.dragging) session.ready = window.zenixPet.drag('start',session.token).catch(() => {session.failed = true; message.textContent = '无法开始拖动，请重新操作';});
  });
  target.addEventListener('pointermove', event => {
    const session = gesture;
    if (!session || session.id !== event.pointerId) return;
    session.moved ||= Math.hypot(event.clientX-session.x,event.clientY-session.y) >= 4;
    if (!session.dragging || session.failed || moveFrame) return;
    moveFrame = requestAnimationFrame(async () => {
      moveFrame = 0;
      await session.ready;
      if (gesture !== session || options.locked || session.failed) return;
      try {
        const result = await window.zenixPet.drag('move',session.token);
        if (gesture === session) document.body.dataset.dragging = String(result.moved);
      } catch {message.textContent = '拖动未完成，可以松开后重试';}
    });
  });
  target.addEventListener('pointerup', event => void finish(event));
  target.addEventListener('pointercancel', event => void finish(event,true));
  target.addEventListener('lostpointercapture', event => {if (gesture?.id === event.pointerId) void finish(event,true);});
}
character.addEventListener('pointermove', event => {
  const bounds = character.getBoundingClientRect();
  gaze = {x: (event.clientX-bounds.left)/bounds.width*2-1,y:(event.clientY-bounds.top)/bounds.height*2-1};
  if (!gesture && lastPointer) stroke += Math.min(50,Math.hypot(event.clientX-lastPointer.x,event.clientY-lastPointer.y));
  lastPointer = {x:event.clientX,y:event.clientY};
  if (!gesture && stroke > 180 && performance.now()-lastPet > 2200) {lastPet=performance.now();stroke=0;react('pet');}
  render();
});
document.addEventListener('pointermove', event => {
  if (gesture) return;
  let hit = !!event.target.closest('nav,#pet-menu,#grip');
  if (!hit) {
    const canvas = character.querySelector('canvas');
    if (canvas) {
      const bounds = canvas.getBoundingClientRect();
      const x = Math.floor((event.clientX-bounds.left)/bounds.width*canvas.width), y = Math.floor((event.clientY-bounds.top)/bounds.height*canvas.height);
      try {hit = x>=0&&y>=0&&x<canvas.width&&y<canvas.height&&canvas.getContext('2d').getImageData(x,y,1,1).data[3]>12;} catch {hit=true;}
    }
  }
  hoverPet(hit || !menu.hidden);
  if (lastHit !== hit) {lastHit=hit;void window.zenixPetInteraction.hit(hit).catch(()=>{});}
}, {passive:true});
character.addEventListener('pointerenter', () => {hoverPet(true);});
character.addEventListener('pointerleave', () => {lastPointer=undefined;stroke=0;gaze={x:0,y:0};});
document.addEventListener('pointerleave', () => {hoverPet(!menu.hidden);});
character.addEventListener('dblclick', event => {
  event.preventDefault();clearTimeout(clickTimer);
  if (!lastDrag) void window.zenixPet.act('chat').catch(() => {message.textContent='聊天窗口暂时无法打开';});
});
character.addEventListener('keydown', event => {
  if (event.key === 'Enter') {event.preventDefault();void window.zenixPet.act('chat');}
  if (event.key === 'ArrowUp') {event.preventDefault();react('jump');}
});
character.addEventListener('wheel', event => {if(!event.ctrlKey||gesture)return;event.preventDefault();void window.zenixPetInteraction.scale(event.deltaY<0?1:-1).catch(() => {message.textContent='人物缩放未保存';});}, {passive:false});
const menuToggle = document.getElementById('pet-menu-toggle');
function hideMenu() {menu.hidden=true;menuToggle.setAttribute('aria-expanded','false');hoverPet(lastHit);}
function toggleMenu() {if(!menu.hidden){hideMenu();return;}menu.hidden=false;hoverPet(true);menuToggle.setAttribute('aria-expanded','true');menu.querySelector('button')?.focus();}
menuToggle.addEventListener('click', toggleMenu);
character.addEventListener('contextmenu', event => {event.preventDefault();toggleMenu();});
document.addEventListener('keydown', event => {if(event.key==='Escape'&&!menu.hidden){event.preventDefault();hideMenu();menuToggle.focus();}});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#pet-menu,#pet-menu-toggle'))hideMenu();});
document.querySelectorAll('[data-pet-motion]').forEach(button => button.addEventListener('click', () => {hideMenu();react(button.dataset.petMotion);}));
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  hideMenu();
  void window.zenixPet.act(button.dataset.action).then(()=>{state='success';render();}).catch(()=>{state='failure';message.textContent='操作未完成，请打开主窗口';render();});
}));
document.getElementById('close').onclick = () => window.close();
window.zenixPet.onOptions(value => {const previous=options.figure?.scale;options=value||{};if(previous!==undefined&&Number.isFinite(options.figure?.scale)&&previous!==options.figure.scale){document.getElementById('scale-chip').textContent=Math.round(options.figure.scale*100)+'%';document.body.dataset.resized='true';clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{document.body.dataset.resized='false';},1800);}if(gesture&&options.locked)void finish({pointerId:gesture.id},true);render();});
window.zenixPet.onSkin(() => {});
document.addEventListener('visibilitychange', () => {if(document.hidden&&gesture)void finish({pointerId:gesture.id},true);render();});
window.addEventListener('blur', () => {if(gesture)void finish({pointerId:gesture.id},true);});
window.addEventListener('beforeunload', () => {renderer?.dispose();clearTimeout(resetTimer);clearTimeout(clickTimer);clearTimeout(resizeTimer);cancelAnimationFrame(moveFrame);});
function shy(){react('tap');}
render();

async function beginVoice(source){
 if(karaokeVoiceLocked){message.textContent='K 歌房间正在使用麦克风';return;}if(voiceSession)return;clearTimeout(resetTimer);const session={token:crypto.randomUUID(),source,held:true,ready:false,recording:new window.zenixHoldRecording.HoldRecording()};voiceSession=session;
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
window.zenixPet.onFeedback?.(value=>{if(typeof value?.karaokeVoiceLocked==='boolean'){karaokeVoiceLocked=value.karaokeVoiceLocked;if(karaokeVoiceLocked&&voiceSession)cancelVoice();return;}if(voiceSession?.held)return;if(!['idle','listening','thinking','executing','success','failure','talking','shy','greeting','cheer'].includes(value?.state))return;clearTimeout(resetTimer);state=value.state;message.textContent=String(value.text||'');render();});
