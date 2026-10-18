function batchPlaylists(personal, args) {
  const next = structuredClone(personal), source = next.playlists.find(list => list.id === args.id);
  if (!source) throw Error('歌单不存在');
  if (JSON.stringify(source.tracks.map(song => song.id)) !== JSON.stringify(args.expected)) throw Error('歌单已变化，请重新选择');
  if(args.edit==='replacementPolicy'){source.autoReplacement=args.enabled===true;return next;}
  if(args.edit==='replacementClear'){for(const song of source.tracks)delete song.replacement;return next;}
  if(args.edit==='replacement'){
    const song=source.tracks.find(song=>song.id===args.trackId);if(!song)throw Error('歌曲已移出歌单');
    if(JSON.stringify(song.replacement||null)!==args.expectedReplacement)throw Error('平替状态已变化，请刷新后重试');
    if(args.state)song.replacement=require('../../src/core/platformReplacement.cjs').cleanRecord(args.state);else delete song.replacement;
    return next;
  }
  if (!Array.isArray(args.ids) || args.ids.length > 5000) throw Error('选中歌曲无效');
  const ids = new Set(args.ids), picked = source.tracks.filter(song => ids.has(song.id));
  if (picked.length !== ids.size) throw Error('选中歌曲已变化');
  if (args.edit === 'sort') {
    if (!['title', 'artist'].includes(args.field)) throw Error('排序方式无效');
    source.tracks.sort((a,b) => String(a[args.field] || '').localeCompare(String(b[args.field] || ''), 'zh-CN'));
  } else if (args.edit === 'remove') source.tracks = source.tracks.filter(song => !ids.has(song.id));
  else if (args.edit === 'copy' || args.edit === 'move') {
    const target = next.playlists.find(list => list.id === args.target);
    if (!target || target === source) throw Error('请选择其他目标歌单');
    const existing = new Set(target.tracks.map(song => song.id));
    target.tracks.push(...picked.filter(song => !existing.has(song.id)));
    if (target.tracks.length > 5000) throw Error('目标歌单最多 5000 首');
    if (args.edit === 'move') source.tracks = source.tracks.filter(song => !ids.has(song.id));
  } else throw Error('未知歌单操作');
  return next;
}
module.exports = {batchPlaylists};
