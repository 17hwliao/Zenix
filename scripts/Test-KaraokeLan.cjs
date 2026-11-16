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

const lan = require('../src/features/karaoke/lan.ts');

function startHost(options = {}) {
  const created = lan.createKaraokeLanHost({
    hostId: 'host-1',
    hostDisplayName: '主持人',
    roomId: 'room-alpha',
    roomCode: '123456',
    nowMs: 1_000,
    tokenLifetimeMs: 60 * 60_000,
    ...options,
  });
  assert.equal(created.ok, true, created.error?.message);
  const started = created.value.start(1_000);
  assert.equal(started.ok, true, started.error?.message);
  return { host: created.value, auth: started.value.authorization };
}

function joinMember(host, hostAuth, nonce, name, nowMs, password, role = 'singer') {
  const pending = host.requestJoin({
    roomCode: host.code,
    displayName: name,
    clientNonce: nonce,
    ...(password !== undefined ? { password } : {}),
  }, nowMs);
  assert.equal(pending.ok, true, pending.error?.message);
  const approved = host.approveJoin(
    hostAuth,
    pending.value.pendingId,
    nowMs + 1,
    role,
  );
  assert.equal(approved.ok, true, approved.error?.message);
  return approved.value;
}

function clientEnvelope(host, memberId, type, sequence, payload, sentAtMs = 2_000) {
  const created = lan.createKaraokeLanEnvelope({
    type,
    source: 'client',
    roomId: host.id,
    senderId: memberId,
    recipientId: 'host-1',
    sequence,
    sentAtMs,
    payload,
  });
  assert.equal(created.ok, true, created.error?.message);
  return created.value;
}

function fakeMediaFactory() {
  const peers = [];
  return {
    peers,
    adapter: {
      async createPeer(context) {
        const peer = {
          context,
          closed: false,
          answers: [],
          candidates: [],
          async createOffer() {
            return 'offer:opus';
          },
          async applyAnswer(answer) {
            this.answers.push(answer);
          },
          async addIceCandidate(candidate) {
            this.candidates.push(candidate);
          },
          close() {
            this.closed = true;
          },
        };
        peers.push(peer);
        return peer;
      },
    },
  };
}

test('room codes normalize safely, collisions retry and QR invitations round-trip without secrets', () => {
  assert.equal(lan.normalizeKaraokeRoomCode(' 123 456 '), '123456');
  assert.equal(lan.normalizeKaraokeRoomCode('12-34-56'), '123456');
  assert.equal(lan.normalizeKaraokeRoomCode('12345A'), null);
  assert.equal(lan.normalizeKaraokeRoomCode(123456), null);

  const guard = new lan.InMemoryKaraokeRoomCodeGuard();
  assert.equal(guard.reserve('123456'), true);
  assert.equal(guard.reserve('123456'), false);
  const digits = [1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1];
  let index = 0;
  const generated = lan.generateKaraokeRoomCode({
    guard,
    nextDigit: () => digits[index++],
    attempts: 2,
  });
  assert.equal(generated.ok, true);
  assert.equal(generated.value, '654321');
  assert.equal(guard.has('654321'), true);

  const invite = lan.generateKaraokeLanInvite({
    roomId: 'room-alpha',
    roomCode: '654 321',
    hostName: '主持人',
    expiresAtMs: 120_000,
    passwordRequired: true,
  });
  assert.equal(invite.ok, true);
  assert.doesNotMatch(invite.value.qrPayload, /token|secret|password=/iu);
  assert.match(invite.value.qrPayload, /zenix-karaoke:\/\/join\?/u);
  const parsed = lan.parseKaraokeLanInvite(invite.value.shareText, 60_000);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, invite.value.data);
  const expired = lan.parseKaraokeLanInvite(invite.value.qrPayload, 120_000);
  assert.equal(expired.ok, false);
  assert.equal(expired.error.code, 'INVITE_EXPIRED');
  assert.equal(lan.parseKaraokeLanInvite('https://example.test', 1).error.code, 'INVALID_INPUT');
});

test('room grants are isolated by room, expiry and K-song-only capabilities', () => {
  const grants = new lan.KaraokeLanGrantService();
  const host = grants.issue({
    roomId: 'room-a',
    memberId: 'host',
    role: 'host',
    expiresAtMs: 10_000,
  });
  const singer = grants.issue({
    roomId: 'room-a',
    memberId: 'singer',
    role: 'singer',
    expiresAtMs: 10_000,
  });
  const listener = grants.issue({
    roomId: 'room-a',
    memberId: 'listener',
    role: 'listener',
    expiresAtMs: 10_000,
  });
  assert.equal(host.ok, true);
  assert.equal(singer.ok, true);
  assert.equal(listener.ok, true);
  assert.deepEqual(host.value.capabilities, [
    'room-control',
    'sing',
    'queue',
    'return-media',
  ]);
  assert.deepEqual(singer.value.capabilities, ['sing', 'queue', 'return-media']);
  assert.deepEqual(listener.value.capabilities, ['return-media']);
  assert.equal(singer.value.capabilities.some((value) => (
    ['remote-control', 'profile-transfer', 'settings-write'].includes(value)
  )), false);
  assert.equal(grants.requireCapability(
    singer.value,
    'room-a',
    'room-control',
    2_000,
  ).error.code, 'PERMISSION_DENIED');
  assert.equal(grants.validate(singer.value, 'room-b', 2_000).error.code, 'TOKEN_INVALID');
  assert.equal(grants.validate(singer.value, 'room-a', 10_000).error.code, 'TOKEN_EXPIRED');
  assert.equal(grants.revokeMember('room-a', 'singer'), 1);
  assert.equal(grants.validate(singer.value, 'room-a', 2_000).error.code, 'TOKEN_INVALID');
});

test('join approval enforces password, expiry, rejection, duplicate and full-room errors', () => {
  const codeGuard = new lan.InMemoryKaraokeRoomCodeGuard();
  const created = lan.createKaraokeLanHost({
    hostId: 'host-1',
    hostDisplayName: '主持人',
    roomId: 'room-errors',
    roomCode: '222222',
    joinPassword: '2468',
    codeGuard,
    nowMs: 1_000,
  });
  assert.equal(created.ok, true);
  const hostAuth = created.value.start(1_000);
  assert.equal(hostAuth.ok, true);
  const notStarted = lan.createKaraokeLanHost({
    hostId: 'host-2',
    hostDisplayName: '未启动',
    roomId: 'room-not-started',
    roomCode: '333333',
    nowMs: 1_000,
  });
  assert.equal(notStarted.ok, true);
  assert.equal(notStarted.value.requestJoin({
    roomCode: '333333',
    displayName: 'A',
    clientNonce: 'not-started-client',
  }, 1_100).error.code, 'ROOM_NOT_STARTED');

  assert.equal(created.value.requestJoin({
    roomCode: '222222',
    displayName: 'A',
    clientNonce: 'wrong-password-client',
    password: 'bad',
  }, 1_100).error.code, 'WRONG_PASSWORD');
  assert.equal(created.value.requestJoin({
    roomCode: '222222',
    displayName: 'A',
    clientNonce: 'expired-invite-client',
    password: '2468',
    inviteExpiresAtMs: 1_050,
  }, 1_100).error.code, 'INVITE_EXPIRED');

  const pending = created.value.requestJoin({
    roomCode: '222222',
    displayName: 'A',
    clientNonce: 'approved-client',
    password: '2468',
  }, 1_200);
  assert.equal(pending.ok, true, pending.error?.code);
  assert.equal(created.value.requestJoin({
    roomCode: '222222',
    displayName: 'A',
    clientNonce: 'approved-client',
    password: '2468',
  }, 1_201).error.code, 'DUPLICATE_JOIN');
  const approved = created.value.approveJoin(
    hostAuth.value.authorization,
    pending.value.pendingId,
    1_300,
  );
  assert.equal(approved.ok, true);
  assert.equal(approved.value.authorization.capabilities.includes('room-control'), false);
  assert.equal(created.value.approveJoin(
    hostAuth.value.authorization,
    pending.value.pendingId,
    1_400,
  ).error.code, 'JOIN_ALREADY_RESOLVED');

  const rejected = created.value.requestJoin({
    roomCode: '222222',
    displayName: 'B',
    clientNonce: 'rejected-client',
    password: '2468',
  }, 1_500);
  assert.equal(rejected.ok, true);
  assert.equal(created.value.rejectJoin(
    hostAuth.value.authorization,
    rejected.value.pendingId,
    1_600,
  ).ok, true);
  assert.equal(created.value.approveJoin(
    hostAuth.value.authorization,
    rejected.value.pendingId,
    1_700,
  ).error.code, 'JOIN_REJECTED');

  joinMember(created.value, hostAuth.value.authorization, 'member-3', 'C', 2_000, '2468');
  joinMember(created.value, hostAuth.value.authorization, 'member-4', 'D', 2_100, '2468');
  assert.equal(created.value.state.members.length, 4);
  assert.equal(created.value.requestJoin({
    roomCode: '222222',
    displayName: 'E',
    clientNonce: 'full-client',
    password: '2468',
  }, 2_200).error.code, 'ROOM_FULL');
});

test('versioned control events apply once, reconnect restores queue and snapshots reject bad origins', () => {
  const { host, auth } = startHost();
  const singer = joinMember(host, auth, 'protocol-client', '演唱者', 1_100);
  const received = [];
  const unsubscribe = host.subscribe(singer.authorization, (event) => received.push(event), 1_200);
  assert.equal(unsubscribe.ok, true);
  assert.equal(received.at(-1).type, 'room.snapshot');

  const consumer = new lan.KaraokeLanSnapshotConsumer({
    roomId: host.id,
    roomCode: host.code,
    hostId: 'host-1',
    memberId: singer.memberId,
  });
  assert.equal(consumer.accept(received.at(-1)).ok, true);

  const ready = clientEnvelope(host, singer.memberId, 'member.ready', 1, { ready: true }, 1_300);
  const firstReady = host.handleRaw(singer.authorization, ready, 1_300);
  assert.equal(firstReady.ok, true);
  assert.equal(firstReady.value.status, 'applied');
  const revision = host.state.revision;
  const duplicateReady = host.handleRaw(singer.authorization, ready, 1_301);
  assert.equal(duplicateReady.ok, true);
  assert.equal(duplicateReady.value.status, 'duplicate');
  assert.equal(host.state.revision, revision);

  const uriRecording = host.handleRaw(
    singer.authorization,
    clientEnvelope(host, singer.memberId, 'queue.add', 2, {
      recordingId: 'https://private.invalid/audio?token=secret',
      mode: 'solo',
    }, 1_350),
    1_350,
  );
  assert.equal(uriRecording.ok, false);
  assert.equal(uriRecording.error.code, 'INVALID_INPUT');
  assert.equal(host.state.queue.length, 0);

  const queued = host.handleRaw(
    singer.authorization,
    clientEnvelope(host, singer.memberId, 'queue.add', 2, {
      recordingId: 'recording-1',
      mode: 'solo',
    }, 1_400),
    1_400,
  );
  assert.equal(queued.ok, true);
  const queueJson = JSON.stringify(host.state.queue);
  assert.equal(host.disconnect(singer.authorization, 1_500).ok, true);
  assert.equal(host.state.status, 'lobby');
  assert.equal(host.reconnect(singer.authorization, 1_600).ok, true);
  assert.equal(JSON.stringify(host.state.queue), queueJson);

  const clock = host.handleRaw(
    singer.authorization,
    clientEnvelope(host, singer.memberId, 'clock.ping', 3, {
      sampleId: 'clock-1',
      clientSendMs: 1_550,
    }, 1_600),
    1_600,
  );
  assert.equal(clock.ok, true);
  assert.equal(clock.value.type, 'clock.pong');
  assert.equal(typeof clock.value.payload.offsetMs, 'number');
  assert.equal(host.handleRaw(
    singer.authorization,
    clientEnvelope(host, singer.memberId, 'heartbeat.ping', 4, {}, 1_700),
    1_700,
  ).value.type, 'heartbeat.ack');

  const snapshot = received.filter((event) => event.type === 'room.snapshot').at(-1);
  assert.equal(snapshot.type, 'room.snapshot');
  assert.equal(consumer.accept(snapshot).ok, true);
  assert.equal(consumer.accept(snapshot).value.duplicate, true);
  const wrongMember = structuredClone(snapshot);
  wrongMember.recipientId = 'someone-else';
  assert.equal(consumer.accept(wrongMember).error.code, 'SNAPSHOT_INVALID');
  const wrongSource = structuredClone(snapshot);
  wrongSource.source = 'client';
  assert.equal(consumer.accept(wrongSource).error.code, 'SNAPSHOT_INVALID');
  assert.doesNotMatch(JSON.stringify(snapshot.payload), /token|audioUri|profile/iu);
});

test('reconnect attempts are bounded and successful recovery keeps the existing queue boundary', () => {
  const { host, auth } = startHost({ roomId: 'room-reconnect', roomCode: '444444' });
  const singer = joinMember(host, auth, 'reconnect-client', '重连者', 1_100);
  assert.equal(host.handleClientEvent(
    singer.authorization,
    { type: 'member.ready', ready: true },
    1_200,
  ).value.status, 'applied');
  assert.equal(host.handleClientEvent(
    singer.authorization,
    { type: 'queue.add', recordingId: 'reconnect-song', mode: 'chorus' },
    1_300,
  ).value.status, 'applied');
  const queue = host.state.queue;
  assert.equal(queue.length, 1);
  assert.equal(host.disconnect(singer.authorization, 1_400).ok, true);
  assert.equal(host.reconnect(singer.authorization, 1_500).ok, true);
  assert.deepEqual(host.state.queue, queue);

  assert.equal(host.disconnect(singer.authorization, 1_600).ok, true);
  const delays = [];
  for (let attempt = 0; attempt < lan.KARAOKE_LAN_LIMITS.maxReconnectAttempts; attempt += 1) {
    const failed = host.recordReconnectFailure(singer.authorization, 1_700 + attempt);
    assert.equal(failed.ok, true);
    delays.push(failed.value.delayMs);
  }
  assert.deepEqual(delays, [250, 500, 1000, 2000, 4000]);
  assert.equal(host.recordReconnectFailure(
    singer.authorization,
    1_800,
  ).error.code, 'RECONNECT_EXHAUSTED');
  assert.equal(host.reconnect(
    singer.authorization,
    1_900,
  ).error.code, 'RECONNECT_EXHAUSTED');
  assert.deepEqual(host.state.queue, queue);
});

test('protocol rejects oversized/versioned messages and enforces rate and serialized size limits', () => {
  const oversized = lan.parseKaraokeLanEnvelope(
    'x'.repeat(lan.KARAOKE_LAN_LIMITS.maxMessageBytes + 1),
  );
  assert.equal(oversized.error.code, 'MESSAGE_TOO_LARGE');
  const valid = lan.createKaraokeLanEnvelope({
    type: 'heartbeat.ping',
    source: 'client',
    roomId: 'room',
    senderId: 'member',
    recipientId: 'host',
    sequence: 1,
    sentAtMs: 1,
    payload: {},
  });
  assert.equal(valid.ok, true);
  const unsupported = { ...valid.value, version: 99 };
  assert.equal(lan.parseKaraokeLanEnvelope(unsupported).error.code, 'UNSUPPORTED_VERSION');

  const limiter = new lan.KaraokeLanRateLimiter(2, 100);
  assert.equal(limiter.consume('member', 1_000).ok, true);
  assert.equal(limiter.consume('member', 1_001).ok, true);
  assert.equal(limiter.consume('member', 1_002).error.code, 'RATE_LIMITED');
  assert.equal(limiter.consume('member', 1_101).ok, true);

  const { host } = startHost({ roomId: 'room-size', roomCode: '555555' });
  const queue = Array.from({ length: 64 }, (_, index) => ({
    id: `queue-${index}-${'q'.repeat(1_200)}`,
    recordingId: `recording-${index}-${'r'.repeat(1_200)}`,
    mode: 'solo',
    singerIds: ['host-1'],
    state: 'queued',
  }));
  const largeState = { ...host.state, queue, revision: 1 };
  const recovery = lan.serializeKaraokeLanRecovery(largeState, 2_000);
  assert.equal(recovery.ok, false);
  assert.equal(recovery.error.code, 'SNAPSHOT_TOO_LARGE');
});

test('queue capacity remains bounded at the LAN session boundary', () => {
  const { host, auth } = startHost({ roomId: 'room-queue-limit', roomCode: '888888' });
  const singer = joinMember(host, auth, 'queue-limit-client', '队列成员', 1_100);
  assert.equal(host.handleClientEvent(
    singer.authorization,
    { type: 'member.ready', ready: true },
    1_200,
  ).value.status, 'applied');
  for (let index = 0; index < 64; index += 1) {
    const result = host.handleClientEvent(
      singer.authorization,
      { type: 'queue.add', recordingId: `catalog:track-${index}`, mode: 'solo' },
      2_000 + index * 501,
    );
    assert.equal(result.ok, true, result.error?.code);
    assert.equal(result.value.status, 'applied');
  }
  assert.equal(host.state.queue.length, 64);
  const full = host.handleClientEvent(
    singer.authorization,
    { type: 'queue.add', recordingId: 'catalog:overflow', mode: 'solo' },
    40_000,
  );
  assert.equal(full.ok, false);
  assert.equal(full.error.code, 'QUEUE_FULL');
  assert.equal(host.state.queue.length, 64);
});

test('abstract WebSocket binding sends snapshots/acks and reports structured protocol errors', () => {
  const { host, auth } = startHost({ roomId: 'room-socket', roomCode: '777777' });
  const singer = joinMember(host, auth, 'socket-client', 'Socket 成员', 1_100);
  const outbound = [];
  const socket = {
    closed: null,
    send(value) {
      outbound.push(JSON.parse(value));
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
  };
  const binding = lan.attachKaraokeLanWebSocket({
    host,
    authorization: singer.authorization,
    hostId: 'host-1',
    socket,
    nowMs: 1_200,
  });
  assert.equal(binding.ok, true);
  assert.equal(outbound[0].type, 'room.snapshot');

  const heartbeat = clientEnvelope(
    host,
    singer.memberId,
    'heartbeat.ping',
    1,
    { clientSendMs: 1_250 },
    1_250,
  );
  const ack = binding.value.receive(JSON.stringify(heartbeat), 1_250);
  assert.equal(ack.ok, true);
  assert.equal(ack.value.type, 'heartbeat.ack');
  assert.equal(outbound.at(-1).type, 'heartbeat.ack');

  const malformed = binding.value.receive('x'.repeat(lan.KARAOKE_LAN_LIMITS.maxMessageBytes + 1), 1_300);
  assert.equal(malformed.error.code, 'MESSAGE_TOO_LARGE');
  assert.equal(outbound.at(-1).type, 'room.error');
  assert.equal(outbound.at(-1).payload.code, 'MESSAGE_TOO_LARGE');
  binding.value.close();
  assert.deepEqual(socket.closed, { code: 1000, reason: 'Karaoke room closed' });
});

test('a media peer closes when its room token expires', async () => {
  const grants = new lan.KaraokeLanGrantService();
  const authorization = grants.issue({
    roomId: 'room-expiring-media',
    memberId: 'expiring-singer',
    role: 'singer',
    expiresAtMs: 2_000,
  });
  assert.equal(authorization.ok, true);
  const fake = fakeMediaFactory();
  const manager = new lan.KaraokeLanMediaManager(fake.adapter, grants);
  const started = await manager.start(authorization.value, {
    roomId: 'room-expiring-media',
    recordingId: 'expiring-recording',
    nowMs: 1_000,
  });
  assert.equal(started.ok, true);
  const expired = await manager.applyAnswer(
    authorization.value,
    started.value.sessionId,
    'answer:opus',
    2_000,
  );
  assert.equal(expired.ok, false);
  assert.equal(expired.error.code, 'TOKEN_EXPIRED');
  assert.equal(fake.peers[0].closed, true);
  assert.equal(manager.snapshot()[0].state, 'closed');
  assert.equal(manager.snapshot()[0].closeReason, 'token-invalid');
});

test('media state machine is Opus-oriented and closes on kick and host stop while grants stay isolated', async () => {
  const fake = fakeMediaFactory();
  const { host, auth } = startHost({
    roomId: 'room-media',
    roomCode: '666666',
    mediaAdapter: fake.adapter,
  });
  const first = joinMember(host, auth, 'media-client-1', '歌手一', 1_100);
  const second = joinMember(host, auth, 'media-client-2', '歌手二', 1_200);
  assert.ok(host.media);

  const firstMedia = await host.media.start(first.authorization, {
    roomId: host.id,
    recordingId: 'media-song-1',
    channels: 1,
    nowMs: 1_300,
  });
  const secondMedia = await host.media.start(second.authorization, {
    roomId: host.id,
    recordingId: 'media-song-2',
    channels: 2,
    nowMs: 1_300,
  });
  assert.equal(firstMedia.ok, true);
  assert.equal(secondMedia.ok, true);
  assert.equal(firstMedia.value.view.state, 'negotiating');
  assert.deepEqual(firstMedia.value.view.opus, {
    codec: 'opus',
    sampleRate: 48_000,
    channels: 1,
    application: 'lowdelay',
  });
  assert.deepEqual(Object.keys(fake.peers[0].context).sort(), [
    'memberId',
    'opus',
    'recordingId',
    'role',
    'roomId',
  ]);
  const connected = await host.media.applyAnswer(
    first.authorization,
    firstMedia.value.sessionId,
    'answer:opus',
    1_400,
  );
  assert.equal(connected.ok, true);
  assert.equal(connected.value.state, 'connected');

  const kicked = host.kick(auth, first.memberId, 1_500);
  assert.equal(kicked.ok, true);
  assert.equal(fake.peers[0].closed, true);
  assert.equal(host.handleClientEvent(
    first.authorization,
    { type: 'member.ready', ready: true },
    1_600,
  ).error.code, 'TOKEN_INVALID');

  const stopped = host.stop(auth, 1_700, 'test-stop');
  assert.equal(stopped.ok, true);
  assert.equal(stopped.value.status, 'closed');
  assert.equal(fake.peers[1].closed, true);
  assert.equal(host.handleClientEvent(
    second.authorization,
    { type: 'member.ready', ready: true },
    1_800,
  ).error.code, 'ROOM_CLOSED');

  const recovery = lan.serializeKaraokeLanRecovery(host.state, 1_900);
  assert.equal(recovery.ok, true);
  assert.doesNotMatch(JSON.stringify(recovery.value), /token|audioUri|profile|playlist/iu);
  assert.equal(lan.restoreKaraokeLanRecovery(recovery.value).value.status, 'closed');
});
