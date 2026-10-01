import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Track } from '../core/types';
import { Art } from './Player';

type Card = { title: string; songs: Track[] };
const spring = { type: 'spring' as const, stiffness: 210, damping: 27, mass: .85 };

function Satellite({ card, angle, index, open }: { card: Card; angle: ReturnType<typeof useMotionValue<number>>; index: number; open: () => void }) {
  const phase = useTransform(angle, value => (index * 60 + value) * Math.PI / 180);
  const x = useTransform(phase, value => Math.sin(value) * 125);
  const y = useTransform(phase, value => 52 - Math.cos(value) * 12);
  const scale = useTransform(phase, value => .69 + (Math.cos(value) + 1) * .115);
  const rotateY = useTransform(phase, value => -Math.sin(value) * 27);
  const opacity = useTransform(phase, value => .32 + (Math.cos(value) + 1) * .34);
  const zIndex = useTransform(phase, value => Math.round(8 + Math.cos(value) * 5));
  return <motion.button className="orbit-satellite glass" style={{ x, y, scale, rotateY, opacity, zIndex }} onClick={open} aria-label={card.title}>
    <Art track={card.songs[0]} /><span>{card.title}<small>{card.songs.length} 首歌曲</small></span>
  </motion.button>;
}

/** Every card stays mounted. Dragging changes one continuous angle, then snaps. */
export default function OrbitCards({ cards, gold, onOpen }: { cards: Card[]; gold: ReactNode; onOpen: (index: number) => void }) {
  const angle = useMotionValue(0), reduced = useReducedMotion();
  const [selected, setSelected] = useState(0);
  const gesture = useRef<{ id: number; x: number; y: number; start: number; lastX: number; time: number; velocity: number; moved: boolean; horizontal: boolean } | null>(null);
  const control = useRef<ReturnType<typeof animate> | null>(null), suppress = useRef(false), destination = useRef(0);
  useEffect(() => () => control.current?.stop(), []);
  function snap(value: number) {
    const target = Math.round(value / 60) * 60;
    destination.current = target;
    setSelected(((Math.round(-target / 60) % cards.length) + cards.length) % cards.length);
    control.current?.stop();
    control.current = animate(angle, target, reduced ? { duration: 0 } : spring);
  }
  function open(index: number) { if (!suppress.current) onOpen(index); }
  return <>
    <div className="mobile-orbit continuous-orbit" onPointerDown={event => {
      if (event.button !== 0) return;
      control.current?.stop(); suppress.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, start: angle.get(), time: performance.now(), velocity: 0, moved: false, horizontal: false };
    }} onPointerMove={event => {
      const drag = gesture.current; if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 9) { drag.moved = true; drag.horizontal = Math.abs(dx) > Math.abs(dy) * 1.15; if (drag.horizontal) event.currentTarget.setPointerCapture(event.pointerId); }
      if (!drag.horizontal) return;
      suppress.current = true; const now = performance.now();
      const instantaneous = (event.clientX - drag.lastX) / Math.max(8, now - drag.time);
      drag.velocity = drag.velocity * .55 + instantaneous * .45; drag.lastX = event.clientX; drag.time = now;
      angle.set(drag.start + dx * .38);
    }} onPointerUp={event => {
      const drag = gesture.current; if (!drag || drag.id !== event.pointerId) return;
      if (drag.horizontal) { const speed = performance.now() - drag.time < 90 ? drag.velocity : 0; snap(angle.get() + Math.max(-55, Math.min(55, speed * 65))); }
      gesture.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={() => { gesture.current = null; snap(angle.get()); }} onClickCapture={event => { if (suppress.current) { event.preventDefault(); event.stopPropagation(); suppress.current = false; } }}>
      <div className="orbit-track" aria-label="环绕卡片">{cards.map((card, index) => <Satellite key={card.title} card={card} index={index} angle={angle} open={() => open(index)} />)}</div>
      <div className="orbit-gold">{gold}</div>
    </div>
    <div className="orbit-switch"><button aria-label="上一张卡片" onClick={() => snap(destination.current + 60)}><ArrowLeft /></button><button className="glass" onClick={() => onOpen(selected)}>{cards[selected].title}<ArrowRight /></button><button aria-label="下一张卡片" onClick={() => snap(destination.current - 60)}><ArrowRight /></button></div>
  </>;
}
