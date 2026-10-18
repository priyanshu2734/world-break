import { describe, expect, it } from 'vitest';
import { ABILITY_LAB_ARENA, ABILITY_SPECS } from '@wb/shared';
import { validateStageDef, FREEZE_CHANNEL_SLACK_TICKS } from '../../src/systems/validate';
import { StageDefSchema, type StageDef } from '../../src/systems/stageDef';
import { StageEngine } from '../../src/systems/engine';
import { ABILITY_LAB_STAGE } from '../../src/systems/stages/abilityLab';

const lab = (mutate: (d: StageDef) => void = () => {}): string[] => {
  const d = structuredClone(ABILITY_LAB_STAGE);
  mutate(d);
  return validateStageDef(d, ABILITY_LAB_ARENA);
};
const has = (errs: string[], part: string) => expect(errs.some((e) => e.includes(part)), JSON.stringify(errs)).toBe(true);

describe('validator: P3B rules', () => {
  it('the Lab itself is valid', () => expect(lab()).toEqual([]));

  it('plates: must stand on a platform, belong to a real objective, and use armTicks 1', () => {
    has(lab((d) => { const p = d.entities.find((e) => e.id === 'plate_well')!; p.y = 130; }), 'plate_well');
    has(lab((d) => { const p = d.entities.find((e) => e.id === 'plate_well')!; (p as { objectiveId: string }).objectiveId = 'nope'; }), 'unknown objective');
    has(lab((d) => { const o = d.objectives.find((x) => x.id === 'o_dup')!; if (o.params.kind === 'timed_controls') o.params.armTicks = 30; }), 'armTicks 1');
  });
  it('plates and consoles cannot be mixed in one objective; a plate must belong to the objective that lists it', () => {
    has(lab((d) => { const o = d.objectives.find((x) => x.id === 'o_dup')!; if (o.params.kind === 'timed_controls') o.params.controls = ['plate_d1', 'core_anchor']; }), 'all pressure_plates or all sync_consoles');
    has(lab((d) => { const o = d.objectives.find((x) => x.id === 'o_dup')!; if (o.params.kind === 'timed_controls') o.params.controls = ['plate_d1', 'plate_m']; }), 'belongs to');
  });
  it('props: stand on a platform, do not overhang it, have unique ids', () => {
    has(lab((d) => { d.props![0]!.y = 395; }), 'prop crate_m');
    has(lab((d) => { d.props![0]!.x = 342; }), 'overhangs');
    has(lab((d) => { d.props![1]!.id = 'crate_m'; }), 'duplicate target id');
    has(lab((d) => { d.props![0]!.id = 'hz_arc'; }), 'prop and hazard share id');
  });
  it('abilities: no duplicates, energyStart within energyMax', () => {
    has(lab((d) => { d.abilities!.enabled = ['freeze', 'freeze']; }), 'duplicates');
    has(lab((d) => { d.abilities!.energyMax = 50; d.abilities!.energyStart = 80; }), 'energyStart');
  });
  it('an arc discharge needs a shield in the loadout, OR Freeze enabled with a channel it can cover', () => {
    expect(lab((d) => { d.loadout = ['phase_scanner', 'flux_welder', 'gravity_anchor']; })).toEqual([]); // Freeze covers it
    has(lab((d) => { d.abilities!.enabled = ['gravity_well', 'duplicate', 'momentum', 'anchor']; }), 'shield_projector'); // no Freeze: unsolvable
    const slack = ABILITY_SPECS.freeze.durationTicks - FREEZE_CHANNEL_SLACK_TICKS;
    expect(lab((d) => { const o = d.objectives.find((x) => x.id === 'o_freeze')!; if (o.params.kind === 'channel_hold') o.params.requiredTicks = slack; })).toEqual([]);
    has(lab((d) => { const o = d.objectives.find((x) => x.id === 'o_freeze')!; if (o.params.kind === 'channel_hold') o.params.requiredTicks = slack + 1; }), 'shield_projector');
    expect(lab((d) => { d.loadout = ['phase_scanner', 'flux_welder', 'gravity_anchor', 'shield_projector']; d.abilities!.enabled = ['anchor']; })).toEqual([]); // the shield does the job
  });
  it('a stage that fails validation cannot start an engine', () => {
    const d = structuredClone(ABILITY_LAB_STAGE);
    d.props![0]!.x = 342;
    expect(() => new StageEngine(StageDefSchema.parse(d), ['a'], { arena: ABILITY_LAB_ARENA })).toThrow();
  });
  it('pre-P3B stage definitions (no props, no abilities, no plates) validate exactly as before', () => {
    const d = structuredClone(ABILITY_LAB_STAGE);
    delete d.props; delete d.abilities;
    d.entities = d.entities.filter((e) => e.kind !== 'pressure_plate');
    d.objectives = d.objectives.filter((o) => o.params.kind !== 'timed_controls');
    d.loadout = ['phase_scanner', 'flux_welder', 'gravity_anchor', 'shield_projector']; // without Freeze the arc needs the shield
    expect(validateStageDef(d, ABILITY_LAB_ARENA)).toEqual([]);
  });
});
