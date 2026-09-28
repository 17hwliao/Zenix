import { useEffect, useState } from 'react';
import { FolderOpen, ImagePlus, RefreshCw, Sparkles, Trash2, Volume2, X } from 'lucide-react';
import type { AppearanceBackground } from '../core/types';
import { getSoundSettings, playUiSound, setSoundSettings, type SoundKind } from '../core/sounds';

type SettingsModalProps = {
  reduceMotion: boolean;
  libraryBusy: boolean;
  appearanceBackground?: AppearanceBackground | null;
  appearanceBusy?: boolean;
  desktopLyricsVisible?: boolean;
  onToggleDesktopLyrics?: () => void;
  onChooseBackground?: () => void | Promise<void>;
  onClearBackground?: () => void | Promise<void>;
  onReduceMotionChange: (value: boolean) => void;
  onImportFolder: () => void | Promise<void>;
  onRefreshLibrary?: () => void | Promise<void>;
  onClose: () => void;
};

export default function SettingsModal({ reduceMotion, libraryBusy, appearanceBackground, appearanceBusy, desktopLyricsVisible, onToggleDesktopLyrics, onChooseBackground, onClearBackground, onReduceMotionChange, onImportFolder, onRefreshLibrary, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<'options' | 'appearance'>('options');
  const [previewError, setPreviewError] = useState(false);
  const [sounds, setSounds] = useState(getSoundSettings);
  const updateSounds = (change: Partial<typeof sounds>) => { const next = { ...sounds, ...change }; setSounds(next); setSoundSettings(next); };
  useEffect(() => setPreviewError(false), [appearanceBackground?.url]);

  return <div className="yz-settings-backdrop" onClick={onClose}>
    <div className="yz-settings-modal" role="dialog" aria-modal="true" aria-label="Zenix 选项" onClick={event => event.stopPropagation()}>
      <div className="yz-settings-top">
        <div className="yz-settings-tabs" role="tablist" aria-label="选项分类">
          <button role="tab" aria-selected={tab === 'options'} className={tab === 'options' ? 'is-active' : ''} onClick={() => setTab('options')}>选项</button>
          <button role="tab" aria-selected={tab === 'appearance'} className={tab === 'appearance' ? 'is-active' : ''} onClick={() => setTab('appearance')}>外观</button>
        </div>
        <button className="yz-settings-close" onClick={onClose} aria-label="关闭"><X size={17} /></button>
      </div>
      {tab === 'options' && <div className="yz-settings-body">
        <div className="yz-settings-intro"><h2>选项</h2><p>调整播放界面的使用方式。</p></div>
        <div className="yz-setting-row"><div><strong>减少动效</strong><small>关闭页面间的过渡动画</small></div><button className={`yz-switch ${reduceMotion ? 'is-on' : ''}`} onClick={() => onReduceMotionChange(!reduceMotion)} role="switch" aria-checked={reduceMotion} aria-label="减少动效"><span /></button></div>
        <div className="yz-setting-row"><div><strong>刷新本地曲库</strong><small>重新读取已导入的音乐</small></div><button className="yz-round-button" onClick={() => void onRefreshLibrary?.()} disabled={!onRefreshLibrary || libraryBusy} aria-label="刷新本地曲库"><RefreshCw size={17} /></button></div>
        <div className="yz-setting-row"><div><strong>导入音乐</strong><small>选择本地音乐文件夹</small></div><button className="yz-round-button" onClick={() => void onImportFolder()} disabled={libraryBusy} aria-label="导入音乐"><FolderOpen size={17} /></button></div>
        <div className="yz-setting-row"><div><strong>桌面歌词</strong><small>悬停显示控制；锁定后点击穿透；Aa 可调整字体与颜色</small></div><button className={`yz-switch ${desktopLyricsVisible ? 'is-on' : ''}`} onClick={onToggleDesktopLyrics} disabled={!onToggleDesktopLyrics} role="switch" aria-checked={Boolean(desktopLyricsVisible)} aria-label="桌面歌词"><span /></button></div>
        <div className="yz-setting-row"><div><strong>界面音效</strong><small>进入、取消和滑动贴纸各自独立</small></div><button className={`yz-switch ${sounds.enabled ? 'is-on' : ''}`} onClick={() => { updateSounds({ enabled: !sounds.enabled }); if (!sounds.enabled) playUiSound('enter'); }} role="switch" aria-checked={sounds.enabled} aria-label="界面音效"><span /></button></div>
        {sounds.enabled && <div className="zenix-sound-options"><label className="zenix-sound-volume"><span>音效音量</span><input type="range" min={0} max={1} step={.01} value={sounds.volume} onChange={event => updateSounds({ volume: Number(event.target.value) })} aria-label="音效音量" /><small>{Math.round(sounds.volume * 100)}%</small></label>{(['enter', 'cancel', 'slide'] as SoundKind[]).map(kind => <label key={kind}><span>{kind === 'enter' ? '进入 / 播放' : kind === 'cancel' ? '取消 / 返回' : '滑动贴纸'}</span><select value={sounds[kind]} onChange={event => { updateSounds({ [kind]: Number(event.target.value) }); playUiSound(kind); }}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>音色 {n}</option>)}</select><button onClick={() => playUiSound(kind)} title={`试听${kind === 'enter' ? '进入' : kind === 'cancel' ? '取消' : '滑动'}音效`} aria-label={`试听${kind === 'enter' ? '进入' : kind === 'cancel' ? '取消' : '滑动'}音效`}><Volume2 size={15} /></button></label>)}</div>}
      </div>}
      {tab === 'appearance' && <div className="yz-settings-body yz-appearance-body">
        <div className="yz-settings-intro"><h2>你的背景</h2><p>让熟悉的画面陪伴每一次聆听。</p></div>
        <div className="yz-appearance-preview">
          {appearanceBackground?.kind === 'image' && !previewError && <img src={appearanceBackground.url} alt="当前自定义背景" onError={() => setPreviewError(true)} />}
          {appearanceBackground?.kind === 'video' && !previewError && <video src={appearanceBackground.url} autoPlay loop muted playsInline aria-label="当前自定义视频背景" onError={() => setPreviewError(true)} />}
          <div className="yz-appearance-preview-veil" />
          <span className="yz-appearance-preview-brand">Zenix<small>{appearanceBackground ? appearanceBackground.kind === 'video' ? '动态背景预览' : '照片背景预览' : '默认动态背景'}</small></span>
          {(!appearanceBackground || previewError) && <Sparkles className="yz-appearance-preview-icon" size={51} strokeWidth={.9} />}
        </div>
        <div className="yz-appearance-file"><strong>{appearanceBackground?.name || '尚未选择背景'}</strong><small>{previewError ? '无法播放或显示此文件，请尝试常见的 H.264 MP4、WebM 或图片格式。' : '开屏、首页、搜索与收藏面板会自动调整明暗和透明度；歌曲贴纸墙保持原貌。'}</small></div>
        <div className="yz-appearance-actions">
          <button className="yz-appearance-choose" onClick={() => void onChooseBackground?.()} disabled={appearanceBusy || !onChooseBackground}><ImagePlus size={16} />{appearanceBackground ? '更换图片或视频' : '选择图片或视频'}</button>
          {appearanceBackground && <button className="yz-appearance-remove" onClick={() => void onClearBackground?.()} disabled={appearanceBusy || !onClearBackground}><Trash2 size={15} />移除背景</button>}
        </div>
      </div>}
    </div>
  </div>;
}
