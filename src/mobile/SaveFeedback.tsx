import { motion, useReducedMotion } from 'framer-motion';
import { Heart, Star } from 'lucide-react';

// Uses the existing MIT Motion spring animation and ISC Lucide icon assets.
export default function SaveFeedback({ kinds }: { kinds: ('liked' | 'favorites')[] }) {
  const reduced = useReducedMotion();
  return <div className="song-save-feedback" role="status" aria-label="歌曲已保存">
    <motion.div className="save-halo" initial={{ scale: reduced ? 1 : .3, opacity: .8 }} animate={{ scale: reduced ? 1 : 2.3, opacity: 0 }} transition={{ duration: .65 }} />
    <motion.div className="save-symbols" initial={{ scale: reduced ? 1 : .2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 14 }}>
      {kinds.includes('liked') && <Heart className="liked" fill="currentColor" />}{kinds.includes('favorites') && <Star className="favorites" fill="currentColor" />}
    </motion.div>
    {!reduced && Array.from({ length: 6 }, (_, i) => { const angle = i * Math.PI / 3; return <motion.i key={i} initial={{ x: 0, y: 0, opacity: 1, scale: .3 }} animate={{ x: Math.cos(angle) * 95, y: Math.sin(angle) * 95, opacity: 0, scale: 1 }} transition={{ duration: .7 }} />; })}
    <span>{kinds.length === 2 ? '已加入喜欢和收藏' : kinds[0] === 'liked' ? '已加入喜欢' : '已加入收藏'}</span>
  </div>;
}
