# Zenix 自定义音乐源接入设计

状态：2026-09-29 已接入 Zenix v1 源与 LX Music 桌面版 `.js` 源兼容。LX 源使用独立的酷我、酷狗、QQ 音乐、网易云、咪咕搜索目录，再将歌曲信息交给脚本解析播放地址。可导入本地 `.js` 或 HTTPS `.js` 地址，在源选项中切换搜索目录。源提供方的解析接口是否可用、每首曲目的播放权限仍由源本身决定。Zenix v1 作者格式见 [协议说明](zenix-source-protocol.md)。

## 目标与参考边界

Zenix v1 源自行提供在线搜索、曲目信息、播放地址等能力；LX `.js` 源由 Zenix 的五平台目录提供搜索，安装的 LX 脚本解析播放地址。不要求登录。现有本地文件、M3U、个人歌单、贴纸播放器和桌面 LRC 保留；**本地曲库作为备用来源**，无在线源或网络故障时仍可独立搜索和播放。

借鉴 LX Music 的“目录歌曲信息 → 按需解析音频 URL → 播放器”链路、脚本隔离和返回值校验。LX 自定义脚本主要实现 `musicUrl`；目录搜索由 LX 项目内置音乐 SDK 提供。Zenix 因而独立实现搜索目录，再把歌曲信息传给导入的 LX 脚本。参考：[LX 自定义源协议](https://lxmusic.toside.cn/desktop/custom-source)、[LX 音乐 SDK](https://github.com/lyswhut/lx-music-desktop/blob/master/src/renderer/utils/musicSdk/index.js)、[LX 脚本宿主](https://github.com/lyswhut/lx-music-desktop/blob/master/src/main/modules/userApi/renderer/preload.js)。

## 用户从哪里添加和使用音乐源

LX 脚本使用流程：在首页“播放器设置 → 音乐源”导入本地 `.js` 文件或粘贴 HTTPS `.js` 地址，核对脚本名称与哈希后确认。安装时会在隔离窗口运行脚本并读取其 `inited.sources`；若没有声明可用平台，安装失败且不会覆盖原版本。安装后通过“源选项 → LX 搜索目录”选择该脚本声明的平台，再从顶部搜索框搜索和播放。首选音质映射到 LX 的 `128k`、`320k`、`flac`；源不支持时选择其声明的可用音质。某首歌的解析服务返回错误时，该首歌会显示错误，其他源和本地曲库继续可用。

- **首页环绕卡“播放器设置” → 音乐源**是正式管理入口：添加、启停、排序、更新、移除；每张源卡显示版本、能力、音质、授权域名、状态与最近错误。
- **顶部搜索条进入的搜索面板**默认搜索全部已启用在线源；可以单选一个源，底部有“本地歌曲”备用区。无源时显示“添加音乐源”入口并继续提供本地结果。
- **导入方式**：本地 `.zenixsource` 包、HTTPS 清单地址、LX `.js` 文件或 HTTPS `.js` 地址，以及供 Zenix 源作者调试的源文件夹。用户可在高级入口粘贴源地址；不需要修改项目代码。
- 导入时先预览清单、能力和域名，确认启用后才运行。相同源 ID 的更新先验证新版，成功才切换；失败回退旧版。远程包记录 SHA-256，更新不静默执行。
- 设置页提供“打开源文件夹”；统一配置导出尚未实现。首次启动可以跳过源配置，纯本地模式始终可用。

搜索面板输入约 300 ms 后并发查询，回车、放大镜或点击面板外空白区直接展示当前结果贴纸；首页搜索条提交后进入结果空间。单源故障只影响其分组。同名但来源不同的歌曲保留独立标识。播放按接入顺序尝试源与可用音质，匹配歌名、艺人及时长；完整音频缓存可用时优先从本机播放，本地文件仍作为手动备用。

## Zenix 源包与协议 v1

源文件夹包含 `manifest.json` 与 `index.js`；单文件 `.zenixsource` 将两者放入 `{ manifest, script }` JSON 对象。清单声明稳定的 ID、版本、能力、音质、网络域名和可编辑选项：

```json
{
  "schemaVersion": 1,
  "id": "org.example.music",
  "name": "示例音乐源",
  "version": "1.0.0",
  "entry": "index.js",
  "capabilities": ["search", "resolvePlayback", "lyrics", "artwork"],
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
          └─ AudioCache ── 流式保存、容量限制与缓存复用
```

**搜索。** 输入变化产生请求序号；旧搜索返回值不再参与展示。主进程只查询已启用且支持搜索的源，各源单独分页、并发限额和错误状态。结果校验长度、ID 和字段，同源按 `remoteId` 去重，跨源保留各自版本。搜索元数据可短时缓存，播放 URL 不进入缓存。本地结果由现有曲库索引独立提供。

**播放。** 队列只保存歌曲引用。选择在线曲目时 `PlayerController` 向主进程请求临时媒体会话；源返回的 URL、音质、有效期、请求头和最终域名由宿主校验。现有 `yzqxy://` 协议增加 `stream` 路由，主进程代理音频请求并正确处理 `Range`、`206` 和 `Content-Range`，以支持拖动进度。URL 过期时仅重解析当前曲目一次并恢复位置；切歌后的旧请求由选择令牌抛弃。`player.ts` 已有 `selectionToken/trackResolver` 可复用，但在线曲目不能因为 `audioUrl` 非空就永久跳过解析。

音质采用用户设置的首选档位，先与源声明的档位求交集；缺少首选档时按用户允许的降级顺序尝试，并在播放条显示实际音质。源解析成功但返回无法播放的格式时明确报错，不能只靠文件扩展名假定解码能力。网络限流时遵守源返回的重试时间，避免切歌队列连续重试同一故障源。

**歌词和封面。** 与播放并行请求，分别缓存和过期。歌词进入现有贴纸歌词及桌面 LRC；封面用于贴纸、播放条、收藏卡和系统媒体信息。远程图片不直接加载到主 UI，走受控缓存地址。

**缓存与离线。** 当前已取消主动歌曲下载，包括结果按钮、任务 UI、后台任务和下载 IPC。播放过程保存完整音频缓存，以歌曲身份和音质关联；再次播放时优先读取完整缓存，缓存不完整或已淘汰则重新获取。容量限制和 30 天未使用的淘汰规则保留，本地文件可独立离线播放。旧下载文件不自动删除或恢复任务。

## 配置与个人数据落盘

根目录使用 `app.getPath('userData')`，沿用已有用户数据位置，不硬编码产品名：

```text
userData/
  sources/index.json                 # id、版本、启停、顺序、来源、SHA-256、授权域名
  sources/<sourceId>/<version>/      # manifest.json、index.js
  source-settings.json               # 用户填写的公开配置项
  source-cache/                      # 可清理的搜索、歌词、封面缓存
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
| 4. 缓存与备用 | 音频流缓存、容量管理、本地曲库备用 | 完整缓存可复用；清缓存不删除歌单和本地文件 |
| 5. LX 兼容 | 独立 LX 脚本运行器与五平台搜索目录，不改变 Zenix v1 协议 | 脚本初始化后才安装；源选项只列实际声明的平台，搜索结果包含脚本所需的歌曲 ID 与元数据 |

每阶段在实际 Electron 窗口验收。开发时使用自制的本地示例源和测试媒体完成全链路检查，不把测试平台接口或第三方源脚本预装进正式应用。

### 完整验收清单

1. 零源安装、无网络：本地歌曲可搜索、播放、收藏和查看歌词；在线区给出添加入口。
2. 安装有效源：能预览权限、设置源选项、搜索两页、播放、拖动进度、加载贴纸和桌面歌词。
3. 同时启用两源：结果分组逐步出现，切源、排序与同源去重正确；一个源超时不阻塞另一个。
4. 快速改关键词、连续切歌：旧结果和旧播放 URL 不覆盖新选择；暂停、下一首和重启队列工作正常。
5. 临时地址过期：刷新一次且继续原曲原位置；仍失败有明确原因与本地备用入口。
6. 停用、更新失败或移除源：收藏和歌单记录不丢失；停用源停止新请求，重新启用同 ID 能恢复。
7. 缓存完成、应用重启、断网：完整缓存可用时读取本机，淘汰后显示网络获取结果；历史只保留一条。
8. 无效脚本、越权域名、异常数据和卡死：只隔离该源，主窗口和本地曲库继续可用。
