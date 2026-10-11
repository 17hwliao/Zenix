const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { LIMIT, safeReason, summarize } = require('../../src/core/sourceDiagnostics.cjs');
class SourceDiagnostics {
  constructor(folder) { this.file = path.join(folder, 'playback-diagnostics.json'); this.rows = Object.create(null); this.smooth = false; this.pending = Promise.resolve(); }
  async load() {
    try {
      const stat = await fs.stat(this.file); if (stat.size > 2 * 1024 * 1024) return;
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')); this.smooth = data.smooth === true;
      for (const [id, rows] of Object.entries(data.rows || {}).slice(0, 80)) if (Array.isArray(rows)) {
        this.rows[id] = rows.filter(row => row && typeof row.id === 'string' && row.id.length <= 80 && Number.isFinite(row.at) && Number.isFinite(row.ms) && row.at > Date.now() - 7 * 86400000)
          .slice(-LIMIT).map(row => ({ id: row.id, at: row.at, ms: Math.max(0, Math.min(600000, row.ms)), resolved: row.resolved === true, played: row.played === true, reason: row.reason ? safeReason(row.reason) : '' }));
      }
    } catch {}
  }
  save() { const text = JSON.stringify({ smooth: this.smooth, rows: this.rows }); this.pending = this.pending.catch(() => {}).then(async () => { const temp = this.file + '.tmp'; await fs.writeFile(temp, text); await fs.rename(temp, this.file); }).catch(() => {}); }
  record(provider, started, error) { if (error && /cancel|abort/i.test(String(error))) return ''; if (!this.rows[provider] && Object.keys(this.rows).length >= 80) delete this.rows[Object.keys(this.rows)[0]]; const id = randomUUID(); const rows = (this.rows[provider] ||= []); rows.push({ id, at: Date.now(), ms: Math.max(0, Date.now() - started), resolved: !error, played: false, reason: error ? safeReason(error) : '' }); this.rows[provider] = summarize(rows).events; this.save(); return id; }
  outcome(id, played, reason) { for (const rows of Object.values(this.rows)) { const row = rows.find(item => item.id === id); if (row && row.resolved) { if ((played === true && row.played) || (played !== true && !reason)) break; if (played === true) row.played = true; if (reason) row.reason = safeReason(reason); this.save(); break; } } }
  state() { return { smooth: this.smooth, sources: Object.fromEntries(Object.entries(this.rows).map(([id, rows]) => { const { events, ...stats } = summarize(rows); return [id, stats]; })) }; }
  configure(smooth) { this.smooth = smooth === true; this.save(); return this.state(); }
}
module.exports = { SourceDiagnostics };
