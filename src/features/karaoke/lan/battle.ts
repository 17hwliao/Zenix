import type { KaraokeBattleState } from '../contracts';

export interface BattleMemberDelta {
  readonly memberId: string;
  readonly side: 'blue' | 'red';
  readonly delta: number;
}

export function nextBattleState(
  current: KaraokeBattleState,
  itemId: string,
  delta: BattleMemberDelta,
): KaraokeBattleState {
  const safeDelta = Math.max(0, Math.min(100, Number.isFinite(delta.delta) ? delta.delta : 0));
  const sameItem = current.itemId === itemId;
  const submittedMembers = sameItem
    ? [...new Set([...current.submittedMembers, delta.memberId])]
    : [delta.memberId];
  const blueScore = (sameItem ? current.blueScore : 0) + (delta.side === 'blue' ? safeDelta : 0);
  const redScore = (sameItem ? current.redScore : 0) + (delta.side === 'red' ? safeDelta : 0);
  return {
    ...current,
    itemId,
    blueScore,
    redScore,
    leadingSide: blueScore === redScore ? 'tie' : blueScore > redScore ? 'blue' : 'red',
    submittedMembers: frozenCopy(submittedMembers),
  };
}

export function resetBattleState(): KaraokeBattleState {
  return {
    mode: 'versus',
    blueScore: 0,
    redScore: 0,
    leadingSide: 'tie',
    submittedMembers: [],
  };
}

function frozenCopy(items: readonly string[]): readonly string[] {
  return Object.freeze(items.slice());
}
