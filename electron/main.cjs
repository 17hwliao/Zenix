const { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { registerMediaProtocol } = require('./runtime/media-protocol.cjs');
const { LocalLibrary, AUDIO_EXTENSIONS } = require('./library.cjs');
const { AppearanceStore } = require('./appearance.cjs');
const { PersonalStore } = require('./personal.cjs');
const { SourceManager } = require('./sources.cjs');
const { AudioCache } = require('./audio-cache.cjs');
const { LyricsHoverTracker } = require('./runtime/lyrics-hover.cjs');
const { Updates } = require('./runtime/updates.cjs');
const { Companion } = require('./runtime/companion.cjs');
const { MusicWidget } = require('./runtime/music-widget.cjs');
let companion, musicWidget;
let updates;

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) showMainWindow();
});

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
let lyricsLockReady = false;
function trustedApp(event, channel) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  const windows = [mainWindow, lyricsWindow, ...(channel === 'lyrics:unlock' ? [lyricsLockWindow] : [])];
  return windows.some(window => window && !window.isDestroyed() && window.webContents === event.sender);
}
function handleApp(channel, handler) { ipcMain.handle(channel, (event, ...args) => {
  if (!trustedApp(event, channel)) throw new Error('未授权的应用请求');
  return handler(event, ...args);
}); }
function onApp(channel, handler) { ipcMain.on(channel, (event, ...args) => {
  if (trustedApp(event, channel)) handler(event, ...args);
}); }
let library = null;
let appearance = null;
let personal = null;
let sourceManager = null;
let audioCache = null;
let lyricsDelivery = { contentsId: 0, lines: null, saved: '' };
let lastLyricsRaise = 0;
const lyricsHover = new LyricsHoverTracker({
  getBounds: () => lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible() ? lyricsWindow.getBounds() : null,
  getCursor: () => screen.getCursorScreenPoint(),
  onChange: hovered => {
    if (lyricsWindow && !lyricsWindow.isDestroyed() && !lyricsWindow.webContents.isLoading()) lyricsWindow.webContents.send('lyrics:hovered', hovered);
  },
  onSample: (bounds, hovered) => { updateLyricsLockBadge(bounds, hovered); maintainLyricsZOrder(); },
  onStop: hideLyricsLockWindow,
});

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function lyricsData() {
  return { ...lyricsPayload, saved: personal?.lyricsSaved(lyricsPayload.trackId) || { liked: false, favorite: false, playlists: [] } };
}

function publishLyrics() {
  if (!lyricsWindow || lyricsWindow.isDestroyed() || !lyricsWindow.isVisible() || lyricsWindow.webContents.isLoading()) return;
  const data = lyricsData();
  const fresh = lyricsDelivery.contentsId !== lyricsWindow.webContents.id;
  const saved = JSON.stringify(data.saved);
  if (!fresh && lyricsDelivery.lines === data.lines) delete data.lines;
  if (!fresh && lyricsDelivery.saved === saved) delete data.saved;
  lyricsDelivery = { contentsId: lyricsWindow.webContents.id, lines: lyricsPayload.lines, saved };
  lyricsWindow.webContents.send('lyrics:data', data);
}

function toggleMainFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const next = !mainWindow.isFullScreen();
  // Native fullscreen uses the entire display, including the taskbar area.
  // Electron retains the preceding window bounds for the return transition.
  mainWindow.setFullScreen(next);
  return next;
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
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

  const win = mainWindow;
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });
  mainWindow.on('maximize', () => broadcast('window:maximized-changed', true));
  mainWindow.on('unmaximize', () => broadcast('window:maximized-changed', false));
  mainWindow.on('enter-full-screen', () => broadcast('window:fullscreen-changed', true));
  mainWindow.on('leave-full-screen', () => broadcast('window:fullscreen-changed', false));
  mainWindow.on('focus', () => maintainLyricsZOrder(true));
  mainWindow.on('closed', () => {
    musicWidget?.close();
    mainWindow = null;
    if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.close();
    // An invisible source sandbox must not keep a closed desktop application alive.
    if (process.platform !== 'darwin') app.quit();
  });
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-redirect', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' && !input.alt && !input.control && !input.meta) {
      event.preventDefault();
      if (!input.isAutoRepeat) toggleMainFullscreen();
      return;
    }
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
  return win;
}

function showMainWindow() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  maintainLyricsZOrder(true);
}

function maintainLyricsZOrder(force = false) {
  const win = lyricsWindow;
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const now = performance.now();
  if (!force && now - lastLyricsRaise < 2000) return;
  lastLyricsRaise = now;
  if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver');
  // Raise without taking keyboard focus, including above other topmost windows.
  // Reuse the visible-overlay sampler; no separate idle timer or style toggling.
  win.moveTop();
  if (lyricsLockWindow && !lyricsLockWindow.isDestroyed() && lyricsLockWindow.isVisible()) lyricsLockWindow.moveTop();
}

function createLyricsLockWindow() {
  if (lyricsLockWindow && !lyricsLockWindow.isDestroyed()) return lyricsLockWindow;
  lyricsLockWindow = new BrowserWindow({
    width: 36, height: 36, frame: false, thickFrame: false, transparent: true, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'lyrics-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  lyricsLockWindow.setAlwaysOnTop(true, 'screen-saver');
  lyricsLockReady = false;
  lyricsLockWindow.once('ready-to-show', () => { lyricsLockReady = true; lyricsHover.sample(); });
  void lyricsLockWindow.loadFile(path.join(__dirname, 'lyrics-lock.html'));
  lyricsLockWindow.on('closed', () => { lyricsLockWindow = null; lyricsLockReady = false; });
  return lyricsLockWindow;
}

function hideLyricsLockWindow() {
  if (lyricsLockWindow && !lyricsLockWindow.isDestroyed()) lyricsLockWindow.hide();
}

function updateLyricsLockBadge(bounds, hovered) {
  const win = lyricsWindow;
  if (!lyricsLocked || !hovered || !win || win.isDestroyed() || !win.isVisible()) { hideLyricsLockWindow(); return; }
  const badge = createLyricsLockWindow();
  const x = bounds.x + Math.round((bounds.width - 36) / 2);
  const y = bounds.y + (lyricsOrientation === 'vertical' ? 86 : 35);
  const current = badge.getBounds();
  if (current.x !== x || current.y !== y) badge.setPosition(x, y);
  if (lyricsLockReady && !badge.isVisible()) { badge.showInactive(); badge.moveTop(); }
}

function trackLyricsInteraction() {
  if (!lyricsWindow || lyricsWindow.isDestroyed() || !lyricsWindow.isVisible()) { lyricsHover.stop(); return; }
  lyricsHover.start();
  lyricsHover.sample();
}

function setLyricsLocked(value) {
  lyricsLocked = Boolean(value);
  lyricsHover.setPinned(false);
  if (!lyricsLocked && lyricsLockWindow && !lyricsLockWindow.isDestroyed()) lyricsLockWindow.close();
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.setIgnoreMouseEvents(lyricsLocked, { forward: true });
    lyricsWindow.webContents.send('lyrics:locked', lyricsLocked);
  }
  trackLyricsInteraction();
  void fsp.writeFile(path.join(app.getPath('userData'), 'desktop-lyrics-state.json'), JSON.stringify({ locked: lyricsLocked })).catch(() => {});
  return lyricsLocked;
}

function saveLyricsLayout() {
  const payload = JSON.stringify({ orientation: lyricsOrientation, ...lyricsLayouts });
  lyricsLayoutSave = lyricsLayoutSave.catch(() => {}).then(() => fsp.writeFile(path.join(app.getPath('userData'), 'desktop-lyrics-bounds.json'), payload));
  void lyricsLayoutSave.catch(() => {});
}

function resizeLyricsWindow(size) {
  const win = lyricsWindow;
  if (!win || win.isDestroyed() || lyricsLocked || !Number.isFinite(size?.width) || !Number.isFinite(size?.height)) return;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const vertical = lyricsOrientation === 'vertical';
  const width = Math.min(area.width, Math.max(vertical ? 260 : 650, Math.min(Math.round(size.width), vertical ? 380 : 820)));
  const height = Math.min(area.height, Math.max(vertical ? 500 : 190, Math.min(Math.round(size.height), vertical ? 760 : 235)));
  if (width === bounds.width && height === bounds.height) return;
  const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
  win.setBounds({ x, y, width, height });
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
    trackLyricsInteraction();
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
    // Avoid the native resize/non-client frame on transparent Windows overlays.
    // The renderer's small resize grip changes bounds without toggling native styles.
    resizable: false, thickFrame: false, maximizable: false, fullscreenable: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'lyrics-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  const win = lyricsWindow;
  win.setAlwaysOnTop(true, 'screen-saver');
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
  win.on('show', trackLyricsInteraction);
  win.on('show', () => maintainLyricsZOrder(true));
  win.on('blur', () => maintainLyricsZOrder(true));
  win.on('hide', trackLyricsInteraction);
  lyricsWindow.webContents.on('did-fail-load', (_event, code, description) => console.error('Desktop lyrics load failed:', code, description));
  lyricsReady = win.loadFile(path.join(__dirname, 'desktop-lyrics.html')).then(() => {
    if (!win.isDestroyed()) win.webContents.send('lyrics:data', lyricsData());
  });
  win.on('close', () => {
    lyricsBounds = win.getBounds(); lyricsLayouts[lyricsOrientation] = lyricsBounds;
    saveLyricsLayout(); clearTimeout(lyricsSaveTimer);
  });
  win.on('closed', () => { lyricsWindow = null; lyricsReady = null; lyricsDelivery = { contentsId: 0, lines: null, saved: '' }; trackLyricsInteraction(); if (lyricsLockWindow && !lyricsLockWindow.isDestroyed()) lyricsLockWindow.close(); broadcast('lyrics:visible', false); });
  return win;
}

function registerHandlers() {
  handleApp('lyrics:toggle', async () => {
    if (lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible()) { lyricsWindow.close(); return false; }
    const win = createLyricsWindow();
    await lyricsReady;
    if (win.isDestroyed()) return false;
    win.showInactive();
    maintainLyricsZOrder(true);
    broadcast('lyrics:visible', true);
    return true;
  });
  handleApp('lyrics:is-visible', () => Boolean(lyricsWindow && !lyricsWindow.isDestroyed() && lyricsWindow.isVisible()));
  handleApp('lyrics:lock-state', () => lyricsLocked);
  handleApp('lyrics:hover-state', () => lyricsHover.hovered);
  handleApp('lyrics:bounds', () => lyricsWindow && !lyricsWindow.isDestroyed() ? lyricsWindow.getBounds() : null);
  onApp('lyrics:resize', (event, size) => {
    if (lyricsWindow && !lyricsWindow.isDestroyed() && event.sender.id === lyricsWindow.webContents.id) resizeLyricsWindow(size);
  });
  onApp('lyrics:pointer-gesture', (event, value) => {
    if (lyricsWindow && !lyricsWindow.isDestroyed() && event.sender.id === lyricsWindow.webContents.id && !lyricsLocked) lyricsHover.setPinned(value === true);
  });
  handleApp('lyrics:set-locked', (_event, value) => setLyricsLocked(value));
  handleApp('lyrics:orientation', () => lyricsOrientation);
  handleApp('lyrics:set-orientation', (_event, value) => setLyricsOrientation(value));
  onApp('lyrics:unlock', () => setLyricsLocked(false));
  handleApp('lyrics:update', (_event, payload) => {
    const duration = Number(payload?.duration);
    const position = Number(payload?.position);
    const sameTrack = payload?.trackId === lyricsPayload.trackId;
    lyricsPayload = {
      previous: String(payload?.previous || ''), line: String(payload?.line || ''), next: String(payload?.next || ''),
      title: String(payload?.title || ''), trackId: String(payload?.trackId || ''), playing: Boolean(payload?.playing),
      duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
      position: Number.isFinite(position) ? Math.max(0, position) : 0,
      lines: Array.isArray(payload?.lines) ? payload.lines.slice(0, 2000).filter(line => Number.isFinite(line?.time) && typeof line?.text === 'string').map(line => ({ time: Math.max(0, line.time), text: line.text.slice(0, 500) })) : sameTrack ? lyricsPayload.lines : [],
    };
    lyricsTrack = payload?.track?.id === lyricsPayload.trackId ? payload.track : sameTrack ? lyricsTrack : null;
    publishLyrics();
  });
  handleApp('lyrics:personal-action', async (_event, action, value) => {
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
  onApp('lyrics:hide', () => { lyricsWindow?.close(); });
  handleApp('lyrics:show-main', () => { showMainWindow(); return true; });
  onApp('lyrics:command', (_event, command) => { if (['play-pause', 'play', 'next', 'previous'].includes(command)) broadcast('media:command', command); });
  onApp('lyrics:seek', (_event, request) => {
    const seconds = Number(request?.seconds);
    if (request?.trackId && request.trackId === lyricsPayload.trackId && Number.isFinite(seconds)) broadcast('media:seek', { trackId: lyricsPayload.trackId, seconds: Math.max(0, Math.min(seconds, lyricsPayload.duration || seconds)) });
  });
  const personalAction = (channel, handler) => handleApp(channel, async (_event, ...args) => {
    const state = await handler(...args);
    broadcast('personal:changed', state);
    publishLyrics();
    return state;
  });
  handleApp('personal:load', () => personal.snapshot());
  personalAction('personal:toggle', (kind, track) => personal.toggle(kind, track));
  personalAction('personal:record', track => personal.record(track));
  personalAction('personal:create-playlist', (name, firstTrack) => personal.createPlaylist(name, firstTrack));
  personalAction('personal:rename-playlist', (id, name) => personal.renamePlaylist(id, name));
  personalAction('personal:delete-playlist', id => personal.deletePlaylist(id));
  personalAction('personal:add-to-playlist', (id, track) => personal.addToPlaylist(id, track));
  personalAction('personal:remove-from-playlist', (id, trackId) => personal.removeFromPlaylist(id, trackId));
  personalAction('personal:remove-saved', (kind, id) => personal.removeSaved(kind, id));
  handleApp('appearance:load', () => appearance.snapshot());
  handleApp('appearance:choose', async () => {
    const state = await appearance.choose(mainWindow);
    if (state) broadcast('appearance:changed', state);
    return state;
  });
  handleApp('appearance:complete', async () => {
    const state = await appearance.complete();
    broadcast('appearance:changed', state);
    return state;
  });
  handleApp('appearance:clear', async () => {
    const state = await appearance.clear();
    broadcast('appearance:changed', state);
    return state;
  });
  handleApp('sources:list', () => { sourceManager.assertWritable(); return sourceManager.list(); });
  handleApp('sources:import-file', () => sourceManager.choosePackage(mainWindow));
  handleApp('sources:import-folder', () => sourceManager.chooseFolder(mainWindow));
  handleApp('sources:import-url', (_event, url) => sourceManager.importUrl(String(url || '')));
  handleApp('sources:import-text', (_event, text, originUrl) => {
    const origin = new URL(String(originUrl || ''));
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('分享源地址无效');
    return sourceManager.previewPackage(String(text || ''), { kind: 'url', label: origin.href });
  });
  handleApp('sources:confirm-import', (_event, token, policy) => sourceManager.confirmImport(String(token || ''), policy));
  handleApp('sources:cancel-import', (_event, token) => sourceManager.cancelImport(String(token || '')));
  handleApp('sources:set-enabled', (_event, id, enabled) => sourceManager.setEnabled(String(id || ''), enabled));
  handleApp('sources:configure', (_event, id, values) => sourceManager.configure(String(id || ''), values));
  handleApp('sources:get-settings', (_event, id) => sourceManager.getSettings(String(id || '')));
  handleApp('sources:remove', (_event, id) => sourceManager.remove(String(id || '')));
  handleApp('sources:search', (event, id, keyword, cursor, pageSize, requestId) => sourceManager.request(event.sender.id, requestId, signal => sourceManager.search(String(id || ''), keyword, cursor, pageSize, signal)));
  handleApp('sources:cancel-request', (event, requestId) => sourceManager.cancelRequest(event.sender.id, requestId));
  handleApp('sources:cached', (_event, track, quality) => sourceManager.cached(track, quality));
  handleApp('sources:cached-best', (_event, track, qualities) => sourceManager.cachedBest(track, qualities));
  handleApp('sources:resolve', (event, track, quality, cacheAsId, skipCache, requestId) => sourceManager.request(event.sender.id, requestId, signal => sourceManager.resolve(track, quality, cacheAsId, skipCache, signal)));
  handleApp('sources:lyrics', (_event, track) => sourceManager.lyrics(track));
  handleApp('cache:stats', async () => ({ ...audioCache.stats(), ...await sourceManager.metadataCache.stats() }));
  handleApp('cache:configure', async (_event, options) => { const stats = await audioCache.configure(options); sourceManager.metadataCache.limit = Math.max(8, Math.min(64, stats.limitMiB / 8)) * 1024 * 1024; await sourceManager.metadataCache.prune(); return { ...stats, ...await sourceManager.metadataCache.stats() }; });
  handleApp('cache:clear', async () => { sourceManager.coverCache.clear(); await sourceManager.metadataCache.clear(); return { ...await audioCache.clear(), ...await sourceManager.metadataCache.stats() }; });
  handleApp('sources:open-folder', () => shell.openPath(sourceManager.folder));
  handleApp('library:load', () => library.load());
  handleApp('library:import-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: '选择音乐文件夹' });
    return result.canceled || !result.filePaths[0] ? null : library.importFolder(result.filePaths[0]);
  });
  handleApp('library:add-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: '选择音乐文件',
      filters: [{ name: '音乐文件', extensions: [...AUDIO_EXTENSIONS].map((extension) => extension.slice(1)) }],
    });
    return result.canceled || result.filePaths.length === 0 ? null : library.addFiles(result.filePaths);
  });
  handleApp('library:rescan', () => library.rescan());
  handleApp('library:remove-root', (_event, root) => library.removeRoot(root));
  handleApp('library:remove-file', (_event, filePath) => library.removeFile(filePath));
  handleApp('library:read-lyrics', (_event, id) => library.readLyrics(id));
  handleApp('library:create-playlist', (_event, name) => library.createPlaylist(name));
  handleApp('library:rename-playlist', (_event, id, name) => library.renamePlaylist(id, name));
  handleApp('library:delete-playlist', (_event, id) => library.deletePlaylist(id));
  handleApp('library:set-playlist-tracks', (_event, id, trackIds) => library.setPlaylistTracks(id, trackIds));
  handleApp('library:import-playlist', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'], title: '导入 M3U 歌单',
      filters: [{ name: 'M3U 歌单', extensions: ['m3u', 'm3u8'] }],
    });
    return result.canceled || !result.filePaths[0] ? null : library.importPlaylist(result.filePaths[0]);
  });
  handleApp('library:export-playlist', async (_event, id) => {
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

  handleApp('window:minimize', () => { mainWindow?.minimize(); });
  handleApp('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  handleApp('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
  handleApp('window:toggle-fullscreen', () => toggleMainFullscreen());
  handleApp('window:is-fullscreen', () => Boolean(mainWindow?.isFullScreen()));
  handleApp('window:close', () => { mainWindow?.close(); });
}

// Existing installations keep their local library and Chromium storage after the visible rename.
const previousUserData = path.join(app.getPath('appData'), 'YzqxY Music Player');
if (fs.existsSync(previousUserData)) app.setPath('userData', previousUserData);

if (primaryInstance) app.whenReady().then(async () => {
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
  audioCache = new AudioCache(app.getPath('userData'));
  sourceManager.audioCache = audioCache;
  updates = new Updates(app);
  handleApp('updates:invoke', (event, args) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('无权调用更新服务');
    return updates.invoke(args || {});
  });
  await Promise.all([library.load(), appearance.load(), personal.load(), sourceManager.load(), audioCache.load()]);
  musicWidget = new MusicWidget({ BrowserWindow, command: action => broadcast('media:command', action), showApp: showMainWindow });
  companion = new Companion({ folder: app.getPath('userData'), personal, library, dialog, getWindow: () => mainWindow, broadcast, app, widget: musicWidget });
  await companion.stats.load();
  handleApp('companion:invoke', (event, args) => { if(event.sender!==mainWindow?.webContents)throw Error('无权调用音乐工具');return companion.invoke(args || {}); });
  ipcMain.handle('widget:action', (event, action) => { if(!musicWidget.trusted(event))throw Error('未授权组件请求');musicWidget.action(action); });
  sourceManager.metadataCache.limit = Math.max(8, Math.min(64, audioCache.stats().limitMiB / 8)) * 1024 * 1024;
  await sourceManager.metadataCache.prune({ bestEffort: true });
  registerMediaProtocol({ protocol, sourceManager, audioCache, library, appearance });
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { companion?.stop(); updates?.stop(); sourceManager?.close(); require('./runtime/source-network.cjs').closeNetwork(); });
