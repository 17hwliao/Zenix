# 远程音乐助手能力与公共契约

2026-11-05。接入前源码盘点基于 `ca27bc7` 和当前本地星轨样式修改。这里记录实际调用路径及接入要求，源码入口存在不代表业务、模型或设备验收通过。

## 已有 37 项本地动作入口

数量来自 `skin-model.cjs` 的 7 项基础动作、`libraryIntent.ts` 的 10 项资料动作及 `controlIntent.ts` 的 20 项控制动作。共享分派入口是 `featureHost.executeAssistant`。PC 业务依赖主进程 IPC 和现有播放器，Android 依赖 `mobile/native.command` 及原生插件路由。

状态中的“已有入口”表示可以复用执行入口，“需补齐”表示已有业务但需要补参数、对象引用或结构化结果。“后续扩展”仅针对本轮未要求的远程专用工具，已有本地指令继续保留。

| 动作 | PC | Android | 源码依据与接入要求 |
| --- | --- | --- | --- |
| play | 已有入口 | 已有入口 | `executeAssistant`，需读取实际播放快照区分加载和播放 |
| pause | 已有入口 | 已有入口 | `executeAssistant` / `pauseHost`，手机通过快照保证幂等暂停 |
| next | 已有入口 | 已有入口 | `player.next` / `command('next')`，结果不明不能重放 |
| previous | 已有入口 | 已有入口 | `player.previous` / `command('previous')`，独立于队列资料查询 |
| bookmark | 后续扩展 | 后续扩展 | 已有 `personalFeatures.bookmarkAdd`，本轮保留本地标记片段入口 |
| tasks | 只能打开界面 | 只能打开界面 | `openTasks`，远程任务数据需接 `offlineTasks.state` |
| search | 只能打开界面 | 只能打开界面 | `zenix-assistant-search` 事件，只启动界面搜索，不返回候选 |
| song-query | 需补齐 | 需补齐 | `querySongs` 支持队列前后各 10 首，远程只取所需字段及有界歌词 |
| now-lyrics | 需补齐 | 需补齐 | `libraryCommand` 默认可返回整首歌词，远程须改成当前句或有界片段 |
| now-artist | 已有入口 | 已有入口 | `libraryCommand` 使用 `recordingFor` 获取实际录音版本 |
| recent-songs | 需补齐 | 需补齐 | `querySongs` 最多 10 条，需结构化对象引用及顺序依据 |
| home | 已有入口 | 已有入口 | `libraryHost.navigate` 带实际界面接收回执 |
| playlist-open | 需补齐 | 需补齐 | 本地按名称匹配，远程需查找候选后使用歌单引用 |
| playlist-create | 已有入口 | 已有入口 | 已有确认计划及创建结果核对，需接统一客户端确认身份 |
| playlist-create-current | 已有入口 | 已有入口 | `host.create(name, track)` 可复用原子创建并加歌入口，目标预先固定 |
| songs-collect | 需补齐 | 需补齐 | 已有 `collectMany`，远程需确定目标状态并支持取消喜欢/收藏 |
| songs-remove | 已有入口 | 已有入口 | `batchPlaylist`/`personal.batch` 带 expected 内容校验，保留其他资料 |
| repeat-one | 需补齐 | 需补齐 | `controlHost.mode` 固定单曲循环，需扩展为显式 repeat/shuffle 目标 |
| volume-down | 需补齐 | 需补齐 | 业务支持绝对音量，远程必须用显式目标值 |
| pure-lyrics | 需补齐 | 需补齐 | `requestAssistantUi('pure-lyrics')`，需要显式开关及实际回执 |
| lyrics-earlier | 需补齐 | 需补齐 | 当前是相对半秒，远程需核对并保存绝对偏移 |
| overlay-off | 需补齐 | 需补齐 | 现有关闭入口，开启需核对当前权限和可用条件 |
| cache-playlist | 已有入口 | 已有入口 | 固定歌单内容并准备缓存任务，任务建立与缓存完成分开 |
| cache-only | 已有入口 | 已有入口 | `offlineTasks.policy` 保存音乐网络策略，已有连接可能继续 |
| network-tasks | 已有入口 | 已有入口 | `offlineTasks.state` 有任务数据，需要有限、结构化输出 |
| space-open | 已有入口 | 已有入口 | `requestAssistantUi('space')`，本轮不加入星轨指令 |
| space-zone | 后续扩展 | 后续扩展 | 本地可按名称打开分区，本轮远程页面导航不接受任意空间操作 |
| space-save | 后续扩展 | 后续扩展 | 本地 `captureSpace`+书签保存继续保留，远程不增加空间编辑工具 |
| roam-reduce | 已有入口 | 已有入口 | 现有歌曲偏好与确认，远程固定实际歌曲引用 |
| roam-light | 需补齐 | 需补齐 | 现有固定“轻音乐 3 首”，补有限 keyword/count 参数 |
| roam-return | 已有入口 | 已有入口 | `spaceFeatures.roaming return` 返回原路线 |
| week-stats | 需补齐 | 需补齐 | 现有日期范围统计，补 week/month/year 明确范围和有限排行 |
| sleep | 需补齐 | 需补齐 | 现有固定 30 分钟，业务已有设置及取消，补显式分钟参数 |
| handoff-pc | 当前平台不支持 | 已有入口 | 已有手机→电脑接力，检查配对、权限及接收票据 |
| submit-pc | 当前平台不支持 | 已有入口 | 已有手机→电脑下一首投稿，不把发送等同于接收播放 |
| backup-playlists | 已有入口 | 已有入口 | `exportFile` 系统保存入口，取消保存明确返回 |
| update-check | 已有入口 | 已有入口 | `invokeUpdate` 保留既有可信更新入口和通道 |

新增的上下文读、搜索候选返回、指定候选播放、歌单查找、向已有歌单添加歌曲等没有完整的旧助手入口，必须由本轮业务适配器补齐。原生个人资料、歌曲搜索、播放、任务和协作逻辑继续复用。

## 统一工具注册表

`remote/registry.ts` 注册 24 个功能组。每项包含业务模块、批次、平台、运行条件、严格 schema、效果分类、确认和重试规则、结果说明。模型定义和本地参数验证共用这份注册表。

内部使用 `music.search` 一类名称。传给兼容 Chat Completions 的 function name 使用 `music_search`，只包含字母、数字、下划线和连字符。`toolsForPlatform` 必须结合业务层提供的实际能力集合使用，运行时通过 `validateToolCall` 再次校验平台和当前可用性。JSON schema 以外的跨字段约束由同一验证模块执行，模型不可传 `confirmed`、`operation`、路径或任意原生命令。

| 批次 | 工具 |
| --- | --- |
| A | context.read、playback.control、playback.set_volume、playback.set_mode、music.search、music.play_result、music.query、lyrics.configure、navigation.open |
| B | playlist.find、playlist.open、playlist.create、playlist.add_tracks、playlist.remove_tracks、collection.set |
| C | cache.prepare、tasks.query、network.set_policy、roaming.configure、stats.query、timer.configure、device.transfer、backup.export_playlists、updates.check |

除 `device.transfer` 当前只暴露给已连接、授权的 Android 客户端外，其余功能声明为 PC/Android 共享，最终可用性仍由业务适配器核对。连接断开、当前页面不能处理导航或原生权限不足均需在执行前重新检查。

## 结果、确认与引用

`contracts.ts` 定义原生传输、业务适配器、对象引用、确认计划和结果类型。`ToolResult.status` 区分 `loading_started`、`playback_started`、`task_created`、`saved`、`page_opened`、`partial`、`unknown` 等状态。失败不得包装成空成功。

确认计划持有固定目标闭包、项目摘要和 fingerprint，确认票据由会话协调器产生。提交前调用 validate，只有用户实际确认才能调用 commit。模型工具参数没有确认票据字段。同一请求最多形成一个明确业务修改结果，operationId 由协调器生成，不能用远程 tool_call_id 作为唯一去重依据。

歌曲、歌单、候选和设备使用会话范围的不透明引用，业务适配器通过 `ReferenceStore` 解析实际对象。新搜索失效旧候选。模型上下文只发送本次需要的摘要及引用，默认不发送完整歌单、历史、文件路径、音频或整首歌词。

## 集中限额与验证范围

`REMOTE_LIMITS` 以单次音乐请求通常需要“查询→调用→结果说明”为依据，允许最多 6 轮模型交互、每轮 4 个工具、每请求 12 个工具。结果文本 12000 字、对话 32 条、模型响应 256 KiB，搜索候选最多 10 个，队列前后各最多 10 首。引用最多 512 个、15 分钟有效，确认计划 5 分钟有效，内存操作记录最多 128 条。时间仅用于引用及确认有效期，不限制音乐解析或播放加载。

`Test-RemoteAssistantContracts.cjs` 验证全部 schema 的正常参数、未知字段、非法函数、平台和实际能力过滤、范围及矛盾字段、确认伪造和注册表隔离。该层自动测试不代表传输、业务、模型接口或实机验证。
