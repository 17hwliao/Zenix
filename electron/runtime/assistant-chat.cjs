const path = require('node:path');
const {randomUUID} = require('node:crypto');

const ACTIONS = new Set(['submitChat', 'cancel', 'confirm', 'chooseCandidate', 'setDraft', 'selectConversation', 'deleteConversation', 'configurationChanged']);

function pocketBounds(pet, area) {
  const width = Math.min(352, area.width), height = Math.min(488, area.height);
  const right = pet.x + pet.width + 10;
  const left = pet.x - width - 10;
  const preferred = right + width <= area.x + area.width ? right : left;
  return {x: Math.max(area.x, Math.min(preferred, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(pet.y + pet.height - height, area.y + area.height - height)), width, height};
}

class AssistantChat {
  constructor({getHost, getPet, BrowserWindow, ipcMain, screen, globalShortcut, onVisibility}) {
    Object.assign(this, {getHost, getPet, BrowserWindow, screen, globalShortcut, onVisibility});
    this.pending = new Map();
    this.snapshot = null;
    this.sequence = 0;
    this.window = null;
    this.shortcut = globalShortcut.register('CommandOrControl+Alt+C', () => {void this.toggle().catch(() => {});});
    ipcMain.handle('assistant-chat:invoke', (event, value) => this.invoke(event, value));
    ipcMain.on('assistant-chat:snapshot', (event, value) => {
      if (event.sender !== this.getHost()?.webContents || !value || Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) return;
      this.snapshot = value;
      this.sequence++;
      this.window?.webContents.send('assistant-chat:snapshot', {sequence: this.sequence, snapshot: value});
    });
    ipcMain.on('assistant-chat:result', (event, value) => {
      if (event.sender !== this.getHost()?.webContents) return;
      const pending = this.pending.get(value?.id);
      if (!pending) return;
      this.pending.delete(value.id);
      clearTimeout(pending.timer);
      if (value.error) pending.reject(Error(String(value.error).slice(0, 1000)));
      else pending.resolve(value.value);
    });
  }

  trusted(event) {return event.sender === this.getHost()?.webContents || event.sender === this.window?.webContents;}

  async invoke(event, value) {
    if (!this.trusted(event)) throw Error('无权使用助手会话');
    if (value?.action === 'snapshot') return {sequence: this.sequence, snapshot: this.snapshot, shortcut: this.shortcut};
    if (value?.action === 'hide') {this.window?.hide(); return true;}
    if (value?.action === 'karaoke') {
      const host = this.getHost();
      if (!host || host.isDestroyed()) throw Error('主窗口尚未就绪');
      host.show();
      host.webContents.send('desktop:command', {action: 'karaoke'});
      return true;
    }
    if (value?.action === 'toggle') return this.toggle();
    if (!ACTIONS.has(value?.action) || !Array.isArray(value.args) || Buffer.byteLength(JSON.stringify(value)) > 300 * 1024) throw Error('助手会话操作无效');
    const host = this.getHost();
    if (!host || host.isDestroyed() || host.webContents.isLoadingMainFrame()) throw Error('主窗口业务宿主尚未就绪，请打开 Zenix 后重试');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('助手响应暂未确认，请查看当前消息和业务状态后再决定，未自动重发'));
      }, 120000);
      this.pending.set(id, {resolve, reject, timer});
      host.webContents.send('assistant-chat:command', {id, action: value.action, args: value.args});
    });
  }

  async toggle() {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isVisible()) {this.window.hide(); return true;}
      this.position();
      this.window.show();
      return true;
    }
    const win = new this.BrowserWindow({width: 352, height: 488, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
      transparent: true, backgroundColor: '#00000000', hasShadow: true, webPreferences: {preload: path.join(__dirname, '../assistant-chat-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false}});
    this.window = win;
    win.on('show', () => this.onVisibility?.(true));
    win.on('hide', () => this.onVisibility?.(false));
    win.on('close', event => {if (!this.quitting) {event.preventDefault(); win.hide();}});
    win.on('closed', () => {if (this.window === win) this.window = null;this.onVisibility?.(false);});
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    if (process.env.ZENIX_DEV_SERVER_URL) await win.loadURL(process.env.ZENIX_DEV_SERVER_URL + '/?assistant-pocket=1');
    else await win.loadFile(path.join(__dirname, '../../dist/index.html'), {query: {'assistant-pocket': '1'}});
    if (win.isDestroyed()) return false;
    this.position();
    win.show();
    return true;
  }

  position() {
    if (!this.window || this.window.isDestroyed()) return;
    const pet = this.getPet();
    const anchor = pet && !pet.isDestroyed() ? pet.getBounds() : this.getHost()?.getBounds();
    const area = this.screen.getDisplayMatching(anchor || {x: 0, y: 0, width: 1, height: 1}).workArea;
    this.window.setBounds(pocketBounds(anchor || {x: area.x + area.width - 230, y: area.y + area.height - 220, width: 200, height: 200}, area));
  }

  hostClosed() {
    this.snapshot = null;
    for (const pending of this.pending.values()) {clearTimeout(pending.timer); pending.reject(Error('主窗口业务宿主已离开，本次结果需核对'));}
    this.pending.clear();
    this.window?.webContents.send('assistant-chat:snapshot', {sequence: ++this.sequence, snapshot: null});
  }

  close() {
    this.quitting = true;
    if (this.shortcut) this.globalShortcut.unregister('CommandOrControl+Alt+C');
    this.hostClosed();
    this.window?.close();
  }
}

module.exports = {AssistantChat, pocketBounds};
