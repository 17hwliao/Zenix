const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {strToU8, zipSync} = require('fflate');

async function themeModules(t) {
  const {createServer} = await import('vite');
  const server = await createServer({
    root: path.resolve(__dirname, '..'),
    server: {middlewareMode: true},
    optimizeDeps: {noDiscovery: true},
    appType: 'custom',
    logLevel: 'error',
  });
  t.after(() => server.close());
  return {
    model: await server.ssrLoadModule('/src/features/themes/model.ts'),
    archive: await server.ssrLoadModule('/src/features/themes/archive.ts'),
  };
}

function manifest(overrides = {}) {
  return {
    schema: 1,
    id: 'night-archive',
    name: '夜间主题',
    author: 'Fixture',
    version: '1.2.3',
    preview: 'preview.svg',
    tokens: {
      background: '#080808',
      lyrics: '#aaa9a5',
      activeLyrics: '#f4f2ec',
      translation: '#777673',
      controls: '#deddd8',
      maxWidth: 760,
      fontSize: 34,
      lineHeight: 1.55,
      activeScale: 1.1,
      fadeDistance: 2,
      motionMs: 240,
    },
    ...overrides,
  };
}

function archive(value = manifest(), extras = {}) {
  return zipSync({
    'theme.json': strToU8(JSON.stringify(value)),
    'preview.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#080808"/></svg>'),
    ...extras,
  });
}

function fileInfo(name, type, data) {
  return {name, type, size: data.length};
}

test('validated theme packages reject unknown schemas and fields', async t => {
  const {model} = await themeModules(t);
  const valid = model.validateThemePackage(manifest(), new Set(['preview.svg']));
  assert.equal(valid.id, 'night-archive');
  assert.equal(valid.tokens.fontSize, 34);
  assert.equal(model.builtinThemes.length, 4);
  assert.equal(model.defaultTheme().id, model.DEFAULT_THEME_ID);
  assert.throws(() => model.validateThemePackage(manifest({schema: 2}), new Set(['preview.svg'])), /版本/);
  assert.throws(() => model.validateThemePackage(manifest({unexpected: true}), new Set(['preview.svg'])), /未知字段/);
  assert.throws(() => model.validateThemePackage(manifest({id: model.DEFAULT_THEME_ID}), new Set(['preview.svg'])), /内置主题/);
  assert.throws(() => model.validateThemePackage(manifest({
    tokens: {...manifest().tokens, background: 'url(https://tracker.invalid/pixel)'},
  }), new Set(['preview.svg'])), /十六进制/);
});

test('pure lyrics keep the current line plus two neighbors and expose distance tiers', async t => {
  const {model} = await themeModules(t);
  const lines = Array.from({length: 10}, (_, index) => ({time: index, text: `line ${index}`}));
  assert.deepEqual(
    model.lyricWindow(lines, 5, 2).map(item => ({index: item.sourceIndex, distance: item.distance})),
    [{index: 3, distance: 2}, {index: 4, distance: 1}, {index: 5, distance: 0}, {index: 6, distance: 1}, {index: 7, distance: 2}],
  );
  assert.deepEqual(model.lyricWindow(lines, 0, 2).map(item => item.sourceIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual(model.lyricWindow(lines, 9, 2).map(item => item.sourceIndex), [5, 6, 7, 8, 9]);
  assert.equal(model.lyricWindow([], 0, 2).length, 0);
});

test('theme archive enforces extension, MIME, resources and manifest availability', async t => {
  const {archive: archiveApi} = await themeModules(t);
  const bytes = archive();
  const parsed = archiveApi.parseThemeArchive(bytes, fileInfo('night.zenuxtheme', 'application/zip', bytes));
  assert.equal(parsed.theme.id, 'night-archive');
  assert(parsed.files['preview.svg'] instanceof Uint8Array);

  assert.throws(() => archiveApi.parseThemeArchive(bytes, fileInfo('night.zip', 'application/zip', bytes)), /\.zenuxtheme/);
  assert.throws(() => archiveApi.parseThemeArchive(bytes, fileInfo('night.zenuxtheme', 'text/html', bytes)), /MIME/);
  assert.throws(() => archiveApi.parseThemeArchive(new Uint8Array(archiveApi.THEME_ARCHIVE_LIMIT + 1)), /12 MiB/);
  assert.throws(() => archiveApi.parseThemeArchive(zipSync({
    'theme.json': strToU8(JSON.stringify(manifest())),
    'preview.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'payload.js': strToU8('alert(1)'),
  })), /不支持的文件或脚本/);
  assert.throws(() => archiveApi.parseThemeArchive(zipSync({
    'theme.json': strToU8(JSON.stringify(manifest())),
  })), /缺少资源/);
  assert.throws(() => archiveApi.parseThemeArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), /有效的 ZIP/);
});

test('SVG resources cannot smuggle scripts, event handlers or external execution', async t => {
  const {archive: archiveApi} = await themeModules(t);
  const unsafe = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://example.invalid"/></foreignObject></svg>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/tracker.png"/></svg>',
  ];
  for (const source of unsafe) {
    assert.throws(() => archiveApi.assertSafeSvg(strToU8(source), 'preview.svg'), /不安全/);
  }
  assert.doesNotThrow(() => archiveApi.assertSafeSvg(strToU8(
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)"/></svg>',
  ), 'preview.svg'));
  assert.throws(() => archiveApi.parseThemeArchive(zipSync({
    'theme.json': strToU8(JSON.stringify(manifest())),
    'preview.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  })), /不安全/);
});
