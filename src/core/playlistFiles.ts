import type { Track } from './types';
import { metadataTrack } from './playlistLinks';

export type ImportList = { name: string; tracks: Track[]; autoReplacement: boolean };
export type FilePlaylistPreview = { lists: ImportList[]; skipped: number; duplicates: number; warnings: string[] };
export type TextOrder = 'auto' | 'title-first' | 'artist-first';
const MAX_FILE = 2 * 1024 * 1024;
const text = (value: unknown, limit = 300) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

function preview(raw: { name: string; rows: unknown[] }[], convert: (row: any) => Track | null): FilePlaylistPreview {
  if (!raw.length || raw.length > 100 || raw.reduce((sum, list) => sum + list.rows.length, 0) > 5000) throw Error('一次最多导入 100 个歌单、5000 首歌曲，请拆分后导入');
  let skipped = 0, duplicates = 0, bytes = 0;
  const lists: ImportList[] = [];
  for (const list of raw) {
    const seen = new Set<string>(), tracks: Track[] = [];
    for (const row of list.rows) {
      let track: Track | null = null; try { track = convert(row); } catch {}
      if (!track) { skipped++; continue; }
      if (seen.has(track.id)) { duplicates++; continue; }
      seen.add(track.id); tracks.push(track);
      bytes += new TextEncoder().encode(JSON.stringify(track)).length + 1;
      if (bytes > MAX_FILE - 16384) throw Error('转换后的歌曲信息超过 2 MiB，请拆分歌单后导入');
    }
    if (tracks.length) lists.push({ name: text(list.name, 100) || '导入歌单', tracks, autoReplacement: true });
  }
  if (!lists.length) throw Error('未识别到有效歌名，请检查文件格式或修改文本识别顺序');
  return { lists, skipped, duplicates, warnings: [...(skipped ? [`${skipped} 项缺少有效歌名或格式无效，已跳过，请核对预览`] : []), ...(duplicates ? [`${duplicates} 首重复歌曲已合并`] : [])] };
}

function csv(line: string, delimiter: string): string[] {
  const result: string[] = []; let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (ch === delimiter && !quoted) { result.push(field.trim()); field = ''; }
    else field += ch;
  }
  if (quoted) return [];
  return [...result, field.trim()];
}
const titleLabel = /^(?:歌曲(?:名称|名)?|歌名|音乐名称|title|name|song)$/i;
const artistLabel = /^(?:歌手|作者|艺术家|artist|singer)$/i;
export function readTextPlaylist(input: string, order: TextOrder = 'auto'): FilePlaylistPreview {
  if (new TextEncoder().encode(input).length > MAX_FILE) throw Error('文本不能超过 2 MiB');
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > 5100) throw Error('文本行数过多，请拆分后导入');
  let headers: { delimiter: string; title: number; artist: number; album: number } | undefined;
  let firstRecord = true;
  const rows: { title: string; artist: string; album: string }[] = [];
  for (let line of lines) {
    if (line.length > 4096) { rows.push({ title: '', artist: '', album: '' }); continue; }
    line = line.replace(/^\s*(?:\d{1,5}(?:\.\s+|[、)）]\s*)|[-*•]\s+)/, '');
    if (/^(?:https?:\/\/|#|\/\/|共\s*\d+\s*首|歌单[：:])/.test(line)) continue;
    if (firstRecord) for (const delimiter of ['\t', ',']) {
      const fields = csv(line, delimiter), title = fields.findIndex(field => titleLabel.test(field));
      if (fields.length > 1 && title >= 0) { headers = { delimiter, title, artist: fields.findIndex(field => artistLabel.test(field)), album: fields.findIndex(field => /^(?:专辑|album)$/i.test(field)) }; break; }
    }
    if (firstRecord) { firstRecord = false; if (headers) continue; }
    if (headers) {
      const fields = csv(line, headers.delimiter);
      rows.push({ title: fields[headers.title] || '', artist: fields[headers.artist] || '', album: fields[headers.album] || '' }); continue;
    }
    const named = line.match(/^(?:歌名|歌曲(?:名称|名)?)[：:]\s*(.+?)(?:\s+(?:歌手|作者)[：:]\s*(.+))?$/);
    const bracketed = line.match(/^(.+?)\s*[《「](.+?)[》」]$/);
    let title = '', artist = '', album = '';
    if (named) { title = named[1]; artist = named[2] || ''; }
    else if (bracketed && !/^[《「]/.test(line)) { artist = bracketed[1]; title = bracketed[2]; }
    else {
      const fields = /\t/.test(line) ? csv(line, '\t') : /,/.test(line) && order !== 'auto' ? csv(line, ',') : line.split(/\s+[—–-]\s+|\s*[|｜]\s*|(?<=[\u3400-\u9fff])[-—–]|[-—–](?=[\u3400-\u9fff])/);
      if (fields.length === 1) title = fields[0].replace(/^[《「]|[》」]$/g, '');
      else { const reverse = order === 'artist-first'; title = fields[reverse ? 1 : 0]; artist = fields[reverse ? 0 : 1]; album = fields[2] || ''; }
    }
    rows.push({ title: title?.trim().replace(/^[《「](.+)[》」]$/, '$1') || '', artist, album });
  }
  const result = preview([{ name: '文本导入歌单', rows }], row => row.title?.trim() ? metadataTrack(row.title, row.artist, row.album) : null);
  if (order === 'auto') result.warnings.push('无表头的两列文本默认按“歌名 - 歌手”识别；顺序相反时请选择“歌手在前”并重新预览');
  return result;
}

export function readPlaylistFile(bytes: Uint8Array, filename: string, order: TextOrder = 'auto'): FilePlaylistPreview {
  if (!bytes.length || bytes.length > MAX_FILE) throw Error('请选择不超过 2 MiB 的文本文件');
  if (!/\.(txt|csv|tsv)$/i.test(filename)) throw Error('请选择 UTF-8 .txt／.csv／.tsv 文本歌单');
  let input: string;
  try { input = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw Error('文件不是 UTF-8 文本，请在文本编辑器中转换编码后再导入'); }
  return readTextPlaylist(input, order);
}
