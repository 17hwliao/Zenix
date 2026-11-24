const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {KaraokeSeparation, MODEL_FILE, childCommand, resolveChartWorker, wavInfo} = require('../electron/runtime/karaoke-separation.cjs');

function wave(millis = 1000, sample = 20) {
  const count = Math.floor(44100*millis/1000)*4;
  const data = Buffer.alloc(44+count);
  data.write('RIFF');data.writeUInt32LE(data.length-8,4);
  data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);
  data.writeUInt16LE(1,20);data.writeUInt16LE(2,22);
  data.writeUInt32LE(44100,24);data.writeUInt32LE(176400,28);
  data.writeUInt16LE(4,32);data.writeUInt16LE(16,34);
  data.write('data',36);data.writeUInt32LE(count,40);
  data.writeInt16LE(sample,44);
  return data;
}

async function fixture(t,options = {},overrides = {}) {
  const {realMedia=false,...config}=options;
  const tempDir = await fs.realpath(os.tmpdir());
  const base = await fs.mkdtemp(path.join(tempDir,'zenix-separation-'));
  const folder = path.join(base,'cache');
  const model = path.join(base,MODEL_FILE);
  const input = path.join(base,'! test input （原声）.bin');
  const alias = path.join(base,'same content.mp3');
  const chartWorker = path.join(base,'karaoke-chart-worker.py');
  await fs.writeFile(model,'test model stub');
  await fs.writeFile(input,wave());
  await fs.copyFile(input,alias);
  await fs.writeFile(chartWorker,'# chart worker test fixture\n');
  const inspect = {calls:0,checks:0};
  const service = new KaraokeSeparation({folder,chartWorker,...config},{
    findPython:async () => {inspect.checks++;return {program:'python',prefix:[]};},
    inspectChart:async () => ({available:true,message:''}),
    modelPath:async () => model,
    modelSha:crypto.createHash('sha256').update('test model stub').digest('hex'),
    ...(!realMedia?{
      probe:async source => (await wavInfo(source)).duration,
      decode:async (source,destination) => {await fs.copyFile(source,destination);return wavInfo(destination);},
    }:{}),
    run:async (program,args,{cwd}) => {
      inspect.calls++;
      assert.equal(program,'python');
      assert.ok(args.includes('--two-stems')&&args.includes('vocals'));
      assert.equal(args.at(-1),path.join(cwd,'decoded.wav'));
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      // Stub external inference only; different output bytes prevent an original alias.
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,40));
      return {code:0};
    },
    ...overrides,
  });
  t.after(async () => {
    await service.close();
    const resolved = await fs.realpath(base);
    assert.equal(path.dirname(resolved),tempDir);
    assert.match(path.basename(resolved),/^zenix-separation-[a-z0-9]+$/i);
    await fs.rm(resolved,{force:true,recursive:true});
  });
  return {service,folder,model,input,alias,chartWorker,inspect};
}

const timedLyrics = Object.freeze([
  Object.freeze({startMs:0,endMs:450,text:'Hello'}),
  Object.freeze({startMs:500,endMs:950,text:'Zenix'}),
]);

function ultraStar() {
  return [
    '#TITLE:Test Song',
    '#ARTIST:Test Artist',
    '#BPM:120',
    '#GAP:0',
    '#ZENIX-GENERATOR:zenix-ultrastar-v1',
    ': 0 2 0 Hello',
    '- 4',
    ': 4 2 2 Zenix',
    'E',
    '',
  ].join('\n');
}

function chartOptions(overrides = {}) {
  return {title:'Test Song',artist:'Test Artist',pitchModel:'torchcrepe-0.0.23-full-v1',...overrides};
}

test('publishes only a validated new WAV, reuses by content and survives a fresh broker', async t => {
  const f=await fixture(t);
  assert.equal((await f.service.inspect()).available,true);
  const first=await f.service.start(f.input);
  assert.equal(first.cacheHit,false);
  assert.equal(first.duration,1);
  assert.equal(first.kind,'separated');
  assert.match(first.audioUrl,/^yzqxy:\/\/karaoke-backing\/[a-f0-9]{64}$/);
  assert.equal(f.inspect.calls,1);
  const generated=await f.service.fileFor(first.key);
  assert.ok(generated);
  assert.notDeepEqual(await fs.readFile(generated),await fs.readFile(f.input));
  assert.equal(await f.service.fileFor('../original'),null);
  assert.equal((await f.service.start(f.alias)).cacheHit,true);
  assert.equal(f.inspect.calls,1);
  const restarted=new KaraokeSeparation({folder:f.folder});
  assert.equal((await restarted.cached(f.alias)).key,first.key);
  assert.ok(await restarted.fileFor(first.key));
  await restarted.close();
  await fs.writeFile(f.alias,wave(1000,19));
  const next=await f.service.start(f.alias);
  assert.notEqual(first.key,next.key);
  assert.equal(f.inspect.calls,2);
});

test('inspection distinguishes a usable backing stack from missing chart dependencies', async t => {
  const f=await fixture(t,{},{
    inspectChart:async()=>({available:false,message:'fixture chart dependency missing'}),
  });
  const state=await f.service.inspect();
  assert.equal(state.available,true);
  assert.equal(state.chartAvailable,false);
  assert.match(state.message,/fixture chart dependency missing/);
});

test('deduplicates repeated request, cancels queued process, removes its staging and can retry', async t => {
  let notify;
  const entered = new Promise(resolve => {notify = resolve;});
  let invocation=0;
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd,signal}) => {
      if (++invocation===1) {
        notify();
        return new Promise((_resolve,reject)=>{
          if (signal.aborted) reject(signal.reason);
          signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
        });
      }
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,60));
      return {code:0};
    },
  });
  const active=f.service.start(f.input,{requestId:'active'});
  assert.equal(active,f.service.start(f.input,{requestId:'active'}));
  await entered;
  await assert.rejects(f.service.start(f.alias,{requestId:'other'}),{code:'BUSY'});
  assert.equal(f.service.cancel('other'),false);
  assert.equal(f.service.cancel('active'),true);
  await assert.rejects(active,{name:'AbortError'});
  assert.deepEqual(await fs.readdir(f.folder),[]);
  assert.equal((await f.service.start(f.input,{requestId:'retry'})).cacheHit,false);
});

test('close is bounded when an injected dependency ignores cancellation',async t=>{
  const base=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'zenix-separation-close-'));
  t.after(()=>fs.rm(base,{force:true,recursive:true}));
  const folder=path.join(base,'cache');
  const input=path.join(base,'input.wav');
  const model=path.join(base,MODEL_FILE);
  await fs.writeFile(model,'test model stub');
  await fs.writeFile(input,wave());
  let entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const service=new KaraokeSeparation({folder,closeGraceMs:25},{
    findPython:async()=>({program:'python',prefix:[]}),
    modelPath:async()=>model,
    modelSha:crypto.createHash('sha256').update('test model stub').digest('hex'),
    probe:async()=>1,
    decode:async(_source,destination)=>{
      await fs.writeFile(destination,wave());
      return {duration:1,channels:2,sampleRate:44100,bits:16,size:(await fs.stat(destination)).size};
    },
    run:async()=>{entered();return new Promise(()=>{});},
  });
  const active=service.start(input,{requestId:'ignores-cancel'});
  await waiting;
  const started=Date.now();
  await service.close();
  assert(Date.now()-started<1000,'close must not hang on a dependency that ignores the signal');
  assert.equal(service.closed,true);
  active.catch(()=>{});
});

test('does not commit invalid output or dependency failure and never accepts an untrusted model', async t => {
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd}) => {
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(500));
      return {code:0};
    },
  });
  await assert.rejects(f.service.start(f.input),{code:'OUTPUT'});
  assert.deepEqual(await fs.readdir(f.folder),[]);
  await fs.writeFile(f.model,'signed fake');
  await assert.rejects(f.service.start(f.input),{code:'MODEL'});
  assert.deepEqual(await fs.readdir(f.folder),[]);
  f.service.engine.findPython=async()=>null;
  assert.equal((await f.service.inspect()).available,false);
  await assert.rejects(f.service.start(f.input),{code:'DEPENDENCY'});
  assert.deepEqual(await fs.readdir(f.folder),[]);
  await assert.rejects(f.service.start('https://example.invalid/output.wav'),{code:'INPUT'});
});

test('reports a Demucs runtime version mismatch as a dependency failure', async t => {
  const f=await fixture(t,{},{run:async()=>({code:40})});
  await assert.rejects(f.service.start(f.input),{code:'DEPENDENCY'});
  assert.deepEqual(await fs.readdir(f.folder),[]);
});

test('a child timeout rejects at the deadline while process cleanup continues', async () => {
  const started=Date.now();
  await assert.rejects(childCommand(process.execPath,[
    '-e',
    'setInterval(() => undefined,1000)',
  ],{
    cwd:process.cwd(),
    timeoutMs:150,
    timeoutMessage:'fixture timeout',
    timeoutCode:'TIMEOUT',
  }),{code:'TIMEOUT',message:'fixture timeout'});
  assert.ok(Date.now()-started < 2000);
});

test('child stderr progress is delivered line by line without changing captured diagnostics',async()=>{
  const lines=[];
  const progressLine='{"status":"progress","stage":"aligning"}';
  const result=await childCommand(process.execPath,[
    '-e',
    `process.stderr.write(${JSON.stringify(progressLine)}+"\\n");process.stderr.write("last line")`,
  ],{
    cwd:process.cwd(),
    stderr:true,
    onStderrLine:line=>lines.push(line),
  });
  assert.equal(result.code,0);
  assert.deepEqual(lines,[
    '{"status":"progress","stage":"aligning"}',
    'last line',
  ]);
  assert.equal(result.errorOutput,'{"status":"progress","stage":"aligning"}\nlast line');
});

test('budget limit prunes just validated cache keys, not neighboring files',async t=>{
  const f=await fixture(t,{budgetBytes:220000});
  const first=await f.service.start(f.input);
  const neighbor=path.join(f.folder,'keep.wav');
  await fs.writeFile(neighbor,wave());
  await fs.writeFile(f.alias,wave(1000,19));
  const latest=await f.service.start(f.alias);
  assert.equal(await f.service.fileFor(first.key),null);
  assert.ok(await f.service.fileFor(latest.key));
  assert.ok(await fs.stat(neighbor));
});

test('startWithChart publishes validated dual stems, returns a chart, and reuses the sidecar after restart',async t=>{
  let separationCalls=0;
  let chartCalls=0;
  const progressStages=[];
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd}) => {
      separationCalls++;
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'vocals.wav'),wave(1000,35));
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,40));
      return {code:0};
    },
    runChart:async (_program,args,{cwd,onStderrLine}) => {
      chartCalls++;
      const output=args[args.indexOf('--output')+1];
      const configPath=args[args.indexOf('--config-file')+1];
      assert.ok(configPath.startsWith(cwd));
      const config=JSON.parse(await fs.readFile(configPath,'utf8'));
      assert.equal(config.title,'Test Song');
      assert.equal(config.lyrics.length,2);
      assert.ok(output.startsWith(cwd));
      onStderrLine('{"status":"progress","stage":"aligning"}');
      await fs.writeFile(output,ultraStar());
      return {code:0,output:JSON.stringify({warnings:['Fixture note'],noteCount:2,lineCount:2,bpm:120,bpmFallback:false,models:{pitch:'fixture'}})};
    },
  });
  const result=await f.service.startWithChart(f.input,{requestId:'chart-ready',lyrics:timedLyrics,options:chartOptions(),onProgress:stage=>progressStages.push(stage)});
  assert.equal(result.status,'ready');
  assert.equal(result.backing.duration,1);
  assert.equal(result.chart.noteCount,2);
  assert.equal(result.chart.lineCount,2);
  assert.equal(result.chart.bpm,120);
  assert.match(result.chart.sha256,/^[a-f0-9]{64}$/);
  assert.match(result.chart.lyricsSha256,/^[a-f0-9]{64}$/);
  assert.match(result.chart.data,/^#TITLE:Test Song/m);
  assert.ok(await f.service.fileFor(result.backing.key));
  assert.equal(separationCalls,1);
  assert.equal(chartCalls,1);
  assert.deepEqual(progressStages,['publishing','pitching','aligning','validating']);
  const stages=(await fs.readdir(f.folder)).filter(name=>name.startsWith('.job-'));
  assert.deepEqual(stages,[]);

  const cached=await f.service.startWithChart(f.input,{requestId:'chart-ready-again',lyrics:timedLyrics,options:chartOptions()});
  assert.equal(cached.status,'ready');
  assert.equal(cached.chart.cacheHit,true);
  assert.equal(cached.chart.lyricsSha256,result.chart.lyricsSha256);
  assert.equal(separationCalls,1);
  assert.equal(chartCalls,1);

  const restarted=new KaraokeSeparation({folder:f.folder,chartWorker:f.chartWorker},{
    run:async()=>{throw Error('separated inference must not run for a complete cache');},
    runChart:async()=>{throw Error('chart inference must not run for a complete cache');},
  });
  t.after(()=>restarted.close());
  const restored=await restarted.startWithChart(f.input,{requestId:'chart-restarted',lyrics:timedLyrics,options:chartOptions()});
  assert.equal(restored.status,'ready');
  assert.equal(restored.chart.cacheHit,true);
});

test('chart failure returns a partial result while keeping the validated backing',async t=>{
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd}) => {
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'vocals.wav'),wave(1000,35));
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,40));
      return {code:0};
    },
    runChart:async()=>({
      code:2,
      output:'',
      errorOutput:'diagnostic line\n'+JSON.stringify({status:'error',code:'DEPENDENCY',message:'torchcrepe package metadata is unavailable'}),
    }),
  });
  const result=await f.service.startWithChart(f.input,{requestId:'chart-failure',lyrics:timedLyrics,options:chartOptions()});
  assert.equal(result.status,'partial');
  assert.match(result.chartFailure,/torchcrepe package metadata is unavailable/);
  assert.equal(result.backing.duration,1);
  assert.ok(await f.service.fileFor(result.backing.key));
  assert.deepEqual((await fs.readdir(f.folder)).filter(name=>name.startsWith('.job-')),[]);
});

test('an invalid chart draft is rejected without invalidating its backing',async t=>{
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd}) => {
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'vocals.wav'),wave(1000,35));
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,40));
      return {code:0};
    },
    runChart:async (_program,args) => {
      await fs.writeFile(args[args.indexOf('--output')+1],'#BPM:120\n: 0 1 0 no identity\nE\n');
      return {code:0,output:''};
    },
  });
  const result=await f.service.startWithChart(f.input,{requestId:'chart-invalid',lyrics:timedLyrics,options:chartOptions()});
  assert.equal(result.status,'partial');
  assert.match(result.chartFailure,/缺少 TITLE/);
  assert.ok(await f.service.fileFor(result.backing.key));
  assert.deepEqual((await fs.readdir(f.folder)).filter(name=>name.endsWith('.chart.json')),[]);
});

test('a valid chart remains usable when only its reuse sidecar cannot be saved',async t=>{
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd}) => {
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'vocals.wav'),wave(1000,35));
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,40));
      return {code:0};
    },
    runChart:async (_program,args) => {
      await fs.writeFile(args[args.indexOf('--output')+1],ultraStar());
      return {code:0,output:JSON.stringify({warnings:[],noteCount:2,lineCount:2,bpm:120,bpmFallback:false,models:{}})};
    },
  });
  f.service.writeChartCache=async()=>{throw Error('fixture cache write failure');};
  const result=await f.service.startWithChart(f.input,{requestId:'chart-cache-write-failure',lyrics:timedLyrics,options:chartOptions()});
  assert.equal(result.status,'ready');
  assert.equal(result.chart.cachePersisted,false);
  assert.match(result.chart.warnings.join(' '),/本轮可用/);
  assert.ok(await f.service.fileFor(result.backing.key));
});

test('a damaged chart sidecar is replaced by a newly validated draft',async t=>{
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd}) => {
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'vocals.wav'),wave(1000,35));
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,40));
      return {code:0};
    },
    runChart:async (_program,args) => {
      await fs.writeFile(args[args.indexOf('--output')+1],ultraStar());
      return {code:0,output:JSON.stringify({warnings:[],noteCount:2,lineCount:2,bpm:120,bpmFallback:false,models:{}})};
    },
  });
  const first=await f.service.startWithChart(f.input,{requestId:'chart-sidecar-first',lyrics:timedLyrics,options:chartOptions()});
  const [sidecar]=(await fs.readdir(f.folder)).filter(name=>name.endsWith('.chart.json'));
  assert.ok(sidecar);
  await fs.writeFile(path.join(f.folder,sidecar),'{broken');
  const recovered=await f.service.startWithChart(f.input,{requestId:'chart-sidecar-second',lyrics:timedLyrics,options:chartOptions()});
  assert.equal(recovered.status,'ready');
  assert.equal(recovered.chart.cacheHit,false);
  assert.equal(recovered.chart.cachePersisted,true);
  assert.equal(recovered.chart.sha256,first.chart.sha256);
  const repaired=JSON.parse(await fs.readFile(path.join(f.folder,sidecar),'utf8'));
  assert.equal(repaired.chart.sha256,first.chart.sha256);
});

test('timed lyrics absence returns partial without invoking the chart worker',async t=>{
  let chartCalls=0;
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd}) => {
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'vocals.wav'),wave(1000,35));
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,40));
      return {code:0};
    },
    runChart:async()=>{chartCalls++;return {code:0,output:''};},
  });
  const result=await f.service.startWithChart(f.input,{requestId:'chart-no-lyrics',lyrics:[],options:chartOptions()});
  assert.equal(result.status,'partial');
  assert.match(result.chartFailure,/歌词/);
  assert.equal(chartCalls,0);
  assert.ok(await f.service.fileFor(result.backing.key));
});

test('chart cancellation removes vocals and staging after the backing was committed',async t=>{
  let entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd}) => {
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'vocals.wav'),wave(1000,35));
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,40));
      return {code:0};
    },
    runChart:async (_program,_args,{signal}) => {
      entered();
      return new Promise((_resolve,reject)=>{
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
      });
    },
  });
  const active=f.service.startWithChart(f.input,{requestId:'chart-cancel',lyrics:timedLyrics,options:chartOptions()});
  await waiting;
  assert.equal(f.service.cancel('chart-cancel'),true);
  await assert.rejects(active,{name:'AbortError'});
  assert.deepEqual((await fs.readdir(f.folder)).filter(name=>name.startsWith('.job-')),[]);
  const wavs=(await fs.readdir(f.folder)).filter(name=>name.endsWith('.wav'));
  assert.equal(wavs.length,1);
  assert.match(wavs[0],/^[a-f0-9]{64}\.wav$/);
});

test('startWithChart rejects mismatched or invalid stems before publishing anything',async t=>{
  const f=await fixture(t,{},{
    run:async (_program,_args,{cwd}) => {
      const output=path.join(cwd,'955717e8');
      await fs.mkdir(output);
      await fs.writeFile(path.join(output,'vocals.wav'),wave(500,35));
      await fs.writeFile(path.join(output,'no_vocals.wav'),wave(1000,40));
      return {code:0};
    },
  });
  await assert.rejects(
    f.service.startWithChart(f.input,{requestId:'chart-bad-stems',lyrics:timedLyrics,options:chartOptions()}),
    {code:'OUTPUT'},
  );
  assert.deepEqual((await fs.readdir(f.folder)).filter(name=>name.endsWith('.wav')),[]);
  await assert.rejects(
    f.service.startWithChart(f.input,{requestId:'chart-bad-options',lyrics:timedLyrics,options:{title:'Test Song',artist:'Test Artist',bpmMode:'fixed',fixedBpm:999}}),
    {code:'INPUT'},
  );
});

test('packaged chart worker resolves outside app.asar and remains included in the installer',async()=>{
  const root=path.resolve(__dirname,'..');
  const packed=path.join(root,'release','win-unpacked','resources','app.asar','electron','runtime','karaoke-chart-worker.py');
  const unpacked=path.join(root,'release','win-unpacked','resources','app.asar.unpacked','electron','runtime','karaoke-chart-worker.py');
  const sourceWorker=path.join(root,'electron','runtime','karaoke-chart-worker.py');
  assert.equal(resolveChartWorker(packed),unpacked);
  assert.equal(resolveChartWorker(sourceWorker),sourceWorker);

  const builder=await fs.readFile(path.join(root,'electron-builder.yml'),'utf8');
  const files=/files:\s*([\s\S]*?)\n\s*extraResources:/.exec(builder)?.[1]??'';
  const unpack=/asarUnpack:\s*([\s\S]*?)\n\s*win:/.exec(builder)?.[1]??'';
  assert.match(files,/- electron\/runtime\/karaoke-chart-worker\.py/,'worker is included in packaged files');
  assert.match(unpack,/- electron\/runtime\/karaoke-chart-worker\.py/,'worker is excluded from app.asar');
});

const mediaTools = ['ffprobe','ffmpeg'].every(bin => spawnSync(bin,['-version'],{windowsHide:true,stdio:'ignore'}).status===0);
test('installed FFmpeg accepts a local audio cache file and refuses playlist input before inference', {skip:!mediaTools},async t=>{
  const f=await fixture(t,{realMedia:true});
  assert.equal((await f.service.start(f.input)).duration,1);
  assert.equal(f.inspect.calls,1);
  await fs.writeFile(f.alias,'#EXTM3U\nhttps://example.invalid/not-music.mp3\n');
  await assert.rejects(f.service.start(f.alias),{code:'INPUT'});
  assert.equal(f.inspect.calls,1);
});
