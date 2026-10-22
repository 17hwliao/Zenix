let skin=null,timer,resetTimer,options={},state='idle';
const character=document.getElementById('character'),message=document.getElementById('message');
const defaultShape=document.getElementById('default-template').innerHTML;
const labels={idle:'待机',listening:'正在聆听',thinking:'正在思考',executing:'正在执行',success:'已完成',failure:'执行失败'};
function render(){
  clearInterval(timer);
  const animated=!document.hidden&&!options.hidden&&!options.reduced&&options.motion!=='reduced';
  document.body.dataset.animated=String(animated);document.body.dataset.light=String(options.motion==='light');document.body.dataset.state=state;document.body.dataset.musical=String(animated&&options.music!==false&&options.playing===true&&state==='idle');
  character.setAttribute('aria-label','音乐精灵：'+labels[state]);
  if(!skin){character.innerHTML=defaultShape;return;}
  const image=document.createElement('img');image.alt=skin.config.name;image.onerror=()=>{skin=null;message.textContent='皮肤无法显示，已恢复默认';render();};character.replaceChildren(image);
  const animation=skin.config.animations[state]||skin.config.animations.idle;let index=0;
  function frame(){image.src='data:image/png;base64,'+skin.images[skin.config.frames[animation.frames[index]]];index=animation.loop?(index+1)%animation.frames.length:Math.min(index+1,animation.frames.length-1);}
  frame();if(animated&&animation.frames.length>1)timer=setInterval(frame,1000/Math.min(animation.fps,options.fps||12));
}
window.zenixPet.onOptions(value=>{options=value||{};document.getElementById('grip').style.webkitAppRegion=options.locked?'no-drag':'drag';render();});
window.zenixPet.onSkin(value=>{skin=value;render();});
document.addEventListener('visibilitychange',render);
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{if(state==='executing')return;clearTimeout(resetTimer);state='executing';message.textContent=labels[state];render();try{await window.zenixPet.act(button.dataset.action);state='success';message.textContent='';}catch{state='failure';message.textContent='操作未完成，请打开主窗口';}render();resetTimer=setTimeout(()=>{state='idle';render();},1800);}));
document.getElementById('close').onclick=()=>window.close();
render();
