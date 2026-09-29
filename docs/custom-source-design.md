# Zenix 自定义音乐源接入设计

状态：设计稿，尚未实现。2026-09-29 已确认第一版采用 **Zenix 完整源协议**，LX Music 脚本兼容放到后续。

## 目标与参考边界

在线搜索、曲目信息、播放地址、歌词、封面和可下载音频由用户安装的源提供。Zenix 不预置平台采集接口，也不要求登录。现有本地文件、M3U、个人歌单、贴纸播放器和桌面 LRC 保留；**本地曲库作为备用来源**，无在线源或网络故障时仍可独立搜索和播放。

借鉴 LX Music 的“目录歌曲信息 → 按需解析音频 URL → 播放器”链路、脚本隔离和返回值校验。LX 自定义脚本主要实现 `musicUrl`；目录搜索由项目内置音乐 SDK 提供。因此直接导入一个 LX 脚本无法独立完成 Zenix 的搜索，必须另有目录适配。参考：[LX 自定义源协议](https://lxmusic.toside.cn/desktop/custom-source)、[LX 音乐 SDK](https://github.com/lyswhut/lx-music-desktop/blob/master/src/renderer/utils/musicSdk/index.js)、[LX 脚本宿主](https://github.com/lyswhut/lx-music-desktop/blob/master/src/main/modules/userApi/renderer/preload.js)。

## 用户从哪里添加和使用音乐源

- **首页环绕卡“播放器设置” → 音乐源**是正式管理入口：添加、启停、排序、更新、移除；每张源卡显示版本、能力、音质、授权域名、状态与最近错误。
- **顶部搜索条进入的搜索面板**默认搜索全部已启用在线源；可以单选一个源，底部有“本地歌曲”备用区。无源时显示“添加音乐源”入口并继续提供本地结果。
- **导入方式**：本地 `.zenixsource` 包、HTTPS 清单地址，以及供作者调试的源文件夹。用户可在高级入口粘贴清单地址；不需要修改项目代码。
- 导入时先预览清单、能力和域名，确认启用后才运行。相同源 ID 的更新先验证新版，成功才切换；失败回退旧版。远程包记录 SHA-256，更新不静默执行。
- 设置页提供“打开源文件夹”和“导出源配置”。首次启动可以跳过源配置，纯本地模式始终可用。

搜索输入约 300 ms 后并发查询：先返回的源先展示；单源故障只影响其分组。同名但来源不同的歌曲不自动合并。播放失败只对原来源刷新过期地址一次，不擅自改播另一来源的同名歌曲。普通本地文件可以作为备选结果；只有已下载副本或用户明确绑定的本地文件才会自动替代该在线曲目，避免误播翻唱和现场版。

## Zenix 源包与协议 v1

源包包含 `manifest.json` 与 `index.js`。清单声明不可变的 ID、版本、能力、音质、网络域名和可编辑选项：

```json
{
  "schemaVersion": 1,
  "id": "org.example.music",
  "name": "示例音乐源",
  "version": "1.0.0",
  "entry": "index.js",
  "capabilities": ["search", "resolvePlayback", "lyrics", "artwork", "resolveDownload"],
  "qualities": ["standard", "high", "lossless"],
  "network": {
    "apiHosts": ["api.example.org"],
    "mediaHosts": ["media.example.org", "*.cdn.example.org"],
    "artworkHosts": ["images.example.org"]
  },
  "settings": [
    { "key": "region", "label": "区域", "type": "select", "options": ["auto", "cn", "global"], "default": "auto" }
  ]
}
```

歌曲引用保存为 `sourceId + remoteId + 元数据`。当前 UI 需要字符串 ID，生成 `source:${encode(sourceId)}:${encode(remoteId)}`，两段分别转义。源更新不能更改 `sourceId`；歌单、收藏、历史和队列不持久化临时音频 URL、下载 URL 或请求头。

脚本通过 `zenix.register({...})` 注册方法，只能使用宿主提供的受限 `api.request()`、配置、取消信号和日志。每个方法接收和返回纯数据：

| 能力 | 输入 | 规范返回 | 作用 |
| --- | --- | --- | --- |
| `search` | `keyword, cursor, pageSize` | `items, nextCursor` | 每首至少有稳定 `remoteId`、歌名和歌手 |
| `resolvePlayback` | `remoteId, quality` | `url, actualQuality, expiresAt?, headers?` | 选择曲目时即时解析 |
| `lyrics` | `remoteId` | LRC 原文，可选翻译和逐字文本 | 缺失不阻止播放 |
| `artwork` | `remoteId` | 图片 URL 与可选有效期 | 宿主缓存后给 UI |
| `resolveDownload` | `remoteId, quality` | URL、格式、大小提示、有效期和请求头 | 独立能力；试听不代表可下载 |

可选扩展为 `playlistDetail`、`albumDetail`、`artistDetail`、`discover`。缺少能力时隐藏对应功能。搜索结果如果无法解析播放地址，应明确标为“仅浏览”。正式开发需同时交付协议类型声明、清单校验器、自制示例源与诊断页，让源作者在本地走完搜索到播放的全链路。

```js
zenix.register({
  async search({ keyword, cursor, pageSize }, api) {
    const data = await api.request({ url: `https://api.example.org/search?q=${encodeURIComponent(keyword)}` });
    return { items: data.items.map(song => ({ remoteId: String(song.id), title: song.title, artist: song.artist, duration: song.duration })), nextCursor: data.nextCursor ?? null };
  },
  async resolvePlayback({ remoteId, quality }, api) {
    const data = await api.request({ url: `https://api.example.org/track/${encodeURIComponent(remoteId)}?quality=${quality}` });
    return { url: data.url, actualQuality: data.quality, expiresAt: data.expiresAt };
  }
});
```

此代码只说明协议形状，不代表预置真实平台音乐源。

## 进程结构与核心数据流

```text
顶部搜索 / 播放列表 / 贴纸播放器
          │ 受限 IPC
          ▼
主进程 SourceManager ── 清单、配置、启停、状态、更新回退
          ├─ 每源独立沙箱运行器 ── api.request → 域名校验与网络请求
          ├─ CatalogService ── 搜索分页、取消、规范化、缓存
          ├─ MediaGateway ── 临时音频会话、请求头、Range/206、URL 刷新
          ├─ Artwork/LyricsCache ── 校验、缓存、过期处理
          └─ DownloadManager ── 持久任务与离线文件映射
```

**搜索。** 输入变化产生请求序号；旧搜索立即取消。主进程只查询已启用且支持搜索的源，各源单独分页、并发限额和错误状态。结果校验长度、ID 和字段，同源按 `remoteId` 去重，跨源保留各自版本。搜索元数据可短时缓存，播放 URL 不进入缓存。本地结果由现有曲库索引独立提供。

**播放。** 队列只保存歌曲引用。选择在线曲目时 `PlayerController` 向主进程请求临时媒体会话；源返回的 URL、音质、有效期、请求头和最终域名由宿主校验。现有 `yzqxy://` 协议增加 `stream` 路由，主进程代理音频请求并正确处理 `Range`、`206` 和 `Content-Range`，以支持拖动进度。URL 过期时仅重解析当前曲目一次并恢复位置；切歌后的旧请求由选择令牌抛弃。`player.ts` 已有 `selectionToken/trackResolver` 可复用，但在线曲目不能因为 `audioUrl` 非空就永久跳过解析。

音质采用用户设置的首选档位，先与源声明的档位求交集；缺少首选档时按用户允许的降级顺序尝试，并在播放条显示实际音质。源解析成功但返回无法播放的格式时明确报错，不能只靠文件扩展名假定解码能力。网络限流时遵守源返回的重试时间，避免切歌队列连续重试同一故障源。

**歌词和封面。** 与播放并行请求，分别缓存和过期。歌词进入现有贴纸歌词及桌面 LRC；封面用于贴纸、播放条、收藏卡和系统媒体信息。远程图片不直接加载到主 UI，走受控缓存地址。

**下载与离线。** 只有源声明 `resolveDownload` 才显示下载。任务按 `sourceId + remoteId + quality` 去重，状态为 `queued → resolving → downloading → paused/completed/failed`。写入 `.part`，服务端支持 Range 时续传，否则重下；完成后校验状态、长度与音频格式，再原子改名。保存在线 ID 到本地文件的映射，断网时优先播同 ID 的已下载副本。普通导入文件保持独立，可供用户手动指定为备用。任务在重启后可恢复。

## 配置与个人数据落盘

根目录使用 `app.getPath('userData')`，沿用已有用户数据位置，不硬编码产品名：

```text
userData/
  sources/index.json                 # id、版本、启停、顺序、来源、SHA-256、授权域名
  sources/<sourceId>/<version>/      # manifest.json、index.js
  source-settings.json               # 用户填写的公开配置项
  source-cache/                      # 可清理的搜索、歌词、封面缓存
  downloads/tasks.json              # 持久下载任务
  downloads/offline-map.json        # 在线 ID 到下载文件的映射
  personal-library.json             # 现有喜欢、收藏、历史、个人歌单
```

配置采用临时文件加原子替换。源代码与用户设置分开，更新时不覆盖设置；导出配置默认不带缓存、临时 URL 或私有请求头。现有 `source: 'online'` 记录按“旧来源”保留原 `providerId/remoteId` 与元数据，不自动归属到新源；可在管理页手动关联。`personal.cjs` 的 `cleanTrack/historyKey`、`player.ts` 队列持久化与 `TrackView` 必须一起迁移，统一稳定 ID，避免在线与离线副本形成重复记录。

## 隔离、权限与故障处理

源脚本在独立、无 Node 的沙箱页面运行，保持 `contextIsolation`、`sandbox` 和 `webSecurity` 开启；不开放文件系统、窗口创建、页面导航或任意 Electron API。主进程验证每条 IPC 的发送者、方法和参数；网络代理校验声明域名、协议、重定向、超时、并发和响应大小。没有声明的 CDN 域名不自动放行，源管理页显示新增域名请求。源卡死时终止该运行器，不拖住主窗口。这里遵循 [Electron 官方安全指南](https://www.electronjs.org/docs/latest/tutorial/security) 对不可信内容、IPC 和沙箱的建议。

源失败按“离线、超时、限流、地址过期、音质不支持、数据格式错误、歌词缺失”分类展示。失败日志隐藏请求头和敏感查询参数；源返回的 HTML 不作为应用 UI 注入。第一版不做账号、Cookie 或登录校验。

## 对现有代码的施工顺序

| 阶段 | 主要文件和改动 | 通过条件 |
| --- | --- | --- |
| 1. 源宿主 | 新建 `electron/sources/`；`main.cjs` 注册宿主和 IPC；`preload.cjs` 暴露最小桥；播放器设置卡增加音乐源页 | 可导入包/HTTPS 清单、预览权限、启停、更新回退；无源时本地曲库正常 |
| 2. 搜索 | `SearchOverlay.tsx` 接入异步多源结果和本地备用区；顶部搜索入口保持现状 | 可分页、切源、取消旧请求；一个慢源不阻塞其他源 |
| 3. 播放与资源 | 更新 `core/types.ts`、`ui/types.ts`、`App.tsx`、`player.ts`；实现主进程媒体网关、歌词与封面缓存 | 线上曲目可播放/拖动/切歌，URL 过期可刷新；两套歌词正常同步 |
| 4. 下载与备用 | 下载管理器、任务 UI、离线映射、本地手动绑定 | 暂停及重启可恢复；断网可播已下载副本；纯本地功能独立 |
| 5. 后续兼容 | LX 脚本适配加独立目录适配，不改变 Zenix v1 协议 | 明确显示 LX 脚本实际支持的能力，不出现“已导入但无法搜索”的假状态 |

每阶段在实际 Electron 窗口验收。开发时使用自制的本地示例源和测试媒体完成全链路检查，不把测试平台接口或第三方源脚本预装进正式应用。

### 完整验收清单

1. 零源安装、无网络：本地歌曲可搜索、播放、收藏和查看歌词；在线区给出添加入口。
2. 安装有效源：能预览权限、设置源选项、搜索两页、播放、拖动进度、加载贴纸和桌面歌词。
3. 同时启用两源：结果分组逐步出现，切源、排序与同源去重正确；一个源超时不阻塞另一个。
4. 快速改关键词、连续切歌：旧结果和旧播放 URL 不覆盖新选择；暂停、下一首和重启队列工作正常。
5. 临时地址过期：刷新一次且继续原曲原位置；仍失败有明确原因与本地备用入口。
6. 停用、更新失败或移除源：收藏和歌单记录不丢失；停用源停止新请求，重新启用同 ID 能恢复。
7. 下载暂停、应用重启、断网：任务可继续，完成后同 ID 曲目可离线播放，历史只保留一条。
8. 无效脚本、越权域名、异常数据和卡死：只隔离该源，主窗口和本地曲库继续可用。
