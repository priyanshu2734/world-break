import { describe, expect, it } from 'vitest';
import { ARENA, StageStateSchema, ambientFor, type Difficulty } from '@wb/shared';
import { StageEngine } from '../../src/systems/engine';
import { HUNT_STAGE } from '../../src/systems/stages/hunt';
import { TUTORIAL_STAGE } from '../../src/systems/tutorial';
import { StageDefSchema } from '../../src/systems/stageDef';
import { Room } from '../../src/room';

const darkHunt = StageDefSchema.parse({ ...structuredClone(HUNT_STAGE), dark: true });

describe('P3D 1B: ambient is published by the server from stage and mode', () => {
  it('a lit stage (every existing stage) publishes no darkness field', () => {
    for (const def of [TUTORIAL_STAGE, HUNT_STAGE]) {
      const st = new StageEngine(def, ['p0'], { arena: ARENA }).state();
      expect('darkness' in st).toBe(false);
      expect(StageStateSchema.parse(st).darkness).toBeUndefined();
    }
  });
  it('a dark stage publishes the table value for its difficulty and stage number', () => {
    const cases: [Difficulty, number][] = [['easy', 1], ['easy', 10], ['intermediate', 10], ['hardcore', 100], ['hardcore', 1_000_000]];
    for (const [difficulty, stage] of cases) {
      const st = StageStateSchema.parse(new StageEngine(darkHunt, ['p0', 'p1'], { arena: ARENA, difficulty, stage }).state());
      expect(st.darkness?.ambient).toBe(ambientFor(difficulty, stage));
    }
  });
  it('is the same value for every player of the room (it is part of the shared stage state)', () => {
    const e = new StageEngine(darkHunt, ['p0', 'p1', 'p2'], { arena: ARENA, difficulty: 'intermediate', stage: 7 });
    expect(JSON.stringify(e.state().darkness)).toBe(JSON.stringify({ ambient: 0.14 }));
  });
  it('the real Room passes its difficulty and stage number through (stage 1 hunt stays lit)', () => {
    const room = new Room('ABCD', 2, 1, { hunt: true });
    room.join('p0', 'P0');
    expect(room.start('p0').ok).toBe(true);
    const st = room.consumeStageState();
    expect(st && 'darkness' in st).toBe(false);
  });
});
