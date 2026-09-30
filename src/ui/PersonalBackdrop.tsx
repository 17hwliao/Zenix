import { memo, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useDocumentVisible } from '../core/useDocumentVisible';
import type { AppearanceBackground } from '../core/types';
import './PersonalBackdrop.css';

export type PersonalScene = 'home' | 'player' | 'search' | 'collection' | 'settings' | 'queue' | 'intro';
type PersonalBackdropProps = { background: AppearanceBackground | null; scene: PersonalScene };

const sceneStrength: Record<PersonalScene, number> = {
  home: .82,
  player: .59,
  search: .69,
  collection: .57,
  settings: .48,
  queue: .45,
  intro: .66,
};
const sceneShade: Record<PersonalScene, number> = {
  home: .16,
  player: .3,
  search: .28,
  collection: .33,
  settings: .41,
  queue: .44,
  intro: .35,
};

function sampleTone(media: HTMLImageElement | HTMLVideoElement): { brightness: number; contrast: number } | null {
  const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (!width || !height) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 20;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    const scale = Math.max(canvas.width / width, canvas.height / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    context.drawImage(media, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    let squares = 0;
    let weights = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4;
        const brightness = (.2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2]) / 255;
        const weight = x > 7 && x < 25 && y > 3 && y < 17 ? 2 : 1;
        total += brightness * weight;
        squares += brightness * brightness * weight;
        weights += weight;
      }
    }
    const average = total / weights;
    return { brightness: average, contrast: Math.sqrt(Math.max(0, squares / weights - average * average)) };
  } catch { return null; }
}

function PersonalBackdrop({ background, scene }: PersonalBackdropProps) {
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
  const [tone, setTone] = useState({ brightness: .48, contrast: .22 });
  const [failed, setFailed] = useState(false);
  const visible = useDocumentVisible();

  useEffect(() => { setFailed(false); setTone({ brightness: .48, contrast: .22 }); }, [background?.url]);
  useEffect(() => {
    if (!visible || background?.kind !== 'video') return;
    const timer = window.setInterval(() => {
      const media = mediaRef.current;
      if (!(media instanceof HTMLVideoElement) || media.readyState < 2) return;
      const next = sampleTone(media);
      if (next) setTone(previous => ({ brightness: previous.brightness * .55 + next.brightness * .45, contrast: previous.contrast * .55 + next.contrast * .45 }));
    }, 2600);
    return () => window.clearInterval(timer);
  }, [visible, background?.kind, background?.url]);

  if (!visible || !background || failed) return null;
  const brightPenalty = Math.max(0, tone.brightness - .3) * .68;
  const contrastPenalty = Math.max(0, tone.contrast - .24) * .3;
  const strength = Math.max(.2, Math.min(.86, sceneStrength[scene] * (1 - brightPenalty - contrastPenalty) * (background.kind === 'video' ? .86 : 1)));
  const shade = Math.min(.75, sceneShade[scene] + tone.brightness * .19 + tone.contrast * .08);
  const style = { '--personal-strength': String(strength), '--personal-shade': String(shade) } as CSSProperties;
  const updateTone = () => {
    const next = mediaRef.current && sampleTone(mediaRef.current);
    if (next) setTone(next);
  };

  return <div className={`zenix-personal-backdrop zenix-personal-backdrop--${scene}`} style={style} aria-hidden="true">
    {background.kind === 'video'
      ? <video key={background.url} ref={mediaRef as RefObject<HTMLVideoElement>} className="zenix-personal-media" src={background.url} crossOrigin="anonymous" autoPlay muted loop playsInline preload="auto" onLoadedData={updateTone} onError={() => setFailed(true)} />
      : <img key={background.url} ref={mediaRef as RefObject<HTMLImageElement>} className="zenix-personal-media" src={background.url} crossOrigin="anonymous" alt="" onLoad={updateTone} onError={() => setFailed(true)} />}
    <div className="zenix-personal-veil" />
  </div>;
}
export default memo(PersonalBackdrop);
