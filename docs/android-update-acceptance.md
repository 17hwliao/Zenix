# Android 原签名真机更新验收

本工具仅位于 `androidTest`，不编入应用发行 APK。用原发行签名构建单独验收 APK，不生成或更换密钥。连接授权设备后可在目标应用 UID 内调用生产更新与存储实现；系统安装仍保留 Android 确认。

```powershell
cd android
.\gradlew.bat :app:assembleReleaseAndroidTest -PzenixAcceptance
adb install -r app/build/outputs/apk/androidTest/release/app-release-androidTest.apk
adb shell am instrument -w -e mode snapshot com.zenix.musicplayer.test/com.zenix.acceptance.UpdateAcceptanceInstrumentation
```

先核验验收 APK 和既有应用发行证书一致。`snapshot` 只输出版本、证书、原加密配置 / 备份的大小和哈希，并在 `files/update-acceptance/first-stable-20261008` 保存独立校验标记。不输出用户歌曲、脚本、配置内容或密钥。

`seed` 在该独立目录创建合成档案：喜欢、收藏、歌单、名片和缓存设置；目录已有档案时拒绝重置。覆盖更新后执行 `verify`，由实际新版本 PrivateStore 解密读取并检查上述合成资料，主用户档案不受改动。

`check`、`download`、`install` 调用已安装客户端中的生产 AppUpdates，并使用内置通道、公钥、HTTPS 网络和全部文件 / APK 校验。通过 `-e channel preview` 选择候选通道（默认 preview）；测试前须先核对服务器候选清单 / 工件，禁止提前切换 stable。安装模式会启动实际主 Activity，由原生产安装器请求系统安装；遇到未知来源权限页须由用户授权并重新执行。

每次必须保存完整结果，检查 JSON `ok`、更新 status、构建号及安装前后资料摘要。`INSTRUMENTATION_CODE: -1` 表示 RESULT_OK，但单独的 check / download 结果仍可能为 error；不能把 instrumentation 运行成功当作更新验收成功。

验收完整链路后可仅卸载辅助包 `com.zenix.musicplayer.test`；不得卸载目标应用或清空其数据。独立合成目录可暂留作后续版本复验。辅助包绝不能作为用户安装包上传。
