import { readFileSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
const out = new URL('../android/app/src/main/assets/zenix/', import.meta.url);
mkdirSync(out, { recursive: true });
cpSync(new URL('../config/distribution.json', import.meta.url), new URL('distribution.json', out));
// Share our catalogue implementation; Android supplies its own HTTP/crypto adapters.
const catalog = readFileSync(new URL('../electron/lx-catalog.cjs', import.meta.url), 'utf8')
  .replace("const { createHash } = require('node:crypto');", "const createHash = () => ({ update(value) { this.value = value; return this; }, digest() { return lx.utils.crypto.md5(this.value); } });")
  .replace("const { inflateSync } = require('node:zlib');", "const inflateSync = value => Buffer.from(lx.utils.buffer.from(NativeHost.zlib('inflate', lx.utils.buffer.bufToString(value, 'base64')), 'base64'));")
  .replace('module.exports = { PLATFORMS, readInfo, search, artwork, lyrics };', 'globalThis.zenixCatalog = { PLATFORMS, readInfo, search, artwork, lyrics };')
  .replace('http://media.store.kugou.com', 'https://media.store.kugou.com')
  .replace(/LX /g, '').replace("source: 'lx'", "source: 'custom'");
writeFileSync(new URL('catalog.js', out), catalog);
const legal = new URL('legal/', out);
mkdirSync(legal, { recursive: true });
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(new URL(`../${name}`, import.meta.url), new URL(name, legal));
cpSync(new URL('../licenses/', import.meta.url), new URL('licenses/', legal), { recursive: true });
