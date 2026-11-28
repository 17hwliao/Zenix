# Zenix 应用内人物修复 · 外包交接与验收

```handoff-meta
{
  "id": "ZENIX-COMPANION-FIX-20261128-01",
  "project_root": "C:/Users/17hwliao/Documents/ChatGPT/Zenix-worktrees/ui-refresh-karaoke",
  "phase_key": "ZENIX-ZENBOT-20261127-01",
  "source_session": null,
  "target_thread_id": null,
  "status": "外包修复与主 agent 定向验收完成",
  "branch": "release/v1.4.0",
  "head": "24d3f25e26edb27f477831a7d4f58342cfe2c7f6",
  "files": [
    "src/features/assistant/AssistantCornerCharacter.tsx",
    "src/features/assistant/app-companion.ts",
    "src/features/assistant/conversation.css",
    "src/features/assistant/ZenbotCharacter.tsx",
    "src/features/assistant/SkinCharacter.tsx",
    "public/assistant/zenbot/renderer.js",
    "public/ui/application-style.css",
    "scripts/Test-AppCompanion.cjs",
    "scripts/fixtures/ElectronAppCompanion.cjs",
    "scripts/fixtures/AppCompanionUi.tsx",
    "scripts/fixtures/ElectronZenbotPackaged.cjs",
    "docs/design/zenbot-integration.md"
  ]
}
```

## 任务与阶段

2026-11-28（Asia/Shanghai），用户反馈上轮修复仍有两个问题，并明确要求将修复外包给其他 agent，由主 agent 负责验收。

1. 人物必须严格落在 Zenix 客户区的底部，不能悬在页面中间；移动边界为软件内部。
2. 拖动明显延迟，必须跟手。普通拖动、滚轮、方向键不能改变人物大小。

本次是当前集成阶段的定向修复，不新增全量 Review 或新功能。交付以修复源码、对应自动回归、主 agent 独立目录包验收和本地预览为准，不将自动化通过写成用户手感已经验收。

## 目录与版本

工作目录为元数据中的 worktree；环境默认 Music 是旧 checkout，命令必须指定正确 workdir 和 PowerShell。分支和 HEAD 见元数据。现场有 122 个已修改/新增路径，包含此前已完成的大量 UI、助手、模型与跨端工作，不能 reset、清理或整体覆盖。node_modules 为既有 junction，无需重装。

## 有效决定与限制

用户已授权其他 agent 执行本次修复，主 agent 执行验收。实现者只修改本次人物定位、移动性能及对应测试；结束后交回修改权。正常入口继续仅使用应用内人物；默认 Zenbot、可选鲸鱼娘，人物尺寸设置保持兼容。正常更新、安装身份和既有功能边界依项目 AGENTS.md。

本次不操作远端、提交、PR、标签、Release、版本号、构建号、签名及更新清单。不安装或读取正式客户端资料。实现者使用隔离测试资料，不自行重启交给用户的预览；主 agent 在验收后统一替换。无须再次征求是否继续。

## 成果与验证

上一轮已将行走、重力、拖动接入 AssistantCornerCharacter；应用正常启动关闭遗留独立桌宠，普通滚轮不再改大小。旧记录：11 项人物/拖动/语音、14 项界面、1 项遗留滚轮回归通过，构建和目录包通过。这些结果没有覆盖本次两个缺陷，不能直接复用为本轮通过证据。

本地受管预览可用 `node scripts/Desktop-Preview.cjs status` 查询。最近启动器为 `release/app-companion-launch.cjs`，目录包为 `release/app-companion-local/win-unpacked`，隔离资料为 `release/style-preview-profile/client`；不能依旧 PID 关闭进程。日志均在忽略的 release 目录。

## 未完成与风险

- 已确认：人物活动层 CSS 是 `inset:40px 12px 94px`，显式在底部留了 94px；初始定位另减 4px。旧测试只验证“小于底部”而没有验证“贴底”。需改成窗口底部并校验真正脚部，而非仅容器。
- 待实现者核实的强候选：`public/ui/application-style.css` 对所有 button 设置 transition-duration:140ms，而结构按钮没有限定 transition-property，初始值 all 可能令 left/top 连续插值、形成拖动滞后。通过真实 computedStyle 和立即位移断言核实，不把候选写成已确认。
- 当前每次 pointermove 和约 30Hz 物理 tick 都 setState，并写 left/top。建议移动使用不带过渡的 translate3d/DOM ref，只在状态或朝向变化时触发 React 更新；先核实、实现最小方案，不引入依赖或第二个渲染器。
- Rig 的 view 含透明边距，Zenbot manifest 有 feetY=256、view=[-28,-72,284,276]；底部画布边界不等于脚底。鲸鱼娘绘制 view 在 renderer.js 中生成。只在应用内人物启用必要的脚底对齐，不无意改变设置预览和聊天头像构图。
- 窗口放大时当前 y 不会自动重新贴底；需保留“原本落地的人物随地面变化”，而拖动中与空中下落不能被 ResizeObserver 强行拉回地面。

## 接续第一步

先核对实际分支/文件、AGENTS.md 和上述候选。实现者在本 worktree 直接修复，补有意义的生产入口测试并运行相关回归，最后报告修改文件、根因、测试命令及证据。不要提交或重启预览。主 agent 随后独立验收、构建目录包并受管更新本地预览。

最低验收：

1. 初始、停止行走、落地、缩小/放大窗口、显式调整人物尺寸后，人物脚底都紧贴客户区底部（允许自然步态约几像素），不在底部预留 94px。覆盖 Zenbot 和鲸鱼娘。
2. 使用鼠标可信输入或等效真实 DOM 事件，在同一帧/下一绘制帧检查至少多个来回位移，人物位置应与指针偏移一致；不只用长时间 sleep 后的最终坐标证明跟手。实际统一主题 CSS 必须加载，检查位置没有 transition。
3. 连续竖向拖动、滚轮、方向键不改宽高或 scale，松手落地、窗口边界、锁定、减少动态效果、聊天打开及拖动后不误点击保持兼容。
4. 运行 Test-AppCompanion、Test-AssistantDrag、Test-AssistantVoice；构建及目录包由主 agent 最终统一执行，避免重复高成本操作。

## 派发与验收回执

派发时：由 `/root/companion_fix` 负责源码与回归，主 agent 保留独立验收和预览更新职责。

实现者回执：已交回写入权，改为无过渡 translate3d、缓存边界、仅状态/朝向变化更新 React；活动层底部归零，两 Rig 与精灵回退独立对齐脚底，落地状态随窗口/人物尺寸变化贴底。报告 11 项定向回归、TypeScript、相关 diff 检查通过；打包、预览更新与最终验收由主 agent 接手，结果见下方最终回执。

主 agent 在旧目录包独立复现：窗口客户区高 902px，人物容器底部 808px，差 94px；可见脚底距底边约 114.83px。computedStyle 确认 transition-property 为 all、duration 为 0.14s。证据为忽略目录 `release/companion-before.log`，独立验收脚本 `release/companion-acceptance.cjs`。该脚本另测同一 JS turn 的拖动位移、原生可信鼠标、两形象、窗口变化和显式最大尺寸。旧包失败是预期复现，不作为新包失败证据。

### 主 agent 最终回执

外包实现者交回后，主 agent 已独立执行生产构建、Windows 目录包与实际目录包验收，输出 `COMPANION_ACCEPTANCE_PASS`。13 个地面采样覆盖两形象、三次窗口尺寸变化、两类拖动松手和 125% 尺寸：容器底部误差 0px，脚底可见像素误差 0–0.81px，位置过渡为 none / 0s。同 JS turn 的多个往返位移与原生可信鼠标捕获/移动/松手均通过；没有独立桌宠窗口。

验收脚本初次出现一次人物 Rig 就绪等待超时，原因未确定；同一字节目录包后续正常就绪。中间一次验收误将左边界外的负坐标当作预期，修正为客户区夹取规则后完整通过，没有放宽实际位移或贴地断言。上述过程保留记录，不以构建成功代替交互验收。

证据：`release/companion-acceptance.log`、`release/companion-acceptance/report.json`、`release/companion-acceptance/packaged.png`、`release/companion-final-build.log`、`release/companion-final-package.log`。本地目录包 `release/companion-bottom-local/win-unpacked`。受管启动器已改为 `release/companion-bottom-launch.cjs`，沿用原隔离预览资料，旧受管实例正常退出。

本轮修复、自动回归与主 agent 的目录包定向验收已完成；用户主观拖动手感及 Android 真实设备本轮未验证，不追加人工验收要求。未提交、推送、发布或改动正式资料/更新身份。本文件可直接交给后续 agent 接续，无须重新梳理全项目。

### 2026-11-28 交接后独立复验

用户转交只读核实报告并明确要求验收后，主 agent 再次运行定向回归与真实目录包检查。初次回归为 10/11：语音 UI 测试在 pointerup 后才断言拖动中心坐标，实际已进入惯性移动（627 对预期 650）。修正测试时序，将精确跟手断言放在 pointermove 后且松手前；另在缩窗后的下一次点击前等待落地并将底部断言收紧为 1px。未修改生产源码或放宽跟手断言。复验结果 11/11，通过日志为 `release/companion-handoff-accept-tests.log`。

实际目录包再次输出 `COMPANION_ACCEPTANCE_PASS`，13 个地面采样、两形象、同 turn 位移、原生鼠标和最大尺寸均通过；本轮未出现就绪超时。日志为 `release/companion-handoff-accept-package.log`。对当前 dist 的运行文件（排除打包不包含的声明文件）及主进程、preload、assistant runtime 共 198 个文件逐字节比对，均与目录包一致，证据为 `release/companion-handoff-integrity.log`。本轮只改测试，沿用已核实字节一致的目录包，受管预览保持原实例运行。

历史首次就绪超时的具体原因仍未确定；Windows Defender、冷磁盘 I/O 均未取得证据，不能作为事故归因。本轮验收结论仅覆盖上述应用内人物链路，不扩展为真实模型、Android 实机或完整软件验收。

### 2026-11-28 用户人工验收反馈修复（打开会话保留底部人物）

用户人工体验反馈：点击底部人物弹出应用内会话时，底部小人会消失，体验变差。

- **根因**：`AssistantConversation.tsx` 沿用了旧逻辑 `hidden={open}`，展开会话时直接隐藏 `.assistant-corner-layer` 并卸载人物渲染。
- **修复**：
  1. `AssistantConversation.tsx` 改为始终保持底部人物可见（仅用户显式开启隐藏设置时才隐藏），点击人物支持切换展开/收起会话（拖动不误收起），悬停提示随展开态切换为“拖动移动 · 点击收起”。
  2. `AssistantCornerCharacter.tsx` 在 `chatOpen` 期间自动暂停漫步并转身面向会话面板，收起后恢复漫步；通过 `document.documentElement.clientWidth` 计算客户区宽度上报锚点，消除纵向滚动条导致的偏移。
  3. `app-companion.ts` 新增 `companionChatRight`，按人物当前水平位置在左/右侧就近排布 `.assistant-chat`（12px 间距，窄视口夹取且面板层级高于人物层）。
- **验证与更新**：11 项人物/拖动/语音回归与 10 项工作台回归全数通过；已重新执行 `npm run package:dir -- --config.directories.output=release/companion-bottom-local`，真实目录包独立验收输出 `COMPANION_ACCEPTANCE_PASS`（新增 `chat open keeps companion visible` 地面与无遮挡断言，截图证据 `release/companion-acceptance/chat-with-companion.png`）。
