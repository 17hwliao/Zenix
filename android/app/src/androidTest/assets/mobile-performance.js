/* Opt-in device instrumentation only. No song titles, source scripts or URLs are reported. */
(() => {
  window.__zenixMobilePerf = {};
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const next = () => new Promise(resolve => requestAnimationFrame(resolve));
  const find = selector => document.querySelector(selector);
  const click = selector => { const el = find(selector); if (!el) throw Error('Missing UI selector: ' + selector); el.click(); };
  const tasks = [];
  let observer;
  try { observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => ({at:e.startTime,ms:e.duration})))); observer.observe({type:'longtask',buffered:false}); } catch {}
  const runs = [];
  async function measure(name, action, ready) {
    await pause(350);
    const start = performance.now(), gaps = []; let last = start, usableMs = null;
    action();
    while (performance.now()-start < 850) {
      const now = await next(); gaps.push(now-last); last = now;
      if (usableMs === null && ready?.()) usableMs = now-start;
    }
    gaps.sort((a,b)=>a-b);
    runs.push({name,usableMs,frames:gaps.length,p95Ms:gaps[Math.floor((gaps.length-1)*.95)],maxMs:gaps.at(-1),over33:gaps.filter(g=>g>33.4).length,over50:gaps.filter(g=>g>50).length,longTasks:tasks.filter(t=>t.at>=start&&t.at<last),posters:document.querySelectorAll('.space-sticker').length,pages:document.querySelectorAll('.mobile-content').length});
  }
  async function run() {
    click('.brand'); await pause(650);
    for(let cycle=0;cycle<3;cycle++) {
      await measure('home-to-settings',()=>click('.mobile-header [aria-label="设置"]'),()=>find('.mobile-content[data-page="settings"]')&&getComputedStyle(find('.mobile-content[data-page="settings"]')).opacity==='1');
      await measure('settings-to-sources',()=>click('.mobile-nav button:nth-child(3)'),()=>find('.mobile-content[data-page="sources"]')&&getComputedStyle(find('.mobile-content[data-page="sources"]')).opacity==='1');
      await measure('sources-to-home',()=>click('.brand'),()=>find('.mobile-content[data-page="home"]')&&getComputedStyle(find('.mobile-content[data-page="home"]')).opacity==='1');
      await measure('home-to-space',()=>click('.mobile-nav button:nth-child(2)'),()=>find('.space-sticker')&&getComputedStyle(find('.mobile-content[data-page="space"]')).opacity==='1');
      await measure('space-focus',()=>{const posters=document.querySelectorAll('.space-poster');posters[Math.min(1,posters.length-1)]?.click();},()=>!!find('.space-sticker.is-expanded'));
      if(find('.mini-info')) {
        await measure('detail-open',()=>{click('.mini-info');click('.mini-info');},()=>find('.mobile-full-player')?.getBoundingClientRect().top<=1);
        await measure('detail-close',()=>click('.mobile-full-player [aria-label="收起"]'),()=>!find('.mobile-full-player'));
      }
      await measure('space-to-home',()=>click('.brand'),()=>find('.mobile-content[data-page="home"]')&&getComputedStyle(find('.mobile-content[data-page="home"]')).opacity==='1');
    }
    observer?.disconnect();window.__zenixMobilePerf.report={ok:true,runs,viewport:{width:innerWidth,height:innerHeight},memory:performance.memory?{usedBytes:performance.memory.usedJSHeapSize,totalBytes:performance.memory.totalJSHeapSize}:null};
  }
  run().catch(error=>{observer?.disconnect();window.__zenixMobilePerf.report={ok:false,error:String(error),runs};});
})();
