import { describe, expect, it } from 'vitest';
import { ITEM_KIND_SPECS, ITEM_LIMITS, ghostTuning, TICK_DT } from '@wb/shared';
import { generateEscapeStage, GUN_SAFE_FROM_STAGE } from '../../src/rooms/generate';
import { requireGun } from '../../src/rooms/escapeValidate';

const STAGES = [2, 3, 4, 5, 6, 8, 12, 20, 30];
const SEEDS = [1, 2, 3, 7, 9, 21, 77, 123, 4096];

describe('Pulse Gun placement', () => {
  it('every ghost stage holds exactly one gun, hidden in the start room, one hand', () => {
    for (const stage of STAGES) for (const seed of SEEDS) {
      const def = generateEscapeStage(stage, seed, { ghost: true });
      const guns = (def.items ?? []).filter((i) => i.kind === 'pulse_gun');
      expect(guns.length).toBe(1);
      const g = guns[0]!;
      expect(g.decoy).not.toBe(true);
      expect(g.room ?? def.rooms!.start).toBe(def.rooms!.start);
      expect(g.hidden).toBeDefined();
      expect((g.slots ?? ITEM_KIND_SPECS.pulse_gun.defaultSlots) * 2).toBeLessThanOrEqual(ITEM_LIMITS.carrySlots);
      expect((def.items ?? []).length).toBeLessThanOrEqual(ITEM_LIMITS.maxItemsPerStage);
      expect(requireGun(def)).toEqual([]);
    }
  });

  it('a locker before the safe stage, a safe from it, clues in the start room', () => {
    for (const seed of SEEDS) {
      const low = generateEscapeStage(2, seed, { ghost: true });
      expect((low.escape!.safes).some((s) => s.contains === `${low.items!.find((i) => i.kind === 'pulse_gun')!.id}`)).toBe(false);
      const hi = generateEscapeStage(GUN_SAFE_FROM_STAGE + 3, seed, { ghost: true });
      const gun = hi.items!.find((i) => i.kind === 'pulse_gun')!;
      const safe = hi.escape!.safes.find((s) => s.contains === gun.id);
      if (safe) {
        expect(safe.room).toBe(hi.rooms!.start);
        for (const id of safe.clueIds) expect(hi.escape!.clues.find((c) => c.id === id)!.room).toBe(hi.rooms!.start);
      } else {
        expect(gun.hidden!.stashId).toBeDefined();
      }
    }
  });

  it('is deterministic by (stage, seed) and absent without the ghost option or on stage 1', () => {
    for (const stage of STAGES) {
      expect(JSON.stringify(generateEscapeStage(stage, 5, { ghost: true }))).toBe(JSON.stringify(generateEscapeStage(stage, 5, { ghost: true })));
      const off = generateEscapeStage(stage, 5);
      expect(off.items!.some((i) => i.kind === 'pulse_gun')).toBe(false);
      expect(JSON.stringify(off)).toBe(JSON.stringify(generateEscapeStage(stage, 5, {})));
    }
    expect(generateEscapeStage(1, 5, { ghost: true }).items!.some((i) => i.kind === 'pulse_gun')).toBe(false);
  });

  it('the validator rejects a stage with no gun, two guns, a gun outside the start room', () => {
    const def = generateEscapeStage(3, 7, { ghost: true });
    expect(requireGun({ items: [] })).not.toEqual([]);
    const gun = def.items!.find((i) => i.kind === 'pulse_gun')!;
    expect(requireGun({ items: [gun, { ...gun, id: 'x' }] })).not.toEqual([]);
  });
});

describe('stun length table', () => {
  it('about 150 s at stage 2, never under 45 s, never growing', () => {
    const s2 = ghostTuning('easy', 2).stunTicks * TICK_DT;
    expect(s2).toBeGreaterThan(120);
    expect(s2).toBeLessThanOrEqual(150);
    let prev = Infinity;
    for (let st = 2; st <= 60; st++) {
      const t = ghostTuning('hardcore', st).stunTicks * TICK_DT;
      expect(t).toBeGreaterThanOrEqual(45 - 1e-9);
      expect(t).toBeLessThanOrEqual(prev + 1e-9);
      prev = t;
    }
  });
});
