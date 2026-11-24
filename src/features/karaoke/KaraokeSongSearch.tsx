import {useEffect, useRef, useState, type FormEvent} from 'react';
import type {InstalledSource, SourceSearchPage, Track} from '../../core/types';
import {sourceRequest} from '../../core/sourceDeadline';
import {command} from '../../mobile/native';
import {recordingIdentity} from '../recording';

interface SearchState {
  keyword: string;
  pending: number;
  failed: number;
  online: {track: Track; source: string}[];
}

export default function KaraokeSongSearch({id, mobile, tracks, sources, onSelect, initialKeyword = '', instrumentalMatch}: {
  id: string;
  mobile: boolean;
  tracks: readonly Track[];
  sources: readonly InstalledSource[];
  onSelect(track: Track): void;
  initialKeyword?: string;
  instrumentalMatch?: (track: Track) => boolean;
}) {
  const [input, setInput] = useState(initialKeyword);
  const [result, setResult] = useState<SearchState>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const enabled = sources.filter(source => source.enabled && source.manifest.capabilities.includes('search'));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keyword = input.trim();
    if (!keyword || (result?.keyword === keyword && result.pending)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const {signal} = controller;
    setResult({keyword, pending: enabled.length, failed: 0, online: []});
    for (const source of enabled) {
      void (async () => {
        try {
          const page = mobile
            ? await command<SourceSearchPage>('search', {id: source.id, keyword})
            : await sourceRequest(requestId => window.yzqxy!.sources.search(source.id, keyword, null, 25, requestId), signal);
          const matches = page.items.filter(track => track.availability !== 'unavailable' && (!instrumentalMatch || instrumentalMatch(track)))
            .map(track => ({track, source: source.manifest.name}));
          setResult(previous => signal.aborted || !previous ? previous : {
            ...previous, pending: previous.pending - 1, online: [...previous.online, ...matches],
          });
        } catch {
          setResult(previous => signal.aborted || !previous ? previous : {
            ...previous, pending: previous.pending - 1, failed: previous.failed + 1,
          });
        }
      })();
    }
  };

  const rows = new Map<string, {track: Track; source: string}>();
  if (result) {
    const terms = result.keyword.normalize('NFKC').toLocaleLowerCase().split(/\s+/u);
    for (const track of tracks) {
      const metadata = [track.title, track.artist, track.album].join(' ').normalize('NFKC').toLocaleLowerCase();
      if ((instrumentalMatch ? instrumentalMatch(track) : terms.every(term => metadata.includes(term)))) {
        rows.set(recordingIdentity(track), {track, source: track.source === 'local' ? '本地曲库' : '我的音乐'});
      }
    }
    for (const row of result.online) {
      const key = recordingIdentity(row.track);
      if (!rows.has(key)) rows.set(key, row);
    }
  }

  return (
    <section id={id} aria-label={instrumentalMatch ? '搜索伴奏音轨' : '搜索练唱歌曲'} className="zenix-karaoke-song-search">
      <form onSubmit={submit} onKeyDown={event => {
        if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
      }}>
        <input autoFocus aria-label="歌名或歌手" placeholder="输入歌名或歌手" type="search" enterKeyHint="search"
          maxLength={120} value={input} onChange={event => {
            request.current?.abort();
            setResult(undefined);
            setInput(event.target.value);
          }} />
        <button type="submit" disabled={!input.trim() || Boolean(result?.pending)}>{instrumentalMatch ? '查找伴奏' : '搜索'}</button>
      </form>
      {rows.size > 0 && (
        <ul aria-label="练唱歌曲搜索结果">
          {[...rows].map(([key, {track, source}]) => (
            <li key={key}>
              <button type="button" onClick={() => onSelect(track)}>
                <strong>{track.title}</strong>
                <small>{track.artist || '未知歌手'} · {source}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {result && (
        <div className="zenix-karaoke-search-status" role="status">
          {result.pending ? '正在搜索音乐源…'
            : result.failed ? (rows.size ? '部分音乐源搜索失败，可选择已有结果或重试。' : '音乐源搜索未完成，请重试。')
              : !rows.size ? (instrumentalMatch ? '没有找到明确标注的同名伴奏，可导入本地伴奏。' : enabled.length ? '没有找到匹配的歌曲。' : '本机没有匹配歌曲。启用音乐源后可搜索在线歌曲。')
                : null}
        </div>
      )}
    </section>
  );
}
