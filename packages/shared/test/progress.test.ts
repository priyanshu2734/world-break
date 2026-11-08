import { describe, expect, it } from 'vitest';
import {
  COSMETIC_IDS, DIFFICULTY_UNLOCK_STAGE, ProfileSchema, REWARD_EVERY, RunChoiceSchema, RunSaveSchema, StageResultSchema, UPGRADES, guestProfile, isDifficultyUnlocked,
  milestonesReached, rewardAtStage, rewardsFor, unlockedDifficulties, unlockedFor,
} from '../src';

describe('P6 C unlock boundaries (difficulty.ts is frozen: the rule is only asked)', () => {
  it('Intermediate unlocks at stage 10 and Hardcore at stage 20; Easy from stage 1', () => {
    expect(DIFFICULTY_UNLOCK_STAGE).toMatchObject({ easy: 1, intermediate: 10, hardcore: 20 });
    for (const [stage, want] of [[1, ['easy']], [9, ['easy']], [10, ['easy', 'intermediate']], [11, ['easy', 'intermediate']], [19, ['easy', 'intermediate']], [20, ['easy', 'intermediate', 'hardcore']], [21, ['easy', 'intermediate', 'hardcore']]] as const)
      expect(unlockedFor(stage), `stage ${stage}`).toEqual([...want]);
  });
  it('stage 9, 10, 11 and 19, 20, 21 one by one', () => {
    expect(isDifficultyUnlocked('intermediate', 9)).toBe(false);
    expect(isDifficultyUnlocked('intermediate', 10)).toBe(true);
    expect(isDifficultyUnlocked('intermediate', 11)).toBe(true);
    expect(isDifficultyUnlocked('hardcore', 19)).toBe(false);
    expect(isDifficultyUnlocked('hardcore', 20)).toBe(true);
    expect(isDifficultyUnlocked('hardcore', 21)).toBe(true);
  });
  it('a huge stage (1,000,000) works: everything unlocked, rewards capped, no loop over the stage number', () => {
    expect(unlockedDifficulties(1_000_000)).toEqual(['easy', 'intermediate', 'hardcore']);
    expect(milestonesReached(1_000_000)).toBe(100_000);
    expect(rewardsFor(1_000_000)).toEqual([...COSMETIC_IDS]);
    expect(rewardAtStage(1_000_000)).toBeNull(); // only the first twelve milestones grant something new
    expect(StageResultSchema.safeParse({ stage: 1_000_000, mode: 'hardcore', ticks: 5, score: 5, players: 4, deaths: 0 }).success).toBe(true);
  });
});

describe('P6 C cosmetic rewards', () => {
  it('none before stage 10; one at each multiple of 10, in a stable order; at most all twelve', () => {
    expect(rewardsFor(1)).toEqual([]);
    expect(rewardsFor(9)).toEqual([]);
    expect(rewardsFor(10)).toEqual([COSMETIC_IDS[0]]);
    expect(rewardsFor(29)).toEqual([COSMETIC_IDS[0], COSMETIC_IDS[1]]);
    expect(rewardsFor(30)).toHaveLength(3);
    expect(rewardsFor(10_000)).toHaveLength(COSMETIC_IDS.length);
    expect(REWARD_EVERY).toBe(10);
  });
  it('rewardAtStage names the cosmetic of a milestone and nothing else', () => {
    expect(rewardAtStage(10)).toBe(COSMETIC_IDS[0]);
    expect(rewardAtStage(20)).toBe(COSMETIC_IDS[1]);
    for (const s of [0, 1, 9, 11, 15, -10, 10.5, NaN]) expect(rewardAtStage(s), `${s}`).toBeNull();
  });
  it('is arithmetic on bad input too: no exception', () => {
    for (const s of [NaN, -1, 0, Infinity, 2 ** 60]) expect(() => rewardsFor(s)).not.toThrow();
    expect(rewardsFor(NaN)).toEqual([]);
  });
});

const goodSave = { stage: 12, mode: 'intermediate', seedBase: 12345, variety: [], upgrades: { wide_beam: 1 }, pickOrder: ['wide_beam'] };
describe('P6 C save slot schema (a tampered save is refused)', () => {
  it('accepts a genuine save, including a seed above 2^31', () => {
    expect(RunSaveSchema.safeParse(goodSave).success).toBe(true);
    expect(RunSaveSchema.safeParse({ ...goodSave, seedBase: 4_000_000_000 }).success).toBe(true);
  });
  it('refuses: stage 0 or fractional, unknown mode, unknown upgrade, too many of one upgrade, extra fields, a huge pick order', () => {
    const bad: unknown[] = [
      { ...goodSave, stage: 0 }, { ...goodSave, stage: 1.5 }, { ...goodSave, stage: 2_000_000_000 }, { ...goodSave, mode: 'nightmare' },
      { ...goodSave, upgrades: { godmode: 3 } }, { ...goodSave, upgrades: { wide_beam: UPGRADES.wide_beam.max + 1 } }, { ...goodSave, upgrades: { wide_beam: -1 } },
      { ...goodSave, isAdmin: true }, { ...goodSave, pickOrder: new Array(65).fill('wide_beam') }, { ...goodSave, seedBase: -1 }, { ...goodSave, seedBase: 2 ** 33 },
      { ...goodSave, variety: [{ stage: 1 }] }, null, 'save', [],
    ];
    for (const b of bad) expect(RunSaveSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });
});

describe('P6 C profile and choices', () => {
  it('a guest has nothing saved, only Easy, no rewards', () => {
    const g = guestProfile();
    expect(g).toMatchObject({ signedIn: false, highestStage: 1, unlocked: ['easy'], rewards: [], save: null, storage: 'guest' });
    expect(ProfileSchema.safeParse(g).success).toBe(true);
  });
  it('the profile schema is strict and the choice is an enum', () => {
    expect(ProfileSchema.safeParse({ ...guestProfile(), admin: true }).success).toBe(false);
    expect(RunChoiceSchema.safeParse({ choice: 'continue' }).success).toBe(true);
    expect(RunChoiceSchema.safeParse({ choice: 'continue', stage: 99 }).success).toBe(false);
    expect(RunChoiceSchema.safeParse({ choice: 'cheat' }).success).toBe(false);
  });
});
