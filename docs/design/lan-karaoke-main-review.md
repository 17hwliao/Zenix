# 局域网 K歌 设计审阅意见

审阅基于本地代码核实，未修改生产代码。核对工作区：`feat/ui-refresh-karaoke`。

## 事实核对

两处文稿前提需要修正：

1. **分支基线并不落后。** 本地 `feat/ui-refresh-karaoke` 与 `main` 的 merge-base 是 `336fe91`（native remote music assistant，即含小伊语音的提交），等于 main 当前 tip。该分支 = main + 8 个本地提交。实施前只需 `git fetch` 确认远端无新 main，无需"基于最新主线重建"。
2. **单人练唱已经接进了正式入口。** `FeatureWorkbench` 的 K歌 tab 已指向 `KaraokePanel`（单人页），不是"只是测试夹具"。要隐藏它，需要动正式入口并同步更新 `Test-FeatureWorkbench` 现有的"七分类"断言，这是文稿里没提的实际改动点。

## 1. 可复用与必须新建

**直接复用：**

- `KaraokeLanHost` 全套：房号生成/冲突守卫、申请-审批-授权、令牌校验、心跳/超时/断线宽限/重连策略、快照广播、`tick` 生命周期。刚补齐的房主控制（`startQueueItem`/`pause`/`resume`/`skipCurrent`/`finishCurrent`）也可直接用。
- 协议封包与防御：信封校验、单调时钟、消息大小上限、事件限速、快照大小上限、`FORBIDDEN_KEYS`/敏感串扫描、`KaraokeLanWebSocketBinding` 抽象绑定。
- `KaraokeSession` 状态机：lobby/countdown/singing/paused/results + 三种 queue 模式类型已存在。
- 本地评分链路：`score-engine`、`adapter`（音高/节奏/歌词/完整度/气口）、MIDI/UltraStar/增强 LRC 解析。**本地评分不上网，保持现状。**
- `DesktopKaraokePage`/`MobileKaraokeRoom` 的骨架、样式和 props 契约可改造，但要注意与现有 UI 测试的兼容（见第 2 节）。

**必须新建：**

- 对战评分域：`score.line`/`score.snapshot` 事件、服务端校验/去重/聚合、公共比分计算。这是全新模块。
- 阵营字段：`KaraokeMember` 无 side，`KaraokeRoomState` 无 battle 对象，需扩展 contracts 并同步深冻结/归一化校验。
- 生产传输实例：socket 抽象绑定存在，但没有 PC 主进程和 Android native 的真实接线，没有 IP/端口发现层。
- 房主加入审批 UI、断线后客人本地补交缓冲、正式双端入口接线。
- 评级词与艺术字组件（当前 `KaraokeScore` 只有数值与 `feedback` 字符串数组，无评级词、无 grade/combo/confidence 持久化字段）。

**半复用需改：**

- `KaraokeLineScore` 已有 pitch/rhythm/lyrics/completeness/breath/total/feedback，接近设计字段，缺 grade、combo、confidence（combo 在引擎内部有，未入合约）。补字段比新造结构便宜。
- queue 模式 `relay`/`chorus` 在 session 里只约束 singerIds 存在性，没有段轮换、声部分离语义。设计的"接唱/合唱"不能假装复用这两个名字——语义要新实现或改名区分。

## 2. 与生产代码/分支/入口的冲突

- **单人练唱隐藏方式要定。** 移除 tab 还是设为开关？"七分类"测试断言必须同步改，否则 CI 红。
- **UI 组件契约冲突。** `DesktopKaraokePage`/`MobileKaraokeRoom` 是纯 props 组件，被 `Test-KaraokeUi` 以合成状态渲染。直接塞 transport 依赖会破坏现有测试。正确做法：保持页面纯 props，新增外部 controller（host/client 会话包装）注入回调，测试继续用合成状态。
- **小伊语音的麦克风互斥。** 语音助手与 K 歌录音抢 mic。需要 featureHost 层互斥：房间活跃时暂停语音助手监听，房间关闭恢复。文稿没提，这是真实冲突。
- **queue 模式语义。** 设计里"红蓝对战"不是现有任何 queue mode 的别名，建议新增 `battle` 模式或独立 overlay 状态，避免污染 solo/relay/chorus 已有含义。

## 3. 协议与状态模型修正

- **score.line 事件：** `{itemId, memberId, lineIndex, revision, lineScore(0–100 数值字段，允许 null), clientSentAtMs}`。去重键 `memberId+itemId+lineIndex+revision`。乱序接受、按 lineIndex 聚合。revision 绑定当前演唱 item，非当前 item 拒绝并返回结构化错误。限速需单独 bucket：一首歌约 60 句 × 2 人 / 3 分钟 ≈ 0.7 条/秒/人，现有通用限速值要核对是否够。
- **阵营：** `side: 'blue'|'red'|'none'`（听众 none），房主审批时分配。自动分配需保证蓝红差 ≤1，并留房主手动调换。
- **公共比分：** roomState 增 `battle: {mode, blueScore, redScore, leadingSide}`，房主聚合后随房间快照广播（复用 revision 机制，不单开事件流）。`blueShare`/`balance`/碰撞线位置由 UI 从 blue/red 现算，不进协议，避免双权威。快照大小上限要在加 battle + lines 后重新评估。
- **重连补交：** 客人本地保留 pending 行队列，reconnect 成功按序重发，服务端幂等去重；超过 disconnectGraceMs 的行丢弃并标"未评估"，不伪造分数。
- **结算：** `finishCurrent` 时房主把各成员 line 聚合成 `KaraokeScore`（复用现有结构）存 queue item，同时累加 battle 总分，results 页展示。
- **麦克风拒绝：** 本地引擎已支持 `pitch: null`，行分数仍可有 lyrics/completeness；UI 标"未评估"，协议不虚构数值。

## 4. PC / 移动端界面检查

- 艺术字动画必须响应 `settings.motion === 'reduced'`，入场回弹在减动效模式下要退化为淡入。这是现有主题/动效系统的硬契约。
- 手机是竖屏应用（Capacitor 布局）。设计稿"保持左蓝右红横向条"在窄屏会挤压，建议竖屏改窄条+顶部战况，或上下布局；这需要实机确认，文稿默认横屏假设不成立。
- 移动端音高曲线逐句渲染建议 canvas 而非 DOM 节点，避免长歌性能问题；碰撞线平滑用 CSS transform，不做每帧 setState。
- 战况条是新增区域，要遵守现有 `yz-*`/zenix 主题变量体系（`themeVariables` 已挂在 lattice 根上）。
- 错误 UI 沿用现有可关闭模式（参考展示偏好错误的样式与关闭按钮），避免用户此前反馈的溢出/关不掉问题复发。

## 5. 安全 / 性能 / 资源 / 可达性缺口

- score.line 输入校验：数值 clamp、NaN 拒绝、confidence 0–1；`FORBIDDEN_KEYS` 扫描要覆盖新事件（不允许 URI/token 入 payload）。
- 阵营分配算法、刷分限速、快照体积回归都要有测试。
- **可达性是最大缺口：** PC 房主 IP 列举（`os.networkInterfaces` 过滤非回环 IPv4）、端口固定范围、防火墙提示；Android 作 guest 需要 cleartext/WS 例外或确认现有 AES-GCM envelope 在明文 WS 上的安全边界；Android 作 host 涉及前台服务权限，建议 v1 不做（见第 7 节）。
- 资源释放清单：退出房间 = 释放 mic tracks、AudioContext、audio nodes、评分监听、WS binding、`mediaManager.closeMember`、计时器；房主停止广播 closed。现有 `Test-FeatureWorkbench` 有释放断言模式，LAN 版要补同等断言。
- 普通播放器隔离已有边界（独立 Audio），保留并加回归。

## 6. 实施顺序、文件范围与 Agent 职责

**顺序：** ① 核心协议/状态（纯逻辑无 UI）→ ② 生产传输绑定 + 审批 controller → ③ PC 页面接线 + 对战 UI → ④ 移动接线 + 竖屏适配 → ⑤ 全量 review + 双端协同测试。

**文件级范围：**

- 核心：`contracts.ts`（schema 扩展）、`session.ts`（battle 状态/聚合）、`lan/host.ts`、`lan/types.ts`、`lan/protocol.ts`、新建 `lan/score.ts`、`lan/battle.ts`
- UI：`ui/DesktopKaraokePage.tsx`、`ui/MobileKaraokeRoom.tsx`、`ui/components.tsx`、`ui/karaoke-ui.css`、新 `KaraokeRoomPanel.tsx`（transport 包装层）
- 入口/传输：`FeatureWorkbench.tsx`、新 `lan/transport-desktop.ts`、`lan/transport-mobile.ts`
- 测试：`Test-KaraokeLan.cjs`、`Test-KaraokeCore.cjs`、`Test-KaraokeUi.cjs`、`Test-FeatureWorkbench.cjs`、新 `Test-KaraokeBattle.cjs`

**五个 Agent：**

1. `lan_core` — contracts/schema、session battle、host mutations、去重聚合、限速，先行完成（其余全部依赖它的接口）。
2. `lan_transport` — socket 生产绑定、IP/端口发现、Android 网络例外、审批流 controller。
3. `lan_desktop` — PC 页面接线、战况条、艺术字、房主控制、motion 适配。
4. `lan_mobile` — 移动房间、竖屏布局、canvas 音高、触摸交互。
5. `review_verify` — 全量 review、断线/重连/双端协同、安全断言、资源释放验证，最后集中执行。

并发建议：`lan_core` 单独先跑完再并行其余三个；`review_verify` 收尾。

## 7. v1 应砍掉或延后

- **接唱对战（段落轮换）**——延后，语义实现成本高。
- **合唱计分**——建议延后或简化为"多人同唱按均值入各自阵营"。文稿说 v1 含合唱，但 session 的 chorus 语义未实现、声部分离需要新引擎支持，v1 只做红蓝对战更稳。
- **Android 作房主**——延后（前台服务/网络权限复杂），v1 固定 PC 当 host、Android 作 guest。
- **二维码邀请**——协议层 round-trip 测试已有，UI 组件没有；延后或用复制房号替代。
- **艺术字双层发光/渐变**——v1 单层动画，减动效模式必须生效。
- **移动端逐句 pitch 曲线**——延后，PC 保留。
- **观众弹幕/互动**——不做。
