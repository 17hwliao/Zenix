import {useEffect} from 'react';
import {installUiSoundFeedback} from '../core/sounds';
import '../features/themes/application-surfaces.css';
import {installAppearance} from '../../public/ui/appearance.js';
import '../../public/ui/application-style.css';

let users = 0;
let teardown: (() => void) | undefined;

/** One document-wide owner shared by the shell, portals and optional hosts. */
export function useApplicationExperience(mobile = false) {
  useEffect(() => {
    if (users++ === 0) {
      const root = document.documentElement;
      const owned = !root.classList.contains('zenix-unified-ui');
      const previousMotion = root.getAttribute('data-ui-motion');
      root.classList.add('zenix-unified-ui');
      const stopAppearance = installAppearance(document);
      const motion = (event?: Event) => {
        try {
          const value = event ? (event as CustomEvent).detail?.motion : JSON.parse(localStorage.getItem('zenix.space.features.v1') || '{}').motion;
          root.setAttribute('data-ui-motion', value === 'reduced' ? 'reduced' : 'full');
        } catch { root.setAttribute('data-ui-motion', 'full'); }
      };
      motion(); window.addEventListener('zenix-space-settings', motion);
      const stopSounds = installUiSoundFeedback(document, mobile);
      teardown = () => {
        stopSounds(); stopAppearance(); window.removeEventListener('zenix-space-settings', motion);
        if (owned) root.classList.remove('zenix-unified-ui');
        if (previousMotion === null) root.removeAttribute('data-ui-motion'); else root.setAttribute('data-ui-motion', previousMotion);
      };
    }
    return () => { if (--users === 0) {teardown?.();teardown = undefined;} };
  }, [mobile]);
}
