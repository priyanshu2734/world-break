import { describe, expect, it } from 'vitest';
import { ITEM_GATES, ITEM_LIMITS, ItemActionSchema, ItemsPublicSchema, itemShape } from '../src';

describe('P3C step 2 contracts', () => {
  it('the open intent names a stash only (hidden parts have no id a client could send)', () => {
    expect(ItemActionSchema.safeParse({ action: 'open', stashId: 'crate_a' }).success).toBe(true);
    for (const bad of [{ action: 'open' }, { action: 'open', stashId: 'Bad Id' }, { action: 'open', stashId: 'a', itemId: 'b' }, { action: 'open', itemId: 'a' }]) {
      expect(ItemActionSchema.safeParse(bad).success).toBe(false);
    }
  });
  it('silhouettes: power cores are heavy, everything else small', () => {
    expect(itemShape('power_core')).toBe('heavy');
    expect(itemShape('flux_coil')).toBe('small');
  });
  it('new limits are positive, bounded, and the gates are the P3B abilities', () => {
    for (const k of ['openRange', 'needsRevealRange', 'maxStashesPerStage', 'hazardGraceTicks', 'maxTripsPerStage'] as const) expect(ITEM_LIMITS[k]).toBeGreaterThan(0);
    expect(ITEM_LIMITS.hazardGraceTicks).toBeGreaterThanOrEqual(60);
    expect([...ITEM_GATES]).toEqual(['gravity_well', 'freeze', 'duplicate', 'momentum']);
  });
  it('stashes and needs are optional in the public state, and parse when present', () => {
    const base = { carrySlots: 2, items: [], players: [] };
    expect(ItemsPublicSchema.safeParse(base).success).toBe(true);
    const full = {
      ...base,
      stashes: [{ id: 'crate_a', kind: 'crate', label: 'Crate', x: 1, y: 2, opened: false }],
      needs: [{ targetId: 'cache', label: 'Cache', satisfied: false, hint: null, tools: ['flux_welder'], parts: [{ kind: null, label: null, shape: 'small', installed: false }] }],
    };
    expect(ItemsPublicSchema.safeParse(full).success).toBe(true);
    expect(ItemsPublicSchema.safeParse({ ...full, stashes: [{ ...full.stashes[0], kind: 'vault' }] }).success).toBe(false);
    expect(ItemsPublicSchema.safeParse({ ...full, needs: [{ ...full.needs[0], parts: [{ kind: null, label: null, shape: 'tiny', installed: false }] }] }).success).toBe(false);
  });
  it('a cracked flag is a plain optional boolean on an item', () => {
    const it = { id: 'a', kind: 'fuse', label: 'Fuse', slots: 1, state: 'in_world', x: 0, y: 0, carrierId: null, targetId: null };
    expect(ItemsPublicSchema.safeParse({ carrySlots: 2, items: [{ ...it, cracked: true }], players: [] }).success).toBe(true);
    expect(ItemsPublicSchema.safeParse({ carrySlots: 2, items: [{ ...it, cracked: 'yes' }], players: [] }).success).toBe(false);
  });
});
