import { z } from 'zod';
import { AbilityIdSchema } from './specs';

/** Intent: what a player ASKS an ability to do. The server validates ownership, range, cooldown, energy, caps and rate. */
/** Same shape as StageIdSchema (kept local: systems/schemas imports this file, so importing it back would be circular). */
const StageIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/).max(40);
const Coord = z.number().min(-5000).max(5000); // rejects NaN and Infinity as well
export const AbilityActionSchema = z.discriminatedUnion('ability', [
  z.object({ ability: z.literal('gravity_well'), x: Coord, y: Coord, mode: z.enum(['flip', 'reduce']) }).strict(),
  z.object({ ability: z.literal('freeze'), targetId: StageIdSchema }).strict(),
  z.object({ ability: z.literal('duplicate'), targetId: StageIdSchema, x: Coord, y: Coord }).strict(),
  z.object({
    ability: z.literal('momentum'),
    /** A prop id, or 'self' for the caster's own body. */
    targetId: z.union([z.literal('self'), StageIdSchema]),
    dir: z.enum(['up', 'down', 'left', 'right', 'cancel']),
  }).strict(),
]);
export type AbilityAction = z.infer<typeof AbilityActionSchema>;

/** Public per-player ability state (optional `StageState.abilities`; absent on stages without abilities). */
export const AbilitiesPublicSchema = z.object({
  enabled: z.array(AbilityIdSchema),
  energyMax: z.number().int().positive(),
  players: z.array(z.object({
    id: z.string(),
    energy: z.number().int().min(0),
    cooldowns: z.array(z.object({ ability: AbilityIdSchema, cooldownUntilTick: z.number().int().min(0) })),
    /** Clones this player currently has alive. */
    clones: z.number().int().min(0),
  })),
  /** Room-wide active counts, for the HUD ("2/2 wells"). */
  active: z.object({
    wells: z.number().int().min(0), freezes: z.number().int().min(0),
    clones: z.number().int().min(0), anchors: z.number().int().min(0),
  }),
});
export type AbilitiesPublic = z.infer<typeof AbilitiesPublicSchema>;
