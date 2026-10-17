import { DisasterMetaSchema, type DisasterMeta } from '../../src/disasters/meta';

/** A small hand-written lifecycle: warning < 10, active < 100, escalated < 300, failed hold 50 ticks. */
export const FIXTURE_INPUT = {
  id: 'reactor_overload' as const,
  version: 1,
  name: 'Test Disaster',
  seed: 1,
  params: {},
  schedule: { activateAtTick: 10, escalateAtTick: 100, failAtTick: 300, failedHoldTicks: 50 },
  messages: {
    warning: 'm-warning', active: 'm-active', escalated: 'm-escalated', resolved: 'm-resolved', failed: 'm-failed', cleanup: 'm-cleanup',
  },
  resolveObjectives: ['o_final'],
  threats: [{ hazardId: 'hz_arc', warning: 'arcs ahead', countermeasure: 'shield_projector' as const, repair: 'fix it' }],
  hazardPhases: [{ hazardId: 'hz_arc', armedFrom: 'active' as 'active' | 'escalated', escalated: { periodTicks: 30, r: 200 } }],
  heat: { perSecond: 3, cap: 10 },
  failPenalty: 40,
};

export function fixtureMeta(overrides: Record<string, unknown> = {}): DisasterMeta {
  return DisasterMetaSchema.parse({ ...FIXTURE_INPUT, ...overrides });
}
