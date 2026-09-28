import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, Disc3, FolderOpen, Heart, History, ImagePlus, ListMusic, Music2, Pencil, Plus, Search, Settings2, Star, Upload, X } from 'lucide-react';
import type { PersonalState } from '../core/types';
import type { TrackView } from './types';
import CoverArt from './CoverArt';
import './PersonalHome.css';

type Props = {
  personal: PersonalState; tracks: TrackView[]; currentTrack: TrackView | null;
  onPlayTrack: (track: TrackView, queue?: TrackView[]) => void; onOpenPlayer: () => void;
  onOpenSearch: (query: string) => void; onOpenManager: (id: string) => void; onOpenSettings: () => void;
  onChooseBackground?: () => void | Promise<void>; onImportFolder: () => void | Promise<void>;
  onAddFiles?: () => void | Promise<void>; onOpenLocalLibrary?: () => void;
  onImportPlaylist?: () => void | Promise<void>;
};
type OrbitCoverKey = 'liked' | 'favorites' | 'history' | 'playlists' | 'library';
type Profile = { name: string; tagline: string; cardLine: string; cardNumber: string; about: string; tags: string; contact: string; subject: string; background: string; orbitCovers: Record<OrbitCoverKey, string> };
const PROFILE_KEY = 'zenix.profile.card.v2';
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

export default function PersonalHome({ personal, tracks, currentTrack, onPlayTrack, onOpenPlayer, onOpenSearch, onOpenManager, onOpenSettings, onChooseBackground, onImportFolder, onAddFiles, onOpenLocalLibrary, onImportPlaylist }: Props) {
  const [profile, setProfile] = useState<Profile>(readProfile);
  const [draft, setDraft] = useState<Profile>(profile);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [query, setQuery] = useState('');
  const stageRef = useRef<HTMLElement>(null), ringRef = useRef<HTMLDivElement>(null), holoRef = useRef<HTMLButtonElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null), backgroundInputRef = useRef<HTMLInputElement>(null);
  const rotation = useRef(0), velocity = useRef(0);
  const pointer = useRef<{ id: number; x: number; distance: number; target: HTMLElement } | null>(null);
  const suppressClick = useRef(false);
  const suggested = useMemo(() => {
    const word = query.trim().toLocaleLowerCase();
    return word ? tracks.filter(track => `${track.title} ${track.artist}`.toLocaleLowerCase().includes(word)).slice(0, 4) : [];
  }, [query, tracks]);
  const historyTracks = personal.history.slice(0, 24).map(entry => entry.track);
  const defaultCovers: Record<OrbitCoverKey, string | undefined> = {
    liked: personal.liked[0]?.coverUrl,
    favorites: personal.favorites[0]?.coverUrl,
    history: personal.history[0]?.track.coverUrl,
    playlists: personal.playlists[0]?.tracks[0]?.coverUrl,
    library: tracks[0]?.coverUrl,
  };
  const cards: OrbitCard[] = [
    { id: 'liked', label: '我的喜欢', caption: `${personal.liked.length} 首歌曲`, icon: Heart, image: profile.orbitCovers.liked || defaultCovers.liked, action: () => onOpenManager('liked') },
    { id: 'favorites', label: '我的收藏', caption: `${personal.favorites.length} 首歌曲`, icon: Star, image: profile.orbitCovers.favorites || defaultCovers.favorites, action: () => onOpenManager('favorites') },
    { id: 'history', label: '听歌历史', caption: `${personal.history.length} 首歌曲`, icon: History, image: profile.orbitCovers.history || defaultCovers.history, action: () => onOpenManager('history') },
    { id: 'playlists', label: '自定义歌单', caption: `${personal.playlists.length} 个歌单`, icon: ListMusic, image: profile.orbitCovers.playlists || defaultCovers.playlists, action: () => onOpenManager('playlists') },
    { id: 'library', label: '本地曲库', caption: `${tracks.length} 首音乐`, icon: FolderOpen, image: profile.orbitCovers.library || defaultCovers.library, action: () => onOpenLocalLibrary ? onOpenLocalLibrary() : onOpenManager('playlists') },
    { id: 'settings', label: '个性化设置', caption: '背景 · 音效 · 桌面歌词', icon: Settings2, action: onOpenSettings },
  ];

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const rotateOnWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      velocity.current = Math.max(-5, Math.min(5, velocity.current + delta * .025));
    };
    stage.addEventListener('wheel', rotateOnWheel, { passive: false });
    return () => stage.removeEventListener('wheel', rotateOnWheel);
  }, []);
  useEffect(() => {
    let frame = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = () => {
      if (!pointer.current) {
        rotation.current += reduced ? 0 : .075;
        rotation.current += velocity.current;
        velocity.current *= .94;
        if (Math.abs(velocity.current) < .001) velocity.current = 0;
      }
      const ring = ringRef.current;
      if (ring) {
        ring.style.transform = `rotateY(${rotation.current}deg)`;
        Array.from(ring.children).forEach((child, index) => {
          const depth = (Math.cos((index * 60 + rotation.current) * Math.PI / 180) + 1) / 2;
          (child as HTMLElement).style.opacity = String(.48 + depth * .52);
          (child as HTMLElement).style.filter = `brightness(${.58 + depth * .42})`;
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
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
    if ((event.target as Element).closest('.zenix-card-center, input, form, a')) return;
    suppressClick.current = false;
    const target = ((event.target as Element).closest('button') as HTMLElement | null) || event.currentTarget;
    pointer.current = { id: event.pointerId, x: event.clientX, distance: 0, target };
    velocity.current = 0; target.setPointerCapture(event.pointerId);
  };
  const onStageMove = (event: PointerEvent<HTMLDivElement>) => {
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
  const playQuick = (event: FormEvent) => { event.preventDefault(); if (suggested[0]) { onPlayTrack(suggested[0], suggested); onOpenPlayer(); } else onOpenSearch(query); };
  const handleOrbitClick = (action: () => void) => { if (suppressClick.current) { suppressClick.current = false; return; } action(); };

  return <div className="zenix-home-space">
    <header className="zenix-home-top"><span className="zenix-home-logo">Zenix<span>.</span></span><div><button onClick={onOpenSettings} title="个性化设置"><Settings2 size={17} />设置</button><button onClick={onOpenPlayer} title="进入贴纸播放器"><Disc3 size={18} />进入音乐空间<ArrowRight size={16} /></button></div></header>
    <div className="zenix-home-scroll">
      <section ref={stageRef} className="zenix-space-stage" aria-label="个人音乐空间" onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp}>
        <div className="zenix-stage-aura" aria-hidden="true" />
        <div className="zenix-stage-heading"><span>PERSONAL SPACE / {profile.cardNumber}</span><strong>你的音乐，自成宇宙。</strong><small>拖动或滚轮旋转 · 点击卡片打开</small></div>
        <div className="zenix-orbit-scene"><div className="zenix-orbit-guide" aria-hidden="true" /><div className="zenix-orbit-ring" ref={ringRef}>
          {cards.map((card, index) => <button key={card.id} type="button" className={`zenix-orbit-card${card.image ? ' has-cover' : ''}`} style={{ '--orbit-angle': `${index * 60}deg`, '--card-delay': `${index * 1.2}s` } as CSSProperties} onClick={() => handleOrbitClick(card.action)}>
            {card.image && <img src={card.image} alt="" />}<span className="zenix-orbit-sheen" aria-hidden="true" /><span className="zenix-orbit-no">{String(index + 1).padStart(2, '0')}</span><card.icon className="zenix-orbit-icon" size={38} strokeWidth={1.25} /><span className="zenix-orbit-copy"><strong>{card.label}</strong><small>{card.caption}</small></span><ArrowRight className="zenix-orbit-arrow" size={16} />
          </button>)}
        </div></div>
        <div className="zenix-card-center"><button ref={holoRef} className="zenix-holo-card" type="button" onClick={openEditor} aria-label="编辑个人名片">
          {profile.background && <img className="zenix-holo-background" src={profile.background} alt="" />}<span className="zenix-holo-grid" aria-hidden="true" /><span className="zenix-holo-head"><span>ZENIX / IDENTITY</span><span>{profile.cardNumber}</span></span><span className="zenix-holo-subject">{profile.subject ? <img src={profile.subject} alt="个人名片主体图" /> : <span className="zenix-holo-monogram">{profile.name.slice(0, 1).toUpperCase() || 'Z'}</span>}</span><span className="zenix-holo-words"><strong>{profile.name}</strong><small>{profile.cardLine}</small></span><span className="zenix-holo-foil" aria-hidden="true" /><span className="zenix-holo-glare" aria-hidden="true" /><span className="zenix-holo-edge" aria-hidden="true" />
        </button><div className="zenix-card-shadow" aria-hidden="true" /><button type="button" className="zenix-card-edit" onClick={openEditor}><Pencil size={13} />编辑个人名片</button></div>
        <div className="zenix-stage-profile"><span>ZENIX · {profile.name}</span><p>{profile.tagline}</p>{profile.about && <small>{profile.about}</small>}{profile.tags && <div className="zenix-stage-tags">{profile.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).map(tag => <em key={tag}>{tag}</em>)}</div>}{profile.contact && <small className="zenix-stage-contact">{profile.contact}</small>}<div className="zenix-stage-stats"><b>{tracks.length}</b> 首本地歌曲<i /> <b>{personal.liked.length}</b> 首喜欢<i /> <b>{personal.playlists.length}</b> 个歌单</div></div>
      </section>
      <section className="zenix-home-search-section"><div><span className="zenix-home-eyebrow">QUICK SEARCH</span><h2>下一首，想听什么？</h2></div><form onSubmit={playQuick}><Search size={19} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索本地歌曲，或按 Enter 搜索在线音乐" aria-label="快速搜索歌曲" /><button type="submit" aria-label="搜索"><ArrowRight size={18} /></button></form></section>
      {suggested.length > 0 && <div className="zenix-home-suggestions">{suggested.map(track => <button key={track.id} onClick={() => { onPlayTrack(track, suggested); onOpenPlayer(); }}><CoverArt title={track.title} coverUrl={track.coverUrl} /><span><strong>{track.title}</strong><small>{track.artist}</small></span><ArrowRight size={15} /></button>)}</div>}
      <section className="zenix-home-section"><div className="zenix-home-section-head"><div><span className="zenix-home-eyebrow">YOUR COLLECTION</span><h2>你的收藏，随时继续</h2></div><button onClick={() => onOpenManager('playlists')}>管理歌曲与歌单<ArrowRight size={15} /></button></div>
        {historyTracks.length ? <div className="zenix-recent-strip">{historyTracks.slice(0, 8).map((track, index) => <button key={`${track.id}-${index}`} onClick={() => { onPlayTrack(track, historyTracks); onOpenPlayer(); }}><CoverArt title={track.title} coverUrl={track.coverUrl} /><strong>{track.title}</strong><small>{track.artist}</small></button>)}</div> : <div className="zenix-home-empty"><Music2 size={25} /><span>听过的歌曲会出现在这里</span>{currentTrack && <button onClick={onOpenPlayer}>继续播放</button>}</div>}
      </section>
      <div className="zenix-home-foot"><div><button onClick={() => void onImportFolder()}><Upload size={13} />导入文件夹</button>{onAddFiles && <button onClick={() => void onAddFiles()}><Plus size={13} />添加音乐文件</button>}{onImportPlaylist && <button onClick={() => void onImportPlaylist()}>导入 M3U 歌单</button>}{onChooseBackground && <button onClick={() => void onChooseBackground()}><ImagePlus size={13} />更换空间背景</button>}</div><span>ZENIX · MADE PERSONAL</span></div>
    </div>
    {editing && createPortal(<div className="zenix-profile-editor-mask" onPointerDown={event => { if (event.target === event.currentTarget) setEditing(false); }}><form className="zenix-profile-editor" onSubmit={save}>
      <header><div><span>IDENTITY CARD / EDIT</span><h2>编辑个人名片</h2><p>这里的信息只保存在本机，点击中心卡片可以随时修改。</p></div><button type="button" className="zenix-editor-close" onClick={() => setEditing(false)} aria-label="关闭编辑"><X size={17} /></button></header>
      <div className="zenix-editor-body"><div className="zenix-editor-images"><div className="zenix-editor-mini-card" style={draft.background ? { backgroundImage: `linear-gradient(180deg, rgba(9,10,13,.1), rgba(9,10,13,.84)), url(${JSON.stringify(draft.background)})` } : undefined}>{draft.subject ? <img src={draft.subject} alt="主体图预览" /> : <span>{draft.name.slice(0, 1).toUpperCase() || 'Z'}</span>}<strong>{draft.name || defaults.name}</strong><small>{draft.cardLine || defaults.cardLine}</small></div><div className="zenix-editor-image-actions"><button type="button" onClick={() => subjectInputRef.current?.click()}><ImagePlus size={14} />主体图</button><button type="button" onClick={() => backgroundInputRef.current?.click()}><ImagePlus size={14} />卡面背景</button></div><button type="button" className="zenix-editor-clear" onClick={() => setDraft(current => ({ ...current, subject: '', background: '' }))}>移除卡面图片</button><input ref={subjectInputRef} type="file" accept="image/*" hidden onChange={event => void chooseImage(event, 'subject')} /><input ref={backgroundInputRef} type="file" accept="image/*" hidden onChange={event => void chooseImage(event, 'background')} /></div>
        <div className="zenix-editor-fields"><label>显示名称<input value={draft.name} maxLength={36} onChange={event => update('name', event.target.value)} placeholder="你的名称" /></label><div className="zenix-editor-field-row"><label>卡面副标题<input value={draft.cardLine} maxLength={36} onChange={event => update('cardLine', event.target.value)} placeholder="PERSONAL MUSIC SPACE" /></label><label>卡片编号<input value={draft.cardNumber} maxLength={18} onChange={event => update('cardNumber', event.target.value)} placeholder="NO. 001" /></label></div><label>空间宣言<input value={draft.tagline} maxLength={100} onChange={event => update('tagline', event.target.value)} placeholder="一句话介绍你的音乐空间" /></label><label>关于我<textarea value={draft.about} maxLength={500} onChange={event => update('about', event.target.value)} placeholder="写下你的故事、喜爱的声音，或任何想记录的事" rows={3} /></label><label>个人标签<input value={draft.tags} maxLength={120} onChange={event => update('tags', event.target.value)} placeholder="用逗号分隔，例如 夜间听歌, 摇滚, 旅行" /></label><label>联系信息或主页<input value={draft.contact} maxLength={180} onChange={event => update('contact', event.target.value)} placeholder="邮箱、网址或其他你愿意展示的信息" /></label></div></div>
      <section className="zenix-editor-orbit-section"><div className="zenix-editor-orbit-heading"><span>首页卡片封面</span><small>默认跟随每个列表的第一首歌曲；上传图片后可单独覆盖。</small></div><div className="zenix-editor-orbit-grid">{cards.filter((card): card is OrbitCard & { id: OrbitCoverKey } => card.id !== 'settings').map(card => { const cover = draft.orbitCovers[card.id] || defaultCovers[card.id]; return <div className="zenix-editor-orbit-item" key={card.id}><div className="zenix-editor-orbit-preview">{cover ? <img src={cover} alt="" /> : <card.icon size={28} strokeWidth={1.25} />}</div><strong>{card.label}</strong><small>{draft.orbitCovers[card.id] ? '自定义封面' : '跟随列表'}</small><label className="zenix-editor-orbit-upload"><ImagePlus size={13} />更换<input type="file" accept="image/*" hidden onChange={event => void chooseOrbitCover(event, card.id)} /></label>{draft.orbitCovers[card.id] && <button type="button" onClick={() => setDraft(current => ({ ...current, orbitCovers: { ...current.orbitCovers, [card.id]: '' } }))}>恢复默认</button>}</div>; })}</div></section>
      {(draft.about || draft.tags || draft.contact) && <div className="zenix-editor-info-preview"><span>信息预览</span>{draft.about && <p>{draft.about}</p>}{draft.tags && <div>{draft.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).map(tag => <em key={tag}>{tag}</em>)}</div>}{draft.contact && <small>{draft.contact}</small>}</div>}{saveError && <p className="zenix-editor-error" role="alert">{saveError}</p>}
      <footer><button type="button" onClick={() => setEditing(false)}>取消</button><button type="submit"><Check size={15} />保存名片</button></footer>
    </form></div>, document.body)}
  </div>;
}
