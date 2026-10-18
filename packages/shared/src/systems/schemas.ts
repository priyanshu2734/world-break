import { z } from 'zod';
import { HazardKindSchema, ToolIdSchema } from './tools';
import { DisasterPublicSchema } from '../disasters/public';
import { AbilitiesPublicSchema } from '../abilities/public';

/** Ids are server-authored slugs. */
export const StageIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/).max(40);

// ---------------------------------------------------------------- client -> server intents
/** What a player *asks* to do. The server decides whether it works. */
export const StageActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interact'), targetId: StageIdSchema }).strict(),
  z.object({ kind: z.literal('use_tool'), tool: ToolIdSchema, targetId: StageIdSchema.optional() }).strict(),
  z.object({ kind: z.literal('cancel') }).strict(),
]);
export type StageAction = z.infer<typeof StageActionSchema>;

// ---------------------------------------------------------------- server -> client public state
export const ObjectiveStatusSchema = z.enum(['locked', 'active', 'complete']);
export const SymptomStateSchema = z.enum(['active', 'mitigated', 'resolved']);
export const EntityKindSchema = z.enum(['supply_cache', 'power_switch', 'sync_console', 'core_console', 'decoy_panel']);

const Pt = { x: z.number(), y: z.number() };

/**
 * Public projection of a running stage. It contains ONLY what players may know:
 * hidden breakpoints appear in `breakpoints` only after they have been revealed.
 */
export const StageStateSchema = z.object({
  rev: z.number().int().min(0),
  stageId: z.string(),
  name: z.string(),
  status: z.enum(['running', 'stabilized']),
  tick: z.number().int().min(0),
  deadlineTick: z.number().int().min(0),
  expired: z.boolean(),
  score: z.object({ total: z.number().int(), breakdown: z.record(z.string(), z.number().int()) }),
  objectives: z.array(z.object({
    id: z.string(), label: z.string(), description: z.string(), status: ObjectiveStatusSchema,
    progress: z.number().min(0).max(1), prerequisites: z.array(z.string()), lockedMessage: z.string(),
  })),
  symptoms: z.array(z.object({
    id: z.string(), label: z.string(), hint: z.string(), state: SymptomStateSchema,
    mitigatedUntilTick: z.number().int().nullable(),
  })),
  breakpoints: z.array(z.object({
    id: z.string(), label: z.string(), ...Pt, repaired: z.boolean(), progress: z.number().min(0).max(1),
  })),
  entities: z.array(z.object({
    id: z.string(), kind: EntityKindSchema, label: z.string(), ...Pt, state: z.string(),
    armedUntilTick: z.number().int().nullable(), locked: z.boolean(),
  })),
  power: z.object({
    capacity: z.number().int(), load: z.number().int(),
    nodes: z.array(z.object({
      id: z.string(), kind: z.enum(['generator', 'junction', 'consumer']), label: z.string(), ...Pt,
      powered: z.boolean(), source: z.enum(['grid', 'cell']).nullable(),
    })),
    conduits: z.array(z.object({
      id: z.string(), from: z.string(), to: z.string(),
      condition: z.enum(['ok', 'damaged', 'melted']),
      switchEntityId: z.string().nullable(), closed: z.boolean(), live: z.boolean(),
    })),
  }),
  hazards: z.array(z.object({
    id: z.string(), kind: HazardKindSchema, label: z.string(), ...Pt, r: z.number(),
    armed: z.boolean(), stabilized: z.boolean(), nextPulseTick: z.number().int().nullable(),
    /** P3B (additive, optional): the hazard is held by a Freeze until this tick. */
    frozenUntilTick: z.number().int().nullable().optional(),
  })),
  effects: z.array(z.object({
    id: z.string(), tool: ToolIdSchema, ownerId: z.string(), ...Pt, r: z.number(), expiresTick: z.number().int(),
  })),
  channels: z.array(z.object({ playerId: z.string(), targetId: z.string(), progress: z.number().min(0).max(1) })),
  players: z.array(z.object({
    id: z.string(),
    tools: z.array(z.object({
      tool: ToolIdSchema, charges: z.number().int().min(0), maxCharges: z.number().int(), cooldownUntilTick: z.number().int(),
    })),
  })),
  clues: z.array(z.object({ id: z.string(), text: z.string(), tick: z.number().int() })),
  feed: z.array(z.object({ tick: z.number().int(), text: z.string(), tone: z.enum(['info', 'good', 'warn', 'bad', 'clue']) })),
  /** P3A (additive, optional): the running disaster's public warning/phase/schedule. Absent for hand-authored stages. */
  disaster: DisasterPublicSchema.optional(),
  /** P3B (additive, optional): Reality Energy and ability cooldowns. Absent for stages without abilities. */
  abilities: AbilitiesPublicSchema.optional(),
});
export type StageState = z.infer<typeof StageStateSchema>;
