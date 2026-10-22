const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readBoundedFile } = require('./bounded-file.cjs');
const { encodeProtected, decodeProtected } = require('./protected-json.cjs');
const { encode, decode, media } = require('./backup-format.cjs');
const { canonical, MAX_BYTES, SECTIONS, cleanProfile, mergePersonal, mergeStats, preview } = require('../../src/core/backupFormat.cjs');
const featureSettings = require('../../src/features/settingsBackup.cjs');
const needsBrowser = sections => sections.includes('profile') || sections.includes('featureSettings');
function browserIdentity(browser,sections){const settings=sections.includes('featureSettings')?featureSettings.clean(browser?.settings||{}):null;return {profile:sections.includes('profile')?cleanProfile(browser?.profile||{}):null,settings:settings?{space:settings.space,playbackPreferences:settings.playbackPreferences,assistant:settings.assistant,present:{space:settings.present.space,playbackPreferences:settings.present.playbackPreferences,assistant:settings.present.assistant}}:null};}
function recoveryValues(state,sections){const result={};for(const kind of ['liked','favorites','playlists','history'])if(sections.includes(kind))result[kind]=state.personal[kind];for(const kind of ['stats','appearance'])if(sections.includes(kind))result[kind]=state[kind];if(sections.includes('profile'))result.profile=cleanProfile(state.browser?.profile||{});if(sections.includes('personalFeatures'))result.personalFeatures={bookmarks:state.personalFeatures.bookmarks,lyrics:state.personalFeatures.lyrics};if(sections.includes('featureSettings')){const value=featureSettings.clean(state.featureSettings);for(const key of ['space','playbackPreferences','assistant','networkPolicy'])result[key]={present:value.present[key],value:value[key]};}return result;}

class BackupManager {
  constructor({ folder, personal, library, appearance, stats, dialog, getWindow, broadcast, protection }) { this.protection = protection; Object.assign(this, { folder, personal, library, appearance, stats, dialog, getWindow, broadcast }); this.journal = path.join(folder, 'backup-restore.json'); this.pending = null; this.busy = false; this.failure = ''; }
  async readJournal() { try { return (await decodeProtected(await readBoundedFile(this.journal, 32 * 1024 * 1024, 'utf8'), this.protection)).value; } catch (error) { if (error.code === 'ENOENT') return null; throw Error('恢复快照无法读取，已保留文件；请先解决存储问题'); } }
  async writeJournal(value) { const encoded = await encodeProtected(value, this.protection); if (Buffer.byteLength(encoded) > 32 * 1024 * 1024) throw Error("恢复快照过大，请分批恢复资料"); const temp = `${this.journal}.tmp`; await fs.writeFile(temp, encoded); await fs.rename(temp, this.journal); }
  async load() {
    try {
      const journal = await this.readJournal();
      if (journal?.pending) {
        await this.writeJournal({...journal,receiptId:journal.receiptId||randomUUID(),recovered:true,recoveryTarget:'pending',browserPending:false});
      } else if (journal?.browserPending) {
        // Backend commit is complete. Never roll later user edits back while
        // recovering only an interrupted renderer profile acknowledgement.
        await this.writeJournal({ ...journal, browserPending: false, recovered: true, recoveryTarget: 'after' });
      }
    } catch (error) { this.failure = error.message; }
  }
  async exclusive(fn) {
    if (this.busy) throw Error('资料恢复正在进行'); if (this.failure) throw Error(this.failure); this.busy = true;
    let release; const barrier = new Promise(resolve => { release = resolve; }); this.personal.backupBarrier = barrier; this.stats.backupBarrier = barrier; this.appearance.backupBarrier = barrier;if(this.offlineTasks)this.offlineTasks.backupBarrier=barrier;
    try { await Promise.all([this.personal.pendingSave, this.stats.pending,this.offlineTasks?.writes]); return await fn(); } finally { this.busy = false; this.personal.backupBarrier = null; this.stats.backupBarrier = null; this.appearance.backupBarrier = null;if(this.offlineTasks)this.offlineTasks.backupBarrier=null; release(); }
  }
  capture(browser, sections = []) {
    this.personal.assertWritable();if(sections.includes('stats')&&this.stats.failure)throw Error(this.stats.failure);if(sections.includes('personalFeatures')&&!this.personalFeatures)throw Error('私人资料服务尚未就绪');
    const state={personal:this.personal.snapshot(),...(sections.includes('personalFeatures')?{personalFeatures:this.personalFeatures.snapshot()}:{}),stats:sections.includes('stats')?structuredClone(this.stats.data):null,appearance:structuredClone(this.appearance.settings),browser:{profile:cleanProfile(browser?.profile||{}),transparency:Math.max(0,Math.min(90,Number(browser?.transparency)||0))}};
    if(sections.includes('featureSettings')){if(browser?.settingsError)throw Error('功能设置无法读取，原设置已保留');if(!this.offlineTasks)throw Error('网络偏好服务尚未就绪');state.browser.settings=featureSettings.clean(browser?.settings||{});state.featureSettings=featureSettings.clean({...state.browser.settings,networkPolicy:this.offlineTasks.network.policy,present:{...state.browser.settings.present,networkPolicy:true}});}
    return state;
  }
  async writeState(state, sections) {
    if (sections.some(key => ['liked', 'favorites', 'playlists', 'history'].includes(key))) { const current=structuredClone(this.personal.snapshot());for(const kind of ['liked','favorites','playlists','history'])if(sections.includes(kind))current[kind]=structuredClone(state.personal[kind]);this.personal.data=current;await this.personal.save(); }
    if (sections.includes('stats')) { const temp = `${this.stats.file}.restore.tmp`; await fs.writeFile(temp, JSON.stringify(state.stats)); await fs.rename(temp, this.stats.file); this.stats.data = structuredClone(state.stats); }
    if (sections.includes('appearance')) await this.appearance.save(state.appearance, true);
    if (sections.includes('personalFeatures')) await this.personalFeatures.persist(state.personalFeatures);
    if (sections.includes('featureSettings')&&canonical(this.offlineTasks.network.policy)!==canonical(state.featureSettings.networkPolicy)) await this.offlineTasks.invoke({action:'policy',policy:state.featureSettings.networkPolicy,backupRestore:true});
  }
  notify() { this.broadcast('personal:changed', this.personal.snapshot()); void this.appearance.snapshot().then(state => this.broadcast('appearance:changed', state)); }
  async invoke(args) {
    if (this.failure) throw Error(this.failure);
    switch (args.operation) {
      case 'backupInfo': {
        const journal = await this.readJournal(), background = this.appearance.settings.background;
        const size = background ? (await fs.stat(path.join(this.appearance.folder, background.fileName)).catch(() => null))?.size || 0 : 0;
        const targetAfter = journal?.browserPending || journal?.recoveryTarget === 'after';
        return { undoAvailable: Boolean(journal && !journal.pending && !journal.recovered && !journal.blockedUndo && !journal.finishedUndo), recovery: journal && (journal.pending || journal.recovered || journal.browserPending) ? { backendPending:journal.pending===true,receiptId:journal.receiptId,browser: journal[targetAfter ? 'after' : 'before'].browser, previousBrowser: journal[targetAfter ? 'before' : 'after'].browser, sections: journal.sections, browserReceipt: true, undoAvailable: targetAfter && !journal.finishedUndo } : null,
          backgroundBytes: size, metadataBytes: Buffer.byteLength(JSON.stringify(this.personal.snapshot())), statsBytes: (await fs.stat(this.stats.file).catch(() => null))?.size || 0,
          backgroundKind: background ? ['.mp4', '.m4v', '.webm', '.ogv'].includes(path.extname(background.fileName)) ? 'video' : 'image' : null };
      }
      case 'backupCreate': {
        const sections = this.sections(args.sections), state = this.capture(args.browser, sections), payload = { personal: {} };
        for (const key of ['liked', 'favorites', 'playlists', 'history']) if (sections.includes(key)) payload.personal[key] = state.personal[key];
        if (sections.includes('profile')) payload.profile = state.browser.profile;
        if (sections.includes('personalFeatures')) payload.extensions = {personalFeatures:{...state.personalFeatures,journal:[]}};
        if (sections.includes('featureSettings')) payload.extensions = {...payload.extensions,featureSettings:state.featureSettings};
        if (sections.includes('stats')) { await this.stats.pending; payload.stats = structuredClone(this.stats.data); }
        if (sections.includes('appearance')) { payload.appearance = { transparency: state.browser.transparency }; const background = state.appearance.background; if (background && args.includeBackground) { const kind = ['.mp4', '.m4v', '.webm', '.ogv'].includes(path.extname(background.fileName)) ? 'video' : 'image'; if (kind === 'video' && !args.includeVideo) throw Error('视频背景需要单独勾选'); const bytes = await readBoundedFile(path.join(this.appearance.folder, background.fileName), (kind === 'video' ? 32 : 12) * 1024 * 1024); media(bytes, kind); payload.appearance.media = { kind, name: background.name, base64: bytes.toString('base64') }; } }
        const text = encode(payload); const result = await this.dialog.showSaveDialog(this.getWindow(), { title: '创建资料备份', defaultPath: `Zenix-${new Date().toISOString().slice(0, 10)}.zenixbackup`, filters: [{ name: 'Zenix 资料备份', extensions: ['zenixbackup'] }] }); if (result.canceled) return { saved: false }; await fs.writeFile(result.filePath, text); return { saved: true, bytes: Buffer.byteLength(text) };
      }
      case 'backupRead': { const result = await this.dialog.showOpenDialog(this.getWindow(), { title: '恢复资料备份', properties: ['openFile'], filters: [{ name: 'Zenix 资料备份', extensions: ['zenixbackup'] }] }); if (result.canceled) return null; const payload = decode(await readBoundedFile(result.filePaths[0], MAX_BYTES, 'utf8')); this.pending = { token: randomUUID(), payload }; return { token: this.pending.token, ...preview(payload),...(payload.extensions?.featureSettings?{settingsDiff:featureSettings.diff(this.capture(args.browser,['featureSettings']).featureSettings,payload.extensions.featureSettings)}:{}) }; }
      case 'backupDiscard': this.pending = null; return true;
      case 'backupApply': return this.exclusive(async () => {
        const existingJournal=await this.readJournal();if(existingJournal?.pending||existingJournal?.recovered||existingJournal?.browserPending)throw Error('请先完成中断的界面资料恢复，原快照仍保留');
        if (!this.pending || args.token !== this.pending.token) throw Error('恢复预览已失效，请重新选择备份');
        const sections = this.sections(args.sections), payload = this.pending.payload, before = this.capture(args.browser, sections), after = structuredClone(before);
        const merged = mergePersonal(before.personal, payload.personal, sections, this.library.snapshot().tracks, randomUUID); after.personal = merged.personal;
        if (sections.includes('personalFeatures') && payload.extensions?.personalFeatures) after.personalFeatures = require('../../src/features/personal/model.cjs').merge(before.personalFeatures,payload.extensions.personalFeatures,randomUUID);
        if (sections.includes('featureSettings')&&payload.extensions?.featureSettings){after.featureSettings=featureSettings.merge(before.featureSettings,payload.extensions.featureSettings,args.featureSettingsMode==='replace');after.browser.settings=after.featureSettings;}
        if (sections.includes('profile') && payload.profile) after.browser.profile = { ...before.browser.profile, ...payload.profile, tagline: payload.profile.tagline || payload.profile.bio || before.browser.profile.tagline };
        if (sections.includes('stats') && payload.stats) after.stats = mergeStats(before.stats, payload.stats);
        if (sections.includes('appearance') && payload.appearance) { after.browser.transparency = payload.appearance.transparency; const value = payload.appearance.media; if (value) { const bytes = Buffer.from(value.base64, 'base64'), extension = media(bytes, value.kind); await fs.mkdir(this.appearance.folder, { recursive: true }); const fileName = `background-${randomUUID()}${extension}`; await fs.writeFile(path.join(this.appearance.folder, fileName), bytes); after.appearance = { completed: true, background: { fileName, name: value.name } }; } }
        // Retain the previous background independently of the usual replacement cleanup.
        const restoreBefore = structuredClone(before); if (sections.includes('appearance') && before.appearance.background) { const old = before.appearance.background; const fileName = `background-${randomUUID()}${path.extname(old.fileName)}`; await fs.copyFile(path.join(this.appearance.folder, old.fileName), path.join(this.appearance.folder, fileName)); restoreBefore.appearance.background.fileName = fileName; }
        const journal = { pending: true, before: restoreBefore, after, sections,...(sections.includes('featureSettings')?{receiptId:randomUUID()}: {}) }; await this.writeJournal(journal);
        try { await this.writeState(after, sections); journal.pending = false; journal.browserPending = needsBrowser(sections); await this.writeJournal(journal); }
        catch (error) { try { await this.writeState(restoreBefore, sections); await fs.unlink(this.journal); } catch { this.failure = '恢复中断，已保留恢复快照；请重启后修复存储问题'; this.personal.loadError = this.failure; this.stats.failure = this.failure; } throw error; }
        this.pending = null; this.notify(); return { ...merged.result, browser: after.browser, previousBrowser:before.browser,sections, undoAvailable: true, browserReceipt: needsBrowser(sections),receiptId:journal.receiptId };
      });
      case 'backupRecover': return this.exclusive(async()=>{
        const journal=await this.readJournal();if(!journal?.pending||args.receiptId!==journal.receiptId)throw Error('待处理恢复已变化，未修改当前资料');
        const current=this.capture(args.browser,journal.sections),observed=recoveryValues(current,journal.sections),before=recoveryValues(journal.before,journal.sections),after=recoveryValues(journal.after,journal.sections);
        for(const [key,value]of Object.entries(observed))if(canonical(value)!==canonical(before[key])&&canonical(value)!==canonical(after[key]))throw Error('检测到恢复之后的新修改，已保留当前资料；请选择保留当前资料结束恢复');
        const target=structuredClone(journal.before);if(journal.sections.includes('featureSettings')){target.featureSettings.space.revision=current.featureSettings.space.revision+1;target.featureSettings=featureSettings.clean(target.featureSettings);target.browser.settings=target.featureSettings;}
        const next={...journal,before:current,after:target,pending:true,recovered:false,blockedUndo:true,receiptId:randomUUID()};await this.writeJournal(next);
        try{await this.writeState(target,journal.sections);if(needsBrowser(journal.sections))await this.writeJournal({...next,pending:false,browserPending:true,finishedUndo:true});else await fs.unlink(this.journal);}catch(error){await this.writeState(current,journal.sections);await this.writeJournal(journal);throw error;}
        this.notify();return {browser:target.browser,previousBrowser:current.browser,sections:journal.sections,browserReceipt:needsBrowser(journal.sections),receiptId:next.receiptId,undoAvailable:false};
      });
      case 'backupKeepCurrent': return this.exclusive(async()=>{
        const journal=await this.readJournal();if(!journal||args.receiptId!==journal.receiptId)throw Error('恢复回执已失效，当前设置已保留');
        journal.after=this.capture(args.browser,journal.sections);journal.pending=false;journal.browserPending=false;journal.recovered=false;journal.finishedUndo=false;journal.blockedUndo=true;await this.writeJournal(journal);return {undoAvailable:false};
      });
      case 'backupAcknowledge': return this.exclusive(async () => {
        const journal=await this.readJournal();if(!journal)return true;if(journal.pending)throw Error('后端恢复尚未完成，请明确选择恢复到操作前或保留当前资料');
        if(journal.receiptId&&args.receiptId!==journal.receiptId)throw Error('恢复回执已失效，未覆盖当前设置');
        const target=journal.recovered&&journal.recoveryTarget!=='after'?journal.before:journal.after;
        if(canonical(browserIdentity(args.browser,journal.sections))!==canonical(browserIdentity(target.browser,journal.sections)))throw Error('界面资料或设置写入尚未完成，恢复快照仍保留');
        if((journal.recovered&&journal.recoveryTarget!=='after')||journal.finishedUndo)await fs.unlink(this.journal);
        else{journal.recovered=false;journal.browserPending=false;await this.writeJournal(journal);}return true;
      });
      case 'backupUndo': return this.exclusive(async () => {
        const journal=await this.readJournal();if(!journal||journal.pending||journal.recovered||journal.blockedUndo)throw Error('没有可撤销的恢复；当前资料与原快照已保留');
        const current=this.capture(args.browser,journal.sections);
        const selectedState=value=>({personalFeatures:journal.sections.includes('personalFeatures')?value.personalFeatures:null,featureSettings:journal.sections.includes('featureSettings')?value.featureSettings:null,personal:journal.sections.some(key=>['liked','favorites','playlists','history'].includes(key))?value.personal:null,stats:journal.sections.includes('stats')?value.stats:null,appearance:journal.sections.includes('appearance')?value.appearance:null,browser:browserIdentity(value.browser,journal.sections)});
        if(canonical(selectedState(current))!==canonical(selectedState(journal.after)))throw Error('恢复后资料已改变，暂不能整体撤销，以免覆盖新资料；恢复前快照仍保留');
        const undoJournal={...journal,pending:true,before:current,...(journal.sections.includes('featureSettings')?{receiptId:randomUUID()}: {})};await this.writeJournal(undoJournal);
        const target=structuredClone(journal.before);if(journal.sections.includes('featureSettings')){target.featureSettings.space.revision=current.featureSettings.space.revision+1;target.browser.settings=target.featureSettings;}try{await this.writeState(target,journal.sections);if(needsBrowser(journal.sections))await this.writeJournal({...undoJournal,pending:false,browserPending:true,after:target,finishedUndo:true});else await fs.unlink(this.journal);}
        catch(error){await this.writeState(current,journal.sections);await this.writeJournal(journal);throw error;}
        this.notify();return {browser:target.browser,previousBrowser:current.browser,sections:journal.sections,undoAvailable:false,browserReceipt:needsBrowser(journal.sections),receiptId:undoJournal.receiptId};
      });
      case 'backupRelink': return this.exclusive(async () => { const before = this.personal.snapshot(), tracks = this.library.snapshot().tracks; let linked = 0; const { restoreTrack } = require('../../src/core/backupFormat.cjs'); const visit = value => { if (Array.isArray(value)) return value.map(visit); if (value && typeof value === 'object') { if (value.title !== undefined && value.source === 'local' && value.availability === 'unavailable') { const result = restoreTrack(value, tracks); if (result.availability === 'playable') linked++; return result; } const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)])); if (result.track?.id && Object.hasOwn(result, 'playedAt')) result.id = result.track.id; return result; } return value; }; this.personal.data = visit(before); try { await this.personal.save(); } catch (error) { this.personal.data = before; throw error; } this.notify(); return { linked }; });
      default: throw Error('未知资料备份操作');
    }
  }
  sections(value) { if (!Array.isArray(value) || !value.length || value.some(key => !SECTIONS.includes(key))) throw Error('请选择要备份或恢复的资料'); return [...new Set(value)]; }
}
module.exports = { BackupManager };
