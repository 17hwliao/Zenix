import type {CSSProperties} from 'react';

export const THEME_SCHEMA = 1 as const;
export const DEFAULT_THEME_ID = 'vinyl-night';
export const BUILTIN_THEME_IDS = Object.freeze(['vinyl-night', 'cinema-curtain', 'cd-player', 'minimal-ivory']);

export type ThemeSource = 'builtin' | 'user';

export interface ThemeTokens {
  background: string;
  lyrics: string;
  activeLyrics: string;
  translation: string;
  controls: string;
  maxWidth: number;
  fontSize: number;
  lineHeight: number;
  activeScale: number;
  fadeDistance: number;
  motionMs: number;
  backgroundImage?: string;
  texture?: string;
}

export interface ThemePackage {
  schema: 1;
  id: string;
  name: string;
  author: string;
  version: string;
  preview: string;
  tokens: ThemeTokens;
  font?: {
    file: string;
    weight: number;
  };
}

export interface ThemeAssets {
  previewUrl?: string;
  backgroundUrl?: string;
  textureUrl?: string;
  fontUrl?: string;
}

export type ResolvedTheme = ThemePackage & {
  source: ThemeSource;
  assets?: ThemeAssets;
};

export interface LyricLineLike {
  text: string;
  time: number;
  translation?: string;
}

export interface WindowedLyric<T> {
  line: T;
  sourceIndex: number;
  distance: number;
}

const packageKeys = new Set(['schema', 'id', 'name', 'author', 'version', 'preview', 'tokens', 'font']);
const tokenKeys = new Set([
  'background', 'lyrics', 'activeLyrics', 'translation', 'controls', 'maxWidth',
  'fontSize', 'lineHeight', 'activeScale', 'fadeDistance', 'motionMs',
  'backgroundImage', 'texture',
]);
const fontKeys = new Set(['file', 'weight']);
const colorPattern = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const versionPattern = /^[0-9]{1,3}(?:\.[0-9]{1,3}){1,3}(?:-[a-z0-9.-]{1,32})?$/i;
const resourcePattern = /^(?:preview|background)\.(?:svg|png|jpe?g|webp)$|^texture\.(?:svg|png|jpe?g|webp)$|^fonts\/[a-z0-9][a-z0-9._-]{0,80}\.(?:woff2|woff|ttf|otf)$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw Error(`${label}包含未知字段：${unknown.slice(0, 3).join('、')}`);
}

function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string') throw Error(`${label}必须是文本`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw Error(`${label}长度无效`);
  return normalized;
}

function finite(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw Error(`${label}必须在 ${min}–${max} 之间`);
  }
  return value;
}

function color(value: unknown, label: string) {
  if (typeof value !== 'string' || !colorPattern.test(value)) throw Error(`${label}必须是安全的十六进制颜色`);
  return value;
}

function safeResource(value: unknown, label: string) {
  const path = text(value, label, 160);
  if (!resourcePattern.test(path) || path.includes('..') || path.startsWith('/') || path.includes('\\')) {
    throw Error(`${label}路径不在主题包白名单内`);
  }
  return path;
}

export function validateThemePackage(value: unknown, availableResources: ReadonlySet<string> = new Set()): ThemePackage {
  const root = record(value, '主题配置');
  exactKeys(root, packageKeys, '主题配置');
  if (root.schema !== THEME_SCHEMA) throw Error('主题配置版本不受支持');
  const id = text(root.id, '主题 ID', 64);
  if (!idPattern.test(id)) throw Error('主题 ID 只能使用小写字母、数字和连字符');
  if (BUILTIN_THEME_IDS.includes(id)) throw Error('本地主题不能覆盖内置主题');
  const version = text(root.version, '主题版本', 40);
  if (!versionPattern.test(version)) throw Error('主题版本格式无效');
  const preview = safeResource(root.preview, '预览图');
  const rawTokens = record(root.tokens, '主题视觉参数');
  exactKeys(rawTokens, tokenKeys, '主题视觉参数');

  const tokens: ThemeTokens = {
    background: color(rawTokens.background, '背景色'),
    lyrics: color(rawTokens.lyrics, '普通歌词颜色'),
    activeLyrics: color(rawTokens.activeLyrics, '当前歌词颜色'),
    translation: color(rawTokens.translation, '翻译颜色'),
    controls: color(rawTokens.controls, '控制颜色'),
    maxWidth: Math.round(finite(rawTokens.maxWidth, '最大宽度', 320, 1280)),
    fontSize: Math.round(finite(rawTokens.fontSize, '歌词字号', 18, 64)),
    lineHeight: finite(rawTokens.lineHeight, '歌词行距', 1.15, 2.4),
    activeScale: finite(rawTokens.activeScale, '当前句缩放', 1, 1.4),
    fadeDistance: Math.round(finite(rawTokens.fadeDistance, '淡出距离', 1, 3)),
    motionMs: Math.round(finite(rawTokens.motionMs, '动效时长', 0, 800)),
  };
  if (rawTokens.backgroundImage !== undefined) tokens.backgroundImage = safeResource(rawTokens.backgroundImage, '背景资源');
  if (rawTokens.texture !== undefined) tokens.texture = safeResource(rawTokens.texture, '纹理资源');

  let font: ThemePackage['font'];
  if (root.font !== undefined) {
    const rawFont = record(root.font, '字体配置');
    exactKeys(rawFont, fontKeys, '字体配置');
    font = {
      file: safeResource(rawFont.file, '字体文件'),
      weight: Math.round(finite(rawFont.weight, '字体字重', 300, 800)),
    };
  }

  const required = [preview, tokens.backgroundImage, tokens.texture, font?.file].filter((item): item is string => Boolean(item));
  for (const resource of required) {
    if (!availableResources.has(resource)) throw Error(`主题缺少资源：${resource}`);
  }

  return {
    schema: THEME_SCHEMA,
    id,
    name: text(root.name, '主题名称', 80),
    author: text(root.author, '作者', 80),
    version,
    preview,
    tokens,
    ...(font ? {font} : {}),
  };
}

export const builtinThemes: readonly ResolvedTheme[] = Object.freeze([
  {
    schema: 1,
    id: 'vinyl-night',
    name: '黑胶夜',
    author: 'Zenix',
    version: '1.0.0',
    preview: 'preview.svg',
    source: 'builtin',
    tokens: {
      background: '#080808',
      lyrics: '#aaa9a5',
      activeLyrics: '#f4f2ec',
      translation: '#777673',
      controls: '#deddd8',
      maxWidth: 760,
      fontSize: 34,
      lineHeight: 1.55,
      activeScale: 1.1,
      fadeDistance: 2,
      motionMs: 240,
    },
  },
  {
    schema: 1,
    id: 'cinema-curtain',
    name: '影院幕布',
    author: 'Zenix',
    version: '1.0.0',
    preview: 'preview.svg',
    source: 'builtin',
    tokens: {
      background: '#0b0808',
      lyrics: '#b7aaa4',
      activeLyrics: '#fff2df',
      translation: '#8b7a72',
      controls: '#e8d8c8',
      maxWidth: 820,
      fontSize: 36,
      lineHeight: 1.62,
      activeScale: 1.08,
      fadeDistance: 2,
      motionMs: 300,
    },
  },
  {
    schema: 1,
    id: 'cd-player',
    name: 'CD 机',
    author: 'Zenix',
    version: '1.0.0',
    preview: 'preview.svg',
    source: 'builtin',
    tokens: {
      background: '#0b0c0d',
      lyrics: '#a9adb0',
      activeLyrics: '#f4f6f7',
      translation: '#73797d',
      controls: '#d9e0e2',
      maxWidth: 780,
      fontSize: 32,
      lineHeight: 1.58,
      activeScale: 1.12,
      fadeDistance: 2,
      motionMs: 210,
    },
  },
  {
    schema: 1,
    id: 'minimal-ivory',
    name: '极简留白',
    author: 'Zenix',
    version: '1.0.0',
    preview: 'preview.svg',
    source: 'builtin',
    tokens: {
      background: '#f2f1ed',
      lyrics: '#77746d',
      activeLyrics: '#151514',
      translation: '#928e85',
      controls: '#1d1d1b',
      maxWidth: 720,
      fontSize: 34,
      lineHeight: 1.62,
      activeScale: 1.06,
      fadeDistance: 2,
      motionMs: 180,
    },
  },
]);

export function defaultTheme() {
  return builtinThemes.find(theme => theme.id === DEFAULT_THEME_ID) ?? builtinThemes[0];
}

export function themeVariables(theme: ResolvedTheme): CSSProperties & Record<`--zenix-${string}`, string> {
  const fontFamily = theme.font ? `ZenixTheme-${theme.id.replace(/[^a-z0-9-]/gi, '')}` : 'Inter, "Segoe UI", "Noto Sans SC", sans-serif';
  return {
    '--zenix-theme-bg': theme.tokens.background,
    '--zenix-theme-lyrics': theme.tokens.lyrics,
    '--zenix-theme-active': theme.tokens.activeLyrics,
    '--zenix-theme-translation': theme.tokens.translation,
    '--zenix-theme-controls': theme.tokens.controls,
    '--zenix-theme-max-width': `${theme.tokens.maxWidth}px`,
    '--zenix-theme-font-size': `${theme.tokens.fontSize}px`,
    '--zenix-theme-line-height': String(theme.tokens.lineHeight),
    '--zenix-theme-active-scale': String(theme.tokens.activeScale),
    '--zenix-theme-fade-distance': String(theme.tokens.fadeDistance),
    '--zenix-theme-motion': `${theme.tokens.motionMs}ms`,
    '--zenix-theme-font': fontFamily,
    '--zenix-theme-background-image': theme.assets?.backgroundUrl ? `url("${theme.assets.backgroundUrl}")` : 'none',
    '--zenix-theme-texture-image': theme.assets?.textureUrl ? `url("${theme.assets.textureUrl}")` : 'none',
  };
}

/** Returns at most five lines, keeping the active line at most two lines from either edge. */
export function lyricWindow<T extends LyricLineLike>(lines: readonly T[], active: number, fadeDistance = 2): WindowedLyric<T>[] {
  if (!lines.length) return [];
  const center = active >= 0 ? Math.min(lines.length - 1, active) : 0;
  const count = Math.max(1, Math.min(5, fadeDistance * 2 + 1));
  let start = Math.max(0, center - Math.floor(count / 2));
  const end = Math.min(lines.length, start + count);
  start = Math.max(0, end - count);
  return lines.slice(start, end).map((line, offset) => {
    const sourceIndex = start + offset;
    return {line, sourceIndex, distance: active < 0 ? sourceIndex + 1 : Math.abs(sourceIndex - active)};
  });
}

export function safeArchiveExtension(fileName: string) {
  return /\.zenuxtheme(?:\.zip)?$/i.test(fileName);
}

export function safeArchiveMime(type: string) {
  return !type || ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(type.toLowerCase());
}
