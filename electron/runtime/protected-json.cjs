const { safeStorage } = require('electron');

const PROTECTION = 'zenix.safeStorage.v1';
async function encodeProtected(value, provider = safeStorage) {
  if (!await provider.isAsyncEncryptionAvailable()) throw new Error('系统加密服务不可用，未写入明文配置');
  const encrypted = await provider.encryptStringAsync(JSON.stringify(value));
  return JSON.stringify({ protection: PROTECTION, ciphertext: encrypted.toString('base64') });
}
async function decodeProtected(text, provider = safeStorage) {
  const envelope = JSON.parse(text);
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('配置格式无效');
  if (!Object.hasOwn(envelope, 'protection')) return { value: envelope, legacy: true };
  if (envelope.protection !== PROTECTION || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 32 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)) throw new Error('加密配置格式无效');
  if (!await provider.isAsyncEncryptionAvailable()) throw new Error('系统加密服务不可用，已保留原配置');
  const decoded = await provider.decryptStringAsync(Buffer.from(envelope.ciphertext, 'base64'));
  return { value: JSON.parse(decoded.result), legacy: false, rotate: decoded.shouldReEncrypt };
}
module.exports = { encodeProtected, decodeProtected };
