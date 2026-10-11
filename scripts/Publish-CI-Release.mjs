import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, createReadStream } from 'node:fs';
import { createPublicKey, createHash } from 'node:crypto';
import path from 'node:path';
import contract from './release-contract.cjs';

// Installers are immutable. A retry accepts only an already uploaded identical file.
const description = JSON.parse(readFileSync('release-assets/description.json', 'utf8'));
const feedBytes = readFileSync(`updates/${description.channel}.json`);
if (feedBytes.length > 256 * 1024) throw new Error('签名更新清单超过旧客户端的大小限制');
const feed = JSON.parse(feedBytes.toString('utf8'));
const config = JSON.parse(readFileSync(new URL('../config/distribution.json', import.meta.url), 'utf8'));
const publicKey = createPublicKey({ key: Buffer.from(config.publicKeySpki, 'base64'), type: 'spki', format: 'der' });
const document = contract.verifyRelease(feed, publicKey, description.channel);
const tag = process.env.RELEASE_TAG;
if (!tag || process.env.GITHUB_REPOSITORY !== '17hwliao/Zenix') throw new Error('发行目标无效');
if (!['stable', 'preview'].includes(description.channel) || document.channel !== description.channel) throw new Error('发行渠道无效');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
// Complete local validation before creating a Release or uploading any bytes.
function assertForward() {
  git('rev-parse', '--verify', 'origin/main');
  const previous = ['stable', 'preview'].map(channel => contract.verifyRelease(JSON.parse(git('show', `origin/main:updates/${channel}.json`)), publicKey, channel));
  contract.assertForward(document, previous);
}
assertForward();
if (Object.keys(description.artifacts || {}).sort().join() !== Object.keys(document.artifacts).sort().join()) throw new Error('发行描述与签名清单的平台不一致');
for (const [platform, artifact] of Object.entries(description.artifacts)) {
  const expected = document.artifacts[platform];
  if (!artifact.file || artifact.build !== expected.build || artifact.version !== expected.version || artifact.url !== expected.url
    || expected.url !== `https://github.com/17hwliao/Zenix/releases/download/${tag}/${path.basename(artifact.file)}`) throw new Error('发行文件、版本或下载地址与签名清单不一致');
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(artifact.file)) { hash.update(chunk); size += chunk.length; }
  if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error('本地安装包与签名清单摘要不一致');
}
let release;
try { release = JSON.parse(gh('api', `repos/17hwliao/Zenix/releases/tags/${tag}`)); }
catch (error) {
  // A timeout/authentication failure is not proof that a Release is absent.
  if (!/\bHTTP 404\b/.test(String(error.stderr || ''))) throw error;
  gh('release', 'create', tag, '--verify-tag', '--title', `Zenix ${tag}`, '--generate-notes', ...(description.channel === 'preview' ? ['--prerelease', '--latest=false'] : []));
  release = JSON.parse(gh('api', `repos/17hwliao/Zenix/releases/tags/${tag}`));
}
if (release.draft || release.prerelease !== (description.channel === 'preview')) throw new Error('Release 的公开状态或预览渠道与更新清单不一致');
const assets = () => JSON.parse(gh('api', `repos/17hwliao/Zenix/releases/tags/${tag}`)).assets;
for (const [platform, artifact] of Object.entries(description.artifacts)) {
  const expected = document.artifacts[platform];
  const name = path.basename(artifact.file);
  let existing = assets().find(asset => asset.name === name);
  if (!existing) { gh('release', 'upload', tag, artifact.file); existing = assets().find(asset => asset.name === name); }
  if (!existing || existing.state !== 'uploaded' || existing.size !== expected.size || existing.digest !== `sha256:${expected.sha256}`) {
    throw new Error(`安装包摘要不一致：${name}；请递增内部构建号`);
  }
}
// Re-read both channels after remote work and during each concurrent-main retry.
assertForward();
gh('release', 'upload', tag, `updates/${description.channel}.json`, '--clobber');

// Retry a concurrent main commit without replacing newer source or feed data.
git('config', 'user.name', 'github-actions[bot]');
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
let published = false;
for (let attempt = 0; attempt < 3; attempt++) {
  git('fetch', 'origin', 'main'); assertForward();
  git('checkout', '-B', 'update-feed', 'origin/main');
  mkdirSync('updates', { recursive: true });
  writeFileSync(`updates/${description.channel}.json`, feedBytes);
  git('add', '--', `updates/${description.channel}.json`);
  if (!git('diff', '--cached', '--name-only').trim()) { published = true; break; }
  git('commit', '-m', `Publish signed ${description.channel} update feed for ${tag}`);
  try { git('push', 'origin', 'HEAD:main'); published = true; break; }
  catch (error) { if (attempt === 2) throw error; }
}
if (!published) throw new Error('更新入口未成功写入 main');
