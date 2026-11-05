import { describe, expect, it } from 'vitest';
import { LOOT, THEME_IDS, UPGRADES, type UpgradeId } from '@wb/shared';
import { playRun, type StageOutcome } from './runSolve';

/**
 * P3F step 6: every generated stage of a RUN stays solvable (the stage is the claim). What is strict here and what depends on the bot:
 *   STRICT (exact): a run of consecutive stages, each generated with the run's history, the previous draft pick in force and the ghost present, is cleared by the solver
 *   within two hand slots (three with the Extra hand), alone and with 2 to 4 players; the side visits (examine, journal, cache) never break a solve. The solver is deterministic.
 *   BOT: whether a bot SURVIVES a lethal ghost, and how long the solver takes, are properties of the bot: they are in `death/solve` (a statistical band) and are not asserted here.
 * Themes are looks only: they are recorded for the run and no rule reads them.
 */
const SLOW = 600_000;
const bad = (outs: StageOutcome[], what: string, maxSlots = 2): string[] => outs.flatMap((o) => {
  const why: string[] = [];
  if (!o.cleared) why.push(`not cleared: ${o.error}`);
  if (o.maxSlots > maxSlots) why.push(`slots ${o.maxSlots}`);
  return why.map((w) => `${what} stage ${o.stage}: ${w}`);
});

describe('P3F step 6: a run of consecutive stages, alone', () => {
  it('stages 1 to 16 (every curriculum row, puzzles from 7, the cache on 13), four run seeds, Easy', () => {
    const problems: string[] = [];
    const themes = new Set<string>();
    for (const runSeed of [1, 2, 3, 4]) {
      const outs = playRun({ runSeed, players: 1, from: 1, count: 16 });
      expect(outs.length, `seed ${runSeed}`).toBe(16);
      problems.push(...bad(outs, `seed ${runSeed}`));
      for (const o of outs) if (o.theme) themes.add(o.theme);
      expect(outs[12]!.hasLoot, `seed ${runSeed}: stage 13 holds the cache`).toBe(true);
      expect(outs.slice(0, 12).some((o) => o.hasLoot)).toBe(false);
    }
    expect(problems).toEqual([]);
    expect(themes.size).toBe(THEME_IDS.length);
  }, SLOW);
  it('Intermediate and Hardcore: stages 2 to 15, two run seeds', () => {
    const problems: string[] = [];
    for (const difficulty of ['intermediate', 'hardcore'] as const) for (const runSeed of [5, 6]) problems.push(...bad(playRun({ runSeed, players: 1, from: 2, count: 14, difficulty }), `${difficulty} seed ${runSeed}`));
    expect(problems).toEqual([]);
  }, SLOW);
  it('two ghosts (stages 18 to 25): both are in play from stage 20, never more, and every stage is cleared', () => {
    const problems: string[] = [];
    for (const runSeed of [1, 2, 3]) {
      const outs = playRun({ runSeed, players: 1, from: 18, count: 8 });
      problems.push(...bad(outs, `seed ${runSeed}`));
      for (const o of outs) expect(o.ghosts, `seed ${runSeed} stage ${o.stage}`).toBe(o.stage >= 20 ? 2 : 1);
    }
    expect(problems).toEqual([]);
  }, SLOW);
  it('is deterministic: the same run gives the same stages and the same answer twice', () => {
    const once = (): string => JSON.stringify(playRun({ runSeed: 3, players: 1, from: 5, count: 6 }).map((o) => [o.stage, o.cleared, o.locks, o.theme, o.maxSlots]));
    expect(once()).toBe(once());
  }, SLOW);
});

describe('P3F step 6: a run of consecutive stages, 2 to 4 players', () => {
  it('stages 3 to 14 with 2, 3 and 4 players, two run seeds: every stage cleared, within two slots', () => {
    const problems: string[] = [];
    for (const players of [2, 3, 4]) for (const runSeed of [1, 2]) problems.push(...bad(playRun({ runSeed, players, from: 3, count: 12 }), `${players} players seed ${runSeed}`));
    expect(problems).toEqual([]);
  }, SLOW);
  it('the two-ghost stages with a team: stages 19 to 23, 2 and 4 players', () => {
    const problems: string[] = [];
    for (const players of [2, 4]) problems.push(...bad(playRun({ runSeed: 7, players, from: 19, count: 5 }), `${players} players`));
    expect(problems).toEqual([]);
  }, SLOW);
});

describe('P3F step 6: the draft effects never make a stage unsolvable', () => {
  const ALL = Object.fromEntries((Object.keys(UPGRADES) as UpgradeId[]).map((id) => [id, UPGRADES[id].max])) as Record<UpgradeId, number>;
  it('every upgrade at its maximum at once (the bounds hold, the trade-offs included): stages 12 to 17, alone and with three players', () => {
    const problems: string[] = [];
    for (const players of [1, 3]) for (const runSeed of [1, 2, 3]) problems.push(...bad(playRun({ runSeed, players, from: 12, count: 6, owned: ALL }), `${players} players seed ${runSeed}`, 3)); // the Extra hand allows a third slot
    expect(problems).toEqual([]);
  }, SLOW);
  it('the draft is taken stage by stage on a real run (the first option each time) and the run goes on', () => {
    const outs = playRun({ runSeed: 11, players: 2, from: 2, count: 10 });
    expect(bad(outs, 'draft run', 3)).toEqual([]);
  }, SLOW);
});

describe('P3F step 6: the side visits (evidence, journal, cache) never break a solve', () => {
  it('examine every trace, fill the journal with the real types, open the cache: stages 7 to 16, alone and with two players; the cache pays what the seed fixed', () => {
    const problems: string[] = [];
    let examined = 0, marked = 0;
    const paid = new Set<string>();
    for (const players of [1, 2]) for (const runSeed of [1, 2, 3]) {
      const outs = playRun({ runSeed, players, from: 7, count: 10, extras: { examine: true, mark: true, loot: true } });
      problems.push(...bad(outs, `${players} players seed ${runSeed}`, 3));
      for (const o of outs) {
        examined += o.examined; marked += o.marked;
        if (o.hasLoot) { expect(o.looted, `stage ${o.stage}`).not.toBe(''); paid.add(o.lootOutcome); }
        else expect(o.looted).toBe('');
      }
    }
    expect(problems).toEqual([]);
    expect(examined).toBeGreaterThan(40);
    expect(marked).toBeGreaterThan(20);
    expect(paid.size).toBeGreaterThanOrEqual(2); // over these runs the cache paid at least two of its three outcomes (all three are covered by the next test)
    expect(LOOT.fromStage).toBe(13);
  }, SLOW);
  it('the cache, opened on stage 13 under many run seeds: all three outcomes happen, and every stage still clears', () => {
    const seen = new Set<string>();
    const problems: string[] = [];
    for (let runSeed = 1; runSeed <= 24 && seen.size < 3; runSeed++) {
      const outs = playRun({ runSeed, players: 1, from: 13, count: 1, extras: { loot: true } });
      problems.push(...bad(outs, `seed ${runSeed}`, 3));
      seen.add(outs[0]!.lootOutcome);
    }
    expect(problems).toEqual([]);
    expect([...seen].sort()).toEqual(['hazard', 'score', 'upgrade']);
  }, SLOW);
});
