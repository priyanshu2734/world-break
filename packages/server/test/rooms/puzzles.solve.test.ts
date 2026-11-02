import { describe, expect, it } from 'vitest';
import { PUZZLE_TYPES, deriveSeed, type PuzzleType } from '@wb/shared';
import { generateEscapeStage } from '../../src/rooms/generate';
import { advanceTo, newRun, solveStage } from './solver';
import { Bot, Team } from './bot';
import { fetchItem, itemAct, seen, type Play } from './flows';

/**
 * P3F step 2: every new puzzle type is PLAYED, with the real physics and the real Room API: the solver reads the notes as a person would (the words, not the private
 * definition), acts on them, and must clear the stage within two hand slots. Stages that hold the type are found by generating them (the stage seed of a run is a pure
 * function of the run seed and the stage number), so each case plays a stage that really contains the puzzle.
 */
const SLOW = 600_000;

/** `count` (stage, run seed) pairs whose generated stage holds a lock of `type`, scanning stages from `from` upward. */
function find(type: PuzzleType, from: number, count: number, skip = 0): { stage: number; runSeed: number }[] {
  const out: { stage: number; runSeed: number }[] = [];
  let seen = 0;
  for (let stage = from; stage < from + 60 && out.length < count; stage++) {
    for (let runSeed = 3; runSeed < 60 && out.length < count; runSeed += 2) {
      const def = generateEscapeStage(stage, deriveSeed(runSeed, 'stage', stage));
      if (def.escape!.links.some((l) => l.lock.type === type) && seen++ >= skip) out.push({ stage, runSeed });
    }
  }
  return out;
}

describe('P3F step 2: each new puzzle is solved alone by a player who reads the notes', () => {
  for (const type of PUZZLE_TYPES) {
    it(`${type}: solved alone on generated stages that hold it`, () => {
      const cases = find(type, type === 'symbol_match' ? 14 : 12, 2);
      expect(cases.length).toBe(2);
      for (const { stage, runSeed } of cases) {
        const { room, ids } = newRun(1, runSeed);
        const def = advanceTo(room, ids, stage);
        expect(def.escape!.links.some((l) => l.lock.type === type)).toBe(true);
        const st = solveStage(room, ids, def);
        expect(room.phase).toBe('stage_complete');
        expect(st.maxSlots).toBeLessThanOrEqual(2);
      }
    }, SLOW);
  }
});

describe('P3F step 2: and by two to four players', () => {
  for (const type of PUZZLE_TYPES) {
    it(`${type}: solved by 2 players (everybody follows through the doors)`, () => {
      const [c] = find(type, 16, 1, 2);
      expect(c).toBeDefined();
      const { room, ids } = newRun(2, c!.runSeed);
      const def = advanceTo(room, ids, c!.stage);
      solveStage(room, ids, def, { coop: true });
      expect(room.phase).toBe('stage_complete');
    }, SLOW);
  }
});

describe('P3F step 2: the jammed locker (a tool key) in a real Room', () => {
  it('opens only for a carried valve wheel: bare hands are refused, a cracked wheel snaps, a genuine one opens it and is not used up', () => {
    let hit: { stage: number; runSeed: number } | undefined;
    for (let stage = 12; stage < 60 && !hit; stage++) for (let runSeed = 3; runSeed < 80 && !hit; runSeed += 2) {
      const def = generateEscapeStage(stage, deriveSeed(runSeed, 'stage', stage));
      const l = def.escape!.links[0]!.lock;
      if (l.type === 'tool_key' && (def.items ?? []).some((i) => i.kind === 'valve_wheel' && i.decoy === true)) hit = { stage, runSeed };
    }
    expect(hit).toBeDefined();
    const { room, ids } = newRun(1, hit!.runSeed);
    const def = advanceTo(room, ids, hit!.stage);
    const lock = def.escape!.links[0]!.lock;
    if (lock.type !== 'tool_key') throw new Error('not a tool key');
    const arenas = new Map(def.rooms!.rooms.map((r) => [r.id, r.arena]));
    const team = new Team(room, (id) => arenas.get(id)!);
    team.tick();
    const bot = new Bot(team, 'p0');
    const play: Play = { room, team, bots: [bot], ids, arenas };
    const st = def.stashes!.find((x) => x.id === lock.stashId)!;
    const key = def.items!.find((i) => i.hidden?.stashId === lock.stashId)!;
    const cracked = def.items!.find((i) => i.kind === 'valve_wheel' && i.decoy === true)!;
    const wheel = def.items!.find((i) => i.kind === 'valve_wheel' && i.decoy !== true)!;
    expect(st.label).toBe('Jammed locker');
    // bare hands
    bot.goTo(st.x, st.y);
    const bare = itemAct(play, { action: 'open', stashId: st.id });
    expect(bare.ok).toBe(false); expect((bare as { error: string }).error).toBe('Jammed shut.');
    expect(seen(play, key.id)).toBeUndefined(); // nothing was revealed
    // a cracked wheel snaps and is gone
    expect(fetchItem(play, bot, cracked.id).ok).toBe(true);
    bot.goTo(st.x, st.y);
    const snap = itemAct(play, { action: 'open', stashId: st.id });
    expect(snap.ok).toBe(false); expect((snap as { error: string }).error).toMatch(/cracked/);
    expect(team.state().items!.players.find((p) => p.id === 'p0')!.slotsUsed).toBe(0);
    expect(seen(play, key.id)).toBeUndefined();
    // the genuine one opens it, and stays in the hand
    expect(fetchItem(play, bot, wheel.id).ok).toBe(true);
    bot.goTo(st.x, st.y);
    expect(itemAct(play, { action: 'open', stashId: st.id }).ok).toBe(true);
    expect(team.state().items!.items.find((i) => i.id === wheel.id)!.state).toBe('carried');
    expect(seen(play, key.id)).toBeDefined();
    expect(fetchItem(play, bot, key.id).ok).toBe(true);
    expect(team.state().items!.players.find((p) => p.id === 'p0')!.slotsUsed).toBe(2);
  }, SLOW);
});

describe('P3F step 2: sweeps over many stages and seeds', () => {
  it('solo: 12 stages (6 to 1,000,000) x 12 run seeds are all cleared within two slots, and every new type is met', () => {
    const met = new Set<string>();
    for (const stage of [6, 8, 10, 12, 14, 17, 22, 28, 33, 41, 100, 1_000_000]) for (let runSeed = 5; runSeed < 5 + 12 * 4; runSeed += 4) {
      const { room, ids } = newRun(1, runSeed);
      const def = advanceTo(room, ids, stage);
      for (const l of def.escape!.links) met.add(l.lock.type);
      expect(solveStage(room, ids, def).maxSlots).toBeLessThanOrEqual(2);
      expect(room.phase).toBe('stage_complete');
    }
    for (const t of PUZZLE_TYPES) expect(met.has(t), t).toBe(true);
  }, SLOW);

  it('2, 3 and 4 players: the lead solves and everybody follows through every door, on stages 7 to 41', () => {
    for (const players of [2, 3, 4]) for (const stage of [7, 9, 12, 15, 24, 41]) for (const runSeed of [11, 23, 35]) {
      const { room, ids } = newRun(players, runSeed);
      const def = advanceTo(room, ids, stage);
      expect(solveStage(room, ids, def, { coop: true }).maxSlots).toBeLessThanOrEqual(2);
      expect(room.phase).toBe('stage_complete');
    }
  }, SLOW);
});
