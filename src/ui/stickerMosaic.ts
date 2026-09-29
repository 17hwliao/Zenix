// Zenix's deterministic poster tessellation. A block keeps the same posters
// while one grows: the remaining space is repartitioned and cards move into it.
export type StickerRect = { x: number; y: number; columns: number; rows: number };
export type StickerSlot = StickerRect & { block: number; blockX: number; blockY: number };

export const BLOCK_COLUMNS = 12;
export const BLOCK_ROWS = 8;
export const WALL_BLOCK_COLUMNS = 3;
export const WALL_BLOCK_ROWS = 3;
export const WALL_COLUMNS = BLOCK_COLUMNS * WALL_BLOCK_COLUMNS;
export const WALL_ROWS = BLOCK_ROWS * WALL_BLOCK_ROWS;
export const STICKER_GAP = 6;
const POSTERS_PER_BLOCK = 12;

function randomFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function split(rect: StickerRect, random: () => number): [StickerRect, StickerRect] {
  const canSplitX = rect.columns >= 4;
  const canSplitY = rect.rows >= 4;
  const ratio = rect.columns / rect.rows;
  const alongX = canSplitX && (!canSplitY || ratio > 1.35 || (ratio >= .74 && random() < .5));
  const length = alongX ? rect.columns : rect.rows;
  const crossLength = alongX ? rect.rows : rect.columns;
  const first = length === 6 && crossLength <= 3
    ? 2
    : Math.max(2, Math.min(length - 2, Math.round(length * (.38 + random() * .24))));
  return alongX
    ? [{ ...rect, columns: first }, { ...rect, x: rect.x + first, columns: length - first }]
    : [{ ...rect, rows: first }, { ...rect, y: rect.y + first, rows: length - first }];
}

function divideToCount(source: StickerRect[], count: number, random: () => number): StickerRect[] {
  const result = [...source];
  while (result.length < count) {
    let candidate = -1;
    let bestScore = -1;
    result.forEach((rect, index) => {
      if (rect.columns < 4 && rect.rows < 4) return;
      const aspect = Math.max(rect.columns / rect.rows, rect.rows / rect.columns);
      const score = rect.columns * rect.rows * (.85 + random() * .3) * (1 + Math.max(0, aspect - 1.8) * .85);
      if (score > bestScore) { bestScore = score; candidate = index; }
    });
    if (candidate < 0) break;
    result.splice(candidate, 1, ...split(result[candidate], random));
  }
  if (result.length !== count) throw new Error(`Could not arrange ${count} posters in this block`);
  return result.sort((a, b) => a.y - b.y || a.x - b.x);
}

function makeSlots(): StickerSlot[] {
  const slots: StickerSlot[] = [];
  for (let blockY = 0; blockY < WALL_BLOCK_ROWS; blockY += 1) {
    for (let blockX = 0; blockX < WALL_BLOCK_COLUMNS; blockX += 1) {
      const block = blockY * WALL_BLOCK_COLUMNS + blockX;
      const seed = Math.imul(blockX + 7, 0x9e3779b1) ^ Math.imul(blockY + 19, 0x85ebca6b);
      const pieces = divideToCount([{ x: 0, y: 0, columns: BLOCK_COLUMNS, rows: BLOCK_ROWS }], POSTERS_PER_BLOCK, randomFor(seed));
      pieces.forEach(rect => slots.push({
        ...rect,
        x: blockX * BLOCK_COLUMNS + rect.x,
        y: blockY * BLOCK_ROWS + rect.y,
        block, blockX, blockY,
      }));
    }
  }
  return slots;
}

export const STICKER_SLOTS = makeSlots();
export const CENTER_STICKER_SLOT = STICKER_SLOTS.findIndex(slot => slot.blockX === 1 && slot.blockY === 1);

const centeredSlots = [...STICKER_SLOTS].sort((a, b) => {
  if (a === STICKER_SLOTS[CENTER_STICKER_SLOT]) return -1;
  if (b === STICKER_SLOTS[CENTER_STICKER_SLOT]) return 1;
  const distance = (slot: StickerSlot) => (slot.x + slot.columns / 2 - WALL_COLUMNS / 2) ** 2 + (slot.y + slot.rows / 2 - WALL_ROWS / 2) ** 2;
  return distance(a) - distance(b) || a.block - b.block || a.y - b.y || a.x - b.x;
});

export function stickerSlotsForCount(count: number): StickerSlot[] {
  return Array.from({ length: count }, (_, index) => {
    const group = Math.floor(index / centeredSlots.length);
    const slot = centeredSlots[index % centeredSlots.length];
    return group ? { ...slot, x: slot.x + group * WALL_COLUMNS, blockX: slot.blockX + group * WALL_BLOCK_COLUMNS, block: slot.block + group * WALL_BLOCK_COLUMNS * WALL_BLOCK_ROWS } : slot;
  });
}

function focusRectFor(slot: StickerSlot): StickerRect {
  const centerX = slot.x - slot.blockX * BLOCK_COLUMNS + slot.columns / 2;
  const centerY = slot.y - slot.blockY * BLOCK_ROWS + slot.rows / 2;
  const x = [0, 3, 6].reduce((best, value) => Math.abs(value + 3 - centerX) < Math.abs(best + 3 - centerX) ? value : best);
  const y = centerY < 4 ? 0 : 2;
  return { x, y, columns: 6, rows: 6 };
}

function assignNearest(base: StickerSlot[], targets: StickerRect[]): number[] {
  const count = base.length;
  const costs = base.map(source => targets.map(target => {
    const dx = source.x + source.columns / 2 - (target.x + target.columns / 2);
    const dy = source.y + source.rows / 2 - (target.y + target.rows / 2);
    const area = Math.abs(source.columns * source.rows - target.columns * target.rows);
    return dx * dx + dy * dy + area * .28;
  }));
  const cache = new Map<number, { cost: number; choice: number }>();
  const search = (mask: number): number => {
    let used = mask;
    let index = -1;
    while (used) { used &= used - 1; index += 1; }
    if (index + 1 === count) return 0;
    const saved = cache.get(mask);
    if (saved) return saved.cost;
    let best = Number.POSITIVE_INFINITY;
    let choice = -1;
    for (let target = 0; target < count; target += 1) {
      if (mask & (1 << target)) continue;
      const cost = costs[index + 1][target] + search(mask | (1 << target));
      if (cost < best) { best = cost; choice = target; }
    }
    cache.set(mask, { cost: best, choice });
    return best;
  };
  search(0);
  const assignment: number[] = [];
  let mask = 0;
  for (let index = 0; index < count; index += 1) {
    const choice = cache.get(mask)?.choice ?? index;
    assignment.push(choice);
    mask |= 1 << choice;
  }
  return assignment;
}

export function expandedStickerLayout(selectedIndex: number, slots: StickerSlot[] = STICKER_SLOTS): Map<number, StickerRect> {
  const selected = slots[selectedIndex];
  if (!selected) return new Map();
  const blockSlots = slots.map((slot, index) => ({ slot, index })).filter(entry => entry.slot.block === selected.block);
  const focus = focusRectFor(selected);
  const result = new Map<number, StickerRect>();
  const toWorld = (rect: StickerRect): StickerRect => ({ ...rect, x: selected.blockX * BLOCK_COLUMNS + rect.x, y: selected.blockY * BLOCK_ROWS + rect.y });
  result.set(selectedIndex, toWorld(focus));
  if (blockSlots.length === 1) return result;
  const remainder: StickerRect[] = [];
  if (focus.y > 0) remainder.push({ x: 0, y: 0, columns: BLOCK_COLUMNS, rows: focus.y });
  if (focus.y + focus.rows < BLOCK_ROWS) remainder.push({ x: 0, y: focus.y + focus.rows, columns: BLOCK_COLUMNS, rows: BLOCK_ROWS - focus.y - focus.rows });
  if (focus.x > 0) remainder.push({ x: 0, y: focus.y, columns: focus.x, rows: focus.rows });
  if (focus.x + focus.columns < BLOCK_COLUMNS) remainder.push({ x: focus.x + focus.columns, y: focus.y, columns: BLOCK_COLUMNS - focus.x - focus.columns, rows: focus.rows });
  const random = randomFor(Math.imul(selectedIndex + 1, 0x9e3779b1));
  const targets = blockSlots.length - 1 < remainder.length
    ? [...remainder].sort((a, b) => b.columns * b.rows - a.columns * a.rows).slice(0, blockSlots.length - 1)
    : divideToCount(remainder, blockSlots.length - 1, random);
  const others = blockSlots.filter(entry => entry.index !== selectedIndex);
  const localBase = others.map(entry => ({ ...entry.slot, x: entry.slot.x - entry.slot.blockX * BLOCK_COLUMNS, y: entry.slot.y - entry.slot.blockY * BLOCK_ROWS }));
  const assignment = assignNearest(localBase, targets);
  others.forEach((entry, index) => result.set(entry.index, toWorld(targets[assignment[index]])));
  return result;
}
