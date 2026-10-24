(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.zenixAssistantSkin=value;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const states=['idle','listening','thinking','executing','success','failure','shy','talking','greeting','cheer'];
  function integer(value,min,max,label){if(!Number.isInteger(value)||value<min||value>max)throw Error(label+'无效');return value;}
  function clean(raw,files){
    if(!raw||raw.schema!==1)throw Error('皮肤规范版本不受支持');
    const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
    const width=integer(raw.width,16,2048,'画布宽度'),height=integer(raw.height,16,2048,'画布高度');
    const frames=raw.frames;if(!Array.isArray(frames)||!frames.length||frames.length>96)throw Error('图片数量应为1–96张');if(width*height*frames.length>16777216)throw Error('皮肤解码像素超过限制，请减少画布或帧数');
    let total=0;const cleanFrames=frames.map(name=>{
      if(typeof name!=='string'||!/^frames\/[a-zA-Z0-9_-]+\.png$/.test(name))throw Error('图片必须是frames目录内的PNG文件');
      const bytes=files[name];if(!(bytes instanceof Uint8Array)||bytes.length<33||bytes.length>2*1024*1024)throw Error('图片缺失或超过2 MiB');
      const png=[137,80,78,71,13,10,26,10];if(!png.every((v,i)=>bytes[i]===v))throw Error('只支持透明PNG图片');
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint32(16)!==width||view.getUint32(20)!==height)throw Error('序列帧尺寸须与画布一致');
      total+=bytes.length;if(total>16*1024*1024)throw Error('皮肤展开后超过16 MiB');return name;
    });
    const animations={};for(const state of states){const value=raw.animations?.[state]||(state==='idle'?null:raw.animations?.idle);if(!value||!Array.isArray(value.frames)||!value.frames.length||value.frames.length>192)throw Error('必须提供待机动作');animations[state]={frames:value.frames.map(n=>integer(n,0,frames.length-1,'帧索引')),fps:integer(value.fps??12,1,30,'动画速度'),loop:value.loop!==false};}
    const rect=(value,fallback)=>{if(value===undefined)return fallback;if(!Array.isArray(value)||value.length!==4||value.some(n=>!Number.isFinite(n)))throw Error('交互区域无效');const[x,y,w,h]=value;if(x<0||y<0||w<=0||h<=0||x+w>width||y+h>height)throw Error('交互区域超出画布');return value;};
    return {schema:1,name:text(raw.name,80)||'未命名皮肤',author:text(raw.author,80),version:text(raw.version,30)||'1',width,height,frames:cleanFrames,animations,hit:rect(raw.hit,[0,0,width,height]),drag:rect(raw.drag,[0,0,width,height]),scale:Math.min(2,Math.max(.5,Number(raw.scale)||1))};
  }
  const actions=[{id:'play',label:'播放'},{id:'pause',label:'暂停'},{id:'next',label:'下一首'},{id:'previous',label:'上一首'},{id:'bookmark',label:'标记当前片段'},{id:'tasks',label:'打开缓存任务'},{id:'search',label:'搜索歌曲'}];
  function parse(input){const text=String(input||'').trim().slice(0,200);const exact={播放:'play',继续播放:'play',暂停:'pause',暂停播放:'pause',下一首:'next',切歌:'next',上一首:'previous',标记:'bookmark',标记当前片段:'bookmark',打开缓存:'tasks',打开缓存任务:'tasks'};if(exact[text])return {action:exact[text],args:{}};const search=text.match(/^(?:搜索|搜一下|找歌)\s*(.+)$/);if(search)return {action:'search',args:{query:search[1].trim()}};return null;}
  return {states,clean,actions,parse};
});
