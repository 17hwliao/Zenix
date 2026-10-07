# 应用更新、发行签名与专用源入口

当前源码版本为 **1.0.0 / Windows build 14 / Android build 14**。公开版本保持 v1.0.0，同版本修补递增内部构建号。iOS 已暂停发行。首版历史记录见 [v1.0.0](releases/v1.0.0.md)。

**Windows r13 及更早版本需要先手动覆盖安装 r14 一次**：旧客户端只比较公开版本号，并要求尚未配置的 Authenticode 发行证书，无法通过同版本更新引导自身升级。无需卸载，安装时保留原目录和用户资料。r14 起可以通过应用内更新获取后续修补版本。

## 使用方式

PC：个人主页的播放器设置 → 选项 → 应用更新。手机：播放器设置 → 应用更新。可选择正式版、预览版，手动检查或启用自动检查。启动约 15 秒后检查，同一设备成功检查后 12 小时内不重复请求；重新回到应用或恢复网络时补查。

默认自动检查，**自动下载默认关闭**。开启后发现新版在后台下载；安装始终需要用户确认。发现更新或下载完成时显示玻璃提醒条，可关闭提醒，之后从设置继续安装。下载进度只在下载/检查期间读取，没有常驻高频后台轮询。失败、超时、取消或校验失败会明确提示，可重新尝试。

- Windows：验证签名清单，优先比较公开版本，同版本再比较内部 build；不接受版本回退。流式下载 NSIS 安装包，校验 SHA256 和大小，安装前再次校验文件。当前明确使用 `signed-manifest` 安装信任策略；配置代码签名发行方后额外强制校验 Authenticode。使用 `--updated` 调用安装器，保留应用数据。开发模式禁止覆盖安装。
- Android：使用独立后台工作线程，保持音乐解析队列可用；核对 SHA256、大小、包名、versionCode、versionName 和签名证书。用户授权“安装未知应用”后由系统确认安装，不会静默安装。
- iOS：检查新版后打开签名清单指定的 TestFlight / App Store 页面。iOS 应用不能自行覆盖安装二进制；自动安装由 Apple 的发行渠道提供。系统控制的自动更新需用户在 TestFlight 或 App Store 设置中开启。

关闭软件或移动系统终止进程会中断当前下载，之后可以重新下载。更新包暂存于应用私有 `updates` 目录，与歌曲缓存分离；不完整下载会清理，PC 在成功获取新版后清理旧安装包，Android 只保留一个安装包。当前不提供断点续传。

## 两种独立的签名

1. **发布清单签名**：RSA 3072 / SHA256，三端使用系统密码库验证。公钥随程序发布，私钥仅保存在开发者签名目录或 GitHub Actions Secrets。下载地址、版本、包大小与 SHA256 都在签名覆盖范围内。
2. **安装包签名**：Windows Authenticode 需要受信任代码签名证书；Android 使用永久发行 keystore；iOS 需要 Apple Distribution 证书、匹配的描述文件和开发者团队。

发布清单签名验证开发者发布的下载地址与安装包哈希，不能赋予 Windows 受信任发布者身份，也不能替代 Apple 安装要求。当前 Windows 可以安装已通过签名清单及哈希校验的未签名安装器，系统仍可能提示未知发布者。任何清单签名或文件校验失败都停止安装；配置 Authenticode 要求后也不会自动回退到清单信任方式。

### 本机 Android 发行密钥

已新建正式密钥，位于仓库外 `%USERPROFILE%\.zenix\signing\zenix-android-release.p12`，配套密码在同目录 `android-signing.properties`。目录仅当前用户和 SYSTEM 可访问。**请备份这两个文件，后续发行必须沿用同一密钥。**

`npm run signing:android` 仅在没有既有密钥时创建，不会覆盖。Gradle 默认读取上述私有配置，也支持以下环境变量覆盖：

`ZENIX_ANDROID_KEYSTORE`、`ZENIX_ANDROID_STORE_PASSWORD`、`ZENIX_ANDROID_KEY_ALIAS`、`ZENIX_ANDROID_KEY_PASSWORD`。

执行 `npm run android:release` 生成 `android/app/build/outputs/apk/release/app-release.apk`。无签名配置时正式构建会失败，Debug 构建仍可以开发使用。

此前发布的 APK 使用 Debug 签名，与本次正式密钥不同，**不能直接覆盖升级**。不要为迁移测试版随意卸载，否则私有歌单和配置会丢失。当前没有统一移动端数据导出功能，首版未提供 Debug 到正式签名的自动迁移；需要保留测试版资料的用户应保留原应用。正式用户后续可正常同签名覆盖更新。

### Windows

`package.json` 的 `zenixBuild` 是随程序打包的 Windows 内部构建号，签名清单中的 Windows build 必须对应此值。每次同版本修补递增，公开 version 保持不变。

`config/distribution.json` 的 `windowsUpdateTrust` 当前为 `signed-manifest`：安装器可以未提供 Authenticode，但必须来自本仓库 Release，且通过现有发布私钥签署的清单、大小和 SHA256 校验。安装仍需要用户确认。

后续获得证书时，设置 `windowsPublisher` 为证书完整 Subject，并将 `windowsUpdateTrust` 设置为 `authenticode`；配置 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 后运行 `npm run package:win:signed`。该命令要求强制代码签名，并在生成后核对安装包的有效签名与发行方。只要配置了发行方，客户端也会强制检查 Authenticode。

当前尚未提供受信任 Windows 证书，不能声称已完成 Authenticode 正式签名。云签名服务需按服务商接入，当前流水线采用 PFX/P12 证书。

### iOS

`.github/workflows/ios-signed.yml` 支持手动按已有 tag 构建 App Store Connect 签名 IPA，凭据齐备后由 macOS runner archive / export。需要设置：

- Secrets：`APPLE_CERTIFICATE_BASE64`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_PROVISIONING_PROFILE_BASE64`。
- Variables：`APPLE_TEAM_ID`。

导出文件需提交 App Store Connect，加入 TestFlight 或 App Store 发行；当前流水线仅产生签名构建工件，没有自动提交审核。在更新清单中加入 **已在该渠道提供的** iOS version/build/url；URL 仅接受 `https://testflight.apple.com/...` 或 `https://apps.apple.com/...`。

当前没有 Apple 发行凭据和 iPhone 真机，iOS 发行已暂停，稳定版不提供 IPA 或模拟器安装包。保留工程和签名流水线，后续恢复发行仍需要上述凭据。详情见 [iOS 打包说明](ios.md#arm64-真机-ipa-封装)。

## 发布更新

公开配置为 `config/distribution.json`。默认更新地址指向本仓库 main 的 `updates/stable.json` / `updates/preview.json`。stable 清单同时包含 Windows / Android 的版本、内部构建号、下载地址、大小和 SHA256；iOS 暂不提供条目，preview 清单暂为空。文件未公开或相应平台没有条目时明确提示未发布。Windows 旧客户端须手动覆盖安装一次 r14，之后才能识别同版本修补。

`npm run signing:init` 创建仓库外 `%USERPROFILE%\.zenix\signing\release-key.pem` 并生成公钥配置。当前公钥已生成，**请备份对应私钥，不要重复生成新的发行身份**。为多个开发环境使用相同私钥；支持 `ZENIX_SIGNING_DIR` 指定目录，签名时支持 `ZENIX_RELEASE_PRIVATE_KEY` 指定私钥文件。

清单描述示例（具体 version/build 和文件路径必须来自实际安装包）：

```json
{
  "channel": "stable",
  "notes": "此版本的更新说明",
  "artifacts": {
    "windows": {
      "version": "1.0.0", "build": 14,
      "url": "https://github.com/17hwliao/Zenix/releases/download/v1.0.0/Zenix-Setup-1.0.0-r14-x64.exe",
      "file": "release/stable-r14/Zenix-Setup-1.0.0-r14-x64.exe"
    },
    "android": {
      "version": "1.0.0", "build": 14,
      "url": "https://github.com/17hwliao/Zenix/releases/download/v1.0.0/Zenix-Android-1.0.0-r14.apk",
      "file": "android/app/build/outputs/apk/release/app-release.apk"
    }
  }
}
```

`npm run release:manifest -- release-description.json` 计算文件大小和 SHA256，签署清单，输出对应 `updates/*.json`。先上传安装包，再提交签名清单到 main；不要把测试包或未上架的 iOS 版本加入正式清单。公开版本在作者与测试人员确认后才递增；稳定修补替换当前 Release 工件并递增 Windows / Android build。Windows 先比较 semver，同版本再比较 build；Android 按 build 比较。预览版使用 preview 通道。

`.github/workflows/signed-release.yml` 实现手动按 tag 构建签名 Windows / Android、生成签名清单、上传 Release 并更新 main 中的通道文件。它没有定时触发。需要以下 Secrets / Variables：

| 类型 | 名称 |
| --- | --- |
| Secrets | `WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD` |
| Variable | `WINDOWS_PUBLISHER`（证书完整 Subject） |
| Secrets | `ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` |
| Secret | `RELEASE_PRIVATE_KEY_BASE64`（本机发布清单私钥的 Base64） |

密钥只通过环境变量和 runner 临时文件使用，不写进仓库或安装包。工作流要求 tag 与 package.json / Android versionName 相符。main 保护规则如禁止 Actions 直接写入更新清单，需要管理员允许该发布流程或将清单提交通过 PR 合入。云工作流的同名上传默认拒绝覆盖。替换当前稳定版使用 `scripts/Publish-Release.mjs --replace-stable`：先上传并核对带修订号的新工件，全部齐备后再删除旧工件；保留同一 Release 地址。

## 三端专用源便捷载入

播放器设置 → 音乐源提供：

- **导入分享源包**：选择收到的 `.zenixsources` 文件，预览列表、确认后依序安装。
- **获取源包**：粘贴 HTTPS 分享链接，直接读取源包内容，预览后批量导入。原生请求不会受网页 CORS 限制，联网分享包上限 4 MiB，本地文件上限 8 MiB。
- **设为我的专用源入口**：把当前分享链接保存在本机，以后点击“载入专用源包”获取最新包。
- 发行方可在公开配置设置 `managedSourcesUrl`，作为未指定个人入口时的默认来源；留空时用户仍可选文件或自行配置链接。私有令牌链接不要提交到公开仓库。

源包不会自动执行或随安装器捆绑。包内脚本先做 SHA256 内容一致性校验，再要求用户确认；这项校验不是作者身份认证，请使用可信分享者的源包。已有同一源更新保留其接入顺序，失败项可单独重试。

本次没有上传源脚本或设置公开默认专用源地址。先前制作的分享包仍可单独转发，或上传到你选择的 HTTPS 文件地址；链接必须直接返回 `.zenixsources` JSON 内容，而不是网盘 HTML 页面。

## 更新功能开发阶段构建记录（2026-10-03，0.3.0 候选）

- PC：TypeScript / Vite 编译及 Windows 目录打包完成；归档中包含更新模块和公开发行配置，没有签名私钥或 `.zenixsources` 脚本快照。当前本地 EXE 的 Authenticode 状态为 `NotSigned`，没有将 electron-builder 的签名步骤日志当作正式签名证据。
- Android：正式 Release APK 构建完成，`apksigner verify` 通过，APK Signature Scheme v2，RSA 3072 密钥。文件 `release/update-client/Zenix-Android-0.3.0-release.apk`，6,401,425 字节，SHA256 `8acd475b59675c015470041680d23162538c3192332c6cf9568d8fb0e08cea5e`。
- iOS：TypeScript / Vite 编译与 Capacitor 工程同步完成。当前 Windows 环境未编译本次新增 Swift 原生代码或执行 Apple 签名。
- 两个签名工作流已解析为有效 YAML；尚未在 GitHub 执行。本轮未上传代码、安装包或更新清单，也未做跨版本真实升级验收。

## 1.0.0 发行基线

首版历史记录见 [首版说明](releases/v1.0.0.md)。当前维护 Windows / Android，内部构建号为 14；iOS 暂停发行。后续修补沿用当前稳定版与发行身份；仅在作者和测试人员确认可发布后递增公开版本。
