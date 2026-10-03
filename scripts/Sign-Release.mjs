import { readFileSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs';
import { sign, verify, createPublicKey, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
// Input is a release description, not the app's personal/source configuration.
const input = process.argv[2];
if (!input) throw new Error('用法：node scripts/Sign-Release.mjs release-description.json');
const description = JSON.parse(readFileSync(input, 'utf8'));
if (!['stable', 'preview'].includes(description.channel)) throw new Error('channel 必须为 stable 或 preview');
const config = JSON.parse(readFileSync(new URL('../config/distribution.json', import.meta.url), 'utf8'));
const key = readFileSync(process.env.ZENIX_RELEASE_PRIVATE_KEY || path.join(homedir(), '.zenix/signing/release-key.pem'));
const publicKey = createPublicKey(key);
if (publicKey.export({ type: 'spki', format: 'der' }).toString('base64') !== config.publicKeySpki) throw new Error('签名私钥不匹配');
const artifacts = {};
for (const [platform, artifact] of Object.entries(description.artifacts || {})) {
  if (!['windows', 'android', 'ios'].includes(platform)) throw new Error('不支持的平台');
  if (typeof artifact.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(artifact.version) || !Number.isSafeInteger(artifact.build) || artifact.build < 1) throw new Error('每个平台必须包含有效的 version 和递增的 build');
  const copy = { ...artifact }; delete copy.file;
  if (platform !== 'ios') {
    if (!artifact.file) throw new Error('安装包必须包含 file');
    const url = new URL(artifact.url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/17hwliao/Zenix/releases/download/')) throw new Error('安装包必须位于本项目 GitHub Release');
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of createReadStream(artifact.file)) { hash.update(chunk); size += chunk.length; }
    copy.sha256 = hash.digest('hex'); copy.size = size;
  } else {
    const url = new URL(artifact.url);
    if (url.protocol !== 'https:' || !['testflight.apple.com', 'apps.apple.com'].includes(url.hostname) || url.username || url.password) throw new Error('iOS 更新必须指向 TestFlight 或 App Store');
  }
  artifacts[platform] = copy;
}
const document = { schemaVersion: 1, channel: description.channel, issuedAt: new Date().toISOString(), notes: description.notes || '', artifacts };
const bytes = Buffer.from(JSON.stringify(document));
const signature = sign('RSA-SHA256', bytes, key);
if (!verify('RSA-SHA256', bytes, publicKey, signature)) throw new Error('签名生成失败');
const folder = new URL('../updates/', import.meta.url); mkdirSync(folder, { recursive: true });
writeFileSync(new URL(description.channel + '.json', folder), JSON.stringify({ format: 'zenix-signed-release', payload: bytes.toString('base64'), signature: signature.toString('base64') }, null, 2) + '\n');
console.log('已生成签名更新清单：updates/' + description.channel + '.json');
