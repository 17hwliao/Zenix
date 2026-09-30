# Zenix 当前技术栈

核对日期：2026-09-30。版本来自当前安装依赖和锁文件；这是本地开发版的技术清单。

## 主要组件

| 层次 | 技术与版本 | 用途 |
| --- | --- | --- |
| 桌面运行环境 | Electron 43.7.5，内置 Chromium / Node.js | 主窗口、透明置顶歌词窗口、文件访问、IPC、媒体协议与系统操作。 |
| 界面 | React / React DOM 19.3.0 | 个人主页、歌曲贴纸、搜索、歌单及设置界面。 |
| 界面语言 | TypeScript 5.9.3、TSX、HTML、CSS | 类型定义、组件、样式和歌词排版。 |
| 主进程与预加载 | JavaScript / CommonJS，Node.js 内置模块 | 应用生命周期、文件持久化、源宿主、网络请求、音频缓存。 |
| 构建 | Vite 7.3.6、@vitejs/plugin-react 5.2.0 | 开发服务、生产构建和 React 编译。 |
| 交互动效 | Framer Motion 13.4.4、CSS 动画与 3D 变换、Web Animations API | 页面、控件、名片转动、歌词切换和预览动画。 |
| 开屏动画 | lottie-web 5.13.0，轻量播放器 | 渲染开屏矢量动画数据。 |
| 动态背景 | @paper-design/shaders-react / shaders 0.0.80、WebGL | MeshGradient 与 Dithering；使用自定义媒体背景时按场景停用底层着色器。 |
| 图标 | lucide-react 1.48.0、SVG | 主界面功能图标与桌面歌词控件。 |
| 音频信息 | music-metadata 11.16.1 | 本地音频标题、艺人、专辑、封面及内嵌信息读取。 |
| 音频播放 | HTMLAudioElement、Media Session API | 播放、解码、时间轴、音量、切歌及系统媒体控制。 |
| 网络与媒体代理 | Fetch / AbortController、Node.js 网络与文件模块、`yzqxy://` 自定义协议 | 自定义源请求、访问限制、播放地址解析、Range 请求与音频流。协议名兼容旧版数据。 |
| 本地存储 | JSON 文件、Local Storage、磁盘文件 | 曲库、喜欢、收藏、历史、歌单、设置、媒体、歌词和音频缓存。 |
| 桌面歌词 | 独立 HTML/CSS/JavaScript 窗口、Electron screen API、IPC | 三行横竖排版、鼠标穿透、锁定、进度与歌词预览、主窗口召回。 |

开发命令当前使用 Node.js v22.22.2；README 建议至少 22.12。开发机器上的 Node 与 Electron 内置 Node 是不同运行环境，不能混用版本信息。

## 开发和素材工具

- npm 与 `package-lock.json` 管理依赖；TypeScript 在构建前检查类型。
- concurrently 9.2.4、cross-env 7.0.3、wait-on 8.0.5 协调开发服务与 Electron 启动。
- `@types/node`、`@types/react`、`@types/react-dom` 提供类型声明。
- PowerShell 脚本生成本机启动快捷方式并只读采样进程内存。
- Python 标准库合成 WAV 音效，Pillow 绘制图标；它们用于素材生成，不是播放器运行时依赖。

完整的锁定运行依赖及许可证原文见 [第三方说明](../THIRD_PARTY_NOTICES.md)。

## 业务架构

```text
React UI / 播放器状态
          ↓ 预加载桥接与 IPC
Electron 主进程：窗口 / 曲库 / 个人数据 / 背景
          ↓
源管理：Zenix 完整源协议 / 兼容脚本协议 / 目录适配
          ↓ 按接入顺序与音质偏好解析
磁盘音频缓存 → 媒体协议代理 → HTMLAudioElement
          ↓ 播放时间与歌词增量
独立桌面歌词窗口
```

源脚本按需在独立窗口中执行，上下文隔离、沙箱和网络约束由应用宿主处理。Zenix 自有完整协议与兼容脚本的目录、网络能力不同，详细要求见 [协议说明](zenix-source-protocol.md)。用户自行安装源，发行包不包含开发者已配置的脚本或个人数据。

## 桌面歌词边缘交互修复

之前的交互同时涉及 DOM 悬停、原生拖动区和透明窗口原生缩放边界。Electron 官方说明拖动区会忽略指针事件，透明窗口启用原生缩放也可能出现异常：[窗口交互](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)、[透明窗口限制](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations)。

当前实现：

- `electron/runtime/lyrics-hover.cjs` 以主进程的鼠标屏幕坐标和窗口边界判断悬停，不再使用 DOM 的进入/离开事件决定展开。
- 可见窗口每 60 ms 检查一次；进入范围在透明边距内缩 6 px，展开后保留 8 px 边缘缓冲，真正离开 240 ms 后收起。只有状态改变才通知渲染进程。
- 按住歌词、进度或尺寸拖动柄时保持操作层展开；释放、取消、失焦和窗口关闭时释放状态。
- 关闭歌词窗口的原生缩放和厚边框。右下角的轻量拖动柄通过受限 IPC 调整窗口尺寸，横竖布局的尺寸与位置继续保存。
- 玻璃背景使用固定的伪元素，只改变不透明度；不在每次悬停时切换模糊、边框或阴影结构。透明窗口的玻璃是视觉效果，不声明能对其他应用的内容进行系统级模糊。
- 锁定仍采用鼠标穿透与独立锁按钮；锁按钮等待首帧准备好再显示。歌词隐藏或关闭后停止悬停采样。
- 歌词和锁按钮使用 `screen-saver` 置顶层级，显示/失焦/主窗口召回时重新提升，复用可见窗口的采样每 2 秒维持窗口顺序；使用 `moveTop()` 而不切换焦点或重复重建窗口样式。

这次修改没有新增运行依赖，播放源队列、歌单和歌曲库存的行为保持原有设计。

## README 与开源准备情况

README 已包含简介、能力范围、首次使用、源配置、本地音频及歌词格式、数据与缓存、开发命令、工程结构、参考致谢、常见问题、贡献说明和 GPL-3.0 声明，具备开发预览仓库的文档结构。

公开源码和发行前仍要按实际内容处理：

1. Folia / LX 相关代码的具体来源和许可要求；尤其不能以 GPL 声明覆盖实际适用的 AGPL 要求。
2. 最终产物的第三方通知与当前记录中缺少的许可原文。
3. 打包文件范围，排除开发者的源脚本、媒体、缓存、路径和个人配置。
4. 桌面交互的使用验收与安装包制作。截图、演示视频和 Issue 模板可后续补充；它们不是 README 已完成发行核验的证明。

目前未提供正式安装包、统一配置导出、自动化 CI 或功能测试套件。文档完整性与来源审计、发行验证是分别记录的事项。
