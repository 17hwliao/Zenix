const path = require('node:path');
const {Worker} = require('node:worker_threads');

const VOICE = 'zh-CN-XiaoyiNeural';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function proxyAddress(value) {
  const first = String(value || 'DIRECT').split(';')[0].trim();
  if (first === 'DIRECT') return undefined;
  const match = /^(PROXY|HTTPS) ([a-z0-9.\-\[\]:]+)$/i.exec(first);
  if (!match) throw Error('当前代理类型不支持在线朗读');
  const url = new URL(`${match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`);
  if (!url.hostname || !url.port || url.username || url.password) throw Error('在线朗读代理无效');
  return url.origin;
}
function validate(args, needsText) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => !['operation', 'action', 'requestId', ...(needsText ? ['text'] : [])].includes(key))
    || typeof args.requestId !== 'string' || !ID.test(args.requestId)
    || args.operation !== undefined && args.operation !== 'assistant') throw Error('语音请求无效');
  if (needsText && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 300
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(args.text))) throw Error('朗读文字无效或超过300字');
}

class AssistantVoice {
  constructor({worker = data => new Worker(path.join(__dirname, 'assistant-voice-worker.cjs'), {workerData: data}),
    resolveProxy = async () => require('electron').session.defaultSession.resolveProxy('https://api.msedgeservices.com'),
    timeoutMs = 25000} = {}) {
    this.worker = worker;
    this.resolveProxy = resolveProxy;
    this.timeoutMs = timeoutMs;
    this.active = new Map();
    this.cancelled = new Map();
    this.closed = false;
  }
  cancel(args) {
    validate(args, false);
    this.cancelled.set(args.requestId, Date.now());
    for (const [id, at] of this.cancelled) if (Date.now() - at > 60000) this.cancelled.delete(id);
    while (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.keys().next().value);
    this.active.get(args.requestId)?.(Error('已取消朗读'));
    return true;
  }
  synthesize(args) {
    validate(args, true);
    if (this.closed) return Promise.reject(Error('语音服务已关闭'));
    if (this.cancelled.has(args.requestId)) return Promise.reject(Error('已取消朗读'));
    if (this.active.size >= 1) return Promise.reject(Error('正在准备上一段语音'));
    return new Promise((resolve, reject) => {
      let thread, settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.active.delete(args.requestId);
        if (thread) void thread.terminate().catch(() => {});
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(Error('晓伊在线语音等待超时')), this.timeoutMs);
      this.active.set(args.requestId, finish);
      void (async () => {
        try {
          const proxy = proxyAddress(await this.resolveProxy());
          if (settled) return;
          thread = this.worker({text: args.text, proxy});
          thread.on('error', () => finish(Error('晓伊在线语音暂不可用')));
          thread.on('exit', () => finish(Error('在线朗读未完成')));
          thread.on('message', value => {
            if (value?.error || !ArrayBuffer.isView(value?.audio)) return finish(Error('晓伊在线语音暂不可用'));
            const bytes = Buffer.from(value.audio);
            if (bytes.length < 100 || bytes.length > 2 * 1024 * 1024) return finish(Error('语音数据无效'));
            finish(null, {voice: VOICE, mimeType: 'audio/mpeg', audioBase64: bytes.toString('base64')});
          });
        } catch {finish(Error('晓伊在线语音暂不可用'));}
      })();
    });
  }
  close() {
    this.closed = true;
    for (const finish of [...this.active.values()]) finish(Error('语音服务已关闭'));
    this.cancelled.clear();
  }
}
module.exports = {AssistantVoice, VOICE, proxyAddress};
