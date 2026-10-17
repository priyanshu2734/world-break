import { describe, expect, it } from 'vitest';
import { ARENA } from '@wb/shared';
import type { StageDef } from '../../src/systems/stageDef';
import { TUTORIAL_STAGE } from '../../src/systems/tutorial';
import { validateStageDef } from '../../src/systems/validate';
import { generateDisasterStage } from '../../src/disasters/registry';
import { validateDisasterMeta } from '../../src/disasters/validate';

const good = () => structuredClone(generateDisasterStage(2, 11));
const errorsFor = (mutate: (d: StageDef) => void): string[] => { const d = good(); mutate(d); return validateStageDef(d, ARENA); };
const meta = (d: StageDef) => d.disaster!;

describe('disaster stage validation (negative cases)', () => {
  it('a generated stage and the hand-authored tutorial are both clean', () => {
    expect(validateStageDef(good(), ARENA)).toEqual([]);
    expect(validateStageDef(TUTORIAL_STAGE, ARENA)).toEqual([]);
    expect(validateDisasterMeta(TUTORIAL_STAGE)).toEqual([]); // no disaster metadata: nothing to check
  });

  it('rejects schedules that are out of order', () => {
    expect(errorsFor((d) => { meta(d).schedule.escalateAtTick = meta(d).schedule.activateAtTick; }).join()).toContain('before escalateAtTick');
    expect(errorsFor((d) => { meta(d).schedule.failAtTick = meta(d).schedule.escalateAtTick; }).join()).toContain('before failAtTick');
  });

  it('rejects unfair schedules (escalating too early, failing too soon, holding effects too long)', () => {
    expect(errorsFor((d) => { meta(d).schedule.escalateAtTick = 600; }).join()).toContain('less than 1200 ticks');
    expect(errorsFor((d) => { meta(d).schedule.failAtTick = meta(d).schedule.escalateAtTick + 100; }).join()).toContain('after escalation');
    expect(errorsFor((d) => { meta(d).schedule.failedHoldTicks = 99999; }).join()).toContain('failedHoldTicks');
  });

  it('rejects unbounded effects', () => {
    expect(errorsFor((d) => { meta(d).heat.perSecond = 500; }).join()).toContain('heat.perSecond');
    expect(errorsFor((d) => { meta(d).heat.cap = 99999; }).join()).toContain('heat.cap');
    expect(errorsFor((d) => { meta(d).failPenalty = 99999; }).join()).toContain('failPenalty');
    expect(errorsFor((d) => { meta(d).hazardPhases[0]!.escalated = { periodTicks: 5 }; }).join()).toContain('below 20 ticks');
    expect(errorsFor((d) => { meta(d).hazardPhases[0]!.escalated = { r: d.hazards[0]!.r * 3 }; }).join()).toContain('base radius');
  });

  it('rejects a resolution that points at an unknown objective', () => {
    expect(errorsFor((d) => { meta(d).resolveObjectives = ['o_nope']; }).join()).toContain('unknown objective o_nope');
  });

  it('requires a threat (warning + countermeasure + repair path) for every hazard', () => {
    expect(errorsFor((d) => { meta(d).threats = []; }).join()).toContain('has no threat entry');
    expect(errorsFor((d) => { meta(d).threats.push({ ...meta(d).threats[0]! }); }).join()).toContain('2 threat entries');
    expect(errorsFor((d) => { meta(d).threats[0]!.warning = '   '; }).join()).toContain('empty warning');
    expect(errorsFor((d) => { meta(d).threats[0]!.repair = ''; }).join()).toContain('empty repair path');
    expect(errorsFor((d) => { meta(d).threats[0]!.hazardId = 'hz_nope'; }).join()).toContain('unknown hazard hz_nope');
  });

  it('requires the countermeasure to actually counter the hazard and to be in the loadout', () => {
    expect(errorsFor((d) => { meta(d).threats[0]!.countermeasure = 'gravity_anchor'; }).join()).toContain('not a countermeasure for arc_discharge');
    expect(errorsFor((d) => { d.loadout = d.loadout.filter((t) => t !== 'shield_projector'); }).join()).toContain('loadout lacks countermeasure shield_projector');
  });

  it('requires every arc hazard to be controlled by the lifecycle', () => {
    expect(errorsFor((d) => { meta(d).hazardPhases = []; }).join()).toContain('not controlled by the lifecycle');
    expect(errorsFor((d) => { meta(d).hazardPhases[0]!.hazardId = 'hz_nope'; }).join()).toContain('hazardPhases references unknown hazard');
  });

  it('never lets public text leak a hidden breakpoint (id or label, any case)', () => {
    expect(errorsFor((d) => { meta(d).messages.warning = 'Check bp_valve now'; }).join()).toContain('leaks hidden breakpoint "bp_valve"');
    expect(errorsFor((d) => { meta(d).threats[0]!.repair = 'Weld the SEIZED COOLANT VALVE'; }).join()).toContain('leaks hidden breakpoint');
    expect(errorsFor((d) => { meta(d).name = 'f_valve overload'; }).join()).toContain('leaks hidden breakpoint "f_valve"');
  });
});
