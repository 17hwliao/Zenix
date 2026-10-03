import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Publishing is explicit: run only after the user has authorized a GitHub release.
const argumentsList = process.argv.slice(2);
const value = flag => argumentsList[argumentsList.indexOf(flag) + 1];
const tag = value('--tag'), notes = value('--notes'), title = value('--title');
const assets = argumentsList.flatMap((argument, index) => argument === '--asset' ? [argumentsList[index + 1]] : []);
if (!tag || !notes || !title || !assets.length || !/^v[\w.-]+$/.test(tag)) throw new Error('Required: --tag --notes --title and --asset');

async function publish() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const remoteTag = execFileSync('git', ['ls-remote', 'origin', `refs/tags/${tag}`], { encoding: 'utf8' }).trim();
  if (!remoteTag) throw new Error('Push the source and tag before uploading release assets');
  const body = await fsp.readFile(notes, 'utf8');
  const prepared = [];
  for (const file of assets) {
    const size = (await fsp.stat(file)).size, hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    prepared.push({ file, name: path.basename(file), size, digest: `sha256:${hash.digest('hex')}` });
  }
  let raw;
  try { raw = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { throw new Error('GitHub credential unavailable'); }
  const credential = Object.fromEntries(raw.trim().split(/\r?\n/).map(line => { const separator = line.indexOf('='); return [line.slice(0, separator), line.slice(separator + 1)]; }));
  if (!credential.password) throw new Error('GitHub credential unavailable');
  const headers = { Authorization: `Bearer ${credential.password}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Zenix-Release-Publisher' };
  const base = 'https://api.github.com/repos/17hwliao/Zenix';
  async function api(url, options = {}, missing = false) {
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(60000) });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    return response.json();
  }
  let release = await api(`${base}/releases/tags/${tag}`, {}, true);
  if (!release) release = await api(`${base}/releases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: title, body, draft: true, prerelease: argumentsList.includes('--prerelease') }) });
  for (const asset of prepared) {
    const existing = (await api(`${base}/releases/${release.id}/assets`)).find(item => item.name === asset.name);
    if (existing) {
      if (existing.size !== asset.size || existing.state !== 'uploaded' || (existing.digest && existing.digest !== asset.digest)) throw new Error(`Existing asset differs: ${asset.name}`);
      console.log(JSON.stringify({ stage: 'already-uploaded', name: asset.name, size: asset.size })); continue;
    }
    const upload = new URL(release.upload_url.replace(/\{.*$/, ''));
    if (upload.protocol !== 'https:' || upload.hostname !== 'uploads.github.com') throw new Error('Unexpected upload destination');
    upload.searchParams.set('name', asset.name);
    console.log(JSON.stringify({ stage: 'uploading', name: asset.name, size: asset.size }));
    const response = await fetch(upload, { method: 'POST', headers: { ...headers, 'Content-Type': asset.name.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'text/plain', 'Content-Length': String(asset.size) }, body: fs.createReadStream(asset.file), duplex: 'half', signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error(`Asset upload HTTP ${response.status}: ${asset.name}`);
    const uploaded = await response.json();
    if (uploaded.size !== asset.size || uploaded.state !== 'uploaded' || (uploaded.digest && uploaded.digest !== asset.digest)) throw new Error(`Asset verification failed: ${asset.name}`);
  }
  if (release.draft) await api(`${base}/releases/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: title, body, draft: argumentsList.includes('--draft'), make_latest: argumentsList.includes('--draft') || argumentsList.includes('--prerelease') ? 'false' : 'true' }) });
  release = await api(`${base}/releases/tags/${tag}`);
  console.log(JSON.stringify({ stage: release.draft ? 'staged' : 'published', url: release.html_url, draft: release.draft, prerelease: release.prerelease, assets: release.assets.map(item => ({ name: item.name, size: item.size, digest: item.digest, url: item.browser_download_url })) }, null, 2));
}
publish().catch(error => { console.error(error.message); process.exitCode = 1; });
