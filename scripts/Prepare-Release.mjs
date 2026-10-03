import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const tag = process.env.RELEASE_TAG;
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
if (tag !== `v${version}`) throw new Error('发行 tag 必须为 v + package.json 版本；预览版请使用相应 prerelease 版本号');
const windows = readdirSync('release-assets/signed-windows').filter(file => file.endsWith('.exe'));
if (windows.length !== 1) throw new Error('应只有一个 Windows 安装包');
const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const build = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);
const androidVersion = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
if (!build || androidVersion !== version) throw new Error('Android 版本必须与发行版本一致');
const base = `https://github.com/17hwliao/Zenix/releases/download/${tag}/`;
writeFileSync('release-assets/description.json', JSON.stringify({ channel: process.env.RELEASE_CHANNEL, notes: `Zenix ${version}`, artifacts: {
  windows: { version, build, url: base + windows[0], file: `release-assets/signed-windows/${windows[0]}` },
  android: { version, build, url: base + 'app-release.apk', file: 'release-assets/signed-android/app-release.apk' },
} }, null, 2));
