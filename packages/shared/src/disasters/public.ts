import { z } from 'zod';
import { ToolIdSchema } from '../systems/tools';
import { DisasterPhaseSchema } from './lifecycle';

/** Stable ids of the v1 disaster library. A disaster is only *supported* once its lifecycle and solvability tests pass. */
export const DisasterIdSchema = z.enum([
  'gravity_inversion', 'reactor_overload', 'reality_fracture', 'temporal_storm', 'cascading_power_failure',
]);
export type DisasterId = z.infer<typeof DisasterIdSchema>;
export const DISASTER_IDS = DisasterIdSchema.options;

/** One hazard the team must know about: what it is, what counters it, and how the stage is repaired. */
export const DisasterThreatSchema = z.object({
  hazardId: z.string(),
  /** Readable warning shown to every player. */
  warning: z.string(),
  /** A tool that is a valid countermeasure for this hazard (server-validated against TOOL_SPECS). */
  countermeasure: ToolIdSchema,
  /** The repair path in plain words. It never names hidden breakpoints. */
  repair: z.string(),
});

/**
 * PUBLIC projection of a running disaster (additive, optional field of `StageState`).
 * Contains warnings and schedule only: never seeds, parameters, hidden breakpoints or solutions.
 */
export const DisasterPublicSchema = z.object({
  id: DisasterIdSchema,
  name: z.string(),
  version: z.number().int().min(1),
  phase: DisasterPhaseSchema,
  /** Readable status for the current phase. */
  message: z.string(),
  /** Sim tick at which the disaster escalates, or null once that is no longer pending. */
  escalatesAtTick: z.number().int().nullable(),
  /** Sim tick at which an unresolved disaster fails (soft failure in P3A), or null when no longer pending. */
  failsAtTick: z.number().int().nullable(),
  threats: z.array(DisasterThreatSchema),
});
export type DisasterPublic = z.infer<typeof DisasterPublicSchema>;
export type DisasterThreat = z.infer<typeof DisasterThreatSchema>;
