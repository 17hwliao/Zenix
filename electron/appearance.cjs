const { dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.ogv']);
const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

function mediaKind(extension) {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

class AppearanceStore {
  constructor(userDataPath) {
    this.folder = path.join(userDataPath, 'appearance');
    this.settingsPath = path.join(this.folder, 'settings.json');
    this.settings = { completed: false, background: null };
  }

  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      this.settings = {
        completed: Boolean(saved.completed),
        background: saved.background?.fileName && mediaKind(path.extname(saved.background.fileName).toLowerCase())
          ? { fileName: path.basename(saved.background.fileName), name: String(saved.background.name || '自定义背景').slice(0, 120) }
          : null,
      };
    } catch { /* A missing or damaged settings file starts the optional introduction again. */ }
    return this.snapshot();
  }

  async snapshot() {
    const { completed, background } = this.settings;
    if (!background) return { completed, background: null };
    try {
      const file = path.join(this.folder, background.fileName);
      const stats = await fs.stat(file);
      if (!stats.isFile()) return { completed, background: null };
      return {
        completed,
        background: {
          kind: mediaKind(path.extname(file).toLowerCase()),
          name: background.name,
          url: `yzqxy://background/${encodeURIComponent(background.fileName)}?v=${Math.round(stats.mtimeMs)}`,
        },
      };
    } catch { return { completed, background: null }; }
  }

  backgroundPath(requestedName) {
    const name = this.settings.background?.fileName;
    return name && requestedName === name ? path.join(this.folder, name) : null;
  }

  async save(next) {
    await fs.mkdir(this.folder, { recursive: true });
    const temporary = path.join(this.folder, `settings-${randomUUID()}.tmp`);
    await fs.writeFile(temporary, JSON.stringify(next), 'utf8');
    await fs.rename(temporary, this.settingsPath);
    this.settings = next;
    return this.snapshot();
  }

  async choose(window) {
    const result = await dialog.showOpenDialog(window, {
      title: '选择 Zenix 背景图片或视频',
      properties: ['openFile'],
      filters: [
        { name: '图片和视频', extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].map(value => value.slice(1)) },
        { name: '图片', extensions: [...IMAGE_EXTENSIONS].map(value => value.slice(1)) },
        { name: '视频', extensions: [...VIDEO_EXTENSIONS].map(value => value.slice(1)) },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const extension = path.extname(source).toLowerCase();
    if (!mediaKind(extension)) throw new Error('请选择 JPG、PNG、WebP、GIF、MP4、M4V、WebM 或 OGV 文件');
    const stats = await fs.stat(source);
    if (!stats.isFile() || stats.size <= 0) throw new Error('所选文件无法读取');
    if (stats.size > MAX_MEDIA_BYTES) throw new Error('背景文件不能超过 500 MB');
    await fs.mkdir(this.folder, { recursive: true });
    const fileName = `background-${randomUUID()}${extension}`;
    await fs.copyFile(source, path.join(this.folder, fileName));
    const previous = this.settings.background?.fileName;
    const state = await this.save({ completed: true, background: { fileName, name: path.basename(source) } });
    if (previous && previous !== fileName) void fs.unlink(path.join(this.folder, previous)).catch(() => {});
    return state;
  }

  async complete() {
    return this.save({ ...this.settings, completed: true });
  }

  async clear() {
    const previous = this.settings.background?.fileName;
    const state = await this.save({ completed: true, background: null });
    if (previous) void fs.unlink(path.join(this.folder, previous)).catch(() => {});
    return state;
  }
}

module.exports = { AppearanceStore };
