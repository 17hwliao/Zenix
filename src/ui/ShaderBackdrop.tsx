import { memo } from 'react';
import { Dithering, MeshGradient } from '@paper-design/shaders-react';

// Public Paper shaders are composed here with Zenix's own monochrome surface treatment.
const meshColors = ['#71717a', '#f4f4f5', '#71717a', '#f4f4f5', '#09090b', '#f4f4f5'];

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
    <MeshGradient className="yz-shader-mesh" colors={meshColors} distortion={.8} swirl={.1} speed={meshSpeed} maxPixelCount={921_600} />
    <Dithering className="yz-shader-dither" colorBack="#09090b" colorFront="#71717a" shape="warp" type="4x4" size={2.5} speed={ditherSpeed} maxPixelCount={921_600} />
    <div className="yz-shader-veil" />
  </div>;
}

export default memo(ShaderBackdrop);
