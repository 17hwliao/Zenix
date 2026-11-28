const {ModelError, MAX_RESPONSE_BYTES} = require('./assistant-model-protocol.cjs');

async function readModelStream(reader, {check, onDelta, secret = ''}) {
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const calls = new Map();
  let pending = '', eventLines = [], text = '', held = '', size = 0, finished = false, done = false;
  const emit = (value, final = false) => {
    held += value;
    if (secret) held = held.split(secret).join('[凭据已隐藏]');
    const end = final ? held.length : Math.max(0, held.length - secret.length);
    if (end) onDelta?.(held.slice(0, end));
    held = held.slice(end);
  };
  const dispatch = () => {
    const payload = eventLines.join('\n');
    eventLines = [];
    if (!payload) return;
    check();
    if (payload === '[DONE]') {done = true; return;}
    if (done) throw new ModelError('protocol', '流式回复结束后又返回了数据');
    let value;
    try {value = JSON.parse(payload);} catch {throw new ModelError('protocol', '流式回复数据损坏');}
    if (value.error) throw new ModelError('service', '模型流式回复中断');
    const choice = value.choices?.find(item => item.index === 0 || item.index === undefined);
    if (!choice) return;
    if (finished && (choice.delta?.content || choice.delta?.tool_calls)) throw new ModelError('protocol', '流式回复结束顺序无效');
    if (choice.delta?.refusal) throw new ModelError('refused', '模型拒绝处理这条请求');
    const delta = choice.delta || {};
    if (delta.content !== undefined && delta.content !== null) {
      if (typeof delta.content !== 'string') throw new ModelError('protocol', '流式文字格式无效');
      text += delta.content;
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new ModelError('oversize', '模型回复过大');
      emit(delta.content);
    }
    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > 4) throw new ModelError('protocol', '流式工具格式无效');
      for (const part of delta.tool_calls) {
        if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 4) throw new ModelError('protocol', '流式工具序号无效');
        const call = calls.get(part.index) || {id: '', type: 'function', function: {name: '', arguments: ''}};
        if (part.type !== undefined && part.type !== 'function') throw new ModelError('protocol', '流式工具类型无效');
        for (const [field, target] of [['id', call], ['name', call.function], ['arguments', call.function]]) {
          const fragment = field === 'id' ? part.id : part.function?.[field];
          if (fragment !== undefined) {
            if (typeof fragment !== 'string') throw new ModelError('protocol', '流式工具参数无效');
            target[field] += fragment;
            if (target[field].length > (field === 'arguments' ? 12000 : 64)) throw new ModelError('oversize', '流式工具参数超出限制');
          }
        }
        calls.set(part.index, call);
      }
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw new ModelError('protocol', '模型回复未完整完成，未执行功能');
      finished = true;
    }
  };
  const consume = chunk => {
    pending += chunk;
    if (pending.length > MAX_RESPONSE_BYTES) throw new ModelError('oversize', '流式消息行过大');
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (!line) dispatch();
      else if (line.startsWith('data:')) eventLines.push(line.slice(5).replace(/^ /, ''));
    }
  };
  try {
    for (;;) {
      const part = await reader.read();
      check();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new ModelError('oversize', '流式回复总量超出限制');
      consume(decoder.decode(part.value, {stream: true}));
      if (done) break;
    }
    consume(decoder.decode());
    if (pending) {consume('\n\n');}
    if (!done || !finished) throw new ModelError('protocol', '模型连接提前结束，已保留收到的文字，未执行半截工具调用');
    check();
    emit('', true);
    return {choices: [{finish_reason: calls.size ? 'tool_calls' : 'stop', message: {content: text, tool_calls: [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call)}}]};
  } finally {await reader.cancel().catch(() => {});}
}

module.exports = {readModelStream};
