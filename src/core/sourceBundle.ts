export type SourceBundleEntry = { name: string; url: string; script?: string; sha256?: string; local?: boolean };
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
    if (entry.script !== undefined && (typeof entry.script !== 'string' || !entry.script.trim() || new TextEncoder().encode(entry.script).length > 512 * 1024 || !/^[a-f0-9]{64}$/i.test(entry.sha256 || ''))) throw new Error(`${entry.name}的脚本或校验值无效`);
    if (entry.local === true) {
      if (entry.script === undefined || entry.url !== `local:${entry.sha256?.toLowerCase()}`) throw new Error('本地分享条目必须包含完整脚本与匹配的校验标识');
      if (seen.has(entry.url)) throw new Error('分享源包包含重复文件'); seen.add(entry.url);
      return { name: entry.name.trim(), url: entry.url, script: entry.script, sha256: entry.sha256, local: true };
    }
    let address: URL;
    try { address = new URL(entry.url); } catch { throw new Error(`${entry.name}的地址无效`); }
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) throw new Error('音乐源地址需要不含账号密码的 HTTP / HTTPS 链接');
    if (seen.has(address.href)) throw new Error('分享源包包含重复地址');
    seen.add(address.href);
    return { name: entry.name.trim(), url: address.href, ...(entry.script !== undefined ? { script: entry.script, sha256: entry.sha256 } : {}) };
  });
  return { format: 'zenix-source-bundle', schemaVersion: 1, name: typeof value.name === 'string' ? value.name.slice(0, 120) : '音乐源分享包', sources };
}

export async function verifySourceEntry(entry: SourceBundleEntry, digest?: (text: string) => Promise<string>) {
  if (entry.script === undefined) return;
  if (digest) {
    if ((await digest(entry.script)).toLowerCase() !== entry.sha256?.toLowerCase()) throw new Error('脚本校验失败，请重新获取分享源包');
    return;
  }
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持脚本校验，请升级客户端');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entry.script));
  const hash = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== entry.sha256?.toLowerCase()) throw new Error('脚本校验失败，请重新获取分享源包');
}

export function decodeSourceText(bytes: Uint8Array) {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
}

/** Read the distributable ZIP directly; inflate only a bounded source manifest. */
type BundleReadOptions = { name?: string; localScripts?: boolean; digest?: (text: string) => Promise<string> };

async function localEntry(bytes: Uint8Array, name: string, digest?: BundleReadOptions['digest']): Promise<SourceBundleEntry> {
  if (!bytes.length || bytes.length > 512 * 1024) throw new Error(`${name}为空或超过 512 KiB`);
  const script = decodeSourceText(bytes);
  let completeSource = false;
  try { const pack = JSON.parse(script); completeSource = Boolean(pack.manifest && typeof pack.script === 'string'); } catch { /* Compatibility scripts are JavaScript. */ }
  if (!completeSource && !/@name\s+|globalThis\s*(?:\.lx|\[\s*['"]lx['"]\s*\])|EVENT_NAMES\.inited/.test(script)) throw new Error(`${name}不是可识别的音乐源脚本或完整源文件`);
  const hash = digest ? await digest(script) : [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)))].map(value => value.toString(16).padStart(2, '0')).join('');
  return { name: name.split('/').pop() || '本地音乐源', url: `local:${hash}`, script, sha256: hash, local: true };
}

export async function readSourceBundleFile(bytes: Uint8Array, options: BundleReadOptions = {}): Promise<SourceBundle> {
  if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new Error('分享源包不能超过 8 MiB');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    const text = decodeSourceText(bytes);
    let raw: { format?: string; manifest?: unknown } | undefined;
    try { raw = JSON.parse(text); } catch { /* A local single script may not be JSON. */ }
    if (options.localScripts && raw?.format !== 'zenix-source-bundle' && (/\.(?:js|zenixsource)$/i.test(options.name || '') || raw?.manifest)) {
      const entry = await localEntry(bytes, options.name || '本地音乐源', options.digest);
      return { format: 'zenix-source-bundle', schemaVersion: 1, name: entry.name, sources: [entry] };
    }
    return parseSourceBundle(text);
  }
  const { unzipSync } = await import('fflate');
  const candidates: { name: string; size: number }[] = [];
  const scripts: { name: string; size: number }[] = [];
  unzipSync(bytes, { filter: file => {
    if (file.name.startsWith('__MACOSX/') || file.name.endsWith('/') || file.name.split('/').some(part => part === '..')) return false;
    if (/\.(?:zenixsources|json)$/i.test(file.name)) candidates.push({ name: file.name, size: file.originalSize });
    if (options.localScripts && /\.(?:js|zenixsource)$/i.test(file.name)) scripts.push({ name: file.name, size: file.originalSize });
    if (candidates.length > 24) throw new Error('压缩包中的源包数量过多');
    if (scripts.length > 24) throw new Error('脚本压缩包最多支持 24 个音乐源');
    return false;
  } });
  // Our share ZIP includes both the snapshot and links-only manifests. Prefer the snapshot.
  candidates.sort((a, b) => Number(/-Links\.zenixsources$/i.test(a.name)) - Number(/-Links\.zenixsources$/i.test(b.name)));
  const sourcesFromManifests: SourceBundleEntry[] = [];
  let manifestName = '';
  if (candidates.reduce((size, file) => size + file.size, 0) > MAX_BUNDLE_BYTES) throw new Error('ZIP 内源包清单解压后合计超过 8 MiB');
  for (const file of candidates) {
    if (!file.size || file.size > MAX_BUNDLE_BYTES) throw new Error('ZIP 内源包为空或解压后超过 8 MiB');
    const extracted = unzipSync(bytes, { filter: entry => entry.name === file.name && entry.originalSize === file.size });
    const text = decodeSourceText(extracted[file.name]);
    if (/\.json$/i.test(file.name)) {
      try { if (JSON.parse(text)?.format !== 'zenix-source-bundle') continue; } catch { continue; }
    }
    const bundle = parseSourceBundle(text);
    manifestName ||= bundle.name;
    for (const entry of bundle.sources) if (!sourcesFromManifests.some(source => source.url === entry.url)) sourcesFromManifests.push(entry);
    if (sourcesFromManifests.length > 24) throw new Error('合并后的源包最多支持 24 个音乐源');
  }
  if (sourcesFromManifests.length) return { format: 'zenix-source-bundle', schemaVersion: 1, name: manifestName, sources: sourcesFromManifests };
  if (scripts.length) {
    if (scripts.some(file => !file.size || file.size > 512 * 1024) || scripts.reduce((size, file) => size + file.size, 0) > MAX_BUNDLE_BYTES) throw new Error('ZIP 内脚本为空或超过大小限制');
    const names = new Set(scripts.map(file => file.name));
    const extracted = unzipSync(bytes, { filter: file => names.has(file.name) && file.originalSize <= 512 * 1024 });
    const sources: SourceBundleEntry[] = [];
    for (const file of scripts.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))) {
      const entry = await localEntry(extracted[file.name], file.name, options.digest);
      if (!sources.some(source => source.sha256 === entry.sha256)) sources.push(entry);
    }
    return { format: 'zenix-source-bundle', schemaVersion: 1, name: options.name || '本地脚本源包', sources };
  }
  throw new Error('ZIP 内没有可导入的源包清单或音乐源脚本');
}
