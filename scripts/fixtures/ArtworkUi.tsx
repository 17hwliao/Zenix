import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import CoverArt from '../../src/ui/CoverArt';
function Fixture() {
  const [url, change] = useState('yzqxy://source-cover/fixture/flaky');
  (window as any).changeCover = change;
  return <div style={{ width: 200, height: 200 }}><CoverArt title="Fixture" coverUrl={url} /></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
