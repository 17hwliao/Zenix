# Zenix 自定义音乐源协议 v1

本文只说明 Zenix v1 完整源协议。软件另有 LX Music `.js` 兼容入口，使用独立的歌曲搜索目录与 LX 脚本解析播放地址。Zenix v1 源导入前会展示能力、版本和网络域名；LX 脚本在确认安装后运行，支持平台由脚本初始化信息决定。

## 包格式

`.zenixsource` 是 UTF-8 JSON 文件，顶层只有 `manifest` 与 `script`。也可导入包含 `manifest.json`、`index.js` 的源文件夹。HTTPS 地址需指向完整的 `.zenixsource` JSON 文件。源 ID 应长期稳定；同 ID 导入新版会在验证成功后替换旧版。

```json
{
  "manifest": {
    "schemaVersion": 1,
    "id": "org.example.music",
    "name": "示例音乐源",
    "version": "1.0.0",
    "capabilities": ["search", "resolvePlayback", "lyrics", "artwork", "resolveDownload"],
    "qualities": ["standard", "high", "lossless"],
    "network": {
      "apiHosts": ["api.example.org"],
      "mediaHosts": ["media.example.org", "*.cdn.example.org"],
      "artworkHosts": ["images.example.org"]
    },
    "settings": [
      { "key": "region", "label": "区域", "type": "select", "options": ["auto", "cn"], "default": "auto" }
    ]
  },
  "script": "zenix.register({ async search({ keyword, cursor, pageSize }, api) { const data = await api.request({ url: `https://api.example.org/search?q=${encodeURIComponent(keyword)}` }); return { items: data.items, nextCursor: data.nextCursor ?? null }; }, async resolvePlayback({ remoteId, quality }, api) { const data = await api.request({ url: `https://api.example.org/play/${encodeURIComponent(remoteId)}?quality=${quality}` }); return { url: data.url, actualQuality: quality }; } });"
}
```

上例仅说明结构，域名和接口均为占位值。自定义源脚本应使用其自身获得许可的内容接口，Zenix 不提供账号或 Cookie。

## 脚本接口

脚本调用 `zenix.register(handlers)` 一次。每个方法收到 `(payload, api)`；`api.settings` 是源选项，`api.request({ url, method?, headers?, body?, responseType? })` 是受限网络请求。`api.request` 仅访问清单中的 API 域名，支持 GET/POST，默认返回 JSON 或文本；`responseType: 'full'` 返回状态、响应头及正文。脚本不能直接访问文件系统、Node 或窗口 API。

| 方法 | payload | 返回 |
| --- | --- | --- |
| `search` | `{ keyword, cursor, pageSize }` | `{ items, nextCursor }`；每首至少包含 `remoteId`、`title`，可含 `artist`、`album`、`duration`、`coverUrl` |
| `resolvePlayback` | `{ remoteId, quality }` | `{ url, actualQuality?, expiresAt?, headers? }` |
| `lyrics` | `{ remoteId }` | LRC 字符串，或 `{ text, translationText?, format? }` |
| `artwork` | `{ remoteId }` | `{ url }`；若搜索结果有 `coverUrl`，优先使用它 |
| `resolveDownload` | `{ remoteId, quality }` | `{ url, format?, size?, headers? }`；`format` 建议给出 `mp3/flac/m4a/wav/ogg/opus/aac` |

每个方法必须在 `manifest.capabilities` 中声明才会被调用。`search` 返回的 `remoteId` 必须对同一首歌稳定，歌单、收藏、历史与离线文件都以源 ID 和该 ID 关联。播放和下载 URL 必须位于 `mediaHosts`；封面 URL 必须位于 `artworkHosts`。远程请求默认要求 HTTPS；本机 `localhost/127.0.0.1` 可使用 HTTP，便于源作者在本机调试。重定向的目标域名同样会校验。

Zenix 不存储临时播放 URL 到收藏、历史或队列。源停用或删除后保留这些歌曲的引用；同 ID 已下载的副本仍可离线播放。源的搜索、播放和歌词故障不会阻止本地曲库工作。
