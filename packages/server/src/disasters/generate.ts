import type { StageDef } from '../systems/stageDef';
import { fallbackStageDef } from './fallback';

/**
 * Stage N (N >= 2) comes from here, never from a hand-authored table. The seed is derived from the run seed
 * and the stage number by the Room (server-side only). Step 1 of P3A: no disaster generators are registered yet,
 * so this returns the deterministic fallback. Disaster generators are added in the registry step.
 */
export function generateStageDef(stage: number, _seed: number): StageDef {
  return fallbackStageDef(stage);
}
