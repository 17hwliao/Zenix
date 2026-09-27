import { useCallback, useEffect, useRef } from 'react';
import CoverArt from './CoverArt';
import type { LibraryCard } from './library';

// Horizontal card shelf with center-weighted scale and pointer momentum.
type CoverCarouselProps = {
  cards: LibraryCard[];
  focusedIndex: number;
  onFocusedIndexChange: (index: number) => void;
  onSelect: (card: LibraryCard) => void;
};

type DragState = { pointerId: number; x: number; scrollLeft: number; lastTime: number; velocity: number; moved: boolean };

export default function CoverCarousel({ cards, focusedIndex, onFocusedIndexChange, onSelect }: CoverCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const animationRef = useRef<number | null>(null);
  const visualFrameRef = useRef<number | null>(null);
  const closestRef = useRef(0);
  const suppressClickRef = useRef(false);

  const findClosest = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return 0;
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    let closest = 0;
    let distance = Infinity;
    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      const current = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
      if (current < distance) { distance = current; closest = index; }
    });
    return closest;
  }, []);

  const updateVisuals = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    let closest = 0;
    let nearestDistance = Infinity;
    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
      const ratio = Math.max(0, 1 - distance / 600);
      card.style.transform = `scale(${(.5 + ratio * .7).toFixed(3)})`;
      card.style.opacity = String(.15 + ratio * .85);
      card.style.zIndex = String(1 + Math.round(ratio * 9));
      if (distance < nearestDistance) { nearestDistance = distance; closest = index; }
    });
    if (closest !== closestRef.current) {
      closestRef.current = closest;
      onFocusedIndexChange(closest);
    }
  }, [onFocusedIndexChange]);

  const scheduleVisuals = useCallback(() => {
    if (visualFrameRef.current !== null) return;
    visualFrameRef.current = requestAnimationFrame(() => { visualFrameRef.current = null; updateVisuals(); });
  }, [updateVisuals]);

  const centerCard = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current;
    const card = cardRefs.current[index];
    if (!scroller || !card) return;
    scroller.scrollTo({ left: card.offsetLeft + card.offsetWidth / 2 - scroller.clientWidth / 2, behavior });
  }, []);

  useEffect(() => {
    cardRefs.current.length = cards.length;
    centerCard(Math.min(focusedIndex, cards.length - 1), 'instant');
    scheduleVisuals();
  }, [cards, centerCard, scheduleVisuals]);

  useEffect(() => {
    if (focusedIndex !== closestRef.current) centerCard(focusedIndex);
  }, [focusedIndex, centerCard]);

  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    if (visualFrameRef.current !== null) cancelAnimationFrame(visualFrameRef.current);
  }, []);

  const stopMomentum = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    stopMomentum();
    const scroller = scrollerRef.current;
    if (!scroller) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: scroller.scrollLeft, lastTime: performance.now(), velocity: 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scroller = scrollerRef.current;
    if (!drag || !scroller || drag.pointerId !== event.pointerId) return;
    const distance = (drag.x - event.clientX) * 1.5;
    if (Math.abs(distance) > 4) drag.moved = true;
    if (!drag.moved) return;
    event.preventDefault();
    const nextLeft = drag.scrollLeft + distance;
    const now = performance.now();
    drag.velocity = (nextLeft - scroller.scrollLeft) * (16 / Math.max(now - drag.lastTime, 8));
    drag.lastTime = now;
    scroller.scrollLeft = nextLeft;
    scheduleVisuals();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scroller = scrollerRef.current;
    if (!drag || !scroller || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) return;
    suppressClickRef.current = true;
    let velocity = drag.velocity;
    const glide = () => {
      velocity *= .8;
      scroller.scrollLeft += velocity;
      scheduleVisuals();
      if (Math.abs(velocity) > .45) animationRef.current = requestAnimationFrame(glide);
      else { animationRef.current = null; centerCard(findClosest()); }
    };
    animationRef.current = requestAnimationFrame(glide);
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  const onCardClick = (card: LibraryCard, index: number) => {
    if (suppressClickRef.current) return;
    if (index === closestRef.current) onSelect(card);
    else centerCard(index);
  };

  return <div className="yz-cover-shelf" ref={scrollerRef} onScroll={scheduleVisuals} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); centerCard(Math.max(0, Math.min(cards.length - 1, closestRef.current + (event.key === 'ArrowRight' ? 1 : -1)))); } }} tabIndex={0} aria-label="音乐卡片">
    <div className="yz-cover-shelf-track">{cards.map((card, index) => <button key={card.id} ref={element => { cardRefs.current[index] = element; }} className="yz-cover-card" onClick={() => onCardClick(card, index)} aria-label={`${card.title}，${card.subtitle}`}><CoverArt title={card.title} coverUrl={card.coverUrl} /><span className="yz-cover-card-text"><strong>{card.title}</strong><small>{card.subtitle}</small></span></button>)}</div>
  </div>;
}
