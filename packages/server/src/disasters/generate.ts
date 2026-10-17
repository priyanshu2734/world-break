import type { StageDef } from '../systems/stageDef';
import { fallbackStageDef } from './fallback';
import { disastersForStage, generateDisasterStage } from './registry';

/**
 * Stage N (N >= 2) comes from here, never from a hand-authored table. The seed is derived from the run seed
 * and the stage number by the Room (server-side only). Same (stage, seed) => identical StageDef.
 * If no disaster is registered for the stage, the deterministic fallback is used: the game never runs out of stages.
 */
export function generateStageDef(stage: number, seed: number): StageDef {
  if (disastersForStage(stage).length === 0) return fallbackStageDef(stage);
  return generateDisasterStage(stage, seed);
}
