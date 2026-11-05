const { randomUUID } = require('node:crypto');

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const MODEL_TIMEOUT_MS = 90_000;
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;

class ModelError extends Error {
  constructor(code, message) { super(message); this.name = 'ModelError'; this.code = code; }
}
const invalid = message => { throw new ModelError('invalid_request', message); };
function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('模型请求格式无效');
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) invalid('模型请求字段无效');
  return value;
}
function string(value, maximum, minimum = 0) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalid('模型请求文字长度无效');
  return value;
}
function endpoint(raw) {
  string(raw, 2000);
  if (!raw.trim()) return '';
  let url;
  try { url = new URL(raw.trim()); } catch { invalid('请输入 HTTPS 模型服务地址'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) invalid('模型服务仅支持不含凭据、查询参数的 HTTPS 地址');
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith('/chat/completions') ? pathname : pathname + '/chat/completions';
  return url.href;
}
function config(input, previous) {
  object(input, ['enabled', 'endpoint', 'model', 'apiKey', 'clearKey'], ['enabled', 'endpoint', 'model']);
  if (typeof input.enabled !== 'boolean' || input.clearKey !== undefined && typeof input.clearKey !== 'boolean') invalid('模型开关无效');
  const address = endpoint(input.endpoint), model = string(input.model, 200).trim();
  if (input.enabled && (!address || !model)) invalid('启用远程助手前请填写服务地址和模型');
  if (/[\r\n\u0000]/.test(model)) invalid('模型名称无效');
  let apiKey = previous?.endpoint === address ? previous.apiKey : '';
  if (input.clearKey) apiKey = '';
  if (input.apiKey !== undefined) {
    const supplied = string(input.apiKey, 4096).trim();
    if (supplied && !/^[\x21-\x7e]+$/.test(supplied)) invalid('API Key 不能包含空白或控制字符');
    if (supplied) apiKey = supplied;
  }
  return { enabled: input.enabled, endpoint: address, model, apiKey: apiKey || '', revision: randomUUID() };
}
function schema(value, depth = 0) {
  if (depth > 8) invalid('工具参数结构过深');
  object(value, ['type', 'description', 'properties', 'required', 'additionalProperties', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'items'], ['type']);
  if (!['object', 'string', 'number', 'integer', 'boolean', 'array'].includes(value.type)) invalid('工具参数类型无效');
  if (value.description !== undefined) string(value.description, 2000);
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length > 100 || value.enum.some(row => !['string', 'number', 'boolean'].includes(typeof row)))) invalid('工具枚举无效');
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) if (value[key] !== undefined && (!Number.isFinite(value[key]) || Math.abs(value[key]) > 1_000_000)) invalid('工具参数边界无效');
  if (value.uniqueItems !== undefined && typeof value.uniqueItems !== 'boolean') invalid('工具参数结构无效');
  if (value.type === 'object') {
    if (value.additionalProperties !== false) invalid('工具对象必须拒绝未知字段');
    object(value.properties || {}, Object.keys(value.properties || {}));
    if (Object.keys(value.properties || {}).length > 32) invalid('工具字段过多');
    for (const [key, child] of Object.entries(value.properties || {})) { if (!NAME.test(key)) invalid('工具字段名无效'); schema(child, depth + 1); }
    if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some(key => !Object.hasOwn(value.properties || {}, key)))) invalid('工具必填字段无效');
  }
  if (value.type === 'array') { if (!value.items) invalid('工具数组缺少元素结构'); schema(value.items, depth + 1); }
}
function tools(value) {
  if (!Array.isArray(value) || value.length > 32) invalid('工具数量无效');
  const seen = new Set();
  for (const item of value) {
    object(item, ['type', 'function'], ['type', 'function']);
    object(item.function, ['name', 'description', 'parameters'], ['name', 'description', 'parameters']);
    if (item.type !== 'function' || !NAME.test(item.function.name) || seen.has(item.function.name)) invalid('工具名称无效或重复');
    seen.add(item.function.name); string(item.function.description, 4000); schema(item.function.parameters);
    if (item.function.parameters.type !== 'object') invalid('工具参数必须为对象');
  }
  return value;
}
function messages(value) {
  if (!Array.isArray(value) || !value.length || value.length > 32) invalid('对话消息数量无效');
  const pending = new Set();
  for (const item of value) {
    object(item, ['role', 'content', 'tool_calls', 'tool_call_id'], ['role', 'content']);
    if (!['system', 'user', 'assistant', 'tool'].includes(item.role)) invalid('对话角色无效');
    if (item.content !== null) string(item.content, item.role === 'user' ? 4000 : 24000);
    if (item.role !== 'assistant' && item.tool_calls !== undefined || item.role !== 'tool' && item.tool_call_id !== undefined) invalid('对话工具字段无效');
    if (item.role === 'tool') {
      if (!pending.delete(item.tool_call_id)) invalid('工具结果没有对应调用');
    } else if (pending.size) invalid('上一轮工具结果尚未齐全');
    if (item.tool_calls !== undefined) {
      if (!Array.isArray(item.tool_calls) || item.tool_calls.length > 4) invalid('单轮工具调用过多');
      for (const call of item.tool_calls) {
        object(call, ['id', 'type', 'function'], ['id', 'type', 'function']);
        object(call.function, ['name', 'arguments'], ['name', 'arguments']);
        if (!NAME.test(call.id) || !NAME.test(call.function.name) || call.type !== 'function' || pending.has(call.id)) invalid('工具调用无效');
        string(call.function.arguments, 12000); pending.add(call.id);
      }
    }
  }
  if (pending.size) invalid('工具结果尚未齐全');
  return value;
}
function request(value) {
  object(value, ['requestId', 'revision', 'messages', 'tools'], ['requestId', 'revision', 'messages', 'tools']);
  if (!REQUEST_ID.test(value.requestId)) invalid('模型请求编号无效');
  string(value.revision, 100, 1);
  messages(value.messages); tools(value.tools);
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_REQUEST_BYTES) invalid('对话过长，请开始新对话');
  return value;
}
function response(raw, availableNames, secret = '') {
  object(raw, Object.keys(raw || {}));
  const choice = raw.choices?.[0], message = choice?.message;
  if (!message || typeof message !== 'object' || !['stop', 'tool_calls', null, undefined].includes(choice.finish_reason)) throw new ModelError('protocol', '模型回复未完整完成，未执行功能');
  if (message.refusal) throw new ModelError('refused', '模型拒绝处理这条请求');
  if (message.content !== null && message.content !== undefined && typeof message.content !== 'string') throw new ModelError('protocol', '模型未返回支持的文字回复');
  const calls = message.tool_calls || [];
  if (!Array.isArray(calls) || calls.length > 4) throw new ModelError('protocol', '模型返回的工具调用数量无效');
  const ids = new Set();
  const toolCalls = calls.map(call => {
    if (!call || call.type !== 'function' || !NAME.test(call.id) || ids.has(call.id) || !call.function || !availableNames.has(call.function.name) || typeof call.function.arguments !== 'string' || call.function.arguments.length > 12000) throw new ModelError('protocol', '模型返回了无效或未提供的功能调用');
    ids.add(call.id);
    return { id: call.id, name: call.function.name, arguments: call.function.arguments };
  });
  const value = { content: message.content || '', toolCalls };
  if (!value.content && !toolCalls.length) throw new ModelError('protocol', '模型没有返回文字或功能调用');
  if (!secret) return value;
  const redact = text => text.split(secret).join('[凭据已隐藏]').split(JSON.stringify(secret).slice(1, -1)).join('[凭据已隐藏]');
  return { content: redact(value.content), toolCalls: value.toolCalls.map(call => ({ ...call, arguments: redact(call.arguments) })) };
}
module.exports = { MAX_RESPONSE_BYTES, MAX_REQUEST_BYTES, MODEL_TIMEOUT_MS, ModelError, object, string, endpoint, config, request, response, REQUEST_ID };
