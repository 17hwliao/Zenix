import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// A real arm64 device build for signing preparation. This IPA is not directly installable.
if (process.platform !== 'darwin') throw new Error('iPhone binaries require macOS and Xcode 26+. Use the iOS device workflow from Windows.');
function run(program, args, options = {}) {
  const result = spawnSync(program, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${program} failed (${result.status ?? 'no exit code'})`);
  return result.stdout;
}
const xcode = run('xcodebuild', ['-version'], { encoding: 'utf8', stdio: 'pipe' });
if (Number(xcode.match(/Xcode (\d+)/)?.[1] || 0) < 26) throw new Error('Select Xcode 26+ first.');
if (!existsSync('ios/App/App/public/index.html')) throw new Error('Run npm run ios:sync first.');
const output = path.resolve('release/ios-device');
mkdirSync(output, { recursive: true });
run('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-sdk', 'iphoneos', '-arch', 'arm64', '-archivePath', path.join(output, 'Zenix.xcarchive'), '-derivedDataPath', path.join(output, 'derived'), 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'archive']);
const app = path.join(output, 'Zenix.xcarchive/Products/Applications/App.app');
const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Info.plist')], { encoding: 'utf8', stdio: 'pipe' }));
const architecture = run('lipo', ['-archs', path.join(app, info.CFBundleExecutable)], { encoding: 'utf8', stdio: 'pipe' }).trim();
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!info.CFBundleSupportedPlatforms?.includes('iPhoneOS') || architecture !== 'arm64' || info.CFBundleShortVersionString !== version || info.CFBundleIdentifier !== 'com.zenix.musicplayer' || !/^\d+$/.test(info.CFBundleVersion)) throw new Error('Unexpected device archive metadata.');
const staging = path.join(output, 'package');
const payload = path.join(staging, 'Payload');
mkdirSync(payload, { recursive: true });
// ditto preserves frameworks, symlinks and resources in the app bundle.
run('ditto', [app, path.join(payload, 'App.app')]);
const name = `Zenix-iOS-${version}-r${info.CFBundleVersion}-unsigned.ipa`;
const ipa = path.join(output, name);
run('ditto', ['-c', '-k', '--keepParent', 'Payload', ipa], { cwd: staging });
const hash = createHash('sha256'); let size = 0;
for await (const bytes of createReadStream(ipa)) { hash.update(bytes); size += bytes.length; }
const sha256 = hash.digest('hex');
const metadata = { version, build: Number(info.CFBundleVersion), bundleId: info.CFBundleIdentifier, platform: 'iPhoneOS', architecture, signed: false, directInstall: false, size, sha256, file: name };
writeFileSync(path.join(output, 'packaging.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${sha256}  ${name}\n`);
writeFileSync(path.join(output, 'INSTALLATION.txt'), 'Unsigned ARM64 iPhone IPA, not a simulator package.\nThis package must be signed with a valid Apple identity and provisioning profile before installation.\nIt cannot be installed simply by tapping the downloaded file.\n');
console.log(JSON.stringify(metadata));
