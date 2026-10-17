import { memo } from 'react';
import { Dithering, MeshGradient } from '@paper-design/shaders-react';

// A quiet blue/violet backdrop; custom user media is rendered separately.
const meshColors = ['#15253a', '#485474', '#15253a', '#54445e', '#0a101b', '#2b4355'];

type ShaderBackdropProps = {
  surface: 'home' | 'player';
  playing: boolean;
  reduceMotion: boolean;
};

function ShaderBackdrop({ surface, playing, reduceMotion }: ShaderBackdropProps) {
  const motionScale = reduceMotion ? 0 : playing ? 1 : .12;
  const meshSpeed = surface === 'home' ? 0 : .3 * motionScale;
  const ditherSpeed = surface === 'home' ? 0 : .1 * motionScale;

  return <div className={`yz-shader-background yz-shader-background--${surface}`} aria-hidden="true">
    <MeshGradient className="yz-shader-mesh" colors={meshColors} distortion={.8} swirl={.1} speed={meshSpeed} maxPixelCount={409_600} />
    <Dithering className="yz-shader-dither" colorBack="#090f1b" colorFront="#50647f" shape="warp" type="4x4" size={2.5} speed={ditherSpeed} maxPixelCount={409_600} />
    <div className="yz-shader-veil" />
  </div>;
}

export default memo(ShaderBackdrop);
