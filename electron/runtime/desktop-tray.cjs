const path = require('node:path');
class DesktopTray {
  constructor({app, Tray, Menu, show, command, icon}) {
    Object.assign(this, {app, Menu, show, command}); this.quitting = false;
    this.tray = new Tray(icon || path.join(__dirname, '../../assets/zenix-icon.ico'));
    this.tray.setToolTip('Zenix · 你的音乐，自成宇宙。');
    this.tray.on('double-click', show); this.tray.on('click', show);
    this.update({});
    app.on('before-quit', () => { this.quitting = true; });
    app.on('will-quit', () => this.tray.destroy());
  }
  update(state) {
    const signature=JSON.stringify([state.title,state.artist,state.playing]);if(signature===this.signature)return;this.signature=signature;
    const title = String(state.title || 'Zenix').slice(0, 90);
    this.tray.setToolTip(`${title}${state.artist ? ' · '+String(state.artist).slice(0, 30) : ''}`);
    this.tray.setContextMenu(this.Menu.buildFromTemplate([
      {label:'打开 Zenix', click:this.show}, {type:'separator'},
      {label:state.playing ? '暂停' : '播放',click:()=>this.command('play-pause')},
      {label:'上一首',click:()=>this.command('previous')}, {label:'下一首',click:()=>this.command('next')},
      {type:'separator'}, {label:'退出 Zenix',click:()=>this.app.quit()},
    ]));
  }
  close(event, window) {
    if(this.quitting || !this.tray || this.tray.isDestroyed()) return;
    event.preventDefault(); window.hide();
  }
}
module.exports = {DesktopTray};
