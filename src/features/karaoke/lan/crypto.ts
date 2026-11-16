import { lanFailure, lanOk, type KaraokeLanResult } from './types';

function secureRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > 1024) {
    throw new RangeError('Invalid random byte length');
  }
  const bytes = new Uint8Array(length);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random source unavailable');
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let source = '';
  for (const byte of bytes) source += String.fromCharCode(byte);
  return btoa(source).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function randomEncoded(bytes: number, minimumBytes: number): KaraokeLanResult<string> {
  if (!Number.isInteger(bytes) || bytes < minimumBytes) {
    return lanFailure('INVALID_INPUT', '随机值字节数不足', false);
  }
  try {
    const token = base64Url(secureRandomBytes(bytes));
    return token.length >= Math.ceil((bytes * 4) / 3) - 2
      ? lanOk(token)
      : lanFailure('INVALID_INPUT', '随机 token 长度不足', false);
  } catch {
    return lanFailure('INVALID_INPUT', '当前环境缺少安全随机源', false);
  }
}

export function randomKaraokeLanToken(bytes = 32): KaraokeLanResult<string> {
  return randomEncoded(bytes, 16);
}

export function randomKaraokeLanId(prefix: string, bytes = 12): KaraokeLanResult<string> {
  const token = randomEncoded(bytes, 8);
  if (!token.ok) return token;
  return lanOk(`${prefix}-${token.value}`);
}
