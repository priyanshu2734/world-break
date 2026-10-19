import { describe, expect, it } from 'vitest';
import { ARENA, ITEM_LIMITS } from '@wb/shared';
import { StageDefSchema, type ItemDef, type StageDef } from '../../src/systems/stageDef';
import { validateStageDef } from '../../src/systems/validate';
import { StageEngine } from '../../src/systems/engine';
import { cloneStage } from '../helpers/stage';
import { FIXTURE_ITEMS, FIXTURE_NEEDS, part } from '../helpers/itemHarness';

const withItems = (items: ItemDef[] = FIXTURE_ITEMS, needs = FIXTURE_NEEDS): StageDef => {
  const d = cloneStage();
  d.items = structuredClone(items);
  d.needs = structuredClone(needs);
  return d;
};
const errors = (d: StageDef) => validateStageDef(d, ARENA);

describe('validateStageDef: items and needs (P3C)', () => {
  it('a stage without items or needs is unchanged (no new errors)', () => {
    expect(errors(cloneStage())).toEqual([]);
  });
  it('accepts the fixture stage and the engine launches it', () => {
    expect(errors(withItems())).toEqual([]);
    expect(() => new StageEngine(withItems(), ['a'])).not.toThrow();
  });
  it('rejects duplicate item ids and ids that collide with a target', () => {
    expect(errors(withItems([part('x', 'fuse', 300, 590), part('x', 'battery', 310, 590)], []))).toContain('duplicate item id: x');
    expect(errors(withItems([part('cache', 'fuse', 300, 590)], []))).toContain('item cache shares an id with a target');
  });
  it('rejects an item outside the arena, with no platform under it, or floating high above one', () => {
    expect(errors(withItems([part('o', 'fuse', 2000, 590)], []))).toContain('item o is outside the arena');
    expect(errors(withItems([part('v', 'fuse', 300, 700)], [])).some((e) => e.includes('item v') && e.includes('no platform under it'))).toBe(true);
    expect(errors(withItems([part('f', 'fuse', 300, 200)], [])).some((e) => e.startsWith('item f would fall'))).toBe(true);
  });
  it('allows a small authored fall (the item rests on the platform) but not more than the limit', () => {
    expect(errors(withItems([part('ok', 'fuse', 300, 590 - ITEM_LIMITS.maxAuthoredFall)], []))).toEqual([]);
    expect(errors(withItems([part('no', 'fuse', 300, 590 - ITEM_LIMITS.maxAuthoredFall - 1)], [])).some((e) => e.startsWith('item no would fall'))).toBe(true);
  });
  it('enforces the item and need counts (bounded complexity)', () => {
    const many = Array.from({ length: ITEM_LIMITS.maxItemsPerStage + 1 }, (_, i) => part(`it${i}`, 'fuse', 100 + i * 50, 680));
    expect(errors(withItems(many, [])).some((e) => e.startsWith('too many items'))).toBe(true);
    expect(StageDefSchema.safeParse({ ...withItems(many, []) }).success).toBe(false); // the schema bounds it too
  });
  it('rejects a need on an unknown target, a duplicate need and a need the stage cannot supply', () => {
    expect(errors(withItems(FIXTURE_ITEMS, [{ targetId: 'ghost', items: ['fuse'] }])).some((e) => e.includes('unknown target ghost'))).toBe(true);
    expect(errors(withItems(FIXTURE_ITEMS, [{ targetId: 'cache', items: ['fuse'] }, { targetId: 'cache', items: ['battery'] }])).some((e) => e.includes('duplicate need id: cache'))).toBe(true);
    // only a decoy coil exists: the need can never be met
    const onlyDecoy = [part('bad', 'flux_coil', 250, 590, { decoy: true })];
    expect(errors(withItems(onlyDecoy, [{ targetId: 'cache', items: ['flux_coil'] }])).some((e) => e.includes('needs 1 x flux_coil but the stage provides 0 genuine'))).toBe(true);
    // two coils needed, one genuine coil provided
    expect(errors(withItems([part('c', 'flux_coil', 250, 590)], [{ targetId: 'cache', items: ['flux_coil', 'flux_coil'] }])).some((e) => e.includes('needs 2 x flux_coil'))).toBe(true);
  });
  it('a hidden genuine item still counts as supply (it can be found)', () => {
    const hidden = [part('c', 'flux_coil', 250, 590, { hidden: { container: 'crate', reveal: 'scan' } })];
    expect(errors(withItems(hidden, [{ targetId: 'cache', items: ['flux_coil'] }]))).toEqual([]);
  });
  it('the engine refuses to launch an invalid item stage', () => {
    expect(() => new StageEngine(withItems([part('o', 'fuse', 2000, 590)], []), ['a'])).toThrow();
  });
});
