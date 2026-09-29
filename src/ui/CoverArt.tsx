import { useEffect, useState, type CSSProperties } from 'react';
import { Music2 } from 'lucide-react';

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

export default function CoverArt({ title, coverUrl, className = '' }: { title: string; coverUrl?: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => { setFailedUrl(null); }, [coverUrl]);
  const showImage = Boolean(coverUrl && failedUrl !== coverUrl);
  return (
    <div className={`yz-cover ${className}`} style={coverStyle(title)} aria-hidden="true">
      {showImage ? <img src={coverUrl} alt="" draggable={false} onError={() => setFailedUrl(coverUrl || null)} /> : <><span className="yz-cover-light" /><Music2 className="yz-cover-note" strokeWidth={1.1} /></>}
    </div>
  );
}
