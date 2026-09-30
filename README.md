<p align="center">
  <img src="./assets/zenix-icon.png" alt="Zenix" width="112" />
</p>

<h1 align="center">Zenix Music Player</h1>

<p align="center">你的音乐，自成宇宙。</p>
<p align="center">Windows 桌面音乐播放器 · v0.1.0 · 本地开发与验收阶段</p>

<p align="center">
  <a href="#项目简介">项目简介</a> ·
  <a href="#核心能力">核心能力</a> ·
  <a href="#本地开发">本地开发</a> ·
  <a href="#致谢与参考项目">致谢与参考项目</a> ·
  <a href="#许可证与来源说明">许可证与来源说明</a>
</p>

## 项目简介

Zenix 是以歌曲贴纸、个人空间和桌面歌词为主要体验的 Windows 桌面音乐播放器。支持用户导入自定义音乐源，搜索并播放歌曲；本地音乐保留为离线与备用入口。

界面布局、贴纸展开和切歌交互参考 [Folia Major](https://github.com/chthollyphile/folia-major)，音乐源接入参考 [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop) 的自定义源协议与相关实现。个人主页结合用户提供的卡片页面设计，在 Zenix 中集成个人信息、歌单和外观管理。

项目使用第三方框架和组件，并在 AI 辅助下开发。参考项目、实际依赖和外部源脚本的使用方式在下方分别列明；源码来源核对尚未全部完成，不将参考或兼容实现统一表述为完全原创。

## 核心能力

| 模块 | 当前实现 |
| --- | --- |
| 歌曲贴纸空间 | 按搜索结果或当前歌单展示对应数量的贴纸；支持不同尺寸、拖动浏览、点击聚焦、展开切歌和窗口内全屏展示。 |
| 个人主页 | 可编辑个人名片；环绕卡片进入喜欢、收藏、历史、歌单、本地曲库和播放器设置；支持背景及卡片封面个性化。 |
| 音乐源管理 | 导入 Zenix 源包、源文件夹、兼容的 `.js` 脚本或 HTTPS 地址；支持预览、启停、排序、更新与移除。 |
| 搜索与顺序回退 | 顶部靠近触发玻璃搜索条；搜索可聚焦结果贴纸；播放按源接入顺序回退，并根据音质偏好尝试可用资源。 |
| 本地音乐 | 导入文件夹或音频文件，读取歌曲信息、时长与封面；支持本地索引及 M3U 歌单导入、导出。 |
| 播放与缓存 | 队列、上一首/下一首、随机、循环、进度拖动、音量和系统媒体键；支持本机缓存及离线歌曲优先播放。 |
| 收藏与歌单 | 喜欢、收藏、去重后的近期历史和自定义歌单保存在本机；播放队列的移除操作与库存删除分开。 |
| 歌词 | 读取本地内嵌或同名歌词文件；音乐源目录可补充在线歌词；贴纸歌词支持浏览、跳转和自动回到当前句。 |
| 桌面 LRC | 独立透明歌词窗口，至少三句歌词，横向/纵向布局、字体与颜色调整、拖动预览、定位播放、锁定及召回主窗口。 |
| 个性化与音效 | 图片或视频背景按场景调整显示；Lottie 开屏动画；进入、取消、滑动三类音效，各五种方案，可调整或关闭。 |
| 下载 | 音乐源提供下载能力时支持下载任务、暂停和续传；下载与解析是否成功取决于所安装源的服务。 |

以上为当前代码已集成的功能范围，整体功能与长时间运行表现仍处于用户验收阶段。项目未接入账号或登录系统。

## 本地开发

需要 Windows、Node.js 22.12 或更新版本，以及 npm。

```powershell
npm ci
npm run build
npm start
```

开发模式：

```powershell
npm run dev
```

开发模式同时启动 Vite 与 Electron。本地生产预览使用 `npm run build` 后的产物。当前尚未发布安装包。

如需生成桌面启动快捷方式，在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Create-DesktopShortcut.ps1
```

## 文档与工程说明

- [音乐源接入设计](docs/custom-source-design.md)
- [Zenix 自定义源协议](docs/zenix-source-protocol.md)
- [性能优化、模块划分与内存采样](docs/performance-architecture.md)
- [第三方组件与来源说明](THIRD_PARTY_NOTICES.md)

应用设置、曲库、歌单、历史及缓存保存在本机用户数据目录。音乐源脚本通过独立沙箱窗口运行；只有用户安装并启用的源参与搜索与播放。主程序仓库记录预设入口，不内嵌这些外部源的脚本正文。

## 致谢与参考项目

感谢以下项目的作者、维护者与贡献者。此处说明项目与 Zenix 的具体关系，完整依赖清单见 [第三方组件明细](THIRD_PARTY_NOTICES.md)。

### 界面与功能参考

| 项目或资源 | 在 Zenix 中的用途 | 来源与许可状态 |
| --- | --- | --- |
| [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) | 窗口布局、玻璃控件、贴纸墙、卡片展开、聚焦切歌及动效参考。 | 上游 LICENSE 为 [AGPL-3.0](https://github.com/chthollyphile/folia-major/blob/main/LICENSE)；具体源码借用或改编情况尚待逐文件核对。 |
| [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) | 自定义源事件协议、脚本宿主接口、歌曲字段、目录 SDK 和按需解析链路参考。 | 上游 LICENSE 为 [Apache-2.0](https://github.com/lyswhut/lx-music-desktop/blob/master/LICENSE)；Zenix 中的目录适配与兼容实现仍需完成代码来源核对。 |
| 用户提供的 `zenix-space.html` | 个人名片、中央卡片和环绕卡片的设计参考与功能整合。 | 用户提供的本地页面，无公开项目地址；未提供单独许可证，相关来源与再分发范围待确认。 |

LX 接口参考资料：[自定义源协议](https://lxmusic.toside.cn/desktop/custom-source)、[音乐 SDK](https://github.com/lyswhut/lx-music-desktop/blob/master/src/renderer/utils/musicSdk/index.js)、[脚本宿主](https://github.com/lyswhut/lx-music-desktop/blob/master/src/main/modules/userApi/renderer/preload.js)。对应实现主要位于 `electron/lx-catalog.cjs`、`electron/lx-source-preload.cjs` 和 `electron/sources.cjs`。

### 直接使用的运行组件

| 项目 | 用途 | 许可证 |
| --- | --- | --- |
| [electron/electron](https://github.com/electron/electron) | 桌面窗口、进程、IPC 与系统接口。 | MIT；其二进制内含其他组件的独立许可。 |
| [React](https://github.com/react/react) | React / React DOM 界面组件与渲染。 | MIT |
| [motiondivision/motion](https://github.com/motiondivision/motion) | Framer Motion 页面与控件动效。 | MIT |
| [airbnb/lottie-web](https://github.com/airbnb/lottie-web) | 实际调用 Lottie 播放器渲染开屏动画。 | MIT |
| [paper-design/shaders](https://github.com/paper-design/shaders) | 实际使用 MeshGradient、Dithering 及 React 着色器组件。 | Apache-2.0 |
| [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | 窗口、音乐、歌词和管理功能的图标。 | ISC |
| [Borewit/music-metadata](https://github.com/Borewit/music-metadata) | 读取本地音频元数据及内嵌封面、歌词。 | MIT |

开发与构建还使用 [Vite](https://github.com/vitejs/vite)、[vite-plugin-react](https://github.com/vitejs/vite-plugin-react)、[TypeScript](https://github.com/microsoft/TypeScript)、[DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)、[concurrently](https://github.com/open-cli-tools/concurrently)、[cross-env](https://github.com/kentcdodds/cross-env) 和 [wait-on](https://github.com/jeffbski/wait-on)。开发依赖与发行包内的运行组件分开记录。

### 外部音乐源与入口资源

| 项目或入口 | 当前预设涉及的资源 | 使用方式 |
| --- | --- | --- |
| [pdone/lx-music-source](https://github.com/pdone/lx-music-source) | 长青、六音 SixYin、Huibq、野花 Flower、备用测试源、IKUN、野草 Grass。 | 提供脚本地址收集与下载入口；原脚本归各自作者。用户安装后，Zenix 加载并执行对应脚本。 |
| [cdyUuu/lx-music-xinghai-source](https://github.com/cdyUuu/lx-music-xinghai-source) | 星海聚合源。 | 提供星海脚本的项目入口，用户安装后由兼容宿主运行。 |

各预设的具体脚本链接见 [`src/ui/lxPresets.ts`](src/ui/lxPresets.ts)。感谢原作者与入口维护者；入口收集仓库不等于拥有全部脚本的再分发授权，各脚本的许可证、服务要求和授权范围需单独核对。列出入口不代表能够保证服务长期可用。

目录适配器还访问酷我、酷狗、网易云音乐、QQ 音乐和咪咕音乐的在线接口，用于歌曲检索、封面及歌词补充。这些属于外部服务接入，不代表上述平台参与开发、认可本项目或授予内容再分发许可；接口范围见 [第三方与外部服务说明](THIRD_PARTY_NOTICES.md#外部目录与内容服务)。

### 项目素材与生成工具

- 开屏动画数据位于 [`src/ui/zenixIntroAnimation.ts`](src/ui/zenixIntroAnimation.ts)，由 lottie-web 播放。
- 桌面图标生成脚本位于 [`assets/generate-icon.py`](assets/generate-icon.py)，使用 [Pillow](https://github.com/python-pillow/Pillow)（[MIT-CMU](https://github.com/python-pillow/Pillow/blob/main/LICENSE)）绘制。
- 三类 WAV 音效的生成脚本位于 [`assets/generate-sounds.py`](assets/generate-sounds.py)，使用 Python 标准库合成。
- 用户导入的照片、视频、歌曲、歌词和专辑封面属于对应提供者或权利人，不作为 Zenix 自有素材声明。

## 许可证与来源说明

**Zenix 自有代码的整体开源许可证尚未确定，当前尚未添加根目录 LICENSE。** 依赖采用 MIT、ISC 或 Apache-2.0，不代表整个项目自动取得相同许可。致谢也不代替许可证、版权声明、NOTICE 或受适用许可约束的源码提供义务。

当前已将可取得的运行依赖许可证及 NOTICE 原文保存在 [`licenses/`](licenses/)。具体版本、许可文件和未解决项见 [第三方组件与许可证](THIRD_PARTY_NOTICES.md)。

Folia 的 [LICENSE](https://github.com/chthollyphile/folia-major/blob/main/LICENSE) 标明 AGPL-3.0，其 [README](https://github.com/chthollyphile/folia-major/blob/main/README.md) 另有学习与非营利用途的说明；这些文字与许可证的关系仍需向上游确认。现阶段仍需核对 Folia/LX 相关文件的实际来源与使用范围，不能仅凭更换品牌、改写结构或添加致谢认定已解除上游许可义务。

项目不引入参考仓库的 Git 历史；这与是否使用其源码是两个独立问题。

音乐源脚本的开源许可不等于歌曲、歌词、封面或其他在线内容的授权。使用与再分发相关内容时，应遵守对应服务和权利人的要求。
