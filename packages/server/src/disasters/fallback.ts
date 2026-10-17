import type { StageDef } from '../systems/stageDef';
import { TUTORIAL_STAGE } from '../systems/tutorial';

/**
 * Deterministic last-resort stage. It is the hand-authored tutorial under a new id, so it is known to
 * validate and to be solvable. Used when no generator is available or a generated stage fails validation:
 * the game never reports that a stage is missing.
 */
export function fallbackStageDef(stage: number): StageDef {
  if (!Number.isSafeInteger(stage) || stage < 1) throw new Error(`Invalid stage number ${stage}`);
  const def = structuredClone(TUTORIAL_STAGE);
  def.id = `fallback_stage_${stage}`; // slug: lowercase letters, digits, underscore; well under 40 chars
  def.name = 'Cold Start (recovery)';
  return def;
}
