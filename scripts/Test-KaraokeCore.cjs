const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, file) => module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  );
}

const karaoke = require('../src/features/karaoke/index.ts');

function frozen(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

function descriptorInput(pitchSource) {
  return frozen({
    track: {
      id: 'track-recording',
      title: '测试歌曲',
      artist: '测试歌手',
      duration: 6,
      source: 'local',
      path: '/music/test.flac',
      audioUrl: 'file:///music/test.flac',
      providerId: 'library',
      remoteId: 'content-hash',
    },
    accompaniment: {
      kind: 'local-file',
      label: '本地伴奏',
      uri: 'file:///music/test-instrumental.flac',
      rehearsalOnly: false,
    },
    ...(pitchSource ? { pitchSource } : {}),
  });
}

function framesForLine(notes, options = {}) {
  const shiftMs = options.shiftMs || 0;
  const midiOffset = options.midiOffset || 0;
  const confidence = options.confidence ?? 0.94;
  const energy = options.energy ?? 0.12;
  const frames = [];
  for (const note of notes) {
    for (let atMs = note.startMs; atMs < note.endMs; atMs += 100) {
      frames.push({ atMs: atMs + shiftMs, midi: note.midi + midiOffset, confidence, energy });
    }
  }
  return frames;
}

function scoreTrack() {
  return frozen({
    schema: 1,
    source: 'enhanced-lrc',
    lines: [{
      index: 0,
      startMs: 1000,
      endMs: 3000,
      text: '你好世界',
      notes: [
        { startMs: 1000, endMs: 2000, midi: 60 },
        { startMs: 2000, endMs: 3000, midi: 62 },
      ],
    }],
  });
}

function scoreWith(frames, extra = {}) {
  return karaoke.scoreKaraoke({
    pitchFrames: frames,
    pitchTrack: scoreTrack(),
    recognizedLyrics: [{ lineIndex: 0, text: '你好世界' }],
    ...extra,
  });
}

function midiVariable(value) {
  let remaining = value;
  const bytes = [remaining & 0x7f];
  remaining >>= 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>= 7;
  }
  return bytes;
}

function simpleMidi() {
  const track = [
    ...midiVariable(0), 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    ...midiVariable(0), 0x90, 60, 96,
    ...midiVariable(480), 0x80, 60, 0,
    ...midiVariable(0), 0x90, 62, 96,
    ...midiVariable(480), 0x80, 62, 0,
    ...midiVariable(0), 0xff, 0x2f, 0x00,
  ];
  const length = track.length;
  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b,
    (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff,
    ...track,
  ]);
}

test('resolver parses LRC, enhanced LRC, UltraStar and dependency-free MIDI into immutable descriptors', async () => {
  const resolver = karaoke.createKaraokeSongResolver();

  const plain = await resolver.resolve(descriptorInput({ format: 'lrc', text: '[00:01.00]第一句\n[00:03.00]第二句' }));
  assert.equal(plain.ok, true);
  assert.equal(plain.value.pitchTrack.lines.length, 2);
  assert.equal(plain.value.pitchTrack.lines[0].notes.length, 0);
  assert.ok(Object.isFrozen(plain.value));
  assert.ok(Object.isFrozen(plain.value.pitchTrack.lines));
  assert.ok(Object.isFrozen(plain.value.pitchTrack.lines[0].notes));

  const enhanced = await resolver.resolve(descriptorInput({
    format: 'enhanced-lrc',
    text: '[00:01.00]<00:01.00>{60}你<00:02.00>{62}好',
  }));
  assert.equal(enhanced.ok, true);
  assert.deepEqual(enhanced.value.pitchTrack.lines[0].notes.map((note) => [note.startMs, note.endMs, note.midi]), [
    [1000, 2000, 60],
    [2000, 6000, 62],
  ]);

  const ultra = await resolver.resolve(descriptorInput({
    format: 'ultrastar',
    text: '#TITLE:Ultra 测试\n#ARTIST:歌手\n#BPM:120\n#GAP:1000\n: 0 1 60 你\n: 1 1 62 好\n-',
  }));
  assert.equal(ultra.ok, true);
  assert.equal(ultra.value.title, 'Ultra 测试');
  assert.deepEqual(ultra.value.pitchTrack.lines[0].notes.map((note) => note.midi), [60, 62]);

  const midi = await resolver.resolve(descriptorInput({ format: 'midi', data: Array.from(simpleMidi()) }));
  assert.equal(midi.ok, true);
  assert.equal(midi.value.pitchTrack.source, 'midi');
  assert.deepEqual(midi.value.pitchTrack.lines[0].notes.map((note) => note.midi), [60, 62]);

  const invalid = await resolver.resolve(descriptorInput({
    format: 'enhanced-lrc',
    text: '[00:01.00]<00:01.00>{999}坏音高',
  }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_PITCH');
});

test('accompaniment policy uses strict priority, cache identity and rehearsal-only channel cancellation', () => {
  const request = frozen({
    recordingId: 'recording-42',
    audioContentFingerprint: 'sha256:aabb',
    candidates: [
      { kind: 'channel-cancel', uri: 'stereo://cancel', rehearsalOnly: true, modelVersion: 'center-v1', outputFormat: 'pcm-f32' },
      { kind: 'separated', uri: 'file:///cache/vocals-removed.wav', fingerprint: 'sha256:aabb', modelVersion: 'uvr-v5', outputFormat: 'wav' },
      { kind: 'source-official', uri: 'https://source.example/official.accompaniment' },
      { kind: 'local-file', uri: 'file:///music/instrumental.flac' },
    ],
  });
  const selected = karaoke.resolveAccompaniment(request);
  assert.equal(selected.ok, true);
  assert.equal(selected.value.kind, 'local-file');

  const separated = karaoke.resolveAccompaniment({ ...request, candidates: request.candidates.slice(1, 2) });
  assert.equal(separated.ok, true);
  assert.match(separated.value.cacheKey, /recording=recording-42/);
  assert.match(separated.value.cacheKey, /audio=sha256%3Aaabb/);
  assert.match(separated.value.cacheKey, /model=uvr-v5/);
  assert.match(separated.value.cacheKey, /format=wav/);

  const mismatched = karaoke.resolveAccompaniment({
    recordingId: 'recording-42',
    audioContentFingerprint: 'sha256:aabb',
    candidates: [
      { kind: 'separated', uri: 'file:///cache/wrong.wav', fingerprint: 'sha256:other', modelVersion: 'uvr-v5', outputFormat: 'wav' },
      { kind: 'source-official', uri: 'https://source.example/fallback.accompaniment' },
    ],
  });
  assert.equal(mismatched.ok, true);
  assert.equal(mismatched.value.kind, 'source-official');
  assert.equal(mismatched.value.fingerprint, undefined);
  assert.equal(mismatched.value.cacheKey, undefined);

  const unsafeCancel = karaoke.resolveAccompaniment({
    recordingId: 'recording-42',
    audioContentFingerprint: 'sha256:aabb',
    candidates: [{ kind: 'channel-cancel', uri: 'stereo://cancel', rehearsalOnly: false, modelVersion: 'v1', outputFormat: 'pcm' }],
  });
  assert.equal(unsafeCancel.ok, false);
  assert.equal(unsafeCancel.error.code, 'INVALID_INPUT');

  const missing = karaoke.resolveAccompaniment({
    recordingId: 'recording-42',
    audioContentFingerprint: 'sha256:aabb',
    candidates: [],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'ACCOMPANIMENT_NOT_FOUND');
});

test('score engine rejects pitch, octave, high, low and timing errors while ignoring silence/noise', () => {
  const notes = scoreTrack().lines[0].notes;
  const correct = scoreWith(framesForLine(notes));
  const low = scoreWith(framesForLine(notes, { midiOffset: -2 }));
  const high = scoreWith(framesForLine(notes, { midiOffset: 2 }));
  const octave = scoreWith(framesForLine(notes, { midiOffset: 12 }));
  const twoOctaves = scoreWith(framesForLine(notes, { midiOffset: 24 }));
  const threeOctaves = scoreWith(framesForLine(notes, { midiOffset: 36 }));
  const early = scoreWith(framesForLine(notes, { shiftMs: -160 }));
  const late = scoreWith(framesForLine(notes, { shiftMs: 160 }));
  const noise = scoreWith(framesForLine(notes, { energy: 0.005 }));

  assert.ok(correct.lines[0].pitch > low.lines[0].pitch);
  assert.ok(correct.lines[0].pitch > high.lines[0].pitch);
  assert.ok(correct.lines[0].pitch > octave.lines[0].pitch);
  assert.ok(correct.lines[0].pitch > twoOctaves.lines[0].pitch);
  assert.ok(correct.lines[0].pitch > threeOctaves.lines[0].pitch);
  assert.ok(low.lines[0].feedback.some((line) => line.includes('偏低')));
  assert.ok(high.lines[0].feedback.some((line) => line.includes('偏高')));
  assert.ok(octave.lines[0].feedback.some((line) => line.includes('八度')));
  assert.ok(twoOctaves.lines[0].feedback.some((line) => line.includes('八度')));
  assert.ok(threeOctaves.lines[0].feedback.some((line) => line.includes('八度')));
  assert.ok(early.lines[0].feedback.some((line) => line.includes('提前约0.16秒')));
  assert.ok(late.lines[0].feedback.some((line) => line.includes('延后约0.16秒')));
  assert.equal(noise.lines[0].completeness, 0);
  assert.equal(noise.lines[0].breath, 0);
  assert.ok(noise.lines[0].feedback.some((line) => line.includes('环境声')));
});

test('latency compensation, no-pitch fallback and malformed input remain deterministic', () => {
  const notes = scoreTrack().lines[0].notes;
  const delayedFrames = framesForLine(notes, { shiftMs: 160 });
  const compensated = scoreWith(delayedFrames, { options: { latencyCompensationMs: 160 } });
  assert.ok(compensated.lines[0].rhythm > 99);
  assert.ok(!compensated.lines[0].feedback.some((line) => line.includes('进入延后')));

  const withoutPitch = karaoke.scoreKaraoke({
    pitchFrames: framesForLine(notes),
    pitchTrack: {
      schema: 1,
      source: 'enhanced-lrc',
      lines: [{ index: 0, startMs: 1000, endMs: 3000, text: '你好世界', notes: [] }],
    },
    recognizedLyrics: [{ lineIndex: 0, text: '你好世界' }],
  });
  assert.equal(withoutPitch.pitchEvaluated, false);
  assert.equal(withoutPitch.lines[0].pitch, null);
  const untrusted = scoreWith(framesForLine(notes), { options: { trustPitchTrack: false } });
  assert.equal(untrusted.pitchEvaluated, false);
  assert.equal(untrusted.lines[0].pitch, null);

  const malformed = frozen({
    pitchFrames: [
      { atMs: Number.NaN, midi: 60, confidence: 0.9, energy: 0.2 },
      { atMs: 1200, midi: Number.POSITIVE_INFINITY, confidence: Number.NaN, energy: -1 },
    ],
    pitchTrack: scoreTrack(),
  });
  assert.doesNotThrow(() => karaoke.scoreKaraoke(malformed));
  assert.equal(karaoke.safeScoreKaraoke(malformed).ok, true);

  const hugeWeights = scoreWith(framesForLine(notes), {
    options: {
      weights: {
        pitch: Number.MAX_VALUE,
        rhythm: Number.MAX_VALUE,
        lyrics: Number.MAX_VALUE,
        completeness: Number.MAX_VALUE,
        breath: Number.MAX_VALUE,
      },
    },
  });
  assert.ok(Number.isFinite(hugeWeights.total));
  assert.ok(hugeWeights.lines.every((line) => Number.isFinite(line.total)));

  const first = scoreWith(framesForLine(notes, { midiOffset: -2 })).lines[0].feedback;
  const second = scoreWith(framesForLine(notes, { midiOffset: -2 })).lines[0].feedback;
  assert.deepEqual(first, second);
});

test('session enforces ready/countdown/singing/results, supports all queue modes and survives reconnect', () => {
  const created = karaoke.createKaraokeSession({
    roomId: 'room-1',
    roomCode: '123456',
    hostId: 'host',
    hostDisplayName: '主持人',
    nowMs: 1000,
  });
  assert.equal(created.ok, true);
  let session = created.session;

  let result = session.joinMember('singer', '演唱者', 1100);
  assert.equal(result.ok, true);
  session = result.session;
  result = session.setReady('singer', 'singer', true, 1200);
  assert.equal(result.ok, true);
  session = result.session;

  for (const [recordingId, mode] of [['solo-song', 'solo'], ['relay-song', 'relay'], ['chorus-song', 'chorus']]) {
    result = session.addQueueItem('singer', { recordingId, mode }, 1300);
    assert.equal(result.ok, true);
    session = result.session;
  }
  assert.deepEqual(session.state.queue.map((item) => item.mode), ['solo', 'relay', 'chorus']);

  result = session.startCountdown('host', 1400, 1000);
  assert.equal(result.ok, true);
  session = result.session;
  assert.equal(session.state.status, 'countdown');
  result = session.beginSinging('host', 2400);
  assert.equal(result.ok, true);
  session = result.session;
  const singingQueue = JSON.stringify(session.state.queue);

  result = session.disconnect('singer', 2500);
  assert.equal(result.ok, true);
  session = result.session;
  assert.equal(session.state.status, 'singing');
  result = session.reconnect('singer', 2600);
  assert.equal(result.ok, true);
  session = result.session;
  assert.equal(JSON.stringify(session.state.queue), singingQueue);
  assert.equal(session.state.queue.length, 3);

  result = session.finishCurrent('host', 3000, scoreWith(framesForLine(scoreTrack().lines[0].notes)));
  assert.equal(result.ok, true);
  session = result.session;
  assert.equal(session.state.status, 'lobby');
  assert.equal(session.state.queue[0].state, 'scored');
  assert.ok(session.state.queue[0].score);
  const completedRecordingId = session.state.queue[0].recordingId;
  result = session.addQueueItem('host', { recordingId: completedRecordingId, mode: 'solo' }, 3100);
  assert.equal(result.ok, true);
  assert.equal(result.state.queue.at(-1).recordingId, completedRecordingId);
});

test('session errors are structured, input snapshots stay frozen and host stop closes independently', () => {
  const created = karaoke.createKaraokeSession({
    roomId: 'room-2',
    roomCode: '654321',
    hostId: 'host',
    hostDisplayName: '主持人',
    nowMs: 1,
  });
  assert.equal(created.ok, true);
  let session = created.session;
  session = session.joinMember('a', 'A', 2).session;
  session = session.joinMember('b', 'B', 3).session;
  session = session.joinMember('listener', '听众', 3, 'listener').session;
  const listenerReady = session.setReady('listener', 'listener', true, 3);
  assert.equal(listenerReady.ok, false);
  assert.equal(listenerReady.error.code, 'INVALID_INPUT');
  const listenerQueue = session.addQueueItem('host', {
    recordingId: 'listener-song',
    mode: 'solo',
    singerIds: ['listener'],
  }, 3);
  assert.equal(listenerQueue.ok, false);
  assert.equal(listenerQueue.error.code, 'INVALID_INPUT');
  session = session.setReady('a', 'a', true, 3).session;
  const duplicateSource = session.addQueueItem('a', { recordingId: 'same-song', mode: 'solo' }, 4);
  assert.equal(duplicateSource.ok, true);
  session = duplicateSource.session;
  const duplicate = session.addQueueItem('a', { recordingId: 'same-song', mode: 'solo' }, 5);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'INVALID_INPUT');
  const missingItem = session.removeQueueItem('a', 'missing-item', 5);
  assert.equal(missingItem.ok, false);
  assert.equal(missingItem.error.code, 'ITEM_NOT_FOUND');

  const before = frozen(structuredClone(session.state));
  const failed = session.addQueueItem('a', { recordingId: 'bad', mode: 'solo', singerIds: ['a', 'b'] }, 6);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'INVALID_INPUT');
  assert.deepEqual(session.state, before);
  assert.ok(Object.isFrozen(session.state));

  const stopped = session.stop('host', 5);
  assert.equal(stopped.ok, true);
  assert.equal(stopped.state.status, 'closed');
  assert.equal(session.state.status, 'lobby');

  let countdown = session.setReady('a', 'a', true, 6).session;
  countdown = countdown.addQueueItem('a', { recordingId: 'countdown-song', mode: 'solo' }, 7).session;
  countdown = countdown.startCountdown('host', 8, 1000).session;
  const interrupted = countdown.disconnect('a', 500);
  assert.equal(interrupted.ok, true);
  assert.equal(interrupted.state.status, 'lobby');
  assert.equal(interrupted.state.queue[0].state, 'queued');
  assert.equal(interrupted.state.currentItemId, undefined);

  const restored = karaoke.KaraokeSession.restore(frozen({
    ...stopped.state,
    status: 'lobby',
    queue: [{
      id: 'restored',
      recordingId: 'saved-song',
      mode: 'solo',
      singerIds: ['a'],
      state: 'singing',
    }],
    currentItemId: undefined,
    countdownEndsAtMs: undefined,
  }));
  assert.equal(restored.ok, true);
  assert.equal(restored.state.queue[0].recordingId, 'saved-song');
  assert.equal(restored.state.queue[0].state, 'queued');

  const corruptScore = karaoke.KaraokeSession.restore(frozen({
    ...restored.state,
    queue: [{...restored.state.queue[0], state: 'scored', score: 'not-a-score'}],
  }));
  assert.equal(corruptScore.ok, false);
  assert.equal(corruptScore.error.code, 'INVALID_INPUT');
});
