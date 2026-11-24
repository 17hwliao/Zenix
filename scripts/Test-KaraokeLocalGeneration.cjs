const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module,filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,filename);

const {
  generatedBackingDigest,
  generatedBackingTrack,
  hasTimedLyrics,
  localGenerationDependencyHint,
  progressStage,
  shouldShowLocalGeneration,
  timedLyricsFromRaw,
  unavailableGenerationMessage,
} = require('../src/features/karaoke/local-generation.ts');

test('untimed plain lyrics do not become a fabricated five-second chart timeline',()=>{
  const raw={text:'第一句\n第二句\n第三句',format:'lrc',source:'sidecar'};
  assert.equal(hasTimedLyrics(raw),false);
  assert.deepEqual(timedLyricsFromRaw(raw,20),[]);
});

test('ordinary LRC keeps real starts and clips each line to the next real start and song end',()=>{
  const raw={text:'[ar:Sample]\n[00:01.00]第一句\n[00:04.50]第二句',format:'lrc',source:'sidecar'};
  assert.equal(hasTimedLyrics(raw),true);
  const lines=timedLyricsFromRaw(raw,6);
  assert.deepEqual(lines,[
    {startMs:1000,endMs:4500,text:'第一句'},
    {startMs:4500,endMs:6000,text:'第二句'},
  ]);
  assert.equal(Object.isFrozen(lines),true);
  assert.equal(Object.isFrozen(lines[0]),true);
  assert.equal(hasTimedLyrics({...raw,text:'[00:09.00]超出原曲'}),true);
  assert.deepEqual(timedLyricsFromRaw({...raw,text:'[00:09.00]超出原曲'},6),[]);
});

test('explicit cue ends are corrected against overlap, sorting and the recording boundary',()=>{
  const raw={text:'WEBVTT\n\n00:00:05.000 --> 00:00:08.000\n第二句\n\n00:00:01.000 --> 00:00:06.500\n第一句',format:'vtt',source:'sidecar'};
  assert.deepEqual(timedLyricsFromRaw(raw,6),[
    {startMs:1000,endMs:5000,text:'第一句'},
    {startMs:5000,endMs:6000,text:'第二句'},
  ]);
});

test('generated backing stays opaque and rejects a mismatched recording duration',()=>{
  const source={id:'source',path:'C:/music/song.flac',title:'Song',artist:'Artist',duration:180,audioUrl:'',source:'local'};
  const backing={key:'a'.repeat(64),duration:180.2,model:'htdemucs'};
  const track=generatedBackingTrack(source,backing);
  assert.equal(track.id,'karaoke-separated:'+'a'.repeat(64));
  assert.equal(track.audioUrl,'yzqxy://karaoke-backing/'+'a'.repeat(64));
  assert.equal(track.duration,180.2);
  assert.equal(generatedBackingDigest(track),'a'.repeat(64));
  assert.equal(generatedBackingDigest({...track,id:'karaoke-separated:unsafe'}),'');
  assert.equal(generatedBackingTrack(source,{...backing,duration:210}),undefined);
  assert.equal(generatedBackingTrack(source,{...backing,key:'unsafe'}),undefined);
});

test('progress, unavailable reasons and user-facing messages preserve the stage contract',()=>{
  assert.equal(progressStage('preparing'),'preparing');
  assert.equal(progressStage('publishing'),'publishing');
  assert.equal(progressStage('arbitrary'),undefined);
  assert.equal(unavailableGenerationMessage('dependency','缺少 torch'),'本机生成依赖不可用：缺少 torch');
  assert.equal(unavailableGenerationMessage('busy','已有任务'),'另一个本地任务正在进行：已有任务');
});

test('dependency hints distinguish backing-only generation from a blocked engine',()=>{
  assert.equal(localGenerationDependencyHint({status:'available',chartAvailable:true}),undefined);
  assert.match(localGenerationDependencyHint({
    status:'available',
    chartAvailable:false,
    message:'需要 torchcrepe',
  }),/torchcrepe/);
  assert.match(localGenerationDependencyHint({
    status:'unavailable',
    message:'缺少 Demucs',
  }),/本机伴奏引擎暂不可用.*Demucs/);
});

test('the generator entry remains available beside external review candidates and stays hidden on Android',()=>{
  assert.equal(shouldShowLocalGeneration(false,true,false,{status:'idle'},false),true);
  assert.equal(shouldShowLocalGeneration(false,true,true,{status:'idle'},true),false);
  assert.equal(shouldShowLocalGeneration(false,true,true,{status:'idle'},false),true);
  assert.equal(shouldShowLocalGeneration(false,true,true,{status:'partial',backing:{},chartFailure:'无歌词'},true),true);
  assert.equal(shouldShowLocalGeneration(true,false,false,{status:'idle'},false),false);
});
