const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const ts = require('typescript');

require.extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,file);

const root=path.resolve(__dirname,'..');
const worker=path.join(root,'electron','runtime','karaoke-chart-worker.py');
const python=process.platform==='win32'?['py','-3','-B']:['python3','-B'];

function runPython(source,input='') {
  const result=spawnSync(python[0],[...python.slice(1),'-I','-c',source],{
    input,cwd:root,encoding:'utf8',windowsHide:true,timeout:20_000,
  });
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stderr||result.stdout);
  return result.stdout.trim();
}

const loadWorker=`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('zenix_karaoke_worker', ${JSON.stringify(worker)})
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)
`;

function config(overrides={}) {
  return {
    schema:1,
    title:'测试歌曲',
    artist:'测试歌手',
    durationMs:3000,
    lyrics:[
      {startMs:0,endMs:900,text:'第一句'},
      {startMs:850,endMs:1700,text:'第二句'},
      {startMs:1650,endMs:3000,text:'第三句'},
    ],
    generatorVersion:'zenix-karaoke-chart-v1',
    pitchModel:'torchcrepe-0.0.23-full-v1',
    alignerModel:'timed-lyrics-v1',
    bpmMode:'fixed',
    fixedBpm:120,
    minConfidence:.5,
    minEnergy:.006,
    minNoteMs:60,
    ...overrides,
  };
}

test('normalizes overlapping timed lyrics and rejects unsupported versions',()=>{
  const raw=JSON.stringify(config());
  const output=runPython(`${loadWorker}
cfg = worker.parse_config(sys.stdin.buffer.read().decode('utf-8'))
sys.stdout.buffer.write((json.dumps([[row.start_ms, row.end_ms, row.text] for row in cfg.lyrics], ensure_ascii=False)+'\\n').encode('utf-8'))
`,raw);
  assert.deepEqual(JSON.parse(output),[
    [0,900,'第一句'],
    [900,1700,'第二句'],
    [1700,3000,'第三句'],
  ]);
  const invalid=spawnSync(python[0],[
    ...python.slice(1),'-I',worker,'--input',path.join(root,'missing.wav'),'--output',path.join(root,'chart.txt'),
    '--config-json',JSON.stringify(config({generatorVersion:'unknown'})),
  ],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(invalid.status,2);
  assert.equal(invalid.stdout,'');
  assert.match(JSON.parse(invalid.stderr).message,/generatorVersion/);
});

test('accepts the auto-BPM null fallback sent by the desktop request',()=>{
  const output=runPython(`${loadWorker}
cfg = worker.parse_config(sys.stdin.buffer.read().decode('utf-8'))
sys.stdout.buffer.write((json.dumps({'bpmMode':cfg.bpm_mode,'fixedBpm':cfg.fixed_bpm})+'\\n').encode('utf-8'))
`,JSON.stringify(config({bpmMode:'auto',fixedBpm:null})));
  assert.deepEqual(JSON.parse(output),{bpmMode:'auto',fixedBpm:120});
});

test('filters unstable pitch and emits a parseable Chinese UltraStar draft',()=>{
  const output=runPython(`${loadWorker}
cfg = worker.parse_config(sys.stdin.buffer.read().decode('utf-8'))
rows = [worker.PitchFrame(at, 60 + (0.1 if at % 20 else 0), .95, .08) for at in range(0, 700, 10)]
rows += [worker.PitchFrame(300, 72.0, .99, .08)]
rows += [worker.PitchFrame(at, 62 + (0.1 if at % 20 else 0), .93, .08) for at in range(700, 1200, 10)]
rows += [worker.PitchFrame(1770, 67.0, .10, .08), worker.PitchFrame(1780, 67.0, .95, .001)]
segments = worker.pitch_notes_to_segments(worker.frames_to_notes(rows, cfg.min_confidence, cfg.min_energy, cfg.min_note_ms))
mapped = worker.notes_from_segments(cfg.lyrics, segments, cfg.duration_ms, cfg.min_note_ms)
draft = worker.build_ultrastar(cfg, cfg.lyrics, mapped, cfg.fixed_bpm, False)
sys.stdout.buffer.write((json.dumps({'chart':draft.text,'warnings':draft.warnings,'noteCount':draft.note_count,'lineCount':draft.line_count}, ensure_ascii=False)+'\\n').encode('utf-8'))
`,JSON.stringify(config()));
  const result=JSON.parse(output);
  assert.equal(result.noteCount,3);
  assert.equal(result.lineCount,2);
  assert.match(result.chart,/#TITLE:测试歌曲/);
  assert.match(result.chart,/#ZENIX-PITCH-MODEL:torchcrepe-0.0.23-full-v1/);
  assert.match(result.chart,/#ZENIX-LYRICS-SHA256:[a-f0-9]{64}/);
  assert.match(result.chart,/\nE\n$/);

  const {parseUltraStarPitchTrack}=require('../src/features/karaoke/song-resolver.ts');
  const parsed=parseUltraStarPitchTrack(result.chart,3000);
  assert.equal(parsed.title,'测试歌曲');
  assert.equal(parsed.artist,'测试歌手');
  assert.equal(parsed.track.lines.length,2);
  assert.equal(parsed.track.lines[0].text,'第一句');
  assert.deepEqual(parsed.track.lines.map(line=>line.notes.map(note=>note.midi)),[[60,62],[62]]);
});

test('rejects empty pitch output and invalid generation limits',()=>{
  const raw=JSON.stringify(config());
  const empty=runPython(`${loadWorker}
cfg = worker.parse_config(sys.stdin.buffer.read().decode('utf-8'))
try:
  worker.build_ultrastar(cfg, cfg.lyrics, [], cfg.fixed_bpm, False)
except worker.WorkerError as error:
  print(error.code)
`,raw);
  assert.equal(empty,'PITCH');

  const oversized=runPython(`${loadWorker}
cfg = worker.parse_config(sys.stdin.buffer.read().decode('utf-8'))
note = worker.DraftNote(0, 500, 60, .9, 0, 'x')
worker.MAX_OUTPUT_BYTES = 10
try:
  worker.build_ultrastar(cfg, cfg.lyrics, [note], cfg.fixed_bpm, False)
except worker.WorkerError as error:
  print(error.code)
`,raw);
  assert.equal(oversized,'OUTPUT');

  const invalid=spawnSync(python[0],[
    ...python.slice(1),'-I',worker,'--input',path.join(root,'missing.wav'),'--output',path.join(root,'chart.txt'),
    '--config-json',JSON.stringify(config({minNoteMs:1})),
  ],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(invalid.status,2);
  assert.equal(invalid.stdout,'');
  assert.equal(JSON.parse(invalid.stderr).code,'CONFIG');
});

test('worker CLI keeps failures on stderr and requires the agreed fields',()=>{
  const invalid=spawnSync(python[0],[
    ...python.slice(1),'-I',worker,'--input',path.join(root,'missing.wav'),'--output',path.join(root,'chart.txt'),
    '--config-json',JSON.stringify({schema:1,title:'x'}),
  ],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(invalid.status,2);
  assert.equal(invalid.stdout,'');
  const error=JSON.parse(invalid.stderr);
  assert.equal(error.status,'error');
  assert.equal(error.code,'CONFIG');
});

test('successful main path writes the chart and emits one result document',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zenix-chart-worker-'));
  const input=path.join(directory,'vocals.wav');
  const output=path.join(directory,'draft.txt');
  const configFile=path.join(directory,'config.json');
  try {
    fs.writeFileSync(input,Buffer.alloc(44));
    fs.writeFileSync(configFile,JSON.stringify(config()),'utf8');
    const result=JSON.parse(runPython(`${loadWorker}
import types
raw = sys.stdin.buffer.read().decode('utf-8')
cfg = worker.parse_config(raw)
frames = [worker.PitchFrame(at, 60, .9, .08) for at in range(0, 700, 10)]
worker.analyze_pitch = lambda source, parsed: (types.SimpleNamespace(size=132300), 44100, frames)
worker.estimate_bpm = lambda audio, sample_rate, parsed: (parsed.fixed_bpm, False)
code = worker.main([
  '--input', ${JSON.stringify(input)},
  '--output', ${JSON.stringify(output)},
  '--config-file', ${JSON.stringify(configFile)},
])
raise SystemExit(code)
`,JSON.stringify(config())));
    assert.equal(result.status,'ready');
    assert.equal(result.noteCount,1);
    assert.equal(result.lineCount,1);
    assert.equal(result.bpm,120);
    assert.equal(result.bpmFallback,false);
    assert.deepEqual(result.models,{pitch:'torchcrepe-0.0.23-full-v1',aligner:'timed-lyrics-v1',generator:'zenix-karaoke-chart-v1'});
    const chart=fs.readFileSync(output,'utf8');
    assert.match(chart,/#TITLE:测试歌曲/);
    assert.match(chart,/\nE\n$/);
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('pitch analysis reports the chart alignment stage before the final result',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zenix-chart-progress-'));
  const input=path.join(directory,'vocals.wav');
  const output=path.join(directory,'draft.txt');
  const configFile=path.join(directory,'config.json');
  try {
    fs.writeFileSync(input,Buffer.alloc(44));
    fs.writeFileSync(configFile,JSON.stringify(config()),'utf8');
    const result=spawnSync(python[0],[
      ...python.slice(1),'-I','-c',`${loadWorker}
import types
cfg = worker.parse_config(${JSON.stringify(JSON.stringify(config()))})
frames = [worker.PitchFrame(at, 60, .9, .08) for at in range(0, 700, 10)]
worker.analyze_pitch = lambda source, parsed: (types.SimpleNamespace(size=132300), 44100, frames)
worker.estimate_bpm = lambda audio, sample_rate, parsed: (parsed.fixed_bpm, False)
raise SystemExit(worker.main([
  '--input', ${JSON.stringify(input)},
  '--output', ${JSON.stringify(output)},
  '--config-file', ${JSON.stringify(configFile)},
]))
`],{cwd:root,encoding:'utf8',windowsHide:true,timeout:20_000});
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.deepEqual(JSON.parse(result.stderr.trim()),{status:'progress',stage:'aligning'});
    assert.equal(JSON.parse(result.stdout).status,'ready');
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
