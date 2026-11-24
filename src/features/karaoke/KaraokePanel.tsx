import {useEffect, useId, useRef, useState, type ChangeEvent} from 'react';
import {AudioLines, ChevronDown, Clock3, FileAudio, FileMusic, Pause, Play, Search, Square} from 'lucide-react';
import type {InstalledSource, RawLyrics, Track} from '../../core/types';
import {activeKaraokeLineIndex} from './adapter';
import {KaraokeErrorNotice, KaraokeLyricStack, formatKaraokeTime} from './ui';
import KaraokeSongSearch from './KaraokeSongSearch';
import SoloPitchGuide from './SoloPitchGuide';
import {isInstrumentalVersion} from './solo-assets';
import {karaokeGradeForScore} from './contracts';
import {listPractice, type PracticeRecord} from './solo-history';
import {chartLicense, findOpenCharts, matchesOpenChart} from './open-charts';
import {useKaraokePreparation} from './prep-controller';
import {localGenerationDependencyHint,localGenerationLabels,localGenerationStages,shouldShowLocalGeneration} from './local-generation';
import {soloGrades, type SoloResult} from './solo-score';
import {useKaraokeSession} from './useKaraokeSession';
import './KaraokePanel.css';

interface KaraokePanelProps {
  mobile: boolean;
  track?: Track;
  tracks: readonly Track[];
  sources: readonly InstalledSource[];
  playbackWasPlaying?: boolean;
  readLyrics(track: Track): Promise<RawLyrics | null>;
}

function ScoreSummary({result}: {result: SoloResult}) {
  return <div className="solo-score-summary">
    <div><small>{result.full ? '全曲总分' : '已唱句平均分'}</small><strong>{result.total}<small> / 100</small></strong></div>
    <dl><div><dt>音准</dt><dd>{result.pitch}</dd></div><div><dt>节奏</dt><dd>{result.rhythm}</dd></div><div><dt>完成度</dt><dd>{result.coverage}</dd></div></dl>
    <span>{soloGrades[result.grade]} · {result.lines.length}/{result.totalLines} 句已评分</span>
    {Boolean(result.sections?.length) && <ul className="solo-section-scores" aria-label="分段评价">{result.sections!.map(section => <li key={section.label}>
      <strong>{section.label} · {section.total} 分</strong><small>{soloGrades[karaokeGradeForScore(section.total)]} · {section.scored}/{section.lines} 句</small>
    </li>)}</ul>}
  </div>;
}

function ScoreLines({result, lyrics}: {result:SoloResult;lyrics:ReadonlyMap<number,string>}) {
  return <ol className="solo-score-lines">{result.lines.map(line => <li key={line.lineIndex}>
    <div><strong>{lyrics.get(line.lineIndex) || '第 '+(line.lineIndex+1)+' 句'}</strong>
      <small>音准 {Math.round(line.pitch ?? 0)} · 节奏 {Math.round(line.rhythm ?? 0)} · 完成度 {Math.round(line.completeness)}</small>
      <p>{line.feedback.join('；')}</p></div><b>{Math.round(line.total)}</b>
  </li>)}</ol>;
}

export default function KaraokePanel({mobile,track,tracks,sources,playbackWasPlaying,readLyrics}: KaraokePanelProps) {
  const [pairSearch,setPairSearch] = useState(false);
  const [chartSearch,setChartSearch] = useState(false);
  const [chartQuery,setChartQuery] = useState(track?.title || '');
  const [manualCandidate,setManualCandidate] = useState<Track>();
  const [historyOpen,setHistoryOpen] = useState(false);
  const [history,setHistory] = useState<PracticeRecord[] | null>(null);
  const [historyError,setHistoryError] = useState(false);
  const [historyLimit,setHistoryLimit] = useState(50);
  const [historySelected,setHistorySelected] = useState<PracticeRecord>();
  const [refresh,setRefresh] = useState(0);
  const pairingInput = useRef<HTMLInputElement>(null);
  const chartInput = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const prep = useKaraokePreparation(track,tracks,sources,mobile,readLyrics);
  const {pair,verifiedChart} = prep;
  const session = useKaraokeSession({track,accompaniment:pair,readLyrics,mobile,otherAudioPlaying:playbackWasPlaying});
  const appliedChart=useRef<typeof verifiedChart>(undefined);
  const currentPair=useRef<Track>(undefined);
  const roundScoring=useRef(false);
  const lines = session.descriptor?.pitchTrack?.lines ?? [];
  const lyricsByIndex = new Map(lines.map(line => [line.index,line.text]));
  const timed = lines.some(line => line.notes.length);
  const index = activeKaraokeLineIndex(lines,session.elapsedMs);
  const line = lines[index];
  const progress = line ? Math.max(0,Math.min(1,(session.elapsedMs-line.startMs)/Math.max(1,line.endMs-line.startMs))) : 0;
  const active = session.status === 'singing' || session.status === 'paused';
  const preparing = session.status === 'requesting';
  const locked = active || preparing;
  const recovering = session.switching || (!mobile && active && Boolean(session.audioProgress));
  const selectable = Boolean(track) && !locked && !prep.working;
  const hasPair = Boolean(pair);
  const scoreReady = Boolean(pair && verifiedChart);
  const mode = hasPair ? session.vocalMode : 'original';
  const startText = mode === 'original' ? '试听原声' : scoreReady ? '开始演唱' : '开始演唱 · 暂不计分';
  const duration = session.descriptor?.durationMs || (track?.duration || 0) * 1000;
  const generationRunning = prep.generation.status === 'running';
  const generationStageIndex = prep.generation.status==='running'
    ? localGenerationStages.indexOf(prep.generation.stage) : -1;
  const generationDependencyHint=localGenerationDependencyHint(prep.split);
  const generationMessage = prep.generation.status === 'running'
    ? localGenerationLabels[prep.generation.stage]
    : prep.generation.status === 'ready' ? prep.generation.message
    : prep.generation.status === 'partial' ? prep.generation.chartFailure
    : prep.generation.status === 'unavailable' || prep.generation.status === 'error' ? prep.generation.message
    : prep.generation.status === 'cancelled' ? '已取消本地生成。'
    : generationDependencyHint || (hasPair && !scoreReady
      ? '当前伴奏可用但还缺已确认曲谱。可从原曲分析人声并生成草稿；新曲谱通过校验后才会启用评分。'
      : '使用当前原曲生成伴奏，并在歌词有时间轴时尝试生成待核对曲谱。');
  const showLocalGeneration=shouldShowLocalGeneration(mobile,prep.canGenerate,hasPair,prep.generation,scoreReady);
  const generationActionLabel = prep.generation.status==='idle'
    ? hasPair && !scoreReady ? '从原曲补齐曲谱' : '生成伴奏与曲谱'
    : hasPair && !scoreReady ? '重试补齐曲谱' : '重新生成';

  useEffect(()=>{
    if (locked) return;
    prep.unlockRound();
    if (currentPair.current!==pair) {
      currentPair.current=pair;
      session.resetVocalMode();
    }
    if (appliedChart.current!==verifiedChart) {
      if (verifiedChart) {
        if (session.applyPitchReference(verifiedChart.descriptor,'已确认曲谱：'+verifiedChart.name)) appliedChart.current=verifiedChart;
      } else {
        appliedChart.current=undefined;
        session.clearPitchReference();
      }
    }
  },[locked,pair,verifiedChart,session.applyPitchReference,session.clearPitchReference]);

  function startRound() {
    if (!selectable) return;
    prep.lockForRound();
    const score=Boolean(verifiedChart && pair && appliedChart.current===verifiedChart && mode==='instrumental');
    roundScoring.current=score;
    void session.start(score);
  }
  useEffect(() => {
    if (!historyOpen) return;
    let current = true;
    setHistoryError(false);
    void listPractice(historyLimit).then(rows => {if (current) setHistory(rows);},() => {if (current) setHistoryError(true);});
    return () => {current = false;};
  },[historyOpen,historyLimit,refresh,session.saveState]);

  const importPair = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file && selectable) {setPairSearch(false);void prep.importPair(file);}
  };
  const importChart = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !selectable || !pair) return;
    void prep.stageChart(async()=>{
      if (file.size > 2 * 1024 * 1024) throw Error('曲谱文件不能超过 2 MB。');
      const data = await (/\.midi?$/i.test(file.name) ? file.arrayBuffer() : file.text());
      return {name:file.name,type:file.type,data};
    });
  };
  const catalogRows = chartSearch ? findOpenCharts(chartQuery) : [];
  const candidates = 'candidates' in prep.backing ? prep.backing.candidates : [];
  const offered = [manualCandidate,...candidates].filter((candidate,index,all):candidate is Track=>!!candidate && all.findIndex(row=>row?.id===candidate.id)===index);
  const pending=prep.backing.status==='pending' || prep.chart.status==='pending';
  const prepSummary = !track ? '选歌后自动查找'
    : generationRunning ? generationMessage
    : hasPair ? (scoreReady ? '可演唱并评分' : '伴奏已就绪，本轮暂不计分')
    : prep.backing.status==='review' || manualCandidate ? '伴奏需要试听确认'
    : prep.backing.status==='error' ? '伴奏查询未完成'
    : prep.backing.status==='cancelled' ? '伴奏查询已取消'
    : prep.backing.status==='pending' ? '正在查找伴奏和曲谱'
    : '暂无伴奏';
  const backingStatus = !track ? '选歌后自动查找'
    : prep.backing.status==='pending' ? '自动查找中'
    : hasPair ? '已就绪'
    : prep.backing.status==='review' || manualCandidate ? `${Math.max(1,offered.length)} 个候选待试听`
    : prep.backing.status==='error' ? '查询未完成'
    : prep.backing.status==='cancelled' ? '已取消'
    : '未找到';
  const chartStatus = !track ? '选歌后自动查找'
    : verifiedChart ? '可评分'
    : prep.draft ? '曲谱待核对'
    : prep.chart.status==='pending' ? '自动查找中'
    : prep.chart.status==='review' ? `${prep.chart.candidates.length} 份曲谱待核对`
    : prep.chart.status==='error' ? '查询未完成'
    : prep.chart.status==='cancelled' ? '已取消'
    : hasPair ? '无匹配曲谱，仍可跟唱' : '无可用曲谱';
  const statusText = preparing || recovering ? session.audioProgress || (preparing ? '正在准备音频' : '正在恢复播放')
    : session.status === 'singing' ? (mode === 'instrumental' ? '正在演唱' : '正在试听原声')
    : session.status === 'paused' ? '已暂停'
    : session.status === 'complete' ? '本轮结束'
    : session.status === 'failed' ? '音频未能播放'
    : '准备演唱';

  return <div className={'karaoke-adapter solo-workbench karaoke-ui '+(mobile ? 'is-mobile':'is-pc')} data-karaoke-adapter={mobile ? 'mobile':'desktop'}>
    <header className="solo-title">
      <div><small>个人练唱</small><h2>{track?.title || '选择一首歌'}</h2>{track?.artist && <p>{track.artist}</p>}</div>
      <div className="solo-microphone"><i className={session.microphoneGranted ? 'is-on' : undefined}/>{session.microphoneGranted ? '麦克风已开启' : session.microphonePending ? '等待麦克风' : '麦克风未开启'}</div>
    </header>
    {session.error && <KaraokeErrorNotice error={{...session.error,code:''}} onDismiss={session.dismissError}
      onRetry={session.status === 'failed' && selectable ? startRound : undefined}/>}
    {prep.notice && <KaraokeErrorNotice error={{code:'',message:prep.notice,recoverable:true}} onDismiss={prep.clearNotice}/>}
    {playbackWasPlaying && <p className="solo-hint">普通播放器还在播放，评分已暂停。请先暂停普通播放，避免两路声音叠在一起。</p>}

    <div className="solo-transport">
      <p id="karaoke-adapter-session-title" role="status">{locked ? statusText : prepSummary}</p>
      <div className="karaoke-adapter-controls" role="group" aria-label="单人 K 歌控制">
        {session.status === 'singing' ? <button className="is-primary" type="button" aria-label="暂停演唱" disabled={recovering} onClick={session.pause}><Pause/>暂停</button>
          : session.status === 'paused' ? <button className="is-primary" type="button" aria-label="继续演唱" disabled={recovering} onClick={session.resume}><Play/>{recovering ? '正在恢复' : '继续'}</button>
          : <button className="is-primary" type="button" aria-label={mode === 'instrumental' && session.status === 'complete' ? '再唱一次':startText} disabled={!selectable} onClick={startRound}><Play/>{preparing ? '正在准备' : mode === 'instrumental' && session.status === 'complete' ? '再唱一次' : startText}</button>}
        <button type="button" aria-label={preparing ? '取消准备':'结束演唱'} disabled={!locked} onClick={session.finish}><Square/>{preparing ? '取消准备':'结束演唱'}</button>
      </div>
    </div>

    <div className="solo-prep-status" role="status" aria-label="自动准备状态">
      <span data-state={hasPair ? 'ready' : prep.backing.status}>
        <AudioLines aria-hidden="true"/><small>伴奏</small><strong>{backingStatus}</strong>
      </span>
      <span data-state={verifiedChart ? 'ready' : prep.chart.status}>
        <FileMusic aria-hidden="true"/><small>曲谱</small><strong>{chartStatus}</strong>
      </span>
    </div>

    <section className="solo-stage" aria-label="演唱区">
      <div className="solo-stage-header">
        <div role="group" aria-label="人声切换" className="solo-vocal-switch">
          <button type="button" aria-pressed={mode === 'instrumental'} disabled={!hasPair || preparing || recovering} onClick={() => void session.changeVocalMode('instrumental')}>伴奏</button>
          <button type="button" aria-pressed={mode === 'original'} disabled={!track || preparing || recovering} onClick={() => void session.changeVocalMode('original')}>原声</button>
        </div>
        <div className="solo-position" aria-label="歌曲演唱进度">{formatKaraokeTime(session.elapsedMs)} <span>/</span> {duration > 0 ? formatKaraokeTime(duration) : '—'}</div>
      </div>
      <SoloPitchGuide lyrics={lines} elapsed={session.elapsedMs} frames={session.pitchTrail}/>
      <KaraokeLyricStack lyrics={lines} activeLineIndex={Math.max(0,index)} lineProgress={progress} compact={mobile}/>
      <p className="solo-line-score">{session.latestLine ? '第 '+(session.latestLine.lineIndex+1)+' 句 · '+Math.round(session.latestLine.total)+' 分'
        : mode === 'original' ? '原声用于对照，不计分'
        : (locked ? !roundScoring.current : !verifiedChart) || !timed ? '本轮不计分'
        : '每句结束后显示得分'}</p>
    </section>

    {session.status === 'complete' && !session.result && <p className="solo-hint">{!timed ? '本轮未评分：没有带音高的曲谱。' : !hasPair ? '本轮为原声试听。选择伴奏后可以开始评分。' : '本轮未评分：伴奏期间未采集到足够的麦克风样本。'}</p>}

    {session.result && <details className="solo-details solo-results">
      <summary className="zenix-karaoke-complete-inline"><span>本轮结果</span><small>{session.saveState === 'saved' ? '已保存到练唱记录' : session.saveState === 'failed' ? '未能保存到本机' : '逐句点评'}</small><ChevronDown/></summary>
      {session.saveState === 'failed' && <button type="button" onClick={session.retrySave}>重新保存</button>}
      <ScoreSummary result={session.result}/><ScoreLines result={session.result} lyrics={lyricsByIndex}/>
    </details>}
    <details className="solo-details solo-preparation">
      <summary><AudioLines/><span>伴奏与音高</span><small>{hasPair ? '已有伴奏' : prepSummary}</small><ChevronDown/></summary>
      <div className="solo-resource-body">
        {(prep.working || pending) && <p className="solo-hint" role="status">{generationRunning ? generationMessage : prep.working ? '正在准备选定资源…' : '正在自动查找资源…'} <button type="button" onClick={prep.working ? prep.cancelAction : prep.cancelSearch}>{prep.working ? '取消操作' : '取消查找'}</button></p>}
        <div className="solo-resource">
          <div><strong>伴奏音轨</strong><p>{pair ? pair.title : prep.backing.message ?? '核对可用伴奏后即可跟唱。'}</p></div>
          <div><button type="button" disabled={!selectable} onClick={() => setPairSearch(open => !open)} aria-expanded={pairSearch}><Search/>搜索伴奏</button>
            <button type="button" disabled={!selectable} onClick={() => pairingInput.current?.click()}><FileAudio/>导入</button>
            {pair ? <button type="button" disabled={!selectable} onClick={() => void prep.removePair()}>解除配对</button>
              : prep.backing.status!=='pending' && <button type="button" disabled={!selectable} onClick={prep.retryBacking}>重新查找</button>}</div>
          <input ref={pairingInput} type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg" hidden onChange={importPair}/>
        </div>
        {!locked && !!offered.length && <ul className="solo-candidates" aria-label="待确认的伴奏">
          {offered.map(candidate=>{
            const selected=prep.preview?.track===candidate;
            return <li key={candidate.id}>
              <div><strong>{candidate.title}</strong><small>{candidate.artist}{candidate.duration>0 ? ' · '+formatKaraokeTime(candidate.duration*1000):''}</small></div>
              <div className="solo-candidate-actions">
                <button type="button" disabled={!selectable} onClick={() => selected && (prep.preview?.playing || prep.preview?.loading) ? prep.stopPreview() : void prep.listen(candidate)}>{selected && (prep.preview?.playing || prep.preview?.loading) ? '停止试听':'试听伴奏'}</button>
                <button type="button" disabled={!selectable || !selected || !prep.preview?.verified} onClick={() => void prep.confirmPair(candidate)}>确认此伴奏</button>
              </div>
            </li>;
          })}
        </ul>}
        {pairSearch && track && !locked && <KaraokeSongSearch id={searchId} mobile={mobile} tracks={tracks} sources={sources}
          initialKeyword={track.title+' 伴奏'} instrumentalMatch={candidate => isInstrumentalVersion(track,candidate)} onSelect={value => {setManualCandidate(value);setPairSearch(false);void prep.listen(value);}}/>}
        {showLocalGeneration && <section className="solo-generation"
          aria-label="从原曲生成伴奏与曲谱" data-generation-state={prep.generation.status}
          data-generation-stage={prep.generation.status==='running' ? prep.generation.stage : undefined}>
          <div className="solo-generation-head">
            <div><strong>从原曲生成</strong><p role={prep.generation.status==='unavailable' || prep.generation.status==='error' ? 'alert':'status'}>{generationMessage}</p></div>
            {generationRunning
              ? <button type="button" onClick={prep.cancelGeneration}>取消生成</button>
              : <button type="button" disabled={!selectable} onClick={() => void prep.generate()}>
                {generationActionLabel}
              </button>}
          </div>
          {generationRunning && <ol className="solo-generation-stages" aria-label="本地生成进度">
            {localGenerationStages.map((stage,index)=><li key={stage}
              data-state={index<generationStageIndex ? 'complete' : index===generationStageIndex ? 'current' : 'pending'}
              aria-current={index===generationStageIndex ? 'step' : undefined}>{localGenerationLabels[stage]}</li>)}
          </ol>}
          {prep.generation.status==='partial' && <p className="solo-generation-result">
            伴奏已经可以使用，可以继续跟唱。曲谱生成未完成时不会启用评分。
          </p>}
          {prep.generation.status==='ready' && <p className="solo-generation-result">
            伴奏已就绪，{prep.generation.lineCount} 句、{prep.generation.noteCount} 个音符的曲谱草稿正在下方等待核对。
          </p>}
          <small>仅处理本地音乐库文件或已核验身份的完整缓存；不会上传原曲。</small>
        </section>}
        <div className="solo-resource">
          <div><strong>音高曲谱</strong><p>{verifiedChart ? session.sourceLabel : prep.chart.message ?? '支持 UltraStar、MIDI、带音高的增强 LRC。'}</p></div>
          <div><button type="button" disabled={!selectable || !pair} onClick={() => chartInput.current?.click()}><FileMusic/>导入曲谱</button>
            <button type="button" disabled={!track || locked} aria-expanded={chartSearch} onClick={() => setChartSearch(open => !open)}><Search/>搜索开放曲谱</button>
            {(prep.chart.status==='error' || prep.chart.status==='cancelled') && <button type="button" disabled={!selectable} onClick={prep.retryChart}>重查曲谱</button>}</div>
          <input ref={chartInput} type="file" accept=".mid,.midi,.ulstar,.ultrastar,.txt,.lrc" hidden onChange={importChart}/>
        </div>
        {!chartSearch && !locked && prep.chart.status==='review' && <ul className="solo-candidates" aria-label="发现的开放曲谱">
          {prep.chart.candidates.map(chart=><li key={chart.sha}>
            <div><strong>{chart.title}</strong><small>{chart.artist} · 待核对时间轴</small></div>
            <div className="solo-candidate-actions"><a href={chartLicense(chart)} target="_blank" rel="noreferrer">许可</a><button type="button" disabled={!selectable || !hasPair} onClick={() => prep.stageOpenChart(chart)}>核对这份曲谱</button></div>
          </li>)}
        </ul>}
        {chartSearch && <div className="solo-chart-catalog">
          <label>按歌名或歌手搜索 <input type="search" value={chartQuery} onChange={event => setChartQuery(event.target.value)} maxLength={120}/></label>
          <p>当前内置 3 份已核对的开放曲谱，可查看完整 <a target="_blank" rel="noreferrer" href="https://github.com/UltraStar-Deluxe/songs">UltraStar 目录</a>。</p>
          {catalogRows.length ? <ul>{catalogRows.map(chart => <li key={chart.sha}><div><strong>{chart.title}</strong><small>{chart.artist}</small></div>
            <a href={chartLicense(chart)} target="_blank" rel="noreferrer">许可</a>
            <button type="button" disabled={!track || !hasPair || !selectable || !matchesOpenChart(chart,track.title,track.artist)} onClick={() => prep.stageOpenChart(chart)}>核对这份曲谱</button>
          </li>)}</ul> : <p>没有匹配的开放曲谱。你仍可导入与当前录音对应的本地曲谱。</p>}
        </div>}
        {prep.draft && !locked && <section className="solo-chart-confirm" aria-label="核对曲谱时间轴"
          data-chart-source={prep.draft.source}>
          <h4>{prep.draft.chart.name}</h4>
          <p>{prep.draft.source==='generated'
            ? '这是从分离人声自动生成的曲谱草稿。请试听伴奏，并核对这些句子的进拍、音高与句子边界。'
            : '请核对伴奏的进拍、前奏和这些歌词时间；同名不同录音可能错拍。'}</p>
          {prep.draft.generated && <>
            <dl className="solo-generation-meta">
              <div><dt>来源</dt><dd>当前原曲 · Demucs 分离</dd></div>
              <div><dt>音高模型</dt><dd>{prep.draft.generated.models.pitch}</dd></div>
              <div><dt>对齐</dt><dd>{prep.draft.generated.models.aligner}</dd></div>
              <div><dt>节拍</dt><dd>{Math.round(prep.draft.generated.bpm)} BPM{prep.draft.generated.bpmFallback ? ' · 估算回退' : ''}</dd></div>
            </dl>
            {!!prep.draft.generated.warnings.length && <ul className="solo-generation-warnings" aria-label="曲谱生成告警">
              {prep.draft.generated.warnings.map((warning,index)=><li key={warning+'-'+index}>{warning}</li>)}
            </ul>}
          </>}
          <ul>{prep.draft.chart.descriptor.pitchTrack?.lines.slice(0,4).map(row=><li key={row.index}>
            <time>{formatKaraokeTime(row.startMs)}</time> {row.text}</li>)}</ul>
          <div><button type="button" disabled={!selectable} onClick={() => void prep.confirmChart()}>确认曲谱与伴奏对齐</button><button type="button" disabled={!selectable} onClick={prep.discardDraft}>取消核对</button></div>
        </section>}
      </div>
    </details>
    <details className="solo-details" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary><Clock3/><span>练唱记录</span><small>仅存本机</small><ChevronDown/></summary>
      <div className="solo-resource-body">
        {historyError && <p className="solo-hint">未能读取练唱记录。 <button type="button" onClick={() => setRefresh(value => value+1)}>重试</button></p>}
        {!historyError && !history && <p className="solo-hint">正在读取记录…</p>}
        {history?.length === 0 && <p className="solo-hint">完成一次有效评分后，结果会出现在这里。</p>}
        {!!history?.length && <ul className="solo-history">{history.map(record => <li key={record.id}>
          <button type="button" aria-pressed={historySelected?.id === record.id} onClick={() => setHistorySelected(record)}>
            <strong>{record.title}</strong><small>{new Date(record.at).toLocaleString()}</small><b>{record.result.total} 分</b>
          </button>
        </li>)}</ul>}
        {history?.length === historyLimit && <button type="button" onClick={() => setHistoryLimit(limit => limit+50)}>显示更多记录</button>}
        {historySelected && <><ScoreSummary result={historySelected.result}/><ScoreLines result={historySelected.result} lyrics={new Map()}/></>}
      </div>
    </details>
  </div>;
}
