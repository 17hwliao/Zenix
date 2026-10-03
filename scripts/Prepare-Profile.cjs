const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const label=process.argv[2]||'baseline';if(!/^[a-z0-9-]+$/i.test(label))throw Error('Invalid label');
const folder=path.resolve(__dirname,'../release/profiles',label),userData=path.join(folder,'user-data');
for(const name of ['covers','appearance','media'])fs.mkdirSync(path.join(userData,name),{recursive:true});
const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
function png(index, size = 1024) {
  const chunk = (kind, data) => { const type = Buffer.from(kind), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); type.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc(Buffer.concat([type, data])), data.length + 8); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const p = y * (size * 3 + 1) + 1 + x * 3; pixels[p] = (x + index * 13) % 256; pixels[p + 1] = (y + index * 7) % 256; pixels[p + 2] = (x / 4 + y / 4 + index * 3) % 256; }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const wav = Buffer.alloc(44 + 8000 * 2 * 90); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const media = path.join(userData, 'media', 'fixture.wav'); fs.writeFileSync(media, wav);
const records = Array.from({ length: 120 }, (_, index) => {
  const audioPath = path.join(userData, 'media', `fixture-${index}.wav`); if (!fs.existsSync(audioPath)) fs.linkSync(media, audioPath);
  const id = crypto.createHash('sha256').update(`fixture:${index}`).digest('hex'), cover = path.join(userData, 'covers', `${id}.png`);
  if (!fs.existsSync(cover)) fs.writeFileSync(cover, png(index));
  return { id, path: path.join(userData, 'media', `fixture-${index}.wav`), title: `Fixture ${String(index).padStart(3, '0')}`, artist: 'Zenix Generated Test', album: 'Regression', duration: 90, source: 'local', audioUrl: `yzqxy://audio/${id}`, coverUrl: `yzqxy://cover/${id}.png`, coverPath: cover, embeddedLyrics: '[00:00.00]起始歌词\n[00:01.00]You are my only one\n[00:04.00]中文与 English 混合\n[00:10.00]下一句\n[00:20.00]末句' };
});
fs.writeFileSync(path.join(userData, 'library.json'), JSON.stringify({ version: 1, records, roots: [], looseFiles: [], playlists: [] }));
fs.writeFileSync(path.join(userData, 'personal-library.json'), JSON.stringify({ liked: records.slice(0, 5), favorites: records.slice(5, 10), history: records.map((track, i) => ({ id: String(i), track, playedAt: Date.now() - i })), playlists: [] }));
fs.writeFileSync(path.join(userData, 'appearance', 'settings.json'), JSON.stringify({ completed: true, background: null }));
console.log('Prepared generated fixtures: '+folder);
