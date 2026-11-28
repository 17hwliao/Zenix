# 第三方组件与许可证

核对日期：2026-09-30。版本按当前 package-lock.json / 安装包记录。Zenix 自有且开发者有权授权的代码采用 [GPL-3.0-only](LICENSE)；第三方组件及参考代码按各自适用许可处理。

## Zenbot 人物素材

2026-11-27 的本地集成复用用户 codex-pet 工作区中的 Zenbot PNG 与声明式人物清单。精灵清单声明 `user-owned-local`，来源及导入边界见 `public/assistant/zenbot/NOTICE.md`。本次 Canvas 2D 渲染与动作变换由 Zenix 独立实现，分件动画与源项目的网格渲染表现存在差异。人物资产的授权声明与 Zenix 代码许可分别保留。

## DeepSeek 鲸鱼娘人物素材

DeepSeek 鲸鱼娘的 PNG、分件模型与人物清单来自用户本地 codex-pet 中导入的 Pal-AI-Lab Coopanion 原版形象包。保留原角色设计溟月（上善无形）与 DeepSeek 女仆二创 ZipZipPipe 的署名。该目录素材适用 AGPL-3.0-or-later 及 Steamworks 第 7 节附加许可，完整原文、原包声明和本次集成说明随包包含于 `dist/assistant/whale/LICENSE`、`NOTICE.md`、`figure.json` 与 `ZENIX-INTEGRATION.md`。

## 实际依赖

| 组件 | 版本 | 许可证 | 保留的原文 |
| --- | --- | --- | --- |
| @borewit/text-codec | 0.2.2 | MIT | [LICENSE.txt](licenses/_borewit_text-codec/LICENSE.txt) |
| @paper-design/shaders | 0.0.80 | Apache-2.0 | [LICENSE](licenses/_paper-design_shaders/LICENSE)、[NOTICE](licenses/_paper-design_shaders/NOTICE) |
| @paper-design/shaders-react | 0.0.80 | Apache-2.0 | [LICENSE](licenses/_paper-design_shaders-react/LICENSE)、[NOTICE](licenses/_paper-design_shaders-react/NOTICE) |
| @tokenizer/inflate | 0.4.1 | MIT | [LICENSE](licenses/_tokenizer_inflate/LICENSE) |
| @tokenizer/token | 0.3.0 | MIT | 安装包的 `package.json` 声明 MIT；[上游项目](https://github.com/Borewit/tokenizer-token) |
| @types/react | 19.3.0 | MIT | [LICENSE](licenses/_types_react/LICENSE) |
| content-type | 2.1.0 | MIT | [LICENSE](licenses/content-type/LICENSE) |
| csstype | 3.2.3 | MIT | [LICENSE](licenses/csstype/LICENSE) |
| debug | 4.4.3 | MIT | [LICENSE](licenses/debug/LICENSE) |
| file-type | 21.3.4 | MIT | [license](licenses/file-type/license) |
| fflate | 0.8.3 | MIT | [LICENSE](licenses/fflate/LICENSE)；按需读取分享 ZIP 源包 |
| framer-motion | 13.4.4 | MIT | [LICENSE.md](licenses/framer-motion/LICENSE.md) |
| ieee754 | 1.2.1 | BSD-3-Clause | [LICENSE](licenses/ieee754/LICENSE) |
| lottie-web | 5.13.0 | MIT | [LICENSE.md](licenses/lottie-web/LICENSE.md) |
| lucide-react | 1.48.0 | ISC | [LICENSE](licenses/lucide-react/LICENSE) |
| media-typer | 2.0.0 | MIT | [LICENSE](licenses/media-typer/LICENSE) |
| motion-dom | 13.4.4 | MIT | [LICENSE.md](licenses/motion-dom/LICENSE.md) |
| motion-utils | 13.3.0 | MIT | [LICENSE.md](licenses/motion-utils/LICENSE.md) |
| ms | 2.1.3 | MIT | [license.md](licenses/ms/license.md) |
| music-metadata | 11.16.1 | MIT | [LICENSE.txt](licenses/music-metadata/LICENSE.txt) |
| react | 19.3.0 | MIT | [LICENSE](licenses/react/LICENSE) |
| react-dom | 19.3.0 | MIT | [LICENSE](licenses/react-dom/LICENSE) |
| scheduler | 0.28.0 | MIT | [LICENSE](licenses/scheduler/LICENSE) |
| strtok3 | 10.3.5 | MIT | [LICENSE.txt](licenses/strtok3/LICENSE.txt) |
| token-types | 6.1.2 | MIT | [LICENSE.txt](licenses/token-types/LICENSE.txt) |
| tslib | 2.8.1 | 0BSD | [LICENSE.txt](licenses/tslib/LICENSE.txt) |
| uint8array-extras | 1.5.0 | MIT | [license](licenses/uint8array-extras/license) |
| win-guid | 0.2.1 | MIT | [LICENSE.txt](licenses/win-guid/LICENSE.txt) |
| undici | 7.30.0 | MIT | [LICENSE](licenses/undici/LICENSE)；用于绑定校验后的 DNS 地址建立 HTTP 连接 |
| electron | 43.7.5 | MIT | [LICENSE](licenses/electron/LICENSE) |

Electron 随软件发行的二进制还包含 Chromium 等组件；打包时需要随包保留 Electron 的 LICENSE 与 LICENSES.chromium.html（当前位于 node_modules/electron/dist）。上表包含生产依赖及其锁定依赖，开发构建工具不等于随发行包分发的组件。

## 开发与素材生成工具

### Android 分支新增组件

| 组件 | 版本 | 用途 | 许可证 |
| --- | --- | --- | --- |
| Capacitor Core / Android / CLI | 8.5.2 | React 与 Android 平台桥、Android 工程生成 | [MIT 原文](licenses/capacitor/LICENSE) |
| AndroidX Media3 | 1.11.1 | ExoPlayer、MediaSessionService、流式数据与缓存 | [Apache-2.0 原文](licenses/androidx-media/LICENSE) |
| OkHttp / Okio | 4.12.0 / 3.6.0 | 受控 HTTP 与原生音频数据传输 | [OkHttp Apache-2.0](licenses/okhttp/LICENSE.txt)、[Okio Apache-2.0](licenses/okio/LICENSE.txt) |
| AndroidX | 由 Android 工程固定声明 | Activity、权限、窗口及数据库支持 | Apache-2.0，组件通知随 Android 依赖保留 |
| desugar_jdk_libs | 2.1.5 | Android 旧版本上的 Java API 支持 | [Apache-2.0](https://github.com/google/desugar_jdk_libs/blob/master/LICENSE) |

Android 目录适配沿用本项目已有的 `electron/lx-catalog.cjs`，生成文件为 `android/app/src/main/assets/zenix/catalog.js`；LX Music 的目录字段、事件及加密协议参考关系与下方说明一致。Android 音频服务、私有存储、窗口和平台桥由本项目实现。AndroidX Media3 与 Capacitor 是实际运行依赖，未引入 Go。

以下列出直接开发依赖及素材生成工具，与发行包运行依赖分开记录。

| 项目 | 当前版本 | 用途 | 许可证与来源 |
| --- | --- | --- | --- |
| TypeScript | 5.9.3 | 类型检查 | [Apache-2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |
| Vite | 7.3.6 | 开发服务和打包 | [MIT](https://github.com/vitejs/vite/blob/main/LICENSE) |
| electron-builder | 26.15.3 | Windows NSIS 安装包制作 | [MIT](https://github.com/electron-userland/electron-builder/blob/master/LICENSE) |
| @vitejs/plugin-react | 5.2.0 | React 构建插件 | [MIT](https://github.com/vitejs/vite-plugin-react/blob/main/LICENSE) |
| @types/node | 24.19.0 | Node 类型声明 | [DefinitelyTyped / MIT](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| @types/react | 19.3.0 | React 类型声明 | [DefinitelyTyped / MIT](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| @types/react-dom | 19.3.0 | React DOM 类型声明 | [DefinitelyTyped / MIT](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| concurrently | 9.2.4 | 同时启动开发进程 | [MIT](https://github.com/open-cli-tools/concurrently) |
| cross-env | 7.0.3 | 跨平台环境变量 | [MIT](https://github.com/kentcdodds/cross-env) |
| wait-on | 8.0.5 | 等待开发端口 | [MIT](https://github.com/jeffbski/wait-on) |
| Pillow | 未锁定；仅图标生成脚本使用 | 绘制 PNG / ICO | [MIT-CMU](https://github.com/python-pillow/Pillow/blob/main/LICENSE) |

Electron 同时用于开发启动与软件运行，版本及通知已列在上表。`assets/generate-sounds.py` 使用 Python 标准库合成音效；`src/ui/zenixIntroAnimation.ts` 保存开屏动画数据，渲染依赖 lottie-web。

## 参考项目与实际用途

| 项目或资源 | 参考范围 | 对应实现或说明 | 许可证或来源 |
| --- | --- | --- | --- |
| [Folia Major](https://github.com/chthollyphile/folia-major) | 窗口布局、玻璃效果、贴纸墙、展开、聚焦和切歌交互 | `src/` 下的 UI 与样式 | [AGPL-3.0](https://github.com/chthollyphile/folia-major/blob/main/LICENSE) |
| [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop) | 自定义源事件、脚本宿主、歌曲字段及目录 SDK 相关代码与实现思路 | `electron/lx-catalog.cjs`、`electron/lx-source-preload.cjs`、`electron/sources.cjs` | [Apache-2.0](https://github.com/lyswhut/lx-music-desktop/blob/master/LICENSE) |
| 用户提供的 `zenix-space.html` | 中央名片与环绕卡片主页设计 | 个人主页组件与样式 | 用户提供的设计参考，不公开其机器路径 |

协议资料：[LX 自定义源文档](https://lxmusic.toside.cn/desktop/custom-source)、[音乐 SDK 入口](https://github.com/lyswhut/lx-music-desktop/blob/master/src/renderer/utils/musicSdk/index.js)、[脚本宿主参考](https://github.com/lyswhut/lx-music-desktop/blob/master/src/main/modules/userApi/renderer/preload.js)。

感谢上述项目的作者、维护者与贡献者。第三方代码与资源保留原项目的许可证、版权声明及通知。

## 外部音乐源与脚本入口

以下为开发者自行收集的本机使用与兼容调试入口。音乐源脚本由用户自行配置，个人歌曲、缓存、背景及名片配置属于本机用户数据；相关清单见 [发行配置建议](docs/distribution-config.md)。

预设链接来自 [pdone/lx-music-source](https://github.com/pdone/lx-music-source) 收集仓库及 [cdyUuu/lx-music-xinghai-source](https://github.com/cdyUuu/lx-music-xinghai-source)。感谢各脚本原作者和入口维护者。当前代码中的完整入口如下，顺序按 `src/ui/lxPresets.ts` 列出，不表示服务品质排序。

| 预设名称 | 脚本入口 | 使用方式 |
| --- | --- | --- |
| 星海聚合 | [xinghai-music-source.js](https://raw.githubusercontent.com/cdyUuu/lx-music-xinghai-source/main/xinghai-music-source.js) | 用户自行安装后运行 |
| 长青 | [changqing/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/changqing/latest.js) | 用户自行安装后运行 |
| 六音 SixYin | [sixyin/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/latest.js) | 用户自行安装后运行 |
| Huibq | [huibq/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js) | 用户自行安装后运行 |
| 野花 Flower | [flower/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/flower/latest.js) | 用户自行安装后运行 |
| 备用测试源 | [lx/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/lx/latest.js) | 用户自行安装后运行；社区收集入口 |
| IKUN | [ikun/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/ikun/latest.js) | 用户自行安装后运行 |
| 野草 Grass | [grass/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/grass/latest.js) | 用户自行安装后运行 |

产品源码记录入口链接，不内嵌上述远程脚本正文。用户安装后，脚本保存在本机并由独立兼容宿主执行。各脚本保留其作者的版权声明、许可证和服务要求；服务可用性由提供方决定。

## 外部目录与内容服务

`electron/lx-catalog.cjs` 当前直接访问以下平台的在线接口。此表说明服务接入，不能解读为平台代码被作为依赖安装、平台参与项目开发或已授权内容再分发。

| 服务 | 接入范围 | 当前使用的主要域名 |
| --- | --- | --- |
| 酷我音乐 | 搜索、封面、歌词 | `search.kuwo.cn`、`artistpicserver.kuwo.cn`、`mlyric.kuwo.cn` |
| 酷狗音乐 | 搜索、封面、歌词 | `songsearch.kugou.com`、`media.store.kugou.com`、`lyrics.kugou.com` |
| 网易云音乐 | 搜索、封面、歌词 | `music.163.com` |
| QQ 音乐 | 搜索、封面、歌词 | `u.y.qq.com`、`y.gtimg.cn`、`c.y.qq.com` |
| 咪咕音乐 | 搜索及返回的封面、歌词地址 | `jadeite.migu.cn` 及接口返回的媒体地址 |

歌曲、封面、歌词、用户照片和视频的权利归对应提供者或权利人；代码许可证与在线内容授权应分别处理。

## 许可证与通知文件

iOS 适配使用 Capacitor 的 iOS 桥接，Apple SDK 的 AVFoundation、MediaPlayer、JavaScriptCore、Security、CommonCrypto 以及系统 zlib；新增 Swift 播放器、缓存、资料与源适配代码位于 `ios/App/App/`。目录接口与兼容协议继续复用本项目已有实现及上文所列参考关系。`Prepare-iOS.mjs` 将许可文档和便携宿主生成到应用资源中，不复制用户音乐源脚本或资料。

Zenix 自有代码的 GPL-3.0-only 原文位于根目录 [LICENSE](LICENSE)。Paper Shaders 的 LICENSE 与 NOTICE，以及上表列出的已保存运行组件许可证位于 [`licenses/`](licenses/)。安装包将这些文档放在安装目录的 `resources/`；Electron 的 `LICENSE.electron.txt` 与 `LICENSES.chromium.html` 位于安装根目录。第三方组件的许可证、版权声明和通知随对应组件保留。

## 助手晓伊在线音色（2026-11-06）

PC 使用 node-edge-tts 1.2.12 及其运行依赖生成用户选择的晓伊音色；Android 的 EdgeVoiceToken 兼容适配参考同版本 MIT 实现，保留 SchneeHertz 署名与完整许可。语音通过第三方客户端访问微软在线朗读服务，开源客户端许可不等于服务商承诺永久免费或可用性保证。依赖按本次 package-lock.json 列出：

| 组件 | 版本 | 许可证 | 保留的原文 |
| --- | --- | --- | --- |
| node-edge-tts | 1.2.12 | MIT | [LICENSE](licenses/node-edge-tts/LICENSE) |
| https-proxy-agent | 7.0.6 | MIT | [LICENSE](licenses/https-proxy-agent/LICENSE) |
| agent-base | 7.1.4 | MIT | [LICENSE](licenses/agent-base/LICENSE) |
| debug | 4.4.3 | MIT | [LICENSE](licenses/debug/LICENSE) |
| ms | 2.1.3 | MIT | [license.md](licenses/ms/license.md) |
| ws | 8.22.1 | MIT | [LICENSE](licenses/ws/LICENSE) |
| yargs | 17.7.2 | MIT | [LICENSE](licenses/yargs/LICENSE) |
| cliui | 8.0.1 | ISC | [LICENSE.txt](licenses/cliui/LICENSE.txt) |
| string-width | 4.2.3 | MIT | [license](licenses/string-width/license) |
| emoji-regex | 8.0.0 | MIT | [LICENSE-MIT.txt](licenses/emoji-regex/LICENSE-MIT.txt) |
| is-fullwidth-code-point | 3.0.0 | MIT | [license](licenses/is-fullwidth-code-point/license) |
| strip-ansi | 6.0.1 | MIT | [license](licenses/strip-ansi/license) |
| ansi-regex | 5.0.1 | MIT | [license](licenses/ansi-regex/license) |
| wrap-ansi | 7.0.0 | MIT | [license](licenses/wrap-ansi/license) |
| ansi-styles | 4.3.0 | MIT | [license](licenses/ansi-styles/license) |
| color-convert | 2.0.1 | MIT | [LICENSE](licenses/color-convert/LICENSE) |
| color-name | 1.1.4 | MIT | [LICENSE](licenses/color-name/LICENSE) |
| escalade | 3.2.0 | MIT | [license](licenses/escalade/license) |
| get-caller-file | 2.0.5 | ISC | [LICENSE.md](licenses/get-caller-file/LICENSE.md) |
| require-directory | 2.1.1 | MIT | [LICENSE](licenses/require-directory/LICENSE) |
| y18n | 5.0.8 | ISC | [LICENSE](licenses/y18n/LICENSE) |
| yargs-parser | 21.1.1 | ISC | [LICENSE.txt](licenses/yargs-parser/LICENSE.txt) |
# Blog appearance system (2026-11-28)

`public/ui/blog-bento.css` and `public/ui/nine-slice.js` are copied from
[17hwliao/17hwliao-blog](https://github.com/17hwliao/17hwliao-blog), commit
`24813d93da2670ddd84b8f5533f2ef3f7f7fcc13`, under GPL-3.0-only, compatible
with this application's existing license. The geometry is compiled from
`src/lib/nine-slice.ts`. Appearance controls are adapted to Zenix's own state
and React components. Grid wave feedback is adapted from the blog's
`src/components/reference-experience.tsx`, originally derived from
Ladvace/astro-bento-portfolio (MIT).

Copyright (c) 2024 Gianmarco Cavallo and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
