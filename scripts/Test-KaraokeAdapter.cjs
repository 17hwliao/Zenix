const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, file) => module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText,
    file,
  );
}

const adapter = require('../src/features/karaoke/adapter.ts');
const {getFiveLineLyricWindow} = require('../src/features/karaoke/ui/model.ts');
const {scoreKaraoke} = require('../src/features/karaoke/score-engine.ts');
const {scoreSoloLine, summarizeSolo} = require('../src/features/karaoke/solo-score.ts');
const {isInstrumentalVersion} = require('../src/features/karaoke/solo-assets.ts');
const {findOpenCharts, matchesOpenChart} = require('../src/features/karaoke/open-charts.ts');

test('solo scoring uses its own sentence, separates missing capture from silence, and averages lyric lines equally', () => {
  const line = (index,startMs,endMs) => ({index,startMs,endMs,text:'句'+index,notes:[{startMs,endMs,midi:69}]});
  const first=line(0,1000,2000),second=line(1,2000,5000),third=line(2,5000,6000);
  const frames=(from,to,midi)=>Array.from({length:(to-from)/50},(_,i)=>({atMs:from+i*50,midi,confidence:midi===null?0:1,energy:midi===null?0:.2}));
  const rated=scoreSoloLine(first,frames(1000,2000,69));
  assert.ok(rated.total>=98);
  assert.equal(scoreSoloLine(second,[...frames(1900,2000,69),...frames(2000,5000,null)]).total,0,'the previous line must not score for this one');
  assert.equal(scoreSoloLine(second,[]),null,'no capture is not a silent attempt');
  const partial=summarizeSolo([first,second,third],[{...rated,total:100},{...rated,lineIndex:1,total:0}]);
  assert.equal(partial.total,50);
  assert.equal(partial.full,false);
  assert.equal(partial.totalLines,3);
  assert.deepEqual(partial.sections.map(part=>part.label),['前段','中段']);
});

test('accompaniment and curated charts never silently substitute a different song', () => {
  const original={...track(),duration:180};
  assert.ok(isInstrumentalVersion(original,{...original,id:'backing',title:'测试歌曲（纯伴奏）'}));
  assert.ok(!isInstrumentalVersion(original,{...original,id:'guide'}));
  assert.ok(!isInstrumentalVersion(original,{...original,id:'other',title:'另一首（伴奏）'}));
  assert.ok(!isInstrumentalVersion(original,{...original,id:'cut',title:'测试歌曲 Instrumental',duration:130}));
  const [chart]=findOpenCharts('Code  Monkey');
  assert.ok(matchesOpenChart(chart,'Code Monkey','JONATHAN COULTON'));
  assert.ok(!matchesOpenChart(chart,'Code Monkey','another singer'));
});

function track() {
  return Object.freeze({
    id: 'recording-1',
    title: '测试歌曲',
    artist: '测试歌手',
    duration: 36,
    source: 'local',
    path: '/music/test.flac',
    audioUrl: 'file:///music/test.flac',
  });
}

const rawLyrics = [
  '[00:00.00]第一句',
  '[00:03.00]第二句',
  '[00:06.00]第三句',
  '[00:09.00]第四句',
  '[00:12.00]第五句',
  '[00:15.00]第六句',
  '[00:18.00]第七句',
].join('\n');

test('RawLyrics resolve into an independent timeline and five-line window', async () => {
  const before = JSON.stringify(track());
  const resolved = await adapter.resolveKaraokeTrack(track(), rawLyrics);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.value.pitchTrack.lines.length, 7);
  assert.equal(resolved.value.pitchTrack.lines[3].startMs, 9000);
  assert.equal(adapter.activeKaraokeLineIndex(resolved.value.pitchTrack.lines, 10050), 3);
  const window = getFiveLineLyricWindow(resolved.value.pitchTrack.lines, 3);
  assert.deepEqual(window.map((slot) => slot.absoluteIndex), [1, 2, 3, 4, 5]);
  assert.equal(JSON.stringify(track()), before, 'resolving a session never mutates the playback track');
});

test('silence produces a no-signal PitchFrame instead of a fabricated MIDI note', () => {
  const frame = adapter.analyzePitchSamples(new Float32Array(2048), 48000, 1250);
  assert.equal(frame.atMs, 1250);
  assert.equal(frame.midi, null);
  assert.equal(frame.confidence, 0);
  assert.equal(frame.energy, 0);
});

test('analyser samples produce the detected MIDI note for a stable tone', () => {
  const samples = new Float32Array(2048);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 0.35 * Math.sin(2 * Math.PI * 440 * index / 48000);
  }
  const frame = adapter.analyzePitchSamples(samples, 48000, 1250);
  assert.equal(frame.midi, 69);
  assert.ok(frame.confidence > 0.58);
  assert.ok(frame.energy > 0.01);
});

test('empty scoring input returns a zero score with pitch honestly unevaluated', () => {
  const score = scoreKaraoke({pitchFrames: [], recognizedLyrics: []});
  assert.equal(score.total, 0);
  assert.equal(score.pitchEvaluated, false);
  assert.equal(score.lines.length, 0);
});

test('pitch import accepts enhanced LRC and rejects a source without pitch', async () => {
  const enhanced = await adapter.importKaraokePitchReference({
    name: 'pitch.lrc',
    data: '[00:01.00]<00:01.00>{60}你<00:03.00>{62}好',
  }, track());
  assert.equal(enhanced.ok, true);
  assert.deepEqual(
    enhanced.value.pitchTrack.lines[0].notes.map((note) => note.midi),
    [60, 62],
  );

  const rejected = await adapter.importKaraokePitchReference({
    name: 'plain.lrc',
    data: '[00:01.00]只有歌词\n[00:03.00]没有音高',
  }, track());
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'INVALID_PITCH');
});

test('capture release stops tracks, closes context, disconnects nodes, removes listeners and clears timer', async () => {
  let stopped = 0;
  let closed = 0;
  let disconnected = 0;
  let removed = 0;
  let paused = 0;
  let sourceCleared = 0;
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 5);
  adapter.releaseKaraokeCapture({
    timer,
    stream: {getTracks: () => [{stop: () => { stopped += 1; }}]},
    context: {close: async() => { closed += 1; }},
    nodes: [{disconnect: () => { disconnected += 1; }}],
    listeners: [() => { removed += 1; }],
    audio: {
      pause: () => { paused += 1; },
      removeAttribute: () => { sourceCleared += 1; },
      load: () => {},
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(ticks, 0);
  assert.equal(stopped, 1);
  assert.equal(closed, 1);
  assert.equal(disconnected, 1);
  assert.equal(removed, 1);
  assert.equal(paused, 1);
  assert.equal(sourceCleared, 1);
});
