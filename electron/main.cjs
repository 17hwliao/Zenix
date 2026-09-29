const { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { LocalLibrary, AUDIO_EXTENSIONS } = require('./library.cjs');
const { AppearanceStore } = require('./appearance.cjs');
const { PersonalStore } = require('./personal.cjs');
const { SourceManager } = require('./sources.cjs');
const { DownloadManager } = require('./downloads.cjs');

protocol.registerSchemesAsPrivileged([{
  scheme: 'yzqxy',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

let mainWindow = null;
let lyricsWindow = null;
let lyricsPayload = { previous: '', line: '', next: '', title: '', trackId: '', playing: false, position: 0, duration: 0, lines: [] };
let lyricsTrack = null;
let lyricsBounds = null;
let lyricsOrientation = 'horizontal';
const lyricsLayouts = { horizontal: null, vertical: null };
let lyricsReady = null;
let lyricsSaveTimer = null;
let lyricsLayoutSave = Promise.resolve();
let lyricsLocked = false;
let lyricsLockWindow = null;
let lyricsLockTimer = null;
let library = null;
let appearance = null;
let personal = null;
let sourceManager = null;
let downloadManager = null;

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function lyricsData() {
  const state = personal?.snapshot();
  return { ...lyricsPayload, saved: {
    liked: Boolean(state?.liked.some(track => track.id === lyricsPayload.trackId)),
    favorite: Boolean(state?.favorites.some(track => track.id === lyricsPayload.trackId)),
    playlists: (state?.playlists || []).map(list => ({ id: list.id, name: list.name, count: list.tracks.length })),
  } };
}

function publishLyrics() {
  if (lyricsWindow && !lyricsWindow.isDestroyed() && !lyricsWindow.webContents.isLoading()) lyricsWindow.webContents.send('lyrics:data', lyricsData());
}

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.aac': 'audio/aac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
  }[extension] || 'application/octet-stream';
}

async function serveFile(filePath, request) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': mimeType(filePath),
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
      ? 'no-store'
      : 'private, max-age=31536000, immutable',
  });
  if (stat.size === 0) {
    headers.set('Content-Length', '0');
    return request.headers.has('range')
      ? new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */0' } })
      : new Response(null, { status: 200, headers });
  }
  const range = request.headers.get('range');
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    if (match[1] === '' && match[2] !== '') {
      start = Math.max(0, stat.size - Number(match[2]));
    } else {
      start = Number(match[1] || 0);
      end = match[2] ? Math.min(end, Number(match[2])) : end;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  }
  headers.set('Content-Length', String(Math.max(0, end - start + 1)));
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream), { status, headers });
}

function registerMediaProtocol() {
  protocol.handle('yzqxy', async (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'stream') return sourceManager.stream(request, url.pathname.slice(1));
    if (url.hostname === 'offline') {
      const filePath = await downloadManager.offlinePath(decodeURIComponent(url.pathname.slice(1)));
      return filePath ? serveFile(filePath, request) : new Response('Not found', { status: 404 });
    }
    if (url.hostname === 'source-cover') {
      const parts = url.pathname.split('/').slice(1);
      if (parts.length !== 2) return new Response('Not found', { status: 404 });
      return sourceManager.cover(request, decodeURIComponent(parts[0]), decodeURIComponent(parts[1]));
    }
    let filePath = null;
    if (url.hostname === 'audio') filePath = library.getAudioPath(url.pathname.slice(1));
    else if (url.hostname === 'cover') filePath = library.getCoverPath(url.pathname.slice(1));
    else if (url.hostname === 'background') filePath = appearance.backgroundPath(decodeURIComponent(url.pathname.slice(1)));
    if (!filePath) return new Response('Not found', { status: 404 });
    return serveFile(filePath, request);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    show: false,
    frame: false,
    transparent: false,
    hasShadow: true,
    thickFrame: true,
    backgroundColor: '#09090b',
    title: 'Zenix',
    icon: path.join(__dirname, '..', 'assets', 'zenix-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('maximize', () => broadcast('window:maximized-changed', true));
  mainWindow.on('unmaximize', () => broadcast('window:maximized-changed', false));
  mainWindow.on('closed', () => { mainWindow = null; if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.close(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const command = {
      MediaPlayPause: 'play-pause',
      MediaTrackNext: 'next',
      MediaTrackPrevious: 'previous',
      MediaStop: 'pause',
    }[input.key];
    if (command) {
      event.preventDefault();
      broadcast('media:command', command);
    }
  });

  const devServer = process.env.ZENIX_DEV_SERVER_URL;
  if (devServer) {
    void mainWindow.loadURL(devServer);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function createLyricsLockWindow() {
  if (lyricsLockWindow && !lyricsLockWindow.isDestroyed()) return lyricsLockWindow;
  lyricsLockWindow = new BrowserWindow({
    width: 36, height: 36, frame: false, transparent: true, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'lyrics-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  lyricsLockWindow.setAlwaysOnTop(true, 'floating');
  void lyricsLockWindow.loadFile(path.join(__dirname, 'lyrics-lock.html'));
  lyricsLockWindow.on('closed', () => { lyricsLockWindow = null; });
  return lyricsLockWindow;
}

function hideLyricsLockWindow() {
  if (lyricsLockWindow && !lyricsLockWindow.isDestroyed()) lyricsLockWindow.hide();
}

function updateLyricsLockBadge() {
  const win = lyricsWindow;
  if (!lyricsLocked || !win || win.isDestroyed() || !win.isVisible()) { hideLyricsLockWindow(); return; }
  const bounds = win.getBounds();
  const point = screen.getCursorScreenPoint();
  const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
  if (!inside) { hideLyricsLockWindow(); return; }
  const badge = createLyricsLockWindow();
  const x = bounds.x + Math.round((bounds.width - 36) / 2);
  const y = bounds.y + (lyricsOrientation === 'vertical' ? 86 : 35);
  const current = badge.getBounds();
  if (current.x !== x || current.y !== y) badge.setPosition(x, y);
  if (!badge.isVisible()) badge.showInactive();
}

function trackLyricsLockBadge() {
  if (lyricsLockTimer) clearInterval(lyricsLockTimer);
  lyricsLockTimer = null;
  if (!lyricsLocked || !lyricsWindow?.isVisible()) { hideLyricsLockWindow(); return; }
  updateLyricsLockBadge();
  lyricsLockTimer = setInterval(updateLyricsLockBadge, 90);
  lyricsLockTimer.unref();
}

function setLyricsLocked(value) {
  lyricsLocked = Boolean(value);
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.setIgnoreMouseEvents(lyricsLocked, { forward: true });
    lyricsWindow.webContents.send('lyrics:locked', lyricsLocked);
  }
  trackLyricsLockBadge();
  void fsp.writeFile(path.join(app.getPath('userData'), 'desktop-lyrics-state.json'), JSON.stringify({ locked: lyricsLocked })).catch(() => {});
  return lyricsLocked;
}

function saveLyricsLayout() {
  const payload = JSON.stringify({ orientation: lyricsOrientation, ...lyricsLayouts });
  lyricsLayoutSave = lyricsLayoutSave.catch(() => {}).then(() => fsp.writeFile(path.join(app.getPath('userData'), 'desktop-lyrics-bounds.json'), payload));
  void lyricsLayoutSave.catch(() => {});
}

function setLyricsOrientation(value) {
  if (value !== 'horizontal' && value !== 'vertical') throw new Error('不支持的歌词方向');
  if (value === lyricsOrientation) return lyricsOrientation;
  const win = lyricsWindow;
  const previous = win && !win.isDestroyed() ? win.getBounds() : lyricsBounds;
  if (previous) lyricsLayouts[lyricsOrientation] = previous;
  lyricsOrientation = value;
  if (win && !win.isDestroyed()) {
    if (lyricsSaveTimer) clearTimeout(lyricsSaveTimer);
    const area = screen.getDisplayMatching(previous || win.getBounds()).workArea;
    const stored = lyricsLayouts[value];
    const width = Math.min(area.width, Math.max(value === 'vertical' ? 260 : 650, Math.min(stored?.width || (value === 'vertical' ? 326 : 740), value === 'vertical' ? 380 : 820)));
    const height = Math.min(area.height, Math.max(value === 'vertical' ? 500 : 190, Math.min(stored?.height || (value === 'vertical' ? 640 : 205), value === 'vertical' ? 760 : 235)));
    const x = Math.max(area.x, Math.min(area.x + area.width - width, stored?.x ?? Math.round(previous.x + (previous.width - width) / 2)));
    const y = Math.max(area.y, Math.min(area.y + area.height - height, stored?.y ?? Math.round(previous.y + (previous.height - height) / 2)));
    win.setMinimumSize(1, 1);
    win.setBounds({ x, y, width, height });
    win.setMinimumSize(Math.min(width, value === 'vertical' ? 260 : 650), Math.min(height, value === 'vertical' ? 500 : 190));
    lyricsBounds = win.getBounds();
    lyricsLayouts[value] = lyricsBounds;
    win.webContents.send('lyrics:orientation', value);
    trackLyricsLockBadge();
  } else lyricsBounds = lyricsLayouts[value];
  saveLyricsLayout();
  return lyricsOrientation;
}

function createLyricsWindow() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) return lyricsWindow;
  const vertical = lyricsOrientation === 'vertical';
  lyricsWindow = new BrowserWindow({
    width: Math.max(vertical ? 260 : 650, Math.min(lyricsBounds?.width || (vertical ? 326 : 740), vertical ? 380 : 820)), height: Math.max(vertical ? 500 : 190, Math.min(lyricsBounds?.height || (vertical ? 640 : 205), vertical ? 760 : 235)), minWidth: vertical ? 260 : 650, minHeight: vertical ? 500 : 190, frame: false,
    transparent: true, hasShadow: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: true, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'lyrics-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  const win = lyricsWindow;
  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(lyricsLocked, { forward: true });
  const area = screen.getDisplayMatching(mainWindow?.getBounds() || screen.getPrimaryDisplay().workArea).workArea;
  const preferredX = lyricsBounds?.x ?? Math.round(area.x + (area.width - win.getBounds().width) / 2);
  const preferredY = lyricsBounds?.y ?? area.y + 68;
  win.setPosition(Math.min(Math.max(preferredX, area.x), area.x + area.width - win.getBounds().width), Math.min(Math.max(preferredY, area.y), area.y + area.height - win.getBounds().height));
  const saveBounds = () => {
    if (lyricsSaveTimer) clearTimeout(lyricsSaveTimer);
    lyricsSaveTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      lyricsBounds = win.getBounds();
      lyricsLayouts[lyricsOrientation] = lyricsBounds;
      saveLyricsLayout();
    }, 350);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  win.on('show', trackLyricsLockBadge);
  win.on('hide', trackLyricsLockBadge);
  lyricsWindow.webContents.on('did-fail-load', (_event, code, description) => console.error('Desktop lyrics load failed:', code, description));
  lyricsReady = win.loadFile(path.join(__dirname, 'desktop-lyrics.html')).then(() => {
    if (!win.isDestroyed()) win.webContents.send('lyrics:data', lyricsData());
  });
  win.on('closed', () => { lyricsWindow = null; lyricsReady = null; trackLyricsLockBadge(); if (lyricsLockWindow && !lyricsLockWindow.isDestroyed()) lyricsLockWindow.close(); broadcast('lyrics:visible', false); });
  return win;
}

function registerHandlers() {
  ipcMain.handle('lyrics:toggle', async () => {
    if (lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible()) { lyricsWindow.hide(); broadcast('lyrics:visible', false); return false; }
    const win = createLyricsWindow();
    await lyricsReady;
    if (win.isDestroyed()) return false;
    win.showInactive();
    win.setAlwaysOnTop(true, 'floating');
    broadcast('lyrics:visible', true);
    return true;
  });
  ipcMain.handle('lyrics:is-visible', () => Boolean(lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible()));
  ipcMain.handle('lyrics:lock-state', () => lyricsLocked);
  ipcMain.handle('lyrics:set-locked', (_event, value) => setLyricsLocked(value));
  ipcMain.handle('lyrics:orientation', () => lyricsOrientation);
  ipcMain.handle('lyrics:set-orientation', (_event, value) => setLyricsOrientation(value));
  ipcMain.on('lyrics:unlock', () => setLyricsLocked(false));
  ipcMain.handle('lyrics:update', (_event, payload) => {
    const duration = Number(payload?.duration);
    const position = Number(payload?.position);
    lyricsPayload = {
      previous: String(payload?.previous || ''), line: String(payload?.line || ''), next: String(payload?.next || ''),
      title: String(payload?.title || ''), trackId: String(payload?.trackId || ''), playing: Boolean(payload?.playing),
      duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
      position: Number.isFinite(position) ? Math.max(0, position) : 0,
      lines: Array.isArray(payload?.lines) ? payload.lines.slice(0, 2000).filter(line => Number.isFinite(line?.time) && typeof line?.text === 'string').map(line => ({ time: Math.max(0, line.time), text: line.text.slice(0, 500) })) : [],
    };
    lyricsTrack = payload?.track?.id === lyricsPayload.trackId ? payload.track : null;
    publishLyrics();
  });
  ipcMain.handle('lyrics:personal-action', async (_event, action, value) => {
    if (!lyricsTrack || !lyricsPayload.trackId || lyricsTrack.id !== lyricsPayload.trackId) throw new Error('当前没有可保存的歌曲');
    let state;
    if (action === 'liked' || action === 'favorites') state = await personal.toggle(action, lyricsTrack);
    else if (action === 'add') state = await personal.addToPlaylist(String(value || ''), lyricsTrack);
    else if (action === 'create') {
      const before = personal.snapshot();
      const created = await personal.createPlaylist(String(value || ''));
      const list = created.playlists.find(item => !before.playlists.some(old => old.id === item.id));
      state = list ? await personal.addToPlaylist(list.id, lyricsTrack) : created;
    } else throw new Error('不支持的操作');
    broadcast('personal:changed', state);
    publishLyrics();
    return lyricsData().saved;
  });
  ipcMain.on('lyrics:hide', () => { lyricsWindow?.hide(); broadcast('lyrics:visible', false); });
  ipcMain.on('lyrics:command', (_event, command) => { if (['play-pause', 'play', 'next', 'previous'].includes(command)) broadcast('media:command', command); });
  ipcMain.on('lyrics:seek', (_event, request) => {
    const seconds = Number(request?.seconds);
    if (request?.trackId && request.trackId === lyricsPayload.trackId && Number.isFinite(seconds)) broadcast('media:seek', { trackId: lyricsPayload.trackId, seconds: Math.max(0, Math.min(seconds, lyricsPayload.duration || seconds)) });
  });
  const personalAction = (channel, handler) => ipcMain.handle(channel, async (_event, ...args) => {
    const state = await handler(...args);
    broadcast('personal:changed', state);
    publishLyrics();
    return state;
  });
  ipcMain.handle('personal:load', () => personal.snapshot());
  personalAction('personal:toggle', (kind, track) => personal.toggle(kind, track));
  personalAction('personal:record', track => personal.record(track));
  personalAction('personal:create-playlist', name => personal.createPlaylist(name));
  personalAction('personal:rename-playlist', (id, name) => personal.renamePlaylist(id, name));
  personalAction('personal:delete-playlist', id => personal.deletePlaylist(id));
  personalAction('personal:add-to-playlist', (id, track) => personal.addToPlaylist(id, track));
  personalAction('personal:remove-from-playlist', (id, trackId) => personal.removeFromPlaylist(id, trackId));
  personalAction('personal:remove-saved', (kind, id) => personal.removeSaved(kind, id));
  ipcMain.handle('appearance:load', () => appearance.snapshot());
  ipcMain.handle('appearance:choose', async () => {
    const state = await appearance.choose(mainWindow);
    if (state) broadcast('appearance:changed', state);
    return state;
  });
  ipcMain.handle('appearance:complete', async () => {
    const state = await appearance.complete();
    broadcast('appearance:changed', state);
    return state;
  });
  ipcMain.handle('appearance:clear', async () => {
    const state = await appearance.clear();
    broadcast('appearance:changed', state);
    return state;
  });
  ipcMain.handle('sources:list', () => sourceManager.list());
  ipcMain.handle('sources:import-file', () => sourceManager.choosePackage(mainWindow));
  ipcMain.handle('sources:import-folder', () => sourceManager.chooseFolder(mainWindow));
  ipcMain.handle('sources:import-url', (_event, url) => sourceManager.importUrl(String(url || '')));
  ipcMain.handle('sources:confirm-import', (_event, token) => sourceManager.confirmImport(String(token || '')));
  ipcMain.handle('sources:cancel-import', (_event, token) => sourceManager.cancelImport(String(token || '')));
  ipcMain.handle('sources:set-enabled', (_event, id, enabled) => sourceManager.setEnabled(String(id || ''), enabled));
  ipcMain.handle('sources:configure', (_event, id, values) => sourceManager.configure(String(id || ''), values));
  ipcMain.handle('sources:get-settings', (_event, id) => sourceManager.getSettings(String(id || '')));
  ipcMain.handle('sources:move', (_event, id, direction) => sourceManager.move(String(id || ''), Number(direction) || 0));
  ipcMain.handle('sources:remove', (_event, id) => sourceManager.remove(String(id || '')));
  ipcMain.handle('sources:search', (_event, id, keyword, cursor, pageSize) => sourceManager.search(String(id || ''), keyword, cursor, pageSize));
  ipcMain.handle('sources:resolve', (_event, track, quality) => sourceManager.resolve(track, quality));
  ipcMain.handle('sources:lyrics', (_event, track) => sourceManager.lyrics(track));
  ipcMain.handle('sources:download', (_event, track, quality) => downloadManager.enqueue(track, quality));
  ipcMain.handle('sources:downloads', () => downloadManager.list());
  ipcMain.handle('sources:pause-download', (_event, id) => downloadManager.pause(String(id || '')));
  ipcMain.handle('sources:resume-download', (_event, id) => downloadManager.resume(String(id || '')));
  ipcMain.handle('sources:show-download', async (_event, id) => {
    const task = downloadManager.tasks.find(item => item.id === id && item.status === 'completed');
    if (task && await downloadManager.offlinePath(task.track.id)) shell.showItemInFolder(task.file);
  });
  ipcMain.handle('sources:open-folder', () => shell.openPath(sourceManager.folder));
  ipcMain.handle('library:load', () => library.load());
  ipcMain.handle('library:import-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: '选择音乐文件夹' });
    return result.canceled || !result.filePaths[0] ? null : library.importFolder(result.filePaths[0]);
  });
  ipcMain.handle('library:add-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: '选择音乐文件',
      filters: [{ name: '音乐文件', extensions: [...AUDIO_EXTENSIONS].map((extension) => extension.slice(1)) }],
    });
    return result.canceled || result.filePaths.length === 0 ? null : library.addFiles(result.filePaths);
  });
  ipcMain.handle('library:rescan', () => library.rescan());
  ipcMain.handle('library:remove-root', (_event, root) => library.removeRoot(root));
  ipcMain.handle('library:remove-file', (_event, filePath) => library.removeFile(filePath));
  ipcMain.handle('library:read-lyrics', (_event, id) => library.readLyrics(id));
  ipcMain.handle('library:create-playlist', (_event, name) => library.createPlaylist(name));
  ipcMain.handle('library:rename-playlist', (_event, id, name) => library.renamePlaylist(id, name));
  ipcMain.handle('library:delete-playlist', (_event, id) => library.deletePlaylist(id));
  ipcMain.handle('library:set-playlist-tracks', (_event, id, trackIds) => library.setPlaylistTracks(id, trackIds));
  ipcMain.handle('library:import-playlist', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'], title: '导入 M3U 歌单',
      filters: [{ name: 'M3U 歌单', extensions: ['m3u', 'm3u8'] }],
    });
    return result.canceled || !result.filePaths[0] ? null : library.importPlaylist(result.filePaths[0]);
  });
  ipcMain.handle('library:export-playlist', async (_event, id) => {
    const playlist = library.snapshot().playlists.find((item) => item.id === id);
    if (!playlist) return false;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 M3U 歌单', defaultPath: `${playlist.name.replace(/[\\/:*?"<>|]/g, '_')}.m3u8`,
      filters: [{ name: 'M3U8 歌单', extensions: ['m3u8'] }],
    });
    if (result.canceled || !result.filePath) return false;
    await library.exportPlaylist(id, result.filePath);
    return true;
  });

  ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); });
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
  ipcMain.handle('window:toggle-fullscreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('window:close', () => { mainWindow?.close(); });
}

// Existing installations keep their local library and Chromium storage after the visible rename.
const previousUserData = path.join(app.getPath('appData'), 'YzqxY Music Player');
if (fs.existsSync(previousUserData)) app.setPath('userData', previousUserData);

app.whenReady().then(async () => {
  try {
    const saved = JSON.parse(await fsp.readFile(path.join(app.getPath('userData'), 'desktop-lyrics-state.json'), 'utf8'));
    lyricsLocked = saved.locked === true;
  } catch { /* First launch starts unlocked. */ }
  try {
    const saved = JSON.parse(await fsp.readFile(path.join(app.getPath('userData'), 'desktop-lyrics-bounds.json'), 'utf8'));
    const valid = bounds => bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]));
    if (valid(saved)) lyricsLayouts.horizontal = saved;
    else {
      if (valid(saved.horizontal)) lyricsLayouts.horizontal = saved.horizontal;
      if (valid(saved.vertical)) lyricsLayouts.vertical = saved.vertical;
      lyricsOrientation = saved.orientation === 'vertical' ? 'vertical' : 'horizontal';
    }
    lyricsBounds = lyricsLayouts[lyricsOrientation];
  } catch { /* First launch uses the current screen. */ }
  library = new LocalLibrary(app.getPath('userData'), broadcast);
  appearance = new AppearanceStore(app.getPath('userData'));
  personal = new PersonalStore(app.getPath('userData'));
  sourceManager = new SourceManager(app.getPath('userData'), broadcast);
  downloadManager = new DownloadManager(sourceManager, app.getPath('userData'), broadcast);
  sourceManager.downloads = downloadManager;
  await library.load();
  await appearance.load();
  await personal.load();
  await sourceManager.load();
  await downloadManager.load();
  registerMediaProtocol();
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
