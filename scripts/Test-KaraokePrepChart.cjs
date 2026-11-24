const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const ts = require('typescript');

require.extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);

const {discoverChart,validatePreparedChart,confirmPreparedChart}=require('../src/features/karaoke/prep-chart.ts');

const track={id:'first',providerId:'source',remoteId:'recording',source:'custom',title:'Code Monkey',artist:'Jonathan Coulton',duration:10,path:'',audioUrl:''};
const backing={...track,id:'backing',remoteId:'backing-track',title:'Code Monkey (Instrumental)'};
const generatedDigest='a'.repeat(64);
const generatedBacking={...backing,id:'karaoke-separated:'+generatedDigest,source:'local',providerId:undefined,remoteId:undefined,audioUrl:'yzqxy://karaoke-backing/'+generatedDigest,duration:10,size:undefined,modifiedAt:undefined};
const binding={original:track,accompaniment:backing};
const signal=()=>new AbortController().signal;
const file={name:'song.txt',data:'#TITLE:Code Monkey\n#ARTIST:Jonathan Coulton\n#BPM:120\n#GAP:0\n: 0 4 0 early\n- 4\n: 4 8 2 late\nE'};

test('official title and artist still produce a review candidate without a verified recording pair',async()=>{
  const result=await discoverChart(track,signal());
  assert.equal(result.status,'review');
  assert.equal(result.candidates.length,1);
  assert.equal(result.chart,undefined);
  assert.equal((await discoverChart({...track,artist:'Different singer'},signal())).status,'missing');
});

test('timeline validation preserves parser semantics, rejects truncation and refuses ordinary LRC as a pitch chart',async()=>{
  const prepared=await validatePreparedChart(file,binding,signal());
  assert.equal(prepared.descriptor.pitchTrack.lines[1].notes[0].startMs,500);
  assert.match(prepared.sha256,/^[\da-f]{64}$/i);
  await assert.rejects(validatePreparedChart(file,{...binding,accompaniment:{...backing,duration:.8}},signal()),/时长/);
  await assert.rejects(validatePreparedChart({...file,data:file.data.replace('Jonathan Coulton','Different singer')},binding,signal()),/歌手/);
  await assert.rejects(validatePreparedChart({name:'song.lrc',data:'[00:01.00]text only'},binding,signal()),/音高/);
});

test('an unversioned local blob can be used explicitly this round, but is not remembered',async()=>{
  const pair={...backing,source:'local',audioUrl:'blob:local',remoteId:undefined};
  const accepted=await confirmPreparedChart(file,{original:track,accompaniment:pair},signal());
  assert.equal(accepted.persisted,false);
  assert.equal((await discoverChart(track,signal(),{accompaniment:pair})).status,'review');
});

test('a canceled request cannot publish candidates or verified data',async()=>{
  const controller=new AbortController();
  const cause=new Error('switched song');
  controller.abort(cause);
  await assert.rejects(discoverChart(track,controller.signal),error=>error===cause);
  await assert.rejects(validatePreparedChart(file,binding,controller.signal),error=>error===cause);
});

test('Electron IndexedDB restores only an explicitly confirmed original and backing pair', {skip:process.platform!=='win32'},async t=>{
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'zenix-prep-chart-'));
  t.after(()=>fsp.rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:75}));
  const root=path.resolve(__dirname,'..');
  const obj=JSON.stringify({track,backing,file,generatedBacking,generatedDigest});
  const esbuild=require('esbuild');
  await esbuild.build({
    stdin:{contents:`
      import {confirmPreparedChart,discoverChart,forgetPreparedChart} from './src/features/karaoke/prep-chart';
      const {track,backing,file,generatedBacking,generatedDigest}=${obj};
      const s=()=>new AbortController().signal;
      window.chartCheck=async step=>{
        if(step==='save')return confirmPreparedChart(file,{original:track,accompaniment:backing},s());
        if(step==='read')return discoverChart(track,s(),{accompaniment:backing});
        if(step==='save-generated')return confirmPreparedChart(file,{original:track,accompaniment:generatedBacking,accompanimentDigest:generatedDigest},s());
        if(step==='read-generated')return discoverChart(track,s(),{accompaniment:generatedBacking,accompanimentDigest:generatedDigest});
        if(step==='another-recording')return discoverChart({...track,remoteId:'different-version'},s(),{accompaniment:backing});
        if(step==='another-backing')return discoverChart(track,s(),{accompaniment:{...backing,remoteId:'different-backing'}});
        if(step==='storage-error'){
          const original=IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put=function(){throw new DOMException('fixture quota full','QuotaExceededError');};
          try{return await confirmPreparedChart(file,{original:track,accompaniment:backing},s());}
          finally{IDBObjectStore.prototype.put=original;}
        }
        if(step==='forget')return forgetPreparedChart({original:track,accompaniment:backing},s());
      };`,resolveDir:root,loader:'ts'},
    bundle:true,platform:'browser',target:'chrome120',outfile:path.join(directory,'bundle.js'),logLevel:'silent'
  });
  await fsp.writeFile(path.join(directory,'app.html'),'<!doctype html><meta charset=utf-8><script defer src="bundle.js"></script>');
  const launch=path.join(directory,'launch.cjs');
  await fsp.writeFile(launch,`
    const path=require('node:path'), assert=require('node:assert/strict');
    const {app,BrowserWindow}=require('electron');
    app.setPath('userData',path.join(__dirname,'profile'));
    app.disableHardwareAcceleration();
    app.whenReady().then(async()=>{
      const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      const load=()=>win.loadFile(path.join(__dirname,'app.html'));
      const run=action=>win.webContents.executeJavaScript('window.chartCheck('+JSON.stringify(action)+')');
      try {
        await load();
        assert.equal((await run('read')).status,'review');
        const unsaved=await run('storage-error');
        assert.equal(unsaved.persisted,false);
        assert.match(unsaved.persistenceError,/fixture quota full/);
        assert.equal(unsaved.descriptor.pitchTrack.lines.length,2);
        const saved=await run('save');
        assert.equal(saved.persisted,true);
        await load();
        const restored=await run('read');
        assert.equal(restored.status,'ready');
        assert.equal(restored.chart.sha256,saved.sha256);
        assert.equal(restored.chart.descriptor.pitchTrack.lines.length,2);
        const generatedSaved=await run('save-generated');
        assert.equal(generatedSaved.persisted,true);
        await load();
        const generatedRestored=await run('read-generated');
        assert.equal(generatedRestored.status,'ready');
        assert.equal(generatedRestored.chart.sha256,generatedSaved.sha256);
        assert.equal((await run('another-recording')).status,'review');
        assert.equal((await run('another-backing')).status,'review');
        await run('forget');
        await load();
        assert.equal((await run('read')).status,'review');
        console.log('KTV_CHART_DB_OK');
        app.quit();
      }catch(error){console.error(error);app.exit(1);}
    });
  `);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=await promisify(execFile)(require('electron'),[launch],{timeout:25000,windowsHide:true,env});
  assert.match(result.stdout,/KTV_CHART_DB_OK/);
});
