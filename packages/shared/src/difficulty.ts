import { z } from 'zod';
import { DIFFICULTY_UNLOCK_STAGE } from './constants';

export const DifficultySchema = z.enum(['easy', 'intermediate', 'hardcore']);
export type Difficulty = z.infer<typeof DifficultySchema>;
export const DIFFICULTIES = DifficultySchema.options;

export function isDifficultyUnlocked(difficulty: Difficulty, highestStageReached: number): boolean {
  return highestStageReached >= DIFFICULTY_UNLOCK_STAGE[difficulty];
}

export function unlockedDifficulties(highestStageReached: number): Difficulty[] {
  return DIFFICULTIES.filter((d) => isDifficultyUnlocked(d, highestStageReached));
}
