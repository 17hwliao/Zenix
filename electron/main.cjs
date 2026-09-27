const { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { LocalLibrary, AUDIO_EXTENSIONS } = require('./library.cjs');
const { AppearanceStore } = require('./appearance.cjs');
const { PersonalStore } = require('./personal.cjs');
const { createOnlineService } = require('./online-service.cjs');

protocol.registerSchemesAsPrivileged([{
  scheme: 'yzqxy',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

let mainWindow = null;
let lyricsWindow = null;
let lyricsPayload = { line: '', next: '', title: '' };
let library = null;
let appearance = null;
let personal = null;
const onlineService = createOnlineService();

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
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

function createLyricsWindow() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) return lyricsWindow;
  lyricsWindow = new BrowserWindow({
    width: 760, height: 104, minWidth: 420, minHeight: 84, frame: false,
    transparent: true, hasShadow: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: true, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'lyrics-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  lyricsWindow.setAlwaysOnTop(true, 'floating');
  const area = screen.getPrimaryDisplay().workArea;
  lyricsWindow.setPosition(Math.round(area.x + (area.width - 760) / 2), area.y + 68);
  lyricsWindow.webContents.on('did-fail-load', (_event, code, description) => console.error('Desktop lyrics load failed:', code, description));
  void lyricsWindow.loadFile(path.join(__dirname, 'desktop-lyrics.html')).catch(error => console.error('Desktop lyrics load error:', error));
  lyricsWindow.webContents.once('did-finish-load', () => lyricsWindow?.webContents.send('lyrics:data', lyricsPayload));
  lyricsWindow.on('closed', () => { lyricsWindow = null; broadcast('lyrics:visible', false); });
  return lyricsWindow;
}

function registerHandlers() {
  ipcMain.handle('lyrics:toggle', () => {
    if (lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible()) { lyricsWindow.hide(); broadcast('lyrics:visible', false); return false; }
    const win = createLyricsWindow(); win.showInactive(); broadcast('lyrics:visible', true); return true;
  });
  ipcMain.handle('lyrics:is-visible', () => Boolean(lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible()));
  ipcMain.handle('lyrics:update', (_event, payload) => { lyricsPayload = { line: String(payload?.line || ''), next: String(payload?.next || ''), title: String(payload?.title || '') }; if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.webContents.send('lyrics:data', lyricsPayload); });
  ipcMain.on('lyrics:hide', () => { lyricsWindow?.hide(); broadcast('lyrics:visible', false); });
  const personalAction = (channel, handler) => ipcMain.handle(channel, async (_event, ...args) => {
    const state = await handler(...args);
    broadcast('personal:changed', state);
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
  ipcMain.handle('online:search', (_event, query, offset, limit) => onlineService.search(query, offset, limit));
  ipcMain.handle('online:resolve', (_event, remoteId) => onlineService.resolve(remoteId));
  ipcMain.handle('online:lyrics', (_event, remoteId) => onlineService.lyrics(remoteId));
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
  library = new LocalLibrary(app.getPath('userData'), broadcast);
  appearance = new AppearanceStore(app.getPath('userData'));
  personal = new PersonalStore(app.getPath('userData'));
  await library.load();
  await appearance.load();
  await personal.load();
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
