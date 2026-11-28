# Zenix × Zenbot 集成设计与主对话执行提示词

## 实施记录

### 2026-11-28 接入界面与人物交互 UI 修订

沿用阶段 `ZENIX-ZENBOT-20261127-01`。本次按用户要求应用 personal-frontend 的黑白中性视觉与本地前端经验，范围为人物设置、桌面人物操作、袖珍聊天和应用内聊天。默认仍为 Zenbot，可选 DeepSeek 鲸鱼娘，既存人物选择与 45%–125% 缩放继续读取。尺寸默认值仍为 70%，不覆盖用户已经保存的选择。

- 人物设置改为实景预览与控制并列的布局，提供小巧、标准、舒展预设、加减与恢复默认。滑块和预览手柄先更新预览，松手后调用原生保存，失焦不重复写入。保存失败恢复已保存的尺寸并显示错误。手柄支持指针捕获、窗口级移动与释放、Escape / 取消 / 窗口失焦终止，以及卸载清理。表情与动作使用中文名称。
- 桌宠使用紧凑悬停工具条、底部拖动手柄、右键互动菜单、拎起阴影和短暂的缩放百分比提示。操作工具条及菜单时暂停漫步。保留可信鼠标拖动、重力落地、轻触、抚摸、双击聊天和滚轮缩放。
- 袖珍聊天仍为 352×488 DIP，随屏幕工作区缩小并自动择边。使用浅色中性面板、人物身份、图标操作、用户气泡、复制反馈、等待动画、会话历史与整合式输入框。建议问题只填充草稿，不自动发送或播放。图片拖入提供覆盖提示，原生文件输入保持隐藏，真实确认和候选操作继续使用原有业务链路。重复的当前回复摘要不再在消息下方展示两次。
- 应用内聊天采用同一结构的深色版本，将大幅人物区缩为可点击的头像，语音与连接设置收拢到展开项。聊天通过 body portal 显示，修复从工作台打开后被主界面层叠遮挡的问题，并保留手机音乐空间的播放器、漫游与语音入口避让。打开时聚焦输入，关闭后恢复原入口焦点。新增动画遵守系统减少动态效果偏好。

本轮验证包含 49 项 UI 与相关功能自动回归，覆盖共用聊天、图片的三种输入、双窗口唯一确认、会话草稿、人物选择、拖动与缩放、设置写入失败、桌面及手机 1000 / 390 / 320 宽度、发送按钮实际命中、语音、播放器及音乐空间。最后新增的原生指针缩放与保存失败用例所在工作台回归为 9 项通过。另有 14 项凭据、模型传输与 Windows 系统加密测试通过。测试均使用隔离资料与 mock 模型。Windows 首次窗口缩放可能在下一原生 tick 才完成 DIP 高度更新，目录包测试等待真实底部坐标稳定后保持精确断言。

真实目录包检查进一步发现外层 `trustedApp` 提前拒绝了袖珍窗口的模型配置与附件请求。本次仅将该窗口加入 `assistant-model:invoke` 的外层窗口检查，主 frame 校验与内层动作白名单继续执行。新增目录包用例覆盖袖珍窗口实际设置读取、附件导入 / 预览 / 移除，并证明袖珍窗口直接请求模型仍被拒绝，模型与工具执行继续归唯一会话宿主管理。

`npm run package:dir -- --config.directories.output=release/zenbot-local` 通过，真实目录包入口验证输出 `ZENBOT_PACKAGED_PASS`，覆盖人物切换、底部位置、聊天入口、共享草稿落盘和悬停控件。`npm run android:build` 与 `assembleDebug --no-daemon` 通过。保留现有分块及 Gradle 提示，未以调低断言或隐藏错误方式通过验证。

视觉证据位于本地忽略目录 `release/zenbot-pocket-welcome.png`、`release/zenbot-settings-desktop-1000.png`、`release/zenbot-settings-desktop-390.png`、`release/zenbot-conversation-mobile-320.png` 和 `release/zenbot-packaged-pet-controls.png`。受管本地预览已使用更新后的目录包启动，入口仍为 `release/启动-Zenix-Zenbot-本地验收.cmd`，资料隔离在 `release/zenbot-preview-profile/client`。

真实在线模型效果与 Android 真机体验本轮未验证。未修改版本号、构建号、签名、更新清单或发行通道，未提交或推送。

### 2026-11-27 人物与鼠标交互补齐

用户随后明确默认人物为 Zenbot，移除星音设定，同时接入原交接文档中已有的 DeepSeek 鲸鱼娘。本决定取代本稿后文“星音默认、Zenbot 可选”的早期设计。应用内、桌宠和形象选择入口均使用 `zenbot | whale`，旧星音选项迁移为 Zenbot，既存聊天、密钥、曲库和资料继续沿用原有数据。

DeepSeek 女仆原版素材复用 63 个文件，保留其 AGPL-3.0-or-later 原文、署名、人物清单与模型坐标，独立 Canvas 渲染读取分件及五官。Zenbot 保留 19 表情、18 动作入口。当前两者使用 Zenix 的分件旋转与位移，原项目网格形变与次级物理细节仍有差异。

PC 桌宠默认沿显示器工作区底部移动，边缘转身，拖动时拎起并暂停行走，松手按原生鼠标最近采样速度产生有限甩动与重力落地。落地后恢复已开启的行走。窗口打开聊天、鼠标悬停、语音或模型任务、锁定位置、隐藏和减少动效均暂停行走。鼠标轻触和连续抚摸触发表情及文字，人物朝向随行走方向变化、视线跟随鼠标；双击打开聊天，滚轮缩放，右键菜单提供跳跃、招手、坐下、休息及站起。拖动与双击隔离，取消和失去鼠标捕获均结束拖动。交互使用独立受控 IPC，不触发音乐操作或模型请求。

Android 应用内同步两个人物选项，旧系统悬浮人物改用所选角色的本地 PNG。PC 底部物理与鼠标快捷互动由 Electron 桌宠承担，Android 系统悬浮人物沿用其原生触摸交互。

本次修订的定向回归共 54 项通过，失败和跳过均为 0，覆盖人物设置迁移、可信拖拽速度、底部转向与落地、鼠标缩放、PC/手机工作台、语音、播放器及更新提示界面。Zenbot 与鲸鱼娘均在真实 Electron Canvas 中完成解码、渲染与切换，实际目录包入口验证默认 Zenbot、鲸鱼娘切换和窗口底部位置，输出 `ZENBOT_PACKAGED_PASS`。63 个鲸鱼娘原始资源与来源文件 SHA256 一致，目录包的 9 个关键人物运行文件与当前源码一致。Android 同步构建与 Debug APK 编译通过，Android 真机触摸体验尚未验证。本地受管验收客户端已重新打开并显示底部人物。

阶段为 `ZENIX-ZENBOT-20261127-01`，基线为 `release/v1.4.0` 的 `24d3f25`。最低范围沿用本稿第 8 节，最终在线功能由用户在隔离客户端中配置服务后验收。

实际采用主窗口 renderer 中的唯一 `AssistantCoordinator` 持有会话和音乐业务执行权。主进程的 `AssistantChat` 校验窗口身份、路由有限命令并发布带顺序号的快照。袖珍窗口的入口单独加载，其运行时使用会话代理。主窗口启动时初始化宿主，原有托盘关闭行为使隐藏后的业务继续就绪。真正销毁宿主时清理待回执请求并向观察窗口报告离线。停止、配置改变及窗口销毁均使迟到回复失效。两窗口在同一事件轮次提交时也由同步门闩去重。

会话历史、草稿和图片关联采用原生版本化文件。桌面使用原子替换，Android 使用 `AtomicFile`。密钥沿用已有受保护配置文件。附件由原生解码、限制像素、缩放至最长边 2048、重编码 JPEG，并分配不透明 ID。预览返回受控的 JPEG data URL，模型请求由原生从 ID 读取图片。单图处理后 2 MiB、请求图片合计 8 MiB、编码请求体 12 MiB，附件磁盘预算 128 MiB。历史与草稿共同保留附件，最后一个关联删除后回收，超过一天的未引用孤立附件在读取历史时清理。

文字、图片和工具分别测试。普通图文问答按本轮文字意图决定是否提供音乐工具，已有音乐工具继续使用 registry、参数验证、对象引用、确认计划及 journal。K 歌导航进入既有工作台并展示选歌入口。当前导航工具没有附带歌曲引用参数，模型选中歌曲并直接注入 K 歌准备页仍缺跨模块受控选曲契约。

桌面与 Android 的模型协议均支持 typed content、受控附件、SSE 和完整 JSON。SSE 处理跨 chunk UTF-8、分片工具参数、完成标记、取消和回复预算，完整工具参数通过既有校验后才进入业务。配置包含回复长度、角色说明、音乐工具开关及显式 JSON 兼容方式。

Zenbot 导入 19 份精灵表情、18 份姿态、18 个 Rig 分件及 19 份 Rig 表情，保留清单和来源声明。77 个导入资源与源工作区逐文件 SHA256 一致。独立 Canvas 分件变换覆盖清单的 18 个动作入口，原项目网格形变与动作细节仍有表现差异。Rig 读取失败时使用原有精灵表情和姿态回退。默认形象沿用星音，Zenbot 由用户主动选择并持久化。人物大小独立保存，默认 70%，范围 45%–125%。

桌面提供人物双击、托盘和 Ctrl+Alt+C 入口，快捷键被占用时显示说明。袖珍窗口按人物位置与可用屏幕择边，最初尺寸为 352×488 DIP，草稿在收起后保留。Zenbot 提供可选的桌面漫游，初始关闭；打开聊天、拖动、锁定位置、语音和模型任务使用人物时暂停，收起聊天后恢复已启用的漫游。Android 使用应用内入口，系统悬浮人物仍沿用其既有原生实现。

开发验证使用临时数据目录与固定 mock 模型。真实服务的文字、图片识别质量、服务端 tools 兼容性、Android 手机图文与语音仍由后续实际环境核实。独立 Zenbot 的进程、配置及用户草稿保持由其原应用管理。

### 最终验证与本地交付

- `npm test` 最终一轮通过 483 项，失败、取消、跳过均为 0。第一次全量运行暴露既有展示引导测试在 rAF 聚焦前断言的时序问题，测试增加了等待原目标焦点生效的条件，保留原断言。定向复测及最终全量均通过。
- 新集成覆盖 UTF-8 与分片工具 SSE、截断和取消、密钥流式脱敏、图片引用与历史清理、同一事件轮次双重发送、草稿失败保留与版本隔离。真实 Electron 窗口使用原生图片处理，分别验证选择、粘贴和拖入，模拟模型通过真实 business adapter 的选曲播放、音量、睡眠定时与歌单确认计划执行，双窗口确认只提交一次。
- 19 个 Rig 表情可解码，18 个动作入口实际渲染，动作变换改变 Canvas 像素。启用桌面漫游后，打开聊天暂停位置变化、收起后恢复。77 个复制资源与源工作区的 SHA256 相同。
- `npm run build`、`npm run android:build` 和 Android `assembleDebug --no-daemon` 通过。Windows 目录包位于 `release/zenbot-local/win-unpacked`。额外从 `app.asar` 的真实主进程与构建入口启动，在全新临时资料目录验证人物 Rig、袖珍窗口、主窗口共享草稿与原生历史落盘，输出 `ZENBOT_PACKAGED_PASS`。
- 本地验收入口为 `release/启动-Zenix-Zenbot-本地验收.cmd`。它通过已有受管预览脚本加载本地目录包，资料放在 `release/zenbot-preview-profile/client`。模型配置由用户在这个客户端填写。公开版本与构建标识沿用当前源码基线 `1.3.0 / 59`。
- 本轮真实在线问答、真实音源播放结果及 Android 真机尚未验证。隔离模拟测试覆盖协议和客户端执行路径，在线模型效果与设备体验留给用户最终功能验收。

日期为 2026-11-27，Asia/Shanghai。
本稿由侧对话根据用户当前要求编写，供现有 Zenix 主对话直接接续开发。阶段标识为 ZENIX-ZENBOT-20261127-01。

## 1. 用户目标与交付范围

在 Zenix 内接入 Zenbot 的人物表现、袖珍聊天界面和图文输入体验，使用用户配置的模型服务地址、模型名称与 API Key 完成通用文字问答、看图问答，以及调用现有音乐工具。用户最后负责功能验收，接手对话负责设计落地、开发、必要自动验证和可运行本地交付。

本阶段采用直接模型 API 路线。范围外包括 Zenbot 网关、反向代理、多 Agent、Codex CLI/app-server 接入、全局聊天跟随、远程部署，以及 PR、推送、标签、Release 和更新通道操作。上述范围来自本次任务边界，未来用户可另行调整。

默认实施范围为桌面完整人物与小弹窗，Android 使用现有应用内助手入口承接共享图文会话和音乐工具。Android 系统悬浮窗、桌面漫游和开机自启另属原生能力。这个跨端分工是本设计采用的假设，接手时应清楚报告。

Zenbot 作为可选助手形象加入 Zenix，已有星音、换装、语音及已保存设置继续兼容。新安装或已有用户的默认形象沿用 Zenix 当前逻辑，用户选择 Zenbot 后持久化。此项是可逆默认方案，后续可按用户意见改为新默认。

## 2. 已只读核实的依据

### Zenbot 来源

实际目录为 C:/Users/17hwliao/Documents/ChatGPT/开源/codex-pet。
交接文件为 PROJECT_STATE.md，编号 HANDOFF-20261126-ZENBOT-POCKET-01。
本次核实 HEAD 为 32031a07a7e7aaa850f6248a17d41ea6b3140a7d，分支 main，24 个未提交路径与交接一致，交接列出的 12 个关键文件 SHA-256 全部匹配。

可复用事实如下。

- 19 表情、18 动作，Zenbot Rig manifest 为 18 部件，人物已经得到用户验收。
- 人物旁约 352×488 DIP 的小弹窗，屏幕边缘自动择边，收起常驻，打开时暂停漫游。
- 双击人物、托盘和 Ctrl+Alt+C 是现有入口。缩放默认 70%，可调 45%–125%，源应用用户保存值为 45%。
- 文字、选择图片、粘贴、拖放、附件预览、流式消息、停止、错误与审批展示已有实现。
- 原项目目录选择用于编程会话的 cwd。本次 Zenix 的抽屉主要承载会话和音乐入口，项目目录浏览无需成为模型问答前提。
- CompanionService 的事件归一化、发送锁、迟到事件隔离可供参考。当前真实会话 backend 为手动连接的 Codex，直接 API 图文问答尚需在 Zenix 实现。
- 源人物运行时 src/renderer/figures/zenbot-rig.js 引用了 ../kit/rig.js。kit/NOTICE.md 明确记录 body.js、rig.js 来自 Coopanion，带 AGPL-3.0-or-later 声明。Zenbot 精灵 manifest 的素材声明为 user-owned-local。
- 源应用的配置、用户数据、运行进程和草稿均由原应用管理。移植读取本地实际源码和未提交成果，目标使用 Zenix 自己的存储命名空间。

### Zenix 基线

目标工作区为 C:/Users/17hwliao/Documents/ChatGPT/Zenix-worktrees/ui-refresh-karaoke。
已核实分支 release/v1.4.0，HEAD 24d3f25，工作区干净。当前主对话 cwd 的 Music 目录仍在较早的 feat/assistant-xiaoyi-voice，实施前明确切到版本工作区。

现有入口包括以下文件。

| 文件 | 已有职责 |
| --- | --- |
| src/features/assistant/AssistantConversation.tsx | 主窗口助手、角色与语音交互 |
| src/features/assistant/AssistantCornerCharacter.tsx | 可拖动角落角色 |
| src/features/assistant/remote/ModelSettings.tsx | 服务地址、模型、API Key、保存与测试 |
| src/features/assistant/remote/coordinator.ts | 音乐助手会话、确认、取消与操作恢复 |
| src/features/assistant/remote/registry.ts、business.ts、validation.ts、references.ts、journal.ts | 24 项工具、真实业务适配、参数校验、对象引用与操作日志 |
| src/features/assistant/remote/runtime.ts、transport.ts、contracts.ts | 应用会话生命周期与原生模型传输 |
| electron/runtime/assistant-model.cjs、assistant-model-protocol.cjs | 加密配置、HTTPS Chat Completions、取消、有限响应与协议校验 |
| electron/assistant-pet.cjs、electron/main.cjs、electron/preload.cjs | 桌宠页面与窗口、IPC 接线，具体归属接手时核查 |
| android/.../AssistantModel.java、AssistantModelProtocol.java | Android 对应模型传输和校验 |

重要差异如下。

1. Zenix 已有 API Key 配置与受保护存储，因此本次扩展原入口和配置迁移。
2. 当前 ModelMessage.content 只接受 string/null，原生 request 校验也只接受文字。
3. Electron 请求使用 stream=false，响应接收完整 JSON。
4. coordinator 的系统说明限定音乐功能，并明确未开放通用问答。
5. 现有连接测试主要验证 tools 格式。需要把文字、图片、工具能力分别展示，普通问答可独立工作。
6. 主窗口 runtime 使用 renderer 内单例。单独桌面小弹窗无法仅靠复用这个 Map 获得跨窗口唯一会话，必须明确共享会话和工具执行的归属。
7. 其他旧工作区尚有未提交主题修复等内容，本任务保持其归属，不将旧工作区整体覆盖到 release 分支。

## 3. 用户流程与 UI

### 人物与入口

桌面使用 Zenix 当前桌宠窗口能力接入 Zenbot，新增形象选择。渲染与聊天解耦，idle、thinking、talking、tool-running、waiting-confirmation、success、error 对应既有表情和动作。说话动画随实际朗读状态变化，纯文字流式不冒称精确口型同步。

沿用 352×488 DIP 小弹窗的比例和紧凑黑白中性布局。可根据可用屏幕缩小，内部列表滚动，输入框、发送/停止与待确认操作保持可达。Ctrl+Alt+C 注册冲突时展示可理解的反馈，保留人物和托盘入口。拖动与双击区分，展开时暂停人物漫游，收起后恢复既有状态。Esc/×收起聊天，托盘退出遵守 Zenix 现有退出语义。

Zenix 与独立 Zenbot 分开保存角色大小、位置和窗口选项。导入形象不读取并改写原 Zenbot 的 45% 用户设置。源应用无需被结束或重启。

### 消息与附件

小弹窗保留消息历史、复制、图片缩略图、输入、发送、停止和会话抽屉。草稿按 Zenix 会话隔离，收起再打开保留；历史使用有版本的本地存储，凭据与消息分开。

图片支持文件选择、剪贴板粘贴、桌面拖放和移除。用户发送前看到缩略图与附件数量。发送成功前保留草稿，结果不明时显示状态并允许用户核对。不能自动重发可能包含工具操作的请求。

输入源可复用 Zenbot 每条最多 8 张、单张原始文件 20 MiB 的交互上限。另设解码像素、处理后大小和请求体预算，避免把原 256 KiB 文字限额简单扩大为无界内存。建议初值为单图最长边 2048、处理后单图最多 2 MiB、每条处理后图片总量 8 MiB、编码请求体最多 12 MiB。编码与裁剪后仍超额时逐图反馈，用户可以移除图片。主进程或可信原生层验证真实格式、解码尺寸和内容，拒绝 SVG/可执行内容与伪装扩展名。处理元数据按实际编码方式验证。

附件在原生层分配不透明 ID，renderer 使用受控预览地址；发送时由原生层读取受管附件，生成模型支持的 image_url 数据内容。用户选择的本地任意路径、远程图片 URL 与凭据不由模型自行指定。消息保留的已发送附件采用引用计数或等效关联管理，取消草稿清理只作用于未引用附件。用户删除某条历史时处理其独占附件，保留其他消息仍引用的内容。

首版图片回答以文字返回。现有模型返回图片的生成、主动截屏、桌面监控、扫描相册和自动上传另有授权时再做。

### 配置与回复

复用服务地址、模型、API Key 的当前设置，保留保存后不回显、清除密钥、换地址重新提供凭据、网络独立和系统加密失败反馈。配置变更使旧请求和旧回复失效。

在同一设置中增加简洁/详细回复偏好及有长度限制的自定义角色说明。用户说明位于应用固定规则之后，不能覆盖工具权限。沿用已有语音回复开关及晓伊 TTS 的取消和降级，不新增唤醒与全天录音。

配置页区分文字连接、图片能力和工具能力。测试是用户显式操作，展示是否会调用模型服务；测试材料使用固定样例。未知图片能力可以由用户明确选择尝试并发送，失败说明实际原因。模型不支持 tools 时，图文问答继续可用，现有本地音乐命令也可继续使用。

## 4. 架构与状态

推荐数据通路如下。

人物 / 主窗口聊天 / 桌面小弹窗
→ 统一 Conversation 会话与事件
→ 问答编排和受控工具编排
→ 原生模型 Transport + 附件库
→ 用户配置的 HTTPS 模型服务

工具编排复用 registry → validate → references → business → confirmation/journal 的真实业务链路。

### 单一会话与工具拥有者

接手时先核对现有主窗口关闭、隐藏、桌宠常驻和退出行为，再选择最小改动的唯一拥有者。

建议把 desktop conversation、请求取消、附件和消息历史放在主进程，以窄 IPC 向两个窗口发布有顺序号的快照/增量。现有音乐业务仍通过唯一已初始化的 Zenix 业务宿主执行，主进程负责受控路由。需要主窗口 renderer 时，使其按既有常驻语义保持业务就绪。若宿主不可用，明确返回暂不可执行，问答仍可运行。禁止在小弹窗重复初始化 player、personal store 或第二个业务执行器。

可复用当前 coordinator 并在其宿主保留业务逻辑，也可提取必要纯逻辑，但不把整体后端重写作为前置条件。提交代码前写清实际选择、宿主关闭后的行为、订阅与销毁语义。renderer 自己的单例不能被当作跨 BrowserWindow 单例。

建议公共消息采用 conversationId、turnId、messageId、clientMessageId、requestGeneration 和 typed content parts。附件用 attachmentId，工具消息保留 toolCallId。事件覆盖 started、text-delta、tool-pending、confirmation-required、completed、cancelled、failed。序号及快照负责重连去重，UI 收起只取消观察和录音，不等同于用户点击停止。

### 通用问答与工具

文字及图片默认按一般问题回答。有音乐动作意图时提供当前设备实际可用工具。固定应用规则始终约束模型，用户文字、图片 OCR、歌词、搜索结果与工具返回均作为数据处理。

图文只读提问不自动附带整个曲库、历史、音源配置或文件夹。需要歌曲上下文时查询有限摘要。模型使用对象引用，不能编造歌曲 ID、本地路径或确认 token。图片里出现“删除全部歌单”等文字，不构成用户对业务修改的确认。

每轮继续遵守现有最多一个明确状态/资料修改的契约，读操作可前置，创建歌单加曲目继续走既有组合能力。未知工具、失效引用、宿主错误、待确认、操作结果不明均如实呈现，模型不能自行批准。

### 协议与流式

首版继续使用现有 Chat Completions 兼容协议，保留 HTTPS 校验、正常代理与人工配置的最终服务地址。请求支持 typed text/image content，旧纯文字消息和已保存配置继续可读。原 256 KiB 文字请求预算独立保留，附件走专用预算及原生身份解析。

SSE 需要按增量 UTF-8 解码、跨 chunk 行边界、结束标记、EOF、错误、取消和大小限制实现。工具 name、id 和 arguments 可能分片，完整工具参数结束且校验通过后才进入业务层。半截工具调用不能执行，取消后的尾包不能追加消息或启动工具。

兼容服务可显式降级到完整 JSON。禁止一次已有增量或业务动作后自动重发整个请求。停止操作终止模型和语音，保留可辨认的中断消息；已提交业务按 journal 查询真实状态。图片描述的普通回复不依赖 tools probe 成功。

Android 的协议、序列化、附件选择和存储同步适配。模型密钥继续保存在原生保护层，界面只收到脱敏状态。

## 5. 现有音乐工具的接入清单

以下 24 项均来自当前 registry，需要沿用可用性、平台、确认和返回状态。

| 功能 | 已登记工具 |
| --- | --- |
| 上下文与查找 | context.read、music.search、music.query |
| 播放与音量 | playback.control、playback.set_volume、playback.set_mode、music.play_result |
| 歌单与收藏 | playlist.find、playlist.open、playlist.create、playlist.add_tracks、playlist.remove_tracks、collection.set |
| 歌词与页面 | lyrics.configure、navigation.open |
| 缓存、任务、联网 | cache.prepare、tasks.query、network.set_policy |
| 听歌辅助 | roaming.configure、stats.query、timer.configure |
| 协作、导出、更新查询 | device.transfer、backup.export_playlists、updates.check |

device.transfer 当前仅 Android，其他能力也按业务实际就绪程度开放。保留当前确认规则，不额外给播放、调音量等既有便捷动作增加确认，也不取消歌单修改等现有确认。

K 歌补齐一个明确的导航入口，并允许使用已有歌曲引用选择准备歌曲。进入页面或选歌不自动申请麦克风、自动分离伴奏或消费算力。新增工具只有在当前 K 歌业务确有受控可用入口时实现，沿用其状态反馈。若选曲跨模块契约不足，先完成“打开 K 歌并展示可选歌曲”的可用链路，明确记录具体缺项。

## 6. 人物素材与依赖

素材以 codex-pet 当前工作目录为准，复制必要 Zenbot 自有图、manifest 和来源记录到 Zenix 管理目录。不要直接依赖 C 盘源目录运行，目录包中必须可解析，Rig 失败能回退已有精灵动作。

src/renderer/kit/NOTICE.md 对复制来源和 AGPL 有明确声明。实施前逐文件识别依赖与来源，保留适用署名。当前默认技术路径是用 Zenix 独立的受控渲染层消费自有人物素材与 manifest，优先复用已能显示的精灵资源，并完成需要的分件与动作适配。不要无检查地拷入完整 kit 或鲸鱼娘，也不要在本任务顺手改变 Zenix 整体许可证。若完整 Rig 迁移确需涉及许可决策，具体列出文件和影响，同时完成不依赖该决定的问答、工具与小弹窗工作。精灵可用与 Rig 动态迁移分别记录证据，不用静态截图冒充全部动作完成。

不重新生成母版，不让用户重新验收原项目已经确认的人物美术。验收只观察本次嵌入导致的实际集成行为与必要回归。

## 7. 开发步骤与检查点

1. 在 release/v1.4.0 工作区核对 AGENTS、HEAD 与本地状态，保存本设计到项目已有 docs/design 合适位置。记录阶段最低标准。Zenbot 源仓库保持只读。主对话上一项分支分析已完成，新目标接续为本集成。
2. 扩展共享消息、附件、模型能力与回复偏好契约。先用纯文字验证旧配置和旧助手路径兼容，再接通附件 ID 与图文请求。
3. 完成原生模型流式、停止、异常分类与有限资源清理；接上 Android 对应契约。普通聊天与工具能力分别降级。
4. 把现有 24 项工具接入新的图文会话，复用确认、对象引用和 journal。补 K 歌导航最小入口。两窗口共享会话与单次工具执行。
5. 接入 Zenbot 形象和袖珍 UI，落地择边、缩放、收起、托盘与快捷键、会话抽屉和图片草稿。主体 UI 使用 Zenix 现有组件栈，避免复制另一套 Codex 后端。
6. 运行必要的协议、取消、图片、工具、窗口与存储回归。构建、目录打包验证目标资源，准备隔离的本地启动入口和可重复的验收清单。用户最终只需配置模型并验收功能。

阶段中连续完成已授权工作，不在每个小步骤后要求“是否继续”。stage-pilot 跟随同一阶段，只有真实阻塞或不可逆范围变化再打断。

## 8. 最低验收标准

| 标准 | 证据要求 |
| --- | --- |
| 配置与一般问答 | 从实际设置入口保存/修改/清除配置，旧配置可读，普通问题有真实模型回答。无 tools 的兼容模型可继续一般问答 |
| 图片问答 | 从选择、粘贴、桌面拖入至少覆盖主要入口，看到预览后发送，回答正确引用图片可见内容；不支持图片和超额输入准确反馈 |
| 音乐操作 | “播放和田光司的 Butter-Fly”“音量调到 30%”“20 分钟后停止”“把这首加入指定歌单”经真实工具执行；有歧义选候选，需确认的修改确认后执行且只执行一次 |
| 人物与跨入口 | 选择 Zenbot、打开人物旁小弹窗、边缘择边、收起再打开草稿保留，主窗口与小弹窗消息/确认/停止状态一致，人物动作跟随任务，关闭不会重复发消息 |
| 失败与兼容 | 401、429、超时、断流、取消、配置中途修改、附件清理、两窗口并发、取消后迟到工具等定向用例通过；普通播放、K 歌麦克风互斥及更新网络回归按改动边界检查 |

自动测试使用 mock 服务和隔离临时目录，覆盖真实生产入口与状态流转。已有 470 项 Zenix 测试和 Zenbot 129 项结果仅作基线，不代表新集成已验证。

真实模型调用需要用户已配置且授权使用的服务。无需把 API Key 粘贴到聊天，也不能读取原应用凭据来替用户选择服务。没有可用配置时先完成 mock、构建和本地运行入口，准确标明文字/图片/工具的真实在线验收缺口；用户在设置中填 Key 即可开始最终体验。付费调用保持固定小样本，不反复盲试。

若 Android 无设备，仅如实交付代码/构建与对应自动证据，标明手机实际图文和语音未核实。用户确认完成后按本地约定收尾，不追加用户层面补测。

## 9. 给主对话的执行指令

用户已明确要求本侧对话把设计和长任务提示词发给当前左侧主对话，由主对话负责实现，用户最后验收。请按以上范围在已有 release/v1.4.0 工作区开始连续开发，先核对当前状态，再把设计落地到现有文档体系并执行，不要停在再次给计划或要求用户重复确认。

保持修改聚焦本集成，复用当前分支，保护其他工作区未提交成果。Zenbot 源仓库仅用于只读取材。开发授权覆盖本地代码、必要测试、本地目录包和隔离预览。远端提交推送、PR、合并、版本构建号、签名、Release、更新清单和安装真实用户客户端需要对应明确授权。

遵守 Zenix 正常更新的长期硬约束及贴纸音乐空间边界，沿用原签名、包名和升级契约。新增助手权限与模型网络保持独立。

最终交付说明实际实现、关键路径、必要测试、本地启动或包路径和具体未验证项。不得把已有代码、mock 成功、构建成功或任务已派发写成真实在线图文与工具体验已经通过。
# 2026-11-28 Application companion correction

User clarification: the moving bottom character belongs inside the Zenix client,
not the operating-system desktop. The standard assistant UI no longer offers
"enable desktop pet"; it exposes the application character's visibility instead.
Normal application bootstrap and the local preview close a leftover legacy pet.
No desktop coordinate is migrated into client coordinates, and saved figure/size
preferences remain intact. The old native pet implementation remains only as a
legacy component exercised by its isolated regression fixture; it is not opened
by the normal application or preview flow.

`AssistantCornerCharacter` now owns bounded client-area movement, drag/release
gravity, bottom walking, edge turning, pointer/task pauses, position lock and
reduced-motion handling. Standard figure size controls affect this same in-app
character. Moving, scrolling and direction keys never write scale. Renderer
raster dimensions now use layout client dimensions rather than transformed
visual rectangles, and the character has explicit width/height; drag styling no
longer scales it. Resize observers are disposed with their renderer/host.

Focused evidence is recorded under ignored `release/app-companion*`: deterministic
client-coordinate physics plus a real React/Rig fixture exercises 18 repeated
vertical drags, ordinary wheel events, direction keys, explicit scaling, walking,
locking, window resize and chat activation. Normal scrolling on the legacy pet
is also silent with respect to sizing; legacy resizing requires Ctrl+wheel.

Verification: 11 focused character/drag/voice tests and 14 appearance/navigation/
workbench regressions passed; the isolated legacy wheel test passed. Production
build and Windows directory packaging passed. The actual packaged-entry smoke
reported `ZENBOT_PACKAGED_PASS`, including normal-startup assertions that the Rig
character is bounded inside the application and no native pet window exists.
The fixture then explicitly opens the legacy bridge solely for its regression.
The managed local preview uses `release/app-companion-launch.cjs` and the existing
isolated `release/style-preview-profile/client` profile. No installed-client data,
remote publishing, application identity or update configuration was changed.
