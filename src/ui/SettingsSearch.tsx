import {ArrowUpRight, Search} from 'lucide-react';

export type SettingsTab = 'playback' | 'sources' | 'space' | 'assistant' | 'devices' | 'data';
export type SettingSearchEntry = {
  title: string;
  category: string;
  description: string;
  tab: SettingsTab;
  target: string;
  keywords?: string;
};

export const settingEntries: readonly SettingSearchEntry[] = Object.freeze([
  {title:'输出设备',category:'播放',description:'选择声卡、耳机或系统默认输出',tab:'playback',target:'.listening-output',keywords:'扬声器 蓝牙 HDMI 音频 声音 output'},
  {title:'均衡器与声音预设',category:'播放',description:'原声、人声、低音、流行及自定义频段',tab:'playback',target:'.listening-audio details',keywords:'EQ 音效 音质 高音 低音 频段'},
  {title:'睡眠定时器',category:'播放',description:'设置到时停止播放的任务',tab:'playback',target:'.yz-settings-quick-tools',keywords:'定时 关闭 倒计时'},
  {title:'纯歌词',category:'播放',description:'当前句与前后各两句，越远越小并淡出',tab:'playback',target:'[data-setting="pure-lyrics"]',keywords:'纯净 歌词 五句 缩放 翻译 沉浸'},
  {title:'歌词显示',category:'播放',description:'字号、行距、字重、翻译与当前歌曲校正',tab:'playback',target:'[data-setting="lyrics"]',keywords:'字体 颜色 对齐 时间 偏移 翻译'},
  {title:'桌面歌词',category:'播放',description:'显示、锁定和调整桌面悬浮歌词',tab:'playback',target:'[data-setting="desktop-lyrics"]',keywords:'悬浮 字体 颜色 穿透'},
  {title:'减少动效',category:'播放',description:'缩短或关闭页面及歌词过渡动画',tab:'playback',target:'[data-setting="reduce-motion"]',keywords:'动画 性能 卡顿 reduced motion'},
  {title:'界面音效',category:'播放',description:'进入、返回和滑动贴纸的声音反馈',tab:'playback',target:'[data-setting="ui-sounds"]',keywords:'试听 音量 音色 进入 取消 滑动'},
  {title:'刷新本地曲库',category:'播放',description:'重新读取已导入的音乐',tab:'playback',target:'[data-setting="refresh-library"]',keywords:'扫描 文件夹'},
  {title:'导入音乐',category:'播放',description:'选择本地音乐文件夹',tab:'playback',target:'[data-setting="import-music"]',keywords:'本地 曲库 文件夹'},
  {title:'歌词主题',category:'音乐空间',description:'黑胶夜、影院幕布、CD 机、极简留白及本地主题包',tab:'space',target:'[data-setting="themes"]',keywords:'主题 皮肤 theme 背景 字体 导入 纯歌词'},
  {title:'音乐空间展示',category:'音乐空间',description:'选择贴纸拼贴、环绕或简约列表及卡片大小',tab:'space',target:'[data-setting="space-presentation"]',keywords:'歌曲 展示 风格 环绕 星轨 列表 卡片'},
  {title:'简约列表视觉',category:'音乐空间',description:'黑白中性底、黑银反射边框与清晰行层级',tab:'space',target:'[data-setting="simple-list"]',keywords:'列表 歌曲 行 样式 主题 银边'},
  {title:'背景与外观',category:'音乐空间',description:'选择或更换图片、视频背景',tab:'space',target:'.yz-appearance-preview',keywords:'壁纸 动态 背景 默认 空间'},
  {title:'音乐助手',category:'助手',description:'打开星音助手、皮肤、语音与远程模型设置',tab:'assistant',target:'[data-setting="assistant"]',keywords:'星音 AI 模型 桌宠 悬浮 语音 对话'},
  {title:'音乐源管理',category:'音乐源',description:'添加、配置、启用或停用音乐源',tab:'sources',target:'.zenix-source-settings',keywords:'源 网络 HTTP HTTPS 权限 顺序'},
  {title:'音源分享包',category:'音乐源',description:'打包全部音乐源，或导入朋友分享的源',tab:'sources',target:'.zenix-bundle-export',keywords:'一键 打包 分享 包 导出 导入'},
  {title:'播放音质',category:'音乐源',description:'选择自动、标准、高品质或无损',tab:'sources',target:'.zenix-source-quality',keywords:'flac 无损 高音质'},
  {title:'自动缓存与下载',category:'音乐源',description:'管理音频缓存、离线保存和容量',tab:'sources',target:'.zenix-audio-cache',keywords:'离线 本地 下载 空间 清理 缓存'},
  {title:'手机遥控电脑',category:'设备与下载',description:'在局域网中配对手机并控制电脑播放',tab:'devices',target:'[data-setting="remote"]',keywords:'遥控 手机 PC 连接 WiFi IP 配对'},
  {title:'自定义快捷键',category:'设备与下载',description:'配置应用内和全局快捷键',tab:'devices',target:'[data-setting="shortcuts"]',keywords:'键盘 热键 组合键 全局'},
  {title:'桌面音乐组件',category:'设备与下载',description:'打开桌面小窗或添加手机小组件',tab:'devices',target:'[data-setting="widget"]',keywords:'小窗 小组件 迷你播放器'},
  {title:'关闭与托盘',category:'设备与下载',description:'关闭窗口驻留托盘，从托盘菜单完全退出',tab:'devices',target:'[data-setting="tray"]',keywords:'退出 后台 关闭 最小化'},
  {title:'应用更新',category:'资料与更新',description:'检查更新、选择通道和设置自动下载',tab:'data',target:'[data-setting="updates"]',keywords:'版本 升级 下载 安装 stable preview'},
  {title:'备份与恢复',category:'资料与更新',description:'保存、恢复或迁移个人资料',tab:'data',target:'[data-setting="backup"]',keywords:'数据 资料 喜欢 收藏 歌单 备份 恢复'},
  {title:'歌单分享与迁移',category:'资料与更新',description:'平台链接导入、歌单文件及局域网迁移',tab:'data',target:'[data-setting="music-tools"]',keywords:'平台 歌单 转移 QQ 音乐 网易 酷我 分享 导入 导出 LAN IP'},
  {title:'听歌统计与回忆',category:'资料与更新',description:'查看聆听记录并生成音乐回忆卡',tab:'data',target:'[data-setting="music-tools"]',keywords:'回忆卡 统计 时长 记录'},
  {title:'歌手与专辑',category:'资料与更新',description:'浏览已收录的歌手、专辑和歌曲',tab:'data',target:'[data-setting="library"]',keywords:'艺术家 唱片 浏览 本地'},
]);

export type SearchableSetting = {
  title: string;
  category: string;
  description: string;
  keywords?: string;
};

export function SettingsSearchResults<T extends SearchableSetting>({query, items, choose}: {
  query: string;
  items: readonly T[];
  choose: (entry: T) => void;
}) {
  const normalized = query.normalize('NFKC').toLocaleLowerCase().trim();
  const terms = normalized.split(/\s+/);
  const results = items.filter(entry => terms.every(term =>
    `${entry.title} ${entry.category} ${entry.description} ${entry.keywords || ''}`.normalize('NFKC').toLocaleLowerCase().includes(term),
  )).sort((left, right) =>
    Number(right.title.normalize('NFKC').toLocaleLowerCase().includes(normalized))
    - Number(left.title.normalize('NFKC').toLocaleLowerCase().includes(normalized)),
  );
  return <section className="yz-settings-results" aria-label="设置搜索结果">
    <div className="yz-settings-intro">
      <h2>搜索设置</h2>
      <p role="status">{results.length ? `找到 ${results.length} 项相关设置` : '没有找到匹配设置，可以试试“主题”“纯歌词”或“更新”。'}</p>
    </div>
    {results.length ? <div className="yz-settings-result-list">{results.map(entry =>
      <button type="button" key={`${entry.category}:${entry.title}`} onClick={() => choose(entry)}>
        <span><small>{entry.category}</small><strong>{entry.title}</strong><p>{entry.description}</p></span>
        <ArrowUpRight size={19}/>
      </button>,
    )}</div> : <div className="yz-settings-empty"><Search size={28}/><span>换个关键词，或清空搜索后浏览分类</span></div>}
  </section>;
}

export default function SettingsSearch({query, choose}: {
  query: string;
  choose: (entry: SettingSearchEntry) => void;
}) {
  return <SettingsSearchResults query={query} items={settingEntries} choose={choose}/>;
}
