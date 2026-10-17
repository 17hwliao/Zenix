const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {RemoteControl}=require('../electron/runtime/remote-control.cjs');
test('Android production LAN client pairs with the real desktop host, controls playback, rejects revoked sessions and never follows redirects',async t=>{
  const ip=Object.values(os.networkInterfaces()).flat().find(item=>item?.family==='IPv4'&&!item.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address))?.address;
  if(!ip){t.skip('No RFC1918 interface for native LAN transport integration');return;}
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-native-remote-'));t.after(async()=>{const absolute=path.resolve(folder),root=path.resolve(os.tmpdir());assert(absolute.startsWith(root+path.sep));await fs.rm(absolute,{recursive:true,force:true});});
  const calls=[],remote=new RemoteControl((action,value)=>{calls.push([action,value]);if(action==='volume')for(const id of remote.clients.keys())remote.approve(id,false);});t.after(()=>remote.stop());await remote.start();remote.update({title:'Remote Fixture',artist:'Artist',duration:120,position:20,playing:true,volume:.75,url:'PRIVATE'});
  const approve=setInterval(()=>{for(const[id,value]of remote.clients)if(!value.approved)remote.approve(id,true);},10);t.after(()=>clearInterval(approve));
  let redirects=0;const redirected=http.createServer((req,res)=>{redirects++;res.writeHead(302,{Location:`http://${ip}:${remote.port}/api`});res.end();});await new Promise(resolve=>redirected.listen(0,'0.0.0.0',resolve));t.after(()=>{redirected.closeAllConnections();redirected.close();});
  const javaHome=process.env.JAVA_HOME||'C:/Program Files/Android/Android Studio/jbr',bin=name=>path.join(javaHome,'bin',name+(process.platform==='win32'?'.exe':''));
  const cache=path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');let jar;
  let cached=[];try{cached=await fs.readdir(cache);}catch{}
  for(const child of cached){const candidate=path.join(cache,child,'json-20250517.jar');try{await fs.access(candidate);jar=candidate;break;}catch{}}
  if(!jar){jar=path.join(folder,'json.jar');const response=await fetch('https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar');assert(response.ok,'JVM JSON runtime unavailable');await fs.writeFile(jar,Buffer.from(await response.arrayBuffer()));}
  const root=path.resolve(__dirname,'../android/app/src/main/java/com/zenix/musicplayer');await promisify(execFile)(bin('javac'),['-cp',jar,'-d',folder,path.join(root,'Json.java'),path.join(root,'RemoteClient.java'),path.join(__dirname,'fixtures/RemoteClientCheck.java')],{timeout:30000,windowsHide:true});
  const {stdout}=await promisify(execFile)(bin('java'),['-cp',folder+path.delimiter+jar,'com.zenix.musicplayer.RemoteClientCheck',`${ip}:${remote.port}`,remote.code,`${ip}:${redirected.address().port}`],{timeout:30000,windowsHide:true});assert.match(stdout,/REMOTE_CLIENT_CONTRACT_PASS/);assert.deepEqual(calls,[['play-pause',undefined],['next',undefined],['previous',undefined],['seek',42],['volume',.4]]);assert.equal(redirects,1);
});
