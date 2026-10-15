import type { StageDef } from './stageDef';
import { TUTORIAL_STAGE } from './tutorial';

/** Stage number -> authored definition. P3+ adds entries here; the engine and validator are stage-agnostic. */
export const STAGE_REGISTRY: Readonly<Record<number, StageDef>> = { 1: TUTORIAL_STAGE };

export function getStageDef(stage: number): StageDef {
  const def = STAGE_REGISTRY[stage];
  if (!def) throw new Error(`No stage definition for stage ${stage}`);
  return def;
}
