const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function dateKey(now) { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function songKey(track) { return crypto.createHash('sha256').update(`${track.title}\0${track.artist}`.normalize('NFKC').toLowerCase()).digest('hex').slice(0, 24); }
function summary(data, from, to) {
  const days = Object.values(data.days).filter(day => day.date >= from && day.date <= to).sort((a,b) => a.date.localeCompare(b.date));
  const songs = new Map(), artists = new Map(); let seconds = 0, plays = 0;
  for (const day of days) { seconds += day.seconds; plays += day.plays; for (const [id, value] of Object.entries(day.tracks)) {
    const meta = data.tracks[id]; if (!meta) continue;
    const song = songs.get(id) || { ...meta, seconds: 0, plays: 0 }; song.seconds += value.seconds; song.plays += value.plays; songs.set(id, song);
    const artist = artists.get(meta.artist || '未知歌手') || { name: meta.artist || '未知歌手', seconds: 0, plays: 0 }; artist.seconds += value.seconds; artist.plays += value.plays; artists.set(artist.name, artist);
  } }
  return { startedAt: data.startedAt, from, to, seconds, plays, uniqueTracks: songs.size, activeDays: days.filter(day=>day.seconds>0).length, topTracks: [...songs.values()].sort((a,b)=>b.seconds-a.seconds).slice(0,10), topArtists: [...artists.values()].sort((a,b)=>b.seconds-a.seconds).slice(0,10), days: days.map(day=>({date:day.date,seconds:day.seconds,plays:day.plays})) };
}
class ListeningStore {
  constructor(folder) { this.file = path.join(folder, 'listening-stats.json'); this.data = { startedAt: Date.now(), days: {}, tracks: {} }; this.pending = Promise.resolve(); this.failure = ''; }
  async load() { try { const value = JSON.parse(await fs.readFile(this.file, 'utf8')); if (!value.days || !value.tracks || !Number.isFinite(value.startedAt)) throw Error('格式无效'); this.data = value; } catch(e) { if (e.code !== 'ENOENT') this.failure = '听歌统计文件无法读取，已保留原文件'; } }
  async record(track, seconds, plays, now = Date.now()) {
    if (this.failure) throw Error(this.failure);
    if (!track || typeof track.title !== 'string' || typeof track.artist !== 'string' || !Number.isFinite(seconds) || seconds < 0 || seconds > 20 || ![0,1].includes(plays)) throw Error('聆听记录无效');
    this.pending = this.pending.catch(()=>{}).then(async () => {
      const id = songKey(track), date = dateKey(now), data = structuredClone(this.data);
      const day = data.days[date] ||= { date, seconds: 0, plays: 0, tracks: {} };
      if (!data.tracks[id] && Object.keys(data.tracks).length >= 5000) throw Error('统计歌曲达到上限，请导出回忆后清理旧统计');
      data.tracks[id] = { title: track.title.slice(0,300), artist: track.artist.slice(0,300) };
      const item = day.tracks[id] ||= { seconds: 0, plays: 0 }; item.seconds += seconds; item.plays += plays; day.seconds += seconds; day.plays += plays;
      const cutoffDate=new Date(now);cutoffDate.setDate(cutoffDate.getDate()-365);const cutoff = dateKey(cutoffDate); for (const key of Object.keys(data.days)) if (key < cutoff) delete data.days[key];
      const active = new Set(Object.values(data.days).flatMap(day=>Object.keys(day.tracks))); for (const key of Object.keys(data.tracks)) if (!active.has(key)) delete data.tracks[key];
      const encoded=JSON.stringify(data);if(Buffer.byteLength(encoded)>20*1024*1024)throw Error('统计存储已满，已保留原记录');
      const temporary = `${this.file}.tmp`; await fs.writeFile(temporary, encoded); await fs.rename(temporary, this.file); this.data = data;
    }); return this.pending;
  }
  async query(from, to) { await this.pending; if(this.failure)throw Error(this.failure); if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from>to) throw Error('统计时间范围无效'); return summary(this.data, from, to); }
}
module.exports = { ListeningStore, summary, dateKey };
