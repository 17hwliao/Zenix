import { useEffect, useRef, useState } from 'react';
import lottie from 'lottie-web/build/player/lottie_light';
import { zenixIntroAnimation } from './zenixIntroAnimation';
import PersonalBackdrop from './PersonalBackdrop';
import type { AppearanceBackground } from '../core/types';
import './ZenixIntro.css';

type ZenixIntroProps = { onFinish: () => void; background?: AppearanceBackground | null };

export default function ZenixIntro({ onFinish, background = null }: ZenixIntroProps) {
  const animationRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let ending = false;
    let exitTimer: number | undefined;
    const finish = () => {
      if (ending) return;
      ending = true;
      setLeaving(true);
      exitTimer = window.setTimeout(onFinish, 430);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = window.setTimeout(finish, 420);
      return () => { window.clearTimeout(timer); window.clearTimeout(exitTimer); };
    }
    const animation = animationRef.current && lottie.loadAnimation({
      container: animationRef.current,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      animationData: zenixIntroAnimation,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true },
    });
    animation?.addEventListener('complete', finish);
    const fallback = window.setTimeout(finish, 3600);
    return () => {
      window.clearTimeout(fallback);
      window.clearTimeout(exitTimer);
      animation?.removeEventListener('complete', finish);
      animation?.destroy();
    };
  }, [onFinish]);

  return <div className={`zenix-intro${leaving ? ' is-leaving' : ''}`} role="status" aria-label="Zenix 正在启动">
    <PersonalBackdrop background={background} scene="intro" />
    <div className="zenix-intro-aura" aria-hidden="true" />
    <div className="zenix-intro-horizon" aria-hidden="true" />
    <div className="zenix-intro-content">
      <div className="zenix-intro-emblem" ref={animationRef} aria-hidden="true" />
      <div className="zenix-intro-wordmark">Zenix</div>
      <div className="zenix-intro-caption"><span />SOUND IN MOTION<span /></div>
    </div>
    <button className="zenix-intro-skip" type="button" onClick={() => { setLeaving(true); window.setTimeout(onFinish, 430); }}>跳过开屏</button>
  </div>;
}
