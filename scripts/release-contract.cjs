const { verify } = require('node:crypto');

// r34 was publicly issued as a probe. Deleting its Release does not free its identity.
const MIN_NEW_BUILD = 35;
const NATIVE = ['windows', 'android'];
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
const ANDROID_CERTIFICATE = 'b40080130e2186eba857ea2778350b88fe896c33cc9e0116493022e5adb8514a';
function assertArtifact(platform, item) {
  if (!item || !VERSION.test(item.version) || !Number.isSafeInteger(item.build) || item.build < 1) throw Error('发行版本或构建号无效');
  const url = new URL(item.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443') throw Error('发行地址必须使用无凭据的 HTTPS');
  if (NATIVE.includes(platform)) {
    if (url.hostname !== 'github.com' || !url.pathname.startsWith('/17hwliao/Zenix/releases/download/') || !url.pathname.endsWith(platform === 'android' ? '.apk' : '.exe')
      || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 512 * 1024 * 1024) throw Error('安装包信息无效');
  } else if (platform !== 'ios' || !['testflight.apple.com', 'apps.apple.com'].includes(url.hostname)) throw Error('发行平台或 iOS 地址无效');
}
function verifyRelease(envelope, key, channel) {
  if (Buffer.byteLength(JSON.stringify(envelope) || '') > 256 * 1024) throw Error('签名更新清单超过旧客户端的大小限制');
  const payload = Buffer.from(envelope?.payload || '', 'base64');
  if (envelope?.format !== 'zenix-signed-release' || !verify('RSA-SHA256', payload, key, Buffer.from(envelope?.signature || '', 'base64'))) throw Error('既有更新清单签名无效，停止发行');
  const document = JSON.parse(payload.toString('utf8'));
  if (document.schemaVersion !== 1 || document.channel !== channel || !document.artifacts) throw Error('更新清单格式或通道无效');
  for (const [platform, item] of Object.entries(document.artifacts)) assertArtifact(platform, item);
  return document;
}
function sameArtifact(a, b) {
  return !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);
}
function compareVersion(a, b) {
  const parts = value => /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(value);
  const left = parts(a), right = parts(b);
  if (!left || !right) throw Error('发行版本无效');
  for (let i = 1; i <= 3; i++) if (BigInt(left[i]) !== BigInt(right[i])) return BigInt(left[i]) > BigInt(right[i]) ? 1 : -1;
  if (!left[4] || !right[4]) return left[4] === right[4] ? 0 : left[4] ? -1 : 1;
  const x = left[4].split('.'), y = right[4].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x[i]), yn = /^\d+$/.test(y[i]);
    if (xn && yn) { if (BigInt(x[i]) !== BigInt(y[i])) return BigInt(x[i]) > BigInt(y[i]) ? 1 : -1; continue; }
    return xn !== yn ? xn ? -1 : 1 : x[i] > y[i] ? 1 : -1;
  }
  return 0;
}
function assertForward(document, previous) {
  if (document.schemaVersion !== 1 || !['stable', 'preview'].includes(document.channel)) throw Error('更新清单格式或通道无效');
  for (const platform of NATIVE) if (!document.artifacts?.[platform]) throw Error('更新清单必须保留 Windows 和 Android 工件');
  for (const [platform, next] of Object.entries(document.artifacts)) {
    assertArtifact(platform, next);
    const prior = previous.map(feed => feed.artifacts?.[platform]).filter(Boolean);
    const current = previous.find(feed => feed.channel === document.channel)?.artifacts?.[platform];
    // Keeping this channel's exact artifact is valid even when preview is ahead.
    // Changed artifacts must not reuse or fall behind any previously issued build.
    const unchanged = sameArtifact(next, current);
    for (const old of prior) {
      if (!unchanged && next.build < old.build) throw Error('拒绝回退已发行的构建号');
      if (next.build === old.build && !sameArtifact(next, old)) throw Error('同构建号的地址、版本、大小和摘要必须完全一致');
    }
    if (current && compareVersion(next.version, current.version) < 0) throw Error('拒绝回退公开版本，旧 Windows 客户端不会识别这种更新');
    if (!prior.some(old => sameArtifact(next, old)) && next.build < MIN_NEW_BUILD) throw Error(`新发行构建号必须至少为 r${MIN_NEW_BUILD}，已发布身份不能复用`);
  }
}
function assertSource(platform, artifact, application, gradle) {
  if (artifact.version !== application.version || artifact.build !== application.zenixBuild) throw Error(`${platform} 清单版本和构建号必须与当前打包源码一致`);
  if (platform === 'android' && (Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]) !== artifact.build || /versionName\s+"([^"]+)"/.exec(gradle)?.[1] !== artifact.version)) throw Error('Android 清单与原生源码版本不一致');
}
function assertAndroidIdentity(badging, certificates, artifact) {
  const identity = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(badging);
  // SDK 37 labels signing schemes as "V2 Signer:"; earlier SDKs use "Signer #1".
  const signers = new Set([...certificates.matchAll(/^(?:Signer #\d+|V[1-4] Signer(?: #\d+)?):? certificate SHA-256 digest:\s*([a-f0-9:]+)\s*$/gim)].map(match => match[1].replaceAll(':', '').toLowerCase()));
  if (!identity || identity[1] !== 'com.zenix.musicplayer' || Number(identity[2]) !== artifact.build || identity[3] !== artifact.version) throw Error('实际 APK 包名或版本与更新清单不一致');
  if (signers.size !== 1 || !signers.has(ANDROID_CERTIFICATE)) throw Error('实际 APK 未使用原正式发行证书');
}
function assertDistribution(packaged, expected) {
  if (packaged.publicKeySpki !== expected.publicKeySpki || packaged.feeds?.stable !== expected.feeds?.stable || packaged.feeds?.preview !== expected.feeds?.preview) throw Error('安装包内置更新公钥或入口与当前发行配置不一致');
}
function assertWindowsIdentity(application, artifact) {
  if (application.name !== 'zenix-music-player' || application.version !== artifact.version || application.zenixBuild !== artifact.build) throw Error('实际 Windows 安装包身份或版本与更新清单不一致');
}
async function verifyAndroidFile(file, artifact, config) {
  const fs = require('node:fs'), path = require('node:path'), { homedir } = require('node:os');
  const exec = require('node:util').promisify(require('node:child_process').execFile);
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(homedir(), 'AppData', 'Local', 'Android', 'Sdk');
  const tools = path.join(sdk, 'build-tools');
  const folder = fs.readdirSync(tools).sort((a, b) => b.localeCompare(a, 'en', { numeric: true })).map(name => path.join(tools, name)).find(folder => fs.existsSync(path.join(folder, 'lib', 'apksigner.jar')) && fs.existsSync(path.join(folder, process.platform === 'win32' ? 'aapt.exe' : 'aapt')));
  if (!folder) throw Error('需要 Android SDK 的 aapt 和 apksigner 验证实际发行 APK');
  const bundledJava = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Android', 'Android Studio', 'jbr', 'bin', 'java.exe');
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : process.platform === 'win32' && fs.existsSync(bundledJava) ? bundledJava : 'java';
  const options = { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 };
  const { stdout: certificates } = await exec(java, ['-jar', path.join(folder, 'lib', 'apksigner.jar'), 'verify', '--print-certs', path.resolve(file)], options);
  const { stdout: badging } = await exec(path.join(folder, process.platform === 'win32' ? 'aapt.exe' : 'aapt'), ['dump', 'badging', path.resolve(file)], options);
  assertAndroidIdentity(badging, certificates, artifact);
  if (config) {
    const { unzipSync, strFromU8 } = require('fflate');
    const assets = unzipSync(fs.readFileSync(file), { filter: entry => {
      if (entry.name !== 'assets/zenix/distribution.json') return false;
      if (entry.originalSize > 16384) throw Error('实际 APK 内置更新配置超过原生读取限制');
      return true;
    } });
    if (!assets['assets/zenix/distribution.json']) throw Error('实际 APK 缺少内置更新配置');
    assertDistribution(JSON.parse(strFromU8(assets['assets/zenix/distribution.json'])), config);
  }
}
async function verifyWindowsFile(file, artifact, config) {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const exec = require('node:util').promisify(require('node:child_process').execFile);
  const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js'), asar = require('@electron/asar');
  const tool = await getPath7za(), folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-installer-identity-'));
  const archive = path.join(folder, 'app.asar');
  try {
    // Read only the app archive; never execute the installer or change an installed app.
    await exec(tool, ['e', path.resolve(file), 'resources/app.asar', '-y', '-o' + folder], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
    const application = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
    assertWindowsIdentity(application, artifact);
    assertDistribution(JSON.parse(asar.extractFile(archive, 'config/distribution.json').toString('utf8')), config);
  } finally {
    asar.uncache(archive);
    if (path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('zenix-installer-identity-')) throw Error('临时校验目录范围无效，拒绝清理');
    await fs.rm(folder, { recursive: true, force: true });
  }
}
module.exports = { MIN_NEW_BUILD, assertArtifact, verifyRelease, sameArtifact, compareVersion, assertForward, assertSource, assertAndroidIdentity, assertDistribution, assertWindowsIdentity, verifyAndroidFile, verifyWindowsFile };
