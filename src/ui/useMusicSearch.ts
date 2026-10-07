import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InstalledSource } from '../core/types';
import type { TrackView } from './types';
import { sourceRequest } from '../core/sourceDeadline';

type SearchPage = { items: TrackView[]; nextCursor: string | null; loading: boolean; error: string };
type SearchResults = { key: string; pages: Record<string, SearchPage> };

// Keep the search session in the shell: closing its controls preserves the wall
// and lets slower sources complete their current requests.
export function useMusicSearch(query: string, active: boolean, localTracks: TrackView[]) {
  const [sources, setSources] = useState<InstalledSource[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [sourcesError, setSourcesError] = useState('');
  const [selected, setSelected] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<SearchResults>({ key: '', pages: {} });
  const serial = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const keyword = query.trim();
  const enabled = useMemo(() => sources.filter(source => source.enabled && source.manifest.capabilities.includes('search')), [sources]);
  const enabledKey = enabled.map(source => `${source.id}:${source.manifest.version}`).join('|');
  const requestKey = `${enabledKey}\0${searchText}`;
  const currentResults = results.key === requestKey && searchText === keyword;
  const pages = currentResults ? results.pages : {};

  useEffect(() => {
    const bridge = window.yzqxy?.sources;
    if (!bridge) { setSourcesLoaded(true); return; }
    let alive = true;
    void bridge.list().then(value => { if (alive) { setSources(value); setSourcesError(''); } })
      .catch(reason => { if (alive) setSourcesError(String(reason)); })
      .finally(() => { if (alive) setSourcesLoaded(true); });
    const unsubscribe = bridge.onChanged(value => { if (alive) { setSources(value); setSourcesError(''); } });
    return () => { alive = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (selected !== 'all' && selected !== 'local' && !enabled.some(source => source.id === selected)) setSelected('all');
  }, [enabled, selected]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setSearchText(keyword), 300);
    return () => window.clearTimeout(timer);
  }, [active, keyword]);

  const submit = useCallback(() => setSearchText(keyword), [keyword]);

  useEffect(() => {
    if (!active || !sourcesLoaded) return;
    const token = ++serial.current;
    const controller = new AbortController(); searchAbort.current = controller;
    const initial = Object.fromEntries(enabled.map(source => [source.id, { items: [], nextCursor: null, loading: Boolean(searchText), error: '' }])) as Record<string, SearchPage>;
    setResults({ key: requestKey, pages: initial });
    if (searchText && window.yzqxy?.sources) for (const source of enabled) {
      void sourceRequest(id => window.yzqxy!.sources.search(source.id, searchText, null, 25, id), controller.signal).then(page => {
        if (serial.current !== token) return;
        setResults(previous => ({ ...previous, pages: { ...previous.pages, [source.id]: { items: page.items, nextCursor: page.nextCursor, loading: false, error: '' } } }));
      }).catch(reason => {
        if (serial.current !== token) return;
        setResults(previous => ({ ...previous, pages: { ...previous.pages, [source.id]: { items: [], nextCursor: null, loading: false, error: String(reason) } } }));
      });
    }
    return () => { serial.current++; controller.abort(); if (searchAbort.current === controller) searchAbort.current = null; };
  }, [active, sourcesLoaded, requestKey]);

  const localResults = useMemo(() => keyword ? localTracks.filter(track => `${track.title} ${track.artist} ${track.album ?? ''}`.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())).slice(0, 50) : [], [localTracks, keyword]);
  const selectedSources = enabled.filter(source => selected === 'all' || selected === source.id);
  const visibleTracks = useMemo(() => {
    if (!keyword) return [];
    const sourceTracks = selected === 'local' || !currentResults ? [] : enabled.filter(source => selected === 'all' || selected === source.id).flatMap(source => results.pages[source.id]?.items ?? []);
    const candidates = selected === 'all' || selected === 'local' ? [...sourceTracks, ...localResults] : sourceTracks;
    const seen = new Set<string>();
    return candidates.filter(track => { if (seen.has(track.id)) return false; seen.add(track.id); return true; });
  }, [keyword, selected, currentResults, enabled, results, localResults]);
  const playableTracks = useMemo(() => visibleTracks.filter(track => track.source !== 'custom' || enabled.some(source => source.id === track.providerId && source.manifest.capabilities.includes('resolvePlayback'))), [enabled, visibleTracks]);
  const loading = Boolean(active && keyword && selected !== 'local' && (!sourcesLoaded || searchText !== keyword || selectedSources.some(source => !pages[source.id] || pages[source.id].loading)));

  const loadMore = (source: InstalledSource) => {
    const old = pages[source.id];
    const signal = searchAbort.current?.signal;
    if (!old?.nextCursor || old.loading || !window.yzqxy?.sources || !signal || signal.aborted) return;
    const token = serial.current;
    setResults(previous => ({ ...previous, pages: { ...previous.pages, [source.id]: { ...previous.pages[source.id], loading: true } } }));
    void sourceRequest(id => window.yzqxy!.sources.search(source.id, searchText, old.nextCursor, 25, id), signal).then(page => {
      if (serial.current !== token) return;
      setResults(previous => {
        const current = previous.pages[source.id];
        const ids = new Set(current.items.map(track => track.id));
        return { ...previous, pages: { ...previous.pages, [source.id]: { items: [...current.items, ...page.items.filter(track => !ids.has(track.id))], nextCursor: page.nextCursor, loading: false, error: '' } } };
      });
    }).catch(reason => {
      if (serial.current !== token) return;
      setResults(previous => ({ ...previous, pages: { ...previous.pages, [source.id]: { ...previous.pages[source.id], loading: false, error: String(reason) } } }));
    });
  };

  return { enabled, selected, setSelected, pages, keyword, localResults, visibleTracks, playableTracks, loading, sourcesError, submit, loadMore };
}

export type MusicSearch = ReturnType<typeof useMusicSearch>;
