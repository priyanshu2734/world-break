import { z } from 'zod';
import { TOOL_SPECS } from '../systems/tools';

/**
 * P3B reality abilities: the single source of truth for every limit. The server enforces all of them;
 * the client only reads them to draw the HUD. Times are server ticks (20 Hz). See docs/ABILITIES.md.
 */
export const AbilityIdSchema = z.enum(['gravity_well', 'freeze', 'duplicate', 'momentum', 'anchor']);
export type AbilityId = z.infer<typeof AbilityIdSchema>;
export const ABILITY_IDS = AbilityIdSchema.options;

/** Abilities that travel through the `ability:use` intent. `anchor` is the P2 Gravity Anchor tool (`stage:action` use_tool). */
export const ACTIVE_ABILITY_IDS = ['gravity_well', 'freeze', 'duplicate', 'momentum'] as const;
export type ActiveAbilityId = (typeof ACTIVE_ABILITY_IDS)[number];

export interface AbilitySpec {
  id: AbilityId;
  label: string;
  /** Reality Energy spent on success. */
  energyCost: number;
  cooldownTicks: number;
  /** Effect lifetime in ticks (0 = instant). */
  durationTicks: number;
  /** Max distance from the caster's body centre to the target / placement point (px). */
  range: number;
  /** Max simultaneously active effects created by one player (0 = not applicable). */
  perPlayerCap: number;
  /** Max simultaneously active effects in the whole room (0 = not applicable). */
  perRoomCap: number;
}

export const ABILITY_SPECS: Record<AbilityId, AbilitySpec> = {
  gravity_well: { id: 'gravity_well', label: 'Gravity Well', energyCost: 30, cooldownTicks: 300, durationTicks: 120, range: 260, perPlayerCap: 1, perRoomCap: 2 },
  freeze: { id: 'freeze', label: 'Freeze', energyCost: 25, cooldownTicks: 240, durationTicks: 60, range: 240, perPlayerCap: 1, perRoomCap: 3 },
  duplicate: { id: 'duplicate', label: 'Duplicate', energyCost: 30, cooldownTicks: 80, durationTicks: 160, range: 260, perPlayerCap: 2, perRoomCap: 4 },
  momentum: { id: 'momentum', label: 'Momentum', energyCost: 20, cooldownTicks: 160, durationTicks: 0, range: 200, perPlayerCap: 0, perRoomCap: 0 },
  // Anchor keeps its P2 tool limits (charges, cooldown, duration, radius). It costs no energy; P3B only adds placement rules.
  anchor: { id: 'anchor', label: 'Gravity Anchor', energyCost: 0, cooldownTicks: TOOL_SPECS.gravity_anchor.cooldownTicks, durationTicks: TOOL_SPECS.gravity_anchor.durationTicks, range: 0, perPlayerCap: TOOL_SPECS.gravity_anchor.maxCharges, perRoomCap: 2 },
};

// ---------------------------------------------------------------- Reality Energy
export const ENERGY_MAX = 100;
export const ENERGY_START = 100;
/** Energy every player regains when the TEAM completes a repair. There is no other regeneration unless a stage opts in. */
export const ENERGY_PER_REPAIR = { breakpoint: 30, conduit: 15 } as const;

/** Minimum ticks between two ability intents from one player (rate limit; applies to accepted and refused intents). */
export const ABILITY_MIN_GAP_TICKS = 6;

// ---------------------------------------------------------------- Anchor placement rules (P3B)
export const ANCHOR_RULES = {
  /** Active anchors in the room. */
  maxActive: 2,
  /** Min distance between two active anchors (px). */
  minSpacing: 120,
  /** The caster must stand on a solid (anchors are planted, not thrown). */
  needsFooting: true,
  /** Min distance from the arena's left/right edges (px). */
  edgeMargin: 40,
} as const;

// ---------------------------------------------------------------- Gravity Well
export const WELL_HALF_SIZE = 160;
/** Vertical gravity inside a well, px/s^2. `flip` is the exact opposite of normal gravity. */
export const WELL_GRAVITY = { flip: -1800, reduce: 450 } as const;
export type WellMode = keyof typeof WELL_GRAVITY;

// ---------------------------------------------------------------- Momentum
/** Hard bound for one impulse, px/s, on each axis. */
export const MOMENTUM_IMPULSE = 600;
/** A body's lateral push decays linearly over this many ticks (walking overwrites vx, so lateral push is data, not state). */
export const MOMENTUM_DRIFT_TICKS = 8;

// ---------------------------------------------------------------- Objects (props)
export const MAX_PROPS_PER_STAGE = 6;
/** Hard cap on props (stage props + clones) alive in one room, a defence in depth behind the per-player clone caps. */
export const MAX_PROPS_TOTAL = 12;
export const MAX_ZONES_LISTED = 8;
export const MAX_IMPULSES_LISTED = 16;
