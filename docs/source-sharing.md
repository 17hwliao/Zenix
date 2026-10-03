# 分享音乐源

入口：Windows 个人主页 → 播放器设置 → 音乐源 → **导入分享源包**；Android/iOS 的音乐源页面同名入口。选择 `.zenixsources` 文件，检查列表后确认批量添加。

1.0.1 修补版增加 **导入分享源包 / ZIP**：收到分享 ZIP 可直接选择，不用解压。也支持内容相同的 `.json` 文件和 UTF-8 / UTF-16 文本。Android / iOS 使用系统文件选择器读取完整文件，导入前在原生层计算 SHA-256；桌面仍通过 Web Crypto 校验。ZIP 中只解压源包清单，不把外层 `scripts/` 写入设备。文件及解压后的清单均限制为 8 MiB。

移动端音乐源页顶部保留 **通过链接添加音乐源**，接受公开的 HTTP / HTTPS `.js` 或 `.zenixsource` 地址；单脚本使用 **选择 .js / .zenixsource 文件**。分享源包的联网入口仍使用 HTTPS，以 `.zenixsources` JSON 直链为输入；不要将分享 ZIP 链接粘贴到单脚本入口。

0.3.0 还支持 **获取源包**（HTTPS 直链）、**设为我的专用源入口**及**载入专用源包**。个人入口仅保存到本机，发行默认入口由公开配置中的 `managedSourcesUrl` 决定；当前没有设置公开默认源地址。联网源包上限 4 MiB，本地文件上限 8 MiB。详见 [更新与专用源说明](automatic-updates.md#三端专用源便捷载入)。

源包中条目按顺序逐个安装，某个源失败不阻止后面的源，界面显示进度、成功数量及逐项错误，并允许重试失败项或完成当前项后停止。离开页面会停止后续条目，当前操作完成后释放忙碌状态。已安装的同一个源更新后保留原有接入位置。新增源进入现有解析队列，不改变播放回退逻辑。

1.0.0 支持 `.zenixsources` JSON 文件，但不支持直接读取 ZIP；请解压后选择其中的 `.zenixsources`。更早的单脚本客户端可从 `scripts/` 逐个导入 `.js`。

## 两种分享文件

- `Zenix-Sources-日期.zenixsources`：脚本快照、原始地址及 SHA-256。获取成功的脚本内嵌于文件，导入时无需再次下载；初始化、解析与播放仍可能需要联网或作者授权。没有声称这些脚本已通过在线播放验收。
- `Zenix-Sources-日期-Links.zenixsources`：只有公开链接，导入时获取上游当前脚本。适合需要重新获取最新脚本的用户。

脚本校验检查文件完整性，不代表作者身份认证。用户确认后脚本在现有运行器执行；分享包不创建新的权限模型。

自制分享资料生成命令：`npm run pack:sources`。输出到忽略的 `release/source-bundles/日期/`，包含快照包、链接包、原始 `.js` 及说明。生成过程只下载公开上游数据，不执行脚本，也不读取开发者的已安装源、授权字段、歌单、歌曲、个人资料或背景。分享资料与软件安装包分开，外部脚本不会自动打包进应用或仓库。

来源为现有快捷入口中的 [pdone/lx-music-source](https://github.com/pdone/lx-music-source) 与 [星海聚合源](https://github.com/cdyUuu/lx-music-xinghai-source)。保留原始脚本及作者声明，各脚本权利和使用条件属于原作者；不将其声明为 Zenix 自有代码。

## 文件协议

```json
{
  "format": "zenix-source-bundle",
  "schemaVersion": 1,
  "name": "分享源包名称",
  "sources": [
    { "name": "源名称", "url": "https://example.com/source.js" }
  ]
}
```

`script` 可选；包含时必须附带对应 UTF-8 文本的 `sha256`。源包不超过 8 MiB、1–24 条，不接受重复地址、非 HTTP / HTTPS 地址、URL 中的账号密码；单个脚本不超过 512 KiB。HTTP / HTTPS 原始地址仍经过各平台已有的公网地址及重定向校验。保留上游地址作为桌面源身份，避免快照导入与快捷入口产生两个记录。移动端沿用其原有源身份规则。
