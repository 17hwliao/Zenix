import {useLayoutEffect, useRef, useState} from 'react';
import SkinCharacter from './SkinCharacter';

type Point = {x: number; y: number};
type Drag = {id: number; start: Point; origin: Point; events: AbortController};

const arrowOffsets: Record<string, Point> = {
  ArrowLeft: {x: -16, y: 0}, ArrowRight: {x: 16, y: 0},
  ArrowUp: {x: 0, y: -16}, ArrowDown: {x: 0, y: 16},
};

export default function AssistantCornerCharacter({hidden, phase, invoke, onOpen}: {
  hidden: boolean;
  phase: string;
  invoke: <T = unknown>(args: Record<string, unknown>) => Promise<T>;
  onOpen: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const character = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);
  const [position, setPosition] = useState<Point>();
  const [dragging, setDragging] = useState(false);

  const move = (next: Point) => {
    const area = layer.current;
    const body = character.current;
    if (!area?.offsetWidth || !body) return;
    const x = Math.max(0, Math.min(next.x, area.clientWidth - body.offsetWidth));
    const y = Math.max(0, Math.min(next.y, area.clientHeight - body.offsetHeight));
    setPosition(previous => previous?.x === x && previous.y === y ? previous : {x, y});
  };

  useLayoutEffect(() => {
    if (hidden || !layer.current || !character.current) return;
    const area = layer.current;
    const body = character.current;
    const observer = new ResizeObserver(() => {
      if (body.style.left) move({x: body.offsetLeft, y: body.offsetTop});
    });
    observer.observe(area);
    observer.observe(body);
    return () => {
      observer.disconnect();
      drag.current?.events.abort();
      drag.current = null;
    };
  }, [hidden]);

  const endDrag = (id: number) => {
    if (drag.current?.id !== id) return;
    drag.current.events.abort();
    drag.current = null;
    setDragging(false);
  };

  return <div className="assistant-corner-layer" ref={layer} hidden={hidden}>
    <button ref={character} type="button" className="assistant-corner-character" data-state={phase}
      data-dragging={!hidden && dragging} aria-label="打开星音对话" title="点击打开星音，拖动或用方向键移动"
      style={position ? {left: position.x, top: position.y, right: 'auto', bottom: 'auto'} : undefined}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || drag.current) return;
        const body = event.currentTarget;
        const id = event.pointerId;
        const events = new AbortController();
        const gesture = {id, events, start: {x: event.clientX, y: event.clientY}, origin: {x: body.offsetLeft, y: body.offsetTop}};
        drag.current = gesture;
        moved.current = false;
        setDragging(false);
        const options = {capture: true, signal: events.signal};
        window.addEventListener('pointermove', moveEvent => {
          if (moveEvent.pointerId !== id) return;
          const dx = moveEvent.clientX - gesture.start.x;
          const dy = moveEvent.clientY - gesture.start.y;
          if (!moved.current && Math.hypot(dx, dy) < 5) return;
          if (!moved.current) {
            moved.current = true;
            setDragging(true);
          }
          move({x: gesture.origin.x + dx, y: gesture.origin.y + dy});
        }, options);
        window.addEventListener('pointerup', upEvent => endDrag(upEvent.pointerId), options);
        window.addEventListener('pointercancel', cancelEvent => endDrag(cancelEvent.pointerId), options);
        window.addEventListener('blur', () => endDrag(id), options);
        if (event.nativeEvent.isTrusted) body.setPointerCapture(id);
      }}
      onLostPointerCapture={event => endDrag(event.pointerId)}
      onKeyDown={event => {
        const offset = arrowOffsets[event.key];
        if (!offset || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        const body = event.currentTarget;
        move({x: body.offsetLeft + offset.x, y: body.offsetTop + offset.y});
      }}
      onClick={event => {
        if (event.detail > 0 && moved.current) return;
        onOpen();
      }}>
      {!hidden && <SkinCharacter state={phase} invoke={invoke}/>}
    </button>
  </div>;
}
