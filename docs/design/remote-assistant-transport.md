# 远程音乐助手的模型连接

首版通过 PC Electron 主进程和 Android 原生网络直接请求用户配置的 HTTPS 服务。接口依据 [Chat Completions API](https://developers.openai.com/api/reference/resources/chat) 的工具调用格式实现。此次仅使用受控网络模拟验证，未调用真实付费模型。

## 首版兼容范围

- 服务地址可以填写 API 基址，例如 `https://example.com/v1`，也可以填写完整 `/chat/completions` 地址。客户端将基址补成最终请求路径。禁止 HTTP、URL 用户名密码、查询参数和 fragment。
- POST JSON 使用 `model`、`messages`、`stream: false`，有工具时增加 `tools` 和 `tool_choice: "auto"`。对话消息支持 `system`、`user`、`assistant`、`tool`，文字内容为字符串，助手工具消息允许 `null` 内容。
- 工具声明采用 `type: "function"`、`function.name/description/parameters`。模型返回 `choices[0].message.tool_calls`，参数必须位于字符串 `function.arguments` 中。业务参数仍由唯一功能注册表校验，原生传输仅校验消息与 JSON Schema 结构。
- 返回值只接受完整文字或完整工具调用，单轮最多四次调用。截断回复、未知工具、重复调用 ID、refusal 和非 JSON 回复会拒绝。
- 首版不支持 Responses API、SSE 流式回复、图像和音频消息、任意自定义鉴权头、供应商私有额外请求字段。模型名称由用户填写，客户端不把某个厂商或模型兼容性当成已验证事实。
- 连接测试只提供临时 `zenix_connection_probe`，强制模型返回客户端 nonce。返回 nonce 且格式正确才显示工具调用验证通过。测试不提供播放器、资料或设备工具，不执行任何模型返回的功能。每次测试会产生一条服务调用，具体费用以用户服务商计费为准。

## 原生边界

| 平台 | 实现 | 接线 |
| --- | --- | --- |
| PC | `AssistantModel({folder})`，启动时 `load()`，退出时 `close()` | `window.yzqxy.assistantModel.invoke(args)`，主窗口专属 IPC |
| Android | `new AssistantModel(Context)`，退出时 `close()` | `command('assistantModel', args)`，模型专属有界 worker |

统一请求形状如下。

```ts
{action: 'read'}
{action: 'configure', value: {enabled, endpoint, model, apiKey?, clearKey?}}
{action: 'test', requestId}
{action: 'complete', request: {requestId, revision, messages, tools}}
{action: 'cancel', requestId}
```

`read` 和 `configure` 只返回 `enabled/endpoint/model/keyPresent/keyHint/revision`。前端 `createNativeTransport` 提供公共 `NativeTransport` 接口，保存配置后发送 `zenix-assistant-model-configured` 事件供协调器废弃旧请求。

## 凭据和配置

PC 使用现有 safeStorage 加密机制，但保存在单独的 `assistant-model.private.json` 文件中。写入采用临时文件再原子替换，失败保留上次配置。Android 使用专属 `zenix.assistant-model.v1` Keystore 身份和 AES-GCM，文件位于 `getNoBackupFilesDir()`。模型密钥不写入普通 Zenix 配置、歌单、皮肤或常规备份。

凭据绑定完整规范化服务地址。只更换模型名称可以继续使用同一服务的 Key，任何地址变化都清除旧 Key，除非这次输入了新 Key。`clearKey` 显式清除凭据。加密服务失败不降级为明文，无法读取的旧文件保留并报告配置错误，本地音乐指令继续由本地入口处理。

网络请求使用正常 TLS 与主机名校验。PC 使用 Electron 系统网络栈，Android 使用默认 `HttpsURLConnection`，没有修改信任管理器。全部重定向被拒绝，Authorization 不随跨主机跳转转发。服务端失败正文和原始网络异常不回显，成功内容与工具参数也会剔除实际 Key，包括 JSON 转义形式。

## 生命周期与错误

每次配置保存产生新的 revision。请求在开始、接收响应、读完正文和返回前检查 revision 与取消状态。主动取消中断底层连接，即使原生回复迟到，前端也会立即结束等待。每个传输实例最多同时处理两个连接，取消编号按十五分钟及 128 项收拢。退出关闭活动连接和模型自己的 deadline 资源。

单次模型请求最多等待 90 秒，请求与响应各限制 256 KiB，对话最多 32 条消息，工具最多 32 项。这些上限只作用于模型理解与回复，不作用于音乐源解析、缓存或播放加载。模型返回的参数错误不会重放播放器操作。

错误分类包含未配置、配置变化、存储失败、鉴权失败、服务限流、HTTP 服务错误、重定向、网络错误、模型等待超时、取消、响应过大、协议错误、拒绝和忙碌。消息不会包含服务端原始正文或 API Key。

## 自动验证

`node --test scripts/Test-RemoteAssistantTransport.cjs` 验证 PC 原生服务及注册表输入、隔离加密存储读回、配置归属、失败写回滚、nonce 连接测试、重定向、鉴权错误脱敏、Key 回显过滤、取消和迟到结果、模型响应界限、配置损坏隔离及前端取消桥接。

同一套测试编译并运行生产 Android `AssistantModel` 与 `AssistantModelProtocol`。JVM 使用注入的内存 Vault 和受控 HttpURLConnection，覆盖请求与响应处理、HTTP 失败、凭据地址绑定、取消、deadline、写入失败和损坏配置。Android Keystore 与系统 TLS 的设备行为仍需后续独立验收，本轮未连接或安装手机。
