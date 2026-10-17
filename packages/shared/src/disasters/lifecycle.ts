import { z } from 'zod';
import { InvalidTransitionError } from '../phases';

/**
 * Disaster lifecycle: WARNING -> ACTIVE -> ESCALATED -> RESOLVED | FAILED -> CLEANUP.
 * Explicit state machine (like RoomPhase): illegal transitions throw. The server is the only place transitions
 * are applied; clients only ever see the resulting phase.
 */
export const DisasterPhaseSchema = z.enum(['warning', 'active', 'escalated', 'resolved', 'failed', 'cleanup']);
export type DisasterPhase = z.infer<typeof DisasterPhaseSchema>;
export const DISASTER_PHASES = DisasterPhaseSchema.options;

export type DisasterEvent = 'ACTIVATE' | 'ESCALATE' | 'RESOLVE' | 'FAIL' | 'CLEAN';

const TABLE: Record<DisasterPhase, Partial<Record<DisasterEvent, DisasterPhase>>> = {
  warning: { ACTIVATE: 'active', RESOLVE: 'resolved' },
  active: { ESCALATE: 'escalated', RESOLVE: 'resolved' },
  escalated: { RESOLVE: 'resolved', FAIL: 'failed' },
  resolved: { CLEAN: 'cleanup' },
  failed: { CLEAN: 'cleanup' },
  cleanup: {}, // terminal: every effect of the disaster has been removed
};

export function nextDisasterPhase(from: DisasterPhase, event: DisasterEvent): DisasterPhase {
  const to = TABLE[from][event];
  if (!to) throw new InvalidTransitionError('disaster', from, event);
  return to;
}

/** Phases in which the disaster is still threatening the team (effects may be armed). */
export function isDisasterLive(phase: DisasterPhase): boolean {
  return phase === 'warning' || phase === 'active' || phase === 'escalated';
}
