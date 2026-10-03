import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import config from '../config/distribution.json' with { type: 'json' };
if (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD || !config.windowsPublisher) throw new Error('正式 Windows 安装包需要 CSC_LINK、CSC_KEY_PASSWORD 和 config/distribution.json 的 windowsPublisher（完整证书 Subject）。');
for (const args of [['run', 'build'], ['exec', '--', 'electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', '-c.forceCodeSigning=true']]) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const name = `Zenix-Setup-${version}-x64.exe`;
if (!readdirSync('release').includes(name)) throw new Error('未找到当前版本的 Windows 安装包');
const literal = value => "'" + value.replace(/'/g, "''") + "'";
const script = `$s=Get-AuthenticodeSignature -LiteralPath ${literal(path.resolve('release', name))}; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -ne ${literal(config.windowsPublisher)}) { throw 'Installer signature does not match configured publisher' }`;
const check = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'inherit', windowsHide: true });
if (check.status !== 0) process.exit(check.status || 1);
