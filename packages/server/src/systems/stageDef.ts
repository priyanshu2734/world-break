import { z } from 'zod';
import { AbilityIdSchema, ENERGY_MAX, ENERGY_START, HazardKindSchema, ITEM_GATES, ITEM_LIMITS, ItemKindSchema, MAX_PROPS_PER_STAGE, StageIdSchema, ToolIdSchema } from '@wb/shared';
import { DisasterMetaSchema } from '../disasters/meta';

/**
 * Server-private, hand-authored stage definition. Contains the hidden failure chain and breakpoint
 * locations, so it must never be imported by the client or serialised to it.
 */
const Id = StageIdSchema;
const Pt = { x: z.number(), y: z.number() };

export const FailureSchema = z.object({
  id: Id,
  /** breakpoint = hidden repairable root; fault = system state derived from the power grid; symptom = visible effect. */
  kind: z.enum(['breakpoint', 'fault', 'symptom']),
  label: z.string(),
  hint: z.string().default(''),
});

export const BreakpointSchema = z.object({
  id: Id, failureId: Id, label: z.string(), ...Pt,
  repairTicks: z.number().int().positive(),
  /** Only weldable breakpoints can be repaired with the Flux Welder. */
  weldable: z.boolean(),
  /** The Phase Scanner can reveal this breakpoint only once these objectives are complete. */
  scanRequires: z.array(Id).default([]),
});

export const PowerNodeSchema = z.object({
  id: Id, kind: z.enum(['generator', 'junction', 'consumer']), label: z.string(), ...Pt,
});
export const ConduitSchema = z.object({
  id: Id, from: Id, to: Id,
  /** ok = conducts; damaged = broken but weldable; melted = broken beyond welding (must be routed around). */
  condition: z.enum(['ok', 'damaged', 'melted']),
  repairTicks: z.number().int().positive().default(60),
  /** Conduits without a switch are always connected. */
  switchEntityId: Id.optional(),
});

export const EntitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('supply_cache'), id: Id, label: z.string(), ...Pt,
    refillPenalty: z.number().int(), cooldownTicks: z.number().int() }),
  z.object({ kind: z.literal('power_switch'), id: Id, label: z.string(), ...Pt,
    conduitId: Id, initiallyClosed: z.boolean() }),
  z.object({ kind: z.literal('sync_console'), id: Id, label: z.string(), ...Pt, objectiveId: Id }),
  z.object({ kind: z.literal('core_console'), id: Id, label: z.string(), ...Pt, objectiveId: Id, consumerId: Id }),
  /** P3B: pressed while something stands on it. Used as a `timed_controls` control (armTicks 1 = "all pressed at the same moment"). */
  z.object({ kind: z.literal('pressure_plate'), id: Id, label: z.string(), ...Pt, objectiveId: Id,
    /** 'object' = a heavy plate: players are too light to press it, only crates and copies are. */
    activatedBy: z.enum(['any', 'object']).default('any') }),
  z.object({ kind: z.literal('decoy_panel'), id: Id, label: z.string(), ...Pt,
    mitigates: Id, mitigateTicks: z.number().int(), repairTicks: z.number().int().positive() }),
]);

export const ObjectiveSchema = z.object({
  id: Id, label: z.string(), description: z.string(),
  prerequisites: z.array(Id),
  lockedMessage: z.string(),
  bonus: z.number().int(),
  params: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('repair_breakpoint'), breakpointId: Id }),
    z.object({ kind: z.literal('power_route'), consumerId: Id, holdTicks: z.number().int().positive(), sealSwitches: z.array(Id) }),
    z.object({ kind: z.literal('timed_controls'), controls: z.array(Id).min(1), armTicks: z.number().int().positive() }),
    z.object({ kind: z.literal('channel_hold'), entityId: Id, requiredTicks: z.number().int().positive(),
      needsStableHazard: Id.optional() }),
  ]),
});

export const HazardSchema = z.object({
  id: Id, kind: HazardKindSchema, label: z.string(), ...Pt, r: z.number().positive(),
  /** Arc discharge only: pulse schedule and penalty. */
  periodTicks: z.number().int().positive().optional(),
  firstPulseTick: z.number().int().optional(),
  /** Hazard is armed (dangerous) only while this objective is active. Omit = always armed. */
  armedWhenObjective: Id.optional(),
});

/** P3B: a physical object placed by the stage author (feet-centre, must stand on a platform). */
export const PropDefSchema = z.object({
  id: Id, kind: z.literal('crate'), ...Pt,
  /** Only light objects can be duplicated. */
  light: z.boolean().default(true),
});

/** P3B: which reality abilities the stage allows, and its Reality Energy economy. */
export const AbilityConfigSchema = z.object({
  enabled: z.array(AbilityIdSchema).min(1),
  energyMax: z.number().int().positive().max(ENERGY_MAX).default(ENERGY_MAX),
  energyStart: z.number().int().min(0).max(ENERGY_MAX).default(ENERGY_START),
  /** Opt-in softlock guard: +1 energy every N ticks (0 = off; the default economy regenerates only through repairs). */
  passiveRegenTicks: z.number().int().min(0).default(0),
});
export type AbilityConfig = z.infer<typeof AbilityConfigSchema>;

/**
 * P3C: a part (salvage item) placed by the stage author. `x` and the authored `y` give a start point; the item RESTS on the
 * first platform surface at or below `y` (computed from the arena, no physics). Everything here is server-private.
 */
export const ItemDefSchema = z.object({
  id: Id, kind: ItemKindSchema, ...Pt,
  /** 1 or 2 carry slots. Omitted = the kind's default (ITEM_KIND_SPECS). */
  slots: z.union([z.literal(1), z.literal(2)]).optional(),
  /** A look-alike or cracked part: installing it destroys it, costs score and does not satisfy the need. Never published. */
  decoy: z.boolean().optional(),
  /** A decoy that carries a visible crack (published as `cracked`, except in hardcore). Only meaningful with `decoy`. */
  tell: z.boolean().optional(),
  /**
   * Present = the item starts hidden (not in the public state) until revealed.
   * `scan`: the Phase Scanner reveals it when used within its radius. `interact`: opening the stash `stashId` reveals it.
   */
  hidden: z.object({
    container: z.enum(['crate', 'panel', 'ceiling', 'locker']),
    reveal: z.enum(['scan', 'interact']),
    stashId: Id.optional(),
  }).optional(),
  /** The spot is not reachable on foot: it needs this P3B ability (and the stage must enable it). The validator checks both ways. */
  gate: z.enum(ITEM_GATES).optional(),
});

/** P3C: a visible container players can open. It may be empty (a decoy container); nothing publishes what it holds. */
export const StashDefSchema = z.object({
  id: Id, kind: z.enum(['crate', 'panel', 'locker', 'ceiling']), label: z.string().min(1).max(40), ...Pt,
  gate: z.enum(ITEM_GATES).optional(),
});

/**
 * P3C: what a repair target needs before it can be finished. `targetId` is a breakpoint, a conduit or an entity (never a hidden
 * breakpoint that has not been revealed). `items` is a multiset of kinds that must be INSTALLED; `tools` are tools that must be
 * used (enforced by the repair gate in P3C step 2).
 */
export const NeedDefSchema = z.object({
  targetId: Id,
  items: z.array(ItemKindSchema).min(1).max(2),
  tools: z.array(ToolIdSchema).max(2).optional(),
  /** One line shown at easy clarity ("names + a hint"). Must not give coordinates; max 120 chars. */
  hint: z.string().max(120).optional(),
});

export const ClueSchema = z.object({ id: Id, ...Pt, text: z.string() });

export const StageDefSchema = z.object({
  id: Id, name: z.string(), arenaId: z.string(),
  deadlineTicks: z.number().int().positive(),
  /** Tools each player starts with. Defaults to every tool. */
  loadout: z.array(ToolIdSchema).default(['phase_scanner', 'flux_welder', 'gravity_anchor', 'power_cell', 'shield_projector']),
  failures: z.array(FailureSchema),
  /** from -> to: while `from` is failing, `to` is failing. */
  edges: z.array(z.object({ from: Id, to: Id })),
  breakpoints: z.array(BreakpointSchema),
  power: z.object({
    capacity: z.number().int().positive(),
    nodes: z.array(PowerNodeSchema),
    conduits: z.array(ConduitSchema),
    /** A fault failure is active while its consumer lacks *grid* power (a Power Cell only mitigates it). */
    faultBindings: z.array(z.object({ consumerId: Id, failureId: Id })),
  }),
  entities: z.array(EntitySchema),
  objectives: z.array(ObjectiveSchema).min(1),
  hazards: z.array(HazardSchema),
  clues: z.array(ClueSchema),
  /** P3A (additive, optional): lifecycle + record of a generated disaster stage. Hand-authored stages omit it. */
  disaster: DisasterMetaSchema.optional(),
  /** P3B (additive, optional): reality abilities available in this stage. Omitted = no abilities (P2/P3A behaviour). */
  abilities: AbilityConfigSchema.optional(),
  /** P3B (additive, optional): physical objects (crates). */
  props: z.array(PropDefSchema).max(MAX_PROPS_PER_STAGE).optional(),
  /** P3C (additive, optional): salvage items. Omitted = no items (P2/P3A/P3B behaviour). */
  items: z.array(ItemDefSchema).max(ITEM_LIMITS.maxItemsPerStage).optional(),
  /** P3C (additive, optional): requirements of repair targets, by target id. */
  needs: z.array(NeedDefSchema).max(ITEM_LIMITS.maxNeedsPerStage).optional(),
  /** P3C (additive, optional): visible containers that hide parts. */
  stashes: z.array(StashDefSchema).max(ITEM_LIMITS.maxStashesPerStage).optional(),
  scoring: z.object({
    timeBonusPerSecond: z.number().int(),
    expiredPenalty: z.number().int(),
    expiredDrainPerSecond: z.number().int(),
    wrongTargetPenalty: z.number().int(),
    overloadPenalty: z.number().int(),
    hazardHitPenalty: z.number().int(),
  }),
});
export type StageDef = z.infer<typeof StageDefSchema>;
export type StageDefInput = z.input<typeof StageDefSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Objective = z.infer<typeof ObjectiveSchema>;
export type PropDef = z.infer<typeof PropDefSchema>;
export type ItemDef = z.infer<typeof ItemDefSchema>;
export type NeedDef = z.infer<typeof NeedDefSchema>;
export type StashDef = z.infer<typeof StashDefSchema>;
