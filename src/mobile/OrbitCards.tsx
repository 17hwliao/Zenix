import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import type { Track } from '../core/types';
import { Art } from './Player';

type Card = { title: string; songs: Track[] };
const spring = { type: 'spring' as const, stiffness: 210, damping: 27, mass: .85 };

function Satellite({ card, angle, index, step, open }: { card: Card; angle: ReturnType<typeof useMotionValue<number>>; index: number; step: number; open: () => void }) {
  const phase = useTransform(angle, value => (index * step + value) * Math.PI / 180);
  const x = useTransform(phase, value => Math.sin(value) * 125);
  const y = useTransform(phase, value => 52 - Math.cos(value) * 12);
  const scale = useTransform(phase, value => .69 + (Math.cos(value) + 1) * .115);
  const rotateY = useTransform(phase, value => -Math.sin(value) * 27);
  const opacity = useTransform(phase, value => Math.max(0, Math.min(1, Math.cos(value) * 3)) * .88);
  const [visible, setVisible] = useState(Math.cos(index * step * Math.PI / 180) > .01);
  useEffect(() => phase.on('change', value => setVisible(Math.cos(value) > .01)), [phase]);
  const zIndex = useTransform(phase, value => Math.round(8 + Math.cos(value) * 5));
  return <motion.button className="orbit-satellite glass" style={{ x, y, scale, rotateY, opacity, zIndex, pointerEvents: visible ? 'auto' : 'none' }} tabIndex={visible ? 0 : -1} aria-hidden={!visible} onClick={open} aria-label={card.title}>
    <Art track={card.songs[0]} /><span>{card.title}<small>{card.songs.length} 首歌曲</small></span>
  </motion.button>;
}

/** Every card stays mounted. Dragging changes one continuous angle, then snaps. */
export default function OrbitCards({ cards, gold, onOpen, onEditGold }: { cards: Card[]; gold: ReactNode; onOpen: (index: number) => void; onEditGold: () => void }) {
  const angle = useMotionValue(0), reduced = useReducedMotion();
  const goldY = useMotionValue(0), step = 360 / cards.length;
  const [behind, setBehind] = useState(() => { try { return localStorage.getItem('zenix.mobile.goldLayer') === 'back'; } catch { return false; } });
  const [selected, setSelected] = useState(0);
  const gesture = useRef<{ id: number; x: number; y: number; start: number; lastX: number; time: number; velocity: number; moved: boolean; horizontal: boolean; gold: boolean; vertical: boolean } | null>(null);
  const control = useRef<ReturnType<typeof animate> | null>(null), suppress = useRef(false), destination = useRef(0);
  const goldControl = useRef<ReturnType<typeof animate> | null>(null), tossing = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; control.current?.stop(); goldControl.current?.stop(); }; }, []);
  async function toss() {
    if (tossing.current) return;
    tossing.current = true; suppress.current = true;
    goldControl.current?.stop();
    if (!reduced) { goldControl.current = animate(goldY, -155, { duration: .22, ease: 'easeOut' }); await goldControl.current; }
    if (!alive.current) return;
    setBehind(value => { const next = !value; try { localStorage.setItem('zenix.mobile.goldLayer', next ? 'back' : 'front'); } catch { /* Storage may be unavailable in preview. */ } return next; });
    goldControl.current = animate(goldY, 0, reduced ? { duration: 0 } : { ...spring, stiffness: 175, damping: 23 });
    await goldControl.current; tossing.current = false;
  }
  function snap(value: number) {
    const target = Math.round(value / step) * step;
    destination.current = target;
    setSelected(((Math.round(-target / step) % cards.length) + cards.length) % cards.length);
    control.current?.stop();
    control.current = animate(angle, target, reduced ? { duration: 0 } : spring);
  }
  function open(index: number) { if (!suppress.current) onOpen(index); }
  return <>
    <div className="mobile-orbit continuous-orbit" onPointerDownCapture={event => {
      if (event.button !== 0 || !event.isPrimary || tossing.current || gesture.current) return;
      control.current?.stop(); suppress.current = false;
      goldControl.current?.stop();
      const gold = (event.target as Element).closest('.orbit-gold, .gold-grip') !== null;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, start: angle.get(), time: performance.now(), velocity: 0, moved: false, horizontal: false, gold, vertical: false };
      // Own the pointer before child tap animations or WebView scrolling can claim it.
      if (gold) { event.currentTarget.setPointerCapture(event.pointerId); event.stopPropagation(); }
    }} onPointerMove={event => {
      const drag = gesture.current; if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 9) {
        drag.horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
        drag.vertical = drag.gold && dy < -9 && Math.abs(dy) > Math.abs(dx) * 1.1;
        drag.moved = drag.horizontal || drag.vertical;
        if (drag.moved) event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (drag.vertical) { event.preventDefault(); suppress.current = true; goldY.set(Math.max(-155, Math.min(0, dy))); return; }
      if (!drag.horizontal) return;
      suppress.current = true; const now = performance.now();
      const instantaneous = (event.clientX - drag.lastX) / Math.max(8, now - drag.time);
      drag.velocity = drag.velocity * .55 + instantaneous * .45; drag.lastX = event.clientX; drag.time = now;
      angle.set(drag.start + dx * .38);
    }} onPointerUp={event => {
      const drag = gesture.current; if (!drag || drag.id !== event.pointerId) return;
      if (drag.horizontal) { const speed = performance.now() - drag.time < 90 ? drag.velocity : 0; snap(angle.get() + Math.max(-55, Math.min(55, speed * 65))); }
      if (drag.vertical) { if (goldY.get() <= -56) void toss(); else goldControl.current = animate(goldY, 0, spring); }
      if (drag.gold && !drag.moved) {
        suppress.current = true;
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= 9) onEditGold();
      }
      gesture.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={() => { gesture.current = null; snap(angle.get()); goldControl.current = animate(goldY, 0, spring); }} onClickCapture={event => { if (suppress.current || tossing.current) { event.preventDefault(); event.stopPropagation(); suppress.current = false; } }}>
      <div className="orbit-track" aria-label="环绕卡片">{cards.map((card, index) => <Satellite key={card.title} card={card} index={index} step={step} angle={angle} open={() => open(index)} />)}</div>
      <motion.div className="orbit-gold" style={{ y: goldY, zIndex: behind ? 1 : 20 }}>{gold}</motion.div>
      {behind && <motion.div className="gold-grip" style={{ y: goldY }} role="button" tabIndex={0} aria-label="按住向上拉，取回个人金卡" onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void toss(); } }}><span /></motion.div>}
    </div>
    <div className="orbit-switch"><button aria-label="上一张卡片" onClick={() => snap(destination.current + step)}><ArrowLeft /></button><button className="glass" onClick={() => onOpen(selected)}>{cards[selected].title}<ArrowRight /></button><button aria-label="下一张卡片" onClick={() => snap(destination.current - step)}><ArrowRight /></button><button className="gold-layer-toggle" aria-label={behind ? '将金卡拿回前方' : '将金卡上抛到后方'} onClick={() => void toss()}><ArrowUp /></button></div>
  </>;
}
