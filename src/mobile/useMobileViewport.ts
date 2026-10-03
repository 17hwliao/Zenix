import { useEffect } from 'react';

/** Native IME and visualViewport can resize independently; never subtract twice. */
export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let baseline = window.innerHeight, nativeOpen = false, nativeHeight = Infinity, frame = 0;
    const editable = () => document.activeElement instanceof HTMLElement && document.activeElement.matches('input:not([type=range]):not([type=color]),textarea,[contenteditable=true]');
    const update = () => {
      const height = Math.min(viewport?.height || window.innerHeight, nativeOpen ? nativeHeight : Infinity);
      const open = nativeOpen || (editable() && height < baseline - 100);
      if (!open && !editable()) baseline = window.innerHeight;
      document.documentElement.style.setProperty('--visible-height', `${height}px`);
      document.documentElement.classList.toggle('keyboard-open', open);
      cancelAnimationFrame(frame);
      if (open) frame = requestAnimationFrame(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement) || !editable()) return;
        const rect = element.getBoundingClientRect(), top = viewport?.offsetTop || 0;
        if (rect.bottom > top + height - 24 || rect.top < top + 16) element.scrollIntoView({ block: 'center', behavior: 'auto' });
      });
    };
    const native = (event: Event) => {
      const detail = (event as CustomEvent<{ open: boolean; height: number }>).detail;
      nativeOpen = !!detail?.open;
      nativeHeight = detail?.height > 0 ? detail.height : Infinity;
      update();
    };
    const orientation = () => { baseline = window.innerHeight; update(); };
    window.addEventListener('zenix-keyboard', native);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', orientation);
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    document.addEventListener('focusin', update); document.addEventListener('focusout', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('zenix-keyboard', native); window.removeEventListener('resize', update); window.removeEventListener('orientationchange', orientation);
      viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update); document.removeEventListener('focusout', update);
      document.documentElement.classList.remove('keyboard-open');
    };
  }, []);
}
