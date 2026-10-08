import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export function useSongGesture(onLongPress?: () => void, onSwipe?: () => void, disabled = false) {
  const [offset, setOffset] = useState(0);
  const callbacks = useRef({ onLongPress, onSwipe, disabled }); callbacks.current = { onLongPress, onSwipe, disabled };
  const gesture = useRef<{ id: number; x: number; y: number; at: number; dx: number; horizontal: boolean; moved: boolean } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), consumed = useRef(false);
  const cancelHold = () => clearTimeout(hold.current);
  useEffect(() => () => { clearTimeout(hold.current); }, []);
  const release = (event: ReactPointerEvent<HTMLElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  return {
    offset,
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0 || !event.isPrimary || callbacks.current.disabled || (event.target as Element).closest('.track-actions,.swipe-delete,input')) return;
        cancelHold(); consumed.current = false;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), dx: 0, horizontal: false, moved: false };
        if (callbacks.current.onLongPress) hold.current = setTimeout(() => { if (gesture.current && !gesture.current.moved) { consumed.current = true; callbacks.current.onLongPress?.(); } }, 450);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const value = gesture.current; if (!value || value.id !== event.pointerId) return;
        const dx = event.clientX - value.x, dy = event.clientY - value.y;
        if (Math.hypot(dx, dy) > 8) { cancelHold(); value.moved = true; consumed.current = true; }
        if (!value.horizontal && callbacks.current.onSwipe && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) { value.horizontal = true; consumed.current = true; event.currentTarget.setPointerCapture(event.pointerId); }
        if (value.horizontal) { value.dx = dx; setOffset(Math.max(-125, Math.min(125, dx))); }
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        cancelHold(); const value = gesture.current; gesture.current = null; release(event); setOffset(0);
        if (value?.id === event.pointerId && value.horizontal && Math.abs(value.dx) >= 72) callbacks.current.onSwipe?.();
      },
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => { cancelHold(); gesture.current = null; release(event); setOffset(0); },
      onClickCapture: (event: React.MouseEvent<HTMLElement>) => { if (consumed.current && event.detail !== 0) { consumed.current = false; event.preventDefault(); event.stopPropagation(); } },
      onContextMenu: (event: React.MouseEvent<HTMLElement>) => { if (callbacks.current.onLongPress) { event.preventDefault(); if (!consumed.current) callbacks.current.onLongPress(); consumed.current = true; } },
    },
  };
}
