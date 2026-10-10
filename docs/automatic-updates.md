# 应用更新、发行签名与专用源入口

当前 v1.0.0 安装入口为 **Android build 33 / Windows build 28**。首次正式升级验收基线 r27 和 r28 的历史证据保留；本次收拢不新增测试。公开版本与内部构建号分别管理，同版本修补继续递增内部构建号。iOS 已暂停发行。发行记录见 [v1.0.0](releases/v1.0.0.md)。

内部构建 34 曾公开为验收探针；清理发行后也不能复用。后续新构建从 35 或更高继续，避免已安装验收版本的客户端无法识别更新。

两端内置更新通道独立于用户音乐源网络权限，限定 GitHub HTTPS 域名与 443 端口，逐跳核验重定向，保留默认 TLS 证书与主机名验证，支持正常系统路由（含 Fake-IP）。清单签名、安装包大小、SHA256、包名、构建号及原发行证书核验继续执行。Android 为不同构建和文件摘要使用独立安装包地址，避免系统安装器复用旧输入；Windows 使用独立 Chromium 会话并显示真实安装器。

**此前测试客户端不承诺均可应用内直升。** 旧版若被已有下载缺陷阻断，可从当前 Release 下载同签名当前包覆盖安装，保留原目录及资料；无需卸载或清空数据。旧 APK 中的代码不能靠服务端清单替换。Android / Windows r27→r28 的实际升级及资料保留证据见 [全量审查记录](review-first-stable.md)，不据此声称 r33 新增完整真机升级验收。

2026-10-10 维护者明确选择彻底删除历史安装包并接受历史下载链接失效。旧缓存清单的下载会失效，应重新检查更新获取现行签名清单。正式与预览通道统一指向当前安装包，发行公钥、APK 密钥、包名、TLS、文件及版本核验保留。此清理例外不授权后续发行继续删除已发布地址。

## 使用方式

PC：个人主页的播放器设置 → 选项 → 应用更新。手机：播放器设置 → 应用更新。可选择正式版、预览版，手动检查或启用自动检查。启动约 15 秒后检查，同一设备成功检查后 12 小时内不重复请求；重新回到应用或恢复网络时补查。

默认自动检查，**自动下载默认关闭**。开启后发现新版在后台下载；安装始终需要用户确认。首次发现某个公开版本时显示玻璃更新弹窗，展示签名清单中的更新亮点；关闭或选择“暂不更新”后，在本机持久保存该版本的关闭记录，不再显示弹窗或常驻浮条。重启、下载完成及同一公开版本的内部构建修补不会重新提醒；例如关闭 v1.1 后，直到 v1.2 才再次弹窗。正式版与预览版独立记录。用户仍可在设置中手动检查、下载和安装已关闭提醒的版本，关闭提醒不会取消已经开始的后台下载。

下载进度只在下载/检查期间读取，没有常驻高频后台轮询。失败、超时、取消或校验失败会明确提示，可重新尝试。发行时应在签名更新清单的 `notes` 中填写真实的新功能、改进和修复；未提供说明的版本只显示说明缺失提示，不自动编造亮点。

- Windows：验证签名清单，优先比较公开版本，同版本再比较内部 build；不接受版本回退。流式下载 NSIS 安装包，校验 SHA256 和大小，安装前再次校验文件。当前明确使用 `signed-manifest` 安装信任策略；配置代码签名发行方后额外强制校验 Authenticode。使用 `--updated` 调用安装器，保留应用数据。开发模式禁止覆盖安装。
- Android：使用独立后台工作线程，保持音乐解析队列可用；核对 SHA256、大小、包名、versionCode、versionName 和签名证书。用户授权“安装未知应用”后由系统确认安装，不会静默安装。
- iOS：检查新版后打开签名清单指定的 TestFlight / App Store 页面。iOS 应用不能自行覆盖安装二进制；自动安装由 Apple 的发行渠道提供。系统控制的自动更新需用户在 TestFlight 或 App Store 设置中开启。

关闭软件或移动系统终止进程会中断当前下载，之后可以重新下载。更新包暂存于应用私有 `updates` 目录，与歌曲缓存分离；不完整下载会清理。Android 按构建号和完整 SHA256 区分安装器输入，保留已经交给系统安装器的文件，避免复用旧包。当前不提供断点续传。

## 两种独立的签名

1. **发布清单签名**：RSA 3072 / SHA256，三端使用系统密码库验证。公钥随程序发布，私钥仅保存在开发者签名目录或 GitHub Actions Secrets。下载地址、版本、包大小与 SHA256 都在签名覆盖范围内。
2. **安装包签名**：Windows Authenticode 需要受信任代码签名证书；Android 使用永久发行 keystore；iOS 需要 Apple Distribution 证书、匹配的描述文件和开发者团队。

发布清单签名验证开发者发布的下载地址与安装包哈希，不能赋予 Windows 受信任发布者身份，也不能替代 Apple 安装要求。当前 Windows 可以安装已通过签名清单及哈希校验的未签名安装器，系统仍可能提示未知发布者。任何清单签名或文件校验失败都停止安装；配置 Authenticode 要求后也不会自动回退到清单信任方式。

### 本机 Android 发行密钥

既有正式密钥位于仓库外 `%USERPROFILE%\.zenix\signing\zenix-android-release.p12`，配套密码在同目录 `android-signing.properties`。目录仅当前用户和 SYSTEM 可访问。**请备份这两个文件，后续发行必须沿用同一密钥。**

`npm run signing:android` 仅在没有既有密钥时创建，不会覆盖。Gradle 默认读取上述私有配置，也支持以下环境变量覆盖：

`ZENIX_ANDROID_KEYSTORE`、`ZENIX_ANDROID_STORE_PASSWORD`、`ZENIX_ANDROID_KEY_ALIAS`、`ZENIX_ANDROID_KEY_PASSWORD`。

执行 `npm run android:release` 生成 `android/app/build/outputs/apk/release/app-release.apk`。无签名配置时正式构建会失败，Debug 构建仍可以开发使用。

只有与正式密钥不同的 Debug 测试安装无法直接覆盖升级；使用既有正式签名的测试版可覆盖迁移，并须保留资料。不要为迁移随意卸载，否则私有歌单和配置会丢失。当前没有 Debug 到正式签名的自动迁移。正式用户后续使用同签名递增构建更新。

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

公开配置为 `config/distribution.json`。默认更新地址指向本仓库 main 的 `updates/stable.json` / `updates/preview.json`。stable 与 preview 清单均提供 Windows / Android 的版本、内部构建号、下载地址、大小和 SHA256；iOS 暂不提供条目。文件未公开或相应平台没有条目时明确提示未发布。旧测试客户端是否能直接更新取决于其已有更新代码，不能用曾经的 r14 修补代替本次真实验收。

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

`npm run release:manifest -- release-description.json` 计算文件大小和 SHA256，签署清单，输出对应 `updates/*.json`。先上传并核对新文件，再提交签名清单到 main；不要把未验收候选或未上架的 iOS 版本加入正式清单。公开版本按约定维护；稳定修补递增 Windows / Android build，使用新的安装包文件名，保留已有工件与下载地址。Windows 先比较 semver，同版本再比较 build；Android 按 build 比较。预览版使用 preview 通道。

`.github/workflows/signed-release.yml` 实现手动按 tag 构建签名 Windows / Android、生成签名清单、上传 Release 并更新 main 中的通道文件。它没有定时触发。需要以下 Secrets / Variables：

| 类型 | 名称 |
| --- | --- |
| Secrets | `WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD` |
| Variable | `WINDOWS_PUBLISHER`（证书完整 Subject） |
| Secrets | `ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` |
| Secret | `RELEASE_PRIVATE_KEY_BASE64`（本机发布清单私钥的 Base64） |

密钥只通过环境变量和 runner 临时文件使用，不写进仓库或安装包。工作流要求 tag 与 package.json / Android versionName 相符。main 保护规则如禁止 Actions 直接写入更新清单，需要管理员允许该发布流程或将清单提交通过 PR 合入。云工作流的同名上传默认拒绝覆盖。替换当前稳定版使用 `scripts/Publish-Release.mjs --replace-stable --retire-ios`：先上传并核对带修订号的新工件，通过真实升级验收后切换清单指针与发行说明；旧安装包、校验文件及下载地址全部保留。

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

首版历史记录见 [首版说明](releases/v1.0.0.md)。当前维护 Windows / Android，内部构建号为 28，第一正式基线为 27；iOS 暂停发行。后续修补沿用当前稳定版与发行身份；仅在作者和测试人员确认可发布后递增公开版本。
