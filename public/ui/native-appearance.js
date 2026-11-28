import {installAppearance,readAppearance,saveAppearance,defaults,appearanceKey} from './appearance.js';

document.documentElement.classList.add('zenix-native-appearance');
let context, voice, dispose, refreshControls = () => {};
const silence = () => {try {voice?.stop();} catch {} voice = undefined;};
// Auxiliary windows have no React player. A bounded Web Audio tick supplies
// optional feedback without a second media player or a remote resource.
const click = event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button,summary,input[type=checkbox],input[type=radio]');
  if (!button || button.matches(':disabled,[aria-disabled=true],#voice') || button.closest('[data-ui-sound=off]') || event.defaultPrevented) return;
  try {
    const config = JSON.parse(localStorage.getItem('zenix.ui-sounds.v1') || '{}');
    if (config.enabled === false) return;
    const volume = typeof config.volume === 'number' && Number.isFinite(config.volume) ? Math.max(0,Math.min(1,config.volume)) : .85;
    if (!volume) return;
    context ??= new AudioContext({latencyHint:'interactive'});void context.resume().catch(()=>{});silence();
    const oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
    oscillator.type = 'sine';oscillator.frequency.setValueAtTime(/关闭|取消|返回|收起/.test(button.getAttribute('aria-label')||button.textContent||'') ? 540 : 820,now);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(volume*.07,now+.004);gain.gain.exponentialRampToValueAtTime(.0001,now+.045);
    oscillator.connect(gain);gain.connect(context.destination);voice=oscillator;oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();if(voice===oscillator)voice=undefined;};oscillator.start(now);oscillator.stop(now+.05);
  } catch { /* Optional feedback cannot prevent the action. */ }
};
const storage = event => {
  if (event.key === 'zenix.ui-sounds.v1' || event.key === null) silence();
  if (event.key === appearanceKey || event.key === null) refreshControls();
};
const start = () => {
  if (dispose) return;
  dispose = installAppearance(document);
  document.addEventListener('click',click);window.addEventListener('storage',storage);
  refreshControls();
};
const stop = () => {
  dispose?.();dispose = undefined;
  document.removeEventListener('click',click);window.removeEventListener('storage',storage);silence();
  const previous = context;context = undefined;
  if(previous)void previous.close().catch(()=>{});
};
start();
window.addEventListener('pagehide',stop);
window.addEventListener('pageshow',event=>{if(event.persisted)start();});

// Remote browser clients own their preferences. They can adjust them without
// gaining any new desktop or library permission.
if (location.protocol === 'http:' || location.protocol === 'https:') {
  const open = document.createElement('button');open.textContent='Style';open.className='zx-native-style-open';open.type='button';
  const dialog=document.createElement('dialog');dialog.className='zx-native-style-dialog';
  dialog.innerHTML='<form method="dialog"><h2>Style.</h2><button type="submit" aria-label="关闭 Style 设置">关闭</button></form><p>此浏览器的独立外观设置</p><label>视觉模式<select data-key="mode"><option value="dark">黑色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></label><label>材质<select data-key="style"><option value="default">Default</option><option value="glass">Glass</option><option value="neon">Neon</option><option value="paper">Paper</option><option value="sharp">Sharp</option></select></label><label>强调色<select data-key="accent"><option value="cyan">冰青</option><option value="red">绯红</option><option value="orange">暖橙</option><option value="blue">电蓝</option><option value="purple">极光紫</option><option value="green">松针绿</option></select></label><label>按钮设计<select data-key="button"><option value="blog">博客原版</option><option value="solid">实心</option><option value="outline">描边</option><option value="pixel">像素压边</option></select></label><label>圆角<input type="range" data-key="radius" min="0" max="24"><output></output></label><label>描边<input type="range" data-key="stroke" min="1" max="3" step="0.5"><output></output></label><label>按压厚度<input type="range" data-key="depth" min="0" max="8"><output></output></label><label>按钮高度<input type="range" data-key="height" min="36" max="52"><output></output></label><p class="zx-native-style-error" role="alert"></p><button class="zx-native-style-reset" type="button">恢复黑色 Neon 默认</button>';
  document.body.append(open,dialog);
  const refresh=()=>{const {value,error}=readAppearance();for(const control of dialog.querySelectorAll('[data-key]')){control.value=value[control.dataset.key];if(control.nextElementSibling?.tagName==='OUTPUT')control.nextElementSibling.textContent=control.value+' px';}dialog.querySelector('[role=alert]').textContent=error;};
  refreshControls=()=>{if(dialog.open)refresh();};
  open.addEventListener('click',()=>{refresh();dialog.showModal();});
  dialog.addEventListener('input',event=>{const key=event.target.dataset.key;if(!key)return;try{const value=event.target.type==='range'?Number(event.target.value):event.target.value;saveAppearance({...readAppearance().value,[key]:value});refresh();}catch(error){dialog.querySelector('[role=alert]').textContent=error.message;}});
  dialog.querySelector('.zx-native-style-reset').addEventListener('click',()=>{try{saveAppearance({...defaults},{reset:true});refresh();}catch{dialog.querySelector('[role=alert]').textContent='外观未能保存，请重试。';}});
}
