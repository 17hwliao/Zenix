# 离线收纳、场景缓存与网络偏好

本模块覆盖功能清单 5、6、7、20 的离线任务部分。原播放、个人资料、更新通道和局域网通信继续由原模块管理。

## PC 接线

```js
const { OfflineTasks } = require('./runtime/offline-tasks.cjs');
const offlineTasks = new OfflineTasks({ folder: app.getPath('userData'), sources: sourceManager, cache: audioCache });
await offlineTasks.load();
// 已认证主窗口既有 companion:invoke 路由内：
if (args.operation === 'offlineTasks') return offlineTasks.invoke(args);
// before-quit 内：
offlineTasks.close();
```

长期实例拥有任务；组件卸载不销毁它。任务资料放在原 userData/offline-tasks.json，不建立另一个用户根目录。仅保存歌曲元数据、任务状态与偏好，不保存播放 URL、授权头和本机文件路径。启动遇到损坏文件保留原字节并停止写入，不以空队列覆盖。

`SourceManager` 在缓存未命中后分别执行音频、歌词、封面联网策略。完整音频和已缓存图文仍可读取。音源脚本 API、更新与局域网未被并入这些网络限制。后台补全受 preload 偏好控制。

PC 无法从现有接口可靠获知计费状态，明确显示 unknown；默认 always 不改变既有行为，用户选择 unmetered 时等待，不把网络在线假定为 Wi-Fi。网络状态可靠来源可更新 `offlineTasks.network.network`（unknown/metered/unmetered）并调用 `pump()`；不得从来源名称或网卡名字推断计费。

## Android 接线

```java
// 长期 ZenixRuntime 实例中：
final OfflineTasks offlineTasks = new OfflineTasks(context, this);
// 原 companion 路由/后台线程：
if (args.optString("operation").equals("offlineTasks")) return runtime.offlineTasks.invoke(args);
```

任务使用 PlaybackService 唯一 SimpleCache，不另外打开同一路径。协作接口：

- `SimpleCache offlineCache()`
- `CacheBudget offlineBudget()`
- `Future<?> offlineRemember(JSONObject track, JSONObject result)`：通过原 resolver 串行登记 cacheMappings，失败必须传递。
- 原 CacheBudget 构造使用 `new CacheBudget(limit, key -> NetworkPreferences.pinned(runtime.store, key))`。
- 原 resolveNext 在完整缓存未命中时执行 `NetworkPreferences.require(this, runtime.store, "audio")`。
- `MusicSources` 歌词、封面读缓存后、实际联网前分别执行 `NetworkPreferences.require(context,store,"lyrics"/"artwork")`。

任务和偏好持久化到原加密 PrivateStore 的 offlineTasks 字段，固定资源登记 offlinePins。下载用独立 OkHttp Dispatcher/ConnectionPool，取消任务只取消自己的连接。CacheWriter 使用 FLAG_BLOCK_ON_CACHE，共享原缓存片段锁，不合成另一套音频缓存。

Android 原 cacheMappings 的普通 300 项上限必须保留固定歌曲映射，否则超过 300 首后虽然音频仍在磁盘却无法离线定位。普通清理保留固定文件；破损缓存恢复仍可明确废弃对应坏字节。

## UI

`TasksPanel` 默认导出，props 为 `{invoke, personal?, current?}`；PC/Android使用相同组件和协议：

```ts
invoke({ operation:'offlineTasks', action:'state' });
invoke({ operation:'offlineTasks', action:'prepare', tracks, name, group, quality, pin });
invoke({ operation:'offlineTasks', action:'pause'|'resume'|'cancel'|'retry'|'unpin', id });
invoke({ operation:'offlineTasks', action:'policy', policy:{ audio:'always'|'unmetered'|'never' } });
```

policy 包含 audio、lyrics、artwork、preload 四项。prepare 1–2000 首，最多 20 个任务；任务持久化不超过 8 MiB。重启后未完成任务处于暂停，用户明确继续后才恢复联网。本地歌曲标为“使用本地文件”，不谎称音频已复制或跨设备可用。

## 状态和边界

任务：queued → running → complete/failed；用户可 pause/cancel；网络偏好不满足时 waiting。完成按实际完整缓存判定；未知长度展示接收字节，不伪造百分比。单条错误可展开，外层提示可关闭。重试只处理失败或未完成项，保留完成结果；取消不删除完成歌曲。

固定缓存不能被普通年龄淘汰或容量淘汰删除；新内容无法在预算内放入时明确失败，原固定内容保留。分组解除只移除该场景的固定标记，其他场景仍固定。用户可继续在原缓存设置里提高空间上限。

当前任务中心已接入离线任务；导入和批量匹配需要各自业务登记执行/取消回执，不能只复制“取消成功”文案。系统进程被回收后恢复任务清单；不保证操作系统强制停止后仍继续下载，也不额外申请常驻权限。

## 已运行验证

`node --test scripts/Test-OfflineTasks.cjs scripts/Test-AudioReuse.cjs`：11/11 通过，覆盖固定保留/重启、容量拒绝、并发一次网络、离开组件任务继续、凭据不落盘、局部重试、取消恢复、损坏存储保护和旧循环播放缓存路径。

`android/gradlew :app:compileDebugJavaWithJavac --offline` 成功，包含真实 Media3 CacheWriter API、Android 网络检测和协作的 PlaybackService 接口。未操作用户设备或安装应用，不宣称 Android 实际下载/后台存活已验收。

## 2026-10-23 阶段 Review 修复

- **P1，缓存索引损坏会破坏固定内容。** 原 `AudioCache.load()` 吞掉 JSON 错误后保存空索引，再删除全部孤立 bin。现在索引语法/结构异常，或索引缺失但已有音频时，保留原字节、停止缓存写入和清理，状态返回明确诊断；在线播放继续使用原网络流。强制解析恢复也不会尝试改写该只读索引。
- **P1，Android 固定内容占满时不能使播放抛异常。** 生产 Media3 1.11.1 字节码显示 CacheDataSink 只包装 IOException，CacheDataSource 对 IllegalStateException 不能保证缓存忽略回退。预算现在保留启动已有固定文件，超限时移除本次新提交片段而不向播放器抛运行时异常；离线任务通过完整性检查报告失败。触碰旧固定片段不重走“新增片段”路径。
- **P1，离线解析占用主播放 lane。** Android 使用专用 offlineLane/offlineCatalog 与 ThreadLocal 路由，取消只关闭离线引擎；空闲/退出回收仍有界。PC 原 SourceManager 已为每个活跃调用分配独立 runner，复用其 8 实例及空闲回收限制；离线 signal 补齐 stateDriven，避免落入普通来源调用的绝对超时。
- **P1，固定缓存写入锁序与恢复冲突。** Android 原 pinKey 先取 store 再取 diskLock，与备份恢复相反。现在统一通过 store.backupLocked 和 replaceAtomic 写入。后台任务普通保存保留官方当前 policy，避免覆盖刚恢复的网络偏好；显式 policy 操作才写入新偏好。
- **P2，任务保存失败后仍可能继续任务。** 两端写入失败均保留原文件、暂停任务并显示诊断；PC policy 保存失败回退原内存偏好。过大任务在加入前验证，不先删除已有任务再拒绝新任务。
- **P2，清理与下载竞态。** 双端 `pauseForCacheClear()` 先关 prepare/resume/retry 门禁、将任务暂停并取消自己的工作，再返回可等待的 writer 退出回执。`endCacheClear()` 只解锁，不自动恢复下载。Android 使用 worker sentinel，调用方只能在后台等待，不阻塞主线程。
- **P2，未完成下载的固定标记难以解除。** Android 任务项记录安全的 cacheKey，失败/取消后仍可解除本场景标记，不依赖尚未写入的 cacheMappings。

复查后的定向运行：`Test-CacheBudget.cjs`、`Test-OfflineTasks.cjs`、原 `Test-AudioReuse.cjs` 共 16/16 通过。CacheBudget/SourceEngineLane 测试直接编译运行生产 Java，只用最小 Media3 接口桩，覆盖旧固定、未知长度新片段、下降预算、触碰、普通 LRU 和 lane 取消隔离；不将接口桩测试称为完整 Media3 播放实测。全项目 TypeScript 与 Android 原生 Java 编译通过。

PC 离线跨源检索已补齐：优先原 id/原源及兼容 LX 的同一平台 id，失败后复用 `src/core/searchGroups.cjs.sameRecordingMetadata` 选择同录音候选，最多解析三个不同候选、最多检索八个来源。保留原 track.id/quality 缓存定位，在缓存索引和任务中记录安全的实际歌曲身份；不写入或重置歌单平替记录。候选缺少时长、歌手不符或版本标题不同则不擅自匹配。

补充五项生产 SourceManager 回归覆盖虚拟来源、原源禁用、原候选优先与三次上限、无匹配、取消后的迟到结果不解析/下载/写缓存，以及实际身份持久化和后续零重复请求。当前缓存组共 21/21 通过。原生固定状态已改为 PrivateStore.offlinePinned 直接只读查询，避免每次预算检查复制整张固定表；不增加第二套状态缓存。发行文件白名单必须包含新后端依赖的 `src/core/searchGroups.cjs`。

任务中心的既有导入/批量匹配登记由主集成层负责，不能只用占位状态宣称完成。本组未进行手机或 Windows 安装测试，也未切换更新通道。

## 实际录音身份与缓存

普通播放同样保存实际录音身份：resolve 输入候选经过安全字段白名单写入 session.recording，随后 stream → captureResponse → 中断后的 schedule 补全 → capture → 索引连续保留。索引读取再净化一次，不存 URL、headers、path 或嵌套的旧 playbackRecording。缓存别名只用于定位文件，不作为实际录音 ID。

cached/cachedBest 继续使用 playbackProviderId=cache 表示读取通道，同时通过 playbackRecording 返回缓存保存的实际 provider/remoteId/歌曲元数据；旧缓存没有该字段时保持未知，不从请求原曲、别名或旧 playbackRecording 推断。离线准备碰到已有缓存或等待其他任务完成时，同样读取最终缓存的实际身份。

新增三项验证覆盖正常流完成与重启/别名读取、真实中断流的后台补全、旧缓存身份未知，以及安全字段过滤。本次运行 Test-AudioReuse + Test-OfflineTasks 必要子集 23/23 通过；未重跑无改动的 Java 预算或全套测试。

## 最终缓存并发复核

- **P1，离线平替与正在循环的录音互相覆盖。** 同一歌单原曲 ID 可以指向离线准备的录音 B，正在播放的录音 A 不能仅凭该别名读取 B。流会核验实际 provider/remoteId；冲突时用既有缓存中的实际录音键保存 A，后续循环直接复用。强制重新解析 A 也不会删除原曲别名下已固定的 B。旧条目没有录音身份时保持兼容未知，不伪造相同身份。
- **P1，普通流提交与清理竞态。** AudioCache 现在将最终文件提交、索引变更、淘汰和清理串行处理；清理同步关写入门禁，取消缓存写入、等待已进入提交的文件处理后再清理。音频消费者仍可读取原网络流；清理期间不新建缓存任务，清理结束后允许正常写入。
- **P2，Android 每次网络偏好检查复制整张任务表。** PrivateStore 提供只复制 policy 小对象的只读方法，NetworkPreferences 直接读取它；不额外维护第二套偏好状态。生产 JVM 用例验证返回小副本不能反向修改官方状态。

最后定向运行：`node --test scripts/Test-AudioReuse.cjs scripts/Test-OfflineTasks.cjs` **26/26 通过**，新增固定 B 与流 A、在途 B 与流 A、提交与清理竞态三项。`Test-MobilePlayback.cjs` 的 Android production source lanes 子集 **1/1 通过**，直接编译生产 Java 与实际只读方法，未操作设备。相关 Node 语法与 diff 空白检查通过。本子任务启动的测试均已退出；未追加全套测试、用户体验验收或发布操作。
