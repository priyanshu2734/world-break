import { ARENA, createRng, deriveSeed, type DisasterId } from '@wb/shared';
import type { StageDef } from '../systems/stageDef';
import { validateStageDef } from '../systems/validate';
import type { RegisteredDisaster } from './framework';
import { REACTOR_OVERLOAD } from './reactorOverload';

/**
 * The disaster registry. Add a disaster here only together with its generator, lifecycle tests and a real-physics
 * solvability test (a disaster counts as *supported* only when both pass). Order does not matter: selection is by seed.
 */
const ALL: readonly RegisteredDisaster[] = [REACTOR_OVERLOAD];
const BY_ID = new Map<DisasterId, RegisteredDisaster>(ALL.map((d) => [d.id, d]));

export function listDisasters(): readonly RegisteredDisaster[] { return ALL; }
export function getDisaster(id: DisasterId): RegisteredDisaster | undefined { return BY_ID.get(id); }

/** Disasters that may appear at `stage` (no upper bound: stages are endless). */
export function disastersForStage(stage: number): RegisteredDisaster[] {
  return ALL.filter((d) => stage >= d.compat.minStage);
}

/**
 * Deterministically picks a disaster for (stage, seed), generates its stage and validates it. Same inputs =>
 * identical StageDef. Throws if nothing is compatible or the generated stage fails validation (the Room then uses
 * the tested fallback stage, so the game never stops).
 */
export function generateDisasterStage(stage: number, seed: number): StageDef {
  if (!Number.isSafeInteger(stage) || stage < 2) throw new Error(`Disaster stages start at stage 2 (got ${stage})`);
  const candidates = disastersForStage(stage);
  if (candidates.length === 0) throw new Error(`No disaster is compatible with stage ${stage}`);
  const disaster = createRng(deriveSeed(seed, 'pick', stage)).pick(candidates);
  const def = disaster.generateStage(stage, seed);
  const errors = validateStageDef(def, ARENA);
  if (errors.length) throw new Error(`Generated ${disaster.id} stage ${stage} is invalid:\n - ${errors.join('\n - ')}`);
  return def;
}
