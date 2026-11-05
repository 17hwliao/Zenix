const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const protocol = require('./assistant-model-protocol.cjs');
const { ModelError } = protocol;

function emptyConfig() { return { enabled: false, endpoint: '', model: '', apiKey: '', revision: randomUUID() }; }
function mask(value) { return { enabled: value.enabled, endpoint: value.endpoint, model: value.model, keyPresent: !!value.apiKey, keyHint: value.apiKey ? '••••••••' : '', revision: value.revision }; }
function failure(error) {
  if (error instanceof ModelError) return error;
  return new ModelError('network', '模型连接失败，请检查服务地址、网络和代理设置');
}

/** Model networking and its private credentials are independent of music sources and updates. */
class AssistantModel {
  constructor({ folder, request, protection, timeoutMs = protocol.MODEL_TIMEOUT_MS }) {
    this.file = path.join(folder, 'assistant-model.private.json');
    this.request = request || ((url, options) => require('electron').net.fetch(url, options));
    this.protection = protection;
    this.timeoutMs = timeoutMs;
    this.config = emptyConfig();
    this.active = new Map();
    this.cancelled = new Map();
    this.writes = Promise.resolve();
    this.closed = false;
    this.storageError = false;
  }
  load() {
    this.loaded ||= this.readFile();
    return this.loaded;
  }
  async readFile() {
    try {
      const text = await fs.readFile(this.file, 'utf8');
      if (Buffer.byteLength(text) > 64 * 1024) throw Error('oversize');
      this.protection ||= require('./protected-json.cjs');
      const decoded = await this.protection.decodeProtected(text);
      if (decoded.legacy) throw Error('unprotected');
      const stored = decoded.value;
      const checked = protocol.config({ enabled: stored.enabled, endpoint: stored.endpoint, model: stored.model, apiKey: stored.apiKey }, undefined);
      protocol.string(stored.revision, 100, 1);
      this.config = { ...checked, revision: stored.revision };
    } catch (error) {
      if (error.code !== 'ENOENT') this.storageError = true;
    }
  }
  checkReady() {
    if (this.closed) throw new ModelError('closed', '远程助手已关闭');
    if (this.storageError) throw new ModelError('storage', '模型配置无法读取或解密，原文件已保留。可继续使用本地音乐指令');
  }
  cancel(requestId) {
    if (!protocol.REQUEST_ID.test(requestId)) throw new ModelError('invalid_request', '模型请求编号无效');
    this.cancelled.set(requestId, Date.now());
    for (const [id, at] of this.cancelled) if (Date.now() - at > 15 * 60 * 1000) this.cancelled.delete(id);
    while (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.keys().next().value);
    this.active.get(requestId)?.abort();
    return true;
  }
  async configure(input) {
    const operation = this.writes.then(async () => {
      await this.load(); this.checkReady();
      const next = protocol.config(input, this.config);
      this.protection ||= require('./protected-json.cjs');
      let encoded;
      try { encoded = await this.protection.encodeProtected(next); }
      catch { throw new ModelError('storage', '系统加密服务不可用，模型配置未保存'); }
      const temporary = this.file + '.' + randomUUID() + '.tmp';
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.writeFile(temporary, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, this.file);
      } catch { await fs.unlink(temporary).catch(() => {}); throw new ModelError('storage', '模型配置保存失败，已保留上次配置'); }
      this.config = next;
      for (const controller of this.active.values()) controller.abort();
      return mask(next);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async complete(input, probe = false) {
    await this.load(); this.checkReady();
    const args = protocol.request(input), selected = { ...this.config };
    if ((!selected.enabled && !probe) || !selected.endpoint || !selected.model || !selected.apiKey) throw new ModelError('not_configured', '请先配置模型服务和 API Key，或继续使用本地音乐指令');
    if (args.revision !== selected.revision) throw new ModelError('configuration_changed', '模型配置已变化，请重新发送指令');
    if (this.cancelled.has(args.requestId)) throw new ModelError('cancelled', '模型请求已取消');
    if (this.active.has(args.requestId) || this.active.size >= 2) throw new ModelError('busy', '已有模型请求正在处理');
    const controller = new AbortController(); this.active.set(args.requestId, controller);
    let expired = false;
    const timer = setTimeout(() => { expired = true; controller.abort(); }, this.timeoutMs);
    const body = { model: selected.model, messages: args.messages, stream: false };
    if (args.tools.length) { body.tools = args.tools; body.tool_choice = probe ? { type: 'function', function: { name: 'zenix_connection_probe' } } : 'auto'; }
    const checkCurrent = () => {
      if (expired) throw new ModelError('timeout', '模型请求等待超时，可重新发送指令。音乐加载不受此限制影响');
      if (controller.signal.aborted || this.cancelled.has(args.requestId) || this.closed) throw new ModelError('cancelled', '模型请求已取消');
      if (this.config.revision !== selected.revision) throw new ModelError('configuration_changed', '模型配置已变化，旧回复已丢弃');
    };
    try {
      const result = await this.request(selected.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + selected.apiKey }, body: JSON.stringify(body), redirect: 'manual', signal: controller.signal });
      checkCurrent();
      if (result.status >= 300 && result.status < 400) throw new ModelError('redirect', '模型地址发生重定向，已停止发送凭据。请填写最终 HTTPS 接口地址');
      if (!result.ok) {
        const code = result.status === 401 || result.status === 403 ? 'authentication' : result.status === 429 ? 'rate_limit' : 'service';
        throw new ModelError(code, code === 'authentication' ? '模型鉴权失败，请检查 API Key 和服务归属' : code === 'rate_limit' ? '模型服务限流，请稍后重试' : `模型服务返回 HTTP ${result.status}，未执行功能`);
      }
      const declared = Number(result.headers?.get('content-length'));
      if (Number.isFinite(declared) && declared > protocol.MAX_RESPONSE_BYTES) throw new ModelError('oversize', '模型回复过大，未执行功能');
      const reader = result.body?.getReader();
      if (!reader) throw new ModelError('protocol', '模型没有返回有效响应');
      const parts = []; let size = 0;
      try {
        for (;;) {
          const part = await reader.read(); checkCurrent(); if (part.done) break;
          size += part.value.byteLength;
          if (size > protocol.MAX_RESPONSE_BYTES) throw new ModelError('oversize', '模型回复过大，未执行功能');
          parts.push(Buffer.from(part.value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      let raw;
      try { raw = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new ModelError('protocol', '模型未返回兼容的完整 JSON 回复'); }
      checkCurrent();
      return protocol.response(raw, new Set(args.tools.map(tool => tool.function.name)), selected.apiKey);
    } catch (error) { checkCurrent(); throw failure(error); }
    finally {
      controller.abort();
      clearTimeout(timer);
      if (this.active.get(args.requestId) === controller) this.active.delete(args.requestId);
    }
  }
  async test(requestId) {
    await this.load(); this.checkReady();
    const revision = this.config.revision, nonce = randomUUID();
    const tool = { type: 'function', function: { name: 'zenix_connection_probe', description: 'Return the nonce to verify tool-call format. This is a connection probe with no execution.', parameters: { type: 'object', properties: { nonce: { type: 'string', enum: [nonce] } }, required: ['nonce'], additionalProperties: false } } };
    const value = await this.complete({ requestId, revision, messages: [{ role: 'user', content: 'Call zenix_connection_probe with the provided nonce. Do not request any music operations.' }], tools: [tool] }, true);
    let compatible = false;
    try { compatible = value.toolCalls.length === 1 && JSON.parse(value.toolCalls[0].arguments).nonce === nonce; } catch {}
    return { ok: compatible, revision, toolCalling: compatible, message: compatible ? '连接成功，已验证 Chat Completions 工具调用格式' : '服务可连接，但未返回兼容的工具调用。请检查模型是否支持 tools' };
  }
  async invoke(args) {
    protocol.object(args, ['action', 'value', 'request', 'requestId'], ['action']);
    switch (args.action) {
      case 'read': await this.load(); this.checkReady(); return mask(this.config);
      case 'configure': return this.configure(args.value);
      case 'test': return this.test(args.requestId);
      case 'complete': return this.complete(args.request);
      case 'cancel': return this.cancel(args.requestId);
      default: throw new ModelError('invalid_request', '未知模型操作');
    }
  }
  close() { this.closed = true; for (const controller of this.active.values()) controller.abort(); }
}
module.exports = { AssistantModel, ModelError };
