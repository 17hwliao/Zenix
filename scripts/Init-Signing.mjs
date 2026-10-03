import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
const directory = process.env.ZENIX_SIGNING_DIR || path.join(homedir(), '.zenix', 'signing');
mkdirSync(directory, { recursive: true });
const file = path.join(directory, 'release-key.pem');
if (!existsSync(file)) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
}
const key = createPublicKey(readFileSync(file));
const target = new URL('../config/distribution.json', import.meta.url);
mkdirSync(new URL('../config/', import.meta.url), { recursive: true });
const old = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
const spki = key.export({ type: 'spki', format: 'der' }).toString('base64');
if (old.publicKeySpki && old.publicKeySpki !== spki) throw new Error('当前私钥与已发布公钥不一致，停止覆盖。');
writeFileSync(target, JSON.stringify({
  schemaVersion: 1, repository: '17hwliao/Zenix',
  feeds: { stable: 'https://raw.githubusercontent.com/17hwliao/Zenix/main/updates/stable.json', preview: 'https://raw.githubusercontent.com/17hwliao/Zenix/main/updates/preview.json' },
  managedSourcesUrl: '', iosDistributionUrl: '', ...old,
  publicKeySpki: spki, publicKeyPkcs1: key.export({ type: 'pkcs1', format: 'der' }).toString('base64'),
}, null, 2) + '\n');
console.log('发布清单签名已配置。私钥保存在仓库外：' + file);
