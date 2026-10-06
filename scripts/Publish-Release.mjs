import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Publishing is explicit: run only after the user has authorized a GitHub release.
const argumentsList = process.argv.slice(2);
const value = flag => argumentsList[argumentsList.indexOf(flag) + 1];
const tag = value('--tag'), notes = value('--notes'), title = value('--title');
const replaceStable = argumentsList.includes('--replace-stable'), stageAssets = argumentsList.includes('--stage-assets');
if ((replaceStable || stageAssets) && (argumentsList.includes('--draft') || argumentsList.includes('--prerelease'))) throw new Error('Stable replacement cannot be draft or prerelease');
const assets = argumentsList.flatMap((argument, index) => argument === '--asset' ? [argumentsList[index + 1]] : []);
if (!tag || !notes || !title || !assets.length || !/^v[\w.-]+$/.test(tag)) throw new Error('Required: --tag --notes --title and --asset');

async function publish() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const remoteTag = execFileSync('git', ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: 'utf8' }).trim();
  if (!remoteTag && !argumentsList.includes('--draft')) throw new Error('Push the source and tag before publishing release assets');
  if (remoteTag) {
    const refs = remoteTag.split(/\r?\n/).map(line => line.split(/\s+/));
    const taggedCommit = (refs.find(row => row[1].endsWith('^{}')) || refs[0])[0];
    if (!stageAssets && taggedCommit !== commit) throw new Error('Remote tag does not match the current source commit');
  }
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
    return response.status === 204 ? null : response.json();
  }
  // Draft staging may precede the version tag, but its source must already be on GitHub.
  if (!remoteTag || stageAssets) await api(`${base}/git/commits/${commit}`);
  let release = await api(`${base}/releases/tags/${tag}`, {}, true);
  // An unpublished release without a pushed tag may have an untagged placeholder.
  if (!release) {
    const candidates = (await api(`${base}/releases`)).filter(item => item.draft && item.name === title);
    if (candidates.length > 1) throw new Error('More than one matching draft release exists');
    release = candidates[0] || null;
  }
  if (!release) release = await api(`${base}/releases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: title, body, draft: true, prerelease: argumentsList.includes('--prerelease') }) });
  if (replaceStable || stageAssets) {
    if (release.draft || release.prerelease) throw new Error('Replacement requires an existing stable release');
    const names = prepared.map(asset => asset.name);
    if (!names.some(name => /^Zenix-Setup-.*-x64\.exe$/.test(name)) || !names.some(name => /^Zenix-Android-.*\.apk$/.test(name)) || !names.some(name => /^Zenix-iOS-.*\.ipa$/.test(name)) || !names.some(name => /^SHA256SUMS-.*\.txt$/.test(name)) || !names.includes('stable.json')) throw new Error('Stable replacement requires all three platform builds, checksums and signed feed');
  }
  const ready = [];
  for (const asset of prepared) {
    let inventory = await api(`${base}/releases/${release.id}/assets`);
    let existing = inventory.find(item => item.name === asset.name);
    const matches = item => item && item.size === asset.size && item.state === 'uploaded' && item.digest === asset.digest;
    const uploadName = existing && !matches(existing) && (replaceStable || stageAssets) ? `${asset.name}.pending-${asset.digest.slice(7, 19)}` : asset.name;
    if (uploadName !== asset.name) existing = inventory.find(item => item.name === uploadName);
    if (existing) {
      if (!matches(existing)) throw new Error(`Existing asset differs: ${asset.name}`);
      ready.push({ asset, uploaded: existing }); console.log(JSON.stringify({ stage: 'already-uploaded', name: uploadName, size: asset.size })); continue;
    }
    const upload = new URL(release.upload_url.replace(/\{.*$/, ''));
    if (upload.protocol !== 'https:' || upload.hostname !== 'uploads.github.com') throw new Error('Unexpected upload destination');
    upload.searchParams.set('name', uploadName);
    console.log(JSON.stringify({ stage: 'uploading', name: asset.name, size: asset.size }));
    const response = await fetch(upload, { method: 'POST', headers: { ...headers, 'Content-Type': asset.name.endsWith('.apk') ? 'application/vnd.android.package-archive' : asset.name.endsWith('.zip') ? 'application/zip' : (asset.name.endsWith('.exe') || asset.name.endsWith('.ipa')) ? 'application/octet-stream' : asset.name.endsWith('.json') ? 'application/json' : 'text/plain', 'Content-Length': String(asset.size) }, body: fs.createReadStream(asset.file), duplex: 'half', signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error(`Asset upload HTTP ${response.status}: ${asset.name}`);
    const uploaded = await response.json();
    ready.push({ asset, uploaded });
    if (uploaded.size !== asset.size || uploaded.state !== 'uploaded' || uploaded.digest !== asset.digest) throw new Error(`Asset verification failed: ${asset.name}`);
  }
  if (stageAssets) { console.log(JSON.stringify({ stage: 'replacement-staged', url: release.html_url, assets: ready.map(item => ({ name: item.uploaded.name, digest: item.uploaded.digest })) })); return; }
  if (replaceStable) {
    // No old download is removed until all replacement bytes are verified by GitHub.
    for (const { asset, uploaded } of ready) {
      if (uploaded.name === asset.name) continue;
      const collision = (await api(`${base}/releases/${release.id}/assets`)).find(item => item.name === asset.name);
      if (collision) await api(`${base}/releases/assets/${collision.id}`, { method: 'DELETE' });
      await api(`${base}/releases/assets/${uploaded.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: asset.name }) });
    }
    const final = await api(`${base}/releases/${release.id}/assets`);
    if (!prepared.every(asset => final.some(item => item.name === asset.name && item.digest === asset.digest && item.size === asset.size && item.state === 'uploaded'))) throw new Error('Final stable assets incomplete; keeping remaining old downloads');
    const selected = new Set(prepared.map(asset => asset.name));
    for (const obsolete of final.filter(item => !selected.has(item.name) && /^(?:Zenix-Setup-.*-x64\.exe|Zenix-Android-.*\.apk|Zenix-iOS-.*(?:-Simulator\.zip|\.ipa|-packaging\.json)|iOS-Installation\.txt|SHA256SUMS-.*\.txt)$/.test(item.name))) await api(`${base}/releases/assets/${obsolete.id}`, { method: 'DELETE' });
  }
  if (release.draft || replaceStable) await api(`${base}/releases/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: title, body, draft: argumentsList.includes('--draft'), make_latest: argumentsList.includes('--draft') || argumentsList.includes('--prerelease') ? 'false' : 'true' }) });
  release = await api(`${base}/releases/${release.id}`);
  console.log(JSON.stringify({ stage: release.draft ? 'staged' : 'published', url: release.html_url, draft: release.draft, prerelease: release.prerelease, assets: release.assets.map(item => ({ name: item.name, size: item.size, digest: item.digest, url: item.browser_download_url })) }, null, 2));
}
publish().catch(error => { console.error(error.message); process.exitCode = 1; });
