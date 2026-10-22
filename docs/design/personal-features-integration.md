# 私人音乐资料、检索与歌单撤销

本模块对应需求 3、4、12、23，复用当前个人曲库与 `.zenixbackup` 格式。没有改变用户资料根目录、发行身份或更新通道。

## 双端入口

共享组件 `src/features/personal/PersonalFeaturesPanel.tsx`。必需 props 为 `personal`、`playback` 和 `invoke`，可选 `onOpen(trackReference, seconds)`、`readLyrics(track)`、`saveText(name,text)`。精确类型见同目录 `types.ts`。

`invoke` 统一接收 `{operation:'personalFeatures',action,...args}`。可用 action：

| action | 参数 | 结果 |
| --- | --- | --- |
| read | 无 | schema、revision、bookmarks、lyrics、journal、可选 notice |
| bookmarkAdd | track、seconds、note、可选 lyric | 最新私人资料 |
| bookmarkDelete | id | 最新私人资料 |
| lyricsSave | track、text | 最新私人资料 |
| search | query | 最多 100 条歌曲、书签、歌词匹配 |
| undo | 歌单修改记录 id | 最新私人资料；个人曲库变更由既有 snapshot 通知 |
| backupExport | 无 | 使用原格式封装的 JSON 字符串 |
| backupPreview | text | token、新增、重复、冲突、歌词数量 |
| backupApply | token | 合并后私人资料 |
| backupDiscard | 无 | true |

`trackReference` 故意只带版本身份及歌曲元数据，没有播放 URL、本地文件路径或认证头。`onOpen` 必须从当前个人曲库、本地曲库或当前播放歌曲匹配原引用；只有匹配成功才能打开本地音频。远程条目继续经过已有解析链路。跨版本时间位置不自动换算。

### Electron

```js
const {PersonalFeatures}=require('./runtime/personal-features.cjs');
const features=new PersonalFeatures({
  folder: app.getPath('userData'), personal, broadcast,
  exclusive: fn=>companion.backup.exclusive(fn),
});
await features.load();
companion.backup.personalFeatures=features;
// operation==='personalFeatures' 时调用 features.invoke(args)。
```

初始化失败只禁用私人资料入口，不能让播放器启动失败。Electron 运行时需要将 `src/features/personal/model.cjs` 加入安装包白名单。私人书签和歌词写在同一 userData 下的 `personal-features.json`。

现有 `PersonalStore.save()` 已原子保存歌单和可选 `_playlistJournal` 字段。不要在 IPC 调用后再次 capture，避免重复日志。`snapshot()` 格式仍保持原来的 PersonalState。不可读取的可选修改记录会原样保留并显示提示，不禁用原歌单。

### Android

```java
PersonalFeatures features=new PersonalFeatures(store);
// operation==='personalFeatures' 时调用 features.invoke(args)。
```

数据仍在既有 PrivateStore/ProtectedJson 下。`PrivateStore.mutatePersonal()` 将实际歌单差异与 personal 同次提交；服务撤销通过 `backupLocked` / `replaceAtomic` 同时写入歌单与记录。Runtime 执行 undo 后应沿既有方式 emit snapshot。

## 已完成行为

- 时间书签关联具体来源与录音版本，可以带私人备注；导入的歌词不会成为网络请求入口。
- 本地检索涵盖曲库元数据、私人备注、已收录歌词；LRC 时间戳用于定位，不存在的时间不伪造。
- 歌单增删、排序、重命名、导入和平替只要通过既有持久化路径保存，就能记录歌单差异。
- 只撤销受影响的歌单，保留其他歌单、收藏和历史；受影响歌单已变化时拒绝覆盖。同名冲突也拒绝。
- 最近 50 次修改有界保存。若极大快照超过支持范围，实际歌单优先保存，并提示本次无法撤销；不以记录功能阻断原歌单使用。
- 备份保留原 format/schemaVersion/SHA256 校验，增加可选 `extensions.personalFeatures`。旧读者可以忽略扩展，旧备份仍可恢复。
- 现有备份设置增加显式勾选“私人书签与歌词”，不会默认输出私人备注。完整恢复事务及其冲突保护覆盖这个扩展。
- 私人资料独立导入时，重复书签跳过、冲突另存副本、现有歌词优先；预览后资料变化会要求重新预览。

## 验证

`node --test scripts/Test-PersonalFeatures.cjs`：11 项通过，含真实文件重开、写入失败、资料保留、冲突撤销、完整备份事务、新旧格式以及生产 Android 私人资料类的 JVM 执行。

`node --test scripts/Test-AppReliability.cjs`：11 项通过，保留既有备份/搜索/诊断及 Java/Node 格式契约。

`node --test --test-name-pattern='Android production source lanes' scripts/Test-MobilePlayback.cjs`：生产 PrivateStore 修改入口片段的 JVM 回归 1 项通过。

这些是模块与契约测试，不代表手机手动体验、系统文件选择或正式更新验收。

## 本轮功能设置备份扩展

新增可选 `featureSettings` 区段，沿用原 `zenix-backup/schemaVersion:1` 封装及 payload SHA256，字段位于 `extensions.featureSettings`。覆盖空间书签、分区、漫游排除及偏好、动效档位、版本选择与排除、网络四类使用策略，以及助手大小、锁定、律动、帧率、隐藏等 UI 设置。没有皮肤原始包、认证头、音频地址、音频缓存或系统权限。

PC renderer 使用 `src/features/settingsBackup.ts` 捕获现有三个 localStorage 键；清理规则复用空间与版本模块。后端网络策略使用 `backup.offlineTasks.network.policy`。主程序应接好 `backup.offlineTasks`，供用户明确恢复时读写网络偏好；启动阶段不写业务资料。

Android 使用现有 `spaceFeatures`、`playbackPreferences` 和 `offlineTasks.policy`，助手 UI 来自 BackupSettings 包装的 renderer browser 设置；`assistantUiSettings` 只作为恢复事务中的 UI 镜像。网络恢复只在 PrivateStore 事务内读写 policy，不在持有 store 锁时调用 OfflineTasks 或 SimpleCache。普通任务保存会保留已经恢复的新 policy。

恢复默认保留本机冲突，仅添加缺失书签、分区和单曲偏好。用户明确选择“使用备份中的设置”后才替换已有偏好，仍保留恢复前快照。空间 revision 使用本机当前值递增；不存在的配置使用标准空值表示，撤销能真正移除导入的键。

PC/Android 都以带标识的 browser 回执补齐界面设置。设置或个人资料已有新改动时拒绝写入旧回执；部分 renderer 写入失败会回滚仍属于本次写入的键。重启不会因为未完成 UI 回执而回滚已经提交的后端和后续新增资料。未完成的后端事务只登记待处理，由用户明确选择“恢复到操作前”或“保留当前资料”。前者逐个所选资料类别核对仍等于本次 before/after 后再写入，不覆盖未选择的类别；后者保留原快照并禁用可能覆盖后来修改的整体撤销。界面初始化只读 backupInfo，不自动补写或确认回执。

PC OfflineTasks 的策略修改纳入现有备份 barrier；事务先收拢在途写入，外部修改在恢复完成后执行。内部恢复使用 `backupRestore:true`，避免等待自身 barrier。这样恢复期间用户新提交的网络偏好最终仍然保留。

新增 `scripts/Test-SettingsBackup.cjs`：12 项通过，包含旧封装兼容、Java/Node 互通、真正后端策略保存、过期回执、重启恢复、后续资料保留、写失败、renderer 配额回滚、并发网络策略以及新装无设置的恢复/撤销。TypeScript 检查与 `:app:compileDebugJavaWithJavac` 通过。没有追加设备操作或远端发布。

新增后端运行依赖须包含 `src/features/settingsBackup.cjs`、`src/features/space/model.cjs`、`src/features/playback/preferences.cjs`。纯 Java 空间清理已抽为 `SpaceFeatureFormat`，原 `SpaceFeatureCommands.clean` 委托该类，身份字段上限及交互行为保持。


## 选择同步的失败与重试

`src/features/connections/syncTransfer.ts` 先完整校验选中内容和本机合并计划，再提交各区段。版本和漫游偏好保留本机冲突，漫游只合并排除记录，绝不采纳对方歌单作用域。运行时某段失败不删除其他已完成资料，返回明确的 `SyncResult {status,applied,failed,message}`；两端显示“部分完成”并保留错误，不误报完整成功。重试按歌单实际内容（含导入后缀）和收藏稳定引用去重。收藏使用 `personalFeatures/collectionAdd` 原子幂等添加，禁止用 toggle 作为同步合并。

`featureHost.ts` 的本机版本偏好写入使用原值 CAS；Android preferencesSave 传 expected 给原生检查。Android 后端保存成功但 renderer 缓存有新修改或配额不足时，明确返回“已保存但界面缓存未覆盖”的部分结果。网络回执发送失败不会再次发送相反的拒绝结果，界面提示先核对本机资料。

本次定向自动验证：SyncTransfer 5、FeatureIntegration 6、AppReliability 13、SettingsBackup 12、PersonalFeatures 11，共 47 项通过。新回归覆盖同步预校验、部分失败重试去重、并发收藏、丢失导入回执、启动不改资料、明确恢复不覆盖后来修改、保留当前禁止旧快照覆盖，以及 BackupSettings 初次挂载无写操作。TypeScript 与 Android Java 编译通过；Android 编译使用 Android Studio JBR（当前系统 Java 25 与 Gradle 8 不兼容）。没有设备、远端或更新通道操作。
