import { useState, type ReactNode } from 'react';
import { motion, useReducedMotion, useIsPresent } from 'framer-motion';
import { Disc3, Trash2 } from 'lucide-react';
import type { Track } from '../core/types';
import { Art } from './Player';
import { useSongGesture } from './useSongGesture';

export default function SwipeTrackRow({ song, current, play, longPress, remove, actions }: { song: Track; current: boolean; play: () => void; longPress: () => void; remove: () => Promise<boolean>; actions: ReactNode }) {
  const [busy, setBusy] = useState(false), reduced = useReducedMotion(), present=useIsPresent();
  async function erase() { if (busy||!present) return; setBusy(true); try { if(!await remove())setBusy(false); } catch {setBusy(false);} }
  const gesture = useSongGesture(longPress, () => { void erase(); }, busy||!present);
  return <motion.div className="swipe-track-shell" layout initial={false} exit={{ opacity: 0, height: 0, pointerEvents:'none' }} transition={{ duration: reduced ? 0 : .18 }}>
    <div className={`swipe-track-underlay ${gesture.offset >= 0 ? 'swipe-right' : 'swipe-left'}`} aria-hidden="true"><Trash2 /><span>移出列表</span></div>
    <div className="list-row swipe-track-row" inert={busy||!present} {...gesture.handlers} style={{ transform: `translateX(${gesture.offset}px)`, transition: gesture.offset ? 'none' : 'transform .18s ease' }}>
      <button disabled={busy||!present} aria-label={`播放 ${song.title}`} onClick={play}><Art track={song} /><span>{song.title}<small>{song.artist}</small></span>{current && <Disc3 />}</button>
      {actions}<button className="swipe-delete" disabled={busy||!present} aria-label={`移出 ${song.title}`} onClick={() => void erase()}><Trash2 /></button>
    </div>
  </motion.div>;
}
