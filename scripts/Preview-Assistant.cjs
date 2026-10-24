/** Local assistant acceptance only. No installed-client profile, updater or sources are loaded. */
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'release','muse-conversation-preview');
fs.mkdirSync(root,{recursive:true});
if(!process.versions.electron){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const receipt=path.join(root,'launch.json');
 if(fs.existsSync(receipt)){try{const saved=JSON.parse(fs.readFileSync(receipt,'utf8'));process.kill(saved.pid,0);console.log('星音验收窗口已运行，PID '+saved.pid);process.exit(0);}catch{}}
 const fd=fs.openSync(path.join(root,'app.log'),'a');const child=require('node:child_process').spawn(require('electron'),[__filename],{cwd:repo,env,windowsHide:false,detached:true,stdio:['ignore',fd,fd]});child.unref();
 fs.writeFileSync(receipt,JSON.stringify({pid:child.pid,root,title:'Zenix · 星音语音与动作验收',personalDataAccess:false},null,2));console.log('已启动星音语音与动作验收，PID '+child.pid);
}else{
 const {app,BrowserWindow,ipcMain,screen}=require('electron');
 app.setName('Zenix 星音语音验收');app.setPath('userData',path.join(root,'private-profile'));
 let control,assistant,vite,http;
 app.whenReady().then(async()=>{
  const {createServer}=await import('vite');vite=await createServer({root:repo,cacheDir:path.join(root,'vite'),optimizeDeps:{entries:['scripts/fixtures/assistant-conversation.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/release/**','**/android/**']}},logLevel:'error'});await vite.listen();http=vite.httpServer;
  const preload=path.join(root,'preload.cjs');fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');const listen=(channel,callback)=>{const fn=(_,value)=>callback(value);ipcRenderer.on(channel,fn);return()=>ipcRenderer.removeListener(channel,fn);};contextBridge.exposeInMainWorld('yzqxy',{companion:{invoke:args=>ipcRenderer.invoke('muse:assistant',args),onVoice:callback=>listen('assistant:utterance',callback),onVoiceStart:callback=>listen('assistant:voice-start',callback)}});`);
  control=new BrowserWindow({title:'Zenix · 星音语音与动作验收',width:1000,height:820,minWidth:360,minHeight:560,backgroundColor:'#111b28',autoHideMenuBar:true,webPreferences:{preload,contextIsolation:true,sandbox:true,nodeIntegration:false}});
  const {Assistant}=require('../electron/runtime/assistant.cjs');
  assistant=new Assistant({folder:app.getPath('userData'),dialog:require('electron').dialog,getWindow:()=>control,BrowserWindow,ipcMain,screen,execute:async(action,value)=>{
   if(control.isDestroyed())return;if(action==='voiceStart')control.webContents.send('assistant:voice-start');else if(action==='voice')control.webContents.send('assistant:utterance',value);else if(action==='show'){control.show();control.focus();}else await assistant.invoke({action:'feedback',state:'success',text:'独立验收：已识别音乐操作，未控制正式播放器。'});
  }});await assistant.load();
  ipcMain.handle('muse:assistant',(event,args)=>{if(event.sender!==control.webContents||args?.operation!=='assistant')throw Error('无权访问验收窗口');return assistant.invoke(args);});
  control.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  control.on('closed',()=>app.quit());
  await control.loadURL(`http://127.0.0.1:${http.address().port}/scripts/fixtures/assistant-conversation.html`);
  await assistant.open({size:180,locked:false});const area=screen.getDisplayMatching(control.getBounds()).workArea,b=assistant.window.getBounds();assistant.window.setPosition(area.x+area.width-b.width-28,area.y+100);control.show();control.focus();
  fs.writeFileSync(path.join(root,'ready.json'),JSON.stringify({pid:process.pid,url:control.webContents.getURL(),title:control.getTitle(),personalDataAccess:false,voiceBackend:'Windows System.Speech',ready:true},null,2));
 }).catch(error=>{console.error(error);app.exit(1);});
 app.on('before-quit',()=>{assistant?.close();void vite?.close();http?.close();});
}
