export type SourceBundleEntry = { name: string; url: string; script?: string; sha256?: string };
export type SourceBundle = { format: 'zenix-source-bundle'; schemaVersion: 1; name: string; sources: SourceBundleEntry[] };
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

export function parseSourceBundle(text: string): SourceBundle {
  if (new TextEncoder().encode(text).length > MAX_BUNDLE_BYTES) throw new Error('分享源包不能超过 8 MiB');
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('无法读取分享源包，请选择 .zenixsources 文件'); }
  const value = raw as Partial<SourceBundle> | null;
  if (!value || value.format !== 'zenix-source-bundle' || value.schemaVersion !== 1 || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 24) throw new Error('分享源包格式无效，支持 1–24 个音乐源');
  const seen = new Set<string>();
  const sources = value.sources.map(entry => {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 120 || typeof entry.url !== 'string' || entry.url.length > 2000) throw new Error('音乐源名称或地址无效');
    let address: URL;
    try { address = new URL(entry.url); } catch { throw new Error(`${entry.name}的地址无效`); }
    if (address.protocol !== 'https:' || address.username || address.password) throw new Error('音乐源地址需要不含账号密码的 HTTPS 链接');
    if (seen.has(address.href)) throw new Error('分享源包包含重复地址');
    seen.add(address.href);
    if (entry.script !== undefined && (typeof entry.script !== 'string' || !entry.script.trim() || new TextEncoder().encode(entry.script).length > 512 * 1024 || !/^[a-f0-9]{64}$/i.test(entry.sha256 || ''))) throw new Error(`${entry.name}的脚本或校验值无效`);
    return { name: entry.name.trim(), url: address.href, ...(entry.script !== undefined ? { script: entry.script, sha256: entry.sha256 } : {}) };
  });
  return { format: 'zenix-source-bundle', schemaVersion: 1, name: typeof value.name === 'string' ? value.name.slice(0, 120) : '音乐源分享包', sources };
}

export async function verifySourceEntry(entry: SourceBundleEntry) {
  if (entry.script === undefined) return;
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持脚本校验，请升级客户端');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entry.script));
  const hash = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== entry.sha256?.toLowerCase()) throw new Error('脚本校验失败，请重新获取分享源包');
}
