import { describe, expect, it } from 'vitest';
import {
  CURRICULUM, CURRICULUM_LAST_STAGE, GHOST_TYPES, HISTORY_KEEP, PUZZLE_FROM_STAGE, THEME_IDS, curriculumRow, featuredLock, freshestFirst, ghostPickWith, ghostLineupForStage,
  locksForStage, locksOf, newnessPick, newnessScore, puzzlesForStage, createRng, themeForStage, trimHistory, type VarietyRecord,
} from '../src';

const rec = (stage: number, locks: string[], extra: Partial<VarietyRecord> = {}): VarietyRecord => ({ stage, locks, templates: [], ghosts: [], theme: 'lab', ...extra });

describe('P3F step 4: the curriculum rows (docs/HOOK.md)', () => {
  it('has one row per stage from 1 to 15, in order, and nothing after', () => {
    expect(CURRICULUM.length).toBe(CURRICULUM_LAST_STAGE);
    CURRICULUM.forEach((r, i) => expect(r.stage).toBe(i + 1));
    expect(curriculumRow(16)).toBeNull();
    expect(curriculumRow(0)).toBeNull();
    expect(curriculumRow(Number.NaN)).toBeNull();
    expect(curriculumRow(1_000_000)).toBeNull();
  });
  it('pins the featured lock of every row', () => {
    expect(CURRICULUM.map((r) => r.lock)).toEqual([
      'key_item', null, 'code', null, 'two_person', 'power', 'breaker_panel', 'pressure_plates', 'flashlight_sensor', 'safe',
      'lever_sequence', 'tool_key', 'timed_switch', 'symbol_match', 'wiring',
    ]);
    expect(featuredLock(11)).toBe('lever_sequence');
    expect(featuredLock(14)).toBe('symbol_match');
    expect(featuredLock(16)).toBeNull();
  });
  it('every featured lock is available on its stage, and no stage before it can use a puzzle it introduces', () => {
    for (const r of CURRICULUM) {
      if (r.lock === null) continue;
      expect([...locksForStage(r.stage), ...puzzlesForStage(r.stage)], `stage ${r.stage}`).toContain(r.lock);
    }
    for (const [type, from] of Object.entries(PUZZLE_FROM_STAGE)) {
      const row = CURRICULUM.find((r) => r.lock === type);
      expect(row?.stage, type).toBe(from); // each puzzle is introduced by exactly its curriculum row
    }
    expect(locksForStage(4)).not.toContain('two_person');
    expect(locksForStage(5)).toContain('two_person');
  });
  it('the creatures follow the curriculum: Shade alone on 7, Howler alone on 12', () => {
    expect(ghostLineupForStage(7)).toEqual(['shade']);
    expect(ghostLineupForStage(12)).toEqual(['howler']);
    expect(CURRICULUM.filter((r) => !r.built).length).toBe(0);
  });
});

describe('P3F step 4: newness', () => {
  it('a score counts recent use more, and an empty history changes nothing', () => {
    const h = [rec(1, ['a']), rec(2, ['b']), rec(3, ['c'])];
    expect(newnessScore('c', h, locksOf)).toBe(HISTORY_KEEP);
    expect(newnessScore('a', h, locksOf)).toBe(1);
    expect(newnessScore('z', h, locksOf)).toBe(0);
    expect(freshestFirst(['a', 'b', 'c', 'z'], h, locksOf)).toEqual(['z', 'a', 'b', 'c']);
    expect(freshestFirst(['a', 'b', 'c'], [], locksOf)).toEqual(['a', 'b', 'c']);
    const x = createRng(5), y = createRng(5);
    expect(newnessPick(x, ['a', 'b', 'c'], [], locksOf)).toBe(y.pick(['a', 'b', 'c']));
    expect(x.next()).toBe(y.next()); // one draw either way
  });
  it('a pick avoids what was used lately while something fresher exists', () => {
    const h = [rec(1, ['a', 'b']), rec(2, ['c'])];
    for (let s = 1; s < 40; s++) expect(newnessPick(createRng(s), ['a', 'b', 'c', 'd'], h, locksOf)).toBe('d');
    expect(trimHistory([rec(1, []), rec(2, []), rec(3, []), rec(4, [])]).map((r) => r.stage)).toEqual([2, 3, 4]);
  });
  it('a theme is never the previous stage\'s, and always one of the four', () => {
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(4);
    for (const stage of [2, 3, 10, 99, 1_000_000]) for (const last of THEME_IDS) for (let seed = 1; seed < 20; seed++) {
      const t = themeForStage(stage, seed, [rec(stage - 1, [], { theme: last })]);
      expect(THEME_IDS).toContain(t);
      expect(t).not.toBe(last);
    }
    expect(themeForStage(1, 5)).toBe('lab');
  });
  it('the ghost pick flips only to avoid the same ghosts twice in a row', () => {
    for (const stage of [8, 9, 11, 13, 14, 17, 19]) for (let seed = 0; seed < 4; seed++) {
      const base = ghostPickWith(stage, seed, []);
      const lineup = ghostLineupForStage(stage, base);
      const next = ghostPickWith(stage, seed, [rec(stage - 1, [], { ghosts: lineup })]);
      const again = ghostLineupForStage(stage, next);
      if ([...lineup].sort().join() !== [...ghostLineupForStage(stage, 1 - base)].sort().join()) expect([...again].sort().join()).not.toBe([...lineup].sort().join());
      for (const g of again) expect(GHOST_TYPES).toContain(g);
    }
    expect(ghostPickWith(8, 3, [rec(1, [], { ghosts: ['wisp'] })])).toBe(ghostPickWith(8, 3, [])); // an old record does not count
  });
});
