import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '../src/phases';
import {
  DISASTER_PHASES, isDisasterLive, nextDisasterPhase, type DisasterEvent, type DisasterPhase,
} from '../src/disasters/lifecycle';
import { DISASTER_IDS, DisasterIdSchema, DisasterPublicSchema } from '../src/disasters/public';

const EVENTS: DisasterEvent[] = ['ACTIVATE', 'ESCALATE', 'RESOLVE', 'FAIL', 'CLEAN'];
/** The complete set of legal transitions, written out independently of the implementation. */
const LEGAL: [DisasterPhase, DisasterEvent, DisasterPhase][] = [
  ['warning', 'ACTIVATE', 'active'], ['warning', 'RESOLVE', 'resolved'],
  ['active', 'ESCALATE', 'escalated'], ['active', 'RESOLVE', 'resolved'],
  ['escalated', 'RESOLVE', 'resolved'], ['escalated', 'FAIL', 'failed'],
  ['resolved', 'CLEAN', 'cleanup'], ['failed', 'CLEAN', 'cleanup'],
];

describe('disaster lifecycle state machine', () => {
  it('has exactly the six lifecycle phases', () => {
    expect([...DISASTER_PHASES]).toEqual(['warning', 'active', 'escalated', 'resolved', 'failed', 'cleanup']);
  });
  it('follows WARNING -> ACTIVE -> ESCALATED -> RESOLVED -> CLEANUP', () => {
    let p: DisasterPhase = 'warning';
    for (const e of ['ACTIVATE', 'ESCALATE', 'RESOLVE', 'CLEAN'] as const) p = nextDisasterPhase(p, e);
    expect(p).toBe('cleanup');
  });
  it('follows WARNING -> ACTIVE -> ESCALATED -> FAILED -> CLEANUP', () => {
    let p: DisasterPhase = 'warning';
    for (const e of ['ACTIVATE', 'ESCALATE', 'FAIL', 'CLEAN'] as const) p = nextDisasterPhase(p, e);
    expect(p).toBe('cleanup');
  });
  it.each(LEGAL)('%s --%s--> %s', (from, event, to) => {
    expect(nextDisasterPhase(from, event)).toBe(to);
  });
  it('rejects every transition that is not listed as legal', () => {
    for (const from of DISASTER_PHASES) for (const event of EVENTS) {
      if (LEGAL.some(([f, e]) => f === from && e === event)) continue;
      expect(() => nextDisasterPhase(from, event), `${from} --${event}-->`).toThrow(InvalidTransitionError);
    }
  });
  it('cleanup is terminal; resolved and failed are exclusive outcomes', () => {
    for (const e of EVENTS) expect(() => nextDisasterPhase('cleanup', e)).toThrow(InvalidTransitionError);
    expect(() => nextDisasterPhase('resolved', 'FAIL')).toThrow(InvalidTransitionError);
    expect(() => nextDisasterPhase('failed', 'RESOLVE')).toThrow(InvalidTransitionError);
    expect(() => nextDisasterPhase('warning', 'FAIL')).toThrow(InvalidTransitionError); // must escalate first
  });
  it('isDisasterLive is true only while the disaster still threatens the team', () => {
    expect(DISASTER_PHASES.filter(isDisasterLive)).toEqual(['warning', 'active', 'escalated']);
  });
});

describe('public disaster schema', () => {
  const sample = {
    id: 'reactor_overload', name: 'Reactor Overload', version: 1, phase: 'active', message: 'm',
    escalatesAtTick: 100, failsAtTick: 300,
    threats: [{ hazardId: 'hz_arc', warning: 'w', countermeasure: 'shield_projector', repair: 'r' }],
  };
  it('lists the five v1 disaster ids', () => {
    expect([...DISASTER_IDS].sort()).toEqual(
      ['cascading_power_failure', 'gravity_inversion', 'reactor_overload', 'reality_fracture', 'temporal_storm']);
    expect(DisasterIdSchema.safeParse('final_boss').success).toBe(false);
  });
  it('accepts a valid projection and nullable schedule ticks', () => {
    expect(DisasterPublicSchema.safeParse(sample).success).toBe(true);
    expect(DisasterPublicSchema.safeParse({ ...sample, escalatesAtTick: null, failsAtTick: null }).success).toBe(true);
  });
  it('rejects unknown phases, tools and ids', () => {
    expect(DisasterPublicSchema.safeParse({ ...sample, phase: 'exploded' }).success).toBe(false);
    expect(DisasterPublicSchema.safeParse({ ...sample, id: 'nope' }).success).toBe(false);
    expect(DisasterPublicSchema.safeParse({ ...sample, threats: [{ ...sample.threats[0], countermeasure: 'laser' }] }).success).toBe(false);
  });
});
