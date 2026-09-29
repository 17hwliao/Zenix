export type LxPreset = {
  key: string;
  name: string;
  description: string;
  url?: string;
};

// Keep canonical upstream URLs here. The installer retries the proxy documented
// by pdone when a direct download is unavailable on the user's network.
export const LX_PRESETS: LxPreset[] = [
  { key: 'xinghai', name: '星海聚合', description: '原 source.js 已失效；已改用仓库脚本，当前环境验证可播放。', url: 'https://raw.githubusercontent.com/cdyUuu/lx-music-xinghai-source/main/xinghai-music-source.js' },
  { key: 'changqing', name: '长青', description: '当前环境已验证可播放，可先用它开始。', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/changqing/latest.js' },
  { key: 'sixyin', name: '六音', description: '多平台与多音质；能否播放取决于源服务。', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/latest.js' },
  { key: 'huibq', name: 'Huibq', description: '独立的 LX 解析服务，可作为备用。', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js' },
  { key: 'flower', name: '野花', description: '可作补充来源；播放能力取决于源服务状态。', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/flower/latest.js' },
  { key: 'lx', name: 'LX 测试源', description: '备用脚本，播放服务可能超时。', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/lx/latest.js' },
  { key: 'ikun', name: 'IKUN', description: '多平台脚本，服务可能要求授权。', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/ikun/latest.js' },
  { key: 'grass', name: '野草', description: '可作补充来源；播放能力取决于源服务状态。', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/grass/latest.js' },
];
