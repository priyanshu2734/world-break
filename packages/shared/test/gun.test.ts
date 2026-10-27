import { describe, expect, it } from 'vitest';
import { GUN_LIMITS, GhostActionSchema, GhostShotSchema, ITEM_KIND_SPECS, ItemKindSchema, NOISE_KIND_LOUDNESS } from '../src';

describe('P3E step 4 contracts', () => {
  it('the fire action is strict and takes nothing from the client (the aim is the server\'s own)', () => {
    expect(GhostActionSchema.safeParse({ action: 'fire' }).success).toBe(true);
    expect(GhostActionSchema.safeParse({ action: 'fire', angle: 1 }).success).toBe(false);
    expect(GhostActionSchema.safeParse({ action: 'hide' }).success).toBe(true);
  });
  it('the shot message is bounded', () => {
    const ok = { id: 's', x: 1, y: 2, angle: 0.5, rangePx: GUN_LIMITS.rangePx, speedPx: GUN_LIMITS.speedPx, tick: 3, room: 'r0' };
    expect(GhostShotSchema.safeParse(ok).success).toBe(true);
    expect(GhostShotSchema.safeParse({ ...ok, rangePx: 99999 }).success).toBe(false);
    expect(GhostShotSchema.safeParse({ ...ok, speedPx: 0 }).success).toBe(false);
  });
  it('the gun is a one-hand item kind; its range is short and its bolt lasts a few ticks', () => {
    expect(ItemKindSchema.safeParse('pulse_gun').success).toBe(true);
    expect(ITEM_KIND_SPECS.pulse_gun.defaultSlots).toBe(1);
    expect(Math.ceil(GUN_LIMITS.rangePx / GUN_LIMITS.speedPx)).toBeLessThanOrEqual(20);
    expect(NOISE_KIND_LOUDNESS.shot).toBeGreaterThan(NOISE_KIND_LOUDNESS.door);
  });
});
