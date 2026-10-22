/* Device-only native touch probe. No playback, saved data or source configuration changes. */
(() => {
  window.__zenixMobilePerf = {};
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const camera = () => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.space-plane')).transform); return {x:m.m41,y:m.m42,scale:m.m11}; };
  const focus = () => document.querySelector('.space-sticker.is-focused')?.dataset.songId;
  const playback = () => document.querySelector('.mini-info')?.textContent;
  const point = (id,x,y) => ({id,x,y});
  const frame = (action,points) => ({action,points});
  const assert = (condition,message) => { if(!condition) throw Error(message); };
  const runs = [];
  async function touch(frames) { window.__zenixMobilePerf.touch={frames}; while(window.__zenixMobilePerf.touch) await pause(20); await pause(100); }
  async function recenter() { document.querySelector('.space-caption button').click(); await pause(800); }
  function startPoint() {
    const p=document.querySelector('.is-focused .space-poster').getBoundingClientRect(),v=document.querySelector('.space-viewport').getBoundingClientRect();
    const left=Math.max(p.left,v.left)+16,right=Math.min(p.right,v.right)-16,top=Math.max(p.top,v.top)+24,bottom=Math.min(p.bottom,v.bottom)-24;
    for(const fy of [.2,.35,.5,.65,.8])for(const fx of [.5,.3,.7]){
      const x=left+(right-left)*fx,y=top+(bottom-top)*fy;
      if(document.elementFromPoint(x,y)?.closest('.space-poster')===document.querySelector('.is-focused .space-poster'))return {x,y};
    }
    const hit=document.elementFromPoint((left+right)/2,(top+bottom)/2);
    const ancestors=[];for(let e=hit;e;e=e.parentElement)ancestors.push({tag:e.tagName,class:e.getAttribute('class')});
    throw Error('Focused poster blocked: '+JSON.stringify({poster:{x:p.x,y:p.y,w:p.width,h:p.height},viewport:{x:v.x,y:v.y,w:v.width,h:v.height},ancestors}));
  }
  async function observe(name,action,check) {
    const before=camera(),selected=focus(),playing=playback(),samples=[],gaps=[];let active=true,last=performance.now();
    const sample = now => { if(!active)return;gaps.push(now-last);last=now;samples.push({...camera(),panning:document.querySelector('.mobile-space').classList.contains('is-panning')});requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
    try { await action(); } finally { active=false; }
    const after=camera();check(before,after,samples);
    assert(focus()===selected,'Gesture must not change sticker focus');assert(playback()===playing,'Gesture must not change playback');
    assert(!document.querySelector('.mobile-full-player,.song-quick-actions'),'Gesture must not open player or long-press menu');
    gaps.sort((a,b)=>a-b);runs.push({name,before,after,samples:samples.length,movingSamples:samples.filter(s=>s.panning).length,p95Ms:gaps[Math.floor((gaps.length-1)*.95)],maxMs:gaps.at(-1),over33:gaps.filter(g=>g>33.4).length,focusUnchanged:true,playbackUnchanged:true});
  }
  async function run() {
    const readyBy=performance.now()+15000;
    while(document.querySelector('.zenix-intro')){if(performance.now()>readyBy)throw Error('Startup introduction did not finish');await pause(100);}
    document.querySelector('button[aria-label="关闭更新提醒"]')?.click();
    document.querySelector('.mobile-nav button:nth-child(2)').click();await pause(1300);
    document.querySelector('button[aria-label="关闭更新提醒"]')?.click();await pause(300);await recenter();
    assert(document.querySelector('.space-plane'),'Music space must contain songs');
    for(let cycle=0;cycle<3;cycle++) {
      const p=startPoint();
      await observe('single-drag-'+cycle,async()=>{
        const frames=[frame(0,[point(0,p.x,p.y)])];
        for(let step=1;step<=12;step++) frames.push(frame(2,[point(0,p.x-step*5,p.y-step*3)]));
        frames.push(frame(1,[point(0,p.x-60,p.y-36)]));await touch(frames);
      },(before,after,samples)=>{
        assert(Math.abs(after.x-before.x+60)<3&&Math.abs(after.y-before.y+36)<3,'One finger must complete full drag after capture handoff');
        const moving=samples.filter(s=>s.panning);assert(moving.length>=3,'Continuous panning must remain active');
        assert(new Set(moving.map(s=>Math.round(s.x))).size>=3,'Drag must show multiple intermediate positions');
      });await recenter();
    }
    const p=startPoint();
    await observe('pinch-and-single-continuation',async()=>{
      const frames=[frame(0,[point(0,p.x-24,p.y)]),frame(261,[point(0,p.x-24,p.y),point(1,p.x+24,p.y)])];
      for(let step=1;step<=8;step++) frames.push(frame(2,[point(0,p.x-24-step*2,p.y),point(1,p.x+24+step*2,p.y)]));
      frames.push(frame(262,[point(0,p.x-40,p.y),point(1,p.x+40,p.y)]));
      for(let step=1;step<=8;step++) frames.push(frame(2,[point(0,p.x-40-step*4,p.y-step*2)]));
      frames.push(frame(1,[point(0,p.x-72,p.y-16)]));await touch(frames);
    },(before,after,samples)=>{
      assert(after.scale>before.scale*1.45,'Two fingers must zoom the camera');
      const zoomed=samples.filter(s=>s.scale>before.scale*1.6);assert(zoomed.length>=3,'Zoom must reach final scale before continuation');
      assert(zoomed.at(-1).x<zoomed[0].x-15,'Remaining finger must continue moving after second finger lifts');
    });
    await recenter();window.__zenixMobilePerf.report={ok:true,runs,viewport:{width:innerWidth,height:innerHeight},measurement:'WebView requestAnimationFrame intervals during native touchscreen event injection; not SurfaceFlinger FPS'};
  }
  run().catch(error=>{window.__zenixMobilePerf.report={ok:false,error:String(error),runs};});
})();
