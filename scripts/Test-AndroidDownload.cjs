const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
test('production Android APK download streams by progress, resumes exact ranges and preserves validation',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-download-jvm-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const home=process.env.JAVA_HOME||(process.platform==='win32'?'C:/Program Files/Android/Android Studio/jbr':null),bin=name=>home?path.join(home,'bin',name+(process.platform==='win32'?'.exe':'')):name;
 const dependencies=[['com.squareup.okhttp3','okhttp','4.12.0'],['com.squareup.okio','okio-jvm','3.6.0'],['org.jetbrains.kotlin','kotlin-stdlib','2.2.10']];
 const jars=await Promise.all(dependencies.map(async([group,name,version])=>{
  const cache=path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1',group,name,version);try{for(const sub of await fs.readdir(cache)){const file=path.join(cache,sub,`${name}-${version}.jar`);try{await fs.access(file);return file;}catch{}}}catch{}
  const file=path.join(folder,`${name}.jar`),response=await fetch(`https://repo.maven.apache.org/maven2/${group.replaceAll('.','/')}/${name}/${version}/${name}-${version}.jar`);if(!response.ok)throw Error('JVM dependency unavailable');await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));return file;
 }));
 const certificate=path.join(folder,'synthetic-fixture.p12');await promisify(execFile)(bin('keytool'),['-genkeypair','-alias','fixture','-keyalg','RSA','-keysize','2048','-validity','2','-dname','CN=github.com','-ext','SAN=dns:github.com,dns:release-assets.githubusercontent.com','-storetype','PKCS12','-keystore',certificate,'-storepass','fixture-only','-keypass','fixture-only','-noprompt'],{timeout:45000,windowsHide:true});
 const root=path.resolve(__dirname,'../android/app/src/main/java/com/zenix/musicplayer'),classpath=jars.join(path.delimiter);
 await promisify(execFile)(bin('javac'),['--add-modules','jdk.httpserver','-cp',classpath,'-d',folder,...['UpdateUrlPolicy','UpdateHttp','UpdateDownload','SourceAddressPolicy'].map(name=>path.join(root,name+'.java')),path.join(__dirname,'fixtures/UpdateTransportCheck.java'),path.join(__dirname,'fixtures/UpdateDownloadCheck.java')],{timeout:30000,windowsHide:true});
 const {stdout,stderr}=await promisify(execFile)(bin('java'),['--add-modules','jdk.httpserver','-cp',folder+path.delimiter+classpath,'com.zenix.musicplayer.UpdateDownloadCheck',certificate,folder],{timeout:25000,windowsHide:true});assert.match(stdout,/UPDATE_DOWNLOAD_PASS/,stderr);
 const updater=await fs.readFile(path.join(root,'AppUpdates.java'),'utf8');assert.match(updater,/UpdateDownload\.fetch/);assert.match(updater,/name\+"\.part"/);assert.doesNotMatch(updater,/elapsedRealtime\(\)\+600000|http\.open\([^\n]*600000/);
 assert.match(updater,/validateApk\(partial,item,true\)/);assert.match(updater,/own\.equals\(next\)/);assert.match(updater,/getPackageName\(\)\.equals\(incoming.packageName\)/);
});
