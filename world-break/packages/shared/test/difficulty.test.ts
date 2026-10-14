import { describe, expect, it } from 'vitest';
import { isDifficultyUnlocked, unlockedDifficulties } from '../src';

describe('difficulty unlocks', () => {
  it('only Easy is available at the start', () => {
    expect(unlockedDifficulties(1)).toEqual(['easy']);
  });
  it('Intermediate unlocks exactly at stage 10', () => {
    expect(isDifficultyUnlocked('intermediate', 9)).toBe(false);
    expect(isDifficultyUnlocked('intermediate', 10)).toBe(true);
  });
  it('Hardcore unlocks exactly at stage 20 and keeps lower tiers selectable', () => {
    expect(isDifficultyUnlocked('hardcore', 19)).toBe(false);
    expect(unlockedDifficulties(20)).toEqual(['easy', 'intermediate', 'hardcore']);
  });
});
