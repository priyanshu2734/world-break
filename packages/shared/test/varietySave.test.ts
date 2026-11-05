import { describe, expect, it } from 'vitest';
import { HISTORY_KEEP, THEME_IDS, VarietyHistorySchema, VarietyRecordSchema, normaliseHistory, type VarietyRecord } from '../src';

/** P3F step 6: the variety history is something a save (P6) and the scenario generator (P5) can keep, validate and hand back. */
const rec = (stage: number, over: Partial<VarietyRecord> = {}): VarietyRecord => ({ stage, locks: ['code'], templates: ['hall'], ghosts: ['wisp'], theme: THEME_IDS[stage % THEME_IDS.length]!, ...over });

describe('P3F step 6: the variety history schema', () => {
  it('accepts a record, survives a JSON round trip and an empty history', () => {
    const h = [rec(4), rec(5), rec(6)];
    expect(VarietyHistorySchema.parse(JSON.parse(JSON.stringify(h)))).toEqual(h);
    expect(VarietyHistorySchema.parse([])).toEqual([]);
  });
  it('refuses unknown keys, a bad theme, a bad ghost, stage 0, too many ghosts and an oversized list', () => {
    expect(VarietyRecordSchema.safeParse({ ...rec(3), extra: 1 }).success).toBe(false);
    expect(VarietyRecordSchema.safeParse({ ...rec(3), theme: 'swamp' }).success).toBe(false);
    expect(VarietyRecordSchema.safeParse({ ...rec(3), ghosts: ['nope'] }).success).toBe(false);
    expect(VarietyRecordSchema.safeParse(rec(0)).success).toBe(false);
    expect(VarietyRecordSchema.safeParse(rec(1.5)).success).toBe(false);
    expect(VarietyRecordSchema.safeParse({ ...rec(3), ghosts: ['wisp', 'wisp', 'wisp'] }).success).toBe(false);
    expect(VarietyHistorySchema.safeParse(Array.from({ length: 17 }, (_, i) => rec(i + 1))).success).toBe(false);
  });
});

describe('P3F step 6: normaliseHistory', () => {
  it('sorts oldest first, keeps one record per stage (the last given) and only the newest HISTORY_KEEP', () => {
    const out = normaliseHistory([rec(9), rec(5), rec(7), rec(5, { theme: THEME_IDS[0]! }), rec(8), rec(6)]);
    expect(out.map((r) => r.stage)).toEqual([7, 8, 9].slice(-HISTORY_KEEP));
    expect(out.length).toBe(HISTORY_KEEP);
    const dup = normaliseHistory([rec(5), rec(5, { locks: ['safe'] })]);
    expect(dup).toHaveLength(1);
    expect(dup[0]!.locks).toEqual(['safe']);
  });
  it('is idempotent and never mutates its input', () => {
    const input = [rec(3), rec(2), rec(1), rec(4)];
    const copy = JSON.stringify(input);
    const once = normaliseHistory(input);
    expect(JSON.stringify(input)).toBe(copy);
    expect(normaliseHistory(once)).toEqual(once);
  });
});
