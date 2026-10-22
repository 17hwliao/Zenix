export type StickerGeometry = { left: number; top: number; width: number; height: number };

/** Read all interrupted projections before starting any new compositor animation. */
export function projectStickerLayout(elements: Map<string, HTMLElement>, before: Map<string, StickerGeometry>, after: Map<string, StickerGeometry>, animations: Map<string, Animation>, enabled: boolean, duration = 580) {
  if (!enabled) {
    for (const animation of animations.values()) animation.cancel();
    animations.clear(); return;
  }
  const changes: { id: string; element: HTMLElement; dx: number; dy: number; sx: number; sy: number }[] = [];
  for (const [id, element] of elements) {
    const old = before.get(id), next = after.get(id);
    if (!old || !next || old.left === next.left && old.top === next.top && old.width === next.width && old.height === next.height) continue;
    const active = animations.get(id);
    const matrix = active && active.playState !== 'finished' ? new DOMMatrixReadOnly(getComputedStyle(element).transform) : new DOMMatrixReadOnly();
    changes.push({ id, element, dx: old.left + matrix.m41 - next.left, dy: old.top + matrix.m42 - next.top, sx: old.width * matrix.m11 / next.width, sy: old.height * matrix.m22 / next.height });
  }
  for (const { id, element, dx, dy, sx, sy } of changes) {
    animations.get(id)?.cancel(); animations.delete(id);
    if (Math.abs(dx) < .01 && Math.abs(dy) < .01 && Math.abs(sx - 1) < .001 && Math.abs(sy - 1) < .001) continue;
    const animation = element.animate([{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transform: 'none' }], { duration, easing: 'cubic-bezier(.22,1,.36,1)' });
    animations.set(id, animation);
    animation.onfinish = animation.oncancel = () => { if (animations.get(id) === animation) animations.delete(id); };
  }
}
