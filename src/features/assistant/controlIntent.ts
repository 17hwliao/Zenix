import type {Intent} from './intent';
export const controlActions=new Set(['repeat-one','volume-down','pure-lyrics','lyrics-earlier','overlay-off','cache-playlist','cache-only','network-tasks','space-open','space-zone','space-save','roam-reduce','roam-light','roam-return','week-stats','sleep','handoff-pc','submit-pc','backup-playlists','update-check']);
/** Exact single-operation phrases; no planner and no executable model output. */
export function controlIntent(text:string,confidence:number):Intent|null{
 const definitions:[RegExp,string,string,Record<string,unknown>?][]=[
  [/^单曲循环$/,'repeat-one','设置单曲循环'],[/^音量(?:调)?低一点$/,'volume-down','降低音量'],
  [/^打开(?:歌词纯净模式|纯净歌词)$/,'pure-lyrics','打开歌词纯净模式'],[/^歌词提前半秒$/,'lyrics-earlier','将当前歌曲歌词提前半秒'],[/^关闭(?:悬浮|桌面)歌词$/,'overlay-off','关闭悬浮歌词'],
  [/^缓存(?:这张|当前)歌单$/,'cache-playlist','缓存当前歌单'],[/^只用缓存播放$/,'cache-only','仅使用缓存播放'],[/^(?:看看|查看)(?:现在)?有什么网络任务$/,'network-tasks','查看网络任务'],
  [/^(?:返回|回到|打开)(?:我的)?(?:音乐)?空间$/,'space-open','打开音乐空间'],[/^保存当前空间位置$/,'space-save','保存当前空间位置'],
  [/^少听这种$/,'roam-reduce','减少当前歌曲在漫游中出现'],[/^暂时听一些轻音乐$/,'roam-light','临时探索三首轻音乐'],[/^回到刚才的漫游$/,'roam-return','返回原漫游路线'],
  [/^(?:看看|查看)这周听歌情况$/,'week-stats','查看本周听歌情况'],[/^半小时后停止播放$/,'sleep','设置半小时睡眠定时',{minutes:30}],
  [/^把音乐接到电脑上$/,'handoff-pc','将播放接力到已配对电脑'],[/^把这首排到电脑下一首$/,'submit-pc','向已配对电脑提交下一首'],
  [/^备份歌单$/,'backup-playlists','导出歌单备份'],[/^检查更新$/,'update-check','检查软件更新'],
 ];
 for(const [pattern,action,reply,args] of definitions)if(pattern.test(text))return {kind:confidence>=.62?'action':'confirm',action,reply,args:args||{}};
 const zone=text.match(/^打开(.+?)分区$/);if(zone)return {kind:confidence>=.62?'action':'confirm',action:'space-zone',reply:`打开${zone[1]}分区`,args:{name:zone[1]}};
 return null;
}
