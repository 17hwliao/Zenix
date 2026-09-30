import { useSyncExternalStore } from 'react';
const subscribe = (callback: () => void) => {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
};
const snapshot = () => document.visibilityState !== 'hidden';
export const useDocumentVisible = () => useSyncExternalStore(subscribe, snapshot);
