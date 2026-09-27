const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.opus', '.aac']);
const LYRIC_EXTENSIONS = ['.lrc', '.vtt', '.ttml', '.qrc', '.yrc', '.krc'];
const COVER_NAMES = ['cover.png', 'cover.jpg', 'cover.jpeg', 'folder.png', 'folder.jpg', 'folder.jpeg'];
const KRC_KEY = Buffer.from([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]);

function canonical(filePath) {
  const absolute = path.resolve(filePath);
  return process.platform === 'win32' ? absolute.toLocaleLowerCase() : absolute;
}

function trackId(filePath) {
  return crypto.createHash('sha256').update(canonical(filePath)).digest('hex');
}

function inside(folder, candidate) {
  const relative = path.relative(folder, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function fileTitle(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[_]+/g, ' ').trim();
}

function fallbackNames(filePath) {
  const name = fileTitle(filePath);
  const separator = name.indexOf(' - ');
  return separator > 0
    ? { artist: name.slice(0, separator).trim(), title: name.slice(separator + 3).trim() }
    : { artist: '未知艺术家', title: name };
}

function coverExtension(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.jpg';
}

function coverMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.gif' ? 'image/gif' : 'image/jpeg';
}

async function exists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

class LocalLibrary {
  constructor(userDataDirectory, publish) {
    this.dataFile = path.join(userDataDirectory, 'library.json');
    this.coverDirectory = path.join(userDataDirectory, 'covers');
    this.publish = publish;
    this.records = new Map();
    this.roots = [];
    this.looseFiles = [];
    this.playlists = [];
    this.loaded = false;
    this.mutation = Promise.resolve();
    this.musicMetadata = null;
  }

  async load() {
    if (this.loaded) return this.snapshot();
    await fsp.mkdir(path.dirname(this.dataFile), { recursive: true });
    try {
      const saved = JSON.parse(await fsp.readFile(this.dataFile, 'utf8'));
      if (saved.version === 1) {
        this.roots = Array.isArray(saved.roots) ? saved.roots.filter((value) => typeof value === 'string') : [];
        this.looseFiles = Array.isArray(saved.looseFiles) ? saved.looseFiles.filter((value) => typeof value === 'string') : [];
        this.playlists = Array.isArray(saved.playlists) ? saved.playlists : [];
        for (const record of Array.isArray(saved.records) ? saved.records : []) {
          if (record && typeof record.id === 'string' && typeof record.path === 'string') {
            this.records.set(record.id, record);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Cannot load music library:', error);
    }
    this.loaded = true;
    return this.snapshot();
  }

  snapshot() {
    const tracks = [...this.records.values()]
      .map(({ embeddedLyrics, coverPath, coverMtimeMs, ...track }) => track)
      .sort((a, b) => a.artist.localeCompare(b.artist, 'zh-CN') || a.album?.localeCompare(b.album || '', 'zh-CN') || a.title.localeCompare(b.title, 'zh-CN'));
    const roots = this.roots.map((root) => ({
      path: root,
      name: path.basename(root) || root,
      trackCount: tracks.filter((track) => inside(root, track.path)).length,
    }));
    return { tracks, roots, playlists: this.playlists.map((playlist) => ({ ...playlist, trackIds: [...playlist.trackIds] })), looseFiles: [...this.looseFiles] };
  }

  async save() {
    const payload = JSON.stringify({
      version: 1,
      roots: this.roots,
      looseFiles: this.looseFiles,
      playlists: this.playlists,
      records: [...this.records.values()],
    });
    const temporary = `${this.dataFile}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, payload, 'utf8');
    await fsp.rename(temporary, this.dataFile);
    const snapshot = this.snapshot();
    this.publish('library:changed', snapshot);
    return snapshot;
  }

  exclusive(operation) {
    const pending = this.mutation.then(operation);
    this.mutation = pending.catch(() => {});
    return pending;
  }

  async collect(folder) {
    const files = [];
    const unreadableDirectories = [];
    const pending = [folder];
    while (pending.length) {
      const directory = pending.pop();
      let entries;
      try {
        entries = await fsp.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (canonical(directory) === canonical(folder)) throw new Error(`无法读取音乐文件夹：${folder}（${error.message}）`);
        console.warn('Cannot read music folder:', directory, error.message);
        unreadableDirectories.push(directory);
        continue;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '.git' && entry.name !== 'node_modules') pending.push(child);
        } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          files.push(child);
        }
      }
    }
    return { files, unreadableDirectories };
  }

  async metadataModule() {
    if (!this.musicMetadata) this.musicMetadata = import('music-metadata').catch((error) => {
      console.error('Music metadata parser unavailable:', error);
      return null;
    });
    return this.musicMetadata;
  }

  async storeCover(buffer, mimeType) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const name = hash + coverExtension(mimeType);
    await fsp.mkdir(this.coverDirectory, { recursive: true });
    const target = path.join(this.coverDirectory, name);
    if (!(await exists(target))) await fsp.writeFile(target, buffer);
    return `yzqxy://cover/${name}`;
  }

  async folderCover(filePath) {
    const directory = path.dirname(filePath);
    for (const name of COVER_NAMES) {
      const candidate = path.join(directory, name);
      try {
        const stat = await fsp.stat(candidate);
        if (stat.isFile() && stat.size <= 20 * 1024 * 1024) {
          return { path: candidate, mtimeMs: stat.mtimeMs };
        }
      } catch { /* Try the next cover filename. */ }
    }
    return null;
  }

  async readTrack(filePath, stat, previous) {
    const id = trackId(filePath);
    const folderCover = await this.folderCover(filePath);
    if (previous && previous.size === stat.size && previous.modifiedAt === stat.mtimeMs
      && previous.coverPath === (folderCover?.path || null)
      && previous.coverMtimeMs === (folderCover?.mtimeMs || null)) {
      return previous;
    }

    const fallback = fallbackNames(filePath);
    let metadata = null;
    try {
      const parser = await this.metadataModule();
      if (parser) metadata = await parser.parseFile(filePath, { duration: true });
    } catch (error) {
      console.warn('Cannot parse music metadata:', filePath, error.message);
    }

    const common = metadata?.common || {};
    const duration = Number(metadata?.format?.duration);
    const lyricsValue = common.lyrics?.[0];
    const embeddedLyrics = typeof lyricsValue === 'string' ? lyricsValue
      : typeof lyricsValue?.text === 'string' ? lyricsValue.text : undefined;
    let coverUrl;
    if (folderCover) {
      try {
        coverUrl = await this.storeCover(await fsp.readFile(folderCover.path), coverMime(folderCover.path));
      } catch (error) {
        console.warn('Cannot read folder cover:', folderCover.path, error.message);
      }
    }
    if (!coverUrl && common.picture?.[0]?.data) {
      try {
        coverUrl = await this.storeCover(Buffer.from(common.picture[0].data), common.picture[0].format);
      } catch (error) {
        console.warn('Cannot store embedded cover:', filePath, error.message);
      }
    }

    return {
      id,
      path: filePath,
      title: String(common.title || fallback.title).trim(),
      artist: String(common.artist || fallback.artist).trim(),
      album: common.album ? String(common.album).trim() : undefined,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      audioUrl: `yzqxy://audio/${id}`,
      coverUrl,
      year: Number.isFinite(common.year) ? common.year : undefined,
      trackNumber: Number.isFinite(common.track?.no) ? common.track.no : undefined,
      discNumber: Number.isFinite(common.disk?.no) ? common.disk.no : undefined,
      addedAt: previous?.addedAt || Date.now(),
      modifiedAt: stat.mtimeMs,
      size: stat.size,
      source: 'local',
      embeddedLyrics,
      coverPath: folderCover?.path || null,
      coverMtimeMs: folderCover?.mtimeMs || null,
    };
  }

  async scanFiles(files, folderToReplace, unreadableDirectories = []) {
    const seen = new Set();
    let current = 0;
    const total = files.length;
    this.publish('library:progress', { phase: 'reading', current, total });
    const workers = Array.from({ length: Math.min(4, total) }, async () => {
      while (files.length) {
        const filePath = files.shift();
        if (!filePath) break;
        const id = trackId(filePath);
        try {
          const stat = await fsp.stat(filePath);
          if (!stat.isFile()) continue;
          this.records.set(id, await this.readTrack(filePath, stat, this.records.get(id)));
          seen.add(id);
        } catch (error) {
          console.warn('Cannot index music file:', filePath, error.message);
        } finally {
          current += 1;
          this.publish('library:progress', { phase: 'reading', current, total, path: filePath });
        }
      }
    });
    await Promise.all(workers);
    if (folderToReplace) {
      for (const [id, record] of this.records) {
        if (inside(folderToReplace, record.path) && !seen.has(id)
          && !unreadableDirectories.some((directory) => inside(directory, record.path))
          && !this.looseFiles.some((file) => canonical(file) === canonical(record.path))) {
          this.records.delete(id);
        }
      }
    }
    this.cleanPlaylists();
  }

  cleanPlaylists() {
    for (const playlist of this.playlists) {
      playlist.trackIds = playlist.trackIds.filter((id) => this.records.has(id));
    }
  }

  async importFolder(folder) {
    return this.exclusive(async () => {
      await this.load();
      const resolved = path.resolve(folder);
      const stat = await fsp.stat(resolved);
      if (!stat.isDirectory()) throw new Error('请选择音乐文件夹');
      this.publish('library:progress', { phase: 'scanning', current: 0, total: 0, path: resolved });
      const { files, unreadableDirectories } = await this.collect(resolved);
      if (!this.roots.some((root) => canonical(root) === canonical(resolved))) this.roots.push(resolved);
      await this.scanFiles(files, resolved, unreadableDirectories);
      return this.save();
    });
  }

  async addFiles(filePaths) {
    return this.exclusive(async () => {
      await this.load();
      const files = filePaths.map((file) => path.resolve(file)).filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()));
      for (const file of files) {
        if (!this.looseFiles.some((existing) => canonical(existing) === canonical(file))) this.looseFiles.push(file);
      }
      await this.scanFiles([...files]);
      return this.save();
    });
  }

  async rescan() {
    return this.exclusive(async () => {
      await this.load();
      for (const root of this.roots) {
        this.publish('library:progress', { phase: 'scanning', current: 0, total: 0, path: root });
        const { files, unreadableDirectories } = await this.collect(root);
        await this.scanFiles(files, root, unreadableDirectories);
      }
      await this.scanFiles([...this.looseFiles]);
      for (const file of this.looseFiles) {
        if (!(await exists(file))) this.records.delete(trackId(file));
      }
      this.looseFiles = this.looseFiles.filter((file) => this.records.has(trackId(file)));
      this.cleanPlaylists();
      return this.save();
    });
  }

  async removeRoot(root) {
    return this.exclusive(async () => {
      await this.load();
      const existing = this.roots.find((item) => canonical(item) === canonical(root));
      if (!existing) return this.snapshot();
      this.roots = this.roots.filter((item) => item !== existing);
      for (const [id, record] of this.records) {
        if (inside(existing, record.path) && !this.roots.some((other) => inside(other, record.path))
          && !this.looseFiles.some((file) => canonical(file) === canonical(record.path))) this.records.delete(id);
      }
      this.cleanPlaylists();
      return this.save();
    });
  }

  async removeFile(filePath) {
    return this.exclusive(async () => {
      await this.load();
      this.looseFiles = this.looseFiles.filter((file) => canonical(file) !== canonical(filePath));
      const id = trackId(filePath);
      if (!this.roots.some((root) => inside(root, filePath))) this.records.delete(id);
      this.cleanPlaylists();
      return this.save();
    });
  }

  getAudioPath(id) {
    return /^[a-f0-9]{64}$/.test(id) ? this.records.get(id)?.path || null : null;
  }

  getCoverPath(name) {
    return /^[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/.test(name) ? path.join(this.coverDirectory, name) : null;
  }

  async readLyrics(id) {
    await this.load();
    const record = this.records.get(id);
    if (!record) return null;
    const stem = path.join(path.dirname(record.path), path.basename(record.path, path.extname(record.path)));
    for (const extension of LYRIC_EXTENSIONS) {
      for (const candidate of [stem + extension, record.path + extension]) {
        if (!(await exists(candidate))) continue;
        try {
          const data = await fsp.readFile(candidate);
          let text;
          if (extension === '.krc' && data.subarray(0, 4).toString('ascii') === 'krc1') {
            const encoded = Buffer.from(data.subarray(4));
            for (let index = 0; index < encoded.length; index += 1) encoded[index] ^= KRC_KEY[index % KRC_KEY.length];
            text = zlib.inflateSync(encoded).toString('utf8');
          } else {
            text = data.toString('utf8');
          }
          if (text.includes('\uFFFD')) text = new TextDecoder('gb18030').decode(data);
          let translationText;
          const translationPath = stem + '.t' + extension;
          if (await exists(translationPath)) translationText = await fsp.readFile(translationPath, 'utf8');
          return { text, format: extension.slice(1), source: 'sidecar', translationText };
        } catch (error) {
          console.warn('Cannot read lyric file:', candidate, error.message);
        }
      }
    }
    return record.embeddedLyrics ? { text: record.embeddedLyrics, format: 'lrc', source: 'embedded' } : null;
  }

  async editPlaylist(operation) {
    return this.exclusive(async () => {
      await this.load();
      operation();
      return this.save();
    });
  }

  createPlaylist(name) {
    return this.editPlaylist(() => {
      const trimmed = String(name || '').trim().slice(0, 100);
      if (!trimmed) throw new Error('歌单名称不能为空');
      const now = Date.now();
      this.playlists.push({ id: crypto.randomUUID(), name: trimmed, trackIds: [], createdAt: now, updatedAt: now });
    });
  }

  renamePlaylist(id, name) {
    return this.editPlaylist(() => {
      const playlist = this.playlists.find((item) => item.id === id);
      if (!playlist) throw new Error('歌单不存在');
      const trimmed = String(name || '').trim().slice(0, 100);
      if (!trimmed) throw new Error('歌单名称不能为空');
      playlist.name = trimmed;
      playlist.updatedAt = Date.now();
    });
  }

  deletePlaylist(id) {
    return this.editPlaylist(() => {
      this.playlists = this.playlists.filter((item) => item.id !== id);
    });
  }

  setPlaylistTracks(id, trackIds) {
    return this.editPlaylist(() => {
      const playlist = this.playlists.find((item) => item.id === id);
      if (!playlist) throw new Error('歌单不存在');
      playlist.trackIds = [...new Set(trackIds.filter((trackId) => this.records.has(trackId)))];
      playlist.updatedAt = Date.now();
    });
  }

  async importPlaylist(filePath) {
    return this.exclusive(async () => {
      await this.load();
      const content = await fsp.readFile(filePath, 'utf8');
      const byPath = new Map([...this.records.values()].map((record) => [canonical(record.path), record.id]));
      const trackIds = [];
      for (const row of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const value = row.trim();
        if (!value || value.startsWith('#') || /^https?:\/\//i.test(value)) continue;
        let candidate = value;
        if (/^file:\/\//i.test(candidate)) {
          try { candidate = require('node:url').fileURLToPath(candidate); } catch { continue; }
        } else if (!path.isAbsolute(candidate)) {
          candidate = path.resolve(path.dirname(filePath), candidate.replace(/\\/g, path.sep));
        }
        const id = byPath.get(canonical(candidate));
        if (id) trackIds.push(id);
      }
      const now = Date.now();
      this.playlists.push({ id: crypto.randomUUID(), name: fileTitle(filePath), trackIds, createdAt: now, updatedAt: now });
      return this.save();
    });
  }

  async exportPlaylist(id, filePath) {
    await this.load();
    const playlist = this.playlists.find((item) => item.id === id);
    if (!playlist) throw new Error('歌单不存在');
    const lines = ['#EXTM3U'];
    for (const trackId of playlist.trackIds) {
      const record = this.records.get(trackId);
      if (!record) continue;
      lines.push(`#EXTINF:${Math.round(record.duration || -1)},${record.artist} - ${record.title}`);
      lines.push(path.relative(path.dirname(filePath), record.path));
    }
    await fsp.writeFile(filePath, '\uFEFF' + lines.join('\n') + '\n', 'utf8');
  }
}

module.exports = { LocalLibrary, AUDIO_EXTENSIONS };
