import { memo, useEffect, useState, type CSSProperties } from 'react';
import { Music2 } from 'lucide-react';
import { useDocumentVisible } from '../core/useDocumentVisible';
import { coverRequestUrl } from '../core/trackCover';

// A local cover is shown when available; otherwise an original color field is generated from its title.
const palette = [
  ['#6d6677', '#272d3a', '#b8a5a9'],
  ['#705957', '#292b35', '#b49a8b'],
  ['#566b72', '#292f38', '#a8b9ad'],
  ['#776d59', '#333038', '#c3ac87'],
  ['#71617a', '#282a39', '#a99fb7'],
];

function coverStyle(seed: string): CSSProperties {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const colors = palette[Math.abs(hash) % palette.length];
  return {
    '--cover-one': colors[0],
    '--cover-two': colors[1],
    '--cover-three': colors[2],
  } as CSSProperties;
}

function CoverImage({ url, visible }: { url: string; visible: boolean }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!failed || !visible || retry >= 2) return;
    const timer = window.setTimeout(() => { setRetry(value => value + 1); setFailed(false); }, retry === 0 ? 750 : 2000);
    return () => window.clearTimeout(timer);
  }, [failed, visible, retry]);
  useEffect(() => {
    const recover = () => { if (failed) { setRetry(0); setFailed(false); } };
    window.addEventListener('online', recover);
    return () => window.removeEventListener('online', recover);
  }, [failed]);
  return visible && !failed
    ? <img key={retry} src={coverRequestUrl(url, retry)} alt="" draggable={false} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <><span className="yz-cover-light" /><Music2 className="yz-cover-note" strokeWidth={1.1} /></>;
}

function CoverArt({ title, coverUrl, className = '' }: { title: string; coverUrl?: string; className?: string }) {
  const visible = useDocumentVisible();
  return (
    <div className={`yz-cover ${className}`} style={coverStyle(title)} aria-hidden="true">
      {coverUrl ? <CoverImage key={coverUrl} url={coverUrl} visible={visible} /> : <><span className="yz-cover-light" /><Music2 className="yz-cover-note" strokeWidth={1.1} /></>}
    </div>
  );
}
export default memo(CoverArt);
