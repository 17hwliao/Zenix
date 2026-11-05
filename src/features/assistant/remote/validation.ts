import type {JsonSchema, RemotePlatform, ToolName, ValidatedToolCall} from './contracts';
import {getToolDefinition} from './registry';

export class ToolValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ToolValidationError'; }
}
function reject(path: string, message: string): never { throw new ToolValidationError(`${path}：${message}`); }

function check(value: unknown, schema: JsonSchema, path: string): void {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) reject(path, '必须是对象');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) reject(path, '必须是普通对象');
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(schema.properties ?? {}, key)) reject(path, `未知字段 ${key}`);
      check(record[key], schema.properties![key], `${path}.${key}`);
    }
    for (const key of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(record, key)) reject(path, `缺少字段 ${key}`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) reject(path, '必须是数组');
    if (schema.minItems !== undefined && value.length < schema.minItems) reject(path, '数组项目过少');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) reject(path, '数组项目过多');
    if (schema.uniqueItems && new Set(value).size !== value.length) reject(path, '数组项目不能重复');
    value.forEach((item, index) => check(item, schema.items!, `${path}[${index}]`));
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') reject(path, '必须是文字');
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) reject(path, '文字不能为空');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) reject(path, '文字过长');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) reject(path, '不能包含控制字符');
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') reject(path, '必须是布尔值');
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) reject(path, '必须是有限数值');
    if (schema.type === 'integer' && !Number.isInteger(value)) reject(path, '必须是整数');
    if (schema.minimum !== undefined && value < schema.minimum) reject(path, '数值过小');
    if (schema.maximum !== undefined && value > schema.maximum) reject(path, '数值过大');
  }
  if (schema.enum && !schema.enum.includes(value as string | number | boolean)) reject(path, '取值不在允许范围内');
}

export function validateToolCall(name: string, raw: unknown, options: {platform: RemotePlatform; available?: ReadonlySet<ToolName>}): ValidatedToolCall {
  const definition = getToolDefinition(name);
  if (!definition || !definition.platforms.includes(options.platform) || options.available && !options.available.has(definition.name)) reject('tool', '当前设备没有提供这项能力');
  check(raw, definition.parameters, definition.name);
  const args = raw as Record<string, unknown>;
  const requireOnlyWith = (key: string, permitted: boolean) => {
    if (args[key] !== undefined && !permitted) reject(definition.name, `${key} 与当前操作不匹配`);
  };
  const requirePresent = (key: string, required: boolean) => {
    if (required && args[key] === undefined) reject(definition.name, `缺少字段 ${key}`);
  };
  if (definition.name === 'playback.control') {
    requirePresent('positionSeconds', args.action === 'seek');
    requireOnlyWith('positionSeconds', args.action === 'seek');
  }
  if (['playback.set_mode', 'lyrics.configure', 'network.set_policy'].includes(definition.name) && !Object.keys(args).length) reject(definition.name, '至少提供一个目标设置');
  if (definition.name === 'music.query') {
    requirePresent('trackRef', args.scope === 'reference');
    requireOnlyWith('trackRef', args.scope === 'reference');
    requireOnlyWith('from', args.scope === 'queue');
    requireOnlyWith('to', args.scope === 'queue');
    requireOnlyWith('count', args.scope === 'history');
    if (Number(args.from ?? 0) > Number(args.to ?? 0)) reject(definition.name, 'from 不能大于 to');
  }
  if (definition.name === 'timer.configure') {
    requirePresent('minutes', args.action === 'set');
    requireOnlyWith('minutes', args.action === 'set');
  }
  if (definition.name === 'roaming.configure') {
    requirePresent('keyword', args.action === 'temporary_branch');
    requirePresent('trackRef', args.action === 'reduce_track');
    requireOnlyWith('keyword', args.action === 'temporary_branch');
    requireOnlyWith('count', args.action === 'temporary_branch');
    requireOnlyWith('trackRef', args.action === 'reduce_track');
  }
  if (definition.name === 'device.transfer') {
    requirePresent('trackRef', args.kind === 'submission');
    requireOnlyWith('trackRef', args.kind === 'submission');
  }
  if (definition.name === 'backup.export_playlists') {
    requirePresent('playlistRefs', args.scope === 'selected');
    requireOnlyWith('playlistRefs', args.scope === 'selected');
  }
  return {name: definition.name, args: structuredClone(args)};
}

export function requiresConfirmation(call: ValidatedToolCall): boolean {
  const definition = getToolDefinition(call.name);
  if (!definition) throw new ToolValidationError('这项能力未注册');
  return definition.confirmation === 'always' || definition.confirmation === 'batch' && Array.isArray(call.args.trackRefs) && call.args.trackRefs.length > 1;
}
