import { describe, expect, it } from 'vitest';
import { CURRICULUM, THEME_IDS, deriveSeed, featuredLock, trimHistory, type VarietyRecord } from '@wb/shared';
import { generateEscapeStage } from '../../src/rooms/generate';
import { varietyRecordOf } from '../../src/rooms/variety';

/** P3F step 4: the curriculum rows and the cross-stage newness rule, on whole runs of stages generated the way the Room generates them (each with the history of the stages before it). */
function run(runSeed: number, from: number, to: number, ghost: boolean): { stage: number; def: ReturnType<typeof generateEscapeStage>; rec: VarietyRecord }[] {
  const hist: VarietyRecord[] = [];
  const out: { stage: number; def: ReturnType<typeof generateEscapeStage>; rec: VarietyRecord }[] = [];
  for (let stage = from; stage <= to; stage++) {
    const seed = deriveSeed(runSeed, 'stage', stage), h = trimHistory(hist);
    const def = generateEscapeStage(stage, seed, { ghost, history: h });
    const rec = varietyRecordOf(stage, seed, def, ghost, h);
    hist.push(rec);
    out.push({ stage, def, rec });
  }
  return out;
}
const locksOfDef = (d: ReturnType<typeof generateEscapeStage>): string[] => d.escape!.links.map((l) => l.lock.type);

describe('P3F step 4: curriculum rows 1 to 15', () => {
  it('every stage of the curriculum holds its featured lock, for 30 runs, with and without the ghost', () => {
    for (let r = 1; r <= 10; r++) for (const ghost of [false, true]) {
      for (const { stage, def } of run(r * 104729, 1, 15, ghost)) {
        const want = featuredLock(stage);
        if (want !== null) expect(locksOfDef(def), `run ${r} stage ${stage}`).toContain(want);
      }
    }
    expect(CURRICULUM.filter((c) => c.lock !== null).length).toBe(13);
  });
  it('a single stage on its own (no history) holds its featured lock too, over many seeds', () => {
    for (let stage = 1; stage <= 15; stage++) for (let seed = 1; seed <= 20; seed++) {
      const want = featuredLock(stage);
      if (want !== null) expect(locksOfDef(generateEscapeStage(stage, seed * 31337, {})), `stage ${stage} seed ${seed}`).toContain(want);
    }
  });
  it('the new thing arrives where the table says: a puzzle never before its row', () => {
    for (let r = 1; r <= 10; r++) for (const { stage, def } of run(r * 7919, 1, 15, true)) {
      for (const t of locksOfDef(def)) {
        const row = CURRICULUM.find((c) => c.lock === t);
        if (row && ['breaker_panel', 'pressure_plates', 'flashlight_sensor', 'lever_sequence', 'tool_key', 'timed_switch', 'symbol_match', 'wiring'].includes(t)) expect(stage, `${t}`).toBeGreaterThanOrEqual(row.stage);
      }
    }
  });
});

describe('P3F step 4: no stage repeats the previous stage in lock type, ghost types, room template or theme', () => {
  const RUNS = 12;
  it('the lock type of the last door of a stage is never the first door of the next (stage 2 to 1,000,000 across the run; stage 3 and the tutorial boundary are exempt)', () => {
    for (let r = 1; r <= RUNS; r++) for (const ghost of [false, true]) {
      const stages = run(r * 15485863, 1, 36, ghost);
      for (let i = 1; i < stages.length; i++) {
        const prev = stages[i - 1]!, cur = stages[i]!;
        if (cur.stage <= 3) continue; // stages 1 and 2 keep their original draws, and stage 3 must show the code lock whatever stage 2 drew
        expect(locksOfDef(cur.def)[0], `run ${r} stage ${cur.stage}`).not.toBe(locksOfDef(prev.def).at(-1));
      }
    }
  });
  it('and it holds at the far end of the run (stages 999,990 to 1,000,000)', () => {
    for (let r = 1; r <= 5; r++) {
      const stages = run(r * 15485863, 999_990, 1_000_000, true);
      for (let i = 1; i < stages.length; i++) expect(locksOfDef(stages[i]!.def)[0]).not.toBe(locksOfDef(stages[i - 1]!.def).at(-1));
      for (const s of stages) for (let k = 1; k < locksOfDef(s.def).length; k++) expect(locksOfDef(s.def)[k]).not.toBe(locksOfDef(s.def)[k - 1]);
    }
  });
  it('the room templates of two stages in a row never share one (the odd and even pools), and the theme always changes', () => {
    for (let r = 1; r <= RUNS; r++) {
      const stages = run(r * 32452843, 1, 30, true);
      for (let i = 1; i < stages.length; i++) {
        const a = stages[i - 1]!.rec, b = stages[i]!.rec;
        for (const t of b.templates) if (b.stage > 3 && a.stage > 2) expect(a.templates, `run ${r} stage ${b.stage}`).not.toContain(t);
        expect(b.theme).not.toBe(a.theme);
        expect(THEME_IDS).toContain(b.theme);
      }
    }
  });
  it('the ghost types change from stage to stage wherever the lineup table allows a choice (stages 8 to 11, 13 to 19)', () => {
    for (let r = 1; r <= RUNS; r++) {
      const stages = run(r * 49979687, 7, 19, true);
      for (let i = 1; i < stages.length; i++) {
        const a = stages[i - 1]!.rec, b = stages[i]!.rec;
        if ((b.stage >= 8 && b.stage <= 11 && a.stage >= 8) || (b.stage >= 14 && b.stage <= 19)) expect([...b.ghosts].sort().join(), `run ${r} stage ${b.stage}`).not.toBe([...a.ghosts].sort().join());
      }
    }
  });
});

describe('P3F step 4: older seeds keep their stages', () => {
  it('without a history a stage is exactly what the same call with an empty history gives', () => {
    for (const stage of [3, 9, 16, 20, 33, 1_000_000]) for (let s = 1; s <= 4; s++) {
      const a = generateEscapeStage(stage, s * 977, { ghost: true });
      const b = generateEscapeStage(stage, s * 977, { ghost: true, history: [] });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
  it('after the curriculum (stage 16 on) nothing is forced: the stages still generate on the first attempt for many seeds', () => {
    for (let stage = 16; stage <= 40; stage++) for (let s = 1; s <= 6; s++) {
      expect(() => generateEscapeStage(stage, s * 6007, { ghost: true })).not.toThrow();
    }
  });
});
