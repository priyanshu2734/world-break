import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@wb/shared';
import { generateEscapeStage } from '../../src/rooms/generate';
import { dropRest, reachablePlatforms } from '../../src/salvage/dropRest';
import { surfaceBelow } from '../../src/salvage/rest';
import { drill, type DrillOptions, type DrillPlan, type DrillResult } from './drill';

/**
 * P4 step 5: solvability with death in the game. What is STRICT here (exact assertions, no thresholds, deterministic: the same code gives the same answer
 * on every run), and what is not (the last describe, labelled STATISTICAL).
 *
 *   1. One player, every stage, many seeds, all three difficulties, the real ghost present but unable to kill: EVERY run clears within 2 slots.
 *   2. One player with a LETHAL ghost and a hiding reflex: every run ends in exactly one of two ways, cleared (nobody died) or died (a recorded ghost kill).
 *      Never stuck, never an unexplained error. Two runs of the same seed give the same answer.
 *   3. Two to four players, a scripted death right after any part is fetched (on foot, or in the air): the part is recovered from where it came to rest and
 *      EVERY run still clears. A single death can never make a stage unsolvable.
 *   4. Where a player can really be, a dropped part never needs to be moved (no generated room has a pit under a standable spot); where it would be moved
 *      (no player can be there) is listed, and the hand-made pit room of `dropRest.test.ts` proves the move itself.
 */
const STAGES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 29, 1_000_000];
/** The drills run twice per stage and size, so they use a thinner grid (every kind of stage, the longest ones and stage 1,000,000). */
const DRILL_STAGES = [2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 29, 1_000_000];
const LONG = 900_000;
const DIFFS: Difficulty[] = ['easy', 'intermediate', 'hardcore'];
const label = (stage: number, seed: number, n: number, o: DrillOptions): string => `stage ${stage} seed ${seed} n=${n} ${o.difficulty ?? 'easy'} ${o.plan ?? ''}/${o.where ?? ''}`;

describe('STRICT 1: one player, every stage, every seed of the grid, every difficulty', () => {
  for (const difficulty of DIFFS) {
    it(`${difficulty}: the ghost is present and cannot kill: every run clears within 2 slots`, () => {
      const bad: string[] = [];
      let runs = 0;
      for (const stage of STAGES) for (const seed of [1, 2, 3, 4]) {
        const r = drill(stage, seed, 1, { difficulty });
        runs++;
        if (!r.cleared || r.error !== '' || r.maxSlots > 2 || r.died) bad.push(`${label(stage, seed, 1, { difficulty })}: ${r.error || `slots ${r.maxSlots} cleared ${r.cleared}`}`);
      }
      expect(runs).toBe(STAGES.length * 4);
      expect(bad).toEqual([]);
    }, LONG);
  }
});

describe('STRICT 2: one player, a lethal ghost and a hiding reflex: cleared or died, nothing else', () => {
  const GRID: [Difficulty, number[]][] = [['easy', [2, 3, 5, 8, 12, 16, 20, 24, 29]], ['intermediate', [3, 12, 20, 29]], ['hardcore', [2, 5, 8, 12, 20, 29]]];
  const classify = (r: DrillResult): 'cleared' | 'died' | 'stuck' => (r.cleared ? 'cleared' : r.died ? 'died' : 'stuck');
  it('every run ends cleared with nobody dead, or dead with a recorded ghost kill; none is stuck or fails for another reason', () => {
    const stuck: string[] = [];
    let cleared = 0, died = 0;
    for (const [difficulty, stages] of GRID) for (const stage of stages) for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = drill(stage, seed, 1, { difficulty, lethal: true, hide: true });
      const k = classify(r);
      if (k === 'stuck') stuck.push(`${label(stage, seed, 1, { difficulty })}: ${r.error}`);
      else if (k === 'cleared') { cleared++; expect(r.ghostKills, label(stage, seed, 1, { difficulty })).toBe(0); }
      else { died++; expect(r.ghostKills, label(stage, seed, 1, { difficulty })).toBeGreaterThanOrEqual(1); }
    }
    expect(stuck).toEqual([]);
    expect(cleared).toBeGreaterThan(100); // the bot gets through most of the grid, and the ghost really does kill it in the rest
    expect(died).toBeGreaterThan(0);
  }, LONG);
  it('is deterministic: the same seeds give the same answer twice', () => {
    const once = (): string => JSON.stringify([[12, 1], [20, 2], [29, 3], [29, 4]].map(([stage, seed]) => drill(stage!, seed!, 1, { difficulty: 'hardcore', lethal: true, hide: true })));
    expect(once()).toBe(once());
  }, LONG);
});

describe('STRICT 3: two to four players: a death right after any fetch never makes a stage unsolvable', () => {
  const PLANS: DrillPlan[] = ['first', 'last', 'every'];
  it('the carrier is killed on their feet or in the air; the part is recovered from where it rests; every run still clears, within 2 slots', () => {
    const bad: string[] = [];
    let runs = 0, kills = 0, recovered = 0;
    for (const stage of DRILL_STAGES) for (const seed of [1, 2]) {
      const dry = drill(stage, seed, 2, {});
      expect(dry.cleared, `dry run ${label(stage, seed, 2, {})}`).toBe(true);
      for (const n of [2, 4]) for (const plan of PLANS) for (const where of ['feet', 'air'] as const) {
        const o: DrillOptions = { plan, where, lastIndex: dry.fetches - 1 };
        const r = drill(stage, seed, n, o);
        runs++; kills += r.kills; recovered += r.recovered;
        const why = (m: string) => bad.push(`${label(stage, seed, n, o)}: ${m}`);
        if (!r.cleared) why(`not cleared: ${r.error}`);
        if (r.maxSlots > 2) why(`slots ${r.maxSlots}`);
        if (r.recovered !== r.kills) why(`recovered ${r.recovered} of ${r.kills} dropped parts`);
        if (r.leadChanges !== r.kills) why(`lead changed ${r.leadChanges} times for ${r.kills} deaths`);
        if (dry.fetches > 0 && plan === 'first' && r.kills !== 1) why(`expected one scripted death, got ${r.kills}`);
        if (dry.fetches === 0 && r.kills !== 0) why('a death with nothing fetched');
        if (r.ghostKills !== 0) why('the ghost killed somebody in a non-lethal drill');
      }
    }
    expect(bad).toEqual([]);
    expect(runs).toBe(DRILL_STAGES.length * 2 * 2 * 3 * 2);
    expect(kills).toBeGreaterThan(80); // the drill really killed carriers, and every dropped part was recovered
    expect(recovered).toBe(kills);
  }, LONG);
  it('three players, every carrier killed in turn (until one is left), on every stage of the grid and every difficulty', () => {
    const bad: string[] = [];
    for (const difficulty of DIFFS) for (const stage of DRILL_STAGES) {
      const r = drill(stage, 3, 3, { difficulty, plan: 'every', where: 'air' });
      if (!r.cleared || r.recovered !== r.kills || r.maxSlots > 2) bad.push(`${label(stage, 3, 3, { difficulty, plan: 'every', where: 'air' })}: ${r.error || `recovered ${r.recovered}/${r.kills}`}`);
    }
    expect(bad).toEqual([]);
  }, LONG);
  it('is deterministic: the same drill gives the same answer twice', () => {
    const once = (): string => JSON.stringify([2, 20, 29].map((stage) => drill(stage, 1, 3, { plan: 'every', where: 'air' })));
    expect(once()).toBe(once());
  }, LONG);
});

describe('STRICT 4: where a player can really be, a dropped part never has to be moved', () => {
  it('on every generated room of every stage of the grid and every difficulty: from any standing spot of a reachable platform and from the air above it, the part rests where it falls', () => {
    let points = 0;
    const moved: string[] = [];
    for (const difficulty of DIFFS) for (const stage of STAGES) for (const seed of [1, 2]) {
      const def = generateEscapeStage(stage, seed, { ghost: true, difficulty });
      for (const room of def.rooms!.rooms) {
        const reach = reachablePlatforms(room.arena);
        room.arena.solids.forEach((s, i) => {
          if (!reach.has(i)) return;
          for (let x = s.x; x <= s.x + s.w; x += 11) for (const up of [0, 40, 80, 120, 160, 200]) {
            const y = s.y - up;
            if (y < 0) continue;
            // a spot a player can occupy: nothing solid between the point and the platform below it
            const first = surfaceBelow(room.arena, x, y);
            if (!first || room.arena.solids.indexOf(first as never) !== i) continue;
            points++;
            const r = dropRest(room.arena, x, y);
            if (r.relocated || r.y !== s.y) moved.push(`${difficulty} stage ${stage} seed ${seed} ${room.id} (${x},${y}) -> (${r.x},${r.y})`);
          }
        });
      }
    }
    expect(points).toBeGreaterThan(20_000);
    expect(moved).toEqual([]);
  }, LONG);
  it('the only generated points that are moved are where nobody can stand: inside the gate wall of a stage 2 start room (listed here so a change shows)', () => {
    const where = new Set<string>();
    for (const stage of [2, 3, 4, 5, 6, 8, 12, 20, 29]) for (const seed of [1, 2, 3, 4]) {
      const def = generateEscapeStage(stage, seed, { ghost: true, difficulty: 'easy' });
      for (const room of def.rooms!.rooms) for (let x = 0; x <= room.arena.width; x += 23) for (const y of [0, 100, 300, 500, 679]) {
        if (dropRest(room.arena, x, y).relocated) where.add(`stage ${stage}: y=${y} inside a solid wall column`);
      }
    }
    expect([...where]).toEqual(['stage 2: y=0 inside a solid wall column']);
  }, LONG);
});

describe('STATISTICAL: a hiding bot with a LETHAL ghost, two to four players (a measure of the bot, not a guarantee about the stage)', () => {
  // Whether four bots that hide when warned all survive the ghosts is a property of the BOT (how well it hides, how well it walks), not of the stage: the stage's
  // solvability is proven above, strictly. These runs are deterministic (so they cannot flake) but they are samples, so they assert only what the sample supports.
  it('early stages are cleared by every team size; later stages are lost to the ghost more often; a run only ever ends cleared, dead, or in the bot’s own reflex timeout', () => {
    let runs = 0, cleared = 0, died = 0, reflex = 0;
    const other: string[] = [];
    for (const n of [2, 3, 4]) for (const stage of [4, 8, 12, 16, 20, 24, 29]) for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = drill(stage, seed, n, { lethal: true, hide: true });
      runs++;
      if (r.cleared) cleared++; else if (r.died) died++; else if (r.error === 'hide detour did not end') reflex++; else other.push(`${label(stage, seed, n, {})}: ${r.error}`);
      if (stage === 4) expect(r.cleared, label(stage, seed, n, {})).toBe(true);
    }
    expect(other).toEqual([]);
    expect(cleared + died + reflex).toBe(runs);
    expect(reflex).toBeLessThanOrEqual(4);
    expect(cleared).toBeGreaterThan(runs * 0.35);
    expect(died).toBeGreaterThan(0);
  }, LONG);
});
