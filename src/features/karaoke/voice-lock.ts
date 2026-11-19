let locked = false;

export function karaokeOwnsMicrophone() {
  return locked;
}

export function setKaraokeVoiceLock(active: boolean, mobile: boolean) {
  locked = active;
  if (active) window.dispatchEvent(new Event('zenix-karaoke-voice-lock'));
  if (!mobile) {
    void window.yzqxy?.companion?.invoke({operation: 'assistant', action: 'karaokeVoiceLock', active}).catch(() => {});
  }
}
