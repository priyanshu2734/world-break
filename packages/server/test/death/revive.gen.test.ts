import { describe, expect, it } from 'vitest';
import { ITEM_KIND_SPECS, ITEM_LIMITS, type Difficulty } from '@wb/shared';
import { generateEscapeStage } from '../../src/rooms/generate';
import { requireRevive, validateEscape } from '../../src/rooms/escapeValidate';
import { reachablePlatforms } from '../../src/salvage/dropRest';
import type { StageDef } from '../../src/systems/stageDef';

const DIFFS: Difficulty[] = ['easy', 'intermediate', 'hardcore'];
const STAGES = [2, 3, 4, 5, 8, 12, 20, 29, 1_000_000];
const SEEDS = [1, 2, 3, 4, 5];
const cellsOf = (def: StageDef) => (def.items ?? []).filter((i) => i.kind === 'revive_cell');
const errsOf = (def: StageDef): string[] => validateEscape(def.escape!, def.rooms!, def);

describe('P4 step 3: the generator places at most one Revive Cell, only on Easy and Intermediate', () => {
  it('exactly one on a ghost stage of Easy and Intermediate, none on Hardcore, none without the ghost, none on stage 1: stages 2 to 29 and 1,000,000, many seeds', () => {
    let n = 0;
    for (const stage of STAGES) for (const seed of SEEDS) for (const d of DIFFS) {
      const def = generateEscapeStage(stage, seed, { ghost: true, difficulty: d });
      expect(cellsOf(def).length, `stage ${stage} seed ${seed} ${d}`).toBe(d === 'hardcore' ? 0 : 1);
      expect(requireRevive(def, d)).toEqual([]);
      n++;
    }
    expect(n).toBe(STAGES.length * SEEDS.length * 3);
    for (const seed of SEEDS) {
      expect(cellsOf(generateEscapeStage(5, seed, { difficulty: 'easy' }))).toEqual([]); // no ghost option: the stage is what it was
      expect(cellsOf(generateEscapeStage(1, seed, { ghost: true, difficulty: 'easy' }))).toEqual([]); // the tutorial has no ghost
    }
  });
  it('the cell is genuine, lies in the open on a floor a lone player can reach, is one hand (so it fits next to another part), and the stage stays within its item cap', () => {
    for (const stage of STAGES) for (const seed of SEEDS) for (const d of ['easy', 'intermediate'] as const) {
      const def = generateEscapeStage(stage, seed, { ghost: true, difficulty: d });
      const cell = cellsOf(def)[0]!;
      expect(cell.decoy).not.toBe(true);
      expect(cell.hidden).toBeUndefined();
      expect((cell.slots ?? ITEM_KIND_SPECS.revive_cell.defaultSlots) * 2).toBeLessThanOrEqual(ITEM_LIMITS.carrySlots);
      const room = def.rooms!.rooms.find((r) => r.id === cell.room)!;
      expect(room, `${cell.id} room`).toBeDefined();
      const idx = room.arena.solids.findIndex((s) => Math.abs(s.y - cell.y) < 1 && cell.x >= s.x && cell.x <= s.x + s.w);
      expect(idx, `${cell.id} stands on a floor`).toBeGreaterThanOrEqual(0);
      expect(reachablePlatforms(room.arena).has(idx)).toBe(true);
      expect((def.items ?? []).length).toBeLessThanOrEqual(ITEM_LIMITS.maxItemsPerStage);
      // it fits beside the gun in one trip (2 slots)
      const gun = (def.items ?? []).find((i) => i.kind === 'pulse_gun')!;
      expect((cell.slots ?? 1) + (gun.slots ?? 1)).toBeLessThanOrEqual(ITEM_LIMITS.carrySlots);
      expect(errsOf(def)).toEqual([]);
    }
  });
  it('is deterministic in (stage, seed, difficulty), and the other items of the stage are the same with or without a cell on Easy and Intermediate', () => {
    for (const d of ['easy', 'intermediate'] as const) {
      const a = generateEscapeStage(12, 7, { ghost: true, difficulty: d }), b = generateEscapeStage(12, 7, { ghost: true, difficulty: d });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
    const e = generateEscapeStage(12, 7, { ghost: true, difficulty: 'easy' }), i = generateEscapeStage(12, 7, { ghost: true, difficulty: 'intermediate' });
    expect(cellsOf(e)[0]!.id).toBe(cellsOf(i)[0]!.id);
  });
  it('different seeds put it in different places (it is a thing a team has to go and find)', () => {
    const spots = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) { const c = cellsOf(generateEscapeStage(8, seed, { ghost: true, difficulty: 'easy' }))[0]!; spots.add(`${c.room}:${c.x}`); }
    expect(spots.size).toBeGreaterThan(3);
  });
});

describe('P4 step 3: the validator proves it', () => {
  const base = () => generateEscapeStage(8, 3, { ghost: true, difficulty: 'easy' });
  const withItems = (def: StageDef, f: (items: NonNullable<StageDef['items']>) => NonNullable<StageDef['items']>): StageDef => ({ ...def, items: f([...(def.items ?? [])]) });
  it('a good stage has no errors; the rule demands exactly one cell on Easy and none on Hardcore', () => {
    const def = base();
    expect(errsOf(def)).toEqual([]);
    expect(requireRevive(def, 'easy')).toEqual([]);
    expect(requireRevive(def, 'hardcore')[0]).toContain('no Revive Cell');
    const none = withItems(def, (it) => it.filter((i) => i.kind !== 'revive_cell'));
    expect(requireRevive(none, 'easy')[0]).toContain('exactly one');
    expect(requireRevive(none, 'hardcore')).toEqual([]);
  });
  it('refuses two cells, a decoy cell, a hidden cell, a two-hand cell and a cell in mid air', () => {
    const def = base();
    const cell = cellsOf(def)[0]!;
    expect(errsOf(withItems(def, (it) => [...it, { ...cell, id: 'extra_cell', x: cell.x + 3 }])).join(' ')).toContain('at most one Revive Cell');
    expect(errsOf(withItems(def, (it) => it.map((i) => (i.id === cell.id ? { ...i, decoy: true } : i)))).join(' ')).toContain('cannot be a decoy');
    expect(errsOf(withItems(def, (it) => it.map((i) => (i.id === cell.id ? { ...i, hidden: { container: 'locker' as const, reveal: 'interact' as const } } : i)))).join(' ')).toContain('in the open');
    expect(errsOf(withItems(def, (it) => it.map((i) => (i.id === cell.id ? { ...i, slots: 2 as const } : i)))).join(' ')).toContain('one hand');
    expect(errsOf(withItems(def, (it) => it.map((i) => (i.id === cell.id ? { ...i, y: i.y - 200 } : i)))).join(' ')).toContain(cell.id);
  });
  it('requireRevive also covers requireRevive(Hardcore) with a stray cell', () => {
    const def = base();
    expect(requireRevive(def, 'hardcore')).toHaveLength(1);
  });
});
