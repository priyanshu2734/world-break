import { describe, expect, it } from 'vitest';
import { ARENA } from '@wb/shared';
import { TUTORIAL_STAGE } from '../../src/systems/tutorial';
import { validateStageDef } from '../../src/systems/validate';
import { StageEngine } from '../../src/systems/engine';
import type { StageDef } from '../../src/systems/stageDef';

const clone = (): StageDef => structuredClone(TUTORIAL_STAGE);
const errorsOf = (mut: (d: StageDef) => void) => { const d = clone(); mut(d); return validateStageDef(d, ARENA); };

describe('stage validation', () => {
  it('the hand-authored tutorial is valid', () => {
    expect(validateStageDef(TUTORIAL_STAGE, ARENA)).toEqual([]);
  });
  it('refuses to construct an engine for an invalid stage', () => {
    const d = clone(); d.edges.push({ from: 's_flicker', to: 'f_coupling' });
    expect(() => new StageEngine(d, ['a'])).toThrow(/Invalid stage/);
  });
  it('rejects a cyclic failure graph', () => {
    expect(errorsOf((d) => { d.edges.push({ from: 's_pressure', to: 'f_pump' }); }).join()).toMatch(/cycle/);
    expect(errorsOf((d) => { d.edges.push({ from: 's_flicker', to: 's_drift' }, { from: 's_drift', to: 's_flicker' }); }).join()).toMatch(/cycle/);
  });
  it('rejects dangling references', () => {
    expect(errorsOf((d) => { d.edges.push({ from: 'nope', to: 's_drift' }); }).join()).toMatch(/unknown failure/);
    expect(errorsOf((d) => { d.objectives[2]!.prerequisites.push('ghost'); }).join()).toMatch(/unknown prerequisite/);
    expect(errorsOf((d) => { d.breakpoints[0]!.scanRequires = ['ghost']; }).join()).toMatch(/unknown objective/);
  });
  it('rejects duplicate target ids (clients address everything by id)', () => {
    expect(errorsOf((d) => { d.breakpoints[0]!.id = 'cache'; }).join()).toMatch(/duplicate target id/);
  });
  it('rejects an orphan symptom with no cause', () => {
    expect(errorsOf((d) => { d.failures.push({ id: 's_orphan', kind: 'symptom', label: 'x', hint: '' }); }).join()).toMatch(/has no cause/);
  });
  it('rejects things floating in mid-air', () => {
    expect(errorsOf((d) => { d.breakpoints[0]!.y = 380; }).join()).toMatch(/not standing on a platform/);
    expect(errorsOf((d) => { d.entities[0]!.x = 5000; }).join()).toMatch(/not standing on a platform/);
  });
  it('rejects a required breakpoint that the welder cannot fix', () => {
    expect(errorsOf((d) => { d.breakpoints[0]!.weldable = false; }).join()).toMatch(/not weldable/);
  });
  it('rejects a power puzzle with no valid configuration', () => {
    // capacity 0 is impossible by schema, so make the pump unreachable instead
    expect(errorsOf((d) => { d.power.conduits = d.power.conduits.filter((c) => c.id !== 'c_jp'); }).join()).toMatch(/no valid switch configuration/);
  });
  it('rejects a coordinated repair a single player cannot reach in time', () => {
    expect(errorsOf((d) => { (d.objectives[2]!.params as { armTicks: number }).armTicks = 20; }).join()).toMatch(/too short for one player/);
  });
  it('rejects a loadout missing a required tool', () => {
    expect(errorsOf((d) => { d.loadout = d.loadout.filter((t) => t !== 'power_cell'); }).join()).toMatch(/lacks required tool power_cell/);
    expect(errorsOf((d) => { d.loadout = d.loadout.filter((t) => t !== 'phase_scanner'); }).join()).toMatch(/lacks required tool phase_scanner/);
  });
  it('rejects objective prerequisite cycles', () => {
    expect(errorsOf((d) => { d.objectives[0]!.prerequisites = ['o_final']; }).join()).toMatch(/cycle/);
  });
  it('rejects a stage built for a different arena', () => {
    const d = clone(); d.arenaId = 'other';
    expect(validateStageDef(d, ARENA).join()).toMatch(/arena mismatch/);
  });
});
