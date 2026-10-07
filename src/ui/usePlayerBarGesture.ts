import { useCallback, useEffect, useRef } from 'react';

// Keep the bar mounted long enough to distinguish a single click from a double
// click/tap. Transport buttons and sliders keep their own immediate actions.
export function usePlayerBarGesture(single: () => void, expand: () => void) {
  const actions = useRef({ single, expand }); actions.current = { single, expand };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef<number | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(() => {
    const now = performance.now(); clearTimeout(timer.current);
    if (last.current !== null && now - last.current < 330) {
      last.current = null; actions.current.expand();
    } else {
      last.current = now;
      timer.current = setTimeout(() => { last.current = null; actions.current.single(); }, 330);
    }
  }, []);
}
