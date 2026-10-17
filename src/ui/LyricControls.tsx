import type { LyricDisplay } from '../core/listening';
import './ListeningTools.css';
import GlassSelect from './GlassSelect';
export default function LyricControls({value, change}: {value: LyricDisplay; change: (patch: Partial<LyricDisplay>) => void}) {
  return <details className="listening-lyric-controls"><summary>歌词设置与校正</summary><div className="listening-controls-grid">
    <label>歌词校正<span><button type="button" onClick={() => change({offset: Math.max(-30, Math.round((value.offset - .2) * 10) / 10)})}>提前 0.2s</button><output>{value.offset > 0 ? '+' : ''}{value.offset.toFixed(1)}s</output><button type="button" onClick={() => change({offset: Math.min(30, Math.round((value.offset + .2) * 10) / 10)})}>延后 0.2s</button><button type="button" onClick={() => change({offset: 0})}>重置</button></span></label>
    <label>字号<input aria-label="歌词字号" type="range" min="18" max="44" value={value.fontSize} onChange={event => change({fontSize: +event.target.value})}/></label>
    <label>行距<input aria-label="歌词行距" type="range" min="1.2" max="2.6" step=".1" value={value.lineHeight} onChange={event => change({lineHeight: +event.target.value})}/></label>
    <div className="listening-weight"><span>字重</span><GlassSelect label="歌词字重" value={String(value.weight)} options={[{value:'400',label:'常规'},{value:'600',label:'适中'},{value:'800',label:'加粗'}]} onChange={weight=>change({weight:Number(weight)})}/></div>
    <label><input type="checkbox" checked={value.translation} onChange={event => change({translation: event.target.checked})}/>显示翻译</label>
    <label><input type="checkbox" checked={value.focus} onChange={event => change({focus: event.target.checked})}/>突出当前句</label>
  </div><small>校正仅作用于当前歌曲版本，不修改音频或原歌词文件。</small></details>;
}
