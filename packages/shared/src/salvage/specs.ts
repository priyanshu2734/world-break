import { z } from 'zod';

/**
 * P3C salvage: the single source of truth for item kinds and carrying limits. The server enforces every limit;
 * the client only reads them to draw the HUD. Times are server ticks (20 Hz). See docs/SALVAGE.md.
 */
export const ItemKindSchema = z.enum([
  'fuse', 'flux_coil', 'coolant_cell', 'valve_wheel', 'access_key', 'battery', 'revive_cell', 'power_core',
  /** P3E step 4: the Pulse Gun. One per ghost stage, locked in a safe or locker, one hand, one charge (a shot spends it). */
  'pulse_gun',
]);
export type ItemKind = z.infer<typeof ItemKindSchema>;
export const ITEM_KINDS = ItemKindSchema.options;

export interface ItemKindSpec {
  kind: ItemKind;
  label: string;
  /** Carry slots when the stage does not say otherwise (1 = one hand, 2 = heavy: needs both hands). */
  defaultSlots: 1 | 2;
}

export const ITEM_KIND_SPECS: Record<ItemKind, ItemKindSpec> = {
  fuse: { kind: 'fuse', label: 'Fuse', defaultSlots: 1 },
  flux_coil: { kind: 'flux_coil', label: 'Flux Coil', defaultSlots: 1 },
  coolant_cell: { kind: 'coolant_cell', label: 'Coolant Cell', defaultSlots: 1 },
  valve_wheel: { kind: 'valve_wheel', label: 'Valve Wheel', defaultSlots: 1 },
  access_key: { kind: 'access_key', label: 'Access Key', defaultSlots: 1 },
  battery: { kind: 'battery', label: 'Battery', defaultSlots: 1 },
  revive_cell: { kind: 'revive_cell', label: 'Revive Cell', defaultSlots: 1 },
  power_core: { kind: 'power_core', label: 'Power Core', defaultSlots: 2 },
  pulse_gun: { kind: 'pulse_gun', label: 'Pulse Gun', defaultSlots: 1 },
};

/** Where an item is in its life. `hidden`, `consumed` and `destroyed` items are NEVER published to clients. */
export type ItemLifeState = 'hidden' | 'in_world' | 'carried' | 'installed' | 'consumed' | 'destroyed';

export const ITEM_LIMITS = {
  /** Slots each player can carry (heavy items use 2). */
  carrySlots: 2,
  /** Horizontal reach (px) to pick up an item; the vertical offset is bounded by RANGE_DY like every other action. */
  pickupRange: 70,
  /** Max distance (px) between giver and receiver for a hand over. */
  handoverRange: 90,
  /** Reach (px) to install a part on a target. */
  installRange: 80,
  /** Minimum ticks between two item intents from one player (applies to accepted AND refused intents). */
  minGapTicks: 4,
  /** After dropping or swapping, the player cannot pick anything up for this many ticks. */
  dropCooldownTicks: 10,
  /** After handing something over, the giver cannot hand over again for this many ticks. */
  handoverCooldownTicks: 20,
  /** Items per stage (authoring bound; nothing ever spawns at runtime, so this is also the room-wide bound). */
  maxItemsPerStage: 12,
  /** Targets with requirements per stage (authoring bound). */
  maxNeedsPerStage: 8,
  /** An item must start within this many px above a platform (it rests on the first surface below its authored y). */
  maxAuthoredFall: 40,
  /** Reach (px) to open a stash (crate, panel, locker). */
  openRange: 70,
  /** A target's requirements are shown to the team once any player has stood within this many px of it. */
  needsRevealRange: 160,
  /** Stashes per stage (authoring bound). */
  maxStashesPerStage: 6,
  /** An armed discharge destroys at most ONE carried part per hit, and a player is safe for this many ticks afterwards. */
  hazardGraceTicks: 100,
  /** Authoring bound on the trips a lone player needs to bring every mandatory part (heavy = 1 trip, two light parts = 1 trip). */
  maxTripsPerStage: 12,
} as const;

/** Item kinds that may be a gate for hard-to-reach spots (see ItemDef.gate): the P3B abilities that open a path. */
export const ITEM_GATES = ['gravity_well', 'freeze', 'duplicate', 'momentum'] as const;
export type ItemGate = (typeof ITEM_GATES)[number];

/** Silhouette of a part kind, shown instead of its name at lower clarity. */
export const itemShape = (kind: ItemKind): 'small' | 'heavy' => (ITEM_KIND_SPECS[kind].defaultSlots === 2 ? 'heavy' : 'small');
