const MAX_BYTES = 48 * 1024 * 1024;
const SECTIONS = ['liked', 'favorites', 'playlists', 'history', 'profile', 'appearance', 'stats'];
const PROFILE_FIELDS = ['name', 'bio', 'tagline', 'about', 'contact', 'tags', 'cardNumber', 'cardLine', 'lyricColor', 'lyricSize', 'email', 'subject', 'background', 'orbitCovers'];
function fail(message) { throw Error(message || '备份文件结构无效'); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function text(value, max = 300) { if (typeof value !== 'string' || value.length > max) fail(); return value; }
function image(value) { if (value === '') return ''; if (typeof value !== 'string' || value.length > 2 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('个人资料图片无效或超过 2 MiB'); return value; }
function cleanProfile(value = {}) { const result = {}; for (const key of PROFILE_FIELDS) if (value[key] !== undefined) { if (key === 'subject' || key === 'background') result[key] = image(value[key]); else if (key === 'orbitCovers') { if (!object(value[key])) fail(); result[key] = {}; for (const kind of ['liked','favorites','history','playlists','library']) if(value[key][kind] !== undefined) result[key][kind] = image(value[key][kind]); } else if (key === 'lyricSize') { if (!Number.isFinite(value[key]) || value[key] < 14 || value[key] > 48) fail(); result[key] = value[key]; } else result[key] = text(value[key], key === 'about' ? 2000 : 300); } return result; }
function localKey(track) { return [track.title, track.artist, track.album || '', Math.round(track.duration || 0)].map(v => String(v).normalize('NFKC').toLowerCase()).join('\0'); }
function cleanTrack(track) {
  if (!object(track)) fail();
  const source = ['custom', 'online'].includes(track.source) ? track.source : 'local';
  const result = { id: text(track.id, 24000), title: text(track.title), artist: text(track.artist || ''), album: text(track.album || ''), duration: Number(track.duration) || 0, source, path: '', audioUrl: '' };
  if (result.duration < 0 || result.duration > 86400) fail();
  if (source === 'local') result.id = `backup-local:${encodeURIComponent(localKey(result))}`;
  else { if (track.providerId) result.providerId = text(track.providerId, 120); if (track.remoteId) result.remoteId = text(track.remoteId, 20000); }
  return result;
}
function cleanTracks(values) { if (!Array.isArray(values) || values.length > 10000) fail(); return values.map(cleanTrack); }
function cleanStats(value) {
  if (!object(value) || !object(value.days) || !object(value.tracks) || Object.keys(value.days).length > 366 || Object.keys(value.tracks).length > 5000 || !Number.isFinite(value.startedAt)) fail('听歌统计格式无效');
  const tracks = {}, days = {}; let count = 0;
  for (const [id, row] of Object.entries(value.tracks)) { if (!/^[a-f0-9]{24}$/.test(id) || !object(row)) fail(); tracks[id] = { title: text(row.title), artist: text(row.artist) }; }
  for (const [date, row] of Object.entries(value.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !object(row) || !object(row.tracks)) fail(); const items = {}; let seconds = 0, plays = 0;
    for (const [id, item] of Object.entries(row.tracks)) { if (++count > 100000 || !tracks[id] || !object(item) || !Number.isFinite(item.seconds) || item.seconds < 0 || item.seconds > 86400 || !Number.isSafeInteger(item.plays) || item.plays < 0 || item.plays > 10000) fail(); items[id] = { seconds: item.seconds, plays: item.plays }; seconds += item.seconds; plays += item.plays; }
    days[date] = { date, tracks: items, seconds, plays };
  }
  return { startedAt: value.startedAt, tracks, days };
}
function cleanPayload(raw) {
  if (!object(raw) || !object(raw.personal)) fail(); const personal = {}, result = { personal };
  for (const kind of ['liked', 'favorites']) if (raw.personal[kind] !== undefined) personal[kind] = cleanTracks(raw.personal[kind]);
  if (raw.personal.history !== undefined) { if (!Array.isArray(raw.personal.history) || raw.personal.history.length > 10000) fail(); personal.history = raw.personal.history.map(row => { if (!object(row) || !Number.isFinite(row.playedAt) || row.playedAt < 0) fail(); const track = cleanTrack(row.track); return { id: track.id, track, playedAt: row.playedAt }; }); }
  if (raw.personal.playlists !== undefined) { if (!Array.isArray(raw.personal.playlists) || raw.personal.playlists.length > 1000) fail(); personal.playlists = raw.personal.playlists.map(row => ({ name: text(row.name, 100), tracks: cleanTracks(row.tracks) })); }
  if (raw.profile !== undefined) result.profile = cleanProfile(raw.profile);
  if (raw.appearance !== undefined) { if (!object(raw.appearance)) fail(); const appearance = { transparency: Math.max(0, Math.min(90, Number(raw.appearance.transparency) || 0)) }; if (raw.appearance.media) { const media = raw.appearance.media; if (!object(media) || !['image', 'video'].includes(media.kind) || typeof media.base64 !== 'string' || media.base64.length > (media.kind === 'video' ? 44 : 17) * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(media.base64)) fail('背景文件无效或过大'); appearance.media = { name: text(media.name, 120), kind: media.kind, base64: media.base64 }; } result.appearance = appearance; }
  if (raw.stats !== undefined) result.stats = cleanStats(raw.stats);
  return result;
}
function restoreTrack(track, localTracks) {
  if (track.source !== 'local') return { ...track };
  const matches = localTracks.filter(candidate => candidate.title.normalize('NFKC').toLowerCase() === track.title.normalize('NFKC').toLowerCase() && candidate.artist.normalize('NFKC').toLowerCase() === track.artist.normalize('NFKC').toLowerCase() && (candidate.album || '').normalize('NFKC').toLowerCase() === (track.album || '').normalize('NFKC').toLowerCase() && candidate.duration > 0 && track.duration > 0 && Math.abs(candidate.duration - track.duration) <= 3);
  return matches.length === 1 ? { ...matches[0], source: 'local', availability: 'playable' } : { ...track, availability: 'unavailable' };
}
function identity(track) { return track.source === 'local' ? `local:${localKey(track)}` : `${track.source}:${track.providerId || ''}:${track.remoteId || track.id}`; }
function mergePersonal(current, incoming, selected, localTracks, uuid) {
  const next = JSON.parse(JSON.stringify(current)); const result = { added: 0, skipped: 0, unavailable: 0 }; const converted = new Map();
  const restore = track => { const key = identity(track); if (!converted.has(key)) { const value = restoreTrack(track, localTracks); converted.set(key, value); if (value.availability === 'unavailable') result.unavailable++; } return converted.get(key); };
  const add = (existing, values) => { existing = existing.map(track => track.source === 'local' && track.availability === 'unavailable' ? restoreTrack(track, localTracks) : track); const seen = new Set(existing.map(identity)); return [...existing, ...values.map(restore).filter(track => { const key = identity(track); if (seen.has(key)) { result.skipped++; return false; } seen.add(key); result.added++; return true; })]; };
  for (const kind of ['liked', 'favorites']) if (selected.includes(kind) && incoming[kind]) next[kind] = add(next[kind], incoming[kind]);
  if (selected.includes('history') && incoming.history) { const seen = new Map(next.history.map(row => [identity(row.track), row])); for (const row of incoming.history) { const track = restore(row.track), key = identity(track), old = seen.get(key); if (!old) result.added++; else if (row.playedAt <= old.playedAt) result.skipped++; if (!old || row.playedAt > old.playedAt) seen.set(key, { ...row, id: old?.id || track.id, track }); } next.history = [...seen.values()].sort((a, b) => b.playedAt - a.playedAt).slice(0, 300); }
  if (selected.includes('playlists') && incoming.playlists) { next.playlists = next.playlists.map(list => ({...list,tracks:list.tracks.map(track => track.source === 'local' && track.availability === 'unavailable' ? restoreTrack(track,localTracks) : track)})); }
  if (selected.includes('playlists') && incoming.playlists) for (const row of incoming.playlists) {
    const addedBefore = result.added; const tracks = add([], row.tracks), signature = tracks.map(identity).join('\n'); const baseName = row.name.replace(/（导入(?: \d+)?）$/, '');
    if (next.playlists.some(list => list.name.replace(/（导入(?: \d+)?）$/, '') === baseName && list.tracks.map(identity).join('\n') === signature)) { result.added = addedBefore; result.skipped++; continue; }
    let name = row.name, suffix = 1; while (next.playlists.some(list => list.name === name)) name = `${row.name.slice(0, 85)}（导入 ${suffix++}）`;
    next.playlists.push({ id: `list-${uuid()}`, name, tracks });
  }
  return { personal: next, result };
}
function mergeStats(current, incoming) { const result = JSON.parse(JSON.stringify(current)); result.startedAt = Math.min(result.startedAt, incoming.startedAt); result.tracks = { ...result.tracks, ...incoming.tracks }; for (const [date, day] of Object.entries(incoming.days)) { const existing = result.days[date] ||= { date, seconds: 0, plays: 0, tracks: {} }; for (const [id, row] of Object.entries(day.tracks)) { const old = existing.tracks[id] || { seconds: 0, plays: 0 }; existing.tracks[id] = { seconds: Math.max(old.seconds, row.seconds), plays: Math.max(old.plays, row.plays) }; } existing.seconds = Object.values(existing.tracks).reduce((n, row) => n + row.seconds, 0); existing.plays = Object.values(existing.tracks).reduce((n, row) => n + row.plays, 0); } return cleanStats(result); }
function preview(payload) { const counts = {}; for (const kind of ['liked', 'favorites', 'playlists', 'history']) if (payload.personal[kind]) counts[kind] = payload.personal[kind].length; for (const kind of ['profile', 'appearance', 'stats']) if (payload[kind]) counts[kind] = kind === 'stats' ? Object.keys(payload.stats.days).length : 1; const tracks = [...(payload.personal.liked || []), ...(payload.personal.favorites || []), ...(payload.personal.playlists || []).flatMap(list => list.tracks), ...(payload.personal.history || []).map(row => row.track)]; return { counts, localCount: new Set(tracks.filter(track => track.source === 'local').map(identity)).size, playlists: (payload.personal.playlists || []).map(list => ({ name: list.name, count: list.tracks.length })) }; }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(item => canonical(item) ?? 'null').join(',')}]`; if (object(value)) return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',')}}`; return JSON.stringify(value); }
const api = { canonical, MAX_BYTES, SECTIONS, PROFILE_FIELDS, cleanPayload, cleanProfile, cleanStats, cleanTrack, localKey, identity, restoreTrack, mergePersonal, mergeStats, preview };

if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.zenixBackupFormat = api;
