# 播放与版本功能集成

本模块对应规划9、10、11、17、18、19。保留原播放器、源解析和三候选状态等待契约；不改发行身份或更新网络。

## 双端入口

共享 `src/features/playback/PlaybackFeaturesPanel.tsx`：

```ts
{ playback: PlayerState;
  sources: InstalledSource[];
  invoke: <T=unknown>(action:string,payload?:Record<string,unknown>)=>Promise<T>;
  diagnostics?:()=>Promise<SourceDiagnosticsState>; }
```

PC在入口动态导入 `src/features/playback/desktop.ts` 的 `desktopPlaybackFeature`。Android调用 `command('playbackFeature',{operation:action,...payload})`，桥接须在主线程交给 `PlaybackService.playbackFeature(args)` 并返回其结果。不能将desktop handler静态导入移动入口，否则会创建额外HTMLAudio播放器。

动作：preferences、preferencesSave(value)、state、practice(enabled/start/end/rate)、preview(track/start/length)、previewStop、recover(trackId)、replacementInfo。

普通搜索结果的版本待播放选择可使用 `versionPreferences.order`；保持已经显示的贴纸代表ID/位置，不因异步偏好重新建立空间。

## 状态和边界

- PC偏好键 `zenix.playback-preferences.v1`；Android原私有store键 `playbackPreferences`。只保存模式、目录版本引用、排除候选，不保存URL/凭据。默认保留搜索顺序；偏好在PC和Android平替候选上实际生效，仍最多三候选。
- 试听使用独立音频实例，原播放器暂停并保留队列与进度；音频进度到20秒后恢复原播放意图。解析本身无额外总时限。主动选歌取消试听，迟到结果不可夺回播放。漫游期间先结束漫游才试听，避免同时运行两个推进器。
- A-B区间与当前歌曲绑定，切歌清除区间和恢复1倍速度；支持0.5–1.5倍。歌词范围可由调用端将歌词起止秒传practice，现有歌词组件未额外接专用按钮。
- 原地恢复保护当前歌曲身份和位置，不重建队列；不把URL检查当成实际播放成功。平替说明通过replacementInfo读取真实持久化状态。
- 音源健康只读取现有诊断，不定时探测。错误提示可关闭并允许长文本换行。

## 缓存任务接口

PlaybackService新增包级 `offlineCache()`、`offlineBudget()`、`Future<?> offlineRemember(song,result)`；复用同一SimpleCache和串行映射写入。完整缓存优先；只有未命中缓存才调用 `NetworkPreferences.require(context,store,"audio")`。CacheBudget构造使用NetworkPreferences.pinned。

## 必要验证

新增 `node --test scripts/Test-PlaybackFeatures.cjs` 覆盖偏好排序/去敏保存、生产Player区间循环/重置、试听队列与进度保留、主动选歌后迟到结果隔离。保留既有Test-PlatformReplacement三次额度/取消/状态等待回归。Android继续通过生产类JVM合同及真实Java编译验证；无设备体验或系统升级通过声明。

## 2026-10-22 集成Review修复

- P1：原曲仍解析、且已存在待恢复进度时，试听的暂停使旧selection token失效，返回后会丢失定位。试听会话单独保存原位置，只有仍拥有原歌曲时恢复当前token的pending seek；错误和取消沿用同一恢复路径。
- P1：Android试听原先直接检查联网策略，完整缓存也可能被audio=never拦截。现在先检查完整、身份匹配的缓存（包括已绑定候选录音），使用无上游CacheDataSource；未完整缓存才经过网络策略。普通播放partial缓存也不能绕过音频联网策略。
- P2：暂停的练习/正在解析的试听仍有100ms轮询。现在仅实际播放的区间练习或试听安排tick，isPlaying变更恢复/停止调度；连续切换试听直接保留恢复意图，不短暂重播主音频。
- P2：解析中的试听界面未提供可用取消。现在进入请求即显示停止按钮，停止操作不受请求busy锁阻挡，迟到结果不能重新开始。
- P1：歌词时间选区可能在歌曲/录音已改变后到达。practice支持expected歌曲与版本门禁（id、remoteId、replacementPlayback、playbackProviderId）；Android开始播放时发布实际版本标记，实际录音变更清除旧区间，PC同样处理。

新增生产行为回归覆盖试听错误、主动取消、原曲待解析时的定位恢复、旧版本练习拒绝，以及偏好修改不能补充三次额度。Android JVM直接执行生产完整缓存识别和练习tick决策。集成层歌词请求身份管理与双端入口由主agent处理。
