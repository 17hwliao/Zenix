import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, ChevronDown, Disc3, FolderOpen, Heart, History, ImagePlus, ListMusic, Music2, Pencil, Plus, RotateCcw, Settings2, Star, Trash2, Upload, X } from 'lucide-react';
import { version as appVersion } from '../../package.json';
import type { AppearanceBackground, PersonalState } from '../core/types';
import type { TrackView } from './types';
import CoverArt from './CoverArt';
import { trackCoverUrl } from '../core/trackCover';
import { useDocumentVisible } from '../core/useDocumentVisible';
import './PersonalHome.css';

type Props = {
  personal: PersonalState; tracks: TrackView[]; currentTrack: TrackView | null;
  appearanceBackground?: AppearanceBackground | null; appearanceBusy?: boolean;
  onPlayTrack: (track: TrackView, queue?: TrackView[]) => void; onOpenPlayer: () => void;
  onOpenManager: (id: string) => void; onOpenSettings: () => void;
  onChooseBackground?: () => void | Promise<void>; onClearBackground?: () => void | Promise<void>;
  onReplayIntro?: () => void; onImportFolder: () => void | Promise<void>;
  onAddFiles?: () => void | Promise<void>; onOpenLocalLibrary?: () => void;
  onImportPlaylist?: () => void | Promise<void>;
};
type OrbitCoverKey = 'liked' | 'favorites' | 'history' | 'playlists' | 'library';
type Profile = { name: string; tagline: string; cardLine: string; cardNumber: string; about: string; tags: string; contact: string; subject: string; background: string; orbitCovers: Record<OrbitCoverKey, string> };
const PROFILE_KEY = 'zenix.profile.card.v2';
const GOLD_LAYER_KEY = 'zenix.profile.gold-layer';
const emptyOrbitCovers: Record<OrbitCoverKey, string> = { liked: '', favorites: '', history: '', playlists: '', library: '' };
const defaults: Profile = { name: '我的音乐空间', tagline: '把喜欢的声音，留在自己的宇宙里。', cardLine: 'PERSONAL MUSIC SPACE', cardNumber: 'NO. 001', about: '', tags: '', contact: '', subject: '', background: '', orbitCovers: emptyOrbitCovers };
function readProfile(): Profile {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') as Partial<Profile>;
    return { ...defaults, ...saved, name: saved.name ?? localStorage.getItem('zenix.profile.name') ?? defaults.name, tagline: saved.tagline ?? localStorage.getItem('zenix.profile.tagline') ?? defaults.tagline, orbitCovers: { ...emptyOrbitCovers, ...saved.orbitCovers } };
  } catch { return defaults; }
}
function imageToDataUrl(file: File, maxEdge: number, transparent: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => {
      const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext('2d');
      if (!context) { URL.revokeObjectURL(url); reject(new Error('无法读取图片')); return; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url);
      resolve(canvas.toDataURL(transparent ? 'image/png' : 'image/webp', transparent ? undefined : .78));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取图片')); };
    image.src = url;
  });
}
type OrbitCard = { id: OrbitCoverKey | 'settings'; label: string; caption: string; icon: typeof Heart; image?: string; action: () => void };

export default function PersonalHome({ personal, tracks, currentTrack, appearanceBackground, appearanceBusy, onPlayTrack, onOpenPlayer, onOpenManager, onOpenSettings, onChooseBackground, onClearBackground, onReplayIntro, onImportFolder, onAddFiles, onOpenLocalLibrary, onImportPlaylist }: Props) {
  const [profile, setProfile] = useState<Profile>(readProfile);
  const [draft, setDraft] = useState<Profile>(profile);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const documentVisible = useDocumentVisible();
  const [goldBehind, setGoldBehind] = useState(() => { try { return localStorage.getItem(GOLD_LAYER_KEY) === 'behind'; } catch { return false; } });
  const [goldDragging, setGoldDragging] = useState(false);
  const [goldDragY, setGoldDragY] = useState(0);
  const [goldTossFrom, setGoldTossFrom] = useState(0);
  const [goldTossing, setGoldTossing] = useState(false);
  const goldBehindRef = useRef(goldBehind);
  const scrollRef = useRef<HTMLDivElement>(null), stageRef = useRef<HTMLElement>(null), songSectionRef = useRef<HTMLElement>(null), ringRef = useRef<HTMLDivElement>(null), holoRef = useRef<HTMLButtonElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null), backgroundInputRef = useRef<HTMLInputElement>(null);
  const rotation = useRef(0), velocity = useRef(0);
  const pointer = useRef<{ id: number; x: number; distance: number; target: HTMLElement } | null>(null);
  const goldPointer = useRef<{ id: number; x: number; y: number; dx: number; dy: number } | null>(null);
  const goldTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const suppressGoldClick = useRef(false);
  const suppressClick = useRef(false);
  const inOrbitInteraction = (x: number, y: number) => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return false;
    const horizontalReach = Math.min(400, (bounds.width - 8) / 2);
    const verticalReach = Math.min(300, horizontalReach * .76, (bounds.height - 8) / 2);
    const verticalOffset = y - (bounds.top + bounds.height * .46);
    return Math.abs(x - (bounds.left + bounds.width / 2)) <= horizontalReach && verticalOffset >= -verticalReach && verticalOffset <= verticalReach * (2 / 3);
  };
  const canRotateOrbit = (x: number, y: number) => (scrollRef.current?.scrollTop ?? 0) <= 1 && inOrbitInteraction(x, y);
  const historyTracks = personal.history.slice(0, 24).map(entry => entry.track);
  const defaultCovers: Record<OrbitCoverKey, string | undefined> = {
    liked: trackCoverUrl(personal.liked[0]),
    favorites: trackCoverUrl(personal.favorites[0]),
    history: trackCoverUrl(personal.history[0]?.track),
    playlists: trackCoverUrl(personal.playlists[0]?.tracks[0]),
    library: trackCoverUrl(tracks[0]),
  };
  const cards: OrbitCard[] = [
    { id: 'liked', label: '我的喜欢', caption: `${personal.liked.length} 首歌曲`, icon: Heart, image: profile.orbitCovers.liked || defaultCovers.liked, action: () => onOpenManager('liked') },
    { id: 'favorites', label: '我的收藏', caption: `${personal.favorites.length} 首歌曲`, icon: Star, image: profile.orbitCovers.favorites || defaultCovers.favorites, action: () => onOpenManager('favorites') },
    { id: 'history', label: '听歌历史', caption: `${personal.history.length} 首歌曲`, icon: History, image: profile.orbitCovers.history || defaultCovers.history, action: () => onOpenManager('history') },
    { id: 'playlists', label: '自定义歌单', caption: `${personal.playlists.length} 个歌单`, icon: ListMusic, image: profile.orbitCovers.playlists || defaultCovers.playlists, action: () => onOpenManager('playlists') },
    { id: 'library', label: '本地曲库', caption: `${tracks.length} 首音乐`, icon: FolderOpen, image: profile.orbitCovers.library || defaultCovers.library, action: () => onOpenLocalLibrary ? onOpenLocalLibrary() : onOpenManager('playlists') },
    { id: 'settings', label: '播放器设置', caption: '音效 · 桌面歌词 · 动效', icon: Settings2, action: onOpenSettings },
  ];

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const rotateOnWheel = (event: WheelEvent) => {
      if (!canRotateOrbit(event.clientX, event.clientY)) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      velocity.current = Math.max(-5, Math.min(5, velocity.current + delta * .025));
    };
    stage.addEventListener('wheel', rotateOnWheel, { passive: false, capture: true });
    return () => stage.removeEventListener('wheel', rotateOnWheel, true);
  }, []);
  useEffect(() => () => goldTimers.current.forEach(timer => clearTimeout(timer)), []);
  useEffect(() => {
    if (!documentVisible) return;
    let frame = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = () => {
      const ring = ringRef.current;
      const hoveringCard = Boolean(ring && Array.from(ring.children).some(child => child.matches(':hover')));
      if (!pointer.current) {
        rotation.current += reduced || hoveringCard ? 0 : .075;
        rotation.current += velocity.current;
        velocity.current *= .94;
        if (Math.abs(velocity.current) < .001) velocity.current = 0;
      }
      if (ring) {
        ring.style.transform = `rotateY(${rotation.current}deg)`;
        Array.from(ring.children).forEach((child, index) => {
          const depth = (Math.cos((index * 60 + rotation.current) * Math.PI / 180) + 1) / 2;
          const hovered = child.matches(':hover');
          (child as HTMLElement).style.opacity = String(hovered ? 1 : .48 + depth * .52);
          (child as HTMLElement).style.filter = `brightness(${hovered ? 1 : .58 + depth * .42})`;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [documentVisible]);
  useEffect(() => {
    if (!editing) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false); } };
    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, [editing]);
  const openEditor = () => { setDraft(profile); setSaveError(''); setEditing(true); };
  const update = (key: keyof Profile, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const save = (event: FormEvent) => {
    event.preventDefault();
    const next = { ...draft, name: draft.name.trim() || defaults.name, cardLine: draft.cardLine.trim() || defaults.cardLine, cardNumber: draft.cardNumber.trim() || defaults.cardNumber };
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      localStorage.setItem('zenix.profile.name', next.name);
      localStorage.setItem('zenix.profile.tagline', next.tagline);
      setProfile(next); setEditing(false);
    } catch { setSaveError('保存失败。图片可能过大，请换一张较小的图片再试。'); }
  };
  const chooseImage = async (event: ChangeEvent<HTMLInputElement>, key: 'subject' | 'background') => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try { update(key, await imageToDataUrl(file, key === 'subject' ? 700 : 960, key === 'subject')); setSaveError(''); }
    catch { setSaveError('无法读取这张图片，请更换文件。'); }
  };
  const chooseOrbitCover = async (event: ChangeEvent<HTMLInputElement>, key: OrbitCoverKey) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      const cover = await imageToDataUrl(file, 480, false);
      setDraft(current => ({ ...current, orbitCovers: { ...current.orbitCovers, [key]: cover } }));
      setSaveError('');
    } catch { setSaveError('无法读取这张图片，请更换文件。'); }
  };
  const onStageDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('.zenix-card-center') || !canRotateOrbit(event.clientX, event.clientY)) return;
    const target = ((event.target as Element).closest('.zenix-orbit-card') as HTMLElement | null) || event.currentTarget;
    suppressClick.current = false;
    pointer.current = { id: event.pointerId, x: event.clientX, distance: 0, target };
    velocity.current = 0; target.setPointerCapture(event.pointerId);
  };
  const onStageMove = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.classList.toggle('is-orbit-hot', canRotateOrbit(event.clientX, event.clientY) && !(event.target as Element).closest('.zenix-card-center'));
    const p = pointer.current;
    if (p && p.id === event.pointerId) {
      const dx = event.clientX - p.x; p.x = event.clientX; p.distance += Math.abs(dx);
      const step = dx * .28; rotation.current += step; velocity.current = Math.max(-5, Math.min(5, step));
      if (p.distance > 6) suppressClick.current = true;
    }
    const card = holoRef.current;
    if (card) {
      const box = card.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (event.clientX - box.left - box.width / 2) / box.width));
      const y = Math.max(-1, Math.min(1, (event.clientY - box.top - box.height / 2) / box.height));
      card.style.setProperty('--holo-x', `${-y * 8}deg`); card.style.setProperty('--holo-y', `${x * 12}deg`);
      card.style.setProperty('--holo-gx', `${50 + x * 40}%`); card.style.setProperty('--holo-gy', `${50 + y * 40}%`);
      card.style.setProperty('--holo-foil', `${110 + x * 55}deg`);
    }
  };
  const onStageUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id === event.pointerId) {
      const target = pointer.current.target;
      pointer.current = null;
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    }
  };
  const tossGold = (from: number) => {
    goldTimers.current.forEach(timer => clearTimeout(timer));
    goldTimers.current = [];
    setGoldTossFrom(from);
    setGoldTossing(true);
    setGoldDragY(0);
    goldTimers.current.push(setTimeout(() => {
      const next = !goldBehindRef.current;
      goldBehindRef.current = next;
      setGoldBehind(next);
      try { localStorage.setItem(GOLD_LAYER_KEY, next ? 'behind' : 'front'); } catch { /* Visual preference is still applied for this session. */ }
    }, 250));
    goldTimers.current.push(setTimeout(() => setGoldTossing(false), 640));
  };
  const onGoldDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary || goldTossing) return;
    event.preventDefault();
    event.stopPropagation();
    suppressGoldClick.current = false;
    goldPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0 };
    setGoldDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onGoldMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = goldPointer.current;
    if (!drag || drag.id !== event.pointerId) return;
    event.stopPropagation();
    drag.dx = event.clientX - drag.x;
    drag.dy = event.clientY - drag.y;
    if (Math.hypot(drag.dx, drag.dy) > 8) suppressGoldClick.current = true;
    setGoldDragY(Math.max(-130, Math.min(0, drag.dy)));
  };
  const finishGold = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = goldPointer.current;
    if (!drag || drag.id !== event.pointerId) return;
    event.stopPropagation();
    goldPointer.current = null;
    setGoldDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && drag.dy < -72 && Math.abs(drag.dy) > Math.abs(drag.dx) * 1.2) tossGold(Math.max(-130, drag.dy));
    else setGoldDragY(0);
  };
  const handleOrbitClick = (action: () => void) => { if (suppressClick.current) { suppressClick.current = false; return; } action(); };
  const scrollToSongs = () => {
    const scroll = scrollRef.current;
    const section = songSectionRef.current;
    if (!scroll || !section) return;
    const top = scroll.scrollTop + section.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    scroll.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return <div className="zenix-home-space">
    <header className="zenix-home-top"><span className="zenix-home-logo">Zenix<span>.</span></span><div><button onClick={onOpenPlayer} title="进入贴纸播放器"><Disc3 size={18} />进入音乐空间<ArrowRight size={16} /></button></div></header>
    <div ref={scrollRef} className="zenix-home-scroll">
      <section ref={stageRef} className="zenix-space-stage" aria-label="个人音乐空间" onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp} onPointerLeave={event => event.currentTarget.classList.remove('is-orbit-hot')}>
        <div className="zenix-stage-aura" aria-hidden="true" />
        <div className="zenix-stage-heading"><strong>你的音乐，自成宇宙。</strong></div>
        <div className="zenix-stage-search-hint">鼠标移至上方任意空白处，即可唤出搜索框</div>
        <div className="zenix-orbit-scene"><div className="zenix-orbit-guide" aria-hidden="true" /><div className="zenix-orbit-ring" ref={ringRef}>
          {cards.map((card, index) => <button key={card.id} type="button" className={`zenix-orbit-card${card.image ? ' has-cover' : ''}`} style={{ '--orbit-angle': `${index * 60}deg`, '--card-delay': `${index * 1.2}s` } as CSSProperties} onClick={() => handleOrbitClick(card.action)}>
            {card.image && <img src={card.image} alt="" />}<span className="zenix-orbit-sheen" aria-hidden="true" /><span className="zenix-orbit-no">{String(index + 1).padStart(2, '0')}</span><card.icon className="zenix-orbit-icon" size={38} strokeWidth={1.25} /><span className="zenix-orbit-copy"><strong>{card.label}</strong><small>{card.caption}</small></span><ArrowRight className="zenix-orbit-arrow" size={16} />
          </button>)}
        </div></div>
        <div className={`zenix-card-center${goldBehind ? ' is-behind' : ''}${goldDragging ? ' is-dragging' : ''}${goldTossing ? ' is-tossing' : ''}`} style={{ '--gold-drag-y': `${goldDragY}px`, '--gold-toss-from': `${goldTossFrom}px` } as CSSProperties}><button ref={holoRef} className="zenix-holo-card" type="button" draggable={false} onDragStart={event => event.preventDefault()} onPointerDown={onGoldDown} onPointerMove={onGoldMove} onPointerUp={event => finishGold(event)} onPointerCancel={event => finishGold(event, true)} onClick={event => { if (suppressGoldClick.current) { suppressGoldClick.current = false; event.preventDefault(); return; } openEditor(); }} onKeyDown={event => { if (event.shiftKey && event.key === 'ArrowUp') { event.preventDefault(); suppressGoldClick.current = true; tossGold(-85); } }} aria-label="编辑个人名片，向上拖动可切换前后层" title="向上拖动金卡切换前后层；点击编辑名片">
          {profile.background && <img className="zenix-holo-background" src={profile.background} alt="" />}<span className="zenix-holo-grid" aria-hidden="true" /><span className="zenix-holo-head"><span>ZENIX / v{appVersion}</span><span>{profile.cardNumber}</span></span><span className="zenix-holo-subject">{profile.subject ? <img src={profile.subject} alt="个人名片主体图" /> : <span className="zenix-holo-monogram">{profile.name.slice(0, 1).toUpperCase() || 'Z'}</span>}</span><span className="zenix-holo-info"><small>{profile.cardLine}</small><strong>{profile.name}</strong><span>{profile.tagline}</span>{profile.about && <p>{profile.about}</p>}{profile.tags && <em>{profile.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).slice(0, 3).join(' · ')}</em>}{profile.contact && <i>{profile.contact}</i>}</span><span className="zenix-holo-foil" aria-hidden="true" /><span className="zenix-holo-glare" aria-hidden="true" /><span className="zenix-holo-edge" aria-hidden="true" />
        </button><div className="zenix-card-shadow" aria-hidden="true" /><button type="button" className="zenix-card-edit" onClick={openEditor}><Pencil size={13} />编辑个人名片</button></div>
        <div className="zenix-stage-scroll-hint"><span>在卡片外下滑管理自己的歌曲</span><button type="button" onClick={scrollToSongs} title="下滑到歌曲管理" aria-label="下滑到歌曲管理"><ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" /></button></div>
      </section>
      <section ref={songSectionRef} className="zenix-home-section"><div className="zenix-home-section-head"><div><h2>你的收藏，随时继续</h2></div><button onClick={() => onOpenManager('playlists')}>管理歌曲与歌单<ArrowRight size={15} /></button></div>
        {historyTracks.length ? <div className="zenix-recent-strip">{historyTracks.slice(0, 8).map((track, index) => <button key={`${track.id}-${index}`} onClick={() => { onPlayTrack(track, historyTracks); onOpenPlayer(); }}><CoverArt title={track.title} coverUrl={trackCoverUrl(track)} /><strong>{track.title}</strong><small>{track.artist}</small></button>)}</div> : <div className="zenix-home-empty"><Music2 size={25} /><span>听过的歌曲会出现在这里</span>{currentTrack && <button onClick={onOpenPlayer}>继续播放</button>}</div>}
      </section>
      <div className="zenix-home-foot"><div><button onClick={() => void onImportFolder()}><Upload size={13} />导入文件夹</button>{onAddFiles && <button onClick={() => void onAddFiles()}><Plus size={13} />添加音乐文件</button>}{onImportPlaylist && <button onClick={() => void onImportPlaylist()}>导入 M3U 歌单</button>}</div></div>
    </div>
    {editing && createPortal(<div className="zenix-profile-editor-mask" onPointerDown={event => { if (event.target === event.currentTarget) setEditing(false); }}><form className="zenix-profile-editor" onSubmit={save}>
      <header><div><span>IDENTITY CARD / EDIT</span><h2>编辑个人名片</h2><p>名片与空间设置保存在本机，点击中心卡片可以随时修改。</p></div><button type="button" className="zenix-editor-close" onClick={() => setEditing(false)} aria-label="关闭编辑"><X size={17} /></button></header>
      <div className="zenix-editor-body"><div className="zenix-editor-images"><div className="zenix-editor-mini-card" style={draft.background ? { backgroundImage: `linear-gradient(180deg, rgba(9,10,13,.1), rgba(9,10,13,.84)), url(${JSON.stringify(draft.background)})` } : undefined}>{draft.subject ? <img src={draft.subject} alt="主体图预览" /> : <span>{draft.name.slice(0, 1).toUpperCase() || 'Z'}</span>}<strong>{draft.name || defaults.name}</strong><small>{draft.cardLine || defaults.cardLine}</small></div><div className="zenix-editor-image-actions"><button type="button" onClick={() => subjectInputRef.current?.click()}><ImagePlus size={14} />主体图</button><button type="button" onClick={() => backgroundInputRef.current?.click()}><ImagePlus size={14} />卡面背景</button></div><button type="button" className="zenix-editor-clear" onClick={() => setDraft(current => ({ ...current, subject: '', background: '' }))}>移除卡面图片</button><input ref={subjectInputRef} type="file" accept="image/*" hidden onChange={event => void chooseImage(event, 'subject')} /><input ref={backgroundInputRef} type="file" accept="image/*" hidden onChange={event => void chooseImage(event, 'background')} /></div>
        <div className="zenix-editor-fields"><label>显示名称<input value={draft.name} maxLength={36} onChange={event => update('name', event.target.value)} placeholder="你的名称" /></label><div className="zenix-editor-field-row"><label>卡面副标题<input value={draft.cardLine} maxLength={36} onChange={event => update('cardLine', event.target.value)} placeholder="PERSONAL MUSIC SPACE" /></label><label>卡片编号<input value={draft.cardNumber} maxLength={18} onChange={event => update('cardNumber', event.target.value)} placeholder="NO. 001" /></label></div><label>空间宣言<input value={draft.tagline} maxLength={100} onChange={event => update('tagline', event.target.value)} placeholder="一句话介绍你的音乐空间" /></label><label>关于我<textarea value={draft.about} maxLength={500} onChange={event => update('about', event.target.value)} placeholder="写下你的故事、喜爱的声音，或任何想记录的事" rows={3} /></label><label>个人标签<input value={draft.tags} maxLength={120} onChange={event => update('tags', event.target.value)} placeholder="用逗号分隔，例如 夜间听歌, 摇滚, 旅行" /></label><label>联系信息或主页<input value={draft.contact} maxLength={180} onChange={event => update('contact', event.target.value)} placeholder="邮箱、网址或其他你愿意展示的信息" /></label></div></div>
      <section className="zenix-editor-orbit-section"><div className="zenix-editor-orbit-heading"><span>首页卡片封面</span><small>默认跟随每个列表的第一首歌曲；上传图片后可单独覆盖。</small></div><div className="zenix-editor-orbit-grid">{cards.filter((card): card is OrbitCard & { id: OrbitCoverKey } => card.id !== 'settings').map(card => { const cover = draft.orbitCovers[card.id] || defaultCovers[card.id]; return <div className="zenix-editor-orbit-item" key={card.id}><div className="zenix-editor-orbit-preview">{cover ? <img src={cover} alt="" /> : <card.icon size={28} strokeWidth={1.25} />}</div><strong>{card.label}</strong><small>{draft.orbitCovers[card.id] ? '自定义封面' : '跟随列表'}</small><label className="zenix-editor-orbit-upload"><ImagePlus size={13} />更换<input type="file" accept="image/*" hidden onChange={event => void chooseOrbitCover(event, card.id)} /></label>{draft.orbitCovers[card.id] && <button type="button" onClick={() => setDraft(current => ({ ...current, orbitCovers: { ...current.orbitCovers, [card.id]: '' } }))}>恢复默认</button>}</div>; })}</div></section>
      <section className="zenix-editor-space-section"><div className="zenix-editor-orbit-heading"><span>空间与应用信息</span><small>Zenix v{appVersion} · 本地桌面播放器</small></div><div className="zenix-editor-space-content"><div className="zenix-editor-space-preview">{appearanceBackground?.kind === 'image' && <img src={appearanceBackground.url} alt="当前空间背景" />}{appearanceBackground?.kind === 'video' && <video src={appearanceBackground.url} autoPlay loop muted playsInline aria-label="当前动态背景" />}{!appearanceBackground && <span>Z</span>}</div><div className="zenix-editor-space-details"><strong>{appearanceBackground?.name || '当前使用默认背景'}</strong><small>{appearanceBackground?.kind === 'video' ? '动态视频背景' : appearanceBackground?.kind === 'image' ? '静态照片背景' : '可以选择照片或视频作为个人空间背景'}</small><div className="zenix-editor-space-actions"><button type="button" onClick={() => void onChooseBackground?.()} disabled={!onChooseBackground || appearanceBusy}><ImagePlus size={14} />{appearanceBackground ? '更换背景' : '添加背景'}</button>{appearanceBackground && <button type="button" onClick={() => void onClearBackground?.()} disabled={!onClearBackground || appearanceBusy}><Trash2 size={14} />移除背景</button>}{onReplayIntro && <button type="button" onClick={() => { setEditing(false); onReplayIntro(); }}><RotateCcw size={14} />重播开屏</button>}</div></div></div></section>
      {(draft.about || draft.tags || draft.contact) && <div className="zenix-editor-info-preview"><span>信息预览</span>{draft.about && <p>{draft.about}</p>}{draft.tags && <div>{draft.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).map(tag => <em key={tag}>{tag}</em>)}</div>}{draft.contact && <small>{draft.contact}</small>}</div>}{saveError && <p className="zenix-editor-error" role="alert">{saveError}</p>}
      <footer><button type="button" onClick={() => setEditing(false)}>取消</button><button type="submit"><Check size={15} />保存名片</button></footer>
    </form></div>, document.body)}
  </div>;
}
