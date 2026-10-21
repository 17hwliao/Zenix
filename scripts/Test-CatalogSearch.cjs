const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

async function catalog(native, payload, status = 200) {
  const transport = async () => new Response(JSON.stringify(payload), { status });
  const context = { Buffer, URL, URLSearchParams, AbortSignal, fetch: transport };
  let source;
  if (native) source = (await import('./Portable-Catalog.mjs')).portableCatalog();
  else {
    source = fs.readFileSync(path.resolve(__dirname, '../electron/lx-catalog.cjs'), 'utf8');
    context.module = { exports: {} };
    context.require = name => name === './runtime/source-network.cjs'
      ? { fetchAllowed: transport, readLimited: async response => Buffer.from(await response.arrayBuffer()) }
      : require(name);
  }
  vm.runInNewContext(source, context);
  return native ? context.zenixCatalog : context.module.exports;
}

for (const native of [false, true]) {
  const label = native ? 'native generated catalogue' : 'desktop catalogue';
  test(`${label}: business errors and malformed successful responses cannot masquerade as no songs`, async () => {
    for (const payload of [{ code: 405, message: '操作频繁，请稍候再试' }, { code: '405' }]) {
      const api = await catalog(native, payload);
      await assert.rejects(api.search('wy', '你不知道的事', 1, 25), /网易云搜索失败（405）.*操作频繁/);
    }
    for (const payload of [{ code: 500 }, {}, { code: 200 }, { code: 200, result: { songCount: 1 } }, { code: 200, result: { songs: {} } }]) {
      const api = await catalog(native, payload);
      await assert.rejects(api.search('wy', '像风一样', 1, 25), /网易云搜索/);
    }
    await assert.rejects((await catalog(native, { code: 405 }, 405)).search('wy', 'Ditto', 1, 25), /HTTP 405/);
  });

  test(`${label}: genuine empty searches remain empty; successful songs retain identity and pagination`, async () => {
    for (const result of [{ songCount: 0 }, { songCount: 0, songs: [] }, { songs: [] }]) {
      const page = await (await catalog(native, { code: 200, result })).search('wy', '无匹配', 1, 25);
      assert.equal(page.items.length, 0); assert.equal(page.nextCursor, null);
    }
    const page = await (await catalog(native, { code: 200, result: { songCount: 30, songs: [{ id: 123, name: '像风一样', artists: [{ name: '薛之谦' }], album: { id: 2, name: '渡' }, duration: 240000 }] } })).search('wy', '像风一样', 1, 25);
    assert.equal(page.nextCursor, '2'); assert.equal(page.items[0].title, '像风一样'); assert.equal(page.items[0].duration, 240);
    const info = JSON.parse(Buffer.from(page.items[0].remoteId, 'base64url').toString('utf8'));
    assert.equal(info.source, 'wy'); assert.equal(info.songmid, 123);
  });

  test(`${label}: the reported NetEase rejection does not change successful QQ, Kuwo or Kugou parsing`, async () => {
    const fixtures = {
      tx: { req: { data: { meta: { sum: 1 }, body: { song: { list: [{ mid: 'MID', id: 12, file: { media_mid: 'MEDIA' }, title: '歌曲', singer: [{ name: '歌手' }], interval: 120 }] } } } } },
      kw: { TOTAL: 1, abslist: [{ MUSICRID: 'MUSIC_12', SONGNAME: '歌曲', ARTIST: '歌手', DURATION: 120 }] },
      kg: { error_code: 0, data: { total: 1, lists: [{ Audioid: 12, FileHash: 'hash', OriSongName: '歌曲', SingerName: '歌手', Duration: 120 }] } },
    };
    for (const [platform, payload] of Object.entries(fixtures)) {
      const page = await (await catalog(native, payload)).search(platform, '歌曲', 1, 25);
      assert.equal(page.items.length, 1); assert.equal(page.items[0].title, '歌曲');
    }
  });
}
