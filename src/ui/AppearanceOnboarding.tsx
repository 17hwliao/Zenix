import { ImagePlus, MoveUpRight, Video } from 'lucide-react';
import './AppearanceOnboarding.css';

type AppearanceOnboardingProps = {
  busy: boolean;
  onChoose: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
};

export default function AppearanceOnboarding({ busy, onChoose, onSkip }: AppearanceOnboardingProps) {
  return <div className="zenix-onboarding" role="dialog" aria-modal="true" aria-labelledby="zenix-onboarding-title">
    <div className="zenix-onboarding-glow" aria-hidden="true" />
    <div className="zenix-onboarding-card">
      <div className="zenix-onboarding-mark"><ImagePlus size={22} strokeWidth={1.5} /><span>01 / PERSONAL SPACE</span></div>
      <h1 id="zenix-onboarding-title">让音乐空间<br /><em>成为你的风景</em></h1>
      <p>选择一张照片或一段视频。Zenix 会根据画面明暗，在开屏、首页和面板中自动调整呈现强度。</p>
      <div className="zenix-onboarding-actions">
        <button className="zenix-onboarding-primary" onClick={() => void onChoose()} disabled={busy}><ImagePlus size={17} />{busy ? '正在处理…' : '选择照片或视频'}<MoveUpRight size={15} /></button>
        <button className="zenix-onboarding-skip" onClick={() => void onSkip()} disabled={busy}>暂时跳过</button>
      </div>
      <div className="zenix-onboarding-foot"><Video size={13} /><span>之后可在「设置 → 外观」随时更换或移除</span></div>
    </div>
  </div>;
}
