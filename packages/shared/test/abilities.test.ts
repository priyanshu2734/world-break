import { describe, expect, it } from 'vitest';
import {
  ABILITY_IDS, ABILITY_SPECS, ACTIVE_ABILITY_IDS, AbilityActionSchema, AbilitiesPublicSchema, ANCHOR_RULES, ENERGY_MAX, MOMENTUM_IMPULSE,
  TOOL_SPECS, WELL_GRAVITY, GRAVITY, WorldPublicSchema, boundImpulse,
} from '../src';

describe('ability specs (GAMEPLAY.md section 4 defaults)', () => {
  it('has a spec for every ability with sane, bounded numbers', () => {
    for (const id of ABILITY_IDS) {
      const s = ABILITY_SPECS[id];
      expect(s.id).toBe(id);
      expect(s.energyCost).toBeGreaterThanOrEqual(0); expect(s.energyCost).toBeLessThanOrEqual(ENERGY_MAX);
      expect(s.cooldownTicks).toBeGreaterThan(0); expect(s.range).toBeGreaterThanOrEqual(0);
    }
    for (const id of ACTIVE_ABILITY_IDS) expect(ABILITY_SPECS[id].energyCost).toBeGreaterThan(0);
  });
  it('matches the documented defaults (20 ticks = 1 s)', () => {
    expect(ABILITY_SPECS.gravity_well).toMatchObject({ durationTicks: 120, cooldownTicks: 300, perRoomCap: 2 });
    expect(ABILITY_SPECS.freeze).toMatchObject({ durationTicks: 60, cooldownTicks: 240 });
    expect(ABILITY_SPECS.duplicate).toMatchObject({ durationTicks: 160, perPlayerCap: 2 });
    expect(ABILITY_SPECS.momentum.cooldownTicks).toBe(160);
  });
  it('the anchor reuses the P2 tool limits and costs no energy', () => {
    expect(ABILITY_SPECS.anchor.energyCost).toBe(0);
    expect(ABILITY_SPECS.anchor.durationTicks).toBe(TOOL_SPECS.gravity_anchor.durationTicks);
    expect(ABILITY_SPECS.anchor.cooldownTicks).toBe(TOOL_SPECS.gravity_anchor.cooldownTicks);
    expect(ANCHOR_RULES.maxActive).toBeGreaterThan(0);
  });
  it('a flipped well is exactly opposite gravity; a reduced well is weaker but still down', () => {
    expect(WELL_GRAVITY.flip).toBe(-GRAVITY);
    expect(WELL_GRAVITY.reduce).toBeGreaterThan(0); expect(WELL_GRAVITY.reduce).toBeLessThan(GRAVITY);
  });
  it('boundImpulse clamps and neutralises non-finite values', () => {
    expect(boundImpulse(1e9)).toBe(MOMENTUM_IMPULSE);
    expect(boundImpulse(-1e9)).toBe(-MOMENTUM_IMPULSE);
    expect(boundImpulse(Number.NaN)).toBe(0);
    expect(boundImpulse(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(boundImpulse(12)).toBe(12);
  });
});

describe('ability intent schema', () => {
  it('accepts well-formed intents', () => {
    for (const a of [
      { ability: 'gravity_well', x: 10, y: 20, mode: 'reduce' }, { ability: 'freeze', targetId: 'crate_a' },
      { ability: 'duplicate', targetId: 'crate_a', x: 1, y: 2 }, { ability: 'momentum', targetId: 'self', dir: 'cancel' },
      { ability: 'momentum', targetId: 'crate_a', dir: 'left' },
    ]) expect(AbilityActionSchema.safeParse(a).success).toBe(true);
  });
  it('rejects NaN, Infinity, huge values, unknown keys and anchor (it is a tool)', () => {
    for (const a of [
      { ability: 'gravity_well', x: Number.NaN, y: 0, mode: 'flip' }, { ability: 'gravity_well', x: Infinity, y: 0, mode: 'flip' },
      { ability: 'gravity_well', x: 99999, y: 0, mode: 'flip' }, { ability: 'freeze', targetId: 'a', more: true },
      { ability: 'anchor' }, { ability: 'momentum', targetId: 'UPPER', dir: 'up' },
    ]) expect(AbilityActionSchema.safeParse(a).success).toBe(false);
  });
});

describe('public schemas', () => {
  it('validate a world and an abilities projection', () => {
    expect(WorldPublicSchema.safeParse({ zones: [], impulses: [], props: [] }).success).toBe(true);
    expect(AbilitiesPublicSchema.safeParse({
      enabled: ['freeze'], energyMax: 100, players: [{ id: 'a', energy: 5, cooldowns: [], clones: 0 }],
      active: { wells: 0, freezes: 0, clones: 0, anchors: 0 },
    }).success).toBe(true);
    expect(WorldPublicSchema.safeParse({ zones: [{ id: 'z' }], impulses: [], props: [] }).success).toBe(false);
  });
});
