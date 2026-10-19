# 本地代码 Review：歌单平台平替与 Windows 安装兼容

日期：2026-10-17。基线：当前 main / ef96204 上的未提交改动及新增文件。结论：发现 6 项可确认问题，P1 两项、P2 四项；当前实现尚不宜作为已完成修复发布。

**2026-10-18 更新：上文为首轮历史结论。用户已批准全部修复、必要测试与第二轮 Review；修复结果见文末。本轮仍只保存本地。**

本轮仅审查和保存证据，没有修复业务代码、提交、推送、打包、切换更新清单或操作测试手机、已安装应用及真实用户资料。

## 范围

覆盖本次工作区中的 PC / Android 导入播放与平台平替、三次额度、取消和状态写入、缓存及队列上下文、资料清洗、Windows 原生进程检查和旧卸载器暂存兼容，以及相关 UI、桥接、类型、构建配置和测试。继承的 r43–r45 状态驱动播放调整也按调用链核对。本次不是全仓库历史代码审计。

未见本轮修改 updates、config 或 .github/workflows。原签名、公钥和发布通道未操作。当前 package / Gradle 的 45 是先前已安装的本地构建身份；新功能如获准打包仍须使用 46 或更高，不能以 45 制造不同字节的新工件。

## 1. [P1] 第三次扫描成功的候选在实际播放时被额度检查拒绝

位置：`src/core/platformReplacement.cjs:35`，调用方 `src/core/desktopReplacement.ts:45`；Android 对应 `PlaylistReplacement.java:15`、`:32` 起的 resolve 路径。

触发：扫描前两次失败，第三次得到音频响应，保存 `status: pending / attempts: 3 / target: 有效候选`；随后点击播放。

结果：播放器重新进入 run，先检查 attempts >= 3，尚未采用已经成功的 target 就抛出“本轮已尝试3次”。PC 的源解析调用次数为 0，Android 实际 resolve 入口也被同一检查挡住。用户看到“待播放验证”，但无法播放；取消/续接持久化三次次数本身并不能解决此问题。

证据：隔离 PC 探针执行当前 resolveReplacement，Android JVM 探针执行当前 PlaylistReplacement.resolve，均复现。现有测试只验证三次耗尽，或直接调用 played 标记成功，没有覆盖第三次扫描成功后进入真实播放解析的衔接。

最小修正方向：区分“新增候选尝试”与“采用已通过响应检查的候选”，定义扫描结果到播放器的交接和必要 URL 刷新规则。不能简单提高次数或每次播放无条件清零，否则会绕过三次约束。增加双端扫描第三次成功 → 点击播放 → 解码失败时停止/有限恢复的闭环检查。

## 2. [P1] Android 复用缓存绕过当前平替关联，恢复原曲仍可能播放旧替代

位置：`PlaybackService.java:148`、`:153–157`。

触发：原曲 A 使用替代 B 播放并缓存；之后恢复原曲、选择 C，或在另一歌单以不同策略播放同一个 A。

结果：resolveNext 在读取当前歌单关联之前调用 reusableCache；映射只按 A 的原曲 ID 查找，完整缓存直接返回 B，不检查当前 playlistId / replacement target / replacementKey。恢复操作只改 personal 记录，未改变这项缓存资格。completeCachedForInspection 使用同样的原曲 ID 判断，也可能把旧替代缓存视为当前原曲已可用。

证据：JVM 探针逐字提取当前生产 reusableCache 方法，在原曲已没有 replacement 关联、完整缓存指向 B 的条件下，仍返回 `substitute-B / cacheHit: complete`。缓存底层使用受控替身，因此证明的是缓存选择错误，不代表实机声学验收。

最小修正方向：缓存复用先核对当前歌单和有效关联身份；区分原曲与替代版本的映射。恢复/改选只失效相关映射，不删除其他用户缓存。补充恢复原曲、改选 C、同曲跨歌单三个检查。

## 3. [P2] 重新匹配的重置写入期间取消，随后仍会启动新解析

位置：`src/ui/PlatformReplacement.tsx:25–27`。

触发：点击“重新匹配”，等待清除旧关联的 mutate；此时点击“取消任务”或离开页面。

结果：这时尚未创建当前 AbortController，取消只设置 stop。mutate 返回后没有再次检查 stop / mounted，继续创建未取消的控制器并执行 inspect。新解析可在用户取消后启动和保存结果。共享面板使 PC、移动端都有此入口。

证据：隔离执行从生产文件提取并转译的完整 run 函数，在重置 Promise 等待时执行与取消按钮一致的 stop/abort，再放行写入；观察到 1 次取消后新 inspect，传入信号未被取消。未启动真实 UI 或音乐源。

最小修正方向：为整轮任务在首个 await 前建立取消身份，重置返回后、启动 inspect 前再次核对；卸载和换歌单也使用同一任务身份。补充取消发生在重置写入期间的检查。

## 4. [P2] PC 已排队的最终关联写入不会被取消阻止

位置：`src/core/desktopReplacement.ts:12`、`src/core/platformReplacement.cjs:34`；实际等待点 `electron/personal.cjs:105–107`。

触发：候选响应检查完成，最终 pending 状态调用 personal.batch，但 batch 正在等待 backupBarrier；用户此时取消。

结果：adapter.save 不携带可在提交处核对的任务身份。barrier 解除后仍写入新 target，随后 shared persist 才检查 signal 并报 AbortError。界面显示任务已取消，资料中却出现取消后提交的新关联，违背实现说明中的“丢弃迟到结果”。正常已完成结果和已用额度可以保留，但不能只凭 promise 最后报取消就认定没有迟到写入。

证据：使用真实 PersonalStore，仅操作诊断目录中的合成资料；取消发生在最终 save 已排队、尚未通过 barrier 时。结果 `promiseAborted: true`，但 `associationWrittenAfterCancel: true / status: pending`。

最小修正方向：将任务取消核验放到实际原子提交边界，在 barrier/队列等待之后、修改资料之前完成。现有 expectedReplacement 能防其他编辑冲突，不能表达取消。保留取消前已占次数，拒绝取消后的最终目标提交。

## 5. [P2] Android 队列撤销会清掉全部歌曲的歌单上下文

位置：`PrivateStore.java:105`；受影响调用方 `QueueEdits.java:11 / :18`。

触发：从导入歌单播放，整理队列时移除歌曲再点击“撤销移除”；next/enqueue 也使用同一清洗函数。

结果：新增 cleanTrack 清理 playlistId 用于避免资料集合携带临时上下文，但 QueueEdits.restore 对每个队列条目也调用它。只有 setQueue 手动恢复 playlistId，队列编辑路径没有恢复。后续选中这些歌曲时 PlaylistReplacement.context 找不到歌单，直接走原曲源解析，绕过该歌单的自动平替和已保存关联。原曲和歌单条目未被删除，但播放行为丢失。

证据：核对 QueueEditor 的真实撤销入口传回原队列快照；JVM 使用当前生产 QueueEdits 和逐字提取的 cleanTrack 执行 restore，playlistId 从 one 变为空。既有测试替身 cleanTrack 只是复制 JSON，未覆盖新增清理行为。

最小修正方向：区分个人资料清洗与播放队列清洗，队列编辑保留必要 playlistId；不要把临时播放标记写入喜欢/收藏/历史。补充移除 → 撤销 → 切下一曲及 next/enqueue 的上下文检查。

## 6. [P2] 旧卸载器改名不能跳过前置 PowerShell 检查

位置：`scripts/Prepare-WindowsInstaller.cjs:18`；上游模板 `allowOnlyOneInstallerInstance.nsh:32–54`，旧卸载入口调用完整 CHECK_APP_RUNNING。

触发：旧正式包使用 electron-builder 26.15.3（本地 r28、r42 标签 package.json 均已核对）；机器的 PowerShell 启动、profile 或前置可用性查询发生挂起。

结果：改名为应用可执行文件名只绕过 _CHECK_APP_RUNNING 内的实际 CIM 进程查询。完整 CHECK_APP_RUNNING 在进入此分支前仍调用 IS_POWERSHELL_AVAILABLE，其中两个 nsExec::Exec PowerShell 命令没有超时，也没有禁止加载 profile。新安装器的 ExecWait 仍可一直等待旧卸载器。这不否定已避开原 Win32_Process 查询的作用，也不证明普通机器每次升级都会卡住；缺口是仍依赖可能不返回的旧 PowerShell 前置流程。

证据：构建并执行惰性 NSIS 探针，以兼容暂存文件名执行当前模板的完整 CHECK_APP_RUNNING；只将前置检测和 FIND_PROCESS 换成标记，结果前置标记出现、CIM FIND_PROCESS 标记未出现。没有运行 PowerShell、真实卸载器、注册表修改或用户应用。现有 Windows 测试只执行 _CHECK_APP_RUNNING，未覆盖前置检测，因此通过不能排除此问题。

最小修正方向：针对旧卸载器完整启动链设计可取消、可恢复的受控迁移，避免无限 ExecWait；同时保持旧二进制原字节、KEEP_APP_DATA、--updated 和签名链。不能以强杀播放器、删资料或直接略过卸载器代替兼容处理。测试应从完整 CHECK_APP_RUNNING 入口覆盖旧前置流程，而非只测内部宏。

## 验证和边界

本轮没有重复跑全套测试；复用实现阶段已有结果，只针对上述疑点执行最小隔离复现。原有核心、UI、JVM、更新和构建的通过记录属于实现阶段证据，不代表上述状态衔接已经覆盖。

本轮私有证据目录：`release/diagnostics/review-platform-20261017/`（被 Git 忽略，不上传）。

| 回执 | 验证内容 |
| --- | --- |
| pc-result.json | 第三次成功扫描后播放被阻止；取消期间排队写入仍提交 |
| native-result.json | Android 第三次播放入口被阻止；恢复原曲仍命中旧替代缓存 |
| boundaries-result.json | 重置期间取消后仍启动 inspect；队列撤销丢失 playlistId |
| legacy-result.json | 完整旧检查宏仍进入 PowerShell 前置分支，内部 CIM 查询已绕过 |

未发现本轮直接删除原曲、歌单、喜欢或收藏的路径；这不抵消关联、缓存和队列上下文的上述保留问题。未进行手机测试、真实安装升级、真实备份恢复或线上源逐曲验证，不能把隔离探针写成完整升级验收。

后续最有依据的改进是补一条跨边界状态回归：扫描 → 实际播放 → 缓存 → 恢复原曲/取消 → 队列撤销 → 资料重载。当前用例分别覆盖局部成功，却漏掉了交接；先补这一条，不需要增加计时中断或全局重构。

## 2026-10-18 修复与第二轮 Review

沿用 main 和全部既有工作区改动，没有提交、推送、创建分支/PR、生成产品安装包、切换更新清单或操作设备及真实用户资料。

| 首轮问题 | 当前修复 |
| --- | --- |
| 第三次成功不能播放 | PC resume / Android resolve 将已接受候选的 URL 交接与新增候选分开；pending 第三次成功可采用，不占第四个候选。接续中明确失败清除 target，只在剩余额度内尝试下一候选；第三次解码失败后停止。verified 关联新起播占新轮第 1 次，暂停和取消不清零未完成轮次。 |
| Android 旧替代缓存 | 完整缓存、片段复用及扫描检查先核对当前 personal 中的目标、replacementKey 与 cachePlaylistId；恢复、改选、跨歌单均拒绝不合资格的旧缓存，不删除用户缓存。缓存命中也登记 replacement-active，解码失败不能重新采用同一失败目标。 |
| 重置期间取消 | 首个 await 前建立控制器，返回后检查取消/卸载；PC 与 Android 重置操作也携带取消身份，尚未提交的重置不会在取消后丢掉原关联。 |
| 排队写入取消 | PC renderer → preload → main → PersonalStore 传递请求取消，在 backupBarrier 之后、同步修改资料之前核验。Android 在真实 store 锁内及提交前核验。取消前已完成的原子提交和已占次数保留，取消后尚未提交的新目标拒绝写入。 |
| 队列上下文丢失 | 新 queueTrack 保留 playlistId，仍清掉临时播放标记；setQueue、restore、next、enqueue 共用队列契约。资料集合继续通过 cleanTrack 清理临时上下文。 |
| Windows 旧前置检查挂起 | 暂存旧卸载器原字节和应用文件名不变；CreateProcess 挂起创建后，先加入只允许一个进程且不可脱离的 Job，再恢复执行。旧前置 shell 创建立即失败，文件名豁免跳过后续 CIM 查询，标准卸载主体继续处理。建立保护失败则停止；不强杀播放器或已开始迁移的卸载器，不在迁移中途按计时器终止。 |

Job 的子进程继承和限制行为依据 [Microsoft Job Objects 文档](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。保留 /KEEP_APP_DATA、--updated、_?=、退出码、标准签名流程；不修改 node_modules。契约检查在上游模板发生相关变化时使构建失败。

第二轮核对上述修复、桥接/取消、同步提交、候选交接、缓存、队列、NSIS 启动和相关测试。另确认 PC 的 source: 原曲 ID 也可能接收替代缓存别名，已在本范围内修正为候选自身缓存身份并补测试；普通同录音备用解析的原缓存契约不变。接续成功也检查状态 CAS，避免解析期间恢复/改选后采用迟到关联。

**收尾结论：本次聚焦范围未发现尚未解决的可确认问题。** 不扩大为整个项目无缺陷，也不作为真实升级链路验收结论。

### 必要测试与边界

- 平替 13 项通过，含真实 React 面板、取消/离开、第三次扫描到实际播放入口、无第四候选、版本确认、任意时长待完成、缓存与资料重载。
- 资料保护 6 项、播放器/源回归 34 项通过。PC 取消用例执行当前 main 处理器与真实 PersonalStore，验证原曲顺序、次数、喜欢、收藏和磁盘重载。
- Android JVM 调度/平替检查通过。执行生产调度与平替类、提取的生产缓存/清洗方法，以及实际 personal 同步入口和 mutator：在 store 锁等待期间取消后不写资料，未取消时可正常提交。磁盘加密、平台和解码边界为隔离替身，不是手机声学测试。
- Windows 更新入口 13 项通过，其中包含完整历史 CHECK_APP_RUNNING 与实际可用性宏；受控 shell 标记没有启动，迁移参数、原字节、退出码和新旧原生进程检查符合断言；标准安装器/卸载器隔离编译通过。未执行已安装产品的卸载器。
- 移动综合 React UI 1 项、TypeScript、双端 Web 构建、Android Release Java 编译通过。Web chunk 体积及 Gradle 弃用提示仍保留。

初次 Windows 启动器因 NSIS System 返回寄存器写法错误返回 -1，改为 i.R0 后通过，未放宽退出码断言。资料旧夹具未接入新依赖导致一次失败，补齐“暂停恢复不得确认播放”的严格替身后原断言通过。新增 Android 锁提交测试首次缺 expected 参数，补齐真实请求字段后通过，保留首次失败日志。中断时无回执的测试不算通过，只补跑缺少结果的相关入口。

本地忽略回执目录：release/diagnostics/replacement-fix/。platform-final.log 为最终平替 13 项；platform-store-final.log 为平替当时 12 项及资料 6 项；native-final.log、regression-final.log、mobile-ui-final.log、android-compile-final.log、web-build.log、android-web-build.log 保存对应结果。update-store-tests.log 中 Windows 13 项通过，但附带的资料测试曾失败，后者由 platform-store-final.log 中通过结果覆盖，不能写成首次全绿。

未运行真实手机安装、旧正式客户端覆盖升级、线上逐曲和真实备份恢复。用户已确认完成的用户层面测试按长期约定跳过；这些自动化结果不冒充实机证据。不改签名、公钥、版本号或线上通道，新产品工件仍必须使用 46 或更高构建号。

后续可选改进：将这些交接用例保留在现有回归入口，优先防止夹具简单复制 JSON 掩盖生产清洗/提交契约。本轮已将相关测试接回生产方法，不由此触发额外实机测试或发行。


## 2026-10-19 顶部拖动、全自动平替及错误提示：本地聚焦 Review

范围为本轮未提交的三项改动及必要调用方；复用最终59项通过记录，不重跑整套、不操作设备、不联网。业务源码未因本轮Review修改，未提交/推送/发行。确认两个待修问题，不能把此前59项通过等同于这两个边界已覆盖。

1. [P1] 少于三个结果的失败轮无法自动恢复。PC desktopReplacement.ts:55 与 Android PlaylistReplacement.java:48 仅在 attempts>=3 且提示等于“本轮3次尝试已用完”时开始后续新轮。标题搜索仅有1或2条且均失败时，保存 attempts=1/2、原 candidates/tried；以后再次播放仍跳过全部旧候选，不再搜索，即使音乐源已恢复也失败。使用实际PC resolver和playlist-batch复现1条与2条两种情况：恢复前后search调用始终1，resolve始终1/2，第二次播放仍报失败。Android对应状态分支静态确认同样可触发，未额外执行JVM复现。最小修正：明确区分候选池已完成的失败终态和被取消/仍在解析的未完成轮；新播放可重开完整失败轮，但不得清零被取消的第三次。

2. [P2] 移动端开关保存后的回调覆盖新播放选择。MobileApp.tsx:241-242 的 policyChanged 闭包在 PlatformReplacement 的异步 mutate 完成后仍读取原渲染的 player/track/queue；期间切歌、编辑队列或暂停，迟到回调仍用旧队列调用 play，恢复旧歌单，可能覆盖刚做的队列调整或重新启动已暂停的加载。提取生产TSX中的实际queue回调，模拟保存完成前当前选择已变为新歌曲，再执行回调，观察play指令把当前选择改回旧歌曲。此为生产回调的隔离执行，不是手机时序验收。最小修正：在原生播放层按歌单、当前选择代次及播放意图有条件刷新，或在前端取得最新状态并以代次避免核对/执行间竞态；不要把旧整队列重新提交给play。

未确认顶部拖动区和错误提示在本轮范围内有新增确定缺陷。已有界面命中/尺寸测试通过不代表人工系统拖动或真机试听。本轮最小复现回执 release/diagnostics/playlist-auto-review-repro.json，保留在本地忽略目录。

最值得优先改进：将平替轮次终态从中文消息中解耦，再补少量候选恢复、开关保存与切歌/暂停并发的生产入口回归。此次只记录建议，不自动扩展为重构或全仓审查。


## 2026-10-19 两项发现修复与最近三首漫游重听

按用户明确修复指令，上一节两个发现均已修正，原记录保留作为修复前证据。

- 平替新增可持久化的 roundComplete 布尔终态。候选池只有1/2项且完全失败也会结束该轮，下一次重新播放允许重新搜索；等待中或取消的第三次仍保留额度，不因重试清零。兼容读取旧终态提示仅作为旧资料迁移判定，新写入不靠提示文案判断。PC adapter 跟踪实际存储规范化后的状态，防止新增字段顺序导致下一次CAS提交错误。
- 移动端不再用旧闭包中的整队列调用play。仅发送歌单/歌曲/selectionRevision/开关值，Android在主线程核对当前播放代次和意图，使用播放器当前队列刷新。切歌、暂停或改动选择后迟到的保存回调不重启旧请求；支持代次的当前待加载选择才刷新。旧/不支持代次的快照不退回到旧队列重放。
- 用户澄清“上一首”用于重听好歌。PC原来只seek(0)，Android原来直接忽略漫游previous；现接入独立的至多4项播放窗口（当前+前三首已出声歌曲）。第二首能重听第一首，第五首保留第2/3/4首；重听不会退出漫游或增加新推荐计数，下一首接回已听序列后继续发现。失败/未出声歌曲不占重听记录；停止漫游清除此小窗口，完整听歌历史不删除。当前队列可直接选择最近歌曲重听。

最终必要验证63/63通过：播放器/源与实际桌面漫游控制器37项，平替18项（新增小候选恢复及移动代次请求形状），Android生产类/JVM与移动React界面2项，资料保护6项。JVM包含Android回放窗口、提取的实际原生策略刷新方法，核验保存后暂停/切歌不恢复旧选择，以及原生少候选失败后恢复。TypeScript、PC/Android Web与实际Android Java编译通过。

本轮初次新增小候选回归发现新字段排序导致PC CAS不一致，已在生产adapter规范化保存状态后原断言通过；新增桌面失败歌曲回归初次因夹具只提供一页且五首后耗尽，没有触发失败歌曲播放，改为真实分页返回候选后通过，保留失败日志。未放宽第三次取消、资料保留或重听序列断言。最终合并63项回执 replay-final-tests.log，构建 replay-web-final.log/replay-java-build.log，均位于本地release/diagnostics。

未安装手机/PC主应用，未运行真实上游音源试听、系统覆盖升级或新增AI Review。没有改变版本号、发行身份、更新入口、安装器或线上通道；未提交、推送、生成新产品安装包或发布。
