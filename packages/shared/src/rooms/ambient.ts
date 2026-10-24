import type { Difficulty } from '../difficulty';

/**
 * P3D (step 1B): how dark an escape stage is. Ambient brightness is a STAGE parameter, the same for everyone in the room:
 * it never comes from a player setting. It starts at `base` percent on stage 1, loses `AMBIENT_DROP_PER_STAGE` points per
 * stage and never goes below `floor`. The player's own light (radius and flashlight) is separate and always present.
 */
export const AMBIENT_TABLE: Readonly<Record<Difficulty, { readonly base: number; readonly floor: number }>> = {
  easy: { base: 30, floor: 10 },
  intermediate: { base: 20, floor: 5 },
  hardcore: { base: 10, floor: 2 },
};
export const AMBIENT_DROP_PER_STAGE = 1;

/** Ambient brightness in percent (0..100) for a stage number (1-based; anything below 1 or not a number counts as stage 1). */
export function ambientPercent(difficulty: Difficulty, stage: number): number {
  const t = AMBIENT_TABLE[difficulty];
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  return Math.max(t.floor, t.base - (s - 1) * AMBIENT_DROP_PER_STAGE);
}

/** The same value as a 0..1 fraction (the value published in `StageState.darkness.ambient`). */
export function ambientFor(difficulty: Difficulty, stage: number): number {
  return ambientPercent(difficulty, stage) / 100;
}
