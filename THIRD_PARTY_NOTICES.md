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

## 参考项目和音乐源兼容

- LX Music Desktop：官方仓库当前为 [Apache-2.0](https://raw.githubusercontent.com/lyswhut/lx-music-desktop/master/LICENSE)。Zenix 保留自定义脚本接口的兼容行为；本次未拷入 LX 应用、窗口架构或 Git 历史。本次源运行器、流缓存、网络管理和有界缓存模块在 Zenix 内实现、拆分。既有目录适配器与兼容层如包含先前借鉴的代码，应在发行核对时保留其归属、许可证及修改说明；重构并不会消除原有许可义务。
- Folia Major：官方仓库当前为 [AGPL-3.0](https://raw.githubusercontent.com/chthollyphile/folia-major/main/LICENSE)。本次未读取或搬入其代码、素材或 Git 历史。既有 UI 与素材的来源不能仅凭此次性能重构证明；发行前需要按实际来源核对，不能自动认定为已全部独立创作。
- 用户导入的音乐源脚本有各自作者和许可证；LX 的 Apache-2.0 不会自动覆盖第三方脚本。当前功能继续加载用户本机已安装脚本，本次未把这些脚本打进产品源码。

## 本次保留的通知

Paper Shaders 的 LICENSE 与 NOTICE、其他组件的许可证已按原文保存在 licenses/。这些通知需在发行流程中随对应组件保留；当前尚未执行发行打包。
