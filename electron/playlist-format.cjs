// Portable metadata only. Audio, signed URLs, local paths and source secrets
// never belong in a playlist exchange file.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TRACKS = 5000;
function text(value, limit) { return typeof value === 'string' ? value.slice(0, limit).trim() : ''; }
function portableTrack(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('歌曲信息无效');
  const title = text(value.title, 300);
  if (!title) throw Error('歌曲名称不能为空');
  const source = value.source === 'custom' ? 'custom' : 'local';
  const track = { title, artist: text(value.artist, 300), album: text(value.album, 300), duration: Number.isFinite(value.duration) && value.duration >= 0 ? Math.min(value.duration, 86400) : 0, source };
  if (source === 'custom') {
    track.id = text(value.id, 32768);
    track.providerId = text(value.providerId, 240);
    track.remoteId = text(value.remoteId, 32768);
    if (!track.id || !track.remoteId) throw Error('在线歌曲缺少音源标识');
  }
  return track;
}
function validateBundle(value) {
  if (!value || value.format !== 'zenix-playlist' || value.schemaVersion !== 1 || !Array.isArray(value.playlists) || !value.playlists.length || value.playlists.length > 100) throw Error('请选择有效的 .zenixlist 歌单文件（格式版本 1）');
  let total = 0;
  const playlists = value.playlists.map(list => {
    if (!list || !Array.isArray(list.tracks) || typeof list.name !== 'string' || !list.name.trim() || list.name.length > 100) throw Error('歌单名称或歌曲列表无效');
    total += list.tracks.length;
    if (total > MAX_TRACKS) throw Error('一次最多分享 5000 首歌曲');
    return { name: list.name.trim(), tracks: list.tracks.map(portableTrack) };
  });
  const bundle = { format: 'zenix-playlist', schemaVersion: 1, playlists };
  if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > MAX_BYTES) throw Error('歌单文件不能超过 2 MiB');
  return bundle;
}
function decodeBundle(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_BYTES) throw Error('歌单文件不能超过 2 MiB');
  let value; try { value = JSON.parse(input.replace(/^\uFEFF/, '')); } catch { throw Error('歌单文件不是有效的 Zenix 格式'); }
  return validateBundle(value);
}
function createBundle(lists) { return validateBundle({ format: 'zenix-playlist', schemaVersion: 1, playlists: lists }); }
function restoreTracks(bundle, localTracks) {
  const crypto = require('node:crypto');
  const key = track => `${track.title}\u0000${track.artist}\u0000${track.album || ''}`.normalize('NFKC').toLocaleLowerCase();
  const locals = new Map(localTracks.map(track => [key(track), track]));
  return bundle.playlists.map(list => ({ name: list.name, tracks: list.tracks.map(track => {
    if (track.source === 'custom') return { ...track, path: '', audioUrl: '' };
    const local = locals.get(key(track));
    if (local && (!track.duration || !local.duration || Math.abs(track.duration - local.duration) <= 3)) return { ...local };
    return { ...track, id: `shared-local:${crypto.createHash('sha256').update(key(track)).digest('hex').slice(0, 24)}`, path: '', audioUrl: '', availability: 'unavailable' };
  }) }));
}
module.exports = { MAX_BYTES, MAX_TRACKS, portableTrack, validateBundle, decodeBundle, createBundle, restoreTracks };
