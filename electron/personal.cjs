const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function cleanTrack(value) {
  if (!value || typeof value.id !== 'string' || typeof value.title !== 'string') return null;
  return {
    id: value.id,
    path: String(value.path || ''),
    title: value.title,
    artist: String(value.artist || ''),
    album: String(value.album || ''),
    duration: Number(value.duration) || 0,
    audioUrl: value.source === 'online' || value.source === 'custom' ? '' : String(value.audioUrl || ''),
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : undefined,
    source: value.source === 'online' || value.source === 'custom' ? value.source : 'local',
    providerId: typeof value.providerId === 'string' ? value.providerId : undefined,
    remoteId: typeof value.remoteId === 'string' ? value.remoteId : undefined,
    availability: value.availability === 'unavailable' ? 'unavailable' : undefined,
  };
}

function historyKey(track) {
  if (track.source === 'custom' && track.providerId && track.remoteId) return `custom:${track.providerId}:${track.remoteId}`;
  if (track.source === 'online' && track.remoteId) {
    const provider = track.providerId || (track.id.includes(':') ? track.id.split(':')[0] : 'legacy');
    return `online:${provider}:${track.remoteId}`;
  }
  if (track.source !== 'online' && track.path) return `local:${path.normalize(track.path).toLocaleLowerCase()}`;
  return `${track.source || 'local'}:${track.id}`;
}

function uniqueHistory(entries) {
  const seen = new Set();
  return [...entries].sort((a, b) => b.playedAt - a.playedAt).filter(entry => {
    const key = historyKey(entry.track);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

class PersonalStore {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, 'personal-library.json');
    this.data = { liked: [], favorites: [], history: [], playlists: [] };
    this.pendingSave = Promise.resolve();
    this.loadError = '';
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('资料结构无效');
      for (const kind of ['liked', 'favorites', 'history', 'playlists']) if (raw[kind] !== undefined && !Array.isArray(raw[kind])) throw new Error('资料结构无效');
      if (['liked', 'favorites'].some(kind => (raw[kind] || []).some(track => !cleanTrack(track)))
        || (raw.history || []).some(entry => !cleanTrack(entry?.track))
        || (raw.playlists || []).some(entry => !entry || typeof entry !== 'object' || !Array.isArray(entry.tracks) || entry.tracks.some(track => !cleanTrack(track)))) throw new Error('资料条目无效');
      this.loadError = '';
      const loadedHistory = (Array.isArray(raw.history) ? raw.history : []).map(entry => {
        const track = cleanTrack(entry?.track);
        return track ? { id: String(entry.id || randomUUID()), track, playedAt: Number(entry.playedAt) || Date.now() } : null;
      }).filter(Boolean);
      this.data = {
        liked: (Array.isArray(raw.liked) ? raw.liked : []).map(cleanTrack).filter(Boolean),
        favorites: (Array.isArray(raw.favorites) ? raw.favorites : []).map(cleanTrack).filter(Boolean),
        history: uniqueHistory(loadedHistory),
        playlists: (Array.isArray(raw.playlists) ? raw.playlists : []).map(entry => ({
          id: String(entry.id || randomUUID()), name: String(entry.name || '未命名歌单').slice(0, 100),
          tracks: (Array.isArray(entry.tracks) ? entry.tracks : []).map(cleanTrack).filter(Boolean),
        })),
      };
      if (this.data.history.length !== loadedHistory.length) await this.save();
    } catch (error) {
      if (error.code !== 'ENOENT') { this.loadError = '个人曲库无法读取，已保留原文件并停止写入'; throw new Error(this.loadError); }
      this.loadError = '';
    }
    return this.snapshot();
  }

  assertWritable() { if (this.loadError) throw new Error(this.loadError); }
  snapshot() { this.assertWritable(); return structuredClone(this.data); }
  lyricsSaved(trackId) {
    return { liked: this.data.liked.some(track => track.id === trackId), favorite: this.data.favorites.some(track => track.id === trackId), playlists: this.data.playlists.map(list => ({ id: list.id, name: list.name, count: list.tracks.length })) };
  }

  async save() {
    this.assertWritable();
    this.pendingSave = this.pendingSave.catch(() => {}).then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, JSON.stringify(this.data), 'utf8'); await fs.rename(temporary, this.file); }
      finally { await fs.unlink(temporary).catch(() => {}); }
    });
    await this.pendingSave;
    return this.snapshot();
  }

  async toggle(kind, value) {
    if (kind !== 'liked' && kind !== 'favorites') throw new Error('不支持的收藏分类');
    const track = cleanTrack(value);
    if (!track) throw new Error('歌曲信息无效');
    const found = this.data[kind].some(item => item.id === track.id);
    this.data[kind] = found ? this.data[kind].filter(item => item.id !== track.id) : [track, ...this.data[kind]];
    return this.save();
  }

  async record(value) {
    const track = cleanTrack(value);
    if (!track) return this.snapshot();
    const key = historyKey(track);
    const existing = this.data.history.find(entry => historyKey(entry.track) === key);
    this.data.history = [{ id: existing?.id || randomUUID(), track, playedAt: Date.now() }, ...this.data.history.filter(entry => historyKey(entry.track) !== key)];
    return this.save();
  }

  async createPlaylist(name, firstTrack) {
    const trimmed = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!trimmed) throw new Error('请输入歌单名称');
    if (this.data.playlists.some(item => item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error('已有同名歌单');
    const track = firstTrack == null ? null : cleanTrack(firstTrack);
    if (firstTrack != null && !track) throw new Error('歌曲信息无效');
    this.data.playlists.push({ id: randomUUID(), name: trimmed, tracks: track ? [track] : [] });
    return this.save();
  }

  async renamePlaylist(id, name) {
    const playlist = this.data.playlists.find(item => item.id === id);
    if (!playlist) throw new Error('歌单不存在');
    const trimmed = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!trimmed) throw new Error('请输入歌单名称');
    if (this.data.playlists.some(item => item.id !== id && item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error('已有同名歌单');
    playlist.name = trimmed;
    return this.save();
  }

  async deletePlaylist(id) {
    this.data.playlists = this.data.playlists.filter(item => item.id !== id);
    return this.save();
  }

  async addToPlaylist(id, value) {
    const playlist = this.data.playlists.find(item => item.id === id);
    if (!playlist) throw new Error('歌单不存在');
    const track = cleanTrack(value);
    if (!track) throw new Error('歌曲信息无效');
    if (!playlist.tracks.some(item => item.id === track.id)) playlist.tracks.push(track);
    return this.save();
  }

  async removeFromPlaylist(id, trackId) {
    const playlist = this.data.playlists.find(item => item.id === id);
    if (!playlist) throw new Error('歌单不存在');
    playlist.tracks = playlist.tracks.filter(item => item.id !== trackId);
    return this.save();
  }

  async importPlaylists(lists) {
    const imported = [];
    for (const list of lists) {
      const base = list.name; let name = base, index = 1;
      while ([...this.data.playlists, ...imported].some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${base.slice(0, 85)}（导入 ${index++}）`;
      const seen = new Set();
      imported.push({ id: randomUUID(), name, tracks: list.tracks.map(cleanTrack).filter(track => track && !seen.has(track.id) && seen.add(track.id)) });
    }
    this.data.playlists.push(...imported);
    try { return await this.save(); } catch(error) { const ids=new Set(imported.map(list=>list.id));this.data.playlists=this.data.playlists.filter(list=>!ids.has(list.id));throw error; }
  }

  async removeSaved(kind, id) {
    if (kind === 'history') this.data.history = this.data.history.filter(entry => entry.id !== id);
    else if (kind === 'liked' || kind === 'favorites') this.data[kind] = this.data[kind].filter(item => item.id !== id);
    else throw new Error('不支持的分类');
    return this.save();
  }
}

module.exports = { PersonalStore };
