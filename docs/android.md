# Zenix Android

Android 版复用 Zenix 的 React、玻璃贴纸与个人名片视觉，由 Java 原生服务负责音频播放。没有引入 Go，也没有在 APK 内运行 Electron。

1.0.0 源码加入签名更新检查、APK 下载和系统确认安装，分享源包也支持链接入口。本地正式发行密钥已建立，与旧 Debug APK 的签名不同；构建和迁移边界见 [自动更新与签名说明](automatic-updates.md)。

## 当前范围

- 适配手机的个人空间、可编辑金卡、环绕卡切换、图片或视频背景、开屏过渡。
- 连续环绕卡：拖动跟手、有限惯性、松手吸附，点击与滑动独立判定；页面纵向滚动保持可用。
- 手机音乐空间共用 `stickerMosaic.ts` 的桌面拼版规则，支持二维触摸拖动、点击聚焦和重新排布。
- 顶部玻璃搜索条；搜索直接进入结果贴纸，历史、喜欢、收藏和自定义歌单分别展示实际数量的歌曲。
- 用户自行导入 HTTPS 地址、兼容 `.js` 脚本或 Zenix v1 `.zenixsource` 文件，查看摘要后确认安装，支持源选项、启用、停用、移除和原顺序更新。
- 原生 Media3 播放、上一首/下一首、随机/循环、进度跳转、音频焦点、拔出耳机时暂停、媒体通知及系统媒体控制。
- 按源接入顺序解析；同一源先尝试首选品质，再降级，解析或实际音频播放失败时继续回退。跨目录回退只选取歌名与歌手都匹配的记录。
- 自动流式缓存、可调整的磁盘上限与按最近使用时间淘汰。缓存以歌曲 ID 与品质关联，完整的渐进式音频缓存可以绕过重新解析；未完整缓存的歌曲仍需联网补充片段。HLS 分片缓存不作为完整离线歌曲保证。
- 喜欢、收藏、去重历史、歌单及个人设置保存在应用私有目录。历史最多保留 300 首；自动缓存的淘汰不删除这些资料。
- 应用内歌词：共用桌面版歌词解析器，触摸浏览、点击跳转、3 秒无操作回到当前句、字号和颜色调整。成功取得的歌词缓存在本机，保留最多 100 份。
- 系统文件选择器导入本地歌曲作为备用，保留读取权限，读取内嵌信息和封面。

跨应用悬浮歌词由原生 `LyricOverlayService` 实现，通过用户授权的上层窗口与独立前台通知运行。默认三行、顶部拖动、进度跳转、字体/字号/颜色、标准或紧凑布局；浏览歌词 3 秒后回到当前句，锁定后歌词区域不接收触摸，只保留独立小解锁按钮。浮层不覆盖系统安全窗口，不绕过其他应用的悬浮层限制。当前原生浮层支持 LRC 与逐字时间戳文本，应用内仍使用完整的共享解析器。

Android 本地歌曲的同名歌词文件扫描、桌面 M3U 文件夹索引及电脑与手机资料同步尚未接入；正式发行签名已配置。

## 工程边界

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 触控界面 | `src/mobile/` | React 页面、歌词与玻璃功能条 |
| 平台桥 | `src/mobile/native.ts` / `ZenixNativePlugin.java` | 命令和状态通知、文件选择器 |
| 原生播放器 | `PlaybackService.java` | MediaSessionService、队列、音频焦点、解码、后台播放 |
| 源运行层 | `MusicSources.java` / `ScriptEngine.java` / `SourceHttp.java` | 源导入、目录、顺序回退、脚本网络及加密接口 |
| 原生悬浮歌词 | `LyricOverlayService.java` / `LyricTimeline.java` | 用户授权浮层、三行同步、浏览与锁定透传 |
| 私有资料 | `PrivateStore.java` | AtomicFile 保存个人资料、歌单、历史及源配置 |
| 缓存预算 | `CacheBudget.java` | Media3 SimpleCache 的可调整磁盘预算与淘汰 |

源脚本在独立的无界面 WebView 中运行，只暴露受限 HTTP、加密、压缩和结果接口，不暴露个人资料、歌单或文件读取接口。最多保留一个目录运行层和一个正在使用的源运行层。前端退到后台时停止周期性状态通知，音频服务独立运行；进度通知只传变化字段，避免反复传输完整歌单。

目录代码由 `scripts/Prepare-Android.mjs` 从本项目 `electron/lx-catalog.cjs` 生成 Android 适配文件；源运行层和播放器使用 Android 原生实现。目录与兼容协议沿用项目已有的 LX Music 相关参考，见根目录第三方说明。没有捆绑用户配置的源脚本、歌曲、背景照片或个人资料。

## 环境与构建

- Node.js 22 或更新版本。
- Android Studio，Java 21（Windows 构建脚本优先使用 Android Studio 自带 JBR）。
- Android SDK Platform 36.1、Build Tools 36.1.0；最低运行版本 Android 7 / API 24。
- 设备需要支持当前 JavaScript 语法的 Android System WebView。

```powershell
npm ci
npm run android:dev
# 手机尺寸界面预览：http://127.0.0.1:5175/index.android.html

npm run android:apk
# 输出：android/app/build/outputs/apk/debug/app-debug.apk

npm run android:open
# 在 Android Studio 中打开工程
```

浏览器预览不模拟原生网络源、播放器或存储；这些功能需要安装 APK。`npm run build`、`npm run dev` 和 Windows 打包仍使用原有桌面入口。Android 产物独立放在 `dist-android/`。

Windows 构建脚本默认寻找 `%LOCALAPPDATA%/Android/Sdk`，其他路径可设置 `ANDROID_HOME`。SDK 路径、构建缓存、签名密钥和构建生成的 Web 资源均不提交到仓库。

## 安装与运行状态

已发行 v1.0.0 / build 5，使用稳定发行密钥签名；当前稳定版修订为 v1.0.0 / build 7，沿用同一发行密钥。应用 ID 为 `com.zenix.musicplayer`。旧 Debug 预览包不能直接覆盖安装，升级前应保留资料。

首次进入可跳过背景选择，随后导入自己的音乐源，或选择本地歌曲。用户无需登录。Android 的媒体服务具备后台播放实现，实际手机厂商的省电策略、锁屏控制、文件权限恢复、脚本兼容性与缓存离线播放仍需在目标设备上验收。

本次已完成 React/TypeScript 构建、Android Debug APK 编译及手机宽度下的浏览器界面观察；当前尚未连接 Android 设备或模拟器，不能把这些构建结果视为真机功能验收完成。

## 权限与资料

应用声明网络、媒体播放前台服务、唤醒锁及通知权限。悬浮歌词另外声明 `SYSTEM_ALERT_WINDOW` 和 `FOREGROUND_SERVICE_SPECIAL_USE`，仅在用户主动开启且系统授权后启动，可从浮层、通知或设置关闭。照片、视频、音乐与源文件通过用户主动选择的系统文件选择器读取，不要求全盘文件权限。背景复制到应用私有目录；本地音乐保留系统授予的 URI 读取权限，不复制整份音乐文件。

默认不参加 Android 系统自动备份，避免把用户音乐源配置和个人资料随账号上传。卸载应用会删除其私有资料与缓存；原始本地音乐文件不会删除。APK 不含开发者的桌面资料，手机也不会自动读取电脑的个人配置。

## 开源组件

React、Framer Motion 与图标依赖沿用主项目。新增 Capacitor 8.5.2（MIT）、AndroidX Media3 1.11.1 与 AndroidX（Apache-2.0）、Java API desugaring（Apache-2.0）。相关原文和通知保存在 `licenses/` 并随 Android 构建作为文档资源保留。

## 窗口与输入法

原生内容容器统一深色背景并处理系统栏/输入法边距，已处理的边距归零后才传入 WebView，避免原生与 CSS 重复留白。浮动搜索与编辑层遵循 visual viewport 的可见高度，输入期间不主动清除焦点。实现依据 [Android WebView 窗口边距说明](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)；浮层前台服务声明依据 [Android 前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types#special-use)。

## 首版与移动端修补

[首版 APK](https://github.com/17hwliao/Zenix/releases/tag/v1.0.0)：1.0.0、versionCode 7、Android 7.0（API 24）及以上，使用发行密钥签名，不包含音乐源或个人配置。当前 1.0.0 / build 7 修补输入法、金卡和分享源包导入，详见 [修补说明](releases/v1.0.1-mobile-fixes.md)。

本轮优化将音频缓冲、不可见贴纸封面、后台页面与数据读取分开管理，详细边界见 [移动端资源策略](mobile-performance.md)。
