const { createHash } = require('node:crypto');
const LIMIT = 8 * 1024 * 1024, SOURCE_LIMIT = 512 * 1024;
const hash = text => createHash('sha256').update(text).digest('hex');
async function sourceShare(records, read) {
  if (!records.length || records.length > 24) throw Error('分享包支持 1–24 个音乐源');
  const sources = [], seen = new Set();
  for (const record of records) {
    const pack = await read(record);
    if (!pack || typeof pack.script !== 'string' || !pack.script.trim()) throw Error('音乐源文件不完整，打包已停止');
    const script = record.kind === 'lx' ? pack.script : JSON.stringify({ manifest: pack.manifest, script: pack.script });
    if (Buffer.byteLength(script) > SOURCE_LIMIT) throw Error(`${record.manifest.name}超过分享大小限制（512 KiB）`);
    const sha256 = hash(script); if (seen.has(sha256)) continue; seen.add(sha256);
    const label = String(record.manifest.name || '音乐源').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 70);
    sources.push({ name: `${label}-${hash(record.id).slice(0, 12)}${record.kind === 'lx' ? '.js' : '.zenixsource'}`, url: `local:${sha256}`, local: true, script, sha256 });
  }
  const bundle = { format: 'zenix-source-bundle', schemaVersion: 1, name: 'Zenix 音乐源分享包', sources };
  const text = JSON.stringify(bundle);
  if (Buffer.byteLength(text) > LIMIT) throw Error('分享源包不能超过 8 MiB，请减少音乐源数量');
  return { text, count: sources.length };
}
module.exports = { sourceShare };
