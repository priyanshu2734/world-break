import type { StageDef } from './stageDef';
import { TUTORIAL_STAGE } from './tutorial';
import { generateStageDef } from '../disasters/generate';

/** Hand-authored stages only. Stage 1 is the tutorial; every later stage is generated (the game is endless). */
export const STAGE_REGISTRY: Readonly<Record<number, StageDef>> = { 1: TUTORIAL_STAGE };

/**
 * Stage number -> definition. Stages are unbounded positive integers: there is no "last" stage.
 * `seed` is the server-side stage seed (see Room); it only matters for generated stages (N >= 2).
 */
export function getStageDef(stage: number, seed = 0): StageDef {
  if (!Number.isSafeInteger(stage) || stage < 1) throw new Error(`Invalid stage number ${stage}`);
  const authored = STAGE_REGISTRY[stage];
  if (authored) return authored;
  return generateStageDef(stage, seed);
}
