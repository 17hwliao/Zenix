# Zenix iOS 适配工程

iOS 沿用手机端 React、旋转个人卡片、玻璃搜索条与歌曲贴纸，不运行 Electron，也不引入 Go。原生部分使用 Swift、AVPlayer 和 JavaScriptCore。

1.0.0 源码新增签名清单检查、TestFlight / App Store 更新入口、分享源包链接载入及签名 archive 工作流。新增原生代码已在 GitHub macOS runner 编译通过；Apple 凭据和发行渠道仍待配置，见 [自动更新与签名说明](automatic-updates.md)。

## 当前状态

1.0.0 / build 8 稳定版下载仅提供 **ARM64 未签名真机 IPA**；模拟器 App 保留为开发用 Actions 工件，完整工程随源码提供。[真机 Release archive 构建](https://github.com/17hwliao/Zenix/actions/runs/37424892056)已通过；IPA 平台为 iPhoneOS，最低系统 iOS 15。下载后必须自行签名侧载，不能直接点击文件安装。尚未执行 Apple 签名或 iPhone 真机验收；下表描述代码接入范围，不表示已通过设备验证。

| 模块 | 接入范围 |
| --- | --- |
| 共享视觉 | 个人金卡、连续环绕旋转、搜索结果贴纸、二维拖动、聚焦和歌曲展开；iPhone/iPad 安全区及输入框字号处理 |
| 原生播放 | AVPlayer、音频会话、后台音频模式、队列、上一首/下一首、随机/循环、拖动进度 |
| 系统控制 | 锁屏及控制中心的歌曲信息、封面、播放/暂停、切歌和进度；音频中断、耳机断开暂停 |
| 音乐源 | HTTPS 导入或系统文件选择器导入，查看摘要后确认；Zenix v1 源包及兼容脚本、目录选项、启停、更新、移除 |
| 顺序回退 | 按安装顺序调用，每个源先尝试首选音质再降级；解析失败、播放器报错或准备超时后继续尝试；跨目录要求歌名和歌手匹配 |
| 缓存 | URLSession 流式传输 AVPlayer 请求的音频区段，边播边写磁盘；完整文件才能命中持久缓存；128–2048 MiB 的预算和最近使用淘汰 |
| 本地资料 | 原子保存喜欢、收藏、最多 300 首去重历史、自定义歌单、名片、源配置及队列；启动恢复队列但不自动播放 |
| 本地歌曲 | 文件选择器复制到应用私有目录作为备用，读取内嵌标题、歌手、时长和封面；同名 `.lrc` 可一并选入 |
| 背景 | 文件选择器选择照片或视频，复制至私有目录；欢迎页可跳过；设置内替换、恢复默认 |
| 应用内歌词 | 共用歌词解析器、触摸浏览、点击跳转、3 秒回到当前句、字号与颜色；取得的在线歌词最多缓存 100 份 |

### 平台差异

- iOS 没有 Android 的任意跨应用悬浮窗权限入口。当前提供应用内歌词和系统播放控制，隐藏 Android 悬浮歌词开关；没有伪装悬浮窗或以视频画中画绕过系统限制。
- 音乐源使用独立 JavaScriptCore VM，不暴露用户资料和文件访问。提供受限 HTTP、Buffer、加密、压缩和定时器接口；不提供 DOM、Node.js 模块或完整浏览器 API。异步调用有超时，但用户脚本仍属于可信代码，不把 JS VM 当作操作系统安全隔离。
- 首版缓存面向普通渐进式音频文件。HLS 播放列表当前会触发后续源回退，不提供 HLS 分片离线缓存。未完整覆盖的区段文件在播放结束/下次启动时清理，不显示为可离线歌曲。
- 单个背景最大 256 MiB；单个本地音频最大 512 MiB；单个歌词文件最大 512 KiB；源脚本最大 1 MiB。缓存单曲上限为预算与 256 MiB 中的较小值，超过仍可在线播放。
- 首版本地导入按文件名标识，重复选择同名文件会替换；源、背景、本地歌曲与个人资料在重新安装或删除应用后不保证保留。缓存目录可被系统清理。尚未接入跨设备同步或配置导出。
- 开发工程允许用户配置的旧媒体地址使用 HTTP，原生层检查公共域名并限制源包声明的域名；HTTPS 源导入仍为必需。提交 App Store 前需要处理 ATS 例外说明以及真实源和脚本兼容性审核。没有包含源脚本或个人数据。

## 分层

| 文件 | 职责 |
| --- | --- |
| `src/mobile/` | Android/iOS 共用触控界面和歌词 |
| `src/mobile/native.ts` | 原生命令、状态更新与能力差异 |
| `ios/App/App/ZenixViewController.swift` | 注册桥接插件、暗色 WebView、安全区处理 |
| `ZenixNativePlugin.swift` | 命令、状态通知、系统文件选择和许可入口 |
| `ZenixPlayback.swift` | AVPlayer、音频会话、队列、系统媒体控制 |
| `ZenixAudioCache.swift` | AVAssetResourceLoader 区段传输、完整文件库存与磁盘预算 |
| `ZenixSources.swift` | 导入预览、安装顺序、目录、歌词与品质回退 |
| `ZenixScript.swift` / `ZenixNetwork.swift` / `ZenixCrypto.swift` | 脚本运行、URLSession、CommonCrypto/Security/zlib 适配 |
| `ZenixStore.swift` | Application Support 私有资料原子保存 |

进度通知只传播放时间等变化字段，后台不反复向 WebView 发送完整歌单。最多保留一个目录 VM 和一个当前源 VM；音频传输直接写文件，不将整首歌曲保存在内存。

`scripts/Prepare-iOS.mjs` 从本项目现有目录实现和 Android 便携源宿主生成 iOS 资源，并收集开源许可。Swift 原生层为本项目新增实现。相关参考与许可证沿用 [第三方说明](../THIRD_PARTY_NOTICES.md)，没有复制参考项目的 Git 历史。

## 本地预览与同步（Windows/macOS）

需要 Node.js 22 或更新版本。

```sh
npm ci
npm run ios:dev
# http://127.0.0.1:5176/index.ios.html，只预览界面

npm run ios:sync
# 生成网页、目录宿主、许可资源及 Capacitor 配置
```

开发入口由 `ZENIX_PLATFORM=ios` 选择 `dist-ios`；Android 仍使用 `dist-android`。生成的网页、源宿主与许可副本不提交 Git，干净检出后需要运行同步命令。

## Mac 上原生构建

工程使用 Capacitor 8.5.2 和 Swift Package Manager，最低部署版本 iOS 15。需要 macOS 和 Xcode 26 或更新版本，见 [Capacitor 环境说明](https://capacitorjs.com/docs/getting-started/environment-setup)。

```sh
npm ci
npm run ios:sync
npm run ios:simulator
# 仅生成未签名模拟器 App，不能安装到 iPhone

npm run ios:open
# 打开 ios/App/App.xcodeproj
```

真机运行时，在 Xcode 的 App target → Signing & Capabilities 中选择自己的 Apple Developer Team、合适的 Bundle Identifier 和 iPhone。证书、描述文件、Team 私密资料均不存入仓库。未签名真机 Archive 和 IPA 封装已完成；Apple 发行签名、TestFlight 和 App Store 上传尚未执行。

提供可手动触发的 `.github/workflows/ios-build.yml`，仅编译和保存未签名模拟器 App，不自动推送代码、打 tag、发布 Release 或上传 TestFlight。已完成首轮云端构建；所选 runner 必须具有 Xcode 26+。

实际音源、后台续播、断网缓存、锁屏控制、键盘与设备内存表现需要在 Mac/设备上继续验收。浏览器预览不能证明这些系统能力有效。

## 模拟器包安装

模拟器包不再列入稳定版下载。开发者可从 `.github/workflows/ios-build.yml` 对应 Actions 工件取得 App.app，或在 Mac 执行 `npm run ios:sync`、`npm run ios:simulator`。打开 Xcode 的 Simulator 并启动 iOS 15 或更新的设备，然后执行：

```sh
xcrun simctl install booted /absolute/path/App.app
xcrun simctl launch booted com.zenix.musicplayer
```

完整源码可从同页 Source code 或 Git 仓库取得；工程入口为 ios/App/App.xcodeproj，先运行 npm ci 与 npm run ios:sync。此包没有 Apple 真机签名，不是 IPA。内存策略见 [移动端资源策略](mobile-performance.md)。

## ARM64 真机 IPA 封装

没有 Apple 开发者发行凭据时，可先生成 **未签名真机 IPA**，之后由使用者以自己的有效 Apple 身份和描述文件签名侧载。这个文件不能通过点击下载文件直接安装；不是已经发行签名的安装器，也没有完成 iPhone 真机验收。

已发布的 [Zenix-iOS-1.0.0-r8-unsigned.ipa](https://github.com/17hwliao/Zenix/releases/download/v1.0.0/Zenix-iOS-1.0.0-r8-unsigned.ipa) 为 894,257 字节，SHA256：`921626f63feb76631f98594ccffde1ed99f2a08a6beadfed9649a866c331e3a1`。安装要求在 Release 正文与本文中说明；封装元数据仅保留在构建工件中。此 IPA 与模拟器 ZIP 分开构建，核对了包内 Info.plist、Mach-O 的 ARM64 CPU 和 iOS 平台标识。

```sh
npm ci
npm run ios:sync
npm run ios:device
# macOS + Xcode 26+；输出 release/ios-device/Zenix-iOS-1.0.0-r8-unsigned.ipa
```

流程为 iPhoneOS SDK / arm64 / Release archive → 核对平台、版本、架构和包标识 → Payload/App.app 封装 → SHA256。输出 packaging.json 明确标识 signed=false、directInstall=false。设备能力声明为 arm64，最低系统 iOS 15。

Windows 可手动触发 `.github/workflows/ios-device-build.yml`，从 macOS 云端取得上述 IPA、SHA256 与安装说明。该任务不读取 Apple 私钥，不自行发布 Release 或递增公开版本。后续若取得发行凭据，仍可使用签名 archive 流程导出 TestFlight / App Store 包。

签名侧载工具负责生成或使用匹配的个人描述文件，并签署 App 与嵌入框架；签名有效期及可安装设备范围由所用 Apple 身份和描述文件决定。不要将 Apple 账号密码、私钥或描述文件写入公开仓库。使用者修改包标识后，生成的描述文件必须与最终标识匹配。
