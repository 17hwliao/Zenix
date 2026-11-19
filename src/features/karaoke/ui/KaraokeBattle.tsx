import type { KaraokeGrade, KaraokeRoomState, KaraokeSide } from '../contracts';
import './karaoke-battle.css';

const GRADE_COPY: Record<KaraokeGrade, readonly [string, string]> = {
  perfect: ['WONDERFUL', '完美天籁'],
  excellent: ['PERFECT SHOT', '近乎完美'],
  veryGood: ['VERY GOOD', '非常好'],
  good: ['GREAT', '表现很棒'],
  nice: ['NICE', '状态不错'],
  pass: ['KEEP GOING', '继续加油'],
  retry: ['TRY AGAIN', '再唱一次'],
};

export interface KaraokeGradeFeedback {
  grade: KaraokeGrade;
  lineIndex: number;
  itemId?: string;
  side?: KaraokeSide;
  combo?: number;
}

export function KaraokeBattle({room, reducedMotion = false}: {
  room: KaraokeRoomState;
  reducedMotion?: boolean;
}) {
  const battle = room.battle;
  if (!battle) return null;
  const {blueScore, redScore} = battle;
  const total = blueScore + redScore;
  const share = total > 0 ? Math.max(0, Math.min(1, blueScore / total)) : .5;
  const roundsFinished = Boolean(battle.itemId)
    && room.queue.some((item) => item.id === battle.itemId && item.state === 'scored');
  const outcome = battle.settlingUntilMs !== undefined ? '正在确认本轮比分'
    : total === 0 && battle.submittedMembers.length === 0 ? '等待评分'
    : blueScore === redScore ? '双方持平'
      : `${blueScore > redScore ? '蓝方' : '红方'}${roundsFinished ? '获胜' : '领先'}`;

  return (
    <section className="zenix-karaoke-battle" aria-label="红蓝对战战况" data-reduced-motion={reducedMotion}>
      <div className="zenix-karaoke-battle-teams">
        {(['blue', 'red'] as const).map((side) => {
          const members = room.members.filter((member) => member.side === side);
          return (
            <div key={side} className="zenix-karaoke-battle-team" data-side={side}>
              <span className="zenix-karaoke-battle-label">{side === 'blue' ? '蓝方' : '红方'}</span>
              <strong>{Number((side === 'blue' ? blueScore : redScore).toFixed(1))}<small> 分</small></strong>
              {members.length ? (
                <ul aria-label={side === 'blue' ? '蓝方成员' : '红方成员'}>
                  {members.map((member) => (
                    <li key={member.id}>{member.displayName}{!member.connected && <small>（离线）</small>}</li>
                  ))}
                </ul>
              ) : <small>暂无成员</small>}
            </div>
          );
        })}
      </div>
      <div className="zenix-karaoke-battle-bar" aria-hidden="true">
        <span className="zenix-karaoke-battle-fill" style={{transform: `scaleX(${share})`}} />
        <span className="zenix-karaoke-battle-collision" style={{transform: `translateX(${share * 100}%)`}} />
      </div>
      <p className="zenix-karaoke-battle-outcome">{outcome}</p>
    </section>
  );
}

export function KaraokeGradeNotice({grade, reducedMotion = false}: {
  grade?: KaraokeGradeFeedback | null;
  reducedMotion?: boolean;
}) {
  const copy = grade ? GRADE_COPY[grade.grade] : null;
  return (
    <div className="zenix-karaoke-grade" data-reduced-motion={reducedMotion} aria-live="polite">
      {grade && copy && (
        <span
          key={JSON.stringify([grade.itemId, grade.lineIndex, grade.grade])}
          className="zenix-karaoke-grade-mark"
          data-grade={grade.grade}
          data-side={grade.side ?? 'none'}
        >
          <strong>{copy[0]}</strong>
          <small>{copy[1]}{(grade.combo ?? 0) > 1 && ` · ${grade.combo} 连击`}</small>
        </span>
      )}
    </div>
  );
}
