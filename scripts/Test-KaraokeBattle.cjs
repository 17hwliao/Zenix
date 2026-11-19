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

const lan = require('../src/features/karaoke/lan.ts');

function startHost(options = {}) {
  const created = lan.createKaraokeLanHost({
    hostId: 'host-1',
    hostDisplayName: '主持人',
    roomId: 'room-battle',
    roomCode: '666666',
    nowMs: 1_000,
    ...options,
  });
  assert.equal(created.ok, true, created.error?.message);
  const started = created.value.start(1_000);
  assert.equal(started.ok, true, started.error?.message);
  return {host: created.value, auth: started.value.authorization};
}

function joinMember(host, hostAuth, nonce, name, nowMs) {
  const pending = host.requestJoin({
    roomCode: host.code,
    displayName: name,
    clientNonce: nonce,
  }, nowMs);
  assert.equal(pending.ok, true, pending.error?.message);
  const approved = host.approveJoin(hostAuth, pending.value.pendingId, nowMs + 1, 'singer');
  assert.equal(approved.ok, true, approved.error?.message);
  return approved.value;
}

function lineScorePayload(total, overrides = {}) {
  return {
    lineIndex: 0,
    startMs: 0,
    endMs: 2_000,
    pitch: 90,
    rhythm: 88,
    lyrics: 92,
    completeness: 95,
    breath: 80,
    total,
    feedback: [],
    ...overrides,
  };
}

function scoreLineEvent(host, memberId, sequence, itemId, revision, lineIndex, total, overrides = {}) {
  const created = lan.createKaraokeLanEnvelope({
    type: 'score.line',
    source: 'client',
    roomId: host.id,
    senderId: memberId,
    recipientId: 'host-1',
    sequence,
    sentAtMs: 3_000 + sequence,
    payload: {
      itemId,
      lineIndex,
      revision,
      lineScore: lineScorePayload(total, {lineIndex}),
      clientSentAtMs: 2_900 + sequence,
      ...overrides,
    },
  });
  assert.equal(created.ok, true, created.error?.message);
  return created.value;
}

test('member sides default to blue for singers, none for listeners and host can reassign', () => {
  const {host, auth} = startHost();
  const blue = joinMember(host, auth, 'battle-client-a', '蓝方', 1_100);
  const listenerPending = host.requestJoin({
    roomCode: host.code,
    displayName: '听众',
    clientNonce: 'battle-client-l',
  }, 1_150);
  assert.equal(listenerPending.ok, true);
  const listener = host.approveJoin(auth, listenerPending.value.pendingId, 1_160, 'listener');
  assert.equal(listener.ok, true);
  assert.equal(host.state.members.find((m) => m.id === blue.memberId).side, 'blue');
  assert.equal(host.state.members.find((m) => m.id === listener.value.memberId).side, 'none');

  const reassigned = host.assignSide(auth, blue.memberId, 'red', 1_200);
  assert.equal(reassigned.ok, true, reassigned.error?.message);
  assert.equal(host.state.members.find((m) => m.id === blue.memberId).side, 'red');
  assert.equal(host.assignSide(blue.authorization, blue.memberId, 'blue', 1_210).error.code, 'PERMISSION_DENIED');
  assert.equal(host.assignSide(auth, 'missing-member', 'blue', 1_215).error.code, 'MEMBER_NOT_FOUND');
});

test('score.line aggregates battle totals per side, rejects stale items and dedupes lines', () => {
  const {host, auth} = startHost();
  const blue = joinMember(host, auth, 'battle-client-a', '蓝方', 1_100);
  const redPending = host.requestJoin({
    roomCode: host.code,
    displayName: '红方',
    clientNonce: 'battle-client-b',
  }, 1_150);
  const red = host.approveJoin(auth, redPending.value.pendingId, 1_160, 'singer');
  assert.equal(red.ok, true);
  host.assignSide(auth, red.value.memberId, 'red', 1_180);
  assert.equal(host.state.members.find((m) => m.id === blue.memberId).side, 'blue');
  assert.equal(host.state.members.find((m) => m.id === red.value.memberId).side, 'red');

  assert.equal(host.handleClientEvent(
    blue.authorization,
    {type: 'member.ready', ready: true},
    1_200,
  ).value.status, 'applied');
  assert.equal(host.handleClientEvent(
    red.value.authorization,
    {type: 'member.ready', ready: true},
    1_210,
  ).value.status, 'applied');
  assert.equal(host.handleClientEvent(
    blue.authorization,
    {type: 'queue.add', recordingId: 'battle-song', mode: 'chorus'},
    1_300,
  ).value.status, 'applied');
  const itemId = host.state.queue[0].id;
  const started = host.startQueueItem(auth, itemId, 1_400);
  assert.equal(started.ok, true, started.error?.message);
  const revision = host.state.battle.revision;

  const first = host.handleRaw(
    blue.authorization,
    scoreLineEvent(host, blue.memberId, 3, itemId, revision, 0, 88),
    3_001,
  );
  assert.equal(first.ok, true, first.error?.message);
  assert.equal(first.value.status, 'applied');
  assert.equal(host.state.battle.blueScore, 88);
  assert.equal(host.state.battle.redScore, 0);
  assert.equal(host.state.battle.leadingSide, 'blue');

  const redFirst = host.handleRaw(
    red.value.authorization,
    scoreLineEvent(host, red.value.memberId, 2, itemId, revision, 0, 92),
    3_011,
  );
  assert.equal(redFirst.ok, true, redFirst.error?.message);
  assert.equal(host.state.battle.blueScore, 88);
  assert.equal(host.state.battle.redScore, 92);
  assert.equal(host.state.battle.leadingSide, 'red');

  const secondLine = host.handleRaw(
    blue.authorization,
    scoreLineEvent(host, blue.memberId, 4, itemId, revision, 1, 95),
    3_021,
  );
  assert.equal(secondLine.ok, true, secondLine.error?.message);
  assert.equal(host.state.battle.blueScore, 183);
  assert.equal(host.state.battle.submittedMembers.length, 2);

  const duplicate = host.handleRaw(
    blue.authorization,
    scoreLineEvent(host, blue.memberId, 4, itemId, revision, 1, 95),
    3_031,
  );
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.value.duplicate, true);
  assert.equal(host.state.battle.blueScore, 183);

  const staleItem = host.handleRaw(
    blue.authorization,
    scoreLineEvent(host, blue.memberId, 5, 'other-song', revision, 0, 90),
    3_041,
  );
  assert.equal(staleItem.ok, false);
  assert.equal(staleItem.error.code, 'INVALID_TRANSITION');

  const staleRevision = host.handleRaw(
    blue.authorization,
    scoreLineEvent(host, blue.memberId, 6, itemId, revision - 5, 2, 90),
    3_051,
  );
  assert.equal(staleRevision.ok, false);
  assert.equal(staleRevision.error.code, 'INVALID_TRANSITION');

  const invalidPayload = lan.normalizeScoreLine({itemId, lineIndex: -1, revision, lineScore: {}, clientSentAtMs: 1});
  assert.equal(invalidPayload.ok, false);

  const oversizedFeedback = lan.normalizeScoreLine({
    itemId,
    lineIndex: 0,
    revision,
    lineScore: {feedback: ['x'.repeat(201)]},
    clientSentAtMs: 1,
  });
  assert.equal(oversizedFeedback.ok, false);
});

test('battle state resets when a new item starts scoring', () => {
  const {host, auth} = startHost();
  const blue = joinMember(host, auth, 'battle-reset-a', '蓝方', 1_100);
  const redPending = host.requestJoin({
    roomCode: host.code,
    displayName: '红方',
    clientNonce: 'battle-reset-b',
  }, 1_150);
  const red = host.approveJoin(auth, redPending.value.pendingId, 1_160, 'singer');
  assert.equal(red.ok, true);
  host.assignSide(auth, red.value.memberId, 'red', 1_180);
  for (const authorization of [blue.authorization, red.value.authorization]) {
    host.handleClientEvent(authorization, {type: 'member.ready', ready: true}, 1_200);
  }
  host.handleClientEvent(blue.authorization, {type: 'queue.add', recordingId: 'song-one', mode: 'chorus'}, 1_300);
  host.handleClientEvent(blue.authorization, {type: 'queue.add', recordingId: 'song-two', mode: 'chorus'}, 1_350);
  const firstItemId = host.state.queue[0].id;
  assert.equal(host.startQueueItem(auth, firstItemId, 1_400).ok, true);
  const revision = host.state.battle.revision;
  const first = host.handleRaw(
    blue.authorization,
    scoreLineEvent(host, blue.memberId, 4, firstItemId, revision, 0, 80),
    3_001,
  );
  assert.equal(first.ok, true, first.error?.message);
  assert.equal(host.state.battle.blueScore, 80);
  const finished = host.finishCurrent(auth, 1_500);
  assert.equal(finished.ok, true, finished.error?.message);

  const secondItemId = host.state.queue.find((item) => item.state === 'queued').id;
  assert.equal(host.startQueueItem(auth, secondItemId, 1_600).ok, true);
  const secondRevision = host.state.battle.revision;
  const second = host.handleRaw(
    red.value.authorization,
    scoreLineEvent(host, red.value.memberId, 2, secondItemId, secondRevision, 0, 75),
    4_001,
  );
  assert.equal(second.ok, true, second.error?.message);
  assert.equal(host.state.battle.itemId, secondItemId);
  assert.equal(host.state.battle.blueScore, 0);
  assert.equal(host.state.battle.redScore, 75);
  assert.equal(host.state.battle.leadingSide, 'red');
});

test('settling preserves a finished song and accepts an authorized reconnect exactly once', () => {
  const {host, auth} = startHost();
  const blue = joinMember(host, auth, 'settlement-blue', '蓝方', 1_100);
  const red = joinMember(host, auth, 'settlement-red', '红方', 1_110);
  const send = (member, event, at) => {
    const result = host.handleClientEvent(member.authorization, event, at);
    assert.equal(result.ok, true, result.error?.message);
  };
  send(blue, {type: 'queue.add', recordingId: 'settlement-song', mode: 'chorus'}, 1_200);
  send(blue, {type: 'member.ready', ready: true}, 1_210);
  send(red, {type: 'member.ready', ready: true}, 1_220);
  const id = host.state.queue[0].id;
  assert.equal(host.startQueueItem(auth, id, 1_300, 3_000).ok, true);
  assert.equal(host.state.status, 'countdown');
  host.tick(4_300);
  assert.equal(host.state.status, 'singing');
  const revision = host.state.battle.revision;
  assert.deepEqual(host.state.queue[0].singerIds, [blue.memberId, red.memberId]);
  assert.equal(host.disconnect(red.authorization, 5_000).ok, true);
  assert.equal(host.finishCurrent(auth, 5_050, true).ok, true);
  assert.equal(host.restart(auth, 5_060).ok, false);
  assert.equal(host.reconnect(red.authorization, 5_100).ok, true);
  const line = scoreLineEvent(host, red.memberId, 2, id, revision, 0, 92);
  assert.equal(host.handleRaw(red.authorization, line, 5_200).value.status, 'applied');
  assert.equal(host.handleRaw(red.authorization, line, 5_300).value.status, 'duplicate');
  assert.equal(host.state.battle.redScore, 92);
  assert.equal(host.leave(red.authorization, 5_400).ok, true);
  assert.equal(host.state.queue[0].state, 'scored');
  assert.equal(host.state.battle.redScore, 92);
  host.tick(66_000);
  assert.equal(host.state.battle.settlingUntilMs, undefined);
  assert.equal(host.handleRaw(blue.authorization, scoreLineEvent(host, blue.memberId, 4, id, revision, 1, 80), 66_050).error.code, 'INVALID_TRANSITION');
});
