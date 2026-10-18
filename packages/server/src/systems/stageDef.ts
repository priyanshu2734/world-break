import { z } from 'zod';
import { AbilityIdSchema, ENERGY_MAX, ENERGY_START, HazardKindSchema, MAX_PROPS_PER_STAGE, StageIdSchema, ToolIdSchema } from '@wb/shared';
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
