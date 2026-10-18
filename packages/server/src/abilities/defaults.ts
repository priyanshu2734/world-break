import { AbilityConfigSchema, type AbilityConfig, type StageDef } from '../systems/stageDef';

/**
 * Default ability economy: every ability on, 100 Reality Energy, regenerated only by team repairs.
 * `ABILITIES_IN_ROTATION` decides whether generated stages (N >= 2) and the fallback stage offer abilities.
 * Hand-authored stage 1 (the tutorial) never does: it teaches the P2 tools first (GAMEPLAY pillar 7).
 */
export const ABILITIES_IN_ROTATION = true;
export const DEFAULT_ABILITY_CONFIG: AbilityConfig = AbilityConfigSchema.parse({
  enabled: ['gravity_well', 'freeze', 'duplicate', 'momentum', 'anchor'],
});

/** A stage's own `abilities` always wins; otherwise rotation stages get the defaults. */
export function withDefaultAbilities(def: StageDef, stage: number): StageDef {
  if (def.abilities || !ABILITIES_IN_ROTATION || stage < 2) return def;
  return { ...def, abilities: DEFAULT_ABILITY_CONFIG };
}
