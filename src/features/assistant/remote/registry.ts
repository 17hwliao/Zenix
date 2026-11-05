import type {JsonSchema, ModelToolDefinition, RemotePlatform, ToolDefinition, ToolName} from './contracts';

const text = (maximum: number, description?: string): JsonSchema => ({type: 'string', minLength: 1, maxLength: maximum, description});
const choice = (...values: string[]): JsonSchema => ({type: 'string', enum: values});
const integer = (minimum: number, maximum: number): JsonSchema => ({type: 'integer', minimum, maximum});
const decimal = (minimum: number, maximum: number): JsonSchema => ({type: 'number', minimum, maximum});
const flag: JsonSchema = {type: 'boolean'};
const reference = text(180, '仅使用本会话查询结果中的客户端引用，不是歌曲 ID、路径或播放 URL。');
const references: JsonSchema = {type: 'array', items: reference, minItems: 1, maxItems: 50, uniqueItems: true};
const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object', properties, required, additionalProperties: false,
});
type Entry = Omit<ToolDefinition, 'wireName' | 'platforms' | 'conditions'> & {
  platforms?: readonly RemotePlatform[];
  conditions?: readonly string[];
};
const entry = (value: Entry): ToolDefinition => ({
  ...value,
  wireName: value.name.replaceAll('.', '_'),
  platforms: value.platforms ?? ['pc', 'android'],
  conditions: value.conditions ?? [],
});

/** Single source for model definitions, dispatch metadata and argument validation. */
export const toolRegistry: readonly ToolDefinition[] = Object.freeze([
  entry({name: 'context.read', module: 'context', batch: 'A', effect: 'read', confirmation: 'never', retry: 'query',
    description: '读取最少量的当前上下文。正在播放、界面选中、打开歌单及已连接设备分别返回客户端引用，不发送完整资料库。',
    parameters: object({include: {type: 'array', items: choice('current', 'selection', 'playlist', 'devices'), minItems: 1, maxItems: 4, uniqueItems: true}}),
    resultDescription: '当前状态及可用对象引用，区分不存在、未选择和读取失败。'}),
  entry({name: 'playback.control', module: 'playback', batch: 'A', effect: 'playback', confirmation: 'never', retry: 'reconcile_before_retry', conditions: ['playback'],
    description: '播放、暂停、上一首、下一首或定位当前歌曲。上一首是播放操作，队列位置资料请用 music_query。下一首等结果不明时不能自动重试。',
    parameters: object({action: choice('play', 'pause', 'next', 'previous', 'seek'), positionSeconds: decimal(0, 86400)}, ['action']),
    resultDescription: '实际播放状态，区分开始加载与已经播放。'}),
  entry({name: 'playback.set_volume', module: 'playback', batch: 'A', effect: 'playback', confirmation: 'never', retry: 'set_target', conditions: ['playback'],
    description: '把音量设置为确定的目标值，0 为静音，1 为最大。先查询当前音量再换算相对调整。',
    parameters: object({value: decimal(0, 1)}, ['value']), resultDescription: '核对后的目标音量。'}),
  entry({name: 'playback.set_mode', module: 'playback', batch: 'A', effect: 'playback', confirmation: 'never', retry: 'set_target', conditions: ['playback'],
    description: '设置明确的循环和随机播放目标，至少给出一个字段。',
    parameters: object({repeat: choice('off', 'all', 'one'), shuffle: flag}), resultDescription: '实际循环与随机播放设置。'}),
  entry({name: 'music.search', module: 'search', batch: 'A', effect: 'read', confirmation: 'never', retry: 'query', conditions: ['search'],
    description: '实际检索歌曲并返回最多十个候选引用、歌曲名、歌手和版本信息。每次新搜索替换本轮候选，打开搜索页不等于检索成功。',
    parameters: object({query: text(120), limit: integer(1, 10)}, ['query']), resultDescription: '候选列表、真实失败或真实空结果。'}),
  entry({name: 'music.play_result', module: 'playback', batch: 'A', effect: 'playback', confirmation: 'never', retry: 'reconcile_before_retry', conditions: ['playback', 'search'],
    description: '播放仍然有效的指定搜索候选。必须使用本会话 music_search 返回的候选引用，禁止构造 ID 或 URL。',
    parameters: object({candidateRef: reference}, ['candidateRef']), resultDescription: '指定版本的加载或播放状态，过期引用需要重新搜索。'}),
  entry({name: 'music.query', module: 'library', batch: 'A', effect: 'read', confirmation: 'never', retry: 'query', conditions: ['playback', 'library'],
    description: '查询当前歌曲、界面选中、指定引用、队列前后各十首以内或最近十首以内的资料。顺序来自实际队列或播放记录。歌词只返回必要的单句/有界片段，默认全部信息不包含整首歌词。',
    parameters: object({scope: choice('current', 'selected', 'queue', 'history', 'reference'), trackRef: reference, from: integer(-10, 10), to: integer(-10, 10), count: integer(1, 10),
      fields: {type: 'array', items: choice('all', 'title', 'artist', 'album', 'duration', 'year', 'source', 'saved', 'lyrics', 'progress', 'cover'), minItems: 1, maxItems: 11, uniqueItems: true}}, ['scope']),
    resultDescription: '有限歌曲资料、引用和顺序依据；不能确认队列位置时明确说明。'}),
  entry({name: 'playlist.find', module: 'library', batch: 'B', effect: 'read', confirmation: 'never', retry: 'query', conditions: ['library'],
    description: '按歌单名称查找，返回最多十个歌单名称、数量与客户端引用，不返回完整歌单曲目。省略 query 查询最近列表。',
    parameters: object({query: text(100), limit: integer(1, 10)}), resultDescription: '歌单候选引用及真实数量，保留重名结果供选择。'}),
  entry({name: 'playlist.open', module: 'navigation', batch: 'B', effect: 'navigation', confirmation: 'never', retry: 'set_target', conditions: ['library', 'navigation'],
    description: '打开指定歌单，保留当前播放。引用必须来自客户端查找结果。',
    parameters: object({playlistRef: reference}, ['playlistRef']), resultDescription: '界面实际接收跳转后才返回已打开。'}),
  entry({name: 'playlist.create', module: 'library', batch: 'B', effect: 'write', confirmation: 'always', retry: 'reconcile_before_retry', conditions: ['library'],
    description: '创建歌单，可在同一个客户端确认计划中加入指定歌曲引用。确认目标固定，不随用户切歌改变。创建和加歌的部分完成必须如实返回。',
    parameters: object({name: text(100), trackRefs: references}, ['name']), resultDescription: '确认计划或已核实保存的新歌单，结果不明时先核对，禁止自动重建。'}),
  entry({name: 'playlist.add_tracks', module: 'library', batch: 'B', effect: 'write', confirmation: 'always', retry: 'reconcile_before_retry', conditions: ['library'],
    description: '将明确的歌曲引用加入已有歌单，确认固定歌单、歌曲和版本，已存在的条目不重复加入。',
    parameters: object({playlistRef: reference, trackRefs: references}, ['playlistRef', 'trackRefs']), resultDescription: '保存、部分成功、冲突或结果未确认。'}),
  entry({name: 'playlist.remove_tracks', module: 'library', batch: 'B', effect: 'write', confirmation: 'always', retry: 'reconcile_before_retry', conditions: ['library'],
    description: '从指定歌单移出明确歌曲，保留音频、历史及其他歌单。确认前后核对歌单内容，发生冲突必须重新确认。',
    parameters: object({playlistRef: reference, trackRefs: references}, ['playlistRef', 'trackRefs']), resultDescription: '保存、冲突或结果未确认。'}),
  entry({name: 'collection.set', module: 'library', batch: 'B', effect: 'write', confirmation: 'batch', retry: 'set_target', conditions: ['library'],
    description: '为明确的歌曲设置喜欢或收藏的目标状态。单首直接执行，批量先确认。“这首”默认指正在播放，选中歌曲须使用 selection 查询返回的引用。',
    parameters: object({kind: choice('liked', 'favorites'), value: flag, trackRefs: references}, ['kind', 'value', 'trackRefs']), resultDescription: '具体歌曲及核实后的喜欢或收藏状态。'}),
  entry({name: 'lyrics.configure', module: 'lyrics', batch: 'A', effect: 'write', confirmation: 'never', retry: 'set_target', conditions: ['lyrics'],
    description: '设置当前歌曲的歌词纯净模式、悬浮歌词开关或确定的歌词偏移秒数，负值提前。至少给出一个设置。需要系统权限时返回需用户处理。',
    parameters: object({pure: flag, overlay: flag, offsetSeconds: decimal(-30, 30)}), resultDescription: '实际设置或权限缺口，不把打开设置页当作设置成功。'}),
  entry({name: 'cache.prepare', module: 'tasks', batch: 'C', effect: 'task', confirmation: 'always', retry: 'reconcile_before_retry', conditions: ['tasks', 'library'],
    description: '为已找到的歌单建立缓存后台任务，确认中固定歌曲。任务建立不代表缓存已完成，可能产生音乐网络流量。',
    parameters: object({playlistRef: reference, pin: flag}, ['playlistRef']), resultDescription: '后台任务建立及任务状态，不宣称下载完成。'}),
  entry({name: 'tasks.query', module: 'tasks', batch: 'C', effect: 'read', confirmation: 'never', retry: 'query', conditions: ['tasks'],
    description: '查询有限的缓存任务与正在进行的网络任务，不启动下载。',
    parameters: object({include: choice('active', 'all'), limit: integer(1, 20)}), resultDescription: '任务实际状态及已完成数量，查询失败不能报为零任务。'}),
  entry({name: 'network.set_policy', module: 'tasks', batch: 'C', effect: 'write', confirmation: 'always', retry: 'set_target', conditions: ['network'],
    description: '设置音乐音频、歌词、封面及预加载的联网偏好，至少一个字段。影响后续音乐请求，系统更新与设备协作独立。',
    parameters: object({audio: choice('always', 'unmetered', 'never'), lyrics: choice('always', 'unmetered', 'never'), artwork: choice('always', 'unmetered', 'never'), preload: choice('always', 'unmetered', 'never')}),
    resultDescription: '已保存的音乐联网策略及当前连接的限制说明。'}),
  entry({name: 'navigation.open', module: 'navigation', batch: 'A', effect: 'navigation', confirmation: 'never', retry: 'set_target', conditions: ['navigation'],
    description: '打开软件已有页面。歌单必须通过 playlist_open 指定客户端引用，本轮不提供星轨操作。',
    parameters: object({page: choice('home', 'space', 'search', 'queue', 'settings', 'tasks', 'stats', 'connections')}, ['page']), resultDescription: '页面确已接收跳转，或当前页面无法接收。'}),
  entry({name: 'roaming.configure', module: 'roaming', batch: 'C', effect: 'write', confirmation: 'always', retry: 'reconcile_before_retry', conditions: ['roaming'],
    description: '设置已有漫游能力，开始、暂停、继续、临时岔路、回原路线或减少指定歌曲。临时岔路不打断当前播放；减少偏好针对歌曲，不推断整类曲风。',
    parameters: object({action: choice('start', 'pause', 'resume', 'temporary_branch', 'return', 'reduce_track'), keyword: text(100), count: integer(1, 5), trackRef: reference}, ['action']),
    resultDescription: '实际漫游状态或偏好保存状态。'}),
  entry({name: 'stats.query', module: 'stats', batch: 'C', effect: 'read', confirmation: 'never', retry: 'query', conditions: ['stats'],
    description: '查询本周、本月或本年听歌统计，只返回汇总和有限排行。',
    parameters: object({period: choice('week', 'month', 'year')}, ['period']), resultDescription: '实际听歌时长、次数、歌曲数量和有限排行。'}),
  entry({name: 'timer.configure', module: 'timer', batch: 'C', effect: 'write', confirmation: 'never', retry: 'set_target', conditions: ['timer'],
    description: '设置或取消睡眠定时器，时间到后停止播放并保留应用。set 必须提供 minutes，cancel 不接受 minutes。',
    parameters: object({action: choice('set', 'cancel'), minutes: integer(1, 720)}, ['action']), resultDescription: '核实后的定时器状态。'}),
  entry({name: 'device.transfer', module: 'connections', batch: 'C', effect: 'task', confirmation: 'always', retry: 'reconcile_before_retry', platforms: ['android'], conditions: ['device_connected'],
    description: '从手机向已配对并已授权的电脑发送当前播放接力，或将指定歌曲提交为下一首。等待远端接收期间保留当前播放。设备引用由 context_read 提供。',
    parameters: object({deviceRef: reference, kind: choice('handoff', 'submission'), trackRef: reference}, ['deviceRef', 'kind']), resultDescription: '协作请求已发送、已接受、失败或状态未知，不把发送当作电脑已播放。'}),
  entry({name: 'backup.export_playlists', module: 'backup', batch: 'C', effect: 'write', confirmation: 'never', retry: 'reconcile_before_retry', conditions: ['library', 'export'],
    description: '使用已有系统保存入口导出歌单清单。all 导出所有自定义歌单，selected 必须提供歌单引用，不含音频及 API Key。取消保存如实返回取消。',
    parameters: object({scope: choice('all', 'selected'), playlistRefs: references}, ['scope']), resultDescription: '系统确认保存或取消，不自动上传。'}),
  entry({name: 'updates.check', module: 'updates', batch: 'C', effect: 'read', confirmation: 'never', retry: 'query', conditions: ['updates'],
    description: '通过已有可信更新入口检查版本，沿用用户通道设置。不安装或更改发行身份。',
    parameters: object({}), resultDescription: '真实更新检查状态或网络错误。'}),
]);

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return toolRegistry.find(tool => tool.name === name || tool.wireName === name);
}

export function toolsForPlatform(platform: RemotePlatform, available?: ReadonlySet<ToolName>): ModelToolDefinition[] {
  return toolRegistry.filter(tool => tool.platforms.includes(platform) && (!available || available.has(tool.name)))
    .map(tool => ({type: 'function', function: {name: tool.wireName, description: tool.description, parameters: structuredClone(tool.parameters)}}));
}
