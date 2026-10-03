// Download public upstream snapshots as data. Never evaluate these scripts here.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const directory = path.join(root, 'release', 'source-bundles', date);
await fs.mkdir(path.join(directory, 'scripts'), { recursive: true });
const presets = await fs.readFile(path.join(root, 'src/ui/lxPresets.ts'), 'utf8');
const entries = [...presets.matchAll(/\{ key: '([^']+)', name: '([^']+)', description: '[^']*', url: '([^']+)' \}/g)].map(([, key, name, url]) => ({ key, name, url }));
if (entries.length !== 8) throw Error('Preset list changed; review source packing entries.');
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok || new URL(response.url).protocol !== 'https:') throw Error(`HTTP ${response.status}`);
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 512 * 1024) throw Error('Script exceeds 512 KiB'); chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const script = Buffer.concat(chunks).toString('utf8');
  if (!/globalThis\s*(?:\.lx|\[\s*['"]lx['"]\s*\])|EVENT_NAMES\.inited|@name/.test(script) || /^\s*<!doctype|^\s*<html/i.test(script)) throw Error('Response is not a recognized source script');
  return script;
}
const results = await Promise.all(entries.map(async (entry, index) => {
  const addresses = [entry.url, 'https://ghproxy.net/' + entry.url]; let lastError = '';
  for (const url of addresses) {
    try {
      const script = await download(url), sha256 = createHash('sha256').update(script).digest('hex');
      await fs.writeFile(path.join(directory, 'scripts', `${String(index + 1).padStart(2, '0')}-${entry.key}.js`), script, 'utf8');
      console.log(`${entry.name}: saved ${Buffer.byteLength(script)} bytes`);
      return { name: entry.name, url: entry.url, script, sha256 };
    } catch (error) { lastError = error.message; }
  }
  console.log(`${entry.name}: link only (${lastError})`);
  return { name: entry.name, url: entry.url, fetchError: lastError };
}));
const name = `Zenix-Sources-${date}`;
await fs.writeFile(path.join(directory, `${name}.zenixsources`), JSON.stringify({ format: 'zenix-source-bundle', schemaVersion: 1, name: `Zenix 音乐源分享包 · ${date}`, createdAt: new Date().toISOString(), sources: results }, null, 2), 'utf8');
await fs.writeFile(path.join(directory, `${name}-Links.zenixsources`), JSON.stringify({ format: 'zenix-source-bundle', schemaVersion: 1, name: 'Zenix 音乐源链接包', sources: entries.map(({ name, url }) => ({ name, url })) }, null, 2), 'utf8');
const list = results.map((entry, index) => `${index + 1}. ${entry.name} — ${entry.script ? '含脚本快照' : '仅地址，获取失败：' + entry.fetchError}\n   ${entry.url}\n   ${entry.sha256 ? 'SHA-256 ' + entry.sha256 : ''}`).join('\n');
await fs.writeFile(path.join(directory, '使用说明.txt'), `Zenix 音乐源分享包（${date}）\n\n新客户端：个人主页 → 播放器设置 → 音乐源 → 导入分享源包 → 选择 ${name}.zenixsources → 确认批量添加。Android/iOS：音乐源页 → 导入分享源包。\n1.0.1 及后续修补版还可直接选择分享 ZIP，无需解压。1.0.0 请解压后选择 .zenixsources 文件；更早版本使用单个脚本入口。\n\n旧客户端：解压后在音乐源页选择 scripts/ 下的 .js 文件，逐个确认导入；也可逐条粘贴以下 HTTPS 地址。Windows/Android/iOS 的现有单脚本入口均可使用。\n\n${list}\n\n包内顺序是新接入源的顺序。已有源更新时保留原顺序；不会导入个人背景、账号密钥、歌曲、歌单或缓存。\n脚本快照可减少获取脚本时的联网步骤，初始化及播放仍可能需要联网或作者授权。包含脚本不等于验证播放成功；源服务状态以实际调用为准。\n导入前展示列表，需要用户确认。只添加可信分享包；校验值用于检查文件完整性，不表示作者身份认证。\n\n第三方来源：https://github.com/pdone/lx-music-source 与 https://github.com/cdyUuu/lx-music-xinghai-source 。各脚本保留原始内容和作者头部，权利及使用约定属于各原作者。此分享资料独立于 Zenix 应用发行包，不将第三方脚本自动安装进用户的软件。\n`, 'utf8');
// Native clients can read this ZIP directly; snapshots remain separate from installers.
const files = {};
for (const filename of [`${name}.zenixsources`, `${name}-Links.zenixsources`, '使用说明.txt']) files[`${name}/${filename}`] = new Uint8Array(await fs.readFile(path.join(directory, filename)));
for (const filename of await fs.readdir(path.join(directory, 'scripts'))) files[`${name}/scripts/${filename}`] = new Uint8Array(await fs.readFile(path.join(directory, 'scripts', filename)));
const archive = path.join(path.dirname(directory), `${name}.zip`);
await fs.writeFile(archive, zipSync(files, { level: 6 }));
console.log(JSON.stringify({ directory, archive, count: results.length, snapshots: results.filter(value => value.script).length, name }));
