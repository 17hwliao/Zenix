const LIMIT = 80;
function safeReason(value) {
  const text = String(value?.message || value || '');
  if (/cancel|abort|取消/i.test(text)) return '已取消';
  if (/timeout|timed out|超时/i.test(text)) return '连接超时';
  if (/unsupported|format|codec|不支持|格式/i.test(text)) return '音频或品质不受支持';
  if (/401|403|权限|禁止/i.test(text)) return '资源拒绝访问';
  if (/ECONN|ENOTFOUND|DNS|network|网络|连接/i.test(text)) return '网络连接失败';
  return '资源暂不可用';
}
function redact(value) {
  return String(value || '').replace(/(?:https?:\/\/|yzqxy:\/\/|content:\/\/|file:\/\/)[^\s，。]+/gi, '[资源链接]')
    .replace(/\b(?:authorization|cookie)\s*[:=]\s*[^\r\n]+/gi, '[敏感信息]')
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9+/_.=-]+/gi, '[敏感信息]')
    .replace(/\b(?:authorization|cookie|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[敏感信息]')
    .replace(/[A-Z]:[\\/][^\s，。]+/gi, '[本地路径]').slice(0, 500);
}
function summarize(events, now = Date.now()) {
  const rows = events.filter(row => row.at > now - 7 * 86400000).slice(-LIMIT);
  const resolved = rows.filter(row => row.resolved);
  const failures = rows.filter(row => row.reason);
  return { attempts: rows.length, resolved: resolved.length, played: rows.filter(row => row.played).length,
    averageMs: rows.length ? Math.round(rows.reduce((n, row) => n + row.ms, 0) / rows.length) : 0,
    lastPlayedAt: Math.max(0, ...rows.filter(row => row.played).map(row => row.at)),
    lastFailure: failures.at(-1)?.reason || '', events: rows };
}
const api = { LIMIT, safeReason, redact, summarize };

if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.zenixSourceDiagnostics = api;
