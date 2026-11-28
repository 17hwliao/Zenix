const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const ID = /^[a-f0-9-]{36}$/;
const MAX_IMAGE = 2 * 1024 * 1024;

function imageDimensions(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.length >= 24) {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset++] !== 255) throw Error('JPEG 格式无效');
      let marker = bytes[offset++];
      while (marker === 255) marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      offset += length;
    }
  }
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
    if (format === 'VP8 ') return [bytes.readUInt16LE(26) & 16383, bytes.readUInt16LE(28) & 16383];
    if (format === 'VP8L' && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21);
      return [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1];
    }
  }
  throw Error('只支持真实的 PNG、JPEG 或 WebP 图片');
}

function attachmentIds(state) {
  const ids = new Set();
  for (const conversation of state.conversations) {
    for (const entry of [...conversation.messages, conversation.draft]) {
      for (const image of entry.attachments || []) {
        if (!image || !ID.test(image.id)) throw Error('会话图片引用无效');
        ids.add(image.id);
      }
    }
  }
  return ids;
}

function validateHistory(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.conversations) || value.conversations.length > 20) throw Error('会话记录格式无效');
  if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) throw Error('会话历史过大，请删除部分旧会话');
  const ids = new Set();
  for (const conversation of value.conversations) {
    if (!ID.test(conversation.id) || ids.has(conversation.id) || typeof conversation.title !== 'string' || conversation.title.length > 100) throw Error('会话记录无效');
    ids.add(conversation.id);
    if (!Array.isArray(conversation.messages) || conversation.messages.length > 100 || !conversation.draft || typeof conversation.draft.text !== 'string' || conversation.draft.text.length > 4000) throw Error('会话消息超出限制');
    for (const message of conversation.messages) {
      if (!ID.test(message.id) || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || message.text.length > 24000) throw Error('会话消息无效');
    }
    for (const entry of [...conversation.messages, conversation.draft]) {
      if (!Array.isArray(entry.attachments) || entry.attachments.length > 8) throw Error('会话附件超出限制');
      for (const image of entry.attachments) {
        if (typeof image.name !== 'string' || image.name.length > 180 || image.preview !== undefined) throw Error('会话附件资料无效');
      }
    }
  }
  if (!ids.has(value.activeId) && value.conversations.length) throw Error('当前会话无效');
  attachmentIds(value);
  return value;
}

class AssistantAttachments {
  constructor({folder, image}) {
    this.folder = path.join(folder, 'assistant-attachments');
    this.historyFile = path.join(folder, 'assistant-conversations.v1.json');
    this.image = image;
    this.retained = new Set();
    this.writes = Promise.resolve();
    this.imports = Promise.resolve();
    this.loadError = false;
  }

  file(id) {
    if (!ID.test(id)) throw Error('图片引用无效');
    return path.join(this.folder, id + '.jpg');
  }

  import(value) {
    const operation = this.imports.then(() => this.importImage(value));
    this.imports = operation.catch(() => {});
    return operation;
  }

  async importImage(value) {
    if (typeof value.base64 !== 'string' || value.base64.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)) throw Error('图片数据无效或超过 20 MiB');
    const bytes = Buffer.from(value.base64, 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw Error('图片超过 20 MiB');
    const [width, height] = imageDimensions(bytes);
    if (!width || !height || width * height > 40_000_000 || width > 20000 || height > 20000) throw Error('图片解码尺寸超过限制');
    let used = 0;
    const files = await fs.readdir(this.folder).catch(error => {if (error.code !== 'ENOENT') throw error; return [];});
    for (const name of files) used += (await fs.stat(path.join(this.folder, name))).size;
    if (used + MAX_IMAGE > 128 * 1024 * 1024) throw Error('助手图片存储已达 128 MiB，请删除部分历史图片');
    const nativeImage = this.image || require('electron').nativeImage;
    let decoded = nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty()) throw Error('图片无法解码');
    const size = decoded.getSize();
    const factor = Math.min(1, 2048 / Math.max(size.width, size.height));
    if (factor < 1) decoded = decoded.resize({width: Math.round(size.width * factor), height: Math.round(size.height * factor), quality: 'better'});
    let output = decoded.toJPEG(85);
    if (output.length > MAX_IMAGE) output = decoded.toJPEG(60);
    if (output.length > MAX_IMAGE) throw Error('处理后的图片仍超过 2 MiB，请裁剪后再试');
    const id = randomUUID();
    await fs.mkdir(this.folder, {recursive: true});
    await fs.writeFile(this.file(id), output, {flag: 'wx', mode: 0o600});
    const dimensions = decoded.getSize();
    return {id, name: String(value.name || '图片').replace(/[\x00-\x1f]/g, '').slice(0, 180), preview: 'data:image/jpeg;base64,' + decoded.resize({width: Math.min(320, dimensions.width)}).toJPEG(70).toString('base64'), bytes: output.length, ...dimensions};
  }

  async preview(id) {
    const bytes = await fs.readFile(this.file(id));
    if (bytes.length > MAX_IMAGE) throw Error('已保存的图片超出限制');
    const image = (this.image || require('electron').nativeImage).createFromBuffer(bytes);
    if (image.isEmpty()) throw Error('已保存的图片损坏');
    return 'data:image/jpeg;base64,' + image.resize({width: Math.min(320, image.getSize().width)}).toJPEG(70).toString('base64');
  }

  async hydrate(messages) {
    let total = 0;
    return Promise.all(messages.map(async message => {
      if (!Array.isArray(message.content)) return message;
      const content = [];
      for (const part of message.content) {
        if (part.type === 'text') content.push(part);
        else {
          let bytes;
          try { bytes = await fs.readFile(this.file(part.attachmentId)); }
          catch { throw Error('图片已不可用，请重新添加'); }
          total += bytes.length;
          if (bytes.length > MAX_IMAGE || total > 8 * 1024 * 1024) throw Error('本次图片总量超过 8 MiB，请减少图片或开始新会话');
          content.push({type: 'image_url', image_url: {url: 'data:image/jpeg;base64,' + bytes.toString('base64')}});
        }
      }
      return {...message, content};
    }));
  }

  async readHistory() {
    try {
      const stat = await fs.stat(this.historyFile);
      if (stat.size > 4 * 1024 * 1024) throw Error('oversize');
      const value = validateHistory(JSON.parse(await fs.readFile(this.historyFile, 'utf8')));
      this.retained = attachmentIds(value);
      await this.pruneOrphans();
      return value;
    } catch (error) {
      if (error.code !== 'ENOENT') { this.loadError = true; throw Error('历史会话无法读取，原文件已保留'); }
      await this.pruneOrphans();
      return null;
    }
  }

  async pruneOrphans() {
    const files = await fs.readdir(this.folder).catch(error => {if (error.code !== 'ENOENT') throw error; return [];});
    for (const name of files) {
      const id = name.replace(/\.jpg$/, '');
      if (!ID.test(id) || this.retained.has(id)) continue;
      const file = this.file(id);
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) await fs.unlink(file);
    }
  }

  saveHistory(value) {
    const next = structuredClone(validateHistory(value));
    const operation = this.writes.then(async () => {
      if (this.loadError) throw Error('历史文件无法读取，已保留原文件，本次未覆盖');
      const ids = attachmentIds(next);
      const temporary = this.historyFile + '.' + randomUUID() + '.tmp';
      try {
        await fs.mkdir(path.dirname(this.historyFile), {recursive: true});
        await fs.writeFile(temporary, JSON.stringify(next), {mode: 0o600, flag: 'wx'});
        await fs.rename(temporary, this.historyFile);
      } finally { await fs.unlink(temporary).catch(() => {}); }
      const retired = [...this.retained].filter(id => !ids.has(id));
      this.retained = ids;
      await Promise.all(retired.map(id => fs.unlink(this.file(id)).catch(() => {})));
      return true;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  async remove(id) {
    await this.writes;
    if (!this.retained.has(id)) await fs.unlink(this.file(id)).catch(error => {if (error.code !== 'ENOENT') throw error;});
    return true;
  }
}

module.exports = {AssistantAttachments, imageDimensions, validateHistory};
