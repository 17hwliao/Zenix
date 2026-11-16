import {strFromU8, unzipSync} from 'fflate';
import {safeArchiveExtension, safeArchiveMime, validateThemePackage, type ThemePackage} from './model';

export const THEME_ARCHIVE_LIMIT = 12 * 1024 * 1024;
export const THEME_EXPANDED_LIMIT = 28 * 1024 * 1024;
export const THEME_ENTRY_LIMIT = 12 * 1024 * 1024;

interface ZipEntry {
  name: string;
  compressedSize: number;
  originalSize: number;
  compression: number;
  flags: number;
}

export interface ParsedThemeArchive {
  theme: ThemePackage;
  files: Record<string, Uint8Array>;
}

const uint16 = (value: Uint8Array, offset: number) => value[offset] | value[offset + 1] << 8;
const uint32 = (value: Uint8Array, offset: number) =>
  (value[offset] | value[offset + 1] << 8 | value[offset + 2] << 16 | value[offset + 3] << 24) >>> 0;

export function assertSafeSvg(data: Uint8Array, path: string) {
  let source: string;
  try {
    source = strFromU8(data);
  } catch {
    throw Error(`SVG 资源编码无效：${path}`);
  }
  if (source.includes('\0')) throw Error(`SVG 资源包含无效字符：${path}`);
  const unsafe = [
    /<\s*(?:script|foreignObject|iframe|object|embed|audio|video|canvas)\b/i,
    /\son[a-z][a-z0-9_-]*\s*=/i,
    /(?:javascript|vbscript)\s*:/i,
    /\b(?:href|xlink:href|src)\s*=\s*(["'])\s*(?:https?:|\/\/|file:|data:text\/html)/i,
    /url\s*\(\s*(["']?)\s*(?:https?:|\/\/|file:|javascript:|data:text\/html)/i,
    /<!\s*(?:DOCTYPE|ENTITY)\b/i,
  ];
  if (unsafe.some(pattern => pattern.test(source))) throw Error(`SVG 资源包含不安全的脚本或外部内容：${path}`);
}

function centralDirectory(data: Uint8Array): ZipEntry[] {
  if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw Error('主题文件不是有效的 ZIP 包');
  let end = -1;
  const first = Math.max(0, data.length - 65_557);
  for (let offset = data.length - 22; offset >= first; offset--) {
    if (uint32(data, offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw Error('主题包目录不完整');
  if (uint16(data, end + 4) !== 0 || uint16(data, end + 6) !== 0) throw Error('不支持分卷主题包');
  const count = uint16(data, end + 10);
  const directorySize = uint32(data, end + 12);
  const directoryOffset = uint32(data, end + 16);
  if (count > 32) throw Error('主题包文件数量过多');
  if (directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw Error('不支持过大的主题包');
  if (directoryOffset + directorySize > data.length) throw Error('主题包目录越界');

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = directoryOffset;
  const decoder = new TextDecoder('utf-8', {fatal: true});
  for (let index = 0; index < count; index++) {
    if (offset + 46 > data.length || uint32(data, offset) !== 0x02014b50) throw Error('主题包文件目录损坏');
    const flags = uint16(data, offset + 8);
    const compression = uint16(data, offset + 10);
    if (flags & 1) throw Error('主题包不能加密');
    if (![0, 8].includes(compression)) throw Error('主题包使用了不支持的压缩方式');
    const compressedSize = uint32(data, offset + 20);
    const originalSize = uint32(data, offset + 24);
    const nameLength = uint16(data, offset + 28);
    const extraLength = uint16(data, offset + 30);
    const commentLength = uint16(data, offset + 32);
    if (compressedSize === 0xffffffff || originalSize === 0xffffffff) throw Error('不支持过大的主题资源');
    const endOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (endOffset > data.length) throw Error('主题包文件目录越界');
    let name: string;
    try {
      name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      throw Error('主题包文件名编码无效');
    }
    if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) {
      throw Error('主题包包含不安全路径');
    }
    if (!name.endsWith('/') && names.has(name)) throw Error(`主题包包含重复文件：${name}`);
    names.add(name);
    entries.push({name, compressedSize, originalSize, compression, flags});
    offset = endOffset;
  }
  return entries;
}

export function parseThemeArchive(data: Uint8Array, file?: {name: string; type: string; size: number}): ParsedThemeArchive {
  if (file && file.size > THEME_ARCHIVE_LIMIT) throw Error('主题包不能超过 12 MiB');
  if (data.length > THEME_ARCHIVE_LIMIT) throw Error('主题包不能超过 12 MiB');
  if (file) {
    if (!safeArchiveExtension(file.name)) throw Error('请选择 .zenuxtheme 或 .zenuxtheme.zip 主题包');
    if (!safeArchiveMime(file.type)) throw Error('主题包 MIME 类型不受支持');
  }
  const entries = centralDirectory(data);
  let total = 0;
  const resources = new Set<string>();
  for (const entry of entries) {
    if (entry.name.endsWith('/')) throw Error('主题包不能包含目录项，请直接放置资源文件');
    const allowed = entry.name === 'theme.json'
      || /^(?:preview|background)\.(?:svg|png|jpe?g|webp)$/i.test(entry.name)
      || /^texture\.(?:svg|png|jpe?g|webp)$/i.test(entry.name)
      || /^fonts\/[a-z0-9][a-z0-9._-]{0,80}\.(?:woff2|woff|ttf|otf)$/i.test(entry.name);
    if (!allowed) throw Error(`主题包包含不支持的文件或脚本：${entry.name}`);
    if (entry.originalSize > THEME_ENTRY_LIMIT) throw Error(`主题资源过大：${entry.name}`);
    total += entry.originalSize;
    if (total > THEME_EXPANDED_LIMIT) throw Error('主题包展开后过大');
    resources.add(entry.name);
  }
  if (!resources.has('theme.json')) throw Error('主题包缺少 theme.json');
  const files = unzipSync(data, {
    filter: entry => {
      if (!resources.has(entry.name)) return false;
      if (entry.originalSize > THEME_ENTRY_LIMIT) {
        throw Error('主题资源展开后过大');
      }
      return true;
    },
  });
  let expanded = 0;
  for (const resource of resources) {
    if (!files[resource]) throw Error(`无法读取主题资源：${resource}`);
    expanded += files[resource].length;
    if (files[resource].length > THEME_ENTRY_LIMIT || expanded > THEME_EXPANDED_LIMIT) {
      throw Error('主题资源展开后过大');
    }
    if (resource.toLowerCase().endsWith('.svg')) assertSafeSvg(files[resource], resource);
  }
  const manifestBytes = files['theme.json'];
  if (!manifestBytes || manifestBytes.length > 65_536) throw Error('theme.json 过大');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw Error('theme.json 不是有效 JSON');
  }
  return {
    theme: validateThemePackage(raw, new Set(resources)),
    files,
  };
}

export function resourceMime(path: string) {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'woff2') return 'font/woff2';
  if (extension === 'woff') return 'font/woff';
  if (extension === 'ttf') return 'font/ttf';
  if (extension === 'otf') return 'font/otf';
  return 'application/octet-stream';
}
