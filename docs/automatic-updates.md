# 应用更新、发行签名与专用源入口

当前源码版本为 **0.3.0 / Android build 4 / iOS build 4**。本次没有自动发布 GitHub Release，也没有为用户替换已安装的测试版本。

## 使用方式

PC：个人主页的播放器设置 → 选项 → 应用更新。手机：播放器设置 → 应用更新。可选择正式版、预览版，手动检查或启用自动检查。启动约 15 秒后检查，同一设备成功检查后 12 小时内不重复请求；重新回到应用或恢复网络时补查。

默认自动检查，**自动下载默认关闭**。开启后发现新版在后台下载；安装始终需要用户确认。发现更新或下载完成时显示玻璃提醒条，可关闭提醒，之后从设置继续安装。下载进度只在下载/检查期间读取，没有常驻高频后台轮询。失败、超时、取消或校验失败会明确提示，可重新尝试。

- Windows：签名清单检查版本，流式下载 NSIS 安装包，校验 SHA256 和大小，安装前再次校验文件，并检查 Authenticode 的有效性及发行方。使用 `--updated` 调用安装器，保留应用数据。开发模式禁止覆盖安装。
- Android：使用独立后台工作线程，保持音乐解析队列可用；核对 SHA256、大小、包名、versionCode、versionName 和签名证书。用户授权“安装未知应用”后由系统确认安装，不会静默安装。
- iOS：检查新版后打开签名清单指定的 TestFlight / App Store 页面。iOS 应用不能自行覆盖安装二进制；自动安装由 Apple 的发行渠道提供。系统控制的自动更新需用户在 TestFlight 或 App Store 设置中开启。

关闭软件或移动系统终止进程会中断当前下载，之后可以重新下载。更新包暂存于应用私有 `updates` 目录，与歌曲缓存分离；不完整下载会清理，PC 在成功获取新版后清理旧安装包，Android 只保留一个安装包。当前不提供断点续传。

## 两种独立的签名

1. **发布清单签名**：RSA 3072 / SHA256，三端使用系统密码库验证。公钥随程序发布，私钥仅保存在开发者签名目录或 GitHub Actions Secrets。下载地址、版本、包大小与 SHA256 都在签名覆盖范围内。
2. **安装包签名**：Windows 需要受信任代码签名证书；Android 使用永久发行 keystore；iOS 需要 Apple Distribution 证书、匹配的描述文件和开发者团队。

发布清单签名不能替代 Windows / Apple 的安装包签名。应用验证失败就停止，不会自动降级使用未验证安装包。

### 本机 Android 发行密钥

已新建正式密钥，位于仓库外 `%USERPROFILE%\.zenix\signing\zenix-android-release.p12`，配套密码在同目录 `android-signing.properties`。目录仅当前用户和 SYSTEM 可访问。**请备份这两个文件，后续发行必须沿用同一密钥。**

`npm run signing:android` 仅在没有既有密钥时创建，不会覆盖。Gradle 默认读取上述私有配置，也支持以下环境变量覆盖：

`ZENIX_ANDROID_KEYSTORE`、`ZENIX_ANDROID_STORE_PASSWORD`、`ZENIX_ANDROID_KEY_ALIAS`、`ZENIX_ANDROID_KEY_PASSWORD`。

执行 `npm run android:release` 生成 `android/app/build/outputs/apk/release/app-release.apk`。无签名配置时正式构建会失败，Debug 构建仍可以开发使用。

此前发布的 APK 使用 Debug 签名，与本次正式密钥不同，**不能直接覆盖升级**。不要为迁移测试版随意卸载，否则私有歌单和配置会丢失。当前没有统一移动端数据导出功能；首次正式发行前需要确定测试版数据迁移办法，或继续提供沿用原 Debug 密钥的测试渠道。正式用户后续可正常同签名覆盖更新。

### Windows

在 `config/distribution.json` 设置 `windowsPublisher` 为证书完整 Subject；配置 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 后运行 `npm run package:win:signed`。该命令要求强制代码签名，并在生成后核对安装包的有效签名与发行方。普通 `package:win` 仍是本地开发打包，不作为有签名的正式发行包。

当前尚未提供受信任 Windows 证书，不能声称已完成 Authenticode 正式签名。云签名服务需按服务商接入，当前流水线采用 PFX/P12 证书。

### iOS

`.github/workflows/ios-signed.yml` 支持手动按已有 tag 构建 App Store Connect 签名 IPA，凭据齐备后由 macOS runner archive / export。需要设置：

- Secrets：`APPLE_CERTIFICATE_BASE64`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_PROVISIONING_PROFILE_BASE64`。
- Variables：`APPLE_TEAM_ID`。

导出文件需提交 App Store Connect，加入 TestFlight 或 App Store 发行；当前流水线仅产生签名构建工件，没有自动提交审核。在更新清单中加入 **已在该渠道提供的** iOS version/build/url；URL 仅接受 `https://testflight.apple.com/...` 或 `https://apps.apple.com/...`。

当前没有 Apple 凭据、macOS 本地编译环境与真机，因此本次仅完成 Web 编译及原生代码集成；新的 Swift 代码和签名流水线需在 macOS 上编译及验收。

## 发布更新

公开配置为 `config/distribution.json`。默认更新地址指向本仓库 main 的 `updates/stable.json` / `updates/preview.json`。本地已生成带有效签名的初始清单，安装包列表暂时为空；该文件尚未公开发布时显示“此通道尚未发布更新清单”，公开初始清单后仍会明确提示相应平台尚未发布更新。正式发布时用实际安装包生成清单。已有旧版没有更新模块，需要先安装一次含本模块的版本，之后才能通过应用更新。

`npm run signing:init` 创建仓库外 `%USERPROFILE%\.zenix\signing\release-key.pem` 并生成公钥配置。当前公钥已生成，**请备份对应私钥，不要重复生成新的发行身份**。为多个开发环境使用相同私钥；支持 `ZENIX_SIGNING_DIR` 指定目录，签名时支持 `ZENIX_RELEASE_PRIVATE_KEY` 指定私钥文件。

清单描述示例（具体 version/build 和文件路径必须来自实际安装包）：

```json
{
  "channel": "stable",
  "notes": "此版本的更新说明",
  "artifacts": {
    "windows": {
      "version": "0.3.0", "build": 4,
      "url": "https://github.com/17hwliao/Zenix/releases/download/v0.3.0/Zenix-Setup-0.3.0-x64.exe",
      "file": "release/Zenix-Setup-0.3.0-x64.exe"
    },
    "android": {
      "version": "0.3.0", "build": 4,
      "url": "https://github.com/17hwliao/Zenix/releases/download/v0.3.0/app-release.apk",
      "file": "android/app/build/outputs/apk/release/app-release.apk"
    }
  }
}
```

`npm run release:manifest -- release-description.json` 计算文件大小和 SHA256，签署清单，输出对应 `updates/*.json`。先上传安装包，再提交签名清单到 main。不要把未签名安装包、测试包或未上架的 iOS 版本加入正式清单。新版本必须递增：Windows 按 semver 比较，Android / iOS 按 build 比较；预览版使用 preview 通道。

`.github/workflows/signed-release.yml` 实现手动按 tag 构建签名 Windows / Android、生成签名清单、上传 Release 并更新 main 中的通道文件。它没有定时触发。需要以下 Secrets / Variables：

| 类型 | 名称 |
| --- | --- |
| Secrets | `WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD` |
| Variable | `WINDOWS_PUBLISHER`（证书完整 Subject） |
| Secrets | `ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` |
| Secret | `RELEASE_PRIVATE_KEY_BASE64`（本机发布清单私钥的 Base64） |

密钥只通过环境变量和 runner 临时文件使用，不写进仓库或安装包。工作流要求 tag 与 package.json / Android versionName 相符。main 保护规则如禁止 Actions 直接写入更新清单，需要管理员允许该发布流程或将清单提交通过 PR 合入。重复上传同名 Release 工件会失败，不覆盖已发行的安装包。

## 三端专用源便捷载入

播放器设置 → 音乐源提供：

- **导入分享源包**：选择收到的 `.zenixsources` 文件，预览列表、确认后依序安装。
- **获取源包**：粘贴 HTTPS 分享链接，直接读取源包内容，预览后批量导入。原生请求不会受网页 CORS 限制，联网分享包上限 4 MiB，本地文件上限 8 MiB。
- **设为我的专用源入口**：把当前分享链接保存在本机，以后点击“载入专用源包”获取最新包。
- 发行方可在公开配置设置 `managedSourcesUrl`，作为未指定个人入口时的默认来源；留空时用户仍可选文件或自行配置链接。私有令牌链接不要提交到公开仓库。

源包不会自动执行或随安装器捆绑。包内脚本先做 SHA256 内容一致性校验，再要求用户确认；这项校验不是作者身份认证，请使用可信分享者的源包。已有同一源更新保留其接入顺序，失败项可单独重试。

本次没有上传源脚本或设置公开默认专用源地址。先前制作的分享包仍可单独转发，或上传到你选择的 HTTPS 文件地址；链接必须直接返回 `.zenixsources` JSON 内容，而不是网盘 HTML 页面。

## 本轮构建记录（2026-10-03）

- PC：TypeScript / Vite 编译及 Windows 目录打包完成；归档中包含更新模块和公开发行配置，没有签名私钥或 `.zenixsources` 脚本快照。当前本地 EXE 的 Authenticode 状态为 `NotSigned`，没有将 electron-builder 的签名步骤日志当作正式签名证据。
- Android：正式 Release APK 构建完成，`apksigner verify` 通过，APK Signature Scheme v2，RSA 3072 密钥。文件 `release/update-client/Zenix-Android-0.3.0-release.apk`，6,401,425 字节，SHA256 `8acd475b59675c015470041680d23162538c3192332c6cf9568d8fb0e08cea5e`。
- iOS：TypeScript / Vite 编译与 Capacitor 工程同步完成。当前 Windows 环境未编译本次新增 Swift 原生代码或执行 Apple 签名。
- 两个签名工作流已解析为有效 YAML；尚未在 GitHub 执行。本轮未上传代码、安装包或更新清单，也未做跨版本真实升级验收。
