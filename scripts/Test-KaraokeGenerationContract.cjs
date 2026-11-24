'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_LYRIC_LINES,
  normalizeGenerationRequest,
  normalizeLyrics,
  normalizeOptions,
} = require('../electron/runtime/karaoke-generation-request.cjs');

const id = '6f6f2c01-809a-4bd5-b873-62c3d98d684f';
const track = {id:'local-key',title:'  夜色\n练唱  ',artist:' 歌手 ',source:'local',path:'C:\\not-used.wav'};

test('normalizes a timed lyric snapshot without carrying renderer paths or commands', () => {
  const request = normalizeGenerationRequest(track,id,[
    {startMs:2500,endMs:4000,text:' 第二句 ',path:'C:\\secret.wav'},
    {startMs:500,endMs:2200,text:' 第一句\n'},
  ],{schemaVersion:1,command:'calc.exe',modelPath:'C:\\model'},5000);
  assert.equal(request.requestId,id);
  assert.deepEqual(request.metadata,{title:'夜色 练唱',artist:'歌手',durationMs:5000});
  assert.deepEqual(request.lyrics.map(line => [line.startMs,line.endMs,line.text]),[
    [500,2200,'第一句'],[2500,4000,'第二句'],
  ]);
  assert.deepEqual(request.options,{schemaVersion:1});
  assert.equal(Object.isFrozen(request),true);
});

test('allows no lyrics for backing-only generation but rejects unsafe boundaries', () => {
  assert.deepEqual(normalizeLyrics([],5000),[]);
  assert.throws(() => normalizeLyrics([{startMs:0,endMs:0,text:'零长度'}],5000),{code:'INPUT'});
  assert.throws(() => normalizeLyrics([{startMs:5000,endMs:6000,text:'越界'}],5000),{code:'INPUT'});
  assert.throws(() => normalizeLyrics([{startMs:0,endMs:100,text:'\n'}],5000),{code:'INPUT'});
});

test('rejects malformed request identity, options and oversized lyrics', () => {
  assert.throws(() => normalizeGenerationRequest(track,'../../command',[],{schemaVersion:1},5000),{code:'INPUT'});
  assert.throws(() => normalizeOptions({schemaVersion:2}),{code:'INPUT'});
  assert.throws(() => normalizeOptions([]),{code:'INPUT'});
  assert.throws(() => normalizeLyrics(Array.from({length:MAX_LYRIC_LINES + 1},(_,index) => ({
    startMs:index,endMs:index + 1,text:'x',
  })),10000),{code:'INPUT'});
});
