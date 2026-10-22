# 录音绑定与后台歌单预览审查

范围：本轮新增 recording.ts、sourcePlayback / desktopReplacement 的实际录音元数据、FeatureWorkbench 书签播放入口、LyricPractice、PersonalFeaturesPanel、ActivitiesPanel 与对应最小调用链。没有把任务开始前整个仓库差异归入本轮；没有操作用户客户端、用户资料或测试手机。

## 确认的问题与修复

1. **P2 后台导入失败无法恢复，页面重开可能丢失提交锁。** importConfirm 写入失败时两端后端保留 pending；原面板再次确认却调用 playlistPreview，必然遭到“先处理当前待接收歌单”拒绝。局部组件锁在切换页签后也失效。现将确认锁与 token 放在共享任务记录中：失败复用原 token；活动确认不能删除或被任务容量淘汰；明确放弃只提交自己的 token。若预览已被其他入口处理，提示先核对资料，既不清除其他预览，也不自动再导入。

2. **P2 书签解析晚到可能修改后来选择的歌曲进度。** Player.playTrack 在用户改歌导致取消时可能正常返回，原 Workbench 随后无条件 seek。现 openRecording 捕获启动选择时的 revision / alias id / 实际录音身份，交给两端原子 seek 验证；关闭工作台或发起新的定位使旧请求取消。播放器与原生门禁由主任务集成，原有普通 seek 签名保留兼容。

3. **P2 练习片段对录音版本的识别不完整。** 旧校验只比较实际 remoteId，录音更换 provider 而 remoteId 相同仍可能沿用旧歌词。现请求版本及练习 expected 同时包含 source / provider / remoteId 完整身份；末句结束时间使用实际录音时长，避免把原歌单版本时长用于平替版本。

## 验证

- `Test-FeatureIntegration.cjs`：11/11，覆盖取消晚到结果、后台事务共享锁、确认失败重试、放弃 token、其他入口处理预览后的保留、书签等待期间切歌和关闭取消、跨端 seek 期望参数等。
- `Test-FeatureWorkbench.cjs`：1/1，真实隔离 Vite + Electron + React；原有两端三种宽度六页签检查保留。新增模拟 Android 原生桥接下：保存 actual 录音书签、延迟歌词仍写原录音、同 remoteId 换 provider 丢弃旧歌词选区、确认失败切页重试仍使用一次预览。
- `npx tsc --noEmit` 通过。生产 Player / Android 原子 expected 门禁由主任务执行其真实实现回归。

PersonalFeaturesPanel 的歌词收录在点击回调中捕获当前 props，测试确认等待期间改歌不会把旧歌词误绑定新录音；本轮没有为此增加无依据的重写。sourcePlayback / desktopReplacement 的实际录音元数据与取消检查在本轮读取范围内未发现另一个可确认缺陷。

这是代码与隔离桥接检查；不代表真实设备网络、系统安装权限或发行升级链路已经验收。未提交、推送或发布。
