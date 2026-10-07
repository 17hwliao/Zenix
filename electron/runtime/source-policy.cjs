const HOST = /^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
function sourcePolicy(raw, fallback = { allowHttp: false, hosts: null }) {
  if (raw === undefined) return { ...fallback };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('音乐源网络权限无效');
  if (raw.allowHttp !== undefined && typeof raw.allowHttp !== 'boolean') throw new Error('HTTP 权限无效');
  const hosts = raw.hosts == null ? null : raw.hosts;
  if (hosts !== null && (!Array.isArray(hosts) || hosts.length > 30 || hosts.some(host => typeof host !== 'string' || host.length > 253 || !HOST.test(host) || host.includes('..')))) throw new Error('请填写至多 30 个域名，不包含路径或协议');
  return { allowHttp: raw.allowHttp ?? fallback.allowHttp, hosts: hosts === null ? null : [...new Set(hosts.map(host => host.toLowerCase()))] };
}
function policyOptions(record) { const policy = sourcePolicy(record.networkPolicy); return { allowHttp: policy.allowHttp, allowedHosts: record.kind === 'lx' ? policy.hosts : undefined }; }
module.exports = { sourcePolicy, policyOptions };
