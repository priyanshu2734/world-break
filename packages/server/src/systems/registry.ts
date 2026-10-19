import type { StageDef } from './stageDef';
import { TUTORIAL_STAGE } from './tutorial';
import { HUNT_STAGE } from './stages/hunt';
import { generateStageDef } from '../disasters/generate';

/** Hand-authored stages only. Stage 1 is the tutorial; every later stage is generated (the game is endless). */
export const STAGE_REGISTRY: Readonly<Record<number, StageDef>> = { 1: TUTORIAL_STAGE };

/**
 * P3C opt-in mapping (additive): with `{ hunt: true }` stage 1 is the salvage hunt instead of the tutorial. Stage 2+ are unchanged
 * and generated, so the game stays endless. `STAGE_REGISTRY` itself is untouched.
 */
export const HUNT_REGISTRY: Readonly<Record<number, StageDef>> = { 1: HUNT_STAGE };

/**
 * Stage number -> definition. Stages are unbounded positive integers: there is no "last" stage.
 * `seed` is the server-side stage seed (see Room); it only matters for generated stages (N >= 2).
 */
export function getStageDef(stage: number, seed = 0, opts: { hunt?: boolean } = {}): StageDef {
  if (!Number.isSafeInteger(stage) || stage < 1) throw new Error(`Invalid stage number ${stage}`);
  const authored = (opts.hunt === true ? HUNT_REGISTRY : STAGE_REGISTRY)[stage];
  if (authored) return authored;
  return generateStageDef(stage, seed);
}
