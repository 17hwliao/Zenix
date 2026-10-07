import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Installers are immutable. A retry accepts only an already uploaded identical file.
const description = JSON.parse(readFileSync('release-assets/description.json', 'utf8'));
const feed = JSON.parse(readFileSync(`updates/${description.channel}.json`, 'utf8'));
const document = JSON.parse(Buffer.from(feed.payload, 'base64').toString('utf8'));
const tag = process.env.RELEASE_TAG;
if (!tag || process.env.GITHUB_REPOSITORY !== '17hwliao/Zenix') throw new Error('发行目标无效');
if (!['stable', 'preview'].includes(description.channel) || document.channel !== description.channel) throw new Error('发行渠道无效');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
let release;
try { release = JSON.parse(gh('api', `repos/17hwliao/Zenix/releases/tags/${tag}`)); }
catch {
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
// Reject a delayed job that would roll a channel back to an older build.
function assertForward() {
  git('rev-parse', '--verify', 'origin/main');
  const file = `updates/${description.channel}.json`;
  if (!git('ls-tree', '--name-only', 'origin/main', '--', file).trim()) return;
  const previous = JSON.parse(git('show', `origin/main:${file}`));
  if (!previous?.payload) throw new Error('已有更新清单损坏，拒绝覆盖');
  const old = JSON.parse(Buffer.from(previous.payload, 'base64').toString('utf8'));
  for (const [platform, next] of Object.entries(document.artifacts)) {
    const prior = old.artifacts?.[platform];
    if (prior && (next.build < prior.build || next.build === prior.build && next.sha256 !== prior.sha256)) throw new Error('拒绝旧构建或同构建不同安装包替换更新入口');
  }
}
assertForward();
gh('release', 'upload', tag, `updates/${description.channel}.json`, '--clobber');

// Retry a concurrent main commit without replacing newer source or feed data.
const feedBytes = readFileSync(`updates/${description.channel}.json`);
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
