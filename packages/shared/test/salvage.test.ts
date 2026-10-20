import { describe, expect, it } from 'vitest';
import { ITEM_KINDS, ITEM_KIND_SPECS, ITEM_LIMITS, ItemActionSchema, ItemKindSchema, ItemsPublicSchema, StageStateSchema } from '../src';

describe('salvage specs (GAMEPLAY.md section 4b)', () => {
  it('players carry 2 slots; heavy items need 2; every kind has a spec', () => {
    expect(ITEM_LIMITS.carrySlots).toBe(2);
    expect(ITEM_KINDS.length).toBeGreaterThanOrEqual(7);
    for (const k of ITEM_KINDS) {
      expect(ITEM_KIND_SPECS[k].kind).toBe(k);
      expect(ITEM_KIND_SPECS[k].label.length).toBeGreaterThan(0);
      expect([1, 2]).toContain(ITEM_KIND_SPECS[k].defaultSlots);
    }
    expect(ITEM_KIND_SPECS.power_core.defaultSlots).toBe(2);
    expect(new Set(ITEM_KINDS.map((k) => ITEM_KIND_SPECS[k].label)).size).toBe(ITEM_KINDS.length);
  });
  it('the limits are positive and bounded', () => {
    for (const [k, v] of Object.entries(ITEM_LIMITS)) { expect(Number.isInteger(v)).toBe(true); expect(v, k).toBeGreaterThan(0); }
    expect(ITEM_LIMITS.maxItemsPerStage).toBeLessThanOrEqual(16);
  });
  it('item kinds are the documented ones', () => {
    for (const k of ['fuse', 'flux_coil', 'coolant_cell', 'valve_wheel', 'access_key', 'battery', 'revive_cell']) expect(ItemKindSchema.safeParse(k).success).toBe(true);
    expect(ItemKindSchema.safeParse('sword').success).toBe(false);
  });
});

describe('ItemActionSchema (what a client may ask for)', () => {
  it('accepts the five intents', () => {
    const ok: unknown[] = [
      { action: 'pickup', itemId: 'coil_ok' },
      { action: 'drop', itemId: 'coil_ok' },
      { action: 'swap', dropId: 'a', pickId: 'b' },
      { action: 'handover', itemId: 'a', toPlayerId: '3f2b8c1e-7d44-4a55-9f10-0123456789ab' },
      { action: 'install', itemId: 'a', targetId: 'cache' },
    ];
    for (const p of ok) expect(ItemActionSchema.safeParse(p).success).toBe(true);
  });
  it('rejects unknown actions, missing or malformed ids, wrong types and extra keys', () => {
    const bad: unknown[] = [
      null, undefined, 'pickup', 42, [], {}, { action: 'steal', itemId: 'a' },
      { action: 'pickup' }, { action: 'pickup', itemId: '' }, { action: 'pickup', itemId: 'Bad Id' }, { action: 'pickup', itemId: 'a'.repeat(41) },
      { action: 'pickup', itemId: 'a', extra: true },
      { action: 'swap', dropId: 'a' }, { action: 'handover', itemId: 'a', toPlayerId: '' }, { action: 'handover', itemId: 'a', toPlayerId: 'x'.repeat(65) },
      { action: 'install', itemId: 'a', targetId: 5 },
    ];
    for (const p of bad) expect(ItemActionSchema.safeParse(p).success).toBe(false);
  });
});

describe('ItemsPublicSchema / StageState', () => {
  const sample = {
    carrySlots: 2,
    items: [{ id: 'coil_ok', kind: 'flux_coil', label: 'Flux Coil', slots: 1, state: 'in_world', x: 250, y: 590, carrierId: null, targetId: null }],
    players: [{ id: 'a', slotsUsed: 0, carried: [] }],
  };
  it('parses a well-formed public item state', () => {
    expect(ItemsPublicSchema.safeParse(sample).success).toBe(true);
  });
  it('never allows states that must stay private (hidden, consumed, destroyed) or bad slots', () => {
    for (const state of ['hidden', 'consumed', 'destroyed']) {
      expect(ItemsPublicSchema.safeParse({ ...sample, items: [{ ...sample.items[0], state }] }).success).toBe(false);
    }
    expect(ItemsPublicSchema.safeParse({ ...sample, items: [{ ...sample.items[0], slots: 3 }] }).success).toBe(false);
  });
  it('StageState.items is optional (older states still parse)', () => {
    const shape = StageStateSchema.shape;
    expect(shape.items.isOptional()).toBe(true);
  });
});
