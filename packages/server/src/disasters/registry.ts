import { ARENA, createRng, deriveSeed, type DisasterId } from '@wb/shared';
import type { StageDef } from '../systems/stageDef';
import { validateStageDef } from '../systems/validate';
import type { RegisteredDisaster } from './framework';
import { REACTOR_OVERLOAD } from './reactorOverload';
import { GRAVITY_INVERSION } from './gravityInversion';
import { REALITY_FRACTURE } from './realityFracture';
import { TEMPORAL_STORM } from './temporalStorm';
import { CASCADING_POWER_FAILURE } from './cascadingPowerFailure';

/**
 * The disaster registry. A disaster is *selectable* (in `SUPPORTED`) only once its lifecycle and real-physics
 * solvability tests have been run and CONFIRMED on the maintainer's machine. Implemented-but-unconfirmed disasters
 * live in `CANDIDATES`: they have generators and tests, but the game never picks them. Promoting one is a one-line
 * move from CANDIDATES to SUPPORTED. Order does not matter: selection is by seed.
 */
const SUPPORTED: readonly RegisteredDisaster[] = [REACTOR_OVERLOAD];
const CANDIDATES: readonly RegisteredDisaster[] = [GRAVITY_INVERSION, REALITY_FRACTURE, TEMPORAL_STORM, CASCADING_POWER_FAILURE];
const IMPLEMENTED: readonly RegisteredDisaster[] = [...SUPPORTED, ...CANDIDATES];
let pool: readonly RegisteredDisaster[] = SUPPORTED;

/** Selectable disasters (what the game may pick). */
export function listDisasters(): readonly RegisteredDisaster[] { return pool; }
export function getDisaster(id: DisasterId): RegisteredDisaster | undefined { return pool.find((d) => d.id === id); }
/** Implemented but not yet selectable (waiting for confirmed tests). Used by tests and tooling only. */
export function listCandidateDisasters(): readonly RegisteredDisaster[] { return CANDIDATES; }
export function getCandidateDisaster(id: DisasterId): RegisteredDisaster | undefined { return CANDIDATES.find((d) => d.id === id); }

/**
 * TEST SEAM: runs `fn` with exactly these implemented disasters selectable (so the real Room -> engine path can
 * play a candidate). The previous pool is always restored. Never call this from production code.
 */
export function withDisasterPool<T>(ids: readonly DisasterId[], fn: () => T): T {
  const next = ids.map((id) => {
    const d = IMPLEMENTED.find((x) => x.id === id);
    if (!d) throw new Error(`Unknown or unimplemented disaster ${id}`);
    return d;
  });
  const prev = pool;
  pool = next;
  try { return fn(); } finally { pool = prev; }
}

/** Disasters that may appear at `stage` (no upper bound: stages are endless). */
export function disastersForStage(stage: number): RegisteredDisaster[] {
  return pool.filter((d) => stage >= d.compat.minStage);
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
