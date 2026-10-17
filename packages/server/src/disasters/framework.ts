import type { z } from 'zod';
import { createRng, deriveSeed, type DisasterId, type Rng, type ToolId } from '@wb/shared';
import type { StageDef } from '../systems/stageDef';

/** World systems a disaster acts on (documentation + compatibility checks for combinations in P3B). */
export type WorldSystem = 'power_grid' | 'reactor' | 'gravity' | 'time' | 'reality';

export interface DisasterCompat {
  /** First stage number at which this disaster may appear. There is no maximum: the game is endless. */
  minStage: number;
  minPlayers: number;
  maxPlayers: number;
  arenaIds: readonly string[];
  /** Combinations are P3B. Empty until a combination is explicitly defined and tested. */
  combinableWith: readonly DisasterId[];
  conflictsWith: readonly DisasterId[];
}

/**
 * What a disaster author provides. `P` is the generator's parameter object, validated by `paramsSchema`
 * (plain Zod object: no transforms, so input type == output type).
 */
export interface DisasterDefinition<P> {
  id: DisasterId;
  version: number;
  name: string;
  systems: readonly WorldSystem[];
  /** Tools a team cannot finish the stage without (from P2's TOOL_SPECS). */
  requiredTools: readonly ToolId[];
  compat: DisasterCompat;
  paramsSchema: z.ZodType<P>;
  /** Pure and seed-driven: stage number scales difficulty (bounded); the rng varies the layout. */
  deriveParams(stage: number, rng: Rng): P;
  /** Pure: same (stage, seed, params) => identical StageDef. Must set `def.disaster`. */
  generate(input: { stage: number; seed: number; params: P }): StageDef;
}

/** Type-erased handle stored in the registry. */
export interface RegisteredDisaster {
  readonly id: DisasterId;
  readonly version: number;
  readonly name: string;
  readonly systems: readonly WorldSystem[];
  readonly requiredTools: readonly ToolId[];
  readonly compat: DisasterCompat;
  /** Validated parameters for (stage, seed). Throws if the generator produces out-of-bounds parameters. */
  paramsFor(stage: number, seed: number): unknown;
  /** The stage definition for (stage, seed). Same inputs => identical output. */
  generateStage(stage: number, seed: number): StageDef;
}

export function defineDisaster<P>(d: DisasterDefinition<P>): RegisteredDisaster {
  const paramsFor = (stage: number, seed: number): P =>
    d.paramsSchema.parse(d.deriveParams(stage, createRng(deriveSeed(seed, d.id, d.version, 'params'))));
  return {
    id: d.id, version: d.version, name: d.name, systems: d.systems, requiredTools: d.requiredTools, compat: d.compat,
    paramsFor,
    generateStage: (stage, seed) => d.generate({ stage, seed, params: paramsFor(stage, seed) }),
  };
}
