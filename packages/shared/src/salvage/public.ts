import { z } from 'zod';
import { ItemKindSchema } from './specs';

/** Same shape as StageIdSchema (kept local: systems/schemas imports this file, so importing it back would be circular). */
const Id = z.string().regex(/^[a-z][a-z0-9_]*$/).max(40);
/** Player ids are server-issued opaque strings (UUIDs). */
const PlayerRef = z.string().min(1).max(64);

/** Intent: what a player ASKS to do with parts. The server validates range, ownership, capacity, cooldown and rate. */
export const ItemActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pickup'), itemId: Id }).strict(),
  z.object({ action: z.literal('drop'), itemId: Id }).strict(),
  /** Drop one carried part and pick up one lying nearby, in a single step (works when hands are full). */
  z.object({ action: z.literal('swap'), dropId: Id, pickId: Id }).strict(),
  z.object({ action: z.literal('handover'), itemId: Id, toPlayerId: PlayerRef }).strict(),
  z.object({ action: z.literal('install'), itemId: Id, targetId: Id }).strict(),
]);
export type ItemAction = z.infer<typeof ItemActionSchema>;

/**
 * Public item state (optional `StageState.items`; absent on stages without items).
 * Hidden, consumed and destroyed items are not listed. The decoy flag is never published.
 * `x`,`y` are meaningful for `in_world` (resting spot) and `installed` (the target's spot); for `carried` use `carrierId`.
 */
export const ItemsPublicSchema = z.object({
  carrySlots: z.number().int().positive(),
  items: z.array(z.object({
    id: z.string(), kind: ItemKindSchema, label: z.string(),
    slots: z.number().int().min(1).max(2),
    state: z.enum(['in_world', 'carried', 'installed']),
    x: z.number(), y: z.number(),
    carrierId: z.string().nullable(),
    targetId: z.string().nullable(),
  })),
  players: z.array(z.object({
    id: z.string(),
    slotsUsed: z.number().int().min(0),
    carried: z.array(z.string()),
  })),
});
export type ItemsPublic = z.infer<typeof ItemsPublicSchema>;
