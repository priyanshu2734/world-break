import { z } from 'zod';
import { DisasterIdSchema, StageIdSchema, ToolIdSchema } from '@wb/shared';

/**
 * SERVER-PRIVATE disaster metadata carried by a generated `StageDef` (`def.disaster`). It records how the stage
 * was produced (id, version, seed, params) and how the lifecycle behaves. Only a projection of it is public
 * (`DisasterPublic`, see runtime.ts). It never contains the solution; hidden breakpoints stay in `def.breakpoints`.
 */
const Id = StageIdSchema;

export const DisasterMetaSchema = z.object({
  id: DisasterIdSchema,
  version: z.number().int().min(1),
  name: z.string().min(1),
  /** Stage seed this definition was generated from (server-side record; never sent to clients). */
  seed: z.number().int().min(0),
  /** The validated generator parameters, kept for the server-side stage record and for debugging. */
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),

  /** Lifecycle schedule in absolute engine ticks. Escalation is driven by sim ticks only. */
  schedule: z.object({
    /** WARNING -> ACTIVE. */
    activateAtTick: z.number().int().min(1),
    /** ACTIVE -> ESCALATED. */
    escalateAtTick: z.number().int().min(2),
    /** ESCALATED -> FAILED (soft failure in P3A: bounded penalty, stage stays completable). */
    failAtTick: z.number().int().min(3),
    /** How long a FAILED disaster keeps its effects before they are cleaned up. */
    failedHoldTicks: z.number().int().min(1),
  }),

  /** One readable line per phase (public). Must never name hidden breakpoints. */
  messages: z.object({
    warning: z.string().min(1), active: z.string().min(1), escalated: z.string().min(1),
    resolved: z.string().min(1), failed: z.string().min(1), cleanup: z.string().min(1),
  }),

  /** The disaster is RESOLVED once every one of these objectives is complete. */
  resolveObjectives: z.array(Id).min(1),

  /** Every hazard of a disaster stage needs exactly one threat: warning + countermeasure + repair path. */
  threats: z.array(z.object({
    hazardId: Id,
    warning: z.string().min(1),
    countermeasure: ToolIdSchema,
    repair: z.string().min(1),
  })),

  /** How the lifecycle phase modifies each hazard (bounded). Hazards not listed here are not touched. */
  hazardPhases: z.array(z.object({
    hazardId: Id,
    /** The hazard can be armed only from this phase on. */
    armedFrom: z.enum(['active', 'escalated']),
    /** Parameters while ESCALATED / FAILED. */
    escalated: z.object({
      periodTicks: z.number().int().positive().optional(),
      r: z.number().positive().optional(),
    }).optional(),
  })),

  /** Bounded score drain while ESCALATED: `perSecond` per second until `cap` points are drained in total. */
  heat: z.object({ perSecond: z.number().int().min(0), cap: z.number().int().min(0) }),
  /** One-time score penalty when the disaster fails. */
  failPenalty: z.number().int().min(0),
});
export type DisasterMeta = z.infer<typeof DisasterMetaSchema>;
export type DisasterMetaInput = z.input<typeof DisasterMetaSchema>;
