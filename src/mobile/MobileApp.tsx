import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Capacitor } from '@capacitor/core';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Captions, Check, Compass, Disc3, FolderOpen, Heart, Home, ImagePlus, ListMusic, LoaderCircle, Music2, Pause, Pencil, Play, Plus, Search, Settings2, SkipForward, Star, Trash2, X } from 'lucide-react';
import { version as appVersion } from '../../package.json';
import type { InstalledSource, SourcePreview, Track } from '../core/types';
import { command, initialSnapshot, isNativeMobile, isAndroid, mobilePlatform, supportsOverlay, observe, type MobileSearchPage, type MobileSnapshot, type MobileUpdate } from './native';
import { FullPlayer, Seek, Art, fileUrl } from './Player';
import OrbitCards from './OrbitCards';
import { usePlayerBarGesture } from '../ui/usePlayerBarGesture';
import { useMobileViewport } from './useMobileViewport';
import StickerSpace from './StickerSpace';
import './mobile.css';
import SourceBundleImport from '../ui/SourceBundleImport';
import SourceBundleExport from '../ui/SourceBundleExport';
import { SourceNetworkOptions, SourceNetworkEditor, DEFAULT_SOURCE_POLICY, type SourceNetworkPolicy } from '../ui/SourceNetworkOptions';
import UpdateSettings from '../ui/UpdateSettings';
import MobileSearchBar from './MobileSearchBar';
import { MusicToolsButton, type ToolInvoke } from '../ui/MusicTools';
import SwipeTrackRow from './SwipeTrackRow';
import SaveFeedback from './SaveFeedback';
import { useSongGesture } from './useSongGesture';
import { useGlassConfirm } from '../ui/useGlassConfirm';
import SearchResults from './SearchResults';

const mobileTool:ToolInvoke=args=>command('features',args);

const ZenixIntro = lazy(() => import('../ui/ZenixIntro'));

type Page = 'home' | 'space' | 'sources' | 'settings';
const pageOrder: Page[] = ['home', 'space', 'sources', 'settings'];
type Modal = 'profile' | 'add' | 'create' | 'lists' | 'welcome' | 'licenses' | 'queue' | 'songs' | 'songActions' | null;
export default function MobileApp() {
  const [state, setState] = useState<MobileSnapshot>(initialSnapshot);
  const [route, setRoute] = useState<{ page: Page; direction: number }>({ page: 'home', direction: 1 });
  const { page, direction } = route;
  const reducedMotion = useReducedMotion();
  const { confirm, dialog } = useGlassConfirm();
  function setPage(next: Page) { if (next !== page) window.scrollTo(0, 0); setRoute(previous => previous.page === next ? previous : { page: next, direction: pageOrder.indexOf(next) > pageOrder.indexOf(previous.page) ? 1 : -1 }); }
  // Opacity on the page keeps the fixed sticker camera anchored to the viewport.
  const pageVariants = {
    enter: { opacity: 0 },
    visible: { opacity: 1, pointerEvents: 'auto' as const, transition: { duration: reducedMotion ? 0 : .24, ease: [.22, 1, .36, 1] as const } },
    leave: { opacity: 0, pointerEvents: 'none' as const, transition: { duration: reducedMotion ? 0 : .16 } },
  };
  const panelTransition = { duration: reducedMotion ? 0 : .22, ease: [.22, 1, .36, 1] as const };
  const [wall, setWall] = useState<Track[]>([]), [label, setLabel] = useState('最近播放');
  const [searchOpen, setSearchOpen] = useState(false), [keyword, setKeyword] = useState(''), [sourceId, setSourceId] = useState('all');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [more, setMore] = useState<Record<string, string>>({});
  const [toast, setToast] = useState(''), [modal, setModal] = useState<Modal>(null), [adding, setAdding] = useState<Track>();
  const [name, setName] = useState(''), [bio, setBio] = useState(''), [email, setEmail] = useState(''), [editing, setEditing] = useState('');
  const [url, setUrl] = useState(''), [importing, setImporting] = useState(false), [preview, setPreview] = useState<SourcePreview>();
  const [permission, setPermission] = useState<SourceNetworkPolicy>(DEFAULT_SOURCE_POLICY);
  useEffect(() => setPermission(DEFAULT_SOURCE_POLICY), [preview?.token]);
  const [full, setFull] = useState(false), [focusRequest, setFocusRequest] = useState(0), [boot, setBoot] = useState(true);
  const [bootReady, setBootReady] = useState(!isNativeMobile);
  const finishBoot = useCallback(() => setBoot(false), []);
  const query = useRef(0), lastBack = useRef(0), backdropVideo = useRef<HTMLVideoElement>(null);
  const searchRequest = useRef({ keyword: '', sourceId: 'all' });
  const [collectionId, setCollectionId] = useState('history');
  const [legal, setLegal] = useState('');
  const [saveFeedback,setSaveFeedback]=useState<{id:number;kinds:('liked'|'favorites')[]}>();
  useEffect(()=>{if(!saveFeedback)return;const timer=setTimeout(()=>setSaveFeedback(undefined),1000);return()=>clearTimeout(timer);},[saveFeedback]);
  useMobileViewport();
  useEffect(() => { document.documentElement.dataset.mobilePlatform = mobilePlatform.toLowerCase(); return () => { delete document.documentElement.dataset.mobilePlatform; }; }, []);
  const player = state.playback, track = player.track, personal = state.personal;
  const playbackWanted=player.playWhenReady??player.playing;
  const playingGesture=useSongGesture(track?()=>songMenu(track):undefined);
  const openBar = usePlayerBarGesture(openPlayingSpace, () => setFull(true));
  const enabled = state.sources.filter(source => source.enabled);
  const roamingAttention = Boolean(state.roaming?.active && (state.roaming.phase === 'failed' || state.roaming.phase === 'exhausted'));
  const profile = state.profile || { name: 'Zenix', bio: '你的音乐，自成宇宙。' };
  const background = state.appearance?.background;
  const cardTransparency = Math.max(0, Math.min(90, profile.cardTransparency || 0));
  const profileRef = useRef(profile); profileRef.current = profile;
  const opacitySave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(opacitySave.current), []);
  function changeCardTransparency(value: number) {
    const next = { ...profileRef.current, cardTransparency: value };
    profileRef.current = next;
    setState(previous => ({ ...previous, profile: next }));
    clearTimeout(opacitySave.current);
    opacitySave.current = setTimeout(() => { void act('profile', { ...profileRef.current }); }, 300);
  }
  useEffect(() => { if (backdropVideo.current) { if (full || boot || document.hidden) backdropVideo.current.pause(); else void backdropVideo.current.play().catch(() => {}); } }, [full, boot, background?.url]);
  useEffect(() => { const update = () => { document.documentElement.classList.toggle('mobile-suspended', document.hidden); if (backdropVideo.current) { if (document.hidden || full || boot) backdropVideo.current.pause(); else void backdropVideo.current.play().catch(() => {}); } if (!document.hidden && isNativeMobile) void command<MobileSnapshot>('snapshot').then(setState).catch(() => {}); }; document.addEventListener('visibilitychange', update); return () => { document.removeEventListener('visibilitychange', update); document.documentElement.classList.remove('mobile-suspended'); }; }, [full, boot]);
  useEffect(() => {
    if (page !== 'space') return;
    if (collectionId === 'liked') setWall(personal.liked);
    else if (collectionId === 'favorites') setWall(personal.favorites);
    else if (collectionId === 'history') setWall(personal.history.map(item => item.track));
    else if (collectionId === 'local') setWall(state.localTracks || []);
    else if (collectionId === 'queue') setWall(player.queue);
    else if (collectionId === 'roaming') setWall(state.roaming?.tracks || []);
    else if (collectionId.startsWith('list-')) setWall(personal.playlists.find(list => list.id === collectionId)?.tracks || []);
  }, [page, collectionId, personal.liked, personal.favorites, personal.history, personal.playlists, player.queue, state.roaming?.tracks, state.localTracks]);
  async function act<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T | undefined> {
    try { return await command<T>(action, payload); } catch (e) { setToast(e instanceof Error ? e.message : '操作失败'); }
  }
  function acceptSnapshot(update:MobileUpdate){setState(previous=>({...previous,...update,playback:{...previous.playback,...update.playback}}));}
  useEffect(() => {
    let alive = true, stop: (() => void) | undefined;
    if (!isNativeMobile) return;
    void observe(snapshot => { if (alive && !document.hidden) setState(previous => snapshot.personal ? snapshot as MobileSnapshot : { ...previous, ...snapshot, playback: { ...previous.playback, ...snapshot.playback } }); }).then(handle => { if (!alive) void handle.remove(); else stop = () => { void handle.remove(); }; });
    const timer = setTimeout(() => { void command<MobileSnapshot>('snapshot').then(snapshot => { if (alive) { setState(snapshot); if (!snapshot.appearance?.completed) setModal('welcome'); } }).catch(e => setToast(String(e))).finally(() => { if (alive) setBootReady(true); }); }, 650);
    return () => { alive = false; clearTimeout(timer); stop?.(); };
  }, []);
  // Wait for saved appearance before starting the full intro. Never wait on music sources.
  useEffect(() => { const timer = setTimeout(() => setBootReady(true), 1800); return () => clearTimeout(timer); }, []);
  useEffect(() => { if (!boot) return; const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = overflow; }; }, [boot]);
  useEffect(() => { if (state.storageError) setToast(state.storageError); }, [state.storageError]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const back = () => { if (modal) setModal(null); else if (preview) setPreview(undefined); else if (searchOpen) setSearchOpen(false); else if (full) setFull(false); else if (page !== 'home') setPage('home'); else if (Date.now() - lastBack.current < 1800) void act('exit'); else { lastBack.current = Date.now(); setToast('再按一次返回退出界面，音乐继续播放'); } };
    document.addEventListener('zenix-back', back); return () => document.removeEventListener('zenix-back', back);
  }, [modal, preview, searchOpen, full, page]);
  const wallIds = wall.map(song => song.id).join('|');
  useEffect(() => {
    if (page !== 'space' || !isNativeMobile || isAndroid) return;
    let cancelled = false;
    void (async () => { for (const song of wall.filter(value => !value.coverUrl && value.source === 'custom')) { if (cancelled) break; try { const value = await command<{ url?: string }>('artwork', { track: song }); if (!cancelled && value.url) setWall(previous => previous.map(item => item.id === song.id ? { ...item, coverUrl: value.url } : item)); } catch {} } })();
    return () => { cancelled = true; };
  }, [page, wallIds]);
  function collection(title: string, tracks: Track[], id = '') { query.current++; setCollectionId(id); setBusy(false); setWall(tracks); setLabel(title); setMore({}); setPage('space'); setSearchOpen(false); }
  function enter() { if (state.roaming?.active) collection('音乐漫游', state.roaming.tracks, 'roaming'); else collection('最近播放', personal.history.map(item => item.track), 'history'); }
  async function startRoaming() {
    if (!enabled.length) { setPage('sources'); setToast('先添加音乐源，就可以开始漫游'); return; }
    if (!personal.history.length && !personal.liked.length && !personal.favorites.length) { setSearchOpen(true); setToast('先搜索并听一首，漫游就能找到你的方向'); return; }
    collection('音乐漫游', state.roaming?.tracks || [], 'roaming'); setFull(false);
    if (state.roaming?.active && state.roaming.phase === 'playing') return;
    const snapshot = await act<MobileUpdate>('roamingStart'); if (snapshot) acceptSnapshot(snapshot);
    void act('notifications');
  }
  function openPlayingSpace() {
    if (!track) return;
    if (state.roaming?.active) { collection('音乐漫游', state.roaming.tracks, 'roaming'); setFull(false); setFocusRequest(value => value + 1); return; }
    if (page !== 'space' || !wall.some(song => song.id === track.id)) {
      const inQueue = player.queue.some(song => song.id === track.id);
      collection('当前播放', inQueue ? player.queue : [track], inQueue ? 'queue' : '');
    }
    setFull(false); setFocusRequest(value => value + 1);
  }
  async function play(song: Track, tracks = wall) { const queue = tracks.some(item => item.id === song.id) ? tracks : [song]; const snapshot = await act<MobileUpdate>('play', { tracks: queue, index: queue.findIndex(item => item.id === song.id) }); if (snapshot) acceptSnapshot(snapshot); void act('notifications'); }
  async function search(append = false) {
    const request = append ? searchRequest.current : { keyword: keyword.trim(), sourceId };
    if (!request.keyword) return; searchRequest.current = request;
    (document.activeElement as HTMLElement | null)?.blur(); const version = ++query.current;
    setBusy(true); setError(''); setCollectionId('search'); setPage('space'); setLabel(`搜索 · ${request.keyword}`); setSearchOpen(false);
    const candidates = enabled.filter(source => source.manifest.capabilities.includes('search') && (request.sourceId === 'all' || source.id === request.sourceId));
    const local = !append && (request.sourceId === 'all' || request.sourceId === 'local') ? (state.localTracks || []).filter(song => `${song.title} ${song.artist} ${song.album || ''}`.toLocaleLowerCase().includes(request.keyword.toLocaleLowerCase())) : [];
    if (!append) { setWall(local); setMore({}); }
    const seen = new Set<string>(); const sources = candidates.filter(source => { const key = source.kind === 'lx' ? (source as InstalledSource & { settings?: Record<string, string> }).settings?.lxCatalog || Object.keys(source.manifest.lxPlatforms || {})[0] : source.id; if (seen.has(key)) return false; seen.add(key); return !append || Boolean(more[source.id]); });
    const cursors: Record<string, string> = append ? { ...more } : {}, errors: string[] = [];
    let found = append ? wall.length : local.length;
    await Promise.allSettled(sources.map(async source => {
      try {
        const result = await command<MobileSearchPage>('search', { id: source.id, keyword: request.keyword, cursor: append ? more[source.id] : '' });
        if (version !== query.current) return;
        found += result.items.length;
        if (result.nextCursor) cursors[source.id] = result.nextCursor; else delete cursors[source.id];
        setWall(previous => [...new Map([...previous, ...result.items].map(song => [song.id, song])).values()]);
        setMore({ ...cursors });
      } catch (reason) { if (version === query.current) errors.push(String(reason)); }
    }));
    if (version !== query.current) return;
    setBusy(false);
    if (append && errors.length) setToast('部分音乐源未返回，可点击查看更多重试');
    if (!found) setError(candidates.length ? errors[0] || '没有找到匹配歌曲' : (state.localTracks || []).length ? '本地曲库没有匹配歌曲，可添加音乐源继续搜索' : '请先配置音乐源，或导入本地音乐');
  }
  const saved = (operation: string, payload: Record<string, unknown>) => void act('personal', { operation, ...payload });
  function songMenu(song:Track){setAdding(song);setModal('songActions');}
  async function quickSave(song:Track,kinds:('liked'|'favorites')[]){const value=await act<MobileSnapshot['personal']>('personal',{operation:'addToCollections',track:song,kinds});if(value){setState(previous=>({...previous,personal:value}));setModal(null);setSaveFeedback({id:Date.now(),kinds});}}
  async function toggleSaved(song:Track,kind:'liked'|'favorites',selected:boolean){const value=await act<MobileSnapshot['personal']>('personal',{operation:'toggle',kind,track:song});if(value){setState(previous=>({...previous,personal:value}));if(!selected)setSaveFeedback({id:Date.now(),kinds:[kind]});}}
  async function removeSong(song:Track,fromQueue:boolean){if(fromQueue){const value=await act<Partial<MobileSnapshot>>('removeQueue',{id:song.id});if(!value)return false;setState(previous=>({...previous,...value,personal:previous.personal}));}else{const payload=collectionId.startsWith('list-')?{operation:'removeFromPlaylist',id:collectionId,trackId:song.id}:{operation:'removeSaved',kind:collectionId,id:song.id};const value=await act<MobileSnapshot['personal']>('personal',payload);if(!value)return false;setState(previous=>({...previous,personal:value}));}setToast('已移出当前列表');return true;}
  function add(song: Track) { setAdding(song); setModal('add'); }
  function newList(song?: Track) { setAdding(song); setEditing(''); setName(''); setModal('create'); }
  function actions(song: Track) { return <div className="track-actions">{(['liked', 'favorites'] as const).map(kind => { const selected = personal[kind].some(item => item.id === song.id), Icon = kind === 'liked' ? Heart : Star; return <button key={kind} aria-label={kind === 'liked' ? '喜欢' : '收藏'} aria-pressed={selected} className={selected ? kind : ''} onClick={() => void toggleSaved(song,kind,selected)}><Icon fill={selected ? 'currentColor' : 'none'} /></button>; })}<button aria-label="加入歌单" onClick={() => add(song)}><ListMusic /></button></div>; }
  async function importSource() { setImporting(true); const value = await act<SourcePreview>('importUrl', { url: url.trim() }); if (value) setPreview(value); setImporting(false); }
  async function moveSource(id:string,direction:number){const value=await act<InstalledSource[]>('sourceMove',{id,direction});if(value)setState(previous=>({...previous,sources:value}));}
  const cards = [{ title: '我的喜欢', icon: Heart, songs: personal.liked }, { title: '我的收藏', icon: Star, songs: personal.favorites }, { title: '听歌历史', icon: Disc3, songs: personal.history.map(item => item.track) }, { title: '我的歌单', icon: ListMusic, songs: personal.playlists[0]?.tracks || [] }, { title: '本地曲库', icon: FolderOpen, songs: state.localTracks || [] }, { title: '播放器设置', icon: Settings2, songs: [] }];
  function openCard(index: number) { if (index === 5) setPage('settings'); else if (index === 3) setModal('lists'); else collection(cards[index].title, cards[index].songs, ['liked','favorites','history','','local'][index]); }
  return <div className={`zenix-mobile page-${page}`} style={{ "--home-card-alpha": 1 - cardTransparency / 100 } as CSSProperties}>
    <div className="mobile-backdrop" aria-hidden="true">{background ? background.kind === 'video' ? <video ref={backdropVideo} src={fileUrl(background.url)} muted loop autoPlay playsInline /> : <img src={fileUrl(background.url)} alt="" /> : <div className="default-universe" />}</div>
    {dialog}
    <header className="mobile-header"><button className="brand" onClick={() => setPage('home')}>Zenix<span>.</span></button><div><button aria-label="搜索歌曲" onClick={() => setSearchOpen(true)}><Search /></button><button aria-label="设置" onClick={() => setPage('settings')}><Settings2 /></button></div></header>
    <div className="mobile-page-host"><AnimatePresence initial={false} mode="sync" custom={direction}><motion.main key={page} data-page={page} data-collection={collectionId} className="mobile-content" custom={direction} variants={pageVariants} initial="enter" animate="visible" exit="leave">
      {page === 'home' && <section className="personal-home"><div className="home-intro"><p>你的音乐，自成宇宙。</p><div className="home-entry-actions"><button className="glass small" onClick={() => { void startRoaming(); }}><Compass />{state.roaming?.active ? '继续音乐漫游' : '开始音乐漫游'}</button><button className="glass small" onClick={enter}>进入音乐空间<ArrowRight /></button></div></div>
        <OrbitCards cards={cards} onOpen={openCard} onEditGold={() => { setName(profile.name); setBio(profile.bio); setEmail(profile.email || ""); setModal("profile"); }} gold={<motion.button className="gold-card" whileTap={{ scale: .97 }} onClick={() => { setName(profile.name); setBio(profile.bio); setEmail(profile.email || ''); setModal('profile'); }}>{background?.kind === 'image' && <img src={fileUrl(background.url)} alt="" />}<div className="gold-signature"><span>ZENIX / {mobilePlatform.toUpperCase()}</span><Disc3 size={15} /></div><div className="gold-profile"><small>Music belongs to your universe.</small><h1>{profile.name}</h1><p>{profile.bio}</p>{profile.email && <small>{profile.email}</small>}<span className="edit-label"><Pencil size={12} />编辑个人名片</span></div></motion.button>} />
        <div className="home-collections">{cards.slice(0, 4).map((card, index) => <button className="collection-card glass" key={card.title} onClick={() => openCard(index)}><card.icon /><span>{card.title}</span><small>{index === 3 ? `${personal.playlists.length} 个歌单` : `${card.songs.length} 首歌曲`}</small></button>)}</div><section className="home-recent"><h2>最近播放<button onClick={enter}><ArrowRight /></button></h2><div className="recent-strip">{personal.history.slice(0, 12).map(({ track: song }) => <button key={song.id} onClick={() => { collection('最近播放', personal.history.map(item => item.track), 'history'); void play(song, personal.history.map(item => item.track)); }}><Art track={song} /><strong>{song.title}</strong><small>{song.artist}</small></button>)}</div>{!personal.history.length && <button className="empty glass" onClick={() => setSearchOpen(true)}><Search />搜索你的第一首音乐</button>}</section></section>}
      {page === 'space' && <section><div className="section-heading"><div><span>YOUR MUSIC SPACE</span><h1>{label}</h1></div><div className="space-list-buttons">{(collectionId.startsWith('list-')||collectionId==='liked'||collectionId==='favorites')&&<button aria-label="管理歌单歌曲" onClick={()=>setModal('songs')}><ListMusic/></button>}<button aria-label="搜索" onClick={() => setSearchOpen(true)}><Search /></button></div></div>{collectionId === 'search' ? <><p className="search-results-caption">{busy ? '正在搜索' : `${wall.length} 首结果`} · 点击播放键开始播放，长按快捷保存</p><SearchResults songs={wall} currentId={track?.id} playing={playbackWanted} menu={songMenu} play={song=>{if(track?.id===song.id)void act('toggle');else void play(song);}}/></> : <StickerSpace seek={seconds => void act('seek', { seconds })} songs={wall} state={state} label={label} focusRequest={focusRequest} longPress={songMenu} play={song => { if (track?.id === song.id) void act('toggle'); else if (collectionId === 'roaming' && state.roaming?.active) void act('roamingPlay', { id: song.id }); else void play(song); }} full={() => setFull(true)} actions={actions} />}{busy && <div className="empty"><LoaderCircle className="spin" />正在查找音乐</div>}{!busy && !wall.length && collectionId !== 'roaming' && <div className="empty glass"><Music2 /><p>{error || '这里还没有歌曲'}</p><button className="pill" onClick={() => enabled.length ? setSearchOpen(true) : setPage('sources')}>{enabled.length ? '搜索音乐' : '配置音乐源'}</button><button onClick={() => void act('pickLocal')}>导入本地音乐</button></div>}{!busy && Object.keys(more).length > 0 && <button className="pill load-more space-more" onClick={() => void search(true)}>查看更多</button>}</section>}
      {page === 'sources' && <section><div className="section-heading"><div><span>YOUR SOURCES</span><h1>音乐源</h1></div></div><p className="muted">最近成功的源优先，失败时按下方顺序回退。脚本由你自行配置。</p><form className="source-import glass" onSubmit={event => { event.preventDefault(); void importSource(); }}><strong>通过链接添加音乐源</strong><input type="url" autoCapitalize="none" autoCorrect="off" enterKeyHint="go" aria-label="音乐源地址" value={url} onChange={event => setUrl(event.target.value)} placeholder="HTTP / HTTPS 音乐源脚本或完整源地址" /><button className="pill" disabled={importing || !url.trim()} type="submit">{importing ? <LoaderCircle className="spin" /> : <Plus />}导入链接</button></form>{mobilePlatform==='Android'&&<SourceBundleExport count={state.sources.length} disabled={importing||Boolean(preview)||!isNativeMobile} onBusy={setImporting} save={()=>command('exportSourceBundle')}/>}<SourceBundleImport localScripts disabled={importing || Boolean(preview) || !isNativeMobile} onBusy={setImporting} pickFile={() => command('pickSourceBundle')} digest={text => command<string>('sourceDigest', { text })} install={async entry => { const next = await command<SourcePreview>(entry.script !== undefined ? 'previewSourceText' : 'importUrl', entry.script !== undefined ? { text: entry.script, url: entry.local ? entry.name : entry.url, originKind: entry.local ? 'file' : 'url' } : { url: entry.url }); await command('install', { token: next.token }); }} />{state.sources.map((source, index) => <article key={source.id} className="source-card glass"><div className="source-title"><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{source.manifest.name}</h3><small>v{source.manifest.version} · {Object.values(source.manifest.lxPlatforms || {}).map(platform => platform.name).join(' / ') || '完整源协议'}</small></div><button className={`toggle ${source.enabled ? 'on' : ''}`} aria-label="启用音乐源" aria-pressed={source.enabled} onClick={() => void act('sourceEnable', { id: source.id, enabled: !source.enabled })}><span /></button></div><div className="source-priority"><button disabled={index===0} aria-label={`上移 ${source.manifest.name}`} onClick={()=>void moveSource(source.id,-1)}>↑ 上移</button><button disabled={index===state.sources.length-1} aria-label={`下移 ${source.manifest.name}`} onClick={()=>void moveSource(source.id,1)}>↓ 下移</button></div>{source.manifest.settings.map(field => { const values = (source as InstalledSource & { settings?: Record<string, string> }).settings || {}; return <label className="source-setting" key={field.key}>{field.label}{field.type === 'select' ? <select value={values[field.key] || field.default} onChange={event => void act('sourceConfigure', { id: source.id, values: { ...values, [field.key]: event.target.value } })}>{field.options.map(value => <option key={value}>{value}</option>)}</select> : <input defaultValue={values[field.key] || field.default} onBlur={event => void act('sourceConfigure', { id: source.id, values: { ...values, [field.key]: event.target.value } })} />}</label>; })}<SourceNetworkEditor compatible={source.kind === 'lx'} policy={source.networkPolicy || DEFAULT_SOURCE_POLICY} save={networkPolicy => act('sourceConfigure', { id: source.id, networkPolicy })} /><button className="source-delete" onClick={async () => { if (await confirm({title:'移除音乐源',message:`移除「${source.manifest.name}」？歌曲与歌单将保留。`,confirmLabel:'移除',danger:true})) void act('sourceRemove', { id: source.id }); }}><Trash2 size={15} />移除</button></article>)}{!state.sources.length && <div className="empty"><Disc3 /><p>还未配置音乐源</p><small>支持兼容脚本及 Zenix 完整源包</small></div>}</section>}
      {page === 'settings' && <section><div className="section-heading"><h1>播放器设置</h1></div><div className="tool-actions">{(['share','stats','timer','widget'] as const).map(tool=><MusicToolsButton key={tool} initial={tool} personal={personal} invoke={mobileTool} platform={mobilePlatform}/>)}</div><div className="settings-card glass"><h3>首页卡片</h3><label htmlFor="card-transparency">灰色卡片透明度<output htmlFor="card-transparency">{cardTransparency}%</output></label><input id="card-transparency" type="range" min="0" max="90" step="5" value={cardTransparency} onChange={event => changeCardTransparency(Number(event.target.value))} /></div><div className="settings-card glass"><h3>个性背景</h3><p>{background?.name || '默认背景'}</p><button className="pill" onClick={() => void act('pickBackground')}><ImagePlus />选择图片或视频</button>{background && <button onClick={() => void act('clearBackground')}>恢复默认背景</button>}</div><div className="settings-card glass"><h3>音乐与缓存</h3><button onClick={() => setPage('sources')}><Settings2 />管理音乐源<ArrowRight /></button><label>播放品质<select defaultValue="high" onChange={event => void act('mode', { quality: event.target.value })}><option value="high">优先高品质，自动降级</option><option value="lossless">优先无损，自动降级</option></select></label><label>自动缓存<button className={`toggle ${state.cache.enabled ? 'on' : ''}`} aria-label="自动缓存" aria-pressed={state.cache.enabled} onClick={() => void act('cacheConfigure', { enabled: !state.cache.enabled })}><span /></button></label><label>缓存上限<select value={state.cache.limitMiB} onChange={event => void act('cacheConfigure', { limitMiB: Number(event.target.value) })}>{[128, 256, 512, 1024, 2048].map(value => <option key={value} value={value}>{value} MiB</option>)}</select></label><p>缓存随播放写入。整首完整缓存可离线播放，未听完通常只有部分片段；流式 HLS 暂不保证整首离线。</p><p>回退顺序可在音乐源管理中调整；优先复用最近成功的源，失败源临时跳过。</p><p>已用 {(state.cache.usedBytes / 1024 / 1024).toFixed(1)} MiB · 自动清理旧缓存</p>{state.cache.metadataLimitMiB && <p>歌词缓存 {((state.cache.metadataBytes || 0) / 1024 / 1024).toFixed(1)} MiB / {state.cache.metadataLimitMiB} MiB</p>}<button onClick={async () => {if(await confirm({title:'清理音频缓存',message:'清理后需要重新联网加载歌曲。喜欢、收藏、歌单与本地文件会保留。',confirmLabel:'清理缓存',danger:true}))void act('cacheClear');}}><Trash2 />清理缓存</button><button onClick={() => void act('pickLocal')}><FolderOpen />导入本地歌曲作为备用</button></div>{supportsOverlay && <div className="settings-card glass"><h3>悬浮歌词</h3><p>在其他应用上显示三行歌词。锁定后仅小锁按钮接收触摸。</p><button className="pill" onClick={async () => { if (!state.overlay?.enabled) await act('notifications'); await act('overlayEnable', { enabled: !state.overlay?.enabled }); }}><Captions />{state.overlay?.enabled ? '关闭悬浮歌词' : state.overlay?.permitted ? '打开悬浮歌词' : '授权并打开悬浮歌词'}</button><label>字号<input type="range" min="14" max="30" value={state.overlay?.fontSize || 20} onChange={event => void act('overlayConfigure', { fontSize: Number(event.target.value) })} /></label><label>歌词颜色<input type="color" value={state.overlay?.color || '#c5e9ff'} onChange={event => void act('overlayConfigure', { color: event.target.value })} /></label><label>字体<select value={state.overlay?.font || 'sans-serif-medium'} onChange={event => void act('overlayConfigure', { font: event.target.value })}><option value="sans-serif-medium">无衬线</option><option value="serif">衬线</option><option value="monospace">等宽</option></select></label><label>布局<select value={state.overlay?.compact ? 'compact' : 'standard'} onChange={event => void act('overlayConfigure', { compact: event.target.value === 'compact' })}><option value="standard">标准三行</option><option value="compact">紧凑三行</option></select></label></div>}<div className="settings-card glass"><h3>应用内歌词</h3><label>字体大小<input type="range" min="18" max="38" value={profile.lyricSize || 26} onChange={event => void act('profile', { ...profile, lyricSize: Number(event.target.value) })} /></label><label>歌词颜色<input type="color" value={profile.lyricColor || '#c5e9ff'} onChange={event => void act('profile', { ...profile, lyricColor: event.target.value })} /></label></div><div className="settings-card glass"><UpdateSettings /><h3>Zenix {mobilePlatform}</h3><p>{appVersion} · GPL-3.0</p><p>React · Capacitor · {mobilePlatform === 'iOS' ? 'AVPlayer' : 'Media3'}</p><button onClick={async () => { const text = await act<string>('licenses'); if(text) {setLegal(text);setModal('licenses');} }}>开源许可与致谢<ArrowRight /></button><p>音乐源与个人资料保存在应用私有目录，无需登录。</p></div></section>}
    </motion.main></AnimatePresence></div>
    {track && !full && <div className="mobile-mini glass" onClick={event => { if (!(event.target as Element).closest('button,input,select,a,[role="button"]')) openBar(); }}><button className="mini-info" {...playingGesture.handlers} aria-label="单击进入音乐空间，双击放大当前歌曲" onClick={openBar}><Art track={track} /><div><strong>{track.title}</strong><small>{track.artist}</small>{player.cacheStatus==='complete'&&<small className="cache-playback-badge">完整缓存 · 可离线</small>}{player.cacheStatus==='partial'&&<small className="cache-playback-badge">部分缓存</small>}</div></button><button aria-label={playbackWanted ? '暂停' : '播放'} onClick={() => void act('toggle')}>{playbackWanted ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button aria-label="下一首" onClick={() => void act('next')}><SkipForward /></button><button aria-label="当前播放列表" onClick={() => setModal('queue')}><ListMusic /></button><Seek compact position={player.position} duration={player.duration} onSeek={seconds => void act('seek', { seconds })} /></div>}
    <nav className="mobile-nav glass" aria-label="主要导航">{([{ id: 'home' as Page, title: '个人', icon: Home }, { id: 'space' as Page, title: '音乐空间', icon: Disc3 }, { id: 'sources' as Page, title: '音乐源', icon: Settings2 }]).map(item => <button key={item.id} aria-current={page === item.id ? 'page' : undefined} className={page === item.id ? 'selected' : ''} onClick={() => item.id === 'space' ? enter() : setPage(item.id)}>{page === item.id && <motion.span className="mobile-nav-selection" layoutId="mobile-nav-selection" transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }} />}<item.icon /><span>{item.title}</span></button>)}</nav>
    {page === 'space' && !full && !searchOpen && !modal && !preview && (!player.sourceActivity || roamingAttention) && <div className="mobile-roaming glass" role="status">
      {state.roaming?.phase === 'searching' ? <LoaderCircle className="spin" /> : <Compass />}
      <span title={state.roaming?.message}>{collectionId === 'roaming' ? state.roaming?.message || '正在准备音乐漫游' : '按你的喜好发现新歌'}</span>
      <button disabled={state.roaming?.phase === 'searching'} onClick={() => { void startRoaming(); }}>{collectionId === 'roaming' && state.roaming?.active ? state.roaming.phase === 'playing' ? '漫游中' : '继续探索' : '开始漫游'}</button>
      {roamingAttention && <button onClick={() => setPage('sources')}>音乐源</button>}
      {state.roaming?.active && <button aria-label="结束自动漫游" onClick={() => { void act('roamingStop'); collection('当前播放', track ? [track] : [], 'queue'); }}><X /></button>}
    </div>}
    {player.sourceActivity && !(page === 'space' && !full && roamingAttention) && <div className={`mobile-source-status glass phase-${player.sourceActivity.phase}`} role="status">{player.sourceActivity.phase === 'failed' ? <X /> : <LoaderCircle className="spin" />}<span>{player.sourceActivity.message}</span>{player.sourceActivity.phase === 'failed' && <button onClick={() => setPage('sources')}>换源</button>}</div>}
    <AnimatePresence>{searchOpen && <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1, pointerEvents: 'auto' }} exit={{ opacity: 0, pointerEvents: 'none' }} transition={{ duration: reducedMotion ? 0 : .14 }} className="mobile-overlay" onClick={() => setSearchOpen(false)}><motion.section initial={{ y: reducedMotion ? 0 : -12 }} animate={{ y: 0 }} exit={{ y: reducedMotion ? 0 : -8 }} transition={panelTransition} className="mobile-search glass" role="dialog" aria-label="搜索音乐" onClick={event => event.stopPropagation()}><MobileSearchBar keyword={keyword} onChange={setKeyword} onSearch={() => void search()} onClose={() => setSearchOpen(false)} /><div className="source-chips"><button className={sourceId === 'all' ? 'selected' : ''} onClick={() => setSourceId('all')}>全部音乐</button>{!!state.localTracks?.length && <button className={sourceId === 'local' ? 'selected' : ''} onClick={() => setSourceId('local')}>本地音乐</button>}{enabled.map(source => <button key={source.id} className={sourceId === source.id ? 'selected' : ''} onClick={() => setSourceId(source.id)}>{source.manifest.name}</button>)}</div>{!enabled.length && <button onClick={() => { setPage('sources'); setSearchOpen(false); }}>先添加自定义音乐源<ArrowRight /></button>}</motion.section></motion.div>}</AnimatePresence>
    <AnimatePresence>{full && track && <FullPlayer state={state} act={act} actions={actions(track)} longPress={songMenu} close={() => setFull(false)} queue={() => setModal('queue')} />}</AnimatePresence>
    <AnimatePresence>{saveFeedback&&<SaveFeedback key={saveFeedback.id} kinds={saveFeedback.kinds}/>}</AnimatePresence>
    <AnimatePresence>{(modal || preview) && <motion.div key="sheet" initial={{ opacity: 0 }} animate={{ opacity: 1, pointerEvents: 'auto' }} exit={{ opacity: 0, pointerEvents: 'none' }} transition={{ duration: reducedMotion ? 0 : .14 }} className="mobile-overlay sheet-overlay" onClick={() => { setModal(null); setPreview(undefined); }}><motion.section initial={{ y: reducedMotion ? 0 : 28 }} animate={{ y: 0 }} exit={{ y: reducedMotion ? 0 : 20 }} transition={panelTransition} className="mobile-sheet glass" role="dialog" aria-modal="true" aria-label="音乐面板" onClick={event => event.stopPropagation()}><button className="sheet-close" aria-label="关闭" onClick={() => { setModal(null); setPreview(undefined); }}><X /></button>
      {preview && <><h2>确认添加音乐源</h2><h3>{preview.manifest.name}</h3><p>版本 {preview.manifest.version}</p><p className="muted">确认后将运行此脚本，请仅添加可信作者提供的文件。</p><code className="source-hash">SHA256 {preview.sha256}</code><SourceNetworkOptions compatible={preview.kind === 'lx'} policy={permission} onChange={setPermission} /><button disabled={importing} className="pill" onClick={async () => { setImporting(true); if (await act('install', { token: preview.token, networkPolicy: permission })) { setPreview(undefined); setUrl(''); setToast('音乐源已加入调用队列'); } setImporting(false); }}>{importing ? <LoaderCircle className="spin" /> : <Check />}确认添加</button></>}
      {modal === 'queue' && <><h2>当前播放列表 · {player.queue.length} 首</h2><p className="song-gesture-hint">左右滑动移出列表 · 长按歌曲快捷保存</p><AnimatePresence initial={false}>{player.queue.map((song,index)=><SwipeTrackRow key={song.id} song={song} current={track?.id===song.id} play={()=>{if(track?.id!==song.id)void act('play',{tracks:player.queue,index});setModal(null);}} longPress={()=>songMenu(song)} remove={()=>removeSong(song,true)} actions={actions(song)}/>)}</AnimatePresence>{!player.queue.length && <p>当前还没有播放队列。</p>}</>}
      {modal === 'songs' && <><h2>{label} · {wall.length} 首</h2><p className="song-gesture-hint">左右滑动移出歌单 · 长按歌曲快捷保存</p><AnimatePresence initial={false}>{wall.map(song=><SwipeTrackRow key={song.id} song={song} current={track?.id===song.id} play={()=>{if(track?.id!==song.id)void play(song);setModal(null);}} longPress={()=>songMenu(song)} remove={()=>removeSong(song,false)} actions={actions(song)}/>)}</AnimatePresence>{!wall.length&&<p>歌单中还没有歌曲。</p>}</>}
      {modal === 'songActions' && adding && <><h2>快捷保存</h2><div className="song-action-summary"><Art track={adding}/><div><strong>{adding.title}</strong><small>{adding.artist}</small></div></div><div className="song-quick-actions"><button onClick={()=>void quickSave(adding,['liked'])}><Heart className="liked"/>加入喜欢</button><button onClick={()=>void quickSave(adding,['favorites'])}><Star className="favorites"/>加入收藏</button><button className="pill" onClick={()=>void quickSave(adding,['liked','favorites'])}><Heart/><Star/>同时加入喜欢和收藏</button><button onClick={()=>add(adding)}><ListMusic/>加入歌单</button></div></>}
      {modal === 'licenses' && <><h2>开源许可与致谢</h2><pre className="mobile-legal">{legal}</pre></>}
      {modal === 'welcome' && <><h2>让这里成为你的音乐空间</h2><p>选择照片或视频作为背景，之后可以在个人空间中修改。</p><button className="pill" onClick={async () => { if (await act('pickBackground')) setModal(null); }}><ImagePlus />选择背景</button><button onClick={() => { void act('completeWelcome'); setModal(null); }}>暂时跳过</button></>}
      {modal === 'profile' && <form onSubmit={event => { event.preventDefault(); void act('profile', { ...profile, name: name.trim() || 'Zenix', bio: bio.trim(), email: email.trim() }); setModal(null); }}><h2>个人名片</h2><label>名字<input value={name} maxLength={30} onChange={event => setName(event.target.value)} /></label><label>签名<textarea value={bio} maxLength={120} onChange={event => setBio(event.target.value)} /></label><label>联系方式<input value={email} maxLength={80} onChange={event => setEmail(event.target.value)} /></label><button type="button" onClick={() => void act('pickBackground')}><ImagePlus />修改照片或视频</button><button className="pill" type="submit"><Check />保存名片</button></form>}
      {modal === 'add' && <><h2>加入歌单</h2>{personal.playlists.map(list => <button key={list.id} className="list-row" onClick={() => { if (adding) saved('addToPlaylist', { id: list.id, track: adding }); setModal(null); }}><Art track={list.tracks[0]} /><span>{list.name}<small>{list.tracks.length} 首</small></span><Plus /></button>)}<button className="pill" onClick={() => newList(adding)}><Plus />新建歌单</button></>}
      {modal === 'create' && <form onSubmit={async event => { event.preventDefault(); if (await act('personal', { operation: editing ? 'renamePlaylist' : 'createPlaylist', id: editing, name, ...(adding ? { track: adding } : {}) })) { setModal('lists'); setAdding(undefined); } }}><h2>{editing ? '重命名歌单' : '新建歌单'}</h2><input autoFocus maxLength={100} value={name} placeholder="给歌单起个名字" onChange={event => setName(event.target.value)} /><button className="pill" disabled={!name.trim()} type="submit"><Check />保存</button></form>}
      {modal === 'lists' && <><h2>我的歌单</h2><MusicToolsButton personal={personal} invoke={mobileTool} platform={mobilePlatform}/>{personal.playlists.map(list => <div className="list-row" key={list.id}><button onClick={() => { collection(list.name, list.tracks, list.id); setModal(null); }}><Art track={list.tracks[0]} /><span>{list.name}<small>{list.tracks.length} 首</small></span></button><button aria-label="重命名" onClick={() => { setName(list.name); setEditing(list.id); setAdding(undefined); setModal('create'); }}><Pencil /></button><button aria-label="删除歌单" onClick={async () => { if (await confirm({title:'删除歌单',message:`删除歌单「${list.name}」？歌曲文件与其他歌单将保留。`,confirmLabel:'删除歌单',danger:true})) saved('deletePlaylist', { id: list.id }); }}><Trash2 /></button></div>)}<button className="pill" onClick={() => newList()}><Plus />新建歌单</button></>}
    </motion.section></motion.div>}</AnimatePresence>
    {toast && <div className="mobile-toast glass" role="status">{toast}</div>}{!isNativeMobile && <div className="preview-label">{mobilePlatform} 界面预览 · 原生功能需安装应用</div>}{boot && <Suspense fallback={<div className="mobile-boot" role="status" aria-label="Zenix 正在启动"><div><Disc3 /><h1>Zenix<span>.</span></h1></div></div>}>{bootReady ? <ZenixIntro onFinish={finishBoot} background={background ? { ...background, url: fileUrl(background.url)! } : null} /> : <div className="mobile-boot" role="status" aria-label="正在读取个人背景"><div><Disc3 /><h1>Zenix<span>.</span></h1></div></div>}</Suspense>}
  </div>;
}
