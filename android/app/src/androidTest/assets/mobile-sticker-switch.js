/* Device-only focus switching probe; reports timing/booleans, never song metadata. */
(() => {
  window.__zenixMobilePerf = {};
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const next = () => new Promise(resolve => requestAnimationFrame(resolve));
  const runs = [], tasks = [];
  const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => ({at:e.startTime,ms:e.duration}))));
  observer.observe({type:'longtask',buffered:false});
  const selection = () => document.querySelector('.space-sticker.is-expanded')?.dataset.songId;
  const playingText = () => document.querySelector('.mini-info')?.textContent;
  async function run() {
    document.querySelector('.mobile-nav button:nth-child(2)').click(); await pause(1200);
    const playbackBefore = playingText();
    for(let cycle=0;cycle<9;cycle++) {
      const viewport = document.querySelector('.space-viewport').getBoundingClientRect();
      const before = selection();
      const neighbors = () => [...document.querySelectorAll('.space-sticker:not(.is-expanded) .space-poster')].map(button => {
        const r = button.getBoundingClientRect(), left=Math.max(r.left,viewport.left), right=Math.min(r.right,viewport.right), top=Math.max(r.top,viewport.top), bottom=Math.min(r.bottom,viewport.bottom);
        const x=(left+right)/2,y=(top+bottom)/2;
        return {button,x,y,visible:right-left>12&&bottom-top>12&&document.elementFromPoint(x,y)?.closest('.space-poster')===button,distance:Math.hypot(x-(viewport.left+viewport.width/2),y-(viewport.top+viewport.height/2))};
      }).filter(item=>item.visible).sort((a,b)=>a.distance-b.distance);
      let candidates=neighbors();
      for(let attempt=0;!candidates.length&&attempt<3;attempt++){
        const x=viewport.left+viewport.width/2,y=viewport.top+viewport.height/2;
        window.__zenixMobilePerf.swipe={x,y,toX:x+(attempt===1?-110:110),toY:y+45};
        while(window.__zenixMobilePerf.swipe)await pause(40);
        await pause(200);candidates=neighbors();
      }
      if(!candidates.length)throw Error('No visible neighboring sticker');
      const start=performance.now(),gaps=[];let last=start,usableMs=null;
      candidates[cycle%Math.min(3,candidates.length)].button.click();
      while(performance.now()-start<900){const now=await next();gaps.push(now-last);last=now;if(usableMs===null&&selection()!==before)usableMs=now-start;}
      if(selection()===before)throw Error('Probe did not change focused sticker');
      if(playingText()!==playbackBefore)throw Error('Focus changed current playback');
      gaps.sort((a,b)=>a-b);
      runs.push({name:'sticker-switch',usableMs,frames:gaps.length,p95Ms:gaps[Math.floor((gaps.length-1)*.95)],maxMs:gaps.at(-1),over33:gaps.filter(g=>g>33.4).length,over50:gaps.filter(g=>g>50).length,longTasks:tasks.filter(t=>t.at>=start&&t.at<last),focusChanged:true,playbackUnchanged:true,posters:document.querySelectorAll('.space-sticker').length});
      await pause(300);
    }
    observer.disconnect();window.__zenixMobilePerf.report={ok:true,runs,viewport:{width:innerWidth,height:innerHeight}};
  }
  run().catch(error=>{observer.disconnect();window.__zenixMobilePerf.report={ok:false,error:String(error),runs};});
})();
