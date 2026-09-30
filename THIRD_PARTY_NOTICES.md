# 第三方组件与许可证

核对日期：2026-09-30。版本按当前 package-lock.json / 安装包记录。此文档不会替 Zenix 选择整体开源许可证。

## 实际依赖

| 组件 | 版本 | 许可证 | 保留的原文 |
| --- | --- | --- | --- |
| @borewit/text-codec | 0.2.2 | MIT | [LICENSE.txt](licenses/_borewit_text-codec/LICENSE.txt) |
| @paper-design/shaders | 0.0.80 | Apache-2.0 | [LICENSE](licenses/_paper-design_shaders/LICENSE)、[NOTICE](licenses/_paper-design_shaders/NOTICE) |
| @paper-design/shaders-react | 0.0.80 | Apache-2.0 | [LICENSE](licenses/_paper-design_shaders-react/LICENSE)、[NOTICE](licenses/_paper-design_shaders-react/NOTICE) |
| @tokenizer/inflate | 0.4.1 | MIT | [LICENSE](licenses/_tokenizer_inflate/LICENSE) |
| @tokenizer/token | 0.3.0 | MIT | 未发现许可证文件 |
| @types/react | 19.3.0 | MIT | [LICENSE](licenses/_types_react/LICENSE) |
| content-type | 2.1.0 | MIT | [LICENSE](licenses/content-type/LICENSE) |
| csstype | 3.2.3 | MIT | [LICENSE](licenses/csstype/LICENSE) |
| debug | 4.4.3 | MIT | [LICENSE](licenses/debug/LICENSE) |
| file-type | 21.3.4 | MIT | [license](licenses/file-type/license) |
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
| electron | 43.7.5 | MIT | [LICENSE](licenses/electron/LICENSE) |

Electron 随软件发行的二进制还包含 Chromium 等组件；打包时需要随包保留 Electron 的 LICENSE 与 LICENSES.chromium.html（当前位于 node_modules/electron/dist）。上表包含生产依赖及其锁定依赖，开发构建工具不等于随发行包分发的组件。

## 开发与素材生成工具

以下为直接开发依赖及素材生成工具，不等同于发行包运行依赖。开发工具的传递依赖尚未在本表逐一列出；发行时仍应以实际打包产物确定需要随附的通知。

| 项目 | 当前版本 | 用途 | 许可证与来源 |
| --- | --- | --- | --- |
| TypeScript | 5.9.3 | 类型检查 | [Apache-2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |
| Vite | 7.3.6 | 开发服务和打包 | [MIT](https://github.com/vitejs/vite/blob/main/LICENSE) |
| @vitejs/plugin-react | 5.2.0 | React 构建插件 | [MIT](https://github.com/vitejs/vite-plugin-react/blob/main/LICENSE) |
| @types/node | 24.19.0 | Node 类型声明 | [DefinitelyTyped / MIT](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| @types/react | 19.3.0 | React 类型声明 | [DefinitelyTyped / MIT](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| @types/react-dom | 19.3.0 | React DOM 类型声明 | [DefinitelyTyped / MIT](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| concurrently | 9.2.4 | 同时启动开发进程 | [MIT](https://github.com/open-cli-tools/concurrently) |
| cross-env | 7.0.3 | 跨平台环境变量 | [MIT](https://github.com/kentcdodds/cross-env) |
| wait-on | 8.0.5 | 等待开发端口 | [MIT](https://github.com/jeffbski/wait-on) |
| Pillow | 未锁定；仅图标生成脚本使用 | 绘制 PNG / ICO | [MIT-CMU](https://github.com/python-pillow/Pillow/blob/main/LICENSE) |

Electron 同时用于开发启动与软件运行，版本及通知已列在上表。`assets/generate-sounds.py` 使用 Python 标准库合成音效；`src/ui/zenixIntroAnimation.ts` 保存开屏动画数据，渲染依赖 lottie-web。动画数据、素材和播放器组件应分别核对归属，不能仅凭组件许可证推定素材许可。

## 参考项目与实际用途

| 项目或资源 | 参考范围 | 对应实现或说明 | 许可状态 |
| --- | --- | --- | --- |
| [Folia Major](https://github.com/chthollyphile/folia-major) | 窗口布局、玻璃效果、贴纸墙、展开、聚焦和切歌交互 | `src/` 下的 UI 与样式；具体借用或改编代码尚待逐文件核对 | [AGPL-3.0](https://github.com/chthollyphile/folia-major/blob/main/LICENSE) |
| [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop) | 自定义源事件、脚本宿主、歌曲字段及目录 SDK | `electron/lx-catalog.cjs`、`electron/lx-source-preload.cjs`、`electron/sources.cjs`；代码来源核对尚未完成 | [Apache-2.0](https://github.com/lyswhut/lx-music-desktop/blob/master/LICENSE) |
| 用户提供的 `zenix-space.html` | 中央名片与环绕卡片主页设计 | 个人主页组件与样式；用户提供的本地资源，不公开其机器路径 | 未提供单独许可证，来源及再分发范围待确认 |

协议资料：[LX 自定义源文档](https://lxmusic.toside.cn/desktop/custom-source)、[音乐 SDK 入口](https://github.com/lyswhut/lx-music-desktop/blob/master/src/renderer/utils/musicSdk/index.js)、[脚本宿主参考](https://github.com/lyswhut/lx-music-desktop/blob/master/src/main/modules/userApi/renderer/preload.js)。

Folia 的 [README](https://github.com/chthollyphile/folia-major/blob/main/README.md) 除 AGPL 声明外还包含学习、非营利用途等说明。其与 LICENSE 的关系尚待向上游澄清，本文不替上游作许可解释，也不将这些文字直接作为 Zenix 的整体许可。

此清单确认了参考关系和直接依赖，不证明所有既有代码均为独立创作。性能重构、品牌更换及未合并参考仓库 Git 历史，均不能代替代码来源核对。若实际包含借用或改编代码，需要按对应许可证处理版权声明、修改说明、NOTICE 和适用的源码提供义务。

## 外部音乐源与脚本入口

以下为开发者自行收集的本机使用与兼容调试资源。发行原则是不捆绑源脚本或开发者的已配置源，由用户自行配置；保留本表是说明开发入口的来源。个人歌曲、缓存、背景及名片配置同样不随发行包分发，具体清单见 [发行配置建议](docs/distribution-config.md)。当前尚未执行发行打包，亦未移除 UI 中的测试入口。

预设链接来自 [pdone/lx-music-source](https://github.com/pdone/lx-music-source) 收集仓库及 [cdyUuu/lx-music-xinghai-source](https://github.com/cdyUuu/lx-music-xinghai-source)。感谢各脚本原作者和入口维护者。当前代码中的完整入口如下，顺序按 `src/ui/lxPresets.ts` 列出，不表示服务品质排序。

| 预设名称 | 脚本入口 | 许可与运行方式 |
| --- | --- | --- |
| 星海聚合 | [xinghai-music-source.js](https://raw.githubusercontent.com/cdyUuu/lx-music-xinghai-source/main/xinghai-music-source.js) | 具体脚本许可待核实；用户安装后运行 |
| 长青 | [changqing/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/changqing/latest.js) | 具体脚本许可待核实；用户安装后运行 |
| 六音 SixYin | [sixyin/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/latest.js) | 具体脚本许可待核实；用户安装后运行 |
| Huibq | [huibq/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js) | 具体脚本许可待核实；用户安装后运行 |
| 野花 Flower | [flower/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/flower/latest.js) | 具体脚本许可待核实；用户安装后运行 |
| 备用测试源 | [lx/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/lx/latest.js) | 具体脚本许可待核实；用户安装后运行，不将其认定为 LX 官方服务 |
| IKUN | [ikun/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/ikun/latest.js) | 具体脚本许可待核实；用户安装后运行 |
| 野草 Grass | [grass/latest.js](https://raw.githubusercontent.com/pdone/lx-music-source/main/grass/latest.js) | 具体脚本许可待核实；用户安装后运行 |

产品源码记录入口链接，不内嵌上述远程脚本正文。用户安装后，下载的脚本保存在本机并由独立兼容宿主执行。链接中的内容会更新，发行核对须针对实际下载版本检查脚本作者、版权声明、许可证及服务要求。

LX 的 Apache-2.0 不会自动覆盖第三方源脚本；入口收集仓库也不能自动授予每个脚本的再分发权。本文未确认上述各脚本的发行授权，也不保证服务持续可用。

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

## 已保存的通知与待核对项

Paper Shaders 的 LICENSE 与 NOTICE、上表可取得的运行组件许可证已按原文保存在 `licenses/`。这些通知需在发行流程中随对应组件保留；当前尚未执行发行打包。

尚待完成的事项：

- Folia / LX 相关实现的逐文件来源核对，以及由实际借用范围决定的许可处理。
- 用户提供卡片页面和各音乐源脚本的具体许可及再分发范围确认。
- `@tokenizer/token` 当前安装包缺少许可证原文，需补齐与安装版本对应的文件。
- 依据最终发行产物复核通知文件，包括 Electron 二进制内的 Chromium 等组件通知。
- 根据来源核对结果确定 Zenix 自有代码的整体许可证；当前未添加根目录 LICENSE。

本文是当前资料整理与依赖清单，不是完成代码来源审计或全部发行许可核验的证明。
