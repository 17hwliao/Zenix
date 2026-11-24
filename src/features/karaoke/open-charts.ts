const revision = 'c9246c799050acec96a03183df4b85493d283d51';
const repository = 'UltraStar-Deluxe/songs';

export const openCharts = [
  {title:'Code Monkey',artist:'Jonathan Coulton',sha:'4df932959bdec1b7b92c4c9477516f5fbcda91bc',bytes:7850},
  {title:'Better',artist:'Jonathan Coulton',sha:'b8e5a68359781ccd4f3f1a419efca58b626287ea',bytes:6988},
  {title:'Northern Star',artist:'Steven Dunston',sha:'c42d103645f25ae96fdbb61b29788cef542fb862',bytes:4280},
] as const;
export type OpenChart = typeof openCharts[number];
const folder = (row: OpenChart) => `Creative%20Commons/${encodeURIComponent(`${row.artist} - ${row.title}`)}`;
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');

export function findOpenCharts(query: string) {
  const terms = query.normalize('NFKC').trim().split(/\s+/u).map(normalize).filter(Boolean);
  return openCharts.filter(item => terms.every(term => normalize(`${item.title} ${item.artist}`).includes(term)));
}

export function matchesOpenChart(chart: OpenChart, title: string, artist: string) {
  return normalize(chart.title) === normalize(title) && normalize(chart.artist) === normalize(artist);
}

export function chartLicense(chart: OpenChart) {
  return `https://github.com/${repository}/blob/${revision}/${folder(chart)}/license.txt`;
}

export async function fetchOpenChart(chart: OpenChart, signal: AbortSignal): Promise<string> {
  if (!openCharts.includes(chart)) throw Error('这个曲谱不在开放目录内');
  const url = `https://raw.githubusercontent.com/${repository}/${revision}/${folder(chart)}/song.txt`;
  const response = await fetch(url,{signal,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer'});
  if (!response.ok || !response.body) throw Error(`曲谱下载失败（HTTP ${response.status}）`);
  const reader = response.body.getReader();
  const header = new TextEncoder().encode(`blob ${chart.bytes}\0`);
  const bytes = new Uint8Array(header.length+chart.bytes);
  bytes.set(header);
  let length = header.length;
  try {
    for (;;) {
      signal.throwIfAborted();
      const entry = await reader.read();
      if (entry.done) break;
      if (length+entry.value.length > bytes.length) throw Error('曲谱长度与发布记录不符');
      bytes.set(entry.value,length);length+=entry.value.length;
    }
    if (length !== bytes.length) throw Error('曲谱下载不完整');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-1',bytes)); // Git blob object ID of the pinned file.
    if (Array.from(hash, byte => byte.toString(16).padStart(2,'0')).join('') !== chart.sha) throw Error('曲谱校验未通过');
    signal.throwIfAborted();
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(header.length));
  } finally {void reader.cancel().catch(() => {});reader.releaseLock();}
}
