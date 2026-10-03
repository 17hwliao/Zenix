import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
if (process.platform !== 'darwin') {
  console.error('Native iOS builds require macOS with Xcode 26+. On Windows use npm run ios:dev or npm run ios:sync.');
  process.exit(1);
}
const run = (program, args) => { const result = spawnSync(program, args, { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status ?? 1); };
const version = spawnSync('xcodebuild', ['-version'], { encoding: 'utf8' });
if (version.status !== 0 || Number(version.stdout.match(/Xcode (\d+)/)?.[1] || 0) < 26) {
  console.error('Select Xcode 26+ using xcode-select before building.'); process.exit(1);
}
if (!existsSync('ios/App/App/public/index.html')) { console.error('Run npm run ios:sync first.'); process.exit(1); }
run('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'release/ios-derived', 'CODE_SIGNING_ALLOWED=NO', 'build']);
console.log('Simulator app: release/ios-derived/Build/Products/Release-iphonesimulator/App.app (not an iPhone installable IPA).');
