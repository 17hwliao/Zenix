import { readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
const tag = process.env.RELEASE_TAG;
const { version, zenixBuild } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!Number.isSafeInteger(zenixBuild) || zenixBuild < 1) throw new Error('Windows 内部构建号无效');
if (tag !== `v${version}`) throw new Error('发行 tag 必须为 v + package.json 版本；预览版请使用相应 prerelease 版本号');
const windows = readdirSync('release-assets/signed-windows').filter(file => file.endsWith('.exe'));
if (windows.length !== 1) throw new Error('应只有一个 Windows 安装包');
const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const build = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);
const androidVersion = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
if (!build || build !== zenixBuild || androidVersion !== version) throw new Error('Android 版本和内部构建号必须与发行版本一致');
const windowsName = `Zenix-Setup-${version}-r${zenixBuild}-x64.exe`;
const androidName = `Zenix-Android-${version}-r${build}.apk`;
if (windows[0] !== windowsName) renameSync(`release-assets/signed-windows/${windows[0]}`, `release-assets/signed-windows/${windowsName}`);
renameSync('release-assets/signed-android/app-release.apk', `release-assets/signed-android/${androidName}`);
const base = `https://github.com/17hwliao/Zenix/releases/download/${tag}/`;
writeFileSync('release-assets/description.json', JSON.stringify({ channel: process.env.RELEASE_CHANNEL, notes: `Zenix ${version}`, artifacts: {
  windows: { version, build: zenixBuild, url: base + windowsName, file: `release-assets/signed-windows/${windowsName}` },
  android: { version, build, url: base + androidName, file: `release-assets/signed-android/${androidName}` },
} }, null, 2));
