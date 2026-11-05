# 远程助手业务适配

`createBusinessAdapter(platform, host?)` 将注册表中的 24 组工具映射到现有业务。`BusinessHost` 是可注入的固定客户端接口，模型只能提供注册参数与会话引用。运行时再次校验 schema、当前平台、搜索源与协作连接。

| 批次 | 接入范围 | PC | Android |
| --- | --- | --- | --- |
| A | 最小上下文、明确播放控制、音量/模式、真实源搜索、指定候选版本播放 | 支持 | 支持 |
| A | 当前/选中/引用/队列 ±10/历史 ≤10 查询、页面与歌词设置 | 支持 | 支持 |
| B | 歌单查找/打开/创建/加歌/移出，设置喜欢/收藏 | 支持 | 支持 |
| C | 缓存任务、任务状态、联网策略、漫游、统计、睡眠定时、导出、检查更新 | 支持 | 支持 |
| C | 已配对且获得相应权限的电脑接力/投稿 | 从 Android 发起 | 支持 |

上下文区分正在播放歌曲与界面选中歌曲。歌单管理从现有 selection context 读取，音乐空间通过现有 selection request 读取。歌曲摘要只返回名称、歌手、专辑、时长和不透明引用，不输出本地路径或音频地址。平替后的当前歌曲依据 `recordingFor` 解析实际录音。默认 all 查询不包含歌词，明确请求歌词只返回当前位置的一句或非当前歌曲的首句，最多 400 字。随机播放与漫游的队列查询只代表当前实际队列，返回说明。

新搜索使旧候选引用失效。指定候选复用现有播放源解析，没有新增音乐解析时限。播放器报告加载时返回 `loading_started`，实际正在播放才返回 `playback_started`，中途选了其他歌则返回 `unknown`。

创建歌单复用原子 `createPlaylist(name, firstTrack)`，多首加歌复用既有逐首保存入口。后续失败返回 `partial`，不撤销已建立的歌单，也不重建或自动补发。已有歌单的确认固定目标、曲目与初始内容，确认前重读内容指纹并验证会话引用。创建后加歌或移出后均核对实际保存结果。单首喜欢/收藏是明确目标值，批量先确认。

缓存确认固定歌单歌曲并建立后台任务，未返回任务不能声称建立成功。`task_created` 与任务的 `complete` 状态独立，任务读取失败不显示为零任务。任务查询合并缓存任务、当前 renderer 后台任务及播放器公开的音源解析状态，先返回正在发生的活动，统一受结果条数限制；不回传任务错误原文、解析 URL、凭据或 Activity.result。范围明确不等于操作系统的全部网络连接，也不包含尚未暴露任务状态的独立请求。音乐联网策略保存只影响已有音乐策略模块，更新与协作沿用各自入口。

设备引用绑定原生 `connectionId`，重新配对后旧引用失效。提交时重新检查连接及投稿/接力权限。接力发送后等待电脑接收，沿用现有 handoff coordinator，在远端成功接收后才暂停对应原歌曲。

确认计划的 fingerprint 是只含工具、目标 ID、名称、原曲目 ID 和显式值的本地 JSON。它不包含 Track 全对象、路径、URL 或凭据。`recovery(call, ctx)` 为直接提交保存固定恢复描述。`reconcile(operation, ctx)` 仅核对实际资料，覆盖新歌单及其曲目、歌单加歌/移出、喜欢/收藏、联网策略和目标音量/模式。不能唯一确认的播放跳转、任务、导出或远端请求返回 `unknown`，绝不自动重放。系统保存导出取消返回 `cancelled`，导出结果不明也不能自动再次弹出或保存。

必要受控测试使用隔离内存资料与注入 host，覆盖不同上下文、真实候选引用、过期拒绝、切歌后的固定确认、内容冲突、取消、部分完成、任务建立、平台能力、可选协作故障、参数拒绝与重启只读核验。另通过 `load-remote-business-default.cjs` 加载真实 business 默认 host、libraryHost、controlHost 和 UI event 接受逻辑，仅替换 native/bridge/存储等平台边界，检查 Android 音量 `{value}`、搜索 `{id,keyword}`、协作 `collaboration` 路由和 PC 搜索的 stateDriven 参数。运行命令为 `node --test scripts/Test-RemoteAssistantBusiness.cjs`。测试不是实际模型、外部源、系统保存窗口或真机验收。

本轮默认 host 定向复核确认并修复：PC snapshot 未读取真实 roaming 状态；空间 selection 的本地 Track 因书签引用剥离 path 而无法完整加入歌单；tasks.query 原来仅列缓存任务；纯净歌词跳转错误地声称持久保存，以及组合歌词配置失败时已完成部分未被说明。现在本地选中歌曲从当前曲库按 ID 恢复完整对象，不可用则拒绝该 selection，路径始终只留在本机引用中。纯净模式由现有 UI 明确接收后返回 page_opened，偏移和悬浮歌词分别核实结果，权限不足返回 needs_input，部分完成返回 partial。Android 音量 value、search 的 id/keyword 与协作路由经实际源码对照原已正确，保留并增加契约测试。

当前句查询通过默认 libraryHost.lyricOffset 读取正在播放条目的校正值，与原播放器按 `position - offset` 取句保持一致；歌词正文解析上限 120000 字符，回传仍最多一句 400 字。正/负校正与真实默认 host 存储读取均有受控测试。fields=all 包含 saved、progress、coverAvailable 等普通摘要，仍不默认读取歌词正文。
