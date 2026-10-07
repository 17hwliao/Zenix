import { readFileSync } from 'node:fs';

function replaceOne(input, pattern, replacement, label) {
  let hits = 0;
  const expression = typeof pattern === 'string' ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : new RegExp(pattern.source, 'g');
  const output = input.replace(expression, () => { hits++; return replacement; });
  if (hits !== 1) throw new Error(`目录适配步骤 ${label} 必须命中一次，实际 ${hits} 次`);
  return output;
}

// Native HTTP has its own 4 MiB transport cap. byteLength lets catalogue reads
// reject their smaller limit before requesting another ArrayBuffer copy.
const nativeRead = `const readLimited = async (response, limit) => {
  if (Number(response.headers.get('content-length')) > limit || response.byteLength > limit) throw new Error('目录响应过大');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error('目录响应过大');
  return bytes;
};\n`;

export function portableCatalog() {
  let code = readFileSync(new URL('../electron/lx-catalog.cjs', import.meta.url), 'utf8');
  code = replaceOne(code, /const \{ AsyncLocalStorage \} = require\('node:async_hooks'\);[\s\S]*?(?=const PLATFORMS)/, nativeRead, 'network');
  code = replaceOne(code, "const { createHash } = require('node:crypto');", "const createHash = () => ({ update(value) { this.value = value; return this; }, digest() { return lx.utils.crypto.md5(this.value); } });", 'crypto');
  code = replaceOne(code, "const { inflateSync } = require('node:zlib');", "const inflateSync = value => Buffer.from(lx.utils.buffer.from(NativeHost.zlib('inflate', lx.utils.buffer.bufToString(value, 'base64')), 'base64'));", 'inflate');
  code = replaceOne(code, /  if \(signal\) return context\.run\(signal, \(\) => search\([^\n]+\n/, '', 'cancellation');
  code = replaceOne(code, 'module.exports = { PLATFORMS, readInfo, search, artwork, lyrics };', 'globalThis.zenixCatalog = { PLATFORMS, readInfo, search, artwork, lyrics };', 'exports');
  code = code.replace(/LX /g, '').replace("source: 'lx'", "source: 'custom'");
  if (/require\(|module\.exports|AsyncLocalStorage|context\.run|http:\/\/media\.store\.kugou\.com/.test(code)) throw new Error('目录适配留下了不支持的运行时调用或明文端点');
  return code;
}
