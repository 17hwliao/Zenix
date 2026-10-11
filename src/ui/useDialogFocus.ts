import { useEffect, useRef } from 'react';
export function useDialogFocus(open: boolean, close: () => void) {
  const ref = useRef<HTMLElement>(null), closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null; ref.current?.focus();
    const key = (event: KeyboardEvent) => { if(document.activeElement instanceof Element && document.activeElement.closest('dialog[open]')) return; if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); } else if (event.key === 'Tab') { const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,select:not(:disabled),[tabindex="0"]'); if (!nodes?.length) return; const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); } } };
    window.addEventListener('keydown', key, true); return () => { window.removeEventListener('keydown', key, true); previous?.focus(); };
  }, [open]);
  return ref;
}
