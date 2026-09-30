const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { AUDIO_EXTENSIONS } = require('../library.cjs');

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.aac': 'audio/aac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
  }[extension] || 'application/octet-stream';
}

async function serveFile(filePath, request, contentType) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': contentType || mimeType(filePath),
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': contentType || AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
      ? 'no-store'
      : 'private, max-age=31536000, immutable',
  });
  if (stat.size === 0) {
    headers.set('Content-Length', '0');
    return request.headers.has('range')
      ? new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */0' } })
      : new Response(null, { status: 200, headers });
  }
  const range = request.headers.get('range');
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    if (match[1] === '' && match[2] !== '') {
      start = Math.max(0, stat.size - Number(match[2]));
    } else {
      start = Number(match[1] || 0);
      end = match[2] ? Math.min(end, Number(match[2])) : end;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  }
  headers.set('Content-Length', String(Math.max(0, end - start + 1)));
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream), { status, headers });
}

function registerMediaProtocol({ protocol, sourceManager, downloadManager, audioCache, library, appearance }) {
  protocol.handle('yzqxy', async (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'stream') return sourceManager.stream(request, url.pathname.slice(1));
    if (url.hostname === 'offline') {
      const filePath = await downloadManager.offlinePath(decodeURIComponent(url.pathname.slice(1)));
      return filePath ? serveFile(filePath, request) : new Response('Not found', { status: 404 });
    }
    if (url.hostname === 'cached-audio') {
      const cached = await audioCache.byKey(url.pathname.slice(1));
      return cached ? serveFile(cached.path, request, cached.contentType) : new Response('Not found', { status: 404 });
    }
    if (url.hostname === 'source-cover') {
      const parts = url.pathname.split('/').slice(1);
      if (parts.length !== 2) return new Response('Not found', { status: 404 });
      return sourceManager.cover(request, decodeURIComponent(parts[0]), decodeURIComponent(parts[1]));
    }
    let filePath = null;
    if (url.hostname === 'audio') filePath = library.getAudioPath(url.pathname.slice(1));
    else if (url.hostname === 'cover') filePath = library.getCoverPath(url.pathname.slice(1));
    else if (url.hostname === 'background') filePath = appearance.backgroundPath(decodeURIComponent(url.pathname.slice(1)));
    if (!filePath) return new Response('Not found', { status: 404 });
    return serveFile(filePath, request);
  });
}

module.exports = { registerMediaProtocol };
