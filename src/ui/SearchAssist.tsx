import { useMemo, useState } from 'react';
import type { Track } from '../core/types';
import { rememberSearch, searchHistory, suggestedSearches, writeLocal } from '../core/listening';
import './ListeningTools.css';
export default function SearchAssist({keyword, tracks, choose}: { keyword: string; tracks: Pick<Track, 'title' | 'artist' | 'album'>[]; choose: (value: string) => void }) {
  const [revision, setRevision] = useState(0);
  const suggestions = useMemo(() => suggestedSearches(keyword, tracks), [keyword, tracks, revision]);
  return <section className="listening-search-assist" aria-label={keyword ? '输入建议' : '搜索历史'}><div><strong>{keyword ? '输入建议' : '最近搜索'}</strong>{!keyword && searchHistory().length > 0 && <button type="button" onClick={() => { writeLocal('zenix.searchHistory', []); setRevision(value => value + 1); }}>清空记录</button>}</div>
    <div>{suggestions.map(value => <button type="button" key={value} onClick={() => { rememberSearch(value); choose(value); }}>{value}</button>)}</div>{!suggestions.length && <small>{keyword ? '继续输入歌名或歌手进行搜索' : '搜索过的关键词会保存在这里'}</small>}
  </section>;
}
