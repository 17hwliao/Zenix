# Android 更新下载修补 · v1.0.0 r19

本页是 r19 测试期的历史记录，不代表第一正式版或完整升级验收。当前正式基线为 r27，安装与更新请见 [当前更新说明](automatic-updates.md) 与 [全量审查记录](review-first-stable.md)。

用户提供的截图显示“音乐源不能访问内网、本机或保留地址”。这是更新下载调用 SourceHttp.check 时的 DNS 地址拒绝，尚未进入 APK 证书校验。音乐源限制会拒绝 198.18/15 等特殊网段，而 VPN 的 Fake-IP 路由可能在这些网段返回 GitHub 的转发地址。截图无法确定具体 VPN 或 DNS 配置；测试使用合成 Fake-IP 路由复现这个冲突。

## 修补

更新清单和 APK 使用独立 UpdateHttp 通道，只接受固定 GitHub HTTPS 主机、默认 443 端口、无用户凭据的 URL。每次重定向都重新检查目的服务器，禁用 HTTP 降级。DNS 查询有界，按系统网络路由连接，使用默认 TLS 证书信任与主机名检查。不会因为地址是代理转发用的 Fake-IP，就把可信的更新请求当作音乐源请求拒绝。

用户分享源包仍走 SourceHttp；音源原有私网、回环、保留地址和声明范围限制保持。更新清单 RSA 签名、APK SHA256 / 大小、包名、versionCode / versionName、已安装应用与新 APK 的签名一致性全部保留。下载取消会取消实际 OkHttp 请求，连接和正文总期限仍有界。

Android 更新状态补充当前 rN 及待更新 rN，避免只有 1.0.0 而无法辨别内部修订。公共版本仍为 1.0.0，Windows build / Android versionCode 为 19。

## 原发行身份

继续使用原正式发行密钥。Gradle 正式构建固定核对已发布证书 SHA256：`b40080130e2186eba857ea2778350b88fe896c33cc9e0116493022e5adb8514a`。若误配置另一份 keystore 或别名，构建失败，不生成新密钥或覆盖现有密钥。最终 APK 与 r15 / r18 的证书比对结果见发行验证记录。

## 旧版引导升级

旧客户端的下载限制已写入旧 APK，服务端换清单不能改掉这段代码。遇到上述报错，可通过浏览器打开当前 Release，下载同签名正式 APK 后直接覆盖安装一次，保留原应用数据；之后使用修补后的下载器。也可在网络工具中为 GitHub 关闭 Fake-IP 后重试旧版下载，但这取决于工具和网络配置。

不要卸载旧应用来解决这个网络报错。Debug 包与正式包的不同签名属于另一种问题，本次不会绕过 Android 签名要求，也不会改用 Debug 证书。

## 验证

新增合约直接运行生产 UpdateHttp / UpdateUrlPolicy：使用临时生成的合成 TLS 证书、198.18.0.2 DNS 结果和本地 TLS 路由，验证有效 HTTPS 跳转下载；验证 HTTP 降级、未知主机、不受信任证书、主机名不符、循环重定向及多阶段取消拒绝。SourceAddressPolicy 对 Fake-IP / 回环的拒绝仍通过。

完整自动回归为 68 项，通过 68，失败 0，跳过 0。双端构建、包内资源、APK 原证书及远程清单 / 资产结果见当前发行说明和本机验证记录。没有连接 Android 真机，不把合成 TLS 测试称为已验收用户的 VPN、网络或实际覆盖安装。

签名更新要求参考 [Android 官方应用更新说明](https://developer.android.com/google/play/app-updates)；默认 TLS 与网络传输参考 [OkHttp 官方说明](https://github.com/square/okhttp)。
