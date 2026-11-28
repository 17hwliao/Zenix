# Zenix UI refresh and LAN karaoke boundary

## 2026-11-28 Stage UI Review

Scope: stage review of `ZENIX-UI-STYLE-20261128-03` and its required shared
surfaces/sound/window boundaries. Baseline HEAD is
`24d3f25e26edb27f477831a7d4f58342cfe2c7f6` on `release/v1.4.0`; the current
implementation includes uncommitted and new files. This is not a review of
the unrelated assistant model/backend changes in the same working tree.
No matching phase-gate ledger was registered; this existing design document
holds the review record instead of creating a new stage or replaying an offer.

Paths checked: desktop/home and its real library callbacks -> document
appearance owner -> versioned settings/localStorage -> native and React
same-origin consumers; desktop/mobile settings and portals -> sound
preferences -> delegated WAV/Web Audio feedback; desktop/mobile navigation
-> visual grid transition -> motion/cancellation cleanup; packaged native
window HTML/CSP and fixed-resource remote-page injection. The appearance
parser, write errors/corrupt bytes, owner release, frame fallback, structural
button exclusions and semantic selection/danger states were checked along
these paths. Business player, microphone, data ownership and updater paths
were checked only at these UI boundaries, not re-audited as entire subsystems.

| ID | Priority | Trigger, root cause and consequence | Fix and directed evidence |
| --- | --- | --- | --- |
| STYLE-R01 | P2 | Choosing 36px buttons on a coarse pointer let the more specific generic action rule override the mobile minimum. A real Chromium touch context measured 36.2px. | Apply the 44px minimum to all tagged text actions at matching specificity, leaving lyric/art/navigation geometry alone. The same context measures 44px; the Electron fixture asserts coarse pointer and actual action bounds. |
| STYLE-R02 | P2 | Another same-origin window changed mute/volume, but React sound panels only listened for a local custom event (the legacy settings panel did not subscribe). Persisted mute was false/enabled=false while the visible switch remained on, and a stale edit could overwrite newer fields. | Shared local/storage subscription updates both panels; edits merge current stored settings. Muting from another window also stops current feedback. Actual two-window tests cover both the compact panel and real desktop settings switch, mute and re-enable/volume. |
| STYLE-R03 | P2 | Auxiliary/remote `pagehide` permanently disposed appearance/listeners, with no `pageshow` restoration. Returning a document from the browser cache left no theme attributes or future propagation. | Idempotent start/stop restores the owner/listeners on cached `pageshow`, clears the old AudioContext reference, and refreshes an open editor. Browser lifecycle-event reproduction now retains Neon and receives a later Glass/cyan change; repeated cached `pageshow` is guarded. This is lifecycle-event simulation, not a claim of physical browser Back-button or all BFCache policies tested. |
| STYLE-R04 | P2 | Generic cut-button `::after` and border-reset rules were outside `@supports`; an engine without the proprietary mask could paint an opaque rectangle over the label. | Guard all cut-button overlays/resets with the mask feature check. A directed CSS fallback test removes mask-supported groups and verifies no covering pseudo-element and a retained ordinary border. Firefox itself was not run. |
| STYLE-R05 | P2 | The existing desktop “reduce motion” switch changed shell state but was not passed to the new canvas transition. With the switch on, 12 captured animation frames still showed an active wave. | Pass the effective reduce-motion value from both desktop/mobile hosts; include it in effect cancellation and the canvas display guard. The actual settings -> navigation test now observes a hidden transition. OS and space motion guards remain in place. |

Conclusion: all five findings are fixed and directed rechecks pass. The focused style/sound tests pass (3 tests, 0 skipped), including
schema and failed-write checks, actual React controls, native-peer storage
propagation, touch size, cached lifecycle restoration, motion switch, focus
return, semantic sounds and release of the last owner. Desktop TypeScript
and Vite, Android web and iOS web builds pass. The actual React mobile
playback regression passes with its 240-line lyric fixture, focus and camera
retention (no physical-device audio claim). The refreshed Windows directory
package at `release/style-reviewed/win-unpacked` passes the actual packaged
entry with `ZENBOT_PACKAGED_PASS`, including file-origin main/pet/pocket Style
propagation. Logs are under ignored `release/style-review`; the managed
preview uses `release/style-reviewed-launch.cjs` with the existing isolated
preview profile. Existing chunk warnings remain. `git diff --check` is clean.

Completeness: desktop/application pages, portals and auxiliary desktop
chrome share the Style system. This does **not** mean every screen has a new
layout: retained card/orbit/music-space layouts still exist. Android/iOS
OS-level widgets and native Android overlay controls have not been migrated
to these web tokens; they remain outside the completed implementation. No
physical-device audio-focus/mixing or live model/music call was performed.
No P0/P1 issue was confirmed in the reviewed UI scope; that is not an
assertion about unrelated backend modules or the whole repository.

## 2026-11-28 Blog Style migration

Stage `ZENIX-UI-STYLE-20261128-03` is authorized as a real application change.
Minimum scope: correct the homepage character geometry; migrate Default,
Glass, Neon, Paper and Sharp with six accents, default dark/red/Neon and
Chamfer frames; expose persistent button presets, radius, stroke, depth and
height through one setting used by desktop/mobile, portals, pocket chat and
auxiliary window controls; retain optional single-activation UI feedback and
independent volume; reuse the blog grid-wave transition without delaying
business actions or recreating player/tool owners. Sticker spaces, saved
profile artwork, lyric presentation, microphone ownership and updater
identity retain their existing contracts.

The source is blog commit `24813d93da2670ddd84b8f5533f2ef3f7f7fcc13`.
The two-page prototype approved in chat is a visual reference; production
counts, recent music and playlists must use real application state. The
homepage character is now a contained grid column with an explicit feet
inset, rather than an absolute image at the hero edge. Zenbot and the existing
optional whale renderer remain the only available characters.

`public/ui/appearance.js` owns a versioned, whitelisted preference and maps it
into the existing semantic `--zx-*` contract. Same-origin windows subscribe
to storage changes. Invalid stored bytes are preserved; a visible reset is
required before replacing them. Failed writes retain the previous applied
settings and report failure. First-run defaults do not reset saved choices.
The document owner is reference-counted and restores only owned attributes
and inline variables on final teardown. Lyrics/artwork layout is not masked
as a standard action button. Native Android system overlays/widgets are
outside the web renderer; their existing OS appearance remains independent.

Remote browser controls use their browser's own appearance namespace (not
the desktop's credentials). Fixed packaged UI resources are inlined under
the existing nonce, without adding an HTTP file-serving endpoint or changing
pairing, grants, origins or private-network checks. Auxiliary windows use a
short optional Web Audio tick; React hosts retain the existing local WAV
feedback and semantic deduplication. Dragging, typing and microphone hold
gestures do not emit extra button sounds.

Status: implemented and locally verified. `Test-ApplicationStyle.cjs` passes
the preference schema/corrupt/quota checks and real React controls, character
containment at 1440/900/640, five materials, other-window updates, persistence
across navigation, reset, reduced motion and focus return. The existing UI
sound fixture passes mouse, touch, keyboard, semantic deduplication, mute,
portal ownership and mobile audio isolation. The desktop navigation,
workbench, karaoke UI, lyric presentation, visual-theme and test-manifest
batch passes 20 tests. The final style/sound/navigation/LAN batch passes 17
tests (overlapping suites, totals are not unique coverage). The actual React
mobile playback case passes, including 240 lyric lines and preservation of
sticker focus/camera while opening and closing the player.

The mobile check initially caught lyric lines acquiring standard-button
minimum heights. Action tagging now excludes lyric rows, artwork, draggable
characters, switches, navigation and transport geometry. Local fixed settings
palettes were also removed so inherited theme tokens reach every settings
subsection. Selected and destructive actions preserve their semantic states.

Desktop TypeScript/Vite, Android web and iOS web builds pass (existing chunk
warnings remain). `release/style-local/win-unpacked` is a local directory
package. The actual packaged entry reports `ZENBOT_PACKAGED_PASS`, including
all eight desktop destinations, character rigs, attachment/credential gates
and shared drafts. It additionally verifies file-origin settings propagation
from the main window to both the native pet and pocket window, including an
18px native control radius, then restores the default palette. A real local
remote page was checked in Chromium: its nonce module loads, defaults to
dark Neon, changes to light Paper and applies a 19px control radius without
script errors. Remote authorization tests also pass.

No online model/music verification, physical-device audio mixing or upgrade
release is implied. Android/iOS system widgets and OS overlay controls have
not been restyled by these web builds. Local experience notes are kept
outside the repository. No commits, pushes, version/build identity changes,
release manifests or installer deployment are part of this work.

This change keeps the existing player, personal library and update pipeline as downstream consumers. It does not change package identity, build numbers or release metadata.

## 2026-11-28 Shared application surfaces and UI feedback

Stage `ZENIX-UI-SHARED-20261128-02` extends the approved desktop destination style to application chrome. The minimum acceptance scope is consistent neutral surfaces and controls across desktop settings, search, queue, profile editing, dialogs, tool panels, mobile settings/navigation, pocket chat and auxiliary window chrome; one feedback sound per click, touch or keyboard activation; retained mute/volume preferences; and preservation of music-space layout, lyric themes and native playback ownership.

Status: implemented and locally verified. The packaged Windows preview uses the updated assets and existing isolated preview profile.

`src/features/themes/application-surfaces.css` consumes the existing semantic design tokens. `useApplicationExperience` owns document-level styling and feedback listeners with reference counting, including portals and React StrictMode. Components retain their layouts and business actions. User backgrounds, sticker artwork/camera behavior and lyric-theme variables stay independent. The small static lyric-window stylesheet is included in the Windows package; music-widget and HTTP remote styles remain inline so their existing resource policies and routes are preserved.

UI feedback reuses `src/core/sounds.ts` and its local WAV files. Quiet delegated clicks yield to existing semantic enter/cancel/preview sounds, so a single action is not played twice. Disabled controls, typing, range movement, opt-out regions, karaoke controls and hold-to-talk are silent. Mobile unlocks its feedback context inside the activation callback and uses short Web Audio voices rather than HTML media players; it does not introduce a song player or MediaSession. Disabling sound invalidates pending decodes and stops active feedback. The final document owner releases listeners, timers and its audio context. Mobile settings now expose a persisted sound toggle, independent volume and preview.

Verification uses isolated Chromium/Electron profiles and existing mock bridges: `Test-UiExperience.cjs` covers mouse/touch/keyboard activation, semantic deduplication, portals, disabled controls, mute/zero volume, refcounts, pending-decode cancellation and mobile HTMLAudio isolation. Desktop navigation/player and workbench checks, the mobile React playback UI check, lyric presentation and theme contract checks cover the affected surrounding behavior. Desktop, Android web and iOS web builds are separate from native-device validation. Windows local directory packaging and actual packaged-entry checks cover settings/search palettes, eight destinations and pocket configuration. Outputs and screenshots remain local under ignored `release/` directories.

Passing verification entries: `node --test scripts/Test-UiExperience.cjs`; `node --test scripts/Test-DesktopNavigation.cjs`; the desktop player suite; the workbench native-destinations case and the targeted `actual lazy workbench` case; `node --test --test-name-pattern='real React mobile UI' scripts/Test-MobilePlayback.cjs`; lyric-presentation and visual-theme suites; `npm run build`; `vite build --mode android`; `vite build --mode ios`; local `electron-builder --dir --publish never`; and `ElectronZenbotPackaged.cjs` with a temporary profile. The packaged entry reports `ZENBOT_PACKAGED_PASS`. These checks are targeted coverage, not a claim that the entire repository test command was run. Existing Vite chunk-size warnings remain.

No live model requests, physical-device audio-focus tests, remote publishing, updater changes or release-upgrade acceptance are included. UI-sound trigger/volume tests do not claim measured speaker output or native-device mixing quality.

## 2026-11-28 Desktop native destinations

Stage `ZENIX-UI-NATIVE-20261128-01` covers the eight destinations in the desktop sidebar: likes/favorites, playlists, history, local library, karaoke, offline tasks, device collaboration and assistant settings. The desktop shell owns the selected destination. Collections use embedded management, and tools use one embedded FeatureWorkbench with its existing business bridges. The sidebar, playback dock and music-space entry remain available. Mobile and hosts without the desktop shell retain the existing workbench fallback.

The sidebar previously presented the newer home while downstream destinations used older manager/workbench chrome. Existing local work had begun embedding these destinations, but the previous preview package did not consistently expose the resulting pages. This revision completes the page styling and ships a refreshed local directory package.

The visual reference is the user's [blog source](https://github.com/17hwliao/17hwliao-blog/blob/main/src/styles/site.css), particularly `.button-dark`, `.button-light`, `content-arrive` and directional link feedback. Zenix reuses its own React stack and semantic `--zx-*` tokens. Controls use neutral surfaces, short hover/press feedback, directional arrows and bounded content entrance. No blog service, analytics, audio or character runtime is imported. System and application reduced-motion settings disable new motion.

Offline preparation and network policies form adjacent work areas, with the real queue and capacity below. Pairing, playback handoff, selected sync and request receipts keep their existing authorization semantics. Collection pages expose real counts, contextual tabs and playback without a second sidebar. Karaoke retains its independent microphone, audio and scoring ownership while adopting the desktop surface colors.

Acceptance checks cover all eight actual sidebar targets, one feature owner, absence of the legacy workbench modal, persistent playback dock, keyboard focus and return-home behavior, playlist creation and failed writes, local import/playback, and no downloads or device grants from navigation alone. Layout is checked at 1440, 900 and 640 pixels and at 200% zoom. Native sidebar scrolling and the compact selected indicator remain reachable at short heights. Model, update and release identities are outside this change.

Local screenshot evidence is stored under the ignored `release/native-destinations` directory. Test profiles and model/network fixtures are isolated from the user's actual library and credentials. Online music availability and physical device pairing are separate from these UI checks.

Verification completed in this revision: the related player, workbench, offline-task and collaboration batch passed 31 tests. The final desktop-navigation, expanded workbench and karaoke UI batch passed all 12 tests, including 1440 / 900 / 640 layouts, 200% zoom, reduced motion, failed playlist creation retaining the draft, local playlist management, and persistent playback-dock identity. These batches overlap and their totals should not be added as unique coverage. The default test manifest also passed. The production build and local Windows directory package passed, and the actual packaged main entry visited all eight destinations without a legacy modal, then completed the existing character, pocket configuration, attachment, credential-denial and shared-draft checks with `ZENBOT_PACKAGED_PASS`. Android web build and native asset sync passed. Existing chunk-size warnings remain.

No physical-device pairing, live model calls or release-upgrade acceptance was performed in this UI revision. No version, signing identity or update-channel change, Git commit or remote push is part of this delivery. The managed local preview uses `release/zenbot-local-launch.cjs` and the existing isolated profile under `release/zenbot-preview-profile/client`.

## Feature ownership

- Music-space display owns the versioned `sticker | list` preference, first-use onboarding and migration from `orbit` to `sticker`. It may update only feature-space state, presentation hosts and their tests.
- Visual themes own the versioned local theme package, whitelist parser, built-in themes and pure-lyrics presentation. Theme failures fall back to the default theme without changing queue or lyric data.
- Karaoke core owns immutable song/lyric/pitch/accompaniment descriptors and pure scoring. It never writes ordinary playback or personal-library state.
- Karaoke LAN owns host-authoritative room state, six-digit code confirmation, independent room grants, reconnect state and media signaling. A K-song failure must leave ordinary playback untouched.

## Persistence

Every local setting uses a versioned schema and atomic replacement. Unknown or corrupt values are reported without overwriting the original bytes. Repeated migrations are idempotent.

## Failure isolation

- Invalid display preference: fall back to `sticker`, retain the damaged value for diagnosis and do not show a second onboarding prompt.
- Invalid theme: use the built-in default theme; playback and lyric fetch continue.
- Missing accompaniment: return to single-player selection or ordinary playback.
- Microphone denial: play accompaniment without scoring.
- LAN failure: keep the local solo session and queue independent of the normal player queue.
- `FeatureWorkbench` opens the LAN karaoke entry. Desktop can host or join a room, and Android can join. The LAN controller handles admission, room snapshots and reconnects. Device-to-device acceptance remains open.

## Score contract

Trusted pitch references produce explainable line scores. Without pitch reference data, pitch is `null` and the UI must not claim professional intonation scoring. Default weights are pitch 45%, rhythm 25%, lyrics 15%, completeness 10%, and volume/breath 5%.

## Local-only scope

This stage does not push branches, create a PR, package an installer, or change an update channel. Real multi-device acceptance remains an explicit separate verification condition.

## 2026-11-28 全量 Review（本轮）

基线：`release/v1.4.0` / `24d3f25e26edb27f477831a7d4f58342cfe2c7f6`，包含当前全部未提交和新增源码。模式为 full：先梳理主要入口与共享状态，再做风险核实、最小修复和定向复核。没有把此前的人物专项验收或旧 470 项绿灯当成本轮证据。

### 主要路径与实际覆盖

| 路径 | 所有权与关键边界 | 本轮覆盖 |
| --- | --- | --- |
| 桌面入口 → application/App → ZenixShell/Workspace/FeatureHost | 主窗口持有播放器、资料和助手业务，侧栏与旧事件入口复用页面宿主 | 核对入口、导航/错误边界及播放宿主不重建；真实 React 回归 |
| Android MobileApp → native.command → ZenixNativePlugin/ZenixRuntime | 原生播放/存储持有状态，Web 只订阅快照；模型增量走独立事件 | 核对对应桥接、平台边界、插件增量；JVM 回归、Web 同步和 assembleDebug |
| 播放/本地曲库/漫游 → player/library/roaming → 音源/音频缓存 | 歌曲选择 revision、请求取消、队列与漫游代际分别管理 | 主要状态切换与失败路径静态核对；播放、替换、曲库、漫游自动回归 |
| 喜欢/歌单/私人资料 → personal/batch → 原子存储/恢复 journal | 保存失败保留原资料，批处理与恢复有写入屏障，确认来自用户 | 核对持久化、备份与跨设备合并关键接缝；资料/恢复/并发回归 |
| 音乐空间/搜索 → presentation/sticker → player | 聚焦贴纸与切歌/全屏分别控制，不以管理列表替代空间 | 核对模块入口与相关 diff；贴纸、搜索、空间偏好/展示回归 |
| 助手主窗/袖珍窗 → 单一 coordinator → registry/references/journal/business | 主窗口唯一执行工具；会话引用、确认、取消和迟到增量受控 | 核对 IPC、跨窗转发、工具权限、会话恢复；真实双窗 mock 模型集成 |
| 图文输入 → ChatWorkspace/history → 原生附件库/模型 SSE | 附件不透明 ID、独立限额；凭据在原生保护层；JSON/SSE 有取消和预算 | 核对存储/引用/错误恢复、流式拼包与配置修订；新增跨会话迟到附件复现 |
| 人物/主题/样式/声音 → DOM/Rig / appearance / sound | 人物只在客户区活动；位置无过渡；外观与声音订阅统一管理 | 既有人物测试、底部锚点/尺寸、跨页共享样式/音效和减少动画回归 |
| K 歌准备/单人/LAN → voice-lock/session/secure-channel → worker/socket/audio | 麦克风互斥；分离/曲谱取消与普通播放分离；房主授权、重连与抗重放 | 关键契约和生命周期静态核对；单人、准备、生成、加密 LAN/JVM 回归 |
| 更新/发行 → 独立可信网络 → 签名清单/下载核验/覆盖安装入口 | 音源网络与更新网络独立；原发行身份与递增约束保留 | 核对入口和构建签名门禁；下载/重定向/通道/发行契约回归；未发布或安装 |
| iOS 现有 Swift 桥接与更新入口 | 与桌面/Android 原生能力不同 | 仅入口和现有边界静态局部核对；无 macOS 编译或 iOS 设备验证，不宣称新助手能力跨 iOS 已完成 |

全量覆盖指上述主要功能链的审查，不表示逐行读遍全部源码或所有设备/网络组合。测试使用隔离资料，不读取正式客户端或原 Zenbot 凭据。

### 问题、核实与最小修复

| 编号 | 优先级 | 触发 → 后果 | 根因/修复与状态 |
| --- | --- | --- | --- |
| FR-01 | P1 | 袖珍窗开始导入图片，主窗切换会话，原图片迟到 → 被添加到新会话草稿，随后发送可能携带错误图片 | `ChatWorkspace.addFiles` 仅检查组件存活，没有检查会话归属。增加会话身份代际校验，在读取/原生导入完成时核对，失效附件走原有清理。真实双窗旧码得到 1 张、预期 0 张而失败；修复后新草稿 0 张且孤立文件清理通过。正常选择/粘贴/拖入及保留引用继续通过。 |
| FR-02 | P2 | 一个资料页渲染出错后切换其他资料页 → 仍显示上页错误 | 资料页共用 boundary key，失败状态不复位。按 page 变化仅复位失败状态，保留健康资料页组件实例，避免丢失新建歌单后的选中和加曲面板。旧码隔离错误注入失败，修复后错误页可恢复且原新建/添加歌曲流程通过。 |
| FR-03 | P2 | 临时保存故障已恢复，最新草稿已成功落盘 → 界面仍持续显示“保存失败” | `ConversationHistory.publish` 成功写入不清理此前错误。仅在真实 save 成功后清理；旧码可复现磁盘错误提示残留，新码通过且最新草稿内容保留。损坏历史保护仍由原生层拒写，不绕过保护。 |
| FR-04 | P2（验证链路） | 全套测试暴露 4 类不符合当前契约的验证问题 → 不能将旧绿灯当作当前可交付依据 | 拖动采样与 pointerdown 跨帧受下落影响，改同 turn 采样并按下；版本替换测试仍使用旧弹窗侧栏/关闭入口，改真实歌单卡片和首页导航；按钮几何写死 42px，改验证当前样式明确配置的高度（默认 40px）；Vite 测试页 client 连接到未配置的 WS，改绑定同一隔离 HTTP server。没有过滤异常、放宽跟手/贴底或恢复测试断言。 |

首轮 `npm test` 为 493 项、489 通过/4 失败。确认 FR-01/02 的原码反例日志为 `release/full-review-before.log`，FR-03 为 `release/full-review-history-before.log`。定向复核日志 `release/full-review-targeted-final.log`：32 项通过、0 失败。超窄合法图片作为反面边界在真实原生导入中通过，未据此改动图片处理实现。

### 最终验证与限制

最终 `npm test`：**494 项通过、0 失败、0 跳过**（414.84 秒），证据为 `release/full-review-20261128-final-tests.log`。FR-01/02/03 已修复并验证，FR-04 的四类回归问题已修正并通过；本次范围内没有已确认而尚未修复的问题。结论为本轮全量审查、最小修复及定向复核完成，不等同所有路径或真实设备均已验收。

生产构建、Android Web 构建/Capacitor 同步、Android `assembleDebug --no-daemon`（94 tasks）通过。Windows 本地目录包 `release/full-reviewed-local/win-unpacked` 通过；真实目录包入口检查输出 `ZENBOT_PACKAGED_PASS`，覆盖八个页面、应用内人物、双窗共享草稿、模型配置/附件入口白名单以及禁止袖珍窗直接请求模型。构建保留既有大 chunk 和 Gradle 提示。

最终 Windows 运行产物及关键主进程文件共 198 个逐字节核对与目录包一致，日志 `release/full-review-integrity.log`。Android 在最后共享会话修复后重新构建同步并编译通过（21 秒），不是沿用旧 Web 资源。受管预览当前为停止状态，本轮未强制重启；新包可由 `release/full-reviewed-local/win-unpacked/Zenix.exe` 启动，隔离运行仍可沿用项目受管启动方式。

模型集成为隔离 mock 服务，未声称真实在线模型/图片质量已验收；真实 Android 麦克风/双设备协作、iOS 编译/实机以及正式版本覆盖升级未在本轮验证。没有修改发行版本/构建号、密钥、更新清单或远端对象，没有新增人工验收要求。历史首次 Rig 就绪超时仍无确切归因，本轮不以 Defender/磁盘猜测替代诊断。
