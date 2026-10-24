import { z } from 'zod';
import { ToolIdSchema } from '../systems/tools';
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
  /** Open a visible stash (crate, panel, locker). Names a stash, never an item: hidden parts have no id a client could know. */
  z.object({ action: z.literal('open'), stashId: Id }).strict(),
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
    /** Present (true) only when the stage lets a cracked part show it and the mode is not hardcore. Never says "decoy" about an unmarked part. */
    cracked: z.boolean().optional(),
    /** P3D (additive, optional): the room the part is in. Absent on single-arena stages. */
    roomId: z.string().optional(),
  })),
  players: z.array(z.object({
    id: z.string(),
    slotsUsed: z.number().int().min(0),
    carried: z.array(z.string()),
  })),
  /** Visible containers (some are empty). `opened` flips when a player opens one. Absent when the stage has none. */
  stashes: z.array(z.object({
    id: z.string(), kind: z.enum(['crate', 'panel', 'locker', 'ceiling']), label: z.string(), x: z.number(), y: z.number(), opened: z.boolean(),
    /** P3D (additive, optional): the room the container is in. */
    roomId: z.string().optional(),
  })).optional(),
  /**
   * Requirements of targets the team has DISCOVERED (stood near), by clue clarity: easy = names + hint, intermediate = silhouettes,
   * hardcore = nothing until a first attempt. Undiscovered and unrevealed targets are never listed.
   */
  needs: z.array(z.object({
    targetId: z.string(), label: z.string(), satisfied: z.boolean(),
    hint: z.string().nullable(),
    tools: z.array(ToolIdSchema),
    parts: z.array(z.object({
      /** Name and kind only when clarity shows them, or once that part is installed. */
      kind: ItemKindSchema.nullable(), label: z.string().nullable(),
      shape: z.enum(['small', 'heavy']),
      installed: z.boolean(),
    })),
  })).optional(),
});
export type ItemsPublic = z.infer<typeof ItemsPublicSchema>;
