import { describe, expect, it } from 'vitest';
import { ARENA, ITEM_LIMITS, type Arena } from '@wb/shared';
import { AbilityConfigSchema, type ItemDef, type NeedDef, type StageDef, type StashDef } from '../../src/systems/stageDef';
import { validateStageDef } from '../../src/systems/validate';
import { StageEngine } from '../../src/systems/engine';
import { platformGraph, reachableFrom } from '../../src/salvage/reach';
import { cloneStage } from '../helpers/stage';
import { FIXTURE_ITEMS, FIXTURE_NEEDS, FIXTURE_STASHES, STASH_ITEM, part } from '../helpers/itemHarness';

const build = (items: ItemDef[], needs: NeedDef[] = [], stashes: StashDef[] = [], mutate?: (d: StageDef) => void): StageDef => {
  const d = cloneStage();
  d.items = structuredClone(items); d.needs = structuredClone(needs); d.stashes = structuredClone(stashes);
  mutate?.(d);
  return d;
};
const errs = (d: StageDef, arena: Arena = ARENA) => validateStageDef(d, arena);
const has = (list: string[], text: string) => list.some((e) => e.includes(text));

/** Relay Platform 01 plus a high island nobody can jump to. */
const ISLAND = { x: 600, y: 100, w: 160, h: 20 };
const islandArena: Arena = { ...ARENA, solids: [...ARENA.solids, ISLAND] };

describe('platform reachability uses the real physics', () => {
  it('a lone player starting on the floor can reach every platform of Relay Platform 01', () => {
    const r = reachableFrom(ARENA, 0);
    expect([...r].sort()).toEqual(ARENA.solids.map((_, i) => i));
  });
  it('every platform leads back down to the floor, and the graph is memoised per arena', () => {
    const g = platformGraph(ARENA);
    for (let i = 0; i < ARENA.solids.length; i++) expect(reachableFrom(ARENA, i).has(0)).toBe(true);
    expect(platformGraph(ARENA)).toBe(g);
  });
  it('a platform far above everything is not reachable', () => {
    expect(reachableFrom(islandArena, 0).has(ARENA.solids.length)).toBe(false);
  });
});

describe('validateSalvage: the fixture and the no-op case', () => {
  it('accepts the fixture stage, including a stash and its hidden part', () => {
    expect(errs(build(FIXTURE_ITEMS, FIXTURE_NEEDS))).toEqual([]);
    expect(errs(build([...FIXTURE_ITEMS, STASH_ITEM], FIXTURE_NEEDS, FIXTURE_STASHES))).toEqual([]);
    expect(() => new StageEngine(build([...FIXTURE_ITEMS, STASH_ITEM], FIXTURE_NEEDS, FIXTURE_STASHES), ['a'])).not.toThrow();
  });
  it('a stage without items, needs or stashes is untouched', () => {
    expect(errs(cloneStage())).toEqual([]);
  });
});

describe('validateSalvage: hiding rules', () => {
  it('a part revealed by interacting needs a real stash', () => {
    const noId = part('h', 'fuse', 300, 590, { hidden: { container: 'crate', reveal: 'interact' } });
    expect(has(errs(build([noId])), 'item h is revealed by interacting and needs a stashId')).toBe(true);
    const bad = part('h', 'fuse', 300, 590, { hidden: { container: 'crate', reveal: 'interact', stashId: 'nope' } });
    expect(has(errs(build([bad])), 'item h names unknown stash nope')).toBe(true);
  });
  it('a scan-revealed part needs the Scanner and must not name a stash', () => {
    const scan = part('h', 'fuse', 300, 590, { hidden: { container: 'panel', reveal: 'scan' } });
    expect(has(errs(build([scan], [], [], (d) => { d.loadout = d.loadout.filter((t) => t !== 'phase_scanner'); })), 'revealed by scanning but the loadout has no phase_scanner')).toBe(true);
    const named = part('h', 'fuse', 300, 590, { hidden: { container: 'panel', reveal: 'scan', stashId: 'crate_a' } });
    expect(has(errs(build([named], [], FIXTURE_STASHES)), 'must not name a stash')).toBe(true);
  });
  it('a tell without a decoy is an error', () => {
    expect(has(errs(build([part('t', 'fuse', 300, 590, { tell: true })])), 'item t has a tell but is not a decoy')).toBe(true);
  });
  it('stash structure: duplicate id, collision, off a platform, too many', () => {
    const s = (id: string, x = 160, y = 590): StashDef => ({ id, kind: 'crate', label: 'Crate', x, y });
    expect(has(errs(build([], [], [s('c'), s('c')])), 'duplicate stash id: c')).toBe(true);
    expect(has(errs(build([], [], [s('cache')])), 'stash cache shares an id')).toBe(true);
    expect(has(errs(build([], [], [s('c', 160, 575)])), 'is not standing on a platform')).toBe(true);
    const many = Array.from({ length: ITEM_LIMITS.maxStashesPerStage + 1 }, (_, i) => s(`c${i}`, 150 + i * 20));
    expect(has(errs(build([], [], many)), 'too many stashes')).toBe(true);
  });
});

describe('validateSalvage: ability gates (the stage must enable the ability, and the spot must truly need it)', () => {
  const island = (gate?: ItemDef['gate']) => part('iso', 'fuse', 680, 100, gate ? { gate } : {});
  const withAbility = (d: StageDef) => { d.abilities = AbilityConfigSchema.parse({ enabled: ['gravity_well'] }); };
  it('an unreachable part with no gate is an error', () => {
    expect(has(errs(build([island()]), islandArena), 'item iso cannot be reached on foot')).toBe(true);
  });
  it('a gate whose ability the stage does not enable is an error', () => {
    expect(has(errs(build([island('gravity_well')]), islandArena), 'item iso needs the gravity_well ability but the stage does not enable it')).toBe(true);
  });
  it('a gate with its ability enabled is accepted', () => {
    expect(errs(build([island('gravity_well')], [], [], withAbility), islandArena).filter((e) => e.includes('item iso'))).toEqual([]);
  });
  it('a gate on a spot a lone player can walk to is an error (the gate would not be required)', () => {
    expect(has(errs(build([part('easy', 'fuse', 300, 590, { gate: 'gravity_well' })], [], [], withAbility)), 'declares the gravity_well gate but a lone player can walk there')).toBe(true);
  });
  it('a gated part on a high island can still be carried down to a target', () => {
    const d = build([island('gravity_well')], [{ targetId: 'cache', items: ['fuse'] }], [], withAbility);
    expect(errs(d, islandArena).filter((e) => e.includes('cache'))).toEqual([]);
  });
  it('a stash on an unreachable platform needs a gate too', () => {
    const st: StashDef = { id: 'sky', kind: 'ceiling', label: 'High locker', x: 680, y: 100 };
    const hid = part('inside', 'fuse', 300, 590, { hidden: { container: 'locker', reveal: 'interact', stashId: 'sky' } });
    expect(has(errs(build([hid], [], [st]), islandArena), 'stash sky (holds inside) cannot be reached on foot')).toBe(true);
    expect(errs(build([hid], [], [{ ...st, gate: 'gravity_well' }], withAbility), islandArena).filter((e) => e.includes('sky'))).toEqual([]);
  });
});

describe('validateSalvage: solo-safe supply (bipartite matching, 2-slot trips)', () => {
  it('two targets that each need a fuse cannot share one genuine fuse', () => {
    const d = build([part('f', 'fuse', 300, 590)], [{ targetId: 'cache', items: ['fuse'] }, { targetId: 'lock_a', items: ['fuse'] }]);
    expect(has(errs(d), 'cannot be met: no distinct, genuine, reachable fuse')).toBe(true);
  });
  it('a decoy never counts as supply, and a spare genuine part fixes it', () => {
    const decoyOnly = build([part('c', 'flux_coil', 300, 590, { decoy: true })], [{ targetId: 'cache', items: ['flux_coil'] }]);
    expect(has(errs(decoyOnly), 'cannot be met')).toBe(true);
    const spare = build([part('c', 'flux_coil', 300, 590, { decoy: true }), part('g', 'flux_coil', 320, 590)], [{ targetId: 'cache', items: ['flux_coil'] }]);
    expect(errs(spare)).toEqual([]);
  });
  it('enough parts for every demand, spread over targets, is accepted', () => {
    const d = build([part('f1', 'fuse', 300, 590), part('f2', 'fuse', 320, 590)], [{ targetId: 'cache', items: ['fuse'] }, { targetId: 'lock_a', items: ['fuse'] }]);
    expect(errs(d)).toEqual([]);
  });
  it('bounds the trips a lone player needs: a heavy part is a trip of its own, two light parts share one', () => {
    const ents = ['cache', 'sw_1', 'sw_2', 'sw_3', 'sw_4', 'lock_a', 'lock_b'];
    const heavy = ents.map((t): NeedDef => ({ targetId: t, items: ['power_core', 'power_core'] }));
    const stock = Array.from({ length: 12 }, (_, i) => part(`pc${i}`, 'power_core', 150 + i * 20, 590));
    expect(has(errs(build(stock, heavy)), 'trips to carry every part with 2 slots')).toBe(true);
    const light = ents.map((t): NeedDef => ({ targetId: t, items: ['fuse', 'battery'] }));
    const lightStock = [...Array.from({ length: 7 }, (_, i) => part(`f${i}`, 'fuse', 150 + i * 20, 590)), ...Array.from({ length: 5 }, (_, i) => part(`b${i}`, 'battery', 160 + i * 20, 680))];
    expect(has(errs(build(lightStock, light)), 'trips')).toBe(false);
  });
});

describe('validateSalvage: tools in needs', () => {
  it('only the Flux Welder can be required, only on a breakpoint or conduit, and it must be in the loadout', () => {
    const items = [part('c', 'flux_coil', 300, 590)];
    expect(errs(build(items, [{ targetId: 'bp_coupling', items: ['flux_coil'], tools: ['flux_welder'] }]))).toEqual([]);
    expect(has(errs(build(items, [{ targetId: 'bp_coupling', items: ['flux_coil'], tools: ['gravity_anchor'] }])), 'only flux_welder can be required')).toBe(true);
    expect(has(errs(build(items, [{ targetId: 'cache', items: ['flux_coil'], tools: ['flux_welder'] }])), 'only breakpoints and conduits')).toBe(true);
    const noWelder = build(items, [{ targetId: 'bp_coupling', items: ['flux_coil'], tools: ['flux_welder'] }], [], (d) => { d.loadout = d.loadout.filter((t) => t !== 'flux_welder'); });
    expect(has(errs(noWelder), 'requires flux_welder but the loadout lacks it')).toBe(true);
  });
});
